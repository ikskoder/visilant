import type { FamiliaritySettings } from '../familiarity'
import { describe, expect, it } from 'vitest'
import {
  aggregateFamiliarityStats,
  daysSince,
  defaultFamiliaritySettings,
  enabledCriteria,
  evaluateFamiliarity,
  familiaritySignature,
  isFamiliar,
  normalizeFamiliarity,
  requiredMatches,
} from '../familiarity'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

/**
 * One check on, which is what the cases below vary from.
 *
 * Deliberately not the shipped defaults – those ask all three. A case about what
 * `any` does with two criteria should not change its meaning the day a default
 * does, so the base it starts from is spelled out here.
 */
const VISITS_ONLY: FamiliaritySettings = {
  ...defaultFamiliaritySettings,
  activeDays: { ...defaultFamiliaritySettings.activeDays, enabled: false },
  age: { ...defaultFamiliaritySettings.age, enabled: false },
}

function rules(patch: Partial<FamiliaritySettings> = {}): FamiliaritySettings {
  return { ...VISITS_ONLY, ...patch }
}

describe('evaluateFamiliarity', () => {
  it('asks all three checks with the shipped rules', () => {
    const shipped = defaultFamiliaritySettings
    const known = { count: 10, activeDays: 5, firstSeen: NOW - 10 * DAY }

    expect(isFamiliar(known, shipped, NOW)).toBe(true)
    expect(isFamiliar({ ...known, count: 9 }, shipped, NOW)).toBe(false)
    expect(isFamiliar({ ...known, activeDays: 4 }, shipped, NOW)).toBe(false)
    expect(isFamiliar({ ...known, firstSeen: NOW - 9 * DAY }, shipped, NOW)).toBe(false)
    // A record from before those two facts were kept cannot answer them, and an
    // unanswered check fails – which is why the migration leaves them off
    expect(isFamiliar({ count: 500 }, shipped, NOW)).toBe(false)
  })

  it('requires every enabled criterion in all mode', () => {
    const strict = rules({
      activeDays: { enabled: true, min: 5 },
      mode: 'all',
    })

    expect(isFamiliar({ count: 40, activeDays: 5 }, strict, NOW)).toBe(true)
    expect(isFamiliar({ count: 40, activeDays: 4 }, strict, NOW)).toBe(false)
    expect(isFamiliar({ count: 9, activeDays: 40 }, strict, NOW)).toBe(false)
  })

  it('takes any single criterion in any mode', () => {
    const loose = rules({
      activeDays: { enabled: true, min: 5 },
      mode: 'any',
    })

    expect(isFamiliar({ count: 1, activeDays: 5 }, loose, NOW)).toBe(true)
    expect(isFamiliar({ count: 10, activeDays: 1 }, loose, NOW)).toBe(true)
    expect(isFamiliar({ count: 1, activeDays: 1 }, loose, NOW)).toBe(false)
  })

  it('counts two out of three when asked for two', () => {
    const twoOfThree = rules({
      activeDays: { enabled: true, min: 5 },
      age: { enabled: true, min: 30 },
      mode: 'atLeast',
      atLeast: 2,
    })

    // Visits and age pass, active days do not
    expect(isFamiliar({ count: 20, activeDays: 2, firstSeen: NOW - 60 * DAY }, twoOfThree, NOW)).toBe(true)
    // Only age passes
    expect(isFamiliar({ count: 3, activeDays: 2, firstSeen: NOW - 60 * DAY }, twoOfThree, NOW)).toBe(false)
  })

  it('measures age in whole days since the first visit', () => {
    const byAge = rules({
      visits: { enabled: false, min: 10 },
      age: { enabled: true, min: 10 },
    })

    expect(isFamiliar({ count: 0, firstSeen: NOW - 10 * DAY }, byAge, NOW)).toBe(true)
    expect(isFamiliar({ count: 0, firstSeen: NOW - 9 * DAY }, byAge, NOW)).toBe(false)
  })

  it('fails a criterion whose fact was never recorded', () => {
    const byDays = rules({ activeDays: { enabled: true, min: 3 } })
    const verdict = evaluateFamiliarity({ count: 500 }, byDays, NOW)

    expect(verdict.familiar).toBe(false)
    expect(verdict.criteria.find(outcome => outcome.id === 'activeDays')).toMatchObject({ value: undefined, met: false })
  })

  it('reports which checks passed, for the criteria in play only', () => {
    const verdict = evaluateFamiliarity({ count: 12, activeDays: 9 }, rules(), NOW)

    expect(verdict.criteria).toHaveLength(1)
    expect(verdict.criteria[0]).toMatchObject({ id: 'visits', value: 12, required: 10, met: true })
    expect(verdict).toMatchObject({ met: 1, required: 1 })
  })

  it('falls back to visits when nothing is enabled at all', () => {
    const none = rules({
      visits: { enabled: false, min: 10 },
      activeDays: { enabled: false, min: 5 },
      age: { enabled: false, min: 10 },
    })

    expect(isFamiliar({ count: 10 }, none, NOW)).toBe(true)
    expect(isFamiliar({ count: 9 }, none, NOW)).toBe(false)
  })
})

describe('requiredMatches', () => {
  it('cannot ask for more checks than are switched on', () => {
    const impossible = rules({ mode: 'atLeast', atLeast: 3 })

    expect(enabledCriteria(impossible)).toEqual(['visits'])
    expect(requiredMatches(impossible)).toBe(1)
    expect(isFamiliar({ count: 10 }, impossible, NOW)).toBe(true)
  })

  it('follows the mode as criteria come and go', () => {
    expect(requiredMatches(rules({ mode: 'all' }))).toBe(1)
    expect(requiredMatches(rules({ mode: 'all', activeDays: { enabled: true, min: 5 } }))).toBe(2)
    expect(requiredMatches(rules({ mode: 'any', activeDays: { enabled: true, min: 5 } }))).toBe(1)
  })
})

describe('normalizeFamiliarity', () => {
  it('fills in the defaults for settings written by an older version', () => {
    expect(normalizeFamiliarity(undefined)).toEqual(defaultFamiliaritySettings)
    expect(normalizeFamiliarity({ visits: { enabled: true } })).toMatchObject({
      visits: { enabled: true, min: 10 },
    })
  })

  it('refuses a threshold nothing could clear', () => {
    expect(normalizeFamiliarity({ visits: { enabled: true, min: 0 } }).visits.min).toBe(10)
    expect(normalizeFamiliarity({ visits: { enabled: true, min: Number.NaN } }).visits.min).toBe(10)
  })

  it('keeps a hand-set threshold', () => {
    expect(normalizeFamiliarity({ visits: { enabled: true, min: 25 } }).visits.min).toBe(25)
  })
})

describe('aggregateFamiliarityStats', () => {
  it('adds visits, takes the largest day count and the earliest first visit', () => {
    const stats = aggregateFamiliarityStats([
      { count: 6, activeDays: 12, firstSeen: NOW - 10 * DAY },
      { count: 5, activeDays: 4, firstSeen: NOW - 200 * DAY },
      undefined,
    ])

    expect(stats).toEqual({ count: 11, activeDays: 12, firstSeen: NOW - 200 * DAY })
  })

  it('leaves what was never recorded undefined', () => {
    expect(aggregateFamiliarityStats([{ count: 3 }])).toEqual({
      count: 3,
      activeDays: undefined,
      firstSeen: undefined,
    })
  })
})

describe('familiaritySignature', () => {
  it('changes whenever the verdict could', () => {
    const base = familiaritySignature(rules())

    expect(familiaritySignature(rules({ visits: { enabled: true, min: 11 } }))).not.toBe(base)
    expect(familiaritySignature(rules({ activeDays: { enabled: true, min: 5 } }))).not.toBe(base)
    // With one criterion on, every mode comes to the same rule
    expect(familiaritySignature(rules({ mode: 'any' }))).toBe(base)
    // With two, the mode is the whole difference
    const two = rules({ activeDays: { enabled: true, min: 5 } })
    expect(familiaritySignature({ ...two, mode: 'any' })).not.toBe(familiaritySignature({ ...two, mode: 'all' }))
  })

  it('ignores the threshold of a criterion that is switched off', () => {
    expect(familiaritySignature(rules({ age: { enabled: false, min: 99 } })))
      .toBe(familiaritySignature(rules()))
  })
})

describe('daysSince', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysSince(NOW - 3 * DAY, NOW)).toBe(3)
    expect(daysSince(NOW - DAY + 1000, NOW)).toBe(0)
    expect(daysSince(NOW + 5 * DAY, NOW)).toBe(0)
  })
})
