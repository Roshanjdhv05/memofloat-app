import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { EXPORT_FORMAT, EXPORT_VERSION, LIMITS } from '@shared/constants'
import { exportFileSchema, type ExportFile, type ExportedNote, type ImportStrategy } from '@shared/schemas'
import type { ImportConflict, ImportPreview, ImportResult } from '@shared/types'
import type { NotesRepository } from '../repositories/notes-repository'
import type { RemindersRepository } from '../repositories/reminders-repository'
import { timestampForFileName, type Db } from './database'
import { AppError, validation } from './errors'
import type { Clock, EventBus } from './events'
import { nullLogger, type Logger } from './logger'

const PENDING_TTL_MS = 10 * 60 * 1000

interface Pending {
  token: string
  file: ExportFile
  fileName: string
  expiresAt: number
}

export interface BackupServiceDeps {
  db: Db
  notes: NotesRepository
  reminders: RemindersRepository
  events: EventBus
  clock: Clock
  /** Directory for automatic and pre-import safety backups. */
  backupDir: string
  logger?: Logger
}

export class BackupService {
  private pending: Pending | null = null
  private readonly logger: Logger

  constructor(private readonly deps: BackupServiceDeps) {
    this.logger = deps.logger ?? nullLogger
  }

  /* ------------------------------------------------------------------ export */

  buildExport(): ExportFile {
    // A single read transaction gives a consistent snapshot of notes and reminders.
    return this.deps.db.transaction(() => ({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: this.deps.clock().toISOString(),
      notes: this.deps.notes.exportAll(),
      reminders: this.deps.reminders.exportAll()
    }))() as ExportFile
  }

  exportJson(): string {
    return JSON.stringify(this.buildExport(), null, 2)
  }

  /** Consistent online copy of the live database (safe while the app is running, WAL included). */
  async backupDatabaseTo(destination: string): Promise<void> {
    await this.deps.db.backup(destination)
    this.logger.info('Database backup written')
  }

  /**
   * Keeps a small rolling set of automatic backups (at most one per ~day). They are what the
   * corruption-recovery path restores from.
   */
  async createAutomaticBackup(options: { keep?: number; minIntervalMs?: number } = {}): Promise<string | null> {
    const keep = options.keep ?? 7
    const minInterval = options.minIntervalMs ?? 20 * 60 * 60 * 1000
    mkdirSync(this.deps.backupDir, { recursive: true })
    const existing = this.listAutomatic()
    const newest = existing[0]
    const now = this.deps.clock()
    if (newest && now.getTime() - newest.mtime < minInterval) return null
    const target = join(this.deps.backupDir, `auto-${timestampForFileName(now)}.db`)
    await this.deps.db.backup(target)
    for (const old of this.listAutomatic().slice(keep)) {
      try {
        unlinkSync(old.path)
      } catch {
        // ignore
      }
    }
    return target
  }

  private listAutomatic(): Array<{ path: string; mtime: number }> {
    if (!existsSync(this.deps.backupDir)) return []
    return readdirSync(this.deps.backupDir)
      .filter((name) => name.startsWith('auto-') && name.endsWith('.db'))
      .map((name) => {
        const path = join(this.deps.backupDir, name)
        return { path, mtime: statSync(path).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  }

  /* ------------------------------------------------------------------ import: parse + preview */

  /** Parses and validates import text. Throws a user-presentable AppError when the file is unusable. */
  parseImport(text: string): ExportFile {
    if (text.length > LIMITS.importMaxBytes) throw validation('This file is too large to import.')
    let json: unknown
    try {
      json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    } catch {
      throw validation('This file is not valid JSON.')
    }
    if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== EXPORT_FORMAT) {
      throw validation('This is not a MemoFloat export file.')
    }
    const version = (json as { version?: unknown }).version
    if (typeof version === 'number' && version > EXPORT_VERSION) {
      throw validation('This export was created by a newer version of MemoFloat. Please update MemoFloat to import it.')
    }
    const parsed = exportFileSchema.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue?.path.length ? ` (${issue.path.slice(0, 3).join(' › ')})` : ''
      throw validation(`The export file is damaged or incompatible${where}: ${issue?.message ?? 'invalid data'}.`)
    }
    const ids = new Set<string>()
    for (const note of parsed.data.notes) {
      if (ids.has(note.id)) throw validation('The export file contains duplicate note ids.')
      ids.add(note.id)
    }
    const reminderIds = new Set<string>()
    for (const reminder of parsed.data.reminders) {
      if (reminderIds.has(reminder.id)) throw validation('The export file contains duplicate reminder ids.')
      reminderIds.add(reminder.id)
    }
    return parsed.data
  }

  previewImport(file: ExportFile, fileName: string): ImportPreview {
    const existing = this.deps.notes.getUpdatedAtMap(file.notes.map((n) => n.id))
    const conflicts: ImportConflict[] = []
    let added = 0
    for (const note of file.notes) {
      const current = existing.get(note.id)
      if (current === undefined) added += 1
      else if (current !== note.updatedAt) {
        conflicts.push({ id: note.id, title: note.title, existingUpdatedAt: current, incomingUpdatedAt: note.updatedAt })
      }
    }

    const noteIds = new Set(file.notes.map((n) => n.id))
    const warnings: string[] = []
    const orphaned = file.reminders.filter((r) => !noteIds.has(r.noteId) && !this.deps.notes.exists(r.noteId))
    if (orphaned.length > 0) {
      warnings.push(`${orphaned.length} reminder(s) refer to notes that are not in the file and will be skipped.`)
    }
    const existingReminders = this.deps.reminders.existingIds(file.reminders.map((r) => r.id))
    const remindersAdded = file.reminders.filter((r) => !existingReminders.has(r.id) && !orphaned.includes(r)).length

    const token = randomUUID()
    this.pending = { token, file, fileName, expiresAt: this.deps.clock().getTime() + PENDING_TTL_MS }
    return {
      token,
      fileName,
      exportedAt: file.exportedAt,
      notes: { total: file.notes.length, added, conflicts: conflicts.length },
      reminders: { total: file.reminders.length, added: remindersAdded, skipped: orphaned.length },
      conflicts: conflicts.slice(0, 200),
      warnings
    }
  }

  /* ------------------------------------------------------------------ import: commit */

  async commitImport(token: string, strategy: ImportStrategy): Promise<ImportResult> {
    const pending = this.pending
    if (!pending || pending.token !== token) {
      throw new AppError('CONFLICT', 'This import preview is no longer available. Choose the file again.')
    }
    if (pending.expiresAt < this.deps.clock().getTime()) {
      this.discardPending()
      throw new AppError('CONFLICT', 'This import preview expired. Choose the file again.')
    }

    // Safety net: snapshot the database first so an import can always be rolled back by hand.
    let backupPath: string
    try {
      mkdirSync(this.deps.backupDir, { recursive: true })
      backupPath = join(this.deps.backupDir, `pre-import-${timestampForFileName(this.deps.clock())}.db`)
      await this.deps.db.backup(backupPath)
    } catch (error) {
      this.logger.error('Pre-import backup failed; aborting import', { error })
      throw new AppError('PERSISTENCE', 'MemoFloat could not create a safety backup, so nothing was imported.')
    }

    const file = pending.file
    const result: ImportResult = {
      notesAdded: 0,
      notesOverwritten: 0,
      notesSkipped: 0,
      remindersAdded: 0,
      backupPath
    }

    this.deps.db.transaction(() => {
      const existing = this.deps.notes.getUpdatedAtMap(file.notes.map((n) => n.id))
      // Maps incoming note ids to the id they have after import (undefined = not imported).
      const resolved = new Map<string, string>()

      for (const note of file.notes) {
        const current = existing.get(note.id)
        if (current === undefined) {
          this.deps.notes.insertImported(note)
          resolved.set(note.id, note.id)
          result.notesAdded += 1
        } else if (current === note.updatedAt) {
          resolved.set(note.id, note.id)
          result.notesSkipped += 1
        } else {
          this.resolveConflict(note, current, strategy, resolved, result)
        }
      }

      const keptIds = new Set(file.notes.filter((n) => resolved.get(n.id) === n.id).map((n) => n.id))
      const copiedIds = new Map([...resolved].filter(([from, to]) => from !== to))
      const existingReminderIds = this.deps.reminders.existingIds(file.reminders.map((r) => r.id))

      for (const reminder of file.reminders) {
        const target = resolved.get(reminder.noteId)
        const noteKnown = target !== undefined || this.deps.notes.exists(reminder.noteId)
        if (!noteKnown) continue
        if (target === undefined) {
          // Note was skipped on purpose (kept local version): leave its reminders alone too.
          continue
        }
        if (copiedIds.has(reminder.noteId)) {
          // "Keep both": reminders follow the copy and get fresh ids so they cannot collide.
          this.deps.reminders.upsertImported({ ...reminder, id: randomUUID(), noteId: target })
          result.remindersAdded += 1
        } else if (keptIds.has(reminder.noteId)) {
          if (!existingReminderIds.has(reminder.id)) result.remindersAdded += 1
          this.deps.reminders.upsertImported(reminder)
        }
      }
    })()

    this.discardPending()
    this.deps.events.emit('reminders:changed', { noteId: null })
    this.deps.events.emit('data:imported', {})
    this.logger.info('Import completed', { ...result, backupPath: undefined })
    return result
  }

  private resolveConflict(
    note: ExportedNote,
    currentUpdatedAt: string,
    strategy: ImportStrategy,
    resolved: Map<string, string>,
    result: ImportResult
  ): void {
    switch (strategy) {
      case 'skip':
        result.notesSkipped += 1
        return
      case 'overwrite':
        this.deps.notes.replaceImported(note)
        resolved.set(note.id, note.id)
        result.notesOverwritten += 1
        return
      case 'newer':
        if (note.updatedAt > currentUpdatedAt) {
          this.deps.notes.replaceImported(note)
          resolved.set(note.id, note.id)
          result.notesOverwritten += 1
        } else {
          result.notesSkipped += 1
        }
        return
      case 'keepBoth': {
        const copyId = randomUUID()
        this.deps.notes.insertImported({ ...note, id: copyId })
        resolved.set(note.id, copyId)
        result.notesAdded += 1
        return
      }
    }
  }

  discardPending(): void {
    this.pending = null
  }
}
