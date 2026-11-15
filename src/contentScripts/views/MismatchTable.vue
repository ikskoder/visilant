<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { showsVisitFacts } from '~/logic/show-visit-facts'

const props = defineProps<{
  textDomain: string
  textDomainIsSafe: boolean
  textDomainStats: FamiliarityStats
  destDomain: string
  destIsSafe: boolean
  destStats: FamiliarityStats
  /** See `VisitFacts.unchecked`: no facts for that side, and no verdict either. */
  textDomainUnchecked?: boolean
  destUnchecked?: boolean
  /** The letters a lookalike changed in the destination, underlined. */
  destDiff?: number[]
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
}>()

const emit = defineEmits<{
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()
const { factsFor, summaryFor, withThresholds, statusLabel } = useFamiliarityFacts()

/**
 * One cell's worth of a fact.
 *
 * This table already names every row, so the bar can ride along inside the cell
 * instead of claiming a column – a fourth and fifth column of numbers would not
 * fit a phone, and the comparison of the two domains is what it exists for.
 */
function cell(fact: { value: string, combined: string }) {
  return withThresholds.value ? fact.combined : fact.value
}

/**
 * The evidence, side by side, one row per check the user has switched on.
 *
 * Both columns are judged by the same rules, so the two lists come back the
 * same length and in the same order – which is what lets a row carry one label
 * and a cell from each side. The comparison is the whole point of this table,
 * so a check is a row for both domains or for neither.
 */
const factRows = computed(() => factsFor(props.textDomainStats).map((left, index) => ({
  id: left.id,
  label: left.label,
  // In the order of the columns: the site the text names, then the destination
  facts: [left, factsFor(props.destStats)[index]],
})))

const summaryRow = computed(() => {
  const left = summaryFor(props.textDomainStats)
  const right = summaryFor(props.destStats)
  return left && right ? [left, right] : null
})

/**
 * What each column has to put under its verdict: its facts, or the reason it
 * has none to show. No cell is left empty, since an empty one reads as a
 * mistake of the table and takes the same room as a zero.
 */
const sides = computed(() => [
  { key: 'shown', safe: props.textDomainIsSafe, stats: props.textDomainStats, unchecked: props.textDomainUnchecked },
  { key: 'dest', safe: props.destIsSafe, stats: props.destStats, unchecked: props.destUnchecked },
].map(side => ({
  ...side,
  cells: side.unchecked
    ? 'unchecked' as const
    : showsVisitFacts(props.showVisitCount, side.safe) ? 'facts' as const : 'hidden' as const,
})))

/**
 * The rows are there to set one side's numbers against the other's, so they
 * are drawn while at least one side has visits on show. Next to those a side
 * nobody has been to keeps its zeros: the cells are there either way, and the
 * zeros are what the numbers beside them are compared with. With no visits on
 * show on either side – never visited, hidden by the setting, not checked –
 * the verdicts above have said all of it and the rows go.
 */
const anyFacts = computed(() => sides.value.some(side => side.cells === 'facts' && Number(side.stats.count) > 0))
</script>

<template>
  <!-- The two addresses side by side, with the evidence for each under it. The
       values are never coloured: the mark before each carries the result. -->
  <table class="vz-table comparison-table">
    <thead>
      <tr>
        <th><span class="sr-only">{{ t('familiarityFactCheck') }}</span></th>
        <th>{{ t('linkTooltipShowsDomain') }}</th>
        <th>{{ t('linkTooltipLeadsTo') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">
          {{ t('emailDomainLabel') }}
        </th>
        <td>
          <SecureText :text="textDomain" size="m">
            <CopyButton :text="textDomain" />
          </SecureText>
        </td>
        <td>
          <SecureText :text="destDomain" size="m" :diff="destDiff">
            <CopyButton :text="destDomain" />
          </SecureText>
        </td>
      </tr>
      <tr>
        <th scope="row">
          {{ t('linkInterceptStatus') }}
        </th>
        <td v-for="side in sides" :key="side.key">
          <VzBadge :tone="statusLabel(side.safe, side.stats.count, side.unchecked).tone" :icon="statusLabel(side.safe, side.stats.count, side.unchecked).icon" :data-verdict="statusLabel(side.safe, side.stats.count, side.unchecked).verdict">
            {{ statusLabel(side.safe, side.stats.count, side.unchecked).text }}
          </VzBadge>
        </td>
      </tr>
      <template v-if="anyFacts">
        <tr v-for="row in factRows" :key="row.id">
          <th scope="row">
            {{ row.label }}
          </th>
          <td v-for="(side, at) in sides" :key="side.key">
            <span v-if="side.cells === 'unchecked'" class="text-ink-3">–</span>
            <span v-else-if="side.cells === 'facts'" class="comparison-fact">
              <VzIcon :name="row.facts[at].met ? 'pass' : 'fail'" :label="t(row.facts[at].met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="row.facts[at].met ? 'tone-safe' : 'tone-danger'" :data-passed="row.id" :data-result="row.facts[at].met ? 'pass' : 'fail'" />
              <span class="vz-fact__value" :class="{ 'vz-fact__value--none': !row.facts[at].known }">{{ cell(row.facts[at]) }}</span>
            </span>
            <span v-else-if="side.cells === 'hidden'" class="text-ink-3">{{ t('mismatchVisitsHidden') }}</span>
          </td>
        </tr>
        <tr v-if="summaryRow" class="vz-fact--total">
          <th scope="row">
            {{ t('badgeContentChecks') }}
          </th>
          <td v-for="(side, at) in sides" :key="side.key">
            <span v-if="side.cells === 'unchecked'" class="text-ink-3">–</span>
            <span v-else-if="side.cells === 'facts'" class="comparison-fact">
              <VzIcon :name="summaryRow[at].met ? 'pass' : 'fail'" :label="t(summaryRow[at].met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="summaryRow[at].met ? 'tone-safe' : 'tone-danger'" data-passed="checks" :data-result="summaryRow[at].met ? 'pass' : 'fail'" />
              <span class="vz-fact__value">{{ summaryRow[at].combined }}</span>
            </span>
            <span v-else-if="side.cells === 'hidden'" class="text-ink-3">{{ t('mismatchVisitsHidden') }}</span>
          </td>
        </tr>
      </template>
      <tr>
        <td />
        <td>
          <button class="vz-btn vz-btn--sm vz-btn--block" data-action="details-shown" @click="emit('details', textDomain)">
            {{ t('linkInterceptDomainInfo') }}
          </button>
        </td>
        <td>
          <button class="vz-btn vz-btn--sm vz-btn--block" data-action="details-dest" @click="emit('details', destDomain)">
            {{ t('linkInterceptDomainInfo') }}
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.comparison-fact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* On a phone three columns have about 110px each. A badge or a value kept on
   one line made the table wider than the dialog, and "Leads to", the column
   that matters, went off the edge. Here they wrap instead. */
.comparison-table :deep(.vz-badge) {
  white-space: normal;
}

@media (max-width: 480px) {
  .comparison-table :deep(th),
  .comparison-table :deep(td) {
    padding-inline: calc(6px * var(--vz-scale, 1));
  }
}
</style>
