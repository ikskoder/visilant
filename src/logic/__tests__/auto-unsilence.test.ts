import type { FamiliaritySettings } from '../familiarity'
import type { SiteVisitData } from '../storage'
import { describe, expect, it } from 'vitest'
import { applySilence, canAutoLift, familiarSilencedHosts, liftSilence } from '../auto-unsilence'
import { DAY_MS } from '../familiarity'
import { mergeImportedStats } from '../history-import'
import { applyVisit } from '../visit-stats'
import { mergeVisitRecords } from '../www-fold'

const NOW = 1_700_000_000_000

// Ten visits over five days, known for ten – the shipped rules
const RULES: FamiliaritySettings = {
  visits: { enabled: true, min: 10 },
  activeDays: { enabled: true, min: 5 },
  age: { enabled: true, min: 10 },
  mode: 'all',
  atLeast: 2,
}

function record(count: number, extra: Partial<SiteVisitData> = {}): SiteVisitData {
  return { count, lastSeen: NOW - 1000, activeDays: 5, firstSeen: NOW - 30 * DAY_MS, ignored: false, ...extra }
}

describe('canAutoLift', () => {
  it('lifts a silence once the site is familiar', () => {
    expect(canAutoLift(record(12, { ignored: true }), RULES, NOW)).toBe(true)
  })

  it('leaves a silence on a site that is not familiar yet', () => {
    expect(canAutoLift(record(3, { ignored: true }), RULES, NOW)).toBe(false)
  })

  it('has nothing to lift on a site that is not silenced', () => {
    expect(canAutoLift(record(12), RULES, NOW)).toBe(false)
    expect(canAutoLift(undefined, RULES, NOW)).toBe(false)
  })

  it('leaves a silence the user put on a site that was already familiar', () => {
    expect(canAutoLift(record(12, { ignored: true, silencedWhileFamiliar: true }), RULES, NOW)).toBe(false)
  })

  // Age grows with the clock, so a site can become familiar with no write at all
  it('sees a site that became familiar by age alone', () => {
    const young = record(12, { ignored: true, firstSeen: NOW - 5 * DAY_MS })
    expect(canAutoLift(young, RULES, NOW)).toBe(false)
    expect(canAutoLift(young, RULES, NOW + 6 * DAY_MS)).toBe(true)
  })
})

describe('applySilence', () => {
  it('notes a silence put on a familiar site', () => {
    expect(applySilence(record(12), true, RULES, NOW).silencedWhileFamiliar).toBe(true)
  })

  it('does not note a silence put on an unfamiliar site', () => {
    expect(applySilence(record(3), true, RULES, NOW)).not.toHaveProperty('silencedWhileFamiliar')
  })

  it('drops the note with the silence', () => {
    const silenced = applySilence(record(12), true, RULES, NOW)
    const resumed = applySilence(silenced, false, RULES, NOW)
    expect(resumed.ignored).toBe(false)
    expect(resumed).not.toHaveProperty('silencedWhileFamiliar')
  })
})

describe('liftSilence', () => {
  it('turns warnings back on and keeps the history', () => {
    const lifted = liftSilence(record(12, { ignored: true, silencedWhileFamiliar: true }))
    expect(lifted).toEqual(record(12))
  })
})

describe('familiarSilencedHosts', () => {
  it('names silenced sites that are familiar, noted or not, in order', () => {
    const hosts = familiarSilencedHosts({
      'b.example': record(12, { ignored: true }),
      'a.example': record(12, { ignored: true, silencedWhileFamiliar: true }),
      'new.example': record(2, { ignored: true }),
      'open.example': record(40),
      'settings': '{"theme":"dark"}',
    }, RULES, NOW)
    expect(hosts).toEqual(['a.example', 'b.example'])
  })
})

// The note is part of the silence. Every writer that rebuilds a record from its
// fields has to carry it, or the next visit forgets the user's click.
describe('the note survives every rewrite of the record', () => {
  const noted = record(12, { ignored: true, silencedWhileFamiliar: true })

  it('a visit', () => {
    expect(applyVisit(noted, NOW).silencedWhileFamiliar).toBe(true)
  })

  it('a history import', () => {
    const merged = mergeImportedStats(noted, { count: 20, lastSeen: NOW, firstSeen: NOW - 40 * DAY_MS, activeDays: 9 })
    expect(merged.silencedWhileFamiliar).toBe(true)
  })

  it('folding www into the bare name', () => {
    expect(mergeVisitRecords(record(2), noted).silencedWhileFamiliar).toBe(true)
    expect(mergeVisitRecords(noted, record(2)).silencedWhileFamiliar).toBe(true)
  })

  it('and none of them invents one', () => {
    const plain = record(12, { ignored: true })
    expect(applyVisit(plain, NOW)).not.toHaveProperty('silencedWhileFamiliar')
    expect(mergeVisitRecords(record(2), plain)).not.toHaveProperty('silencedWhileFamiliar')
  })
})
