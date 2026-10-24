import type { z } from 'zod'
import type { reminderCreateSchema, reminderListSchema, reminderUpdateSchema } from '@shared/schemas'
import type { Reminder, ReminderListItem } from '@shared/types'
import type { NotesRepository } from '../repositories/notes-repository'
import type { RemindersRepository } from '../repositories/reminders-repository'
import { notFound, validation } from './errors'
import type { Clock, EventBus } from './events'
import { nullLogger, type Logger } from './logger'
import {
  advancePast,
  isValidTimeZone,
  localDayBounds,
  localTimeOf,
  reanchor,
  systemTimeZone,
  utcToWall
} from './recurrence'

/** One reminder occurrence that is ready to be shown to the user. */
export interface DueNotification {
  reminderId: string
  noteId: string
  noteTitle: string
  /** The occurrence being announced (the most recent one when several were missed). */
  scheduledAt: string
  recurrence: 'none' | 'daily' | 'weekly'
  /** Occurrences skipped while the app was not running (recurring reminders only). */
  missed: number
  /** The notification arrived noticeably after the scheduled time (app was closed or asleep). */
  late: boolean
}

export interface Notifier {
  notify(items: DueNotification[]): void
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realTimers: TimerApi = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
}

export interface ReminderServiceDeps {
  reminders: RemindersRepository
  notes: NotesRepository
  events: EventBus
  clock: Clock
  notifier: Notifier
  logger?: Logger
  timeZone?: () => string
  timers?: TimerApi
  /** Whether desktop notifications are enabled in settings. Occurrences are still processed when disabled. */
  notificationsEnabled?: () => boolean
}

/** A reminder that fires this long after its scheduled time is reported as "late". */
const LATE_THRESHOLD_MS = 2 * 60 * 1000
/** Never sleep longer than this: guards against clock changes and suspended timers. */
const MAX_SLEEP_MS = 5 * 60 * 1000
/** Past-dated reminders within this window are accepted (user typed "now"). */
const CREATE_GRACE_MS = 60 * 1000

/**
 * Persistent reminder scheduler.
 *
 * Source of truth is SQLite, never an in-memory timeout. A single timer is armed for the
 * earliest pending occurrence (and re-armed after every change); when it fires - or on startup,
 * on resume from sleep and whenever reminders change - `processDue` reads what is actually due
 * from the database. Each occurrence is claimed with a guarded UPDATE *before* the notification
 * is shown, so a crash or a second `processDue` call can never produce a duplicate notification.
 *
 * Limitation (by design, documented in the README): reminders are only processed while
 * MemoFloat is running. After the app has been closed, overdue reminders are reconciled once
 * on the next start.
 */
export class ReminderService {
  private timer: unknown = null
  private disposed = false
  private readonly logger: Logger
  private readonly timers: TimerApi

  constructor(private readonly deps: ReminderServiceDeps) {
    this.logger = deps.logger ?? nullLogger
    this.timers = deps.timers ?? realTimers
  }

  private zone(): string {
    return (this.deps.timeZone ?? systemTimeZone)()
  }

  /* ------------------------------------------------------------------ queries */

  list(query: z.output<typeof reminderListSchema>): ReminderListItem[] {
    const now = this.deps.clock()
    const { startOfTomorrow } = localDayBounds(now, this.zone())
    return this.deps.reminders.list(query.scope, now.toISOString(), startOfTomorrow.toISOString(), query.noteId)
  }

  forNote(noteId: string): Reminder[] {
    if (!this.deps.notes.exists(noteId)) throw notFound('Note')
    return this.deps.reminders.forNote(noteId)
  }

  /* ------------------------------------------------------------------ commands */

  create(input: z.output<typeof reminderCreateSchema>): Reminder {
    if (!this.deps.notes.exists(input.noteId)) throw notFound('Note')
    const now = this.deps.clock()
    const when = new Date(input.scheduledAt)
    if (Number.isNaN(when.getTime())) throw validation('The reminder time is not valid.')
    if (when.getTime() < now.getTime() - CREATE_GRACE_MS) {
      throw validation('Choose a reminder time in the future.')
    }
    const zone = this.zone()
    const reminder = this.deps.reminders.create(
      {
        noteId: input.noteId,
        scheduledAt: when.toISOString(),
        recurrence: input.recurrence,
        timeZone: zone,
        localTime: localTimeOf(when, zone)
      },
      now
    )
    this.changed(reminder.noteId)
    return reminder
  }

  update(input: z.output<typeof reminderUpdateSchema>): Reminder {
    const existing = this.deps.reminders.get(input.id)
    if (!existing) throw notFound('Reminder')
    const now = this.deps.clock()
    const zone = this.zone()

    let scheduledAt = existing.scheduledAt
    if (input.scheduledAt !== undefined) {
      const when = new Date(input.scheduledAt)
      if (Number.isNaN(when.getTime())) throw validation('The reminder time is not valid.')
      if (when.getTime() < now.getTime() - CREATE_GRACE_MS) throw validation('Choose a reminder time in the future.')
      scheduledAt = when.toISOString()
    } else if (existing.status !== 'scheduled' || existing.scheduledAt <= now.toISOString()) {
      throw validation('Choose a new time to re-activate this reminder.')
    }

    const updated = this.deps.reminders.reschedule(
      existing.id,
      {
        scheduledAt,
        recurrence: input.recurrence ?? existing.recurrence,
        timeZone: zone,
        localTime: localTimeOf(new Date(scheduledAt), zone)
      },
      now
    )
    if (!updated) throw notFound('Reminder')
    this.changed(updated.noteId)
    return updated
  }

  /** Completes a one-time reminder, or ends a recurring series. */
  complete(id: string): Reminder {
    return this.setStatus(id, 'completed')
  }

  /** Cancels a reminder so it never fires. */
  cancel(id: string): Reminder {
    return this.setStatus(id, 'cancelled')
  }

  private setStatus(id: string, status: 'completed' | 'cancelled'): Reminder {
    const updated = this.deps.reminders.setStatus(id, status, this.deps.clock())
    if (!updated) throw notFound('Reminder')
    this.changed(updated.noteId)
    return updated
  }

  remove(id: string): void {
    const existing = this.deps.reminders.get(id)
    if (!existing) throw notFound('Reminder')
    this.deps.reminders.delete(id)
    this.changed(existing.noteId)
  }

  /** Call after notes are deleted or restored from import so the timer reflects the database. */
  refresh(): void {
    this.arm()
  }

  private changed(noteId: string): void {
    this.deps.events.emit('reminders:changed', { noteId })
    this.arm()
  }

  /* ------------------------------------------------------------------ scheduling */

  /**
   * Startup reconciliation: re-anchors recurring reminders after a time-zone change, handles
   * everything that became due while the app was closed (each occurrence at most once),
   * then arms the timer.
   */
  reconcile(): { notified: number } {
    const result = this.processDue()
    this.arm()
    return result
  }

  start(): void {
    this.disposed = false
    this.reconcile()
  }

  stop(): void {
    this.disposed = true
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  /** Process everything due at the current time. Safe to call at any moment, any number of times. */
  processDue(): { notified: number } {
    if (this.disposed) return { notified: 0 }
    const now = this.deps.clock()
    const zone = this.zone()
    const nowIso = now.toISOString()

    this.reanchorRecurring(zone, now)

    const notifications: DueNotification[] = []
    let touched = false
    for (const reminder of this.deps.reminders.due(nowIso)) {
      const lastNotified = reminder.lastNotifiedOccurrence
      if (reminder.recurrence === 'none') {
        // Already announced (e.g. app restarted after it fired): leave it overdue for the user to resolve.
        if (lastNotified !== null && lastNotified >= reminder.scheduledAt) continue
        if (!this.deps.reminders.claimOccurrence(reminder.id, reminder.scheduledAt, null, now)) continue
        touched = true
        this.queue(notifications, reminder, reminder.scheduledAt, 0, now)
        continue
      }

      const scheduled = new Date(reminder.scheduledAt)
      const advance = advancePast(
        scheduled,
        {
          recurrence: reminder.recurrence,
          localTime: reminder.localTime,
          timeZone: zone,
          weekday: utcToWall(scheduled, reminder.timeZone).weekday
        },
        now
      )
      const claimed = this.deps.reminders.claimOccurrence(
        reminder.id,
        advance.latestDue.toISOString(),
        { scheduledAt: advance.next.toISOString(), timeZone: zone },
        now
      )
      if (!claimed) continue
      touched = true
      this.queue(notifications, reminder, advance.latestDue.toISOString(), advance.dueCount - 1, now)
    }

    if (notifications.length > 0 && (this.deps.notificationsEnabled?.() ?? true)) {
      try {
        this.deps.notifier.notify(notifications)
      } catch (error) {
        this.logger.error('Notifier failed', { error })
      }
    }
    if (touched) this.deps.events.emit('reminders:changed', { noteId: null })
    if (notifications.length > 0) this.logger.info('Processed due reminders', { count: notifications.length })
    return { notified: notifications.length }
  }

  private queue(
    out: DueNotification[],
    reminder: Reminder,
    occurrenceIso: string,
    missed: number,
    now: Date
  ): void {
    const note = this.deps.notes.get(reminder.noteId)
    // Reminders of archived notes advance silently; they surface again once the note is restored.
    if (!note || note.isArchived) return
    out.push({
      reminderId: reminder.id,
      noteId: note.id,
      noteTitle: note.title,
      scheduledAt: occurrenceIso,
      recurrence: reminder.recurrence,
      missed,
      late: now.getTime() - new Date(occurrenceIso).getTime() > LATE_THRESHOLD_MS
    })
  }

  /** Keeps recurring reminders at the same wall-clock time after the device changed time zone. */
  private reanchorRecurring(zone: string, now: Date): void {
    if (!isValidTimeZone(zone)) return
    for (const reminder of this.deps.reminders.recurringOutsideZone(zone)) {
      try {
        const zoneBefore = isValidTimeZone(reminder.timeZone) ? reminder.timeZone : zone
        const next = reanchor(
          new Date(reminder.scheduledAt),
          reminder.recurrence as 'daily' | 'weekly',
          reminder.localTime,
          zoneBefore,
          zone,
          new Date(now.getTime() - 1)
        )
        this.deps.reminders.moveOccurrence(reminder.id, next.toISOString(), zone, now)
        this.logger.info('Re-anchored recurring reminder to the new time zone', { id: reminder.id, zone })
      } catch (error) {
        this.logger.error('Could not re-anchor reminder', { id: reminder.id, error })
      }
    }
  }

  /** Arms (or re-arms) the single timer for the earliest pending occurrence. */
  arm(): void {
    if (this.disposed) return
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null

    const now = this.deps.clock()
    // Anything already due is handled right away (e.g. a reminder created for "now").
    const dueNow = this.deps.reminders.due(now.toISOString()).some((r) => {
      if (r.recurrence !== 'none') return true
      return r.lastNotifiedOccurrence === null || r.lastNotifiedOccurrence < r.scheduledAt
    })
    let delay: number
    if (dueNow) {
      delay = 0
    } else {
      const next = this.deps.reminders.nextPendingAfter(now.toISOString())
      if (next === null) return
      delay = Math.min(Math.max(new Date(next).getTime() - now.getTime(), 0) + 25, MAX_SLEEP_MS)
    }
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      try {
        this.processDue()
      } catch (error) {
        this.logger.error('Reminder processing failed', { error })
      }
      this.arm()
    }, delay)
  }

  /** Called when the machine resumes from sleep or the clock/time zone changes. */
  onSystemResume(): void {
    this.reconcile()
  }
}
