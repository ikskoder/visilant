import type { FamiliarityCriterionId, FamiliarityStats } from '~/logic/familiarity'
import { computed, inject, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { evaluateFamiliarity, normalizeFamiliarity } from '~/logic/familiarity'
import { settings } from '~/logic/storage'

/**
 * The facts behind a verdict, worded once for every surface that shows them.
 *
 * A check used to report a visit count and nothing else, which stopped being the
 * whole story the moment active days and age became criteria of their own: a
 * site could be called unfamiliar over a date while the only number on screen
 * said it had been visited plenty. So each surface shows the same facts the
 * verdict was drawn from – and only those, since a number the user has switched
 * off has no say and no business taking up a line.
 *
 * The wording lives here rather than in a component because three surfaces lay
 * the same facts out in three shapes – a stack of lines, a table of one column
 * per check, and the mismatch table's column per domain – and "how far is this
 * from the bar" must not have a second answer in any of them.
 */

const LABEL_KEYS: Record<FamiliarityCriterionId, string> = {
  visits: 'familiarityVisits',
  activeDays: 'familiarityActiveDays',
  age: 'familiarityAge',
}

/** Only age needs its unit spelled out – the other two labels already name theirs. */
const UNIT_KEYS: Partial<Record<FamiliarityCriterionId, string>> = {
  age: 'familiarityDaysUnit',
}

export interface FamiliarityFact {
  id: FamiliarityCriterionId
  label: string
  /** The number as it should read, or the placeholder for a fact never recorded. */
  value: string
  /** The bar it is measured against, worded the same way. */
  required: string
  /** Both at once, for a surface too narrow to give the bar a column of its own. */
  combined: string
  /** False when the record predates the field, which no amount of visiting fixes. */
  known: boolean
  met: boolean
  /** Hover text: the bar this has to clear, plus how a missing fact gets filled in. */
  title: string
}

export interface FamiliaritySummary {
  /** How many checks passed. */
  value: string
  /** How many had to. */
  required: string
  /** Passed out of switched on, which is the ratio the badge draws too. */
  combined: string
  met: boolean
  title: string
}

export function useFamiliarityFacts() {
  const { t } = useI18n()
  // The in-page surfaces live in a shadow root, where a `dark:` variant on the
  // host page's html element never reaches them, so the theme is passed down
  const isDark = inject('isDark', ref(false))

  const rules = computed(() => normalizeFamiliarity(settings.value.familiarity))
  const withThresholds = computed(() => settings.value.showFamiliarityThresholds === true)

  function verdictFor(stats: FamiliarityStats | undefined) {
    return evaluateFamiliarity(stats ?? { count: 0 }, rules.value)
  }

  function factsFor(stats: FamiliarityStats | undefined): FamiliarityFact[] {
    const translate = t.value

    return verdictFor(stats).criteria.map((outcome) => {
      const unitKey = UNIT_KEYS[outcome.id]
      const unit = unitKey ? ` ${translate(unitKey)}` : ''
      const bar = `${translate('familiarityRequiredAtLeast')} ${outcome.required}${unit}`
      const known = outcome.value !== undefined
      const value = known ? `${outcome.value}${unit}` : translate('statsUnknown')
      const required = `${outcome.required}${unit}`

      return {
        id: outcome.id,
        label: translate(LABEL_KEYS[outcome.id]),
        value,
        required,
        // An unrecorded fact never grows a threshold beside it: "unknown / 10"
        // reads as a number somebody could work towards, and this one cannot be
        // reached by visiting at all.
        combined: known ? `${outcome.value} / ${required}` : value,
        known,
        met: outcome.met,
        title: known ? bar : `${bar}\n${translate('statsImportHint')}`,
      }
    })
  }

  /**
   * How many checks passed, when that is a question at all.
   *
   * Under `all` it is not: every check has to pass, so the colours already say
   * everything a tally could. Under `any` or `atLeast` a red fact is not a
   * verdict, and without this line a site called familiar next to a failed check
   * looks like a bug.
   */
  function summaryFor(stats: FamiliarityStats | undefined): FamiliaritySummary | null {
    const verdict = verdictFor(stats)
    if (verdict.required >= verdict.criteria.length)
      return null

    return {
      value: String(verdict.met),
      required: String(verdict.required),
      combined: `${verdict.met} / ${verdict.criteria.length}`,
      met: verdict.familiar,
      title: `${t.value('familiarityRequiredAtLeast')} ${verdict.required}`,
    }
  }

  /**
   * Green once a check passes, red while it does not.
   *
   * A missing fact is red as well, because that is what it does to the verdict –
   * an unrecorded criterion fails rather than being waived, and greying it out
   * read as "this one does not count" while it was quietly deciding the answer.
   * The italic is what says the number was never measured.
   */
  function valueClass(met: boolean, known = true) {
    if (met)
      return isDark.value ? 'text-green-400' : 'text-green-600'
    const failed = isDark.value ? 'text-red-400' : 'text-red-500'
    return known ? failed : `${failed} italic`
  }

  /**
   * The one-line verdict that goes above the facts.
   *
   * Both shades of every colour, because these surfaces are drawn inside a
   * shadow root on somebody else's page: a `dark:` variant needs the class the
   * app root puts there, and a bare `text-yellow-400` – which is what all four
   * of these callers used to carry – is a dark-theme choice that all but
   * disappears on the white card the light theme draws.
   */
  function statusLabel(isSafe: boolean, count: number) {
    if (isSafe)
      return { text: t.value('linkTooltipFamiliar'), class: isDark.value ? 'text-green-400' : 'text-green-700' }
    if (count === 0)
      return { text: t.value('linkTooltipNeverVisited'), class: isDark.value ? 'text-red-400' : 'text-red-600' }
    return { text: t.value('linkTooltipUnfamiliar'), class: isDark.value ? 'text-yellow-400' : 'text-yellow-700' }
  }

  return { t, rules, withThresholds, verdictFor, factsFor, summaryFor, valueClass, statusLabel }
}
