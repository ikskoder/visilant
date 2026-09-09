import type { FamiliaritySettings } from '../familiarity'
import { describe, expect, it } from 'vitest'
import { DOMAIN_METRICS, metricAggregation, metricReading, metricSortValue, metricTotal } from '../domain-metric'
import { DAY_MS, defaultFamiliaritySettings } from '../familiarity'

const NOW = Date.UTC(2026, 8, 8)

const rules: FamiliaritySettings = defaultFamiliaritySettings

function daysAgo(days: number) {
  return NOW - days * DAY_MS
}

describe('one host, one metric', () => {
  it('reads each fact off the record', () => {
    const stats = { count: 12, activeDays: 6, firstSeen: daysAgo(40) }

    expect(metricReading('visits', stats, rules, NOW).value).toBe(12)
    expect(metricReading('activeDays', stats, rules, NOW).value).toBe(6)
    expect(metricReading('age', stats, rules, NOW).value).toBe(40)
    // All three bars cleared, out of the three that are switched on
    expect(metricReading('checks', stats, rules, NOW)).toMatchObject({ value: 3, outOf: 3, met: true })
  })

  it('leaves a fact the record never carried as unknown rather than zero', () => {
    const reading = metricReading('activeDays', { count: 12 }, rules, NOW)

    expect(reading.value).toBeUndefined()
    // An unrecorded fact fails its check, the same as everywhere else
    expect(reading.met).toBe(false)
    // And sorts below a genuine zero, which is a fact and not a gap
    expect(metricSortValue(reading)).toBeLessThan(0)
  })

  it('says nothing about a check the user has switched off', () => {
    const off = { ...rules, activeDays: { enabled: false, min: 5 } }
    const reading = metricReading('activeDays', { count: 12, activeDays: 6 }, off, NOW)

    // The number is still worth drawing – it just carries no verdict, so the
    // surface leaves it uncoloured
    expect(reading.value).toBe(6)
    expect(reading.met).toBeUndefined()
  })

  it('carries the date an age reading was measured from', () => {
    const firstSeen = daysAgo(40)

    expect(metricReading('age', { count: 1, firstSeen }, rules, NOW).firstSeen).toBe(firstSeen)
    expect(metricReading('visits', { count: 1, firstSeen }, rules, NOW).firstSeen).toBeUndefined()
  })
})

describe('a whole domain family', () => {
  // Deliberately two hosts that each fail a different check: the busy one is
  // new, and the old one has barely been opened
  const family = [
    { count: 30, activeDays: 9, firstSeen: daysAgo(5) },
    { count: 12, activeDays: 4, firstSeen: daysAgo(400) },
  ]

  it('adds visits up and nothing else', () => {
    expect(metricAggregation('visits')).toBe('total')
    expect(metricTotal('visits', family, rules, NOW).value).toBe(42)
  })

  it('takes the largest single member for active days', () => {
    expect(metricAggregation('activeDays')).toBe('max')
    // The same day spent on two hosts of one family is one day of knowing it
    expect(metricTotal('activeDays', family, rules, NOW).value).toBe(9)
  })

  it('counts age from the earliest member, which is the largest number of days', () => {
    const reading = metricTotal('age', family, rules, NOW)

    expect(metricAggregation('age')).toBe('max')
    expect(reading.value).toBe(400)
    expect(reading.firstSeen).toBe(daysAgo(400))
  })

  it('gives the family the best checks any one host passes, not a sum of them', () => {
    // Neither host clears every bar on its own, and the folded family would:
    // 42 visits, 9 active days and 400 days of age is three checks out of three,
    // which no host in this family actually holds.
    const reading = metricTotal('checks', family, rules, NOW)

    expect(metricAggregation('checks')).toBe('max')
    expect(reading).toMatchObject({ value: 2, outOf: 3, met: false })
  })

  it('answers for an empty family without inventing a record', () => {
    for (const metric of DOMAIN_METRICS) {
      const reading = metricTotal(metric, [], rules, NOW)
      expect(reading.met).not.toBe(true)
    }

    expect(metricTotal('visits', [], rules, NOW).value).toBe(0)
    expect(metricTotal('activeDays', [], rules, NOW).value).toBeUndefined()
  })
})
