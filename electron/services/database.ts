import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrations as defaultMigrations, type Migration } from '../migrations'
import { nullLogger, type Logger } from './logger'

export type Db = Database.Database

export class DatabaseCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseCorruptError'
  }
}

export class DatabaseTooNewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseTooNewError'
  }
}

export interface OpenDatabaseOptions {
  migrations?: readonly Migration[]
  logger?: Logger
  /** Where to copy the database before applying migrations to an existing database. */
  migrationBackupDir?: string
  now?: () => Date
}

export function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

export function configureConnection(db: Db): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
}

export function quickCheck(db: Db): boolean {
  try {
    return db.pragma('quick_check', { simple: true }) === 'ok'
  } catch {
    return false
  }
}

/**
 * Applies every pending migration, each inside its own transaction. Refuses to touch a
 * database that was written by a newer version of the application.
 */
export function migrateDatabase(
  db: Db,
  options: {
    migrations?: readonly Migration[]
    logger?: Logger
    file?: string | null
    backupDir?: string
    now?: () => Date
  } = {}
): { applied: number[] } {
  const list = [...(options.migrations ?? defaultMigrations)].sort((a, b) => a.id - b.id)
  const logger = options.logger ?? nullLogger
  const now = options.now ?? (() => new Date())

  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT'
  )
  const appliedIds = new Set(db.prepare('SELECT id FROM schema_migrations').pluck().all() as number[])
  const knownIds = new Set(list.map((m) => m.id))
  for (const id of appliedIds) {
    if (!knownIds.has(id)) {
      throw new DatabaseTooNewError(
        `This database was created by a newer version of MemoFloat (schema ${id}). Update MemoFloat to open it.`
      )
    }
  }

  const pending = list.filter((m) => !appliedIds.has(m.id))
  if (pending.length === 0) return { applied: [] }

  if (appliedIds.size > 0 && options.file && options.backupDir) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
      mkdirSync(options.backupDir, { recursive: true })
      const target = join(options.backupDir, `pre-migration-${timestampForFileName(now())}.db`)
      copyFileSync(options.file, target)
      logger.info('Created pre-migration backup', { target })
    } catch (error) {
      logger.warn('Could not create pre-migration backup', { error })
    }
  }

  const applied: number[] = []
  const insert = db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql)
      insert.run(migration.id, migration.name, now().toISOString())
    })()
    applied.push(migration.id)
    logger.info('Applied migration', { id: migration.id, name: migration.name })
  }
  return { applied }
}

/** Opens (creating if needed) the database, verifies integrity and applies migrations. */
export function openDatabase(file: string, options: OpenDatabaseOptions = {}): Db {
  const inMemory = file === ':memory:'
  if (!inMemory) mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  try {
    configureConnection(db)
    if (!inMemory && !quickCheck(db)) {
      throw new DatabaseCorruptError('SQLite integrity check failed')
    }
    migrateDatabase(db, {
      migrations: options.migrations,
      logger: options.logger,
      file: inMemory ? null : file,
      backupDir: options.migrationBackupDir,
      now: options.now
    })
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      // ignore
    }
    throw error
  }
}

export function listBackups(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .map((name) => join(directory, name))
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.path)
}

function isCorruption(error: unknown): boolean {
  if (error instanceof DatabaseCorruptError) return true
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB')
}

export interface RecoveryInfo {
  /** Where the unreadable database was moved. It is never deleted. */
  corruptPath: string
  /** Backup that was restored, or null when a fresh database was created. */
  restoredFrom: string | null
}

export interface RecoveryOptions extends OpenDatabaseOptions {
  /** Directory holding automatic backups, used to offer a restore. */
  backupDir?: string
  /** Asks whether the newest backup should be restored. Defaults to restoring automatically. */
  confirmRestore?: (backupPath: string) => boolean | Promise<boolean>
}

/**
 * Opens the database; when the file is corrupt, moves it aside (never deleting user data),
 * optionally restores the newest automatic backup, and otherwise starts a fresh database.
 */
export async function openDatabaseWithRecovery(
  file: string,
  options: RecoveryOptions = {}
): Promise<{ db: Db; recovery: RecoveryInfo | null }> {
  const logger = options.logger ?? nullLogger
  const now = options.now ?? (() => new Date())
  try {
    return { db: openDatabase(file, options), recovery: null }
  } catch (error) {
    if (!isCorruption(error)) throw error
    logger.error('Database is corrupt; moving it aside', { error })

    const stamp = timestampForFileName(now())
    const corruptPath = `${file}.corrupt-${stamp}`
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${file}${suffix}`
      if (existsSync(from)) renameSync(from, `${corruptPath}${suffix}`)
    }

    const newest = options.backupDir ? listBackups(options.backupDir)[0] : undefined
    if (newest) {
      const shouldRestore = options.confirmRestore ? await options.confirmRestore(newest) : true
      if (shouldRestore) {
        try {
          copyFileSync(newest, file)
          const db = openDatabase(file, options)
          logger.warn('Restored database from backup', { backup: newest })
          return { db, recovery: { corruptPath, restoredFrom: newest } }
        } catch (restoreError) {
          logger.error('Restoring the backup failed; starting fresh', { error: restoreError })
          for (const suffix of ['', '-wal', '-shm']) {
            const bad = `${file}${suffix}`
            if (existsSync(bad)) renameSync(bad, `${corruptPath}.restore-failed${suffix}`)
          }
        }
      }
    }
    return { db: openDatabase(file, options), recovery: { corruptPath, restoredFrom: null } }
  }
}
