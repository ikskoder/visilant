import type { FamiliarityCriterionId, FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { evaluateFamiliarity, normalizeFamiliarity } from '~/logic/familiarity'
import { settings } from '~/logic/storage'
import { isTrackableHostname, untrackedReason } from '~/logic/visit-stats'

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
  /** Passed out of needed, worded like a fact's value against its bar. */
  combined: string
  met: boolean
  title: string
}

export interface VerdictLabel {
  verdict: 'familiar' | 'unfamiliar' | 'never' | 'unchecked' | 'untracked'
  text: string
  tone: 'safe' | 'danger' | 'neutral'
  /** Always the shield: a verdict is drawn as Visilant's own sign, see VzIcon */
  icon: 'shield-pass' | 'shield-fail' | 'shield-unknown'
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
      // No unit after any number: every label already names what it counts
      // ("Visits", "Active days", "Days known"), and "days" after one value
      // and not the next made the column read unevenly.
      const bar = `${translate('familiarityRequiredAtLeast')} ${outcome.required}`
      const known = outcome.value !== undefined
      // A site never visited has no active days or first visit yet, which is
      // not the same as a record that never kept them: "not recorded" beside a
      // site somebody has never opened read as a failure to record something.
      // Only the comparison table draws these, beside the other side's numbers
      const neverVisited = (stats?.count ?? 0) === 0
      const value = known ? String(outcome.value) : translate(neverVisited ? 'statsNoneYet' : 'statsUnknown')
      const required = String(outcome.required)

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
        // The import can only fill in a fact for a site that has visits
        title: known || neverVisited ? bar : `${bar}\n${translate('statsImportHint')}`,
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
      // Against the number that has to pass rather than the number switched on:
      // under "any one" a familiar site reads "1 / 1", not "1 / 3", which looked
      // like two failures short of a verdict it had already reached
      combined: `${verdict.met} / ${verdict.required}`,
      met: verdict.familiar,
      title: `${t.value('familiarityRequiredAtLeast')} ${verdict.required}`,
    }
  }

  /**
   * The verdict of a site as a badge: a word, an icon and a tone together.
   *
   * Red for both kinds of not familiar. A verdict has no middle step: a site
   * seen three times is as much a stranger as one never seen when it asks for
   * a password. The words still tell the two apart. Orange is for a finding
   * about an address that is only worth a look, never for a verdict.
   */
  /**
   * `hostname` is the name the verdict is about, and every caller has to
   * give it. A private IP address or a name without a dot is never counted,
   * so its zero says "there is no question here", not "you have never been",
   * and a red "never visited" would be a verdict on the user's own network.
   * It was an option once, and the tooltip and the dialogs never passed it:
   * the same `192.168.1.1` was grey on the check panel and red over a link.
   * A public IP address is counted like any site and gets its verdict.
   */
  function statusLabel(hostname: string, isSafe: boolean, count: number, unchecked = false): VerdictLabel {
    // Not red: nothing says the site is unfamiliar, only that nobody could ask.
    // Not green either, and the dialog it heads still stops the link.
    if (unchecked)
      return { verdict: 'unchecked', text: t.value('verdictUnchecked'), tone: 'neutral', icon: 'shield-unknown' }
    if (hostname && !isTrackableHostname(hostname))
      return { verdict: 'untracked', text: t.value(untrackedReason(hostname) === 'ip' ? 'untrackedIpBadge' : 'untrackedHostBadge'), tone: 'neutral', icon: 'shield-unknown' }
    if (isSafe)
      return { verdict: 'familiar', text: t.value('linkTooltipFamiliar'), tone: 'safe', icon: 'shield-pass' }
    // The same three words for a site wherever it is named, the site of an
    // email address included. That one used to read "Unfamiliar site" over a
    // line saying "Never visited", two verdicts on one record
    if (count === 0)
      return { verdict: 'never', text: t.value('linkTooltipNeverVisited'), tone: 'danger', icon: 'shield-fail' }
    return { verdict: 'unfamiliar', text: t.value('linkTooltipUnfamiliar'), tone: 'danger', icon: 'shield-fail' }
  }

  return { t, rules, withThresholds, verdictFor, factsFor, summaryFor, statusLabel }
}
