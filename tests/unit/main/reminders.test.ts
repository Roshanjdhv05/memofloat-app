import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCore } from '../../../electron/services/core'
import { createHarness, createNote, patch, type Harness } from './helpers'

let h: Harness
let noteId: string

beforeEach(() => {
  h = createHarness({ start: '2026-10-14T10:00:00.000Z' })
  noteId = h.core.notes.create(createNote({ title: 'Call the dentist' })).id
})
afterEach(() => h.cleanup())

const at = (iso: string, recurrence: 'none' | 'daily' | 'weekly' = 'none') =>
  h.core.reminders.create({ noteId, scheduledAt: iso, recurrence })

describe('creating, editing and cancelling', () => {
  it('stores the schedule in UTC with the device zone and local time', () => {
    const local = createHarness({ timeZone: 'Asia/Calcutta', start: '2026-10-14T10:00:00.000Z' })
    try {
      const n = local.core.notes.create(createNote({ title: 'x' }))
      const r = local.core.reminders.create({ noteId: n.id, scheduledAt: '2026-10-14T13:30:00.000Z', recurrence: 'daily' })
      expect(r).toMatchObject({ scheduledAt: '2026-10-14T13:30:00.000Z', timeZone: 'Asia/Calcutta', localTime: '19:00', status: 'scheduled' })
    } finally {
      local.cleanup()
    }
  })

  it('rejects reminders in the past, for unknown notes and with malformed times', () => {
    expect(() => at('2026-10-14T09:00:00.000Z')).toThrow(/future/i)
    expect(() => h.core.reminders.create({ noteId: 'nope', scheduledAt: '2026-10-15T09:00:00.000Z', recurrence: 'none' })).toThrow(/not found/i)
  })

  it('edits time and recurrence and re-arms the reminder', () => {
    const r = at('2026-10-14T12:00:00.000Z')
    const updated = h.core.reminders.update({ id: r.id, scheduledAt: '2026-10-14T15:00:00.000Z', recurrence: 'weekly' })
    expect(updated).toMatchObject({ scheduledAt: '2026-10-14T15:00:00.000Z', recurrence: 'weekly', status: 'scheduled' })
  })

  it('cancels and completes without firing', () => {
    const a = at('2026-10-14T12:00:00.000Z')
    const b = at('2026-10-14T13:00:00.000Z')
    h.core.reminders.cancel(a.id)
    h.core.reminders.complete(b.id)
    h.clock.set('2026-10-14T14:00:00.000Z')
    h.core.reminders.processDue()
    expect(h.notifier.all).toHaveLength(0)
    expect(h.core.reminders.list({ scope: 'history' }).map((r) => r.status).sort()).toEqual(['cancelled', 'completed'])
  })

  it('removing a reminder deletes it', () => {
    const r = at('2026-10-14T12:00:00.000Z')
    h.core.reminders.remove(r.id)
    expect(h.core.reminders.forNote(noteId)).toEqual([])
  })
})

describe('firing a one-time reminder', () => {
  it('notifies once with the note title when due', () => {
    at('2026-10-14T12:00:00.000Z')
    h.clock.set('2026-10-14T11:59:59.000Z')
    expect(h.core.reminders.processDue().notified).toBe(0)
    h.clock.set('2026-10-14T12:00:01.000Z')
    expect(h.core.reminders.processDue().notified).toBe(1)
    expect(h.notifier.all[0]).toMatchObject({ noteId, noteTitle: 'Call the dentist', recurrence: 'none', missed: 0, late: false })
  })

  it('never produces a duplicate notification for the same occurrence', () => {
    at('2026-10-14T12:00:00.000Z')
    h.clock.set('2026-10-14T12:00:05.000Z')
    h.core.reminders.processDue()
    h.core.reminders.processDue()
    h.clock.advance(60_000)
    h.core.reminders.processDue()
    expect(h.notifier.all).toHaveLength(1)
  })

  it('stays visible as overdue (and fired) until the user resolves it', () => {
    const r = at('2026-10-14T12:00:00.000Z')
    h.clock.set('2026-10-14T12:30:00.000Z')
    h.core.reminders.processDue()
    const overdue = h.core.reminders.list({ scope: 'overdue' })
    expect(overdue.map((x) => x.id)).toEqual([r.id])
    expect(overdue[0]).toMatchObject({ overdue: true, fired: true, noteTitle: 'Call the dentist' })
    h.core.reminders.complete(r.id)
    expect(h.core.reminders.list({ scope: 'overdue' })).toHaveLength(0)
  })

  it('skips notifications for archived notes without losing the reminder', () => {
    at('2026-10-14T12:00:00.000Z')
    h.core.notes.update(noteId, patch({ isArchived: true }))
    h.clock.set('2026-10-14T12:01:00.000Z')
    h.core.reminders.processDue()
    expect(h.notifier.all).toHaveLength(0)
  })

  it('does not notify when notifications are disabled in settings but still records the occurrence', () => {
    h.core.repos.settings.update({ notificationsEnabled: false })
    at('2026-10-14T12:00:00.000Z')
    h.clock.set('2026-10-14T12:01:00.000Z')
    h.core.reminders.processDue()
    expect(h.notifier.all).toHaveLength(0)
    expect(h.core.reminders.list({ scope: 'overdue' })[0].fired).toBe(true)
  })
})

describe('recurring reminders', () => {
  it('daily: fires then advances to the next day at the same local time', () => {
    const r = at('2026-10-14T12:00:00.000Z', 'daily')
    h.clock.set('2026-10-14T12:00:02.000Z')
    h.core.reminders.processDue()
    const after = h.core.repos.reminders.get(r.id)
    expect(after?.scheduledAt).toBe('2026-10-15T12:00:00.000Z')
    expect(after?.lastNotifiedOccurrence).toBe('2026-10-14T12:00:00.000Z')
    expect(after?.status).toBe('scheduled')
    h.core.reminders.processDue()
    expect(h.notifier.all).toHaveLength(1)
  })

  it('weekly: advances seven days', () => {
    const r = at('2026-10-14T12:00:00.000Z', 'weekly')
    h.clock.set('2026-10-14T12:00:01.000Z')
    h.core.reminders.processDue()
    expect(h.core.repos.reminders.get(r.id)?.scheduledAt).toBe('2026-10-21T12:00:00.000Z')
  })

  it('fires every occurrence across several days', () => {
    at('2026-10-14T12:00:00.000Z', 'daily')
    for (const day of ['14', '15', '16']) {
      h.clock.set(`2026-10-${day}T12:00:01.000Z`)
      h.core.reminders.processDue()
    }
    expect(h.notifier.all.map((n) => n.scheduledAt)).toEqual([
      '2026-10-14T12:00:00.000Z',
      '2026-10-15T12:00:00.000Z',
      '2026-10-16T12:00:00.000Z'
    ])
  })

  it('keeps the series active after the notification and ends it on complete', () => {
    const r = at('2026-10-14T12:00:00.000Z', 'daily')
    h.clock.set('2026-10-14T12:00:01.000Z')
    h.core.reminders.processDue()
    expect(h.core.reminders.list({ scope: 'upcoming' }).map((x) => x.id)).toEqual([r.id])
    h.core.reminders.complete(r.id)
    expect(h.core.reminders.list({ scope: 'upcoming' })).toHaveLength(0)
  })
})

describe('startup reconciliation after the app was closed', () => {
  it('notifies an overdue one-time reminder once, marked late', () => {
    at('2026-10-14T12:00:00.000Z')
    h.clock.set('2026-10-14T18:00:00.000Z')
    const result = h.core.reminders.reconcile()
    expect(result.notified).toBe(1)
    expect(h.notifier.all[0]).toMatchObject({ late: true, scheduledAt: '2026-10-14T12:00:00.000Z' })
    // a second launch does not announce it again
    h.core.reminders.reconcile()
    expect(h.notifier.all).toHaveLength(1)
  })

  it('does not re-announce a reminder that fired before the previous shutdown', () => {
    at('2026-10-14T12:00:00.000Z')
    h.clock.set('2026-10-14T12:00:30.000Z')
    h.core.reminders.processDue()
    expect(h.notifier.all).toHaveLength(1)

    // simulate restart: a brand-new service instance over the same database
    h.core.reminders.stop()
    h.clock.set('2026-10-14T20:00:00.000Z')
    h.core.reminders.start()
    expect(h.notifier.all).toHaveLength(1)
  })

  it('collapses missed recurring occurrences into one notification that reports how many were missed', () => {
    const r = at('2026-10-14T12:00:00.000Z', 'daily')
    h.clock.set('2026-10-18T13:00:00.000Z') // app was closed for four days
    h.core.reminders.reconcile()
    expect(h.notifier.all).toHaveLength(1)
    expect(h.notifier.all[0]).toMatchObject({ missed: 4, scheduledAt: '2026-10-18T12:00:00.000Z', late: true })
    expect(h.core.repos.reminders.get(r.id)?.scheduledAt).toBe('2026-10-19T12:00:00.000Z')
  })

  it('batches several simultaneous reminders into a single notifier call', () => {
    for (let i = 0; i < 5; i++) at(`2026-10-14T1${i}:30:00.000Z`)
    h.clock.set('2026-10-14T23:00:00.000Z')
    h.core.reminders.reconcile()
    expect(h.notifier.batches).toHaveLength(1)
    expect(h.notifier.batches[0]).toHaveLength(5)
  })
})

describe('time-zone changes', () => {
  it('re-anchors recurring reminders to the new zone and keeps the wall-clock time', () => {
    const ny = createHarness({ timeZone: 'America/New_York', start: '2026-10-14T10:00:00.000Z', file: true })
    try {
      const n = ny.core.notes.create(createNote({ title: 'Standup' }))
      const r = ny.core.reminders.create({ noteId: n.id, scheduledAt: '2026-10-15T13:00:00.000Z', recurrence: 'daily' }) // 09:00 EDT
      expect(r.localTime).toBe('09:00')

      // same database, device now in Asia/Calcutta
      const core2 = createCore({
        db: ny.core.db,
        backupDir: ny.dir,
        clock: ny.clock.now,
        notifier: ny.notifier,
        timers: ny.timers,
        timeZone: () => 'Asia/Calcutta'
      })
      core2.reminders.reconcile()
      const after = core2.repos.reminders.get(r.id)
      expect(after?.timeZone).toBe('Asia/Calcutta')
      expect(after?.localTime).toBe('09:00')
      expect(after?.scheduledAt).toBe('2026-10-15T03:30:00.000Z') // 09:00 IST
      core2.reminders.stop()
    } finally {
      ny.cleanup()
    }
  })
})

describe('timer arming', () => {
  it('arms a single timer for the earliest pending reminder and replaces it on change', () => {
    at('2026-10-14T10:30:00.000Z')
    h.core.reminders.arm()
    expect(h.timers.active).toHaveLength(1)
    expect(h.timers.active[0].ms).toBe(5 * 60_000) // 30 min away, but capped so clock changes self-heal

    at('2026-10-14T10:00:30.000Z')
    expect(h.timers.active).toHaveLength(1)
    expect(h.timers.active[0].ms).toBeLessThan(31_000)
  })

  it('does not arm any timer when nothing is pending', () => {
    h.core.reminders.arm()
    expect(h.timers.active).toHaveLength(0)
  })

  it('fires through the timer callback and re-arms for the next occurrence', () => {
    at('2026-10-14T10:00:20.000Z', 'daily')
    const first = h.timers.active[0]
    const armedBefore = h.timers.scheduled.length
    h.clock.set('2026-10-14T10:00:21.000Z')
    first.fn()
    expect(h.notifier.all).toHaveLength(1)
    expect(h.timers.scheduled.length).toBe(armedBefore + 1) // re-armed for the next occurrence
    expect(h.timers.scheduled.at(-1)?.cancelled).toBe(false)
  })
})
