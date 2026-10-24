/** Date helpers. All stored timestamps are UTC ISO strings; everything shown to the user is local time. */

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24 && sameLocalDay(then, now)) return `${hours} h ago`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameLocalDay(then, yesterday)) return 'yesterday'
  const days = Math.round(seconds / 86400)
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Today, 4:30 PM", "Tomorrow, 9:00 AM", "Mon, Oct 19, 9:00 AM". */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = formatTime(iso)
  if (sameLocalDay(date, now)) return `Today, ${time}`
  if (sameLocalDay(date, tomorrow)) return `Tomorrow, ${time}`
  if (sameLocalDay(date, yesterday)) return `Yesterday, ${time}`
  const day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
  return `${day}, ${time}`
}

export function formatToday(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Values for <input type="date"> and <input type="time"> in the user's local time zone. */
export function toLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/**
 * Converts the local date/time typed into the form to a UTC ISO instant.
 * Returns null for incomplete or impossible values (e.g. 2026-02-31 or a time skipped by DST).
 */
export function localInputsToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])]
  const local = new Date(y, mo - 1, da, h, mi, 0, 0)
  if (Number.isNaN(local.getTime())) return null
  if (local.getFullYear() !== y || local.getMonth() !== mo - 1 || local.getDate() !== da) return null
  return local.toISOString()
}

export function defaultReminderInputs(now: Date = new Date()): { date: string; time: string } {
  const next = new Date(now.getTime() + 60 * 60 * 1000)
  next.setMinutes(0, 0, 0)
  return toLocalInputs(next.toISOString())
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export function newId(): string {
  return crypto.randomUUID()
}
