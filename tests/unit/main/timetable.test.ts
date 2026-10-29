import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  timetableCreateSchema,
  timetablePatchSchema,
  timetableUpdateSchema,
  timetableEventCreateSchema,
  timetableEventPatchSchema,
  timetableEventUpdateSchema
} from '@shared/schemas'
import { createHarness, type Harness } from './helpers'

let h: Harness
beforeEach(() => {
  h = createHarness({ start: '2026-10-14T10:00:00.000Z' })
})
afterEach(() => h.cleanup())

describe('timetable management', () => {
  it('creates and lists timetables with defaults', () => {
    const input = timetableCreateSchema.parse({
      name: 'College Timetable',
      description: 'Fall semester classes',
      displayStyle: 'edge',
      defaultView: 'day'
    })
    const created = h.core.timetable.create(input)
    expect(created).toMatchObject({
      name: 'College Timetable',
      description: 'Fall semester classes',
      displayStyle: 'edge',
      defaultView: 'day',
      isActive: true
    })
    expect(created.createdAt).toBe('2026-10-14T10:00:00.000Z')

    const list = h.core.timetable.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
  })

  it('updates timetable metadata', () => {
    const created = h.core.timetable.create({ name: 'Work' })
    h.clock.advance(60_000)

    const patch = timetablePatchSchema.parse({
      name: 'Work & Projects',
      displayStyle: 'compact',
      defaultView: 'week'
    })
    const updateWrapper = timetableUpdateSchema.parse({
      id: created.id,
      patch
    })
    const updated = h.core.timetable.update(updateWrapper.id, updateWrapper.patch)

    expect(updated.name).toBe('Work & Projects')
    expect(updated.displayStyle).toBe('compact')
    expect(updated.defaultView).toBe('week')
    expect(updated.updatedAt).toBe('2026-10-14T10:01:00.000Z')
  })

  it('manages active timetable selection and fallback', () => {
    const t1 = h.core.timetable.create({ name: 'T1' })
    const t2 = h.core.timetable.create({ name: 'T2' })

    // t1 was created first and became active by default
    expect(h.core.timetable.getActive()?.id).toBe(t1.id)

    // Switch active to t2
    const switched = h.core.timetable.setActive(t2.id)
    expect(switched.isActive).toBe(true)
    expect(h.core.timetable.getActive()?.id).toBe(t2.id)
    expect(h.core.timetable.get(t1.id).isActive).toBe(false)

    // Delete active t2; t1 should fall back as active
    h.core.timetable.remove(t2.id)
    expect(h.core.timetable.getActive()?.id).toBe(t1.id)
  })

  it('duplicates a timetable and all of its events', () => {
    const original = h.core.timetable.create({ name: 'Daily Routine', description: 'Everyday habits' })
    const event = h.core.timetable.createEvent({
      timetableId: original.id,
      title: 'Morning Yoga',
      date: '2026-10-14',
      startTime: '07:00',
      endTime: '07:45',
      recurrence: 'daily',
      color: 'mint'
    })

    const copy = h.core.timetable.duplicate(original.id)
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Daily Routine (Copy)')
    expect(copy.description).toBe('Everyday habits')

    const copyEvents = h.core.timetable.listEvents({ timetableId: copy.id })
    expect(copyEvents).toHaveLength(1)
    expect(copyEvents[0].id).not.toBe(event.id)
    expect(copyEvents[0].timetableId).toBe(copy.id)
    expect(copyEvents[0].title).toBe('Morning Yoga')
    expect(copyEvents[0].startTime).toBe('07:00')
    expect(copyEvents[0].endTime).toBe('07:45')
  })

  it('rejects empty timetable name', () => {
    expect(() => h.core.timetable.create({ name: '   ' })).toThrow(/empty/i)
  })
})

describe('timetable events', () => {
  let timetableId: string

  beforeEach(() => {
    timetableId = h.core.timetable.create({ name: 'Schedule' }).id
  })

  it('creates, reads, updates and deletes events', () => {
    const input = timetableEventCreateSchema.parse({
      timetableId,
      title: 'Math Lecture',
      description: 'Room 302',
      date: '2026-10-15',
      startTime: '09:00',
      endTime: '10:30',
      color: 'sky',
      category: 'study',
      recurrence: 'weekly'
    })

    const ev = h.core.timetable.createEvent(input)
    expect(ev).toMatchObject({
      timetableId,
      title: 'Math Lecture',
      description: 'Room 302',
      date: '2026-10-15',
      startTime: '09:00',
      endTime: '10:30',
      color: 'sky',
      category: 'study',
      recurrence: 'weekly'
    })

    const fetched = h.core.timetable.getEvent(ev.id)
    expect(fetched).toEqual(ev)

    const patch = timetableEventPatchSchema.parse({
      title: 'Advanced Math Lecture',
      startTime: '09:15',
      endTime: '10:45'
    })
    const updateWrapper = timetableEventUpdateSchema.parse({
      id: ev.id,
      patch
    })
    const updated = h.core.timetable.updateEvent(updateWrapper.id, updateWrapper.patch)
    expect(updated.title).toBe('Advanced Math Lecture')
    expect(updated.startTime).toBe('09:15')

    const del = h.core.timetable.deleteEvent(ev.id)
    expect(del.deleted).toBe(true)
    expect(() => h.core.timetable.getEvent(ev.id)).toThrow(/not found/i)
  })

  it('filters and sorts events chronologically', () => {
    h.core.timetable.createEvent({
      timetableId,
      title: 'Lunch',
      date: '2026-10-15',
      startTime: '12:00',
      endTime: '13:00'
    })
    h.core.timetable.createEvent({
      timetableId,
      title: 'Breakfast',
      date: '2026-10-15',
      startTime: '08:30',
      endTime: '09:00'
    })
    h.core.timetable.createEvent({
      timetableId,
      title: 'Dinner',
      date: '2026-10-16',
      startTime: '19:00',
      endTime: '20:00'
    })

    const dayEvents = h.core.timetable.listEvents({ timetableId, date: '2026-10-15' })
    expect(dayEvents).toHaveLength(2)
    expect(dayEvents[0].title).toBe('Breakfast')
    expect(dayEvents[1].title).toBe('Lunch')

    const rangeEvents = h.core.timetable.listEvents({
      timetableId,
      startDate: '2026-10-15',
      endDate: '2026-10-16'
    })
    expect(rangeEvents).toHaveLength(3)
    expect(rangeEvents[2].title).toBe('Dinner')
  })
})

describe('recurrence expansion', () => {
  let timetableId: string

  beforeEach(() => {
    timetableId = h.core.timetable.create({ name: 'Recurring Calendar' }).id
  })

  it('expands daily events across queried date range', () => {
    h.core.timetable.createEvent({
      timetableId,
      title: 'Daily Standup',
      date: '2026-10-14',
      startTime: '09:30',
      endTime: '10:00',
      recurrence: 'daily'
    })

    const events = h.core.timetable.listEvents({
      timetableId,
      startDate: '2026-10-14',
      endDate: '2026-10-17'
    })

    expect(events).toHaveLength(4)
    expect(events.map((e) => e.date)).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17'
    ])
  })

  it('expands weekly events only on the matching day of week', () => {
    // 2026-10-14 is a Wednesday
    h.core.timetable.createEvent({
      timetableId,
      title: 'Weekly Team Sync',
      date: '2026-10-14',
      startTime: '14:00',
      endTime: '15:00',
      recurrence: 'weekly'
    })

    const events = h.core.timetable.listEvents({
      timetableId,
      startDate: '2026-10-14',
      endDate: '2026-10-28'
    })

    expect(events).toHaveLength(3)
    // Wednesdays: 14th, 21st, 28th
    expect(events.map((e) => e.date)).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-10-28'
    ])
  })

  it('expands monthly events on the matching day of month', () => {
    // 15th of each month
    h.core.timetable.createEvent({
      timetableId,
      title: 'Monthly Review',
      date: '2026-10-15',
      startTime: '16:00',
      endTime: '17:00',
      recurrence: 'monthly'
    })

    const events = h.core.timetable.listEvents({
      timetableId,
      startDate: '2026-10-01',
      endDate: '2026-12-31'
    })

    expect(events).toHaveLength(3)
    expect(events.map((e) => e.date)).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15'
    ])
  })
})
