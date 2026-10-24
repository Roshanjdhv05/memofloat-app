import { describe, expect, it } from 'vitest'
import {
  advancePast,
  localDayBounds,
  localTimeOf,
  nextOccurrenceAfter,
  reanchor,
  utcToWall,
  wallToUtc
} from '../../../electron/services/recurrence'

const iso = (d: Date) => d.toISOString()

describe('UTC <-> local conversion', () => {
  it('converts a local wall time in Asia/Calcutta (UTC+5:30, no DST) to UTC', () => {
    expect(iso(wallToUtc({ year: 2026, month: 10, day: 14, hour: 16, minute: 7 }, 'Asia/Calcutta'))).toBe('2026-10-14T10:37:00.000Z')
    expect(localTimeOf(new Date('2026-10-14T10:37:00Z'), 'Asia/Calcutta')).toBe('16:07')
  })

  it('round-trips across zones, including negative offsets', () => {
    const utc = new Date('2026-01-15T03:30:00Z')
    for (const zone of ['America/Los_Angeles', 'Europe/London', 'Australia/Sydney', 'Pacific/Kiritimati', 'Asia/Kathmandu']) {
      const w = utcToWall(utc, zone)
      expect(iso(wallToUtc(w, zone))).toBe(iso(utc))
    }
  })

  it('computes local day bounds that are 23h long on the spring-forward day', () => {
    // US DST began 2026-03-08 in America/New_York
    const { start, startOfTomorrow } = localDayBounds(new Date('2026-03-08T15:00:00Z'), 'America/New_York')
    expect(iso(start)).toBe('2026-03-08T05:00:00.000Z')
    expect(iso(startOfTomorrow)).toBe('2026-03-09T04:00:00.000Z')
    expect((startOfTomorrow.getTime() - start.getTime()) / 3_600_000).toBe(23)
  })
})

describe('daylight-saving transitions', () => {
  const daily = { recurrence: 'daily' as const, localTime: '09:00', timeZone: 'America/New_York' }

  it('keeps 09:00 local across spring-forward (UTC instant shifts by one hour)', () => {
    // Saturday 2026-03-07 09:00 EST = 14:00Z ; Sunday 2026-03-08 09:00 EDT = 13:00Z
    const before = new Date('2026-03-07T14:00:00Z')
    const next = nextOccurrenceAfter(before, daily)
    expect(iso(next)).toBe('2026-03-08T13:00:00.000Z')
    expect(localTimeOf(next, 'America/New_York')).toBe('09:00')
  })

  it('keeps 09:00 local across fall-back', () => {
    // 2026-11-01 DST ends in New York
    const next = nextOccurrenceAfter(new Date('2026-10-31T13:00:00Z'), daily)
    expect(iso(next)).toBe('2026-11-01T14:00:00.000Z') // 09:00 EST
    expect(localTimeOf(next, 'America/New_York')).toBe('09:00')
  })

  it('resolves a non-existent local time (02:30 on spring-forward day) to the first valid instant', () => {
    const t = wallToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York')
    // 02:30 does not exist; result must be a real instant right after the gap (03:30 EDT = 07:30Z)
    expect(iso(t)).toBe('2026-03-08T07:30:00.000Z')
  })

  it('resolves an ambiguous local time (01:30 on fall-back day) to the first occurrence', () => {
    const t = wallToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York')
    expect(iso(t)).toBe('2026-11-01T05:30:00.000Z') // 01:30 EDT, the first of the two
  })

  it('weekly reminders stay on the same weekday and local time across DST', () => {
    const weekly = { recurrence: 'weekly' as const, localTime: '18:00', timeZone: 'Europe/London', weekday: 1 } // Monday
    const next = nextOccurrenceAfter(new Date('2026-10-19T17:00:00Z'), weekly) // Mon 18:00 BST is 17:00Z
    expect(iso(next)).toBe('2026-10-26T18:00:00.000Z') // clocks went back on Oct 25 -> GMT
    expect(localTimeOf(next, 'Europe/London')).toBe('18:00')
    expect(utcToWall(next, 'Europe/London').weekday).toBe(1)
  })
})

describe('advancePast', () => {
  const spec = { recurrence: 'daily' as const, localTime: '09:00', timeZone: 'UTC' }

  it('reports a single due occurrence and the next one', () => {
    const r = advancePast(new Date('2026-10-14T09:00:00Z'), spec, new Date('2026-10-14T09:00:30Z'))
    expect(r.dueCount).toBe(1)
    expect(iso(r.latestDue)).toBe('2026-10-14T09:00:00.000Z')
    expect(iso(r.next)).toBe('2026-10-15T09:00:00.000Z')
  })

  it('collapses many missed occurrences into one', () => {
    const r = advancePast(new Date('2026-10-10T09:00:00Z'), spec, new Date('2026-10-14T12:00:00Z'))
    expect(r.dueCount).toBe(5)
    expect(iso(r.latestDue)).toBe('2026-10-14T09:00:00.000Z')
    expect(iso(r.next)).toBe('2026-10-15T09:00:00.000Z')
  })

  it('is bounded even after years of downtime', () => {
    const r = advancePast(new Date('2000-01-01T09:00:00Z'), spec, new Date('2026-10-14T12:00:00Z'))
    expect(r.next.getTime()).toBeGreaterThan(new Date('2026-10-14T12:00:00Z').getTime())
  })
})

describe('time-zone change', () => {
  it('keeps wall-clock time and weekday when the device moves zone', () => {
    // Weekly Wednesday 09:00 in New York, device now in Asia/Calcutta
    const scheduled = new Date('2026-10-21T13:00:00Z') // Wed 09:00 EDT
    const next = reanchor(scheduled, 'weekly', '09:00', 'America/New_York', 'Asia/Calcutta', new Date('2026-10-15T00:00:00Z'))
    expect(localTimeOf(next, 'Asia/Calcutta')).toBe('09:00')
    expect(utcToWall(next, 'Asia/Calcutta').weekday).toBe(3)
  })
})
