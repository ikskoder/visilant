import type { FamiliarDomain } from './domain-similarity'
import type { FamiliaritySettings, FamiliarityStats } from './familiarity'
import type { SiteVisitData } from './storage'
import { aggregateFamiliarityStats, isFamiliar } from './familiarity'

/**
 * The set of domains worth imitating, derived from the user's own visit history.
 *
 * This is the reference the lookalike check compares against, which is why it is
 * built rather than shipped: it differs for every user, so nobody can test a
 * domain against it in advance, and it needs no maintenance after release.
 */

/**
 * Hard ceiling on index size. Someone with a very long history has a long tail of
 * domains they have visited often enough to pass the threshold but would not
 * recognise on sight. Keeping the most-visited ones is both cheaper and closer to
 * what "familiar" actually means.
 */
export const FAMILIAR_INDEX_LIMIT = 2000

interface CollectOptions {
  /** What makes a domain family familiar – the same rules the rest of the UI uses */
  rules: FamiliaritySettings
  limit?: number
  /** Registrable domain of a hostname, or null if it has none */
  toRegistrable: (hostname: string) => string | null
  now?: number
}

function isVisitRecord(value: unknown): value is SiteVisitData {
  return typeof value === 'object' && value !== null && typeof (value as SiteVisitData).count === 'number'
}

/**
 * Fold every stored hostname into its domain family and keep the families the
 * user knows well.
 *
 * Counting per family rather than per hostname matters: somebody who reaches
 * Google only through `accounts.google.com` and `mail.google.com` still knows
 * what `google.com` looks like.
 */
export function collectFamiliarDomains(
  records: Record<string, unknown>,
  options: CollectOptions,
): FamiliarDomain[] {
  const byFamily = new Map<string, SiteVisitData[]>()

  for (const [key, value] of Object.entries(records)) {
    // Storage also holds settings and cached lists under non-hostname keys
    if (!key.includes('.') || !isVisitRecord(value))
      continue

    const registrable = options.toRegistrable(key)
    if (!registrable)
      continue

    const group = byFamily.get(registrable)
    if (group)
      group.push(value)
    else
      byFamily.set(registrable, [value])
  }

  const now = options.now ?? Date.now()
  const familiar: FamiliarDomain[] = []
  for (const [domain, group] of byFamily) {
    const stats = aggregateFamiliarityStats(group)
    if (!isFamiliar(stats, options.rules, now))
      continue

    const label = domain.split('.')[0]
    if (label)
      familiar.push({ domain, label, visits: stats.count })
  }

  familiar.sort((a, b) => b.visits - a.visits || a.domain.localeCompare(b.domain))
  return familiar.slice(0, options.limit ?? FAMILIAR_INDEX_LIMIT)
}

/**
 * Fold one more visit into an already-built list, in place.
 *
 * A full rebuild reads every stored hostname, which is far too much work to do on
 * each navigation, so ordinary browsing keeps the list current this way.
 *
 * `stats` are the visited hostname's own, deliberately: they are already in
 * hand, whereas the family's would cost a scan of all storage. Every one of them
 * understates the family – fewer visits, no more active days than its busiest
 * member, no earlier a first visit – so a domain can only ever join the list
 * later than it strictly qualifies, never earlier. The next full rebuild – after
 * a history import, a rule change, or a day of use – corrects both the
 * membership and the counts.
 *
 * Returns true when the membership changed, which is the only case worth
 * persisting. A count that drifts low until the next rebuild affects nothing but
 * the order of two equally strong matches.
 */
export function applyVisitToFamiliar(
  familiar: FamiliarDomain[],
  registrable: string,
  stats: FamiliarityStats,
  rules: FamiliaritySettings,
  now: number = Date.now(),
): boolean {
  const existing = familiar.find(entry => entry.domain === registrable)

  if (existing) {
    existing.visits = Math.max(existing.visits + 1, stats.count)
    return false
  }

  if (!isFamiliar(stats, rules, now))
    return false

  const label = registrable.split('.')[0]
  if (!label)
    return false

  familiar.push({ domain: registrable, label, visits: stats.count })
  return true
}
