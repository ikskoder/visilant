import type { FamiliarDomain } from './domain-similarity'
import type { SiteVisitData } from './storage'

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
  /** Visits across a domain family, at or above which it counts as familiar */
  threshold: number
  limit?: number
  /** Registrable domain of a hostname, or null if it has none */
  toRegistrable: (hostname: string) => string | null
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
  const totals = new Map<string, number>()

  for (const [key, value] of Object.entries(records)) {
    // Storage also holds settings and cached lists under non-hostname keys
    if (!key.includes('.') || !isVisitRecord(value))
      continue

    const registrable = options.toRegistrable(key)
    if (!registrable)
      continue

    totals.set(registrable, (totals.get(registrable) || 0) + (value.count || 0))
  }

  const familiar: FamiliarDomain[] = []
  for (const [domain, visits] of totals) {
    if (visits < options.threshold)
      continue

    const label = domain.split('.')[0]
    if (label)
      familiar.push({ domain, label, visits })
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
 * `hostVisits` is the count for the visited hostname alone, deliberately: it is
 * already in hand, whereas the family total would cost a scan of all storage. It
 * is a lower bound on the family total, so a domain can only ever join the list
 * later than it strictly qualifies, never earlier. The next full rebuild – after
 * a history import, a threshold change, or a day of use – corrects both the
 * membership and the counts.
 *
 * Returns true when the membership changed, which is the only case worth
 * persisting. A count that drifts low until the next rebuild affects nothing but
 * the order of two equally strong matches.
 */
export function applyVisitToFamiliar(
  familiar: FamiliarDomain[],
  registrable: string,
  hostVisits: number,
  threshold: number,
): boolean {
  const existing = familiar.find(entry => entry.domain === registrable)

  if (existing) {
    existing.visits = Math.max(existing.visits + 1, hostVisits)
    return false
  }

  if (hostVisits < threshold)
    return false

  const label = registrable.split('.')[0]
  if (!label)
    return false

  familiar.push({ domain: registrable, label, visits: hostVisits })
  return true
}
