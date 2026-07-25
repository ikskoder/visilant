import type { SiteVisitData } from './storage'
import { dayKey, isTrackableHostname } from './visit-stats'

export interface ImportedDomainStats {
  count: number
  lastSeen: number
  firstSeen?: number
  activeDays?: number
}

/**
 * Hostname of a browser-history entry, or null if the entry is not a web page we
 * track (non-http schemes, localhost and other dotless names, unparseable URLs).
 */
export function hostnameFromHistoryUrl(url: string | undefined): string | null {
  if (!url)
    return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null

    const hostname = parsed.hostname.toLowerCase()
    return isTrackableHostname(hostname) ? hostname : null
  }
  catch {
    return null
  }
}

/** Fold one URL's individual visit timestamps into the running stats of its hostname. */
export function addVisitTimes(
  stats: ImportedDomainStats | undefined,
  times: number[],
  days: Set<string>,
): ImportedDomainStats | undefined {
  const valid = times.filter(time => typeof time === 'number' && Number.isFinite(time) && time > 0)
  if (!valid.length)
    return stats

  for (const time of valid)
    days.add(dayKey(time))

  const first = Math.min(...valid)
  const last = Math.max(...valid)

  if (!stats)
    return { count: valid.length, firstSeen: first, lastSeen: last }

  return {
    count: stats.count + valid.length,
    firstSeen: Math.min(stats.firstSeen ?? first, first),
    lastSeen: Math.max(stats.lastSeen, last),
  }
}

/**
 * Merge imported history stats into an existing record.
 *
 * Deliberately idempotent — every field folds by min/max rather than by addition,
 * so importing twice cannot inflate the counters. `ignored` is user intent and is
 * never touched by an import.
 */
export function mergeImportedStats(
  existing: SiteVisitData | undefined,
  imported: ImportedDomainStats,
): SiteVisitData {
  const merged: SiteVisitData = {
    count: Math.max(existing?.count || 0, imported.count),
    lastSeen: Math.max(existing?.lastSeen || 0, imported.lastSeen),
    ignored: existing?.ignored || false,
  }

  const firstSeen = [existing?.firstSeen, imported.firstSeen].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  if (firstSeen.length)
    merged.firstSeen = Math.min(...firstSeen)

  const activeDays = [existing?.activeDays, imported.activeDays].filter(
    (value): value is number => typeof value === 'number',
  )
  if (activeDays.length)
    merged.activeDays = Math.max(...activeDays)

  return merged
}

/**
 * Run an async task over items with a bounded number of in-flight calls.
 *
 * The full import makes one `history.getVisits()` call per URL, which on a large
 * history is tens of thousands of calls — they have to be queued rather than fired
 * at once, and the user has to be able to stop them.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  let cursor = 0

  const worker = async () => {
    while (cursor < items.length) {
      if (shouldStop?.())
        return
      const index = cursor++
      await task(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  )
}
