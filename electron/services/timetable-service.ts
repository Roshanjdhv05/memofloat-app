import type {
  Timetable,
  TimetableEvent,
  TimetableCreateInput,
  TimetableUpdateInput,
  TimetableEventCreateInput,
  TimetableEventUpdateInput,
  TimetableEventQuery
} from '@shared/types'
import type { TimetableRepository } from '../repositories/timetable-repository'
import { notFound, validation } from './errors'
import type { Clock, EventBus } from './events'
import { nullLogger, type Logger } from './logger'
import type { Notifier, DueNotification, TimerApi } from './reminder-service'
import { systemTimeZone, utcToWall, wallToUtc } from './recurrence'

export interface TimetableServiceDeps {
  repo: TimetableRepository
  events: EventBus
  clock: Clock
  notifier?: Notifier
  logger?: Logger
  timeZone?: () => string
  /** When omitted, a real timer is used and polling starts automatically.
   *  When explicitly provided (e.g. test harness), polling does NOT start
   *  automatically — call startReminderPolling() if you need it. */
  timers?: TimerApi
}

const realTimers: TimerApi = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
}

/** Parses YYYY-MM-DD into { year, month, day } */
function parseDateParts(dateStr: string): { year: number; month: number; day: number; dayOfWeek: number } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dateObj = new Date(Date.UTC(y, m - 1, d))
  return { year: y, month: m, day: d, dayOfWeek: dateObj.getUTCDay() }
}

function daysBetween(startStr: string, endStr: string): number {
  const d1 = new Date(startStr + 'T00:00:00Z').getTime()
  const d2 = new Date(endStr + 'T00:00:00Z').getTime()
  return Math.round((d2 - d1) / (24 * 60 * 60 * 1000))
}

export class TimetableService {
  private readonly logger: Logger
  private readonly timers: TimerApi
  private readonly autoStart: boolean
  private reminderTimer: unknown = null
  private disposed = false

  constructor(private readonly deps: TimetableServiceDeps) {
    this.logger = deps.logger ?? nullLogger
    // If timers were explicitly injected (test harness), do NOT auto-start polling.
    // Caller must invoke startReminderPolling() explicitly if needed.
    this.autoStart = deps.timers === undefined
    this.timers = deps.timers ?? realTimers
    if (this.autoStart) {
      this.scheduleNextReminderCheck()
    }
  }

  /** Call this once from electron/main.ts after core is fully wired up. */
  startReminderPolling(): void {
    if (!this.disposed && !this.reminderTimer) {
      this.scheduleNextReminderCheck()
    }
  }

  private zone(): string {
    return (this.deps.timeZone ?? systemTimeZone)()
  }

  /* ------------------------------------------------------------------ timetables */

  list(): Timetable[] {
    return this.deps.repo.list()
  }

  get(id: string): Timetable {
    const item = this.deps.repo.get(id)
    if (!item) throw notFound(`Timetable ${id}`)
    return item
  }

  getActive(): Timetable | null {
    return this.deps.repo.getActive()
  }

  setActive(id: string): Timetable {
    const item = this.deps.repo.setActive(id)
    if (!item) throw notFound(`Timetable ${id}`)
    this.deps.events.emit('timetable:changed', { timetableId: id })
    return item
  }

  create(input: TimetableCreateInput): Timetable {
    if (!input.name || !input.name.trim()) throw validation('Timetable name cannot be empty')
    const item = this.deps.repo.create(input, this.deps.clock().toISOString())
    this.logger.info('Created timetable', { id: item.id, name: item.name })
    this.deps.events.emit('timetable:changed', { timetableId: item.id })
    return item
  }

  update(id: string, patch: TimetableUpdateInput): Timetable {
    const item = this.deps.repo.update(id, patch, this.deps.clock().toISOString())
    if (!item) throw notFound(`Timetable ${id}`)
    this.deps.events.emit('timetable:changed', { timetableId: id })
    return item
  }

  duplicate(id: string): Timetable {
    const item = this.deps.repo.duplicate(id, this.deps.clock().toISOString())
    if (!item) throw notFound(`Timetable ${id}`)
    this.deps.events.emit('timetable:changed', { timetableId: item.id })
    return item
  }

  remove(id: string): { deleted: true } {
    const success = this.deps.repo.delete(id)
    if (!success) throw notFound(`Timetable ${id}`)
    this.deps.events.emit('timetable:changed', { timetableId: null })
    this.scheduleNextReminderCheck()
    return { deleted: true }
  }

  /* ------------------------------------------------------------------ events */

  listEvents(query: TimetableEventQuery): TimetableEvent[] {
    // Check timetable exists
    const tt = this.deps.repo.get(query.timetableId)
    if (!tt) return []

    // Fetch base events for this timetable
    const allEvents = this.deps.repo.listEvents({ timetableId: query.timetableId })

    if (!query.date && !query.startDate && !query.endDate) {
      return allEvents
    }

    const startDate = query.date || query.startDate || '1970-01-01'
    const endDate = query.date || query.endDate || '2099-12-31'

    const results: TimetableEvent[] = []

    for (const ev of allEvents) {
      if (ev.recurrence === 'none') {
        if (ev.date >= startDate && ev.date <= endDate) {
          results.push(ev)
        }
      } else {
        // Expand recurring occurrences within [startDate, endDate]
        const evParts = parseDateParts(ev.date)
        const totalDays = Math.max(0, daysBetween(startDate, endDate))
        // Cap range to reasonable length to prevent massive expansion loops
        const maxDays = Math.min(totalDays, 366)

        const curDate = new Date(startDate + 'T00:00:00Z')
        for (let i = 0; i <= maxDays; i++) {
          const y = curDate.getUTCFullYear()
          const m = curDate.getUTCMonth() + 1
          const d = curDate.getUTCDate()
          const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

          if (dateStr >= ev.date) {
            let matches = false
            if (ev.recurrence === 'daily') {
              matches = true
            } else if (ev.recurrence === 'weekly') {
              matches = curDate.getUTCDay() === evParts.dayOfWeek
            } else if (ev.recurrence === 'monthly') {
              matches = d === evParts.day
            }

            if (matches) {
              results.push({
                ...ev,
                date: dateStr
              })
            }
          }
          curDate.setUTCDate(curDate.getUTCDate() + 1)
        }
      }
    }

    // Sort by date ASC, startTime ASC
    results.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.startTime.localeCompare(b.startTime)
    })

    return results
  }

  getEvent(id: string): TimetableEvent {
    const item = this.deps.repo.getEvent(id)
    if (!item) throw notFound(`Event ${id}`)
    return item
  }

  createEvent(input: TimetableEventCreateInput): TimetableEvent {
    if (!input.title || !input.title.trim()) throw validation('Event title cannot be empty')
    if (!input.date) throw validation('Event date is required')
    if (!input.startTime) throw validation('Start time is required')
    if (!input.endTime) throw validation('End time is required')

    const item = this.deps.repo.createEvent(input, this.deps.clock().toISOString())
    this.logger.info('Created timetable event', { id: item.id, title: item.title })
    this.deps.events.emit('timetable:changed', { timetableId: input.timetableId })
    this.scheduleNextReminderCheck()
    return item
  }

  updateEvent(id: string, patch: TimetableEventUpdateInput): TimetableEvent {
    const item = this.deps.repo.updateEvent(id, patch, this.deps.clock().toISOString())
    if (!item) throw notFound(`Event ${id}`)
    this.deps.events.emit('timetable:changed', { timetableId: item.timetableId })
    this.scheduleNextReminderCheck()
    return item
  }

  deleteEvent(id: string): { deleted: true } {
    const current = this.deps.repo.getEvent(id)
    if (!current) throw notFound(`Event ${id}`)
    this.deps.repo.deleteEvent(id, this.deps.clock().toISOString())
    this.deps.events.emit('timetable:changed', { timetableId: current.timetableId })
    this.scheduleNextReminderCheck()
    return { deleted: true }
  }

  /* ------------------------------------------------------------------ reminders */

  private scheduleNextReminderCheck(): void {
    if (this.disposed) return
    if (this.reminderTimer) {
      this.timers.clearTimeout(this.reminderTimer)
      this.reminderTimer = null
    }

    // Periodic check every 30 seconds for upcoming timetable event reminders
    this.reminderTimer = this.timers.setTimeout(() => {
      this.checkDueReminders()
      this.scheduleNextReminderCheck()
    }, 30_000)
  }

  checkDueReminders(): void {
    if (!this.deps.notifier) return
    const now = this.deps.clock()
    const nowMs = now.getTime()
    const zone = this.zone()
    const wallNow = utcToWall(now, zone)
    const todayStr = `${wallNow.year}-${String(wallNow.month).padStart(2, '0')}-${String(wallNow.day).padStart(2, '0')}`

    const active = this.deps.repo.getActive()
    if (!active) return

    // Get today's events for the active timetable
    const events = this.listEvents({ timetableId: active.id, date: todayStr })

    const dueList: DueNotification[] = []

    for (const ev of events) {
      if (ev.reminderMinutes === null || ev.reminderMinutes === undefined) continue

      const [h, m] = ev.startTime.split(':').map(Number)
      const evParts = parseDateParts(ev.date)
      const eventStartUtc = wallToUtc({ year: evParts.year, month: evParts.month, day: evParts.day, hour: h, minute: m }, zone)
      const reminderTimeMs = eventStartUtc.getTime() - ev.reminderMinutes * 60 * 1000

      // If reminder is within a 1-minute window around now
      const diff = nowMs - reminderTimeMs
      if (diff >= 0 && diff < 60_000) {
        dueList.push({
          reminderId: `tt-${ev.id}-${ev.date}`,
          noteId: `timetable-${ev.timetableId}`,
          noteTitle: `Timetable: ${ev.title} (${ev.startTime} - ${ev.endTime})`,
          scheduledAt: new Date(reminderTimeMs).toISOString(),
          recurrence: ev.recurrence === 'monthly' ? 'none' : ev.recurrence,
          missed: 0,
          late: diff > 10_000
        })
      }
    }

    if (dueList.length > 0) {
      this.deps.notifier.notify(dueList)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.reminderTimer) {
      this.timers.clearTimeout(this.reminderTimer)
      this.reminderTimer = null
    }
  }
}
