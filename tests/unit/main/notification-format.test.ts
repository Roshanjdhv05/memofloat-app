import { describe, expect, it } from 'vitest'
import { formatBatch, formatNotification } from '../../../electron/services/notification-format'
import type { DueNotification } from '../../../electron/services/reminder-service'

const base: DueNotification = {
  reminderId: 'r1',
  noteId: 'n1',
  noteTitle: 'Call the dentist',
  scheduledAt: '2026-10-14T10:37:00.000Z',
  recurrence: 'none',
  missed: 0,
  late: false
}
const opts = { locale: 'en-US', timeZone: 'Asia/Calcutta', now: new Date('2026-10-14T10:40:00Z') }

describe('notification text', () => {
  it('shows the note title and local time', () => {
    const n = formatNotification(base, opts)
    expect(n.title).toBe('Call the dentist')
    expect(n.body).toMatch(/^Reminder · 4:07\sPM$/)
    expect(n.target).toEqual({ kind: 'note', noteId: 'n1' })
  })

  it('labels recurring and late reminders and falls back for untitled notes', () => {
    expect(formatNotification({ ...base, recurrence: 'daily' }, opts).body).toMatch(/^Daily reminder/)
    expect(formatNotification({ ...base, recurrence: 'weekly', late: true }, opts).body).toMatch(/^Weekly reminder · was due/)
    expect(formatNotification({ ...base, noteTitle: '   ' }, opts).title).toBe('Untitled note')
  })

  it('describes missed occurrences and includes the date when not today', () => {
    const n = formatNotification({ ...base, recurrence: 'daily', missed: 3, late: true, scheduledAt: '2026-10-12T10:37:00.000Z' }, opts)
    expect(n.body).toMatch(/missed 4 times/)
    expect(n.body).toMatch(/Mon, Oct 12/)
  })

  it('collapses large batches into one summary that opens the reminders view', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...base, reminderId: `r${i}`, noteTitle: `Note ${i}` }))
    const out = formatBatch(many, opts)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('5 reminders are due')
    expect(out[0].target).toEqual({ kind: 'reminders' })
    expect(formatBatch(many.slice(0, 3), opts)).toHaveLength(3)
  })
})
