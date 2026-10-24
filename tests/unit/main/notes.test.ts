import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createNote, patch, query, type Harness } from './helpers'

let h: Harness
beforeEach(() => {
  h = createHarness()
})
afterEach(() => h.cleanup())

describe('note creation, editing and persistence', () => {
  it('creates a note with defaults and the configured default colour', () => {
    h.core.repos.settings.update({ defaultNoteColor: 'mint' })
    const note = h.core.notes.create(createNote({ title: 'Groceries' }))
    expect(note).toMatchObject({ title: 'Groceries', body: '', color: 'mint', isPinned: false, isArchived: false, revision: 1 })
    expect(note.createdAt).toBe('2026-10-14T10:00:00.000Z')
    expect(h.core.notes.get(note.id)).toEqual(note)
  })

  it('automatically rotates through distinct colors when creating multiple notes', () => {
    const n1 = h.core.notes.create(createNote({ title: 'First' }))
    const n2 = h.core.notes.create(createNote({ title: 'Second' }))
    const n3 = h.core.notes.create(createNote({ title: 'Third' }))
    expect(n1.color).not.toBe(n2.color)
    expect(n2.color).not.toBe(n3.color)
    expect(n1.color).not.toBe(n3.color)
  })

  it('edits fields, bumps revision and updated_at only for content edits', () => {
    const note = h.core.notes.create(createNote({ title: 'A' }))
    h.clock.advance(60_000)
    const edited = h.core.notes.update(note.id, patch({ title: 'B', body: 'text' }))
    expect(edited.title).toBe('B')
    expect(edited.revision).toBe(2)
    expect(edited.updatedAt).toBe('2026-10-14T10:01:00.000Z')

    h.clock.advance(60_000)
    const pinned = h.core.notes.update(note.id, patch({ isPinned: true }))
    expect(pinned.isPinned).toBe(true)
    expect(pinned.updatedAt).toBe(edited.updatedAt) // pinning is not an edit
    expect(pinned.revision).toBe(3)
  })

  it('ignores a patch that changes nothing (echoed autosave) and emits no event', () => {
    const note = h.core.notes.create(createNote({ title: 'Same' }))
    let events = 0
    h.core.events.on('note:upserted', () => events++)
    const again = h.core.notes.update(note.id, patch({ title: 'Same' }))
    expect(again.revision).toBe(note.revision)
    expect(events).toBe(0)
  })

  it('persists across a close and reopen of the database file', async () => {
    const file = createHarness({ file: true })
    try {
      const note = file.core.notes.create(createNote({ title: 'Durable', body: 'still here' }))
      file.core.db.close()
      const { openDatabase } = await import('../../../electron/services/database')
      const { NotesRepository } = await import('../../../electron/repositories/notes-repository')
      const reopened = openDatabase(`${file.dir}/memofloat.db`)
      const found = new NotesRepository(reopened).get(note.id)
      expect(found?.title).toBe('Durable')
      expect(found?.body).toBe('still here')
      reopened.close()
    } finally {
      file.cleanup()
    }
  })

  it('throws NOT_FOUND when updating or deleting an unknown note', () => {
    expect(() => h.core.notes.update('missing', patch({ title: 'x' }))).toThrow(/not found/i)
    expect(() => h.core.notes.remove('missing')).toThrow(/not found/i)
  })
})

describe('checklists and tags', () => {
  it('persists checklist items and their checked state', () => {
    const note = h.core.notes.create(
      createNote({
        checklist: [
          { id: 'a', text: 'Milk', checked: false },
          { id: 'b', text: 'Eggs', checked: true }
        ]
      })
    )
    const toggled = h.core.notes.update(
      note.id,
      patch({
        checklist: [
          { id: 'a', text: 'Milk', checked: true },
          { id: 'b', text: 'Eggs', checked: true }
        ]
      })
    )
    expect(toggled.checklist.map((i) => i.checked)).toEqual([true, true])
    const summary = h.core.notes.list(query())[0]
    expect(summary.checklistTotal).toBe(2)
    expect(summary.checklistDone).toBe(2)
  })

  it('normalises and de-duplicates tags', () => {
    const note = h.core.notes.create(createNote({ tags: ['#Work', 'work', ' Home  Office '] }))
    expect(note.tags).toEqual(['work', 'home office'])
  })

  it('rejects checklists with duplicate item ids', () => {
    expect(() =>
      createNote({
        checklist: [
          { id: 'a', text: 'x', checked: false },
          { id: 'a', text: 'y', checked: false }
        ]
      })
    ).toThrow()
  })

  it('lists tag counts for non-archived notes', () => {
    h.core.notes.create(createNote({ tags: ['work', 'urgent'] }))
    h.core.notes.create(createNote({ tags: ['work'] }))
    const archived = h.core.notes.create(createNote({ tags: ['work'] }))
    h.core.notes.update(archived.id, patch({ isArchived: true }))
    expect(h.core.notes.tags()).toEqual([
      { tag: 'work', count: 2 },
      { tag: 'urgent', count: 1 }
    ])
  })
})

describe('search, filtering and sorting', () => {
  beforeEach(() => {
    h.core.notes.create(createNote({ title: 'Banana bread', body: 'flour and sugar', tags: ['recipes'] }))
    h.clock.advance(1000)
    h.core.notes.create(createNote({ title: 'apple pie', body: 'cinnamon', tags: ['recipes', 'dessert'] }))
    h.clock.advance(1000)
    h.core.notes.create(
      createNote({ title: 'Todo', checklist: [{ id: 'x', text: 'buy oat milk', checked: false }], tags: ['home'] })
    )
  })

  it('searches title, body, tags and checklist text, case-insensitively', () => {
    expect(h.core.notes.list(query({ search: 'BANANA' })).map((n) => n.title)).toEqual(['Banana bread'])
    expect(h.core.notes.list(query({ search: 'cinnamon' })).map((n) => n.title)).toEqual(['apple pie'])
    expect(h.core.notes.list(query({ search: 'dessert' })).map((n) => n.title)).toEqual(['apple pie'])
    expect(h.core.notes.list(query({ search: 'oat milk' })).map((n) => n.title)).toEqual(['Todo'])
  })

  it('requires every search term to match', () => {
    expect(h.core.notes.list(query({ search: 'apple cinnamon' }))).toHaveLength(1)
    expect(h.core.notes.list(query({ search: 'apple flour' }))).toHaveLength(0)
  })

  it('treats LIKE wildcards and quotes in the search text literally (no injection)', () => {
    expect(h.core.notes.list(query({ search: '%' }))).toHaveLength(0)
    expect(h.core.notes.list(query({ search: '_____' }))).toHaveLength(0)
    expect(h.core.notes.list(query({ search: "x' OR '1'='1" }))).toHaveLength(0)
    expect(h.core.notes.list(query())).toHaveLength(3) // table intact
  })

  it('filters by tag', () => {
    expect(h.core.notes.list(query({ tag: 'recipes' }))).toHaveLength(2)
    expect(h.core.notes.list(query({ tag: 'home' }))).toHaveLength(1)
  })

  it('sorts by updated, created and title', () => {
    expect(h.core.notes.list(query({ sort: 'updated' })).map((n) => n.title)).toEqual(['Todo', 'apple pie', 'Banana bread'])
    expect(h.core.notes.list(query({ sort: 'created', order: 'asc' })).map((n) => n.title)).toEqual([
      'Banana bread',
      'apple pie',
      'Todo'
    ])
    expect(h.core.notes.list(query({ sort: 'title' })).map((n) => n.title)).toEqual(['apple pie', 'Banana bread', 'Todo'])
    expect(h.core.notes.list(query({ sort: 'title', order: 'desc' })).map((n) => n.title)).toEqual([
      'Todo',
      'Banana bread',
      'apple pie'
    ])
  })

  it('shows pinned notes first in the all view and filters the pinned view', () => {
    const banana = h.core.notes.list(query({ search: 'banana' }))[0]
    h.core.notes.update(banana.id, patch({ isPinned: true }))
    expect(h.core.notes.list(query())[0].title).toBe('Banana bread')
    expect(h.core.notes.list(query({ view: 'pinned' })).map((n) => n.title)).toEqual(['Banana bread'])
  })

  it('pages results with limit and offset', () => {
    expect(h.core.notes.list(query({ limit: 2 }))).toHaveLength(2)
    expect(h.core.notes.list(query({ limit: 2, offset: 2 }))).toHaveLength(1)
  })

  it('builds a bounded preview', () => {
    h.core.notes.create(createNote({ title: 'long', body: 'x'.repeat(5000) }))
    const long = h.core.notes.list(query({ search: 'long' }))[0]
    expect(long.preview.length).toBe(400)
  })
})

describe('archive and deletion', () => {
  it('archives, hides from All, shows in Archived and restores', () => {
    const note = h.core.notes.create(createNote({ title: 'Old' }))
    h.core.notes.update(note.id, patch({ isArchived: true }))
    expect(h.core.notes.list(query())).toHaveLength(0)
    expect(h.core.notes.list(query({ view: 'archived' })).map((n) => n.id)).toEqual([note.id])
    expect(h.core.notes.stats()).toMatchObject({ all: 0, archived: 1 })

    h.core.notes.update(note.id, patch({ isArchived: false }))
    expect(h.core.notes.list(query())).toHaveLength(1)
    expect(h.core.notes.list(query({ view: 'archived' }))).toHaveLength(0)
  })

  it('deletes permanently and cascades to reminders and window state', () => {
    const note = h.core.notes.create(createNote({ title: 'Doomed' }))
    h.clock.advance(0)
    h.core.reminders.create({ noteId: note.id, scheduledAt: '2026-10-15T10:00:00.000Z', recurrence: 'none' })
    h.core.repos.windowStates.upsert({
      noteId: note.id,
      x: 10,
      y: 10,
      width: 300,
      height: 300,
      alwaysOnTop: false,
      lastVisibleState: 'visible'
    })
    const deleted: string[] = []
    h.core.events.on('note:deleted', (e) => deleted.push(e.noteId))
    h.core.notes.remove(note.id)
    expect(deleted).toEqual([note.id])
    expect(h.core.repos.notes.get(note.id)).toBeNull()
    expect(h.core.repos.reminders.forNote(note.id)).toEqual([])
    expect(h.core.repos.windowStates.get(note.id)).toBeNull()
  })

  it('counts stats for sidebar badges', () => {
    const a = h.core.notes.create(createNote({ isPinned: true }))
    h.core.notes.create(createNote())
    h.core.reminders.create({ noteId: a.id, scheduledAt: '2026-10-14T18:00:00.000Z', recurrence: 'none' })
    expect(h.core.notes.stats()).toMatchObject({ all: 2, pinned: 1, today: 1, reminders: 1, overdue: 0 })
  })
})
