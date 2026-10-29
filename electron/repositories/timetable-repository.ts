import { randomUUID } from 'node:crypto'
import type { NoteColor, TimetableStyle, TimetableView, EventRecurrence } from '@shared/constants'
import type {
  Timetable,
  TimetableEvent,
  TimetableCreateInput,
  TimetableUpdateInput,
  TimetableEventCreateInput,
  TimetableEventUpdateInput,
  TimetableEventQuery
} from '@shared/types'
import type { Db } from '../services/database'

interface TimetableRow {
  id: string
  name: string
  description: string
  display_style: TimetableStyle
  default_view: TimetableView
  schedule_start: string
  schedule_end: string
  is_active: number
  color: NoteColor
  created_at: string
  updated_at: string
  event_count?: number
}

interface TimetableEventRow {
  id: string
  timetable_id: string
  title: string
  description: string
  date: string
  start_time: string
  end_time: string
  color: NoteColor
  category: string
  recurrence_rule: EventRecurrence
  reminder_minutes: number | null
  created_at: string
  updated_at: string
}

export class TimetableRepository {
  constructor(private readonly db: Db) {}

  private toTimetable(row: TimetableRow): Timetable {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      displayStyle: row.display_style,
      defaultView: row.default_view,
      scheduleStart: row.schedule_start,
      scheduleEnd: row.schedule_end,
      isActive: row.is_active === 1,
      color: row.color,
      eventCount: row.event_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private toEvent(row: TimetableEventRow): TimetableEvent {
    return {
      id: row.id,
      timetableId: row.timetable_id,
      title: row.title,
      description: row.description,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      color: row.color,
      category: row.category,
      recurrence: row.recurrence_rule,
      reminderMinutes: row.reminder_minutes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /* ------------------------------------------------------------------ timetables */

  list(): Timetable[] {
    const rows = this.db
      .prepare<[], TimetableRow>(
        `SELECT t.*, COUNT(e.id) AS event_count
         FROM timetables t
         LEFT JOIN timetable_events e ON e.timetable_id = t.id
         GROUP BY t.id
         ORDER BY t.is_active DESC, t.updated_at DESC`
      )
      .all()
    return rows.map((r) => this.toTimetable(r))
  }

  get(id: string): Timetable | null {
    const row = this.db
      .prepare<[string], TimetableRow>(
        `SELECT t.*, COUNT(e.id) AS event_count
         FROM timetables t
         LEFT JOIN timetable_events e ON e.timetable_id = t.id
         WHERE t.id = ?
         GROUP BY t.id`
      )
      .get(id)
    return row ? this.toTimetable(row) : null
  }

  getActive(): Timetable | null {
    let row = this.db
      .prepare<[], TimetableRow>(
        `SELECT t.*, COUNT(e.id) AS event_count
         FROM timetables t
         LEFT JOIN timetable_events e ON e.timetable_id = t.id
         WHERE t.is_active = 1
         GROUP BY t.id
         LIMIT 1`
      )
      .get()

    if (!row) {
      // Fallback to first available timetable
      row = this.db
        .prepare<[], TimetableRow>(
          `SELECT t.*, COUNT(e.id) AS event_count
           FROM timetables t
           LEFT JOIN timetable_events e ON e.timetable_id = t.id
           GROUP BY t.id
           ORDER BY t.updated_at DESC
           LIMIT 1`
        )
        .get()
      if (row) {
        this.setActive(row.id)
      }
    }

    return row ? this.toTimetable(row) : null
  }

  setActive(id: string): Timetable | null {
    const run = this.db.transaction(() => {
      this.db.prepare('UPDATE timetables SET is_active = 0').run()
      this.db.prepare('UPDATE timetables SET is_active = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
      return this.get(id)
    })
    return run()
  }

  create(input: TimetableCreateInput, nowIso = new Date().toISOString()): Timetable {
    const id = randomUUID()
    const totalCount = this.db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM timetables').get()?.count ?? 0
    const shouldBeActive = input.isActive || totalCount === 0 ? 1 : 0

    const run = this.db.transaction(() => {
      if (shouldBeActive) {
        this.db.prepare('UPDATE timetables SET is_active = 0').run()
      }
      this.db
        .prepare(
          `INSERT INTO timetables (
            id, name, description, display_style, default_view,
            schedule_start, schedule_end, is_active, color, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.name.trim(),
          input.description?.trim() ?? '',
          input.displayStyle ?? 'edge',
          input.defaultView ?? 'day',
          input.scheduleStart ?? '08:00',
          input.scheduleEnd ?? '18:00',
          shouldBeActive,
          input.color ?? 'sky',
          nowIso,
          nowIso
        )
      return this.get(id)!
    })

    return run()
  }

  update(id: string, patch: TimetableUpdateInput, nowIso = new Date().toISOString()): Timetable | null {
    const current = this.get(id)
    if (!current) return null

    const run = this.db.transaction(() => {
      if (patch.isActive !== undefined && patch.isActive) {
        this.db.prepare('UPDATE timetables SET is_active = 0').run()
      }

      const updates: string[] = ['updated_at = ?']
      const values: unknown[] = [nowIso]

      if (patch.name !== undefined) {
        updates.push('name = ?')
        values.push(patch.name.trim())
      }
      if (patch.description !== undefined) {
        updates.push('description = ?')
        values.push(patch.description.trim())
      }
      if (patch.displayStyle !== undefined) {
        updates.push('display_style = ?')
        values.push(patch.displayStyle)
      }
      if (patch.defaultView !== undefined) {
        updates.push('default_view = ?')
        values.push(patch.defaultView)
      }
      if (patch.scheduleStart !== undefined) {
        updates.push('schedule_start = ?')
        values.push(patch.scheduleStart)
      }
      if (patch.scheduleEnd !== undefined) {
        updates.push('schedule_end = ?')
        values.push(patch.scheduleEnd)
      }
      if (patch.color !== undefined) {
        updates.push('color = ?')
        values.push(patch.color)
      }
      if (patch.isActive !== undefined) {
        updates.push('is_active = ?')
        values.push(patch.isActive ? 1 : 0)
      }

      values.push(id)
      this.db.prepare(`UPDATE timetables SET ${updates.join(', ')} WHERE id = ?`).run(...values)
      return this.get(id)
    })

    return run()
  }

  duplicate(id: string, nowIso = new Date().toISOString()): Timetable | null {
    const original = this.get(id)
    if (!original) return null

    const run = this.db.transaction(() => {
      const newId = randomUUID()
      const newName = `${original.name} (Copy)`

      this.db
        .prepare(
          `INSERT INTO timetables (
            id, name, description, display_style, default_view,
            schedule_start, schedule_end, is_active, color, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          newId,
          newName,
          original.description,
          original.displayStyle,
          original.defaultView,
          original.scheduleStart,
          original.scheduleEnd,
          original.color,
          nowIso,
          nowIso
        )

      // Copy all events
      const events = this.listEvents({ timetableId: id })
      for (const event of events) {
        this.db
          .prepare(
            `INSERT INTO timetable_events (
              id, timetable_id, title, description, date, start_time,
              end_time, color, category, recurrence_rule, reminder_minutes,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            newId,
            event.title,
            event.description,
            event.date,
            event.startTime,
            event.endTime,
            event.color,
            event.category,
            event.recurrence,
            event.reminderMinutes,
            nowIso,
            nowIso
          )
      }

      return this.get(newId)!
    })

    return run()
  }

  delete(id: string): boolean {
    const run = this.db.transaction(() => {
      const target = this.get(id)
      if (!target) return false

      this.db.prepare('DELETE FROM timetables WHERE id = ?').run(id)

      if (target.isActive) {
        // Activate another timetable if one exists
        const next = this.db
          .prepare<[], { id: string }>(
            'SELECT id FROM timetables ORDER BY updated_at DESC LIMIT 1'
          )
          .get()
        if (next) {
          this.db.prepare('UPDATE timetables SET is_active = 1 WHERE id = ?').run(next.id)
        }
      }
      return true
    })

    return run()
  }

  /* ------------------------------------------------------------------ events */

  listEvents(query: TimetableEventQuery): TimetableEvent[] {
    const where: string[] = ['timetable_id = ?']
    const values: unknown[] = [query.timetableId]

    if (query.date) {
      where.push('date = ?')
      values.push(query.date)
    } else {
      if (query.startDate) {
        where.push('date >= ?')
        values.push(query.startDate)
      }
      if (query.endDate) {
        where.push('date <= ?')
        values.push(query.endDate)
      }
    }

    const rows = this.db
      .prepare<unknown[], TimetableEventRow>(
        `SELECT * FROM timetable_events
         WHERE ${where.join(' AND ')}
         ORDER BY date ASC, start_time ASC`
      )
      .all(...values)

    return rows.map((r) => this.toEvent(r))
  }

  getEvent(id: string): TimetableEvent | null {
    const row = this.db
      .prepare<[string], TimetableEventRow>('SELECT * FROM timetable_events WHERE id = ?')
      .get(id)
    return row ? this.toEvent(row) : null
  }

  createEvent(input: TimetableEventCreateInput, nowIso = new Date().toISOString()): TimetableEvent {
    const id = randomUUID()
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO timetable_events (
            id, timetable_id, title, description, date, start_time,
            end_time, color, category, recurrence_rule, reminder_minutes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.timetableId,
          input.title.trim(),
          input.description?.trim() ?? '',
          input.date,
          input.startTime,
          input.endTime,
          input.color ?? 'sky',
          input.category?.trim() || 'General',
          input.recurrence ?? 'none',
          input.reminderMinutes ?? null,
          nowIso,
          nowIso
        )
      // Touch timetable updated_at
      this.db.prepare('UPDATE timetables SET updated_at = ? WHERE id = ?').run(nowIso, input.timetableId)
      return this.getEvent(id)!
    })

    return run()
  }

  updateEvent(id: string, patch: TimetableEventUpdateInput, nowIso = new Date().toISOString()): TimetableEvent | null {
    const current = this.getEvent(id)
    if (!current) return null

    const run = this.db.transaction(() => {
      const updates: string[] = ['updated_at = ?']
      const values: unknown[] = [nowIso]

      if (patch.title !== undefined) {
        updates.push('title = ?')
        values.push(patch.title.trim())
      }
      if (patch.description !== undefined) {
        updates.push('description = ?')
        values.push(patch.description.trim())
      }
      if (patch.date !== undefined) {
        updates.push('date = ?')
        values.push(patch.date)
      }
      if (patch.startTime !== undefined) {
        updates.push('start_time = ?')
        values.push(patch.startTime)
      }
      if (patch.endTime !== undefined) {
        updates.push('end_time = ?')
        values.push(patch.endTime)
      }
      if (patch.color !== undefined) {
        updates.push('color = ?')
        values.push(patch.color)
      }
      if (patch.category !== undefined) {
        updates.push('category = ?')
        values.push(patch.category.trim())
      }
      if (patch.recurrence !== undefined) {
        updates.push('recurrence_rule = ?')
        values.push(patch.recurrence)
      }
      if (patch.reminderMinutes !== undefined) {
        updates.push('reminder_minutes = ?')
        values.push(patch.reminderMinutes)
      }

      values.push(id)
      this.db.prepare(`UPDATE timetable_events SET ${updates.join(', ')} WHERE id = ?`).run(...values)
      // Touch timetable updated_at
      this.db.prepare('UPDATE timetables SET updated_at = ? WHERE id = ?').run(nowIso, current.timetableId)
      return this.getEvent(id)
    })

    return run()
  }

  deleteEvent(id: string, nowIso = new Date().toISOString()): boolean {
    const run = this.db.transaction(() => {
      const current = this.getEvent(id)
      if (!current) return false

      this.db.prepare('DELETE FROM timetable_events WHERE id = ?').run(id)
      this.db.prepare('UPDATE timetables SET updated_at = ? WHERE id = ?').run(nowIso, current.timetableId)
      return true
    })

    return run()
  }
}

