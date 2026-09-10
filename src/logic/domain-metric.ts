import type { FamiliarityCriterionId, FamiliaritySettings, FamiliarityStats } from './familiarity'
import { criterionValue, evaluateFamiliarity } from './familiarity'

/**
 * One number about one host, picked by the reader.
 *
 * The related-domain list used to draw visit counts and nothing else, which is the
 * one fact that says least: a site opened forty times in an afternoon outranks
 * one visited every week for a year. The same four numbers the badge can carry
 * are available here, and the list draws whichever of them the reader is sorting
 * by – so the column and the order always agree.
 *
 * The numbers themselves come from `familiarity.ts`, never from arithmetic of
 * their own.
 */

export type DomainMetric = FamiliarityCriterionId | 'checks'

/** In the order they are offered, weakest evidence first. */
export const DOMAIN_METRICS: readonly DomainMetric[] = ['visits', 'activeDays', 'age', 'checks'] as const

export interface MetricReading {
  /** The number, or undefined for a fact this record never carried. */
  value?: number
  /** What it is out of, which only the passed-checks ratio has. */
  outOf?: number
  /**
   * Whether it clears the bar, or undefined when the user has this check off.
   *
   * Undefined is not "failed": a number with no say in the verdict is left
   * uncoloured rather than painted as though it had one.
   */
  met?: boolean
  /** The date behind an `age` reading, so a surface can name it on hover. */
  firstSeen?: number
}

/** What one host has to show for one metric. */
export function metricReading(
  metric: DomainMetric,
  stats: FamiliarityStats,
  rules: FamiliaritySettings,
  now: number = Date.now(),
): MetricReading {
  const verdict = evaluateFamiliarity(stats, rules, now)

  if (metric === 'checks')
    return { value: verdict.met, outOf: verdict.criteria.length, met: verdict.familiar }

  return {
    value: criterionValue(metric, stats, now),
    met: verdict.criteria.find(outcome => outcome.id === metric)?.met,
    firstSeen: metric === 'age' ? stats.firstSeen : undefined,
  }
}

/**
 * Whether a family's figure is everything added up or the best single member.
 *
 * Only visits add up. The same day spent on `mail` and on `accounts` is one day
 * of knowing Google rather than two, the family has been known since its
 * earliest member was, and checks are passed by a host and not by a sum – so
 * those three take the largest member.
 *
 * This is the one place that knows which is which, and every label naming a fold
 * comes from here. A row of numbers that does not say how it was arrived at is
 * the thing this answers: 11961 visits and 90 active days over the same family
 * are a sum and a maximum, and nothing about the two figures says so.
 *
 * There used to be a `metricTotal` beside this, folding the family for a single
 * figure next to the related-domain list's heading. That figure is gone – the
 * base domain draws the whole row of facts instead – and the fold it used is
 * `aggregateFamiliarityStats`, which is what the verdict itself has always used.
 */
export function metricAggregation(metric: DomainMetric): 'total' | 'max' {
  return metric === 'visits' ? 'total' : 'max'
}

/**
 * How the list should be ordered by this metric, ascending.
 *
 * A fact that was never recorded sorts below zero rather than beside it: it is
 * not a small number, it is an absent one, and it belongs at the end that the
 * reader is not looking at.
 */
export function metricSortValue(reading: MetricReading): number {
  return reading.value ?? -1
}
