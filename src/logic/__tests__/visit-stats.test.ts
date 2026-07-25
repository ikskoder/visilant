import { describe, expect, it } from 'vitest'
import { applyVisit, dayKey, isTrackableHostname, VISIT_DEBOUNCE_MS } from '../visit-stats'

// Local noon, so the day key cannot slip into a neighbouring day in any timezone
function at(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

describe('dayKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(dayKey(at(2026, 3, 7))).toBe('2026-03-07')
    expect(dayKey(at(2026, 12, 31))).toBe('2026-12-31')
  })

  it('gives the same key for two moments on the same local day', () => {
    expect(dayKey(at(2026, 3, 7, 0, 1))).toBe(dayKey(at(2026, 3, 7, 23, 59)))
  })

  it('gives different keys across midnight', () => {
    expect(dayKey(at(2026, 3, 7, 23, 59))).not.toBe(dayKey(at(2026, 3, 8, 0, 1)))
  })
})

describe('isTrackableHostname', () => {
  it('tracks dotted hostnames', () => {
    expect(isTrackableHostname('example.com')).toBe(true)
    expect(isTrackableHostname('a.b.example.co.uk')).toBe(true)
  })

  it('skips dotless hostnames', () => {
    expect(isTrackableHostname('localhost')).toBe(false)
    expect(isTrackableHostname('intranet')).toBe(false)
  })
})

describe('applyVisit', () => {
  const now = at(2026, 3, 7, 12)

  it('creates a complete record for a first visit', () => {
    expect(applyVisit(undefined, now)).toEqual({
      count: 1,
      firstSeen: now,
      lastSeen: now,
      activeDays: 1,
      ignored: false,
    })
  })

  it('increments the count once the debounce window has passed', () => {
    const existing = { count: 4, firstSeen: at(2026, 1, 1), lastSeen: now, activeDays: 3, ignored: false }
    const result = applyVisit(existing, now + VISIT_DEBOUNCE_MS + 1)
    expect(result.count).toBe(5)
  })

  it('does not increment the count inside the debounce window', () => {
    const existing = { count: 4, firstSeen: at(2026, 1, 1), lastSeen: now, activeDays: 3, ignored: false }
    const result = applyVisit(existing, now + 1000)
    expect(result.count).toBe(4)
    expect(result.lastSeen).toBe(now + 1000)
  })

  it('never overwrites firstSeen', () => {
    const firstSeen = at(2022, 3, 14)
    const existing = { count: 90, firstSeen, lastSeen: now, activeDays: 12, ignored: false }
    expect(applyVisit(existing, now + VISIT_DEBOUNCE_MS + 1).firstSeen).toBe(firstSeen)
  })

  it('counts a new active day only when the local day changes', () => {
    const existing = { count: 4, firstSeen: at(2026, 1, 1), lastSeen: at(2026, 3, 7, 9), activeDays: 3, ignored: false }

    expect(applyVisit(existing, at(2026, 3, 7, 18)).activeDays).toBe(3)
    expect(applyVisit(existing, at(2026, 3, 8, 9)).activeDays).toBe(4)
  })

  it('leaves firstSeen and activeDays undefined on legacy records', () => {
    // Records written before those fields existed: guessing a date would present
    // an invention as a fact, so they stay empty until a history import runs
    const legacy = { count: 12, lastSeen: at(2026, 3, 1), ignored: false }
    const result = applyVisit(legacy, now)

    expect(result.firstSeen).toBeUndefined()
    expect(result.activeDays).toBeUndefined()
    expect(result.count).toBe(13)
  })

  it('preserves the ignored flag', () => {
    const existing = { count: 2, lastSeen: now, ignored: true }
    expect(applyVisit(existing, now + VISIT_DEBOUNCE_MS + 1).ignored).toBe(true)
  })
})
