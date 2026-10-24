import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS } from '@shared/constants'
import { migrations } from '../../../electron/migrations'
import {
  DatabaseTooNewError,
  migrateDatabase,
  openDatabase,
  openDatabaseWithRecovery
} from '../../../electron/services/database'
import { createHarness, createNote, type Harness } from './helpers'

describe('migrations', () => {
  it('creates the full schema on a fresh database and is idempotent', () => {
    const db = openDatabase(':memory:')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all()
    expect(tables).toEqual(expect.arrayContaining(['notes', 'note_windows', 'reminders', 'settings', 'schema_migrations']))
    expect(migrateDatabase(db).applied).toEqual([])
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(migrations.length)
    db.close()
  })

  it('enforces foreign keys and CHECK constraints', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.prepare("INSERT INTO reminders (id, note_id, scheduled_at, time_zone, local_time, created_at, updated_at) VALUES ('r','ghost','2026-01-01T00:00:00.000Z','UTC','09:00','x','x')").run()
    ).toThrow(/FOREIGN KEY/)
    expect(() =>
      db.prepare("INSERT INTO notes (id, color, created_at, updated_at) VALUES ('n','neon','x','x')").run()
    ).toThrow(/CHECK/)
    db.close()
  })

  it('applies a later migration to an existing database and keeps its data', () => {
    const db = openDatabase(':memory:')
    db.prepare("INSERT INTO notes (id, title, created_at, updated_at) VALUES ('n','keep me','a','a')").run()
    const next = [...migrations, { id: 2, name: 'add-column', sql: 'ALTER TABLE notes ADD COLUMN extra TEXT' }]
    expect(migrateDatabase(db, { migrations: next }).applied).toEqual([2])
    expect(db.prepare("SELECT title FROM notes WHERE id = 'n'").pluck().get()).toBe('keep me')
    db.close()
  })

  it('rolls a failing migration back completely', () => {
    const db = openDatabase(':memory:')
    const bad = [...migrations, { id: 2, name: 'bad', sql: 'CREATE TABLE t(a); INSERT INTO nope VALUES (1);' }]
    expect(() => migrateDatabase(db, { migrations: bad })).toThrow()
    expect(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 't'").pluck().get()).toBe(0)
    db.close()
  })

  it('refuses a database created by a newer version', () => {
    const db = openDatabase(':memory:')
    db.prepare("INSERT INTO schema_migrations VALUES (99, 'future', 'now')").run()
    expect(() => migrateDatabase(db)).toThrow(DatabaseTooNewError)
    db.close()
  })

  it('creates a pre-migration backup of an existing file database', () => {
    const h = createHarness({ file: true })
    try {
      h.core.db.close()
      const file = join(h.dir, 'memofloat.db')
      const db = new Database(file)
      db.pragma('journal_mode = WAL')
      const next = [...migrations, { id: 2, name: 'x', sql: 'CREATE TABLE extra_table(a)' }]
      migrateDatabase(db, { migrations: next, file, backupDir: join(h.dir, 'mig') })
      db.close()
      expect(readdirSync(join(h.dir, 'mig')).some((f) => f.startsWith('pre-migration-'))).toBe(true)
    } finally {
      h.cleanup()
    }
  })
})

describe('corruption recovery', () => {
  let h: Harness
  beforeEach(() => {
    h = createHarness({ file: true })
  })
  afterEach(() => h.cleanup())

  it('moves a corrupt file aside (never deletes it) and starts fresh when there is no backup', async () => {
    h.core.db.close()
    const file = join(h.dir, 'memofloat.db')
    writeFileSync(file, 'this is definitely not a sqlite database'.repeat(200))
    const { db, recovery } = await openDatabaseWithRecovery(file)
    expect(recovery?.restoredFrom).toBeNull()
    expect(existsSync(recovery!.corruptPath)).toBe(true)
    expect(db.prepare('SELECT COUNT(*) FROM notes').pluck().get()).toBe(0)
    db.close()
  })

  it('restores the newest automatic backup when one exists', async () => {
    h.core.notes.create(createNote({ title: 'Saved by backup' }))
    const backupFile = await h.core.backup.createAutomaticBackup()
    expect(backupFile).not.toBeNull()
    h.core.db.close()
    const file = join(h.dir, 'memofloat.db')
    writeFileSync(file, 'garbage'.repeat(500))
    for (const s of ['-wal', '-shm']) if (existsSync(file + s)) copyFileSync(file, file + s + '.x')
    const { db, recovery } = await openDatabaseWithRecovery(file, { backupDir: join(h.dir, 'backups') })
    expect(recovery?.restoredFrom).toBe(backupFile)
    expect(db.prepare('SELECT title FROM notes').pluck().all()).toEqual(['Saved by backup'])
    db.close()
  })

  it('lets the caller decline the restore', async () => {
    await h.core.backup.createAutomaticBackup()
    h.core.db.close()
    const file = join(h.dir, 'memofloat.db')
    writeFileSync(file, 'garbage'.repeat(500))
    const { db, recovery } = await openDatabaseWithRecovery(file, {
      backupDir: join(h.dir, 'backups'),
      confirmRestore: () => false
    })
    expect(recovery?.restoredFrom).toBeNull()
    db.close()
  })

  it('does not swallow non-corruption errors', async () => {
    h.core.db.close()
    const file = join(h.dir, 'future.db')
    const db = new Database(file)
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT); INSERT INTO schema_migrations VALUES (42,'future','x')")
    db.close()
    await expect(openDatabaseWithRecovery(file)).rejects.toThrow(DatabaseTooNewError)
  })
})

describe('settings persistence and validation', () => {
  let h: Harness
  beforeEach(() => {
    h = createHarness()
  })
  afterEach(() => h.cleanup())

  it('returns defaults on first run', () => {
    expect(h.core.repos.settings.getAll()).toEqual({
      theme: 'light',
      defaultNoteColor: 'yellow',
      launchAtLogin: false,
      reducedMotion: 'system',
      notificationsEnabled: true,
      shortcuts: DEFAULT_SHORTCUTS,
      edgeDock: true,
      trayHintShown: false
    })
  })

  it('persists updates and merges partial shortcut changes', () => {
    h.core.repos.settings.update({ theme: 'dark', shortcuts: { newNote: 'Control+Shift+N' } })
    const s = h.core.repos.settings.getAll()
    expect(s.theme).toBe('dark')
    expect(s.shortcuts).toEqual({ ...DEFAULT_SHORTCUTS, newNote: 'Control+Shift+N' })
  })

  it('repairs corrupted, outdated or mistyped stored values without crashing', () => {
    h.core.db.prepare("INSERT INTO settings (key, value) VALUES ('theme', '\"neon\"'), ('launchAtLogin', '\"yes\"'), ('shortcuts', '{\"newNote\": 42}'), ('defaultNoteColor', '\"mint\"')").run()
    const s = h.core.repos.settings.getAll()
    expect(s.theme).toBe('light')
    expect(s.launchAtLogin).toBe(false)
    expect(s.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    expect(s.defaultNoteColor).toBe('mint')
    // and the bad rows were rewritten
    expect(h.core.db.prepare("SELECT value FROM settings WHERE key = 'theme'").pluck().get()).toBe('"light"')
  })

  it('ignores unknown keys written by a future version', () => {
    h.core.db.prepare("INSERT INTO settings (key, value) VALUES ('fromTheFuture', '{\"a\":1}')").run()
    expect(Object.keys(h.core.repos.settings.getAll())).not.toContain('fromTheFuture')
    expect(h.core.db.prepare("SELECT COUNT(*) FROM settings WHERE key = 'fromTheFuture'").pluck().get()).toBe(1)
  })
})
