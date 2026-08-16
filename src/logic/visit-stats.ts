import type { SiteVisitData } from './storage'

/**
 * Two visits closer together than this are treated as one, so that reloads and
 * SPA navigations don't inflate the counter.
 */
export const VISIT_DEBOUNCE_MS = 60_000

/**
 * Local-time day key (YYYY-MM-DD). Active days are counted in the user's own
 * timezone – "I was there on 3 different days" is a human statement, not a UTC one.
 */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Hostnames without a dot (localhost, intranet names) are not tracked. */
export function isTrackableHostname(hostname: string): boolean {
  return hostname.includes('.')
}

/**
 * Fold a new visit into the stored record.
 *
 * `firstSeen` and `activeDays` stay `undefined` on records created before those
 * fields existed: we cannot know when the user first visited a site, and stamping
 * "today" would present a guess as a fact. Only a history import can fill them in.
 */
export function applyVisit(existing: SiteVisitData | undefined, now: number): SiteVisitData {
  if (!existing)
    return { count: 1, firstSeen: now, lastSeen: now, activeDays: 1, ignored: false }

  const lastSeen = existing.lastSeen || 0
  const count = existing.count || 0
  const isNewVisit = !lastSeen || (now - lastSeen) > VISIT_DEBOUNCE_MS
  const isNewDay = !lastSeen || dayKey(lastSeen) !== dayKey(now)

  return {
    count: isNewVisit ? count + 1 : count,
    firstSeen: existing.firstSeen,
    lastSeen: now,
    activeDays: existing.activeDays === undefined
      ? undefined
      : existing.activeDays + (isNewDay ? 1 : 0),
    ignored: existing.ignored || false,
  }
}
