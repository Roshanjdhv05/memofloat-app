import { randomUUID } from 'node:crypto'
import type { ExportedReminder } from '@shared/schemas'
import type { NoteColor } from '@shared/constants'
import type { RecurrenceRule, Reminder, ReminderListItem, ReminderStatus } from '@shared/types'
import type { Db } from '../services/database'

interface ReminderRow {
  id: string
  note_id: string
  scheduled_at: string
  recurrence_rule: RecurrenceRule
  time_zone: string
  local_time: string
  status: ReminderStatus
  last_notified_occurrence: string | null
  created_at: string
  updated_at: string
}

interface ListRow extends ReminderRow {
  note_title: string
  note_color: NoteColor
  note_archived: number
}

export type ReminderScope = 'upcoming' | 'today' | 'overdue' | 'history'

export interface ReminderInsert {
  noteId: string
  scheduledAt: string
  recurrence: RecurrenceRule
  timeZone: string
  localTime: string
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    noteId: row.note_id,
    scheduledAt: row.scheduled_at,
    recurrence: row.recurrence_rule,
    timeZone: row.time_zone,
    localTime: row.local_time,
    status: row.status,
    lastNotifiedOccurrence: row.last_notified_occurrence,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class RemindersRepository {
  constructor(private readonly db: Db) {}

  get(id: string): Reminder | null {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow | undefined
    return row ? toReminder(row) : null
  }

  forNote(noteId: string): Reminder[] {
    const rows = this.db
      .prepare('SELECT * FROM reminders WHERE note_id = ? ORDER BY scheduled_at ASC')
      .all(noteId) as ReminderRow[]
    return rows.map(toReminder)
  }

  create(input: ReminderInsert, now: Date): Reminder {
    const id = randomUUID()
    const iso = now.toISOString()
    this.db
      .prepare(
        `INSERT INTO reminders (id, note_id, scheduled_at, recurrence_rule, time_zone, local_time, status,
                                last_notified_occurrence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, ?, ?)`
      )
      .run(id, input.noteId, input.scheduledAt, input.recurrence, input.timeZone, input.localTime, iso, iso)
    return this.get(id) as Reminder
  }

  /** Replaces the schedule of a reminder and re-arms it (status back to 'scheduled', fire history cleared). */
  reschedule(
    id: string,
    schedule: { scheduledAt: string; recurrence: RecurrenceRule; timeZone: string; localTime: string },
    now: Date
  ): Reminder | null {
    const result = this.db
      .prepare(
        `UPDATE reminders
            SET scheduled_at = ?, recurrence_rule = ?, time_zone = ?, local_time = ?, status = 'scheduled',
                last_notified_occurrence = NULL, updated_at = ?
          WHERE id = ?`
      )
      .run(schedule.scheduledAt, schedule.recurrence, schedule.timeZone, schedule.localTime, now.toISOString(), id)
    return result.changes > 0 ? this.get(id) : null
  }

  setStatus(id: string, status: ReminderStatus, now: Date): Reminder | null {
    const result = this.db
      .prepare('UPDATE reminders SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now.toISOString(), id)
    return result.changes > 0 ? this.get(id) : null
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id).changes > 0
  }

  /** Open reminders whose next occurrence has arrived. Ordered so older ones are handled first. */
  due(nowIso: string): Reminder[] {
    const rows = this.db
      .prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC, id ASC")
      .all(nowIso) as ReminderRow[]
    return rows.map(toReminder)
  }

  /** The next occurrence that has not arrived yet, used to arm the timer. */
  nextPendingAfter(nowIso: string): string | null {
    const value = this.db
      .prepare("SELECT MIN(scheduled_at) FROM reminders WHERE status = 'scheduled' AND scheduled_at > ?")
      .pluck()
      .get(nowIso) as string | null
    return value ?? null
  }

  recurringOutsideZone(timeZone: string): Reminder[] {
    const rows = this.db
      .prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND recurrence_rule != 'none' AND time_zone != ?")
      .all(timeZone) as ReminderRow[]
    return rows.map(toReminder)
  }

  /**
   * Records that an occurrence has been handled and (for recurring reminders) moves the series
   * to its next occurrence. Guarded by `last_notified_occurrence` so the same occurrence can
   * never be claimed twice; returns false when another caller already claimed it.
   */
  claimOccurrence(id: string, occurrenceIso: string, next: { scheduledAt: string; timeZone: string } | null, now: Date): boolean {
    const result = next
      ? this.db
          .prepare(
            `UPDATE reminders
                SET last_notified_occurrence = ?, scheduled_at = ?, time_zone = ?, updated_at = ?
              WHERE id = ? AND status = 'scheduled' AND (last_notified_occurrence IS NULL OR last_notified_occurrence < ?)`
          )
          .run(occurrenceIso, next.scheduledAt, next.timeZone, now.toISOString(), id, occurrenceIso)
      : this.db
          .prepare(
            `UPDATE reminders
                SET last_notified_occurrence = ?, updated_at = ?
              WHERE id = ? AND status = 'scheduled' AND (last_notified_occurrence IS NULL OR last_notified_occurrence < ?)`
          )
          .run(occurrenceIso, now.toISOString(), id, occurrenceIso)
    return result.changes > 0
  }

  moveOccurrence(id: string, scheduledAt: string, timeZone: string, now: Date): void {
    this.db
      .prepare('UPDATE reminders SET scheduled_at = ?, time_zone = ?, updated_at = ? WHERE id = ?')
      .run(scheduledAt, timeZone, now.toISOString(), id)
  }

  /**
   * Lists reminders joined with their note for the dashboard.
   *
   * - upcoming: open reminders not yet fired, soonest first
   * - today:    open reminders due before the start of tomorrow (includes overdue ones)
   * - overdue:  one-time reminders that fired (or whose time passed) and are still open
   * - history:  completed or cancelled reminders, newest first
   */
  list(scope: ReminderScope, nowIso: string, startOfTomorrowIso: string, noteId?: string): ReminderListItem[] {
    const where: string[] = []
    const params: unknown[] = []
    let order = 'r.scheduled_at ASC, r.id ASC'

    switch (scope) {
      case 'upcoming':
        where.push("r.status = 'scheduled' AND r.scheduled_at > ?")
        params.push(nowIso)
        break
      case 'today':
        where.push("r.status = 'scheduled' AND r.scheduled_at < ?")
        params.push(startOfTomorrowIso)
        break
      case 'overdue':
        where.push("r.status = 'scheduled' AND r.scheduled_at <= ?")
        params.push(nowIso)
        break
      case 'history':
        where.push("r.status != 'scheduled'")
        order = 'r.updated_at DESC, r.id DESC'
        break
    }
    if (noteId) {
      where.push('r.note_id = ?')
      params.push(noteId)
    }

    const rows = this.db
      .prepare(
        `SELECT r.*, n.title AS note_title, n.color AS note_color, n.is_archived AS note_archived
           FROM reminders r JOIN notes n ON n.id = r.note_id
          WHERE ${where.join(' AND ')}
          ORDER BY ${order}
          LIMIT 1000`
      )
      .all(...params) as ListRow[]

    return rows.map((row) => {
      const reminder = toReminder(row)
      return {
        ...reminder,
        noteTitle: row.note_title,
        noteColor: row.note_color,
        noteArchived: row.note_archived === 1,
        overdue: reminder.status === 'scheduled' && reminder.scheduledAt <= nowIso,
        fired:
          reminder.lastNotifiedOccurrence !== null && reminder.lastNotifiedOccurrence >= reminder.scheduledAt
      }
    })
  }

  /* ------------------------------------------------------------------ import / export */

  exportAll(): ExportedReminder[] {
    const rows = this.db.prepare('SELECT * FROM reminders ORDER BY created_at ASC, id ASC').all() as ReminderRow[]
    return rows.map((row) => ({
      id: row.id,
      noteId: row.note_id,
      scheduledAt: row.scheduled_at,
      recurrence: row.recurrence_rule,
      timeZone: row.time_zone,
      localTime: row.local_time,
      status: row.status,
      lastNotifiedOccurrence: row.last_notified_occurrence,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  existingIds(ids: readonly string[]): Set<string> {
    const found = new Set<string>()
    const chunkSize = 500
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const rows = this.db
        .prepare(`SELECT id FROM reminders WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .pluck()
        .all(...chunk) as string[]
      for (const id of rows) found.add(id)
    }
    return found
  }

  /** Inserts an imported reminder, or replaces the existing one with the same id. */
  upsertImported(reminder: ExportedReminder): void {
    this.db
      .prepare(
        `INSERT INTO reminders (id, note_id, scheduled_at, recurrence_rule, time_zone, local_time, status,
                                last_notified_occurrence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           note_id = excluded.note_id, scheduled_at = excluded.scheduled_at,
           recurrence_rule = excluded.recurrence_rule, time_zone = excluded.time_zone,
           local_time = excluded.local_time, status = excluded.status,
           last_notified_occurrence = excluded.last_notified_occurrence,
           created_at = excluded.created_at, updated_at = excluded.updated_at`
      )
      .run(
        reminder.id,
        reminder.noteId,
        reminder.scheduledAt,
        reminder.recurrence,
        reminder.timeZone,
        reminder.localTime,
        reminder.status,
        reminder.lastNotifiedOccurrence,
        reminder.createdAt,
        reminder.updatedAt
      )
  }

  deleteForNote(noteId: string): void {
    this.db.prepare('DELETE FROM reminders WHERE note_id = ?').run(noteId)
  }
}
