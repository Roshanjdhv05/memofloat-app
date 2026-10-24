import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { NoteColor } from '@shared/constants'
import type { notePatchSchema, noteCreateSchema, noteQuerySchema, ExportedNote } from '@shared/schemas'
import type { AppStats, ChecklistItem, Note, NoteSummary, RecurrenceRule, TagCount } from '@shared/types'
import type { Db } from '../services/database'

export type ParsedNoteCreate = z.output<typeof noteCreateSchema>
export type ParsedNotePatch = z.output<typeof notePatchSchema>
export type ParsedNoteQuery = z.output<typeof noteQuerySchema>

interface NoteRow {
  id: string
  title: string
  body: string
  color: NoteColor
  tags: string
  checklist: string
  is_pinned: number
  is_archived: number
  revision: number
  created_at: string
  updated_at: string
}

interface SummaryRow {
  id: string
  title: string
  preview: string
  color: NoteColor
  tags: string
  checklist: string
  is_pinned: number
  is_archived: number
  created_at: string
  updated_at: string
  next_reminder: string | null
}

export interface ListContext {
  /** Start of the next local day (UTC ISO). Defines which reminders count as "today". */
  startOfTomorrowIso: string
  nowIso: string
}

const PREVIEW_CHARS = 400
const CHECKLIST_PREVIEW_ITEMS = 4

function parseJson<T>(text: string, fallback: T): T {
  try {
    const value = JSON.parse(text) as unknown
    return (Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value ?? fallback)) as T
  } catch {
    return fallback
  }
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

const ORDER_SQL: Record<ParsedNoteQuery['sort'], { asc: string; desc: string; defaultOrder: 'asc' | 'desc' }> = {
  updated: { asc: 'n.updated_at ASC, n.id ASC', desc: 'n.updated_at DESC, n.id DESC', defaultOrder: 'desc' },
  created: { asc: 'n.created_at ASC, n.id ASC', desc: 'n.created_at DESC, n.id DESC', defaultOrder: 'desc' },
  title: {
    asc: "n.title COLLATE NOCASE ASC, n.created_at DESC, n.id ASC",
    desc: "n.title COLLATE NOCASE DESC, n.created_at DESC, n.id DESC",
    defaultOrder: 'asc'
  }
}

export class NotesRepository {
  constructor(private readonly db: Db) {}

  /* ------------------------------------------------------------------ mapping */

  private toNote(row: NoteRow): Note {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      color: row.color,
      tags: parseJson<string[]>(row.tags, []),
      checklist: parseJson<ChecklistItem[]>(row.checklist, []),
      isPinned: row.is_pinned === 1,
      isArchived: row.is_archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision
    }
  }

  private toSummary(row: SummaryRow, nowIso: string): NoteSummary {
    const checklist = parseJson<ChecklistItem[]>(row.checklist, [])
    let nextReminder: NoteSummary['nextReminder'] = null
    if (row.next_reminder) {
      const parsed = parseJson<{ id: string; scheduledAt: string; recurrence: RecurrenceRule } | null>(
        row.next_reminder,
        null
      )
      if (parsed) nextReminder = { ...parsed, overdue: parsed.scheduledAt < nowIso }
    }
    return {
      id: row.id,
      title: row.title,
      preview: row.preview,
      color: row.color,
      tags: parseJson<string[]>(row.tags, []),
      checklistTotal: checklist.length,
      checklistDone: checklist.filter((item) => item.checked).length,
      checklistPreview: checklist.slice(0, CHECKLIST_PREVIEW_ITEMS),
      isPinned: row.is_pinned === 1,
      isArchived: row.is_archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      nextReminder
    }
  }

  private getRow(id: string): NoteRow | undefined {
    return this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  }

  /* ------------------------------------------------------------------ reads */

  get(id: string): Note | null {
    const row = this.getRow(id)
    return row ? this.toNote(row) : null
  }

  exists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM notes WHERE id = ?').pluck().get(id) !== undefined
  }

  latestColor(): NoteColor | null {
    const row = this.db.prepare('SELECT color FROM notes ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1').get() as { color: NoteColor } | undefined
    return row?.color ?? null
  }

  /**
   * Lists note summaries. Every user-controlled value is bound as a parameter; the only
   * strings interpolated into SQL are fixed fragments chosen from the whitelists above.
   */
  list(query: ParsedNoteQuery, context: ListContext): NoteSummary[] {
    const where: string[] = []
    const params: unknown[] = []

    switch (query.view) {
      case 'all':
        where.push('n.is_archived = 0')
        break
      case 'pinned':
        where.push('n.is_archived = 0 AND n.is_pinned = 1')
        break
      case 'archived':
        where.push('n.is_archived = 1')
        break
      case 'today':
        where.push(
          "n.is_archived = 0 AND EXISTS (SELECT 1 FROM reminders r WHERE r.note_id = n.id AND r.status = 'scheduled' AND r.scheduled_at < ?)"
        )
        params.push(context.startOfTomorrowIso)
        break
    }

    const terms = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 8)
    for (const term of terms) {
      const pattern = `%${escapeLike(term)}%`
      where.push(
        `(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\'` +
          ` OR EXISTS (SELECT 1 FROM json_each(n.tags) t WHERE t.value LIKE ? ESCAPE '\\')` +
          ` OR EXISTS (SELECT 1 FROM json_each(n.checklist) c WHERE json_extract(c.value, '$.text') LIKE ? ESCAPE '\\'))`
      )
      params.push(pattern, pattern, pattern, pattern)
    }

    if (query.tag) {
      where.push('EXISTS (SELECT 1 FROM json_each(n.tags) t WHERE t.value = ?)')
      params.push(query.tag)
    }

    const sort = ORDER_SQL[query.sort]
    const order = query.order ?? sort.defaultOrder
    const pinnedFirst = query.view === 'all' || query.view === 'today' ? 'n.is_pinned DESC, ' : ''

    const sql = `
      SELECT n.id, n.title, substr(n.body, 1, ${PREVIEW_CHARS}) AS preview, n.color, n.tags, n.checklist,
             n.is_pinned, n.is_archived, n.created_at, n.updated_at,
             (SELECT json_object('id', r.id, 'scheduledAt', r.scheduled_at, 'recurrence', r.recurrence_rule)
                FROM reminders r
               WHERE r.note_id = n.id AND r.status = 'scheduled'
               ORDER BY r.scheduled_at ASC LIMIT 1) AS next_reminder
        FROM notes n
       WHERE ${where.join(' AND ')}
       ORDER BY ${pinnedFirst}${sort[order]}
       LIMIT ? OFFSET ?`
    params.push(query.limit, query.offset)

    const rows = this.db.prepare(sql).all(...params) as SummaryRow[]
    return rows.map((row) => this.toSummary(row, context.nowIso))
  }

  tags(): TagCount[] {
    return this.db
      .prepare(
        `SELECT t.value AS tag, COUNT(*) AS count
           FROM notes n, json_each(n.tags) t
          WHERE n.is_archived = 0
          GROUP BY t.value
          ORDER BY count DESC, tag ASC
          LIMIT 200`
      )
      .all() as TagCount[]
  }

  stats(context: ListContext): AppStats {
    const counts = this.db
      .prepare(
        `SELECT COALESCE(SUM(is_archived = 0), 0) AS all_count,
                COALESCE(SUM(is_archived = 0 AND is_pinned = 1), 0) AS pinned,
                COALESCE(SUM(is_archived = 1), 0) AS archived
           FROM notes`
      )
      .get() as { all_count: number; pinned: number; archived: number }
    const today = this.db
      .prepare(
        `SELECT COUNT(*) FROM notes n
          WHERE n.is_archived = 0
            AND EXISTS (SELECT 1 FROM reminders r WHERE r.note_id = n.id AND r.status = 'scheduled' AND r.scheduled_at < ?)`
      )
      .pluck()
      .get(context.startOfTomorrowIso) as number
    const reminders = this.db.prepare("SELECT COUNT(*) FROM reminders WHERE status = 'scheduled'").pluck().get() as number
    const overdue = this.db
      .prepare("SELECT COUNT(*) FROM reminders WHERE status = 'scheduled' AND scheduled_at < ?")
      .pluck()
      .get(context.nowIso) as number
    return {
      all: counts.all_count,
      pinned: counts.pinned,
      today,
      archived: counts.archived,
      reminders,
      overdue
    }
  }

  /* ------------------------------------------------------------------ writes */

  create(input: ParsedNoteCreate, color: NoteColor, now: Date): Note {
    const id = randomUUID()
    const iso = now.toISOString()
    this.db
      .prepare(
        `INSERT INTO notes (id, title, body, color, tags, checklist, is_pinned, is_archived, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.body,
        color,
        JSON.stringify(input.tags),
        JSON.stringify(input.checklist),
        input.isPinned ? 1 : 0,
        iso,
        iso
      )
    return this.get(id) as Note
  }

  /**
   * Applies a partial update atomically. Returns null for an unknown note and `changed: false`
   * when the patch matches what is already stored (so an echoed autosave never bumps the
   * revision or triggers another change event).
   *
   * `updated_at` moves only for content edits; pinning and archiving are not "edits".
   */
  update(id: string, patch: ParsedNotePatch, now: Date): { note: Note; changed: boolean } | null {
    const apply = this.db.transaction((): { note: Note; changed: boolean } | null => {
      const row = this.getRow(id)
      if (!row) return null

      // Column fragments below are fixed literals; all values are bound parameters.
      const sets: string[] = []
      const values: unknown[] = []
      let contentChanged = false

      if (patch.title !== undefined && patch.title !== row.title) {
        sets.push('title = ?')
        values.push(patch.title)
        contentChanged = true
      }
      if (patch.body !== undefined && patch.body !== row.body) {
        sets.push('body = ?')
        values.push(patch.body)
        contentChanged = true
      }
      if (patch.color !== undefined && patch.color !== row.color) {
        sets.push('color = ?')
        values.push(patch.color)
        contentChanged = true
      }
      if (patch.tags !== undefined) {
        const next = JSON.stringify(patch.tags)
        if (next !== JSON.stringify(parseJson<string[]>(row.tags, []))) {
          sets.push('tags = ?')
          values.push(next)
          contentChanged = true
        }
      }
      if (patch.checklist !== undefined) {
        const next = JSON.stringify(patch.checklist)
        if (next !== JSON.stringify(parseJson<ChecklistItem[]>(row.checklist, []))) {
          sets.push('checklist = ?')
          values.push(next)
          contentChanged = true
        }
      }
      if (patch.isPinned !== undefined && (patch.isPinned ? 1 : 0) !== row.is_pinned) {
        sets.push('is_pinned = ?')
        values.push(patch.isPinned ? 1 : 0)
      }
      if (patch.isArchived !== undefined && (patch.isArchived ? 1 : 0) !== row.is_archived) {
        sets.push('is_archived = ?')
        values.push(patch.isArchived ? 1 : 0)
      }

      if (sets.length === 0) return { note: this.toNote(row), changed: false }

      sets.push('revision = revision + 1')
      if (contentChanged) {
        sets.push('updated_at = ?')
        values.push(now.toISOString())
      }
      this.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
      return { note: this.get(id) as Note, changed: true }
    })
    return apply()
  }

  /** Permanently deletes a note; its reminders and window state are removed by foreign-key cascade. */
  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0
  }

  /* ------------------------------------------------------------------ import / export support */

  exportAll(): ExportedNote[] {
    const rows = this.db.prepare('SELECT * FROM notes ORDER BY created_at ASC, id ASC').all() as NoteRow[]
    return rows.map((row) => {
      const note = this.toNote(row)
      return {
        id: note.id,
        title: note.title,
        body: note.body,
        color: note.color,
        tags: note.tags,
        checklist: note.checklist,
        isPinned: note.isPinned,
        isArchived: note.isArchived,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }
    })
  }

  /** Looks up updated_at for a batch of ids (chunked to stay under SQLite's variable limit). */
  getUpdatedAtMap(ids: readonly string[]): Map<string, string> {
    const result = new Map<string, string>()
    const chunkSize = 500
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = this.db
        .prepare(`SELECT id, updated_at FROM notes WHERE id IN (${placeholders})`)
        .all(...chunk) as Array<{ id: string; updated_at: string }>
      for (const row of rows) result.set(row.id, row.updated_at)
    }
    return result
  }

  insertImported(note: ExportedNote): void {
    this.db
      .prepare(
        `INSERT INTO notes (id, title, body, color, tags, checklist, is_pinned, is_archived, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        note.id,
        note.title,
        note.body,
        note.color,
        JSON.stringify(note.tags),
        JSON.stringify(note.checklist),
        note.isPinned ? 1 : 0,
        note.isArchived ? 1 : 0,
        note.createdAt,
        note.updatedAt
      )
  }

  replaceImported(note: ExportedNote): void {
    this.db
      .prepare(
        `UPDATE notes SET title = ?, body = ?, color = ?, tags = ?, checklist = ?, is_pinned = ?, is_archived = ?,
                created_at = ?, updated_at = ?, revision = revision + 1
          WHERE id = ?`
      )
      .run(
        note.title,
        note.body,
        note.color,
        JSON.stringify(note.tags),
        JSON.stringify(note.checklist),
        note.isPinned ? 1 : 0,
        note.isArchived ? 1 : 0,
        note.createdAt,
        note.updatedAt,
        note.id
      )
  }
}
