import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EXPORT_FORMAT, EXPORT_VERSION } from '@shared/constants'
import { openDatabase } from '../../../electron/services/database'
import { NotesRepository } from '../../../electron/repositories/notes-repository'
import { createHarness, createNote, patch, query, type Harness } from './helpers'

let h: Harness
beforeEach(() => {
  h = createHarness({ file: true })
})
afterEach(() => h.cleanup())

function seed() {
  const a = h.core.notes.create(createNote({ title: 'Alpha', body: 'first', tags: ['x'], checklist: [{ id: 'c1', text: 'item', checked: true }] }))
  h.clock.advance(1000)
  const b = h.core.notes.create(createNote({ title: 'Beta' }))
  h.core.reminders.create({ noteId: a.id, scheduledAt: '2026-10-15T09:00:00.000Z', recurrence: 'weekly' })
  return { a, b }
}

describe('JSON export', () => {
  it('exports notes and reminders in the documented format', () => {
    const { a } = seed()
    const data = JSON.parse(h.core.backup.exportJson())
    expect(data).toMatchObject({ format: EXPORT_FORMAT, version: EXPORT_VERSION })
    expect(data.notes).toHaveLength(2)
    expect(data.reminders).toHaveLength(1)
    expect(data.notes.find((n: { id: string }) => n.id === a.id).checklist[0]).toEqual({ id: 'c1', text: 'item', checked: true })
  })

  it('round-trips: an export of the same database previews as "nothing to do"', () => {
    seed()
    const text = h.core.backup.exportJson()
    const preview = h.core.backup.previewImport(h.core.backup.parseImport(text), 'self.json')
    expect(preview.notes).toEqual({ total: 2, added: 0, conflicts: 0 })
    expect(preview.reminders.added).toBe(0)
  })
})

describe('import validation', () => {
  it.each([
    ['not json', '{nope', /not valid JSON/i],
    ['wrong format', JSON.stringify({ format: 'other' }), /not a MemoFloat export/i],
    ['newer version', JSON.stringify({ format: EXPORT_FORMAT, version: 99 }), /newer version/i],
    ['missing fields', JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: '2026-01-01T00:00:00.000Z', notes: [{ id: 'a' }], reminders: [] }), /damaged or incompatible/i]
  ])('rejects %s', (_name, text, message) => {
    expect(() => h.core.backup.parseImport(text)).toThrow(message)
  })

  it('rejects duplicate ids, bad colours and malformed timestamps', () => {
    const base = {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      reminders: [] as unknown[]
    }
    const note = (over: object = {}) => ({
      id: 'n1', title: 't', body: '', color: 'yellow', tags: [], checklist: [], isPinned: false, isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over
    })
    expect(() => h.core.backup.parseImport(JSON.stringify({ ...base, notes: [note(), note()] }))).toThrow(/duplicate/i)
    expect(() => h.core.backup.parseImport(JSON.stringify({ ...base, notes: [note({ color: 'neon' })] }))).toThrow(/damaged/i)
    expect(() => h.core.backup.parseImport(JSON.stringify({ ...base, notes: [note({ createdAt: 'yesterday' })] }))).toThrow(/damaged/i)
    expect(() => h.core.backup.parseImport(JSON.stringify({ ...base, notes: [note({ id: 'bad id!' })] }))).toThrow(/damaged/i)
  })

  it('accepts a UTF-8 BOM', () => {
    seed()
    expect(() => h.core.backup.parseImport('﻿' + h.core.backup.exportJson())).not.toThrow()
  })
})

describe('import conflicts and commit', () => {
  /** Exports the current database, then edits note A locally so the export conflicts with it. */
  function conflictingExport() {
    const { a } = seed()
    const text = h.core.backup.exportJson()
    h.clock.advance(60_000)
    h.core.notes.update(a.id, patch({ title: 'Alpha (edited locally)' }))
    return { a, file: h.core.backup.parseImport(text) }
  }

  it('reports conflicts and added notes in the preview, without changing anything', () => {
    const { file } = conflictingExport()
    h.core.notes.create(createNote({ title: 'Local only' }))
    const preview = h.core.backup.previewImport(file, 'backup.json')
    expect(preview.notes).toMatchObject({ total: 2, added: 0, conflicts: 1 })
    expect(preview.conflicts[0]).toMatchObject({ title: 'Alpha' })
    expect(h.core.notes.list(query()).map((n) => n.title).sort()).toEqual(['Alpha (edited locally)', 'Beta', 'Local only'])
  })

  it('"skip" keeps local versions', async () => {
    const { a, file } = conflictingExport()
    const preview = h.core.backup.previewImport(file, 'f.json')
    const result = await h.core.backup.commitImport(preview.token, 'skip')
    expect(result.notesOverwritten).toBe(0)
    expect(h.core.notes.get(a.id).title).toBe('Alpha (edited locally)')
  })

  it('"overwrite" replaces local versions', async () => {
    const { a, file } = conflictingExport()
    const preview = h.core.backup.previewImport(file, 'f.json')
    const result = await h.core.backup.commitImport(preview.token, 'overwrite')
    expect(result.notesOverwritten).toBe(1)
    expect(h.core.notes.get(a.id).title).toBe('Alpha')
  })

  it('"newer" only replaces older local notes', async () => {
    const { a, file } = conflictingExport() // local is newer than the file
    const preview = h.core.backup.previewImport(file, 'f.json')
    const result = await h.core.backup.commitImport(preview.token, 'newer')
    expect(result.notesOverwritten).toBe(0)
    expect(h.core.notes.get(a.id).title).toBe('Alpha (edited locally)')
  })

  it('"keepBoth" imports a copy with a new id and attaches reminders to the copy', async () => {
    const { a, file } = conflictingExport()
    const before = h.core.repos.reminders.exportAll().length
    const preview = h.core.backup.previewImport(file, 'f.json')
    const result = await h.core.backup.commitImport(preview.token, 'keepBoth')
    expect(result.notesAdded).toBe(1)
    const titles = h.core.notes.list(query()).map((n) => n.title).sort()
    expect(titles).toEqual(['Alpha', 'Alpha (edited locally)', 'Beta'])
    expect(h.core.notes.get(a.id).title).toBe('Alpha (edited locally)')
    expect(h.core.repos.reminders.exportAll().length).toBe(before + 1)
  })

  it('creates a safety backup before importing and can open it as a database', async () => {
    const { file } = conflictingExport()
    const preview = h.core.backup.previewImport(file, 'f.json')
    const result = await h.core.backup.commitImport(preview.token, 'overwrite')
    expect(result.backupPath && existsSync(result.backupPath)).toBe(true)
    const db = openDatabase(result.backupPath as string)
    expect(new NotesRepository(db).list(query(), { nowIso: '2026-10-14T10:00:00.000Z', startOfTomorrowIso: '2026-10-15T00:00:00.000Z' }).map((n) => n.title).sort()).toEqual(['Alpha (edited locally)', 'Beta'])
    db.close()
  })

  it('is atomic: a failure part-way leaves the database untouched', async () => {
    seed()
    const file = h.core.backup.parseImport(h.core.backup.exportJson())
    // second note collides on a CHECK constraint only at insert time
    const doomed = { ...file, notes: [{ ...file.notes[0], id: 'fresh-1', color: 'yellow' as const }, { ...file.notes[1], id: 'fresh-2', color: 'yellow' as const }] }
    const preview = h.core.backup.previewImport(doomed, 'f.json')
    const original = h.core.db.transaction.bind(h.core.db)
    let calls = 0
    // make the 2nd insert fail
    const repo = h.core.repos.notes
    const insert = repo.insertImported.bind(repo)
    repo.insertImported = (note) => {
      if (++calls === 2) throw new Error('boom')
      insert(note)
    }
    await expect(h.core.backup.commitImport(preview.token, 'skip')).rejects.toThrow('boom')
    repo.insertImported = insert
    expect(h.core.notes.list(query())).toHaveLength(2) // fresh-1 was rolled back
    expect(original).toBeTypeOf('function')
  })

  it('rejects a stale or unknown token', async () => {
    seed()
    await expect(h.core.backup.commitImport('does-not-exist', 'skip')).rejects.toThrow(/no longer available/i)
    const preview = h.core.backup.previewImport(h.core.backup.parseImport(h.core.backup.exportJson()), 'f.json')
    h.clock.advance(11 * 60_000)
    await expect(h.core.backup.commitImport(preview.token, 'skip')).rejects.toThrow(/expired/i)
  })

  it('warns about and skips reminders that point at unknown notes', () => {
    const file = h.core.backup.parseImport(
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        notes: [],
        reminders: [
          {
            id: 'r1', noteId: 'ghost', scheduledAt: '2026-12-01T09:00:00.000Z', recurrence: 'none', timeZone: 'UTC',
            localTime: '09:00', status: 'scheduled', lastNotifiedOccurrence: null,
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    )
    const preview = h.core.backup.previewImport(file, 'f.json')
    expect(preview.reminders).toMatchObject({ total: 1, added: 0, skipped: 1 })
    expect(preview.warnings[0]).toMatch(/skipped/)
  })

  it('imports into an empty database (restore scenario) including reminders', async () => {
    seed()
    const text = h.core.backup.exportJson()
    const other = createHarness({ file: true })
    try {
      const preview = other.core.backup.previewImport(other.core.backup.parseImport(text), 'f.json')
      const result = await other.core.backup.commitImport(preview.token, 'skip')
      expect(result).toMatchObject({ notesAdded: 2, remindersAdded: 1 })
      expect(other.core.reminders.list({ scope: 'upcoming' })).toHaveLength(1)
    } finally {
      other.cleanup()
    }
  })
})

describe('database backup', () => {
  it('writes a consistent, openable copy of the live database', async () => {
    seed()
    const target = join(h.dir, 'copy.db')
    await h.core.backup.backupDatabaseTo(target)
    const db = openDatabase(target)
    expect(db.prepare('SELECT COUNT(*) FROM notes').pluck().get()).toBe(2)
    db.close()
  })

  it('keeps a rolling set of automatic backups, at most one per interval', async () => {
    seed()
    expect(await h.core.backup.createAutomaticBackup({ keep: 2 })).not.toBeNull()
    expect(await h.core.backup.createAutomaticBackup({ keep: 2 })).toBeNull() // too soon
    for (let i = 0; i < 3; i++) {
      h.clock.advance(25 * 3_600_000)
      writeFileSync(join(h.dir, 'noop'), '')
      await h.core.backup.createAutomaticBackup({ keep: 2, minIntervalMs: 0 })
    }
    const files = readdirSync(join(h.dir, 'backups')).filter((f) => f.startsWith('auto-'))
    expect(files.length).toBeLessThanOrEqual(2)
  })
})
