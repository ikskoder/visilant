import type { ImportedDomainStats } from '../history-import'
import { describe, expect, it } from 'vitest'
import { addVisitTimes, hostnameFromHistoryUrl, mapWithConcurrency, mergeImportedStats } from '../history-import'

function at(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime()
}

describe('hostnameFromHistoryUrl', () => {
  it('extracts the hostname of http(s) pages', () => {
    expect(hostnameFromHistoryUrl('https://example.com/a?b=c')).toBe('example.com')
    expect(hostnameFromHistoryUrl('http://sub.example.com/')).toBe('sub.example.com')
  })

  it('lowercases the hostname', () => {
    expect(hostnameFromHistoryUrl('https://Example.COM/')).toBe('example.com')
  })

  it('skips non-web schemes', () => {
    expect(hostnameFromHistoryUrl('file:///home/user/a.pdf')).toBeNull()
    expect(hostnameFromHistoryUrl('about:blank')).toBeNull()
    expect(hostnameFromHistoryUrl('chrome://extensions')).toBeNull()
    expect(hostnameFromHistoryUrl('data:text/html,hi')).toBeNull()
  })

  it('skips dotless hostnames', () => {
    expect(hostnameFromHistoryUrl('http://localhost:3000/')).toBeNull()
  })

  it('skips missing and unparseable URLs', () => {
    expect(hostnameFromHistoryUrl(undefined)).toBeNull()
    expect(hostnameFromHistoryUrl('')).toBeNull()
    expect(hostnameFromHistoryUrl('not a url')).toBeNull()
  })
})

describe('addVisitTimes', () => {
  it('builds stats from the first batch of visits', () => {
    const days = new Set<string>()
    const result = addVisitTimes(undefined, [at(2026, 3, 7), at(2026, 3, 5)], days)

    expect(result).toEqual({ count: 2, firstSeen: at(2026, 3, 5), lastSeen: at(2026, 3, 7) })
    expect(days.size).toBe(2)
  })

  it('folds later batches into the running stats', () => {
    const days = new Set<string>()
    const first = addVisitTimes(undefined, [at(2026, 3, 7)], days)
    const second = addVisitTimes(first, [at(2022, 1, 1), at(2026, 3, 9)], days)

    expect(second).toEqual({ count: 3, firstSeen: at(2022, 1, 1), lastSeen: at(2026, 3, 9) })
    expect(days.size).toBe(3)
  })

  it('counts repeat visits on one day as one active day', () => {
    const days = new Set<string>()
    addVisitTimes(undefined, [at(2026, 3, 7, 9), at(2026, 3, 7, 14), at(2026, 3, 7, 21)], days)
    expect(days.size).toBe(1)
  })

  it('ignores invalid timestamps and returns the input untouched when nothing is left', () => {
    const days = new Set<string>()
    const existing: ImportedDomainStats = { count: 1, firstSeen: 10, lastSeen: 10 }

    expect(addVisitTimes(existing, [0, Number.NaN, -5], days)).toBe(existing)
    expect(addVisitTimes(undefined, [], days)).toBeUndefined()
    expect(days.size).toBe(0)
  })
})

describe('mergeImportedStats', () => {
  it('writes a complete record when nothing was stored', () => {
    const imported = { count: 184, firstSeen: at(2022, 3, 14), lastSeen: at(2026, 3, 7), activeDays: 37 }

    expect(mergeImportedStats(undefined, imported)).toEqual({
      count: 184,
      firstSeen: at(2022, 3, 14),
      lastSeen: at(2026, 3, 7),
      activeDays: 37,
      ignored: false,
    })
  })

  it('is idempotent — importing twice does not inflate anything', () => {
    const imported = { count: 184, firstSeen: at(2022, 3, 14), lastSeen: at(2026, 3, 7), activeDays: 37 }
    const once = mergeImportedStats(undefined, imported)

    expect(mergeImportedStats(once, imported)).toEqual(once)
  })

  it('keeps the extension-side count when it is higher than the history', () => {
    // History can be cleared; our own counter must not be lowered by an import
    const existing = { count: 300, lastSeen: at(2026, 3, 7), ignored: false }
    const imported = { count: 12, firstSeen: at(2026, 3, 1), lastSeen: at(2026, 3, 5), activeDays: 2 }

    expect(mergeImportedStats(existing, imported).count).toBe(300)
  })

  it('takes the earliest firstSeen and the latest lastSeen', () => {
    const existing = { count: 5, firstSeen: at(2024, 6, 1), lastSeen: at(2026, 3, 7), ignored: false }
    const imported = { count: 5, firstSeen: at(2022, 1, 1), lastSeen: at(2026, 1, 1), activeDays: 3 }
    const merged = mergeImportedStats(existing, imported)

    expect(merged.firstSeen).toBe(at(2022, 1, 1))
    expect(merged.lastSeen).toBe(at(2026, 3, 7))
  })

  it('never touches the ignored flag', () => {
    const existing = { count: 1, lastSeen: at(2026, 3, 7), ignored: true }
    expect(mergeImportedStats(existing, { count: 9, lastSeen: at(2026, 3, 7) }).ignored).toBe(true)
  })

  it('leaves firstSeen absent when a quick import supplies none', () => {
    const merged = mergeImportedStats(undefined, { count: 9, lastSeen: at(2026, 3, 7) })

    expect(merged.firstSeen).toBeUndefined()
    expect(merged.activeDays).toBeUndefined()
  })
})

describe('mapWithConcurrency', () => {
  it('runs every item', async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item)
    })

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0

    await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
    })

    expect(peak).toBeLessThanOrEqual(4)
  })

  it('stops early when asked to', async () => {
    let processed = 0
    await mapWithConcurrency(
      Array.from({ length: 100 }, (_, i) => i),
      2,
      async () => {
        processed++
        await new Promise(resolve => setTimeout(resolve, 1))
      },
      () => processed >= 10,
    )

    expect(processed).toBeLessThan(100)
  })

  it('handles an empty list', async () => {
    await expect(mapWithConcurrency([], 4, async () => {})).resolves.toBeUndefined()
  })
})
