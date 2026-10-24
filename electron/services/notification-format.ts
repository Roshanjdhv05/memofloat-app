import type { DueNotification } from './reminder-service'

export interface FormattedNotification {
  title: string
  body: string
  /** What clicking the notification should open. */
  target: { kind: 'note'; noteId: string } | { kind: 'reminders' }
}

export const MAX_INDIVIDUAL_NOTIFICATIONS = 3

function formatWhen(iso: string, locale: string, timeZone: string, now: Date): string {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(date)
  const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d)
  if (dayOf(date) === dayOf(now)) return time
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(date)
  return `${day}, ${time}`
}

const RECURRENCE_LABEL = { none: 'Reminder', daily: 'Daily reminder', weekly: 'Weekly reminder' } as const

export function formatNotification(
  item: DueNotification,
  options: { locale: string; timeZone: string; now: Date }
): FormattedNotification {
  const when = formatWhen(item.scheduledAt, options.locale, options.timeZone, options.now)
  const label = RECURRENCE_LABEL[item.recurrence]
  let body: string
  if (item.missed > 0) {
    body = `${label} · missed ${item.missed + 1} times while MemoFloat was closed (latest ${when})`
  } else if (item.late) {
    body = `${label} · was due ${when}`
  } else {
    body = `${label} · ${when}`
  }
  return {
    title: item.noteTitle.trim() || 'Untitled note',
    body,
    target: { kind: 'note', noteId: item.noteId }
  }
}

/** Turns a batch of due reminders into notifications; large batches collapse into one summary. */
export function formatBatch(
  items: DueNotification[],
  options: { locale: string; timeZone: string; now: Date }
): FormattedNotification[] {
  if (items.length <= MAX_INDIVIDUAL_NOTIFICATIONS) return items.map((i) => formatNotification(i, options))
  const names = items.slice(0, 3).map((i) => i.noteTitle.trim() || 'Untitled note')
  return [
    {
      title: `${items.length} reminders are due`,
      body: `${names.join(', ')} and ${items.length - names.length} more`,
      target: { kind: 'reminders' }
    }
  ]
}
