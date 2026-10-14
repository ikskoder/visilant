import type { FamiliarityCriterionId, FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
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

export interface VerdictLabel {
  verdict: 'familiar' | 'unfamiliar' | 'never'
  text: string
  tone: 'safe' | 'danger'
  icon: 'pass' | 'alert'
}

export function useFamiliarityFacts() {
  const { t } = useI18n()

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
   * The verdict of a site as a badge: a word, an icon and a tone together.
   *
   * Red for both kinds of not familiar. There is no yellow middle step: a reader
   * cannot tell three warm colours apart at a glance, and a site seen three
   * times is as much a stranger as one never seen when it asks for a password.
   * The words still tell the two apart.
   */
  function statusLabel(isSafe: boolean, count: number): VerdictLabel {
    if (isSafe)
      return { verdict: 'familiar', text: t.value('linkTooltipFamiliar'), tone: 'safe', icon: 'pass' }
    if (count === 0)
      return { verdict: 'never', text: t.value('linkTooltipNeverVisited'), tone: 'danger', icon: 'alert' }
    return { verdict: 'unfamiliar', text: t.value('linkTooltipUnfamiliar'), tone: 'danger', icon: 'alert' }
  }

  return { t, rules, withThresholds, verdictFor, factsFor, summaryFor, statusLabel }
}
