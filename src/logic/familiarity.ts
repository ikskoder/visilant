import type { SiteVisitData } from './storage'

/**
 * What makes a site familiar.
 *
 * The whole extension hangs off one verdict – warnings, the badge colour, the
 * link tooltip, the paste block, the lookalike reference set all ask the same
 * question – so the question is answered in exactly one place, here.
 *
 * Three facts are on offer, and each answers a different objection to the one
 * before it. Visits alone are cheap: an afternoon of clicking through the same
 * shop ten times reads as ten visits. Active days say the site came back on
 * separate days, which a single sitting cannot fake. Age says the relationship
 * is old, which a site registered last week cannot fake at all. Which of them
 * count, and how many have to agree, is the user's call.
 */

export type FamiliarityCriterionId = 'visits' | 'activeDays' | 'age'

/** In the order they are shown, weakest evidence first. */
export const FAMILIARITY_CRITERIA: readonly FamiliarityCriterionId[] = ['visits', 'activeDays', 'age'] as const

export interface FamiliarityCriterion {
  enabled: boolean
  /**
   * The bar this criterion has to clear: visits for `visits`, distinct days for
   * `activeDays`, days since the first known visit for `age`.
   */
  min: number
}

/**
 * How many of the enabled criteria have to pass.
 *
 * `all` and `any` are `atLeast` with the count pinned to the ends, and they are
 * named separately on purpose: they keep meaning what the user chose when a
 * criterion is switched on or off later, where a bare number would not.
 */
export type FamiliarityMode = 'all' | 'any' | 'atLeast'

export interface FamiliaritySettings {
  visits: FamiliarityCriterion
  activeDays: FamiliarityCriterion
  age: FamiliarityCriterion
  mode: FamiliarityMode
  /** Only read when `mode` is `atLeast`. */
  atLeast: number
}

/**
 * All three checks, at the thresholds this extension has always used for visits.
 *
 * A profile that starts here records active days and a first-visit date from its
 * very first visit, so all three questions can be answered and asking all three
 * is what a familiar site actually looks like – opened often, on separate days,
 * over a stretch of time. A profile that predates those two facts is a different
 * matter and is handled by the migration in logic/storage.ts, which keeps them
 * off: nobody's idea of a familiar site should change under them because they
 * updated the extension.
 */
export const defaultFamiliaritySettings: FamiliaritySettings = {
  visits: { enabled: true, min: 10 },
  activeDays: { enabled: true, min: 5 },
  age: { enabled: true, min: 10 },
  mode: 'all',
  atLeast: 2,
}

/** The stored facts a verdict is drawn from, per hostname or per domain family. */
export interface FamiliarityStats {
  count: number
  /** Absent on records written before the field existed, or never imported. */
  activeDays?: number
  /** Absent for the same reason. Unix timestamp of the earliest known visit. */
  firstSeen?: number
}

export interface CriterionOutcome {
  id: FamiliarityCriterionId
  /** The configured bar. */
  required: number
  /** What the record actually has, or undefined when it is not recorded. */
  value?: number
  met: boolean
}

export interface FamiliarityVerdict {
  familiar: boolean
  /** Outcomes for the enabled criteria, in display order. */
  criteria: CriterionOutcome[]
  met: number
  required: number
}

export const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between then and now, never negative. */
export function daysSince(timestamp: number, now: number): number {
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS))
}

function positiveInt(value: unknown, fallback: number): number {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function normalizeCriterion(value: unknown, fallback: FamiliarityCriterion): FamiliarityCriterion {
  const raw = value as Partial<FamiliarityCriterion> | undefined
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    min: positiveInt(raw?.min, fallback.min),
  }
}

/**
 * Make a usable rule set out of whatever is in storage.
 *
 * Settings are merged with the defaults one level deep, so a stored
 * `familiarity` object arrives exactly as it was written – including from a
 * version that had one field fewer. Every reader goes through here so a missing
 * field is a default rather than a `NaN` threshold that nothing can clear.
 */
export function normalizeFamiliarity(value: unknown): FamiliaritySettings {
  const raw = value as Partial<FamiliaritySettings> | undefined
  const mode = raw?.mode
  return {
    visits: normalizeCriterion(raw?.visits, defaultFamiliaritySettings.visits),
    activeDays: normalizeCriterion(raw?.activeDays, defaultFamiliaritySettings.activeDays),
    age: normalizeCriterion(raw?.age, defaultFamiliaritySettings.age),
    mode: mode === 'all' || mode === 'any' || mode === 'atLeast' ? mode : defaultFamiliaritySettings.mode,
    atLeast: positiveInt(raw?.atLeast, defaultFamiliaritySettings.atLeast),
  }
}

/** The criteria that are switched on, in display order. */
export function enabledCriteria(rules: FamiliaritySettings): FamiliarityCriterionId[] {
  return FAMILIARITY_CRITERIA.filter(id => rules[id].enabled)
}

/**
 * How many have to pass, clamped to what is actually on.
 *
 * Switching a criterion off can leave `atLeast` above the number left, and
 * "2 of 1" is a rule no site can ever satisfy – every site in the profile would
 * turn unfamiliar at once. The number bends instead.
 */
export function requiredMatches(rules: FamiliaritySettings): number {
  const count = enabledCriteria(rules).length
  if (count === 0)
    return 1

  if (rules.mode === 'any')
    return 1
  if (rules.mode === 'all')
    return count
  return Math.min(Math.max(1, rules.atLeast), count)
}

/**
 * The number behind one criterion, or undefined when the record never had it.
 *
 * Exported because the badge draws these numbers as well as judging by them, and
 * "how many active days is this" must not have a second definition.
 */
export function criterionValue(id: FamiliarityCriterionId, stats: FamiliarityStats, now: number = Date.now()): number | undefined {
  if (id === 'visits')
    return Math.max(0, Number(stats.count) || 0)
  if (id === 'activeDays')
    return typeof stats.activeDays === 'number' ? stats.activeDays : undefined
  return typeof stats.firstSeen === 'number' ? daysSince(stats.firstSeen, now) : undefined
}

/**
 * Judge one site against the rules.
 *
 * An unrecorded fact fails its criterion rather than being waived. Records from
 * before those fields existed have no first-visit date and no active-day count,
 * and treating "not known" as "passed" would hand the strongest verdict to the
 * oldest, least documented entries. The settings page says so and points at the
 * history import, which is the one thing that can fill them in.
 *
 * With nothing enabled at all – reachable by editing storage, not through the
 * UI – the visit count decides, which is what this extension did before there
 * was anything to enable.
 */
export function evaluateFamiliarity(
  stats: FamiliarityStats,
  rules: FamiliaritySettings,
  now: number = Date.now(),
): FamiliarityVerdict {
  const enabled = enabledCriteria(rules)
  const ids = enabled.length ? enabled : (['visits'] as FamiliarityCriterionId[])

  const criteria = ids.map<CriterionOutcome>((id) => {
    const value = criterionValue(id, stats, now)
    const required = rules[id].min
    return { id, required, value, met: value !== undefined && value >= required }
  })

  const met = criteria.filter(outcome => outcome.met).length
  const required = enabled.length ? requiredMatches(rules) : 1

  return { familiar: met >= required, criteria, met, required }
}

export function isFamiliar(
  stats: FamiliarityStats,
  rules: FamiliaritySettings,
  now: number = Date.now(),
): boolean {
  return evaluateFamiliarity(stats, rules, now).familiar
}

/**
 * Roll several hostname records into one set of facts for the domain family.
 *
 * Visits add up, but the other two cannot: the same day spent on `mail` and on
 * `accounts` is one day of knowing Google, not two, and the family has been
 * known since its earliest member was. So active days take the largest single
 * member and the first visit the earliest – both understate rather than invent,
 * which is the right direction for a check that decides whether to keep quiet.
 */
export function aggregateFamiliarityStats(
  records: Iterable<Partial<SiteVisitData> | undefined>,
): FamiliarityStats {
  let count = 0
  let activeDays: number | undefined
  let firstSeen: number | undefined

  for (const record of records) {
    if (!record)
      continue

    count += Number(record.count) || 0

    if (typeof record.activeDays === 'number')
      activeDays = activeDays === undefined ? record.activeDays : Math.max(activeDays, record.activeDays)

    if (typeof record.firstSeen === 'number')
      firstSeen = firstSeen === undefined ? record.firstSeen : Math.min(firstSeen, record.firstSeen)
  }

  return { count, activeDays, firstSeen }
}

/**
 * A short string that changes whenever the verdict could change.
 *
 * Anything cached off the back of these rules – the lookalike index above all –
 * compares this instead of the individual fields, so a new criterion cannot be
 * forgotten in one of the comparisons.
 *
 * Built from what the rules come to rather than from how they are written: the
 * mode and the threshold of a disabled criterion change nothing about any
 * verdict, and rebuilding thousands of entries over them would be work for
 * nothing.
 */
export function familiaritySignature(rules: FamiliaritySettings): string {
  const parts = FAMILIARITY_CRITERIA.map(id => `${id}:${rules[id].enabled ? rules[id].min : 'off'}`)
  return `${parts.join('|')}|${requiredMatches(rules)}`
}
