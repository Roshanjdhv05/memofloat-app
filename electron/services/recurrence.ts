/**
 * Time-zone aware date arithmetic for reminders.
 *
 * Storage is always UTC. Recurring reminders are defined by a *wall-clock* time of day in an
 * IANA time zone ("every day at 09:00 in Europe/London"), so they keep their local time across
 * daylight-saving transitions instead of drifting by an hour.
 *
 * DST edge cases
 * - Time that does not exist (spring-forward gap): resolves to the first valid instant after the gap.
 * - Time that occurs twice (fall-back overlap): resolves to the first occurrence.
 *
 * Only Intl is used - no external date library - and every function is pure.
 */

export interface WallDate {
  year: number
  /** 1-12 */
  month: number
  day: number
}

export interface WallTime extends WallDate {
  hour: number
  minute: number
  second: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function utcToWall(date: Date, timeZone: string): WallTime & { weekday: number } {
  const parts = formatterFor(timeZone).formatToParts(date)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  return {
    year,
    month,
    day,
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
    weekday: weekdayOf({ year, month, day })
  }
}

/** Day of week (0 = Sunday) of a calendar date; independent of any time zone. */
export function weekdayOf(date: WallDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

export function addDays(date: WallDate, days: number): WallDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds (east is positive). */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const base = Math.floor(utcMs / 1000) * 1000
  const w = utcToWall(new Date(base), timeZone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - base
}

/** Converts a wall-clock time in `timeZone` to the corresponding UTC instant. */
export function wallToUtc(wall: WallDate & { hour: number; minute: number }, timeZone: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0)
  const candidates = new Set([zoneOffsetMs(guess - DAY_MS, timeZone), zoneOffsetMs(guess + DAY_MS, timeZone)])
  const valid: number[] = []
  for (const offset of candidates) {
    const instant = guess - offset
    if (zoneOffsetMs(instant, timeZone) === offset) valid.push(instant)
  }
  if (valid.length > 0) return new Date(Math.min(...valid))
  // The wall time falls in a spring-forward gap: use the offset in force before the transition,
  // which lands on the first valid instant after the gap.
  return new Date(guess - zoneOffsetMs(guess - DAY_MS, timeZone))
}

export function parseLocalTime(localTime: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime)
  if (!match) throw new Error(`Invalid local time: ${localTime}`)
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

export function localTimeOf(date: Date, timeZone: string): string {
  const w = utcToWall(date, timeZone)
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
}

/** Start of the local calendar day containing `now`, and the start of the following day. */
export function localDayBounds(now: Date, timeZone: string): { start: Date; startOfTomorrow: Date } {
  const w = utcToWall(now, timeZone)
  const today = { year: w.year, month: w.month, day: w.day }
  const tomorrow = addDays(today, 1)
  return {
    start: wallToUtc({ ...today, hour: 0, minute: 0 }, timeZone),
    startOfTomorrow: wallToUtc({ ...tomorrow, hour: 0, minute: 0 }, timeZone)
  }
}

export interface RecurrenceSpec {
  recurrence: 'daily' | 'weekly'
  /** HH:mm wall-clock time in `timeZone`. */
  localTime: string
  timeZone: string
  /** 0-6 (Sunday = 0); required for weekly rules. */
  weekday?: number
}

/** First occurrence strictly after `after`. */
export function nextOccurrenceAfter(after: Date, spec: RecurrenceSpec): Date {
  const { hour, minute } = parseLocalTime(spec.localTime)
  const start = utcToWall(after, spec.timeZone)
  const today: WallDate = { year: start.year, month: start.month, day: start.day }
  const horizon = spec.recurrence === 'daily' ? 3 : 15
  for (let offset = 0; offset <= horizon; offset++) {
    const date = addDays(today, offset)
    if (spec.recurrence === 'weekly' && weekdayOf(date) !== spec.weekday) continue
    const instant = wallToUtc({ ...date, hour, minute }, spec.timeZone)
    if (instant.getTime() > after.getTime()) return instant
  }
  throw new Error('Could not compute next occurrence')
}

export interface AdvanceResult {
  /** The most recent occurrence that is due (<= now). */
  latestDue: Date
  /** The first occurrence after `now`. */
  next: Date
  /** How many occurrences were due (>= 1); more than one means occurrences were missed. */
  dueCount: number
}

const MAX_CATCH_UP_STEPS = 5000

/**
 * Given a due occurrence, steps forward until the first occurrence after `now`, reporting how
 * many were missed in between so a single notification can describe them.
 */
export function advancePast(scheduled: Date, spec: RecurrenceSpec, now: Date): AdvanceResult {
  let latestDue = scheduled
  let dueCount = 1
  let next = nextOccurrenceAfter(latestDue, spec)
  while (next.getTime() <= now.getTime()) {
    latestDue = next
    dueCount += 1
    if (dueCount > MAX_CATCH_UP_STEPS) {
      next = nextOccurrenceAfter(now, spec)
      break
    }
    next = nextOccurrenceAfter(latestDue, spec)
  }
  return { latestDue, next, dueCount }
}

/**
 * Re-anchors a recurring reminder to a new time zone, keeping its wall-clock time and weekday,
 * and returns the first occurrence strictly after `now`.
 */
export function reanchor(
  scheduledAt: Date,
  recurrence: 'daily' | 'weekly',
  localTime: string,
  previousTimeZone: string,
  newTimeZone: string,
  now: Date
): Date {
  const weekday = utcToWall(scheduledAt, previousTimeZone).weekday
  return nextOccurrenceAfter(now, { recurrence, localTime, timeZone: newTimeZone, weekday })
}
