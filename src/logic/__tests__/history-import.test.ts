import type { ImportedDomainStats } from '../history-import'
import { describe, expect, it } from 'vitest'
import { addVisitTimes, describeImportHealth, hasVisitRecords, hostnameFromHistoryUrl, isHeldByAnother, mapWithConcurrency, mergeImportedStats, newImportRunId, shouldAutoImport } from '../history-import'

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
    expect(hostnameFromHistoryUrl('file:///home/user/a.pdf')).toBeNull() // host-path-ok: invented, not from a real machine
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

  it('is idempotent – importing twice does not inflate anything', () => {
    const imported = { count: 184, firstSeen: at(2022, 3, 14), lastSeen: at(2026, 3, 7), activeDays: 37 }
    const once = mergeImportedStats(undefined, imported)

    expect(mergeImportedStats(once, imported)).toEqual(once)
  })

  it('keeps the extension-side count when it is higher than the history', () => {
    // History can be cleared, so our own counter must not be lowered by an import
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

describe('hasVisitRecords', () => {
  it('recognises a stored visit record', () => {
    expect(hasVisitRecords({ 'example.com': { count: 3, lastSeen: 1, ignored: false } })).toBe(true)
  })

  it('ignores the internal keys that share storage.local with visit data', () => {
    expect(hasVisitRecords({
      textDefaultsSeeded: true,
      customShorteners: ['bit.ly'],
      __visilantFamiliar: { domains: [], threshold: 10, builtAt: 1 },
      __visilantHistoryImport: { status: 'done', current: 0, total: 0 },
    })).toBe(false)
  })

  it('is false for an empty profile', () => {
    expect(hasVisitRecords({})).toBe(false)
  })
})

describe('shouldAutoImport', () => {
  const used = { 'example.com': { count: 3, lastSeen: 1, ignored: false } }

  it('imports on a fresh install', () => {
    expect(shouldAutoImport({ reason: 'install', alreadyDecided: false, records: {} })).toBe(true)
  })

  it('leaves an existing user of the extension alone on update', () => {
    expect(shouldAutoImport({ reason: 'update', alreadyDecided: false, records: used })).toBe(false)
  })

  it('imports on update when the profile has no visits yet', () => {
    expect(shouldAutoImport({ reason: 'update', alreadyDecided: false, records: {} })).toBe(true)
  })

  it('never runs twice', () => {
    expect(shouldAutoImport({ reason: 'install', alreadyDecided: true, records: {} })).toBe(false)
    expect(shouldAutoImport({ reason: 'update', alreadyDecided: true, records: {} })).toBe(false)
  })

  it('ignores browser and shared-module updates', () => {
    expect(shouldAutoImport({ reason: 'chrome_update', alreadyDecided: false, records: {} })).toBe(false)
    expect(shouldAutoImport({ reason: 'shared_module_update', alreadyDecided: false, records: {} })).toBe(false)
  })
})

describe('import ownership', () => {
  const base = {
    status: 'running' as const,
    mode: 'full' as const,
    phase: 'scanning' as const,
    current: 0,
    total: 0,
    domains: 0,
    visits: 0,
    finishedAt: 0,
    auto: true,
    attempts: 0,
    fullDoneAt: 0,
    stage: 'full-running' as const,
    cursor: '',
  }

  it('gives every run a name of its own', () => {
    expect(newImportRunId()).not.toBe(newImportRunId())
  })

  // Two runs, one state key. A background resume and a Re-import from the
  // settings page used to overwrite each other's progress, and Cancel then
  // stopped whichever of them happened to read the flag.
  it('sees a live run belonging to somebody else', () => {
    const now = 1_000_000
    const theirs = { ...base, runId: 'theirs', updatedAt: now - 1000 }
    expect(isHeldByAnother(theirs, 'mine', now)).toBe(true)
  })

  it('does not read a run as somebody else once it has stopped ticking', () => {
    const now = 1_000_000
    const dead = { ...base, runId: 'theirs', updatedAt: now - 10 * 60 * 1000 }
    expect(isHeldByAnother(dead, 'mine', now)).toBe(false)
  })

  it('is never held by itself', () => {
    const now = 1_000_000
    const mine = { ...base, runId: 'mine', updatedAt: now }
    expect(isHeldByAnother(mine, 'mine', now)).toBe(false)
  })

  it('has nothing to yield to when there is no state at all', () => {
    expect(isHeldByAnother(null, 'mine', 1_000_000)).toBe(false)
  })
})

describe('describeImportHealth', () => {
  const NOW = at(2026, 3, 7)
  const base = {
    mode: 'full' as const,
    phase: 'scanning' as const,
    runId: 'test-run',
    stage: 'full-running' as const,
    cursor: '',
    current: 0,
    total: 0,
    domains: 0,
    visits: 0,
    finishedAt: 0,
    auto: true,
    updatedAt: NOW,
    attempts: 0,
    fullDoneAt: 0,
  }

  it('asks for an import when none has ever run', () => {
    expect(describeImportHealth(null, NOW)).toBe('never')
  })

  it('reports a live import as running', () => {
    expect(describeImportHealth({ ...base, status: 'running' }, NOW)).toBe('running')
  })

  it('reports a page-driven import as running even before any state is published', () => {
    expect(describeImportHealth(null, NOW, true)).toBe('running')
  })

  it('tells a killed import apart from a live one by its heartbeat', () => {
    const stale = { ...base, status: 'running' as const, updatedAt: NOW - 10 * 60 * 1000 }
    expect(describeImportHealth(stale, NOW)).toBe('interrupted')
  })

  it('calls a quick-only import partial, since the dates are still missing', () => {
    const quick = { ...base, status: 'done' as const, mode: 'quick' as const, finishedAt: NOW }
    expect(describeImportHealth(quick, NOW)).toBe('partial')
  })

  it('stays complete when a later quick refresh follows a finished full pass', () => {
    // The refresh is the newest state, but the dates it cannot supply are already stored
    const refresh = { ...base, status: 'done' as const, mode: 'quick' as const, finishedAt: NOW, fullDoneAt: NOW - 1000 }
    expect(describeImportHealth(refresh, NOW)).toBe('complete')
  })

  it('reports a failure as a failure', () => {
    expect(describeImportHealth({ ...base, status: 'failed', finishedAt: NOW }, NOW)).toBe('failed')
  })

  it('does not nag about a cancelled run once a full pass has ever finished', () => {
    const cancelled = { ...base, status: 'cancelled' as const, finishedAt: NOW, fullDoneAt: NOW - 1000 }
    expect(describeImportHealth(cancelled, NOW)).toBe('complete')
    expect(describeImportHealth({ ...base, status: 'cancelled', finishedAt: NOW }, NOW)).toBe('cancelled')
  })
})
