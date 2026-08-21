import type { FamiliarityCriterionId, FamiliaritySettings, FamiliarityStats } from './familiarity'
import { criterionValue, enabledCriteria, evaluateFamiliarity } from './familiarity'

/**
 * What the number on the toolbar icon counts.
 *
 * The badge holds about three characters, so it shows one number and the colour
 * carries the verdict. Which number is worth those three characters depends on
 * which checks the user actually judges a site by.
 */
export type BadgeContent = FamiliarityCriterionId | 'checks'

export const BADGE_CONTENTS: BadgeContent[] = ['visits', 'activeDays', 'age', 'checks']

/** Longer than the badge can show. */
const TOO_BIG = '>1K'

/** A fact this record never carried – only a history import can fill it in. */
const UNKNOWN = '?'

function asBadgeNumber(value: number | undefined): string {
  if (value === undefined)
    return UNKNOWN

  return value >= 1000 ? TOO_BIG : String(Math.floor(value))
}

/**
 * What the badge can actually draw, given the checks that are switched on.
 *
 * A criterion the user has since switched off is not a number they still want on
 * the icon – they said as much by turning it off. And counting checks needs more
 * than one to count: with a single check on, "1/1" says nothing the badge colour
 * has not already said, so it gives way to that check's own number.
 */
export function resolveBadgeContent(content: BadgeContent, rules: FamiliaritySettings): BadgeContent {
  const enabled = enabledCriteria(rules)
  if (content !== 'checks' && enabled.includes(content))
    return content

  if (enabled.length > 1)
    return 'checks'

  // Nothing enabled at all is reachable by editing storage, not through the UI,
  // and the visit count is what decides a verdict in that case too
  return enabled[0] ?? 'visits'
}

/** The text for one site's badge. */
export function badgeText(
  stats: FamiliarityStats,
  rules: FamiliaritySettings,
  content: BadgeContent,
  now: number = Date.now(),
): string {
  const drawn = resolveBadgeContent(content, rules)
  if (drawn !== 'checks')
    return asBadgeNumber(criterionValue(drawn, stats, now))

  const verdict = evaluateFamiliarity(stats, rules, now)
  return `${verdict.met}/${verdict.criteria.length}`
}
