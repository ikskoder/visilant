import type { FamiliaritySettings } from '../familiarity'
import { describe, expect, it } from 'vitest'
import { metricAggregation, metricReading, metricSortValue } from '../domain-metric'
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

/*
 * The family's own figures are `aggregateFamiliarityStats`, tested with the rest
 * of the familiarity rules. They used to be folded here as well, for the number
 * that stood beside the related-domain list's heading, and that number is gone –
 * the base domain draws the whole row of facts under its own name instead.
 */
describe('naming how a family figure was folded', () => {
  // The row on the base domain card puts this word under every heading, because
  // the four figures in it are not arrived at the same way and a row that does
  // not say so invites the reader to compare a sum with a maximum
  it('adds visits up and takes the best single host for everything else', () => {
    expect(metricAggregation('visits')).toBe('total')
    expect(metricAggregation('activeDays')).toBe('max')
    expect(metricAggregation('age')).toBe('max')
    expect(metricAggregation('checks')).toBe('max')
  })
})
