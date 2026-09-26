import type { FamiliaritySettings, FamiliarityStats } from './familiarity'
import type { SiteVisitData } from './storage'
import { isFamiliar } from './familiarity'
import { visitRecordEntries } from './visit-reset'

/**
 * Lifting a silence once the site it was put on is familiar.
 *
 * On a familiar site the silence does nothing that can be seen: there is no
 * warning to hold back, and the toolbar is green with it or without it. It only
 * wakes up if the site turns unfamiliar again, which happens when the rules are
 * tightened – and a silence put on as "until I know this site" coming back to
 * life then is what the user can ask to be spared. Off by default, since a
 * silence is the user's own choice and the code cannot tell one meant for a
 * while from one meant for good.
 *
 * Lifted on the next visit rather than the moment the site qualifies. Age grows
 * with the clock, not with a write, so no write marks the moment a site becomes
 * familiar, and a sweep on every change to the rules would act on the numbers a
 * threshold passes through while it is being retyped.
 */

/** The facts a verdict is taken on, as one record holds them. */
export function recordStats(record: SiteVisitData): FamiliarityStats {
  return { count: record.count || 0, activeDays: record.activeDays, firstSeen: record.firstSeen }
}

/**
 * Whether a silence may be lifted without asking.
 *
 * Not one the user put on a site that was already familiar at the time: that
 * silence was never waiting for the site to become known, and lifting it on the
 * next visit would undo the click that had just been made.
 */
export function canAutoLift(record: SiteVisitData | undefined, rules: FamiliaritySettings, now: number): boolean {
  return Boolean(record?.ignored)
    && record?.silencedWhileFamiliar !== true
    && isFamiliar(recordStats(record!), rules, now)
}

/** The record with warnings back on, and nothing left of the silence. */
export function liftSilence(record: SiteVisitData): SiteVisitData {
  const { silencedWhileFamiliar: _, ...rest } = record
  return { ...rest, ignored: false }
}

/**
 * The record with the silence set as the user asked, and a note of whether the
 * site was already familiar when they did – see `canAutoLift`.
 */
export function applySilence(record: SiteVisitData, ignored: boolean, rules: FamiliaritySettings, now: number): SiteVisitData {
  const { silencedWhileFamiliar: _, ...rest } = record
  const next: SiteVisitData = { ...rest, ignored }
  if (ignored && isFamiliar(recordStats(next), rules, now))
    next.silencedWhileFamiliar = true
  return next
}

/**
 * Silenced hosts that are familiar now, sorted like the silenced list itself.
 *
 * Every one of them, the silences put on familiar sites included: this is what
 * the settings page offers to clear in one go, and what switching the automatic
 * lift on clears, and both times it is the user asking.
 */
export function familiarSilencedHosts(records: Record<string, unknown>, rules: FamiliaritySettings, now: number): string[] {
  return visitRecordEntries(records)
    .filter(([, record]) => record.ignored === true && isFamiliar(recordStats(record), rules, now))
    .map(([key]) => key)
    .sort()
}
