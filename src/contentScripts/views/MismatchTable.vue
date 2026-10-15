<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  textDomain: string
  textDomainIsSafe: boolean
  textDomainStats: FamiliarityStats
  destDomain: string
  destIsSafe: boolean
  destStats: FamiliarityStats
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

function shouldShowCount(isSafe: boolean) {
  switch (props.showVisitCount) {
    case 'always': return true
    case 'never': return false
    case 'unfamiliar': return !isSafe
    case 'familiar': return isSafe
    default: return true
  }
}

/**
 * The evidence, side by side, one row per check the user has switched on.
 *
 * Both columns are judged by the same rules, so the two lists come back the
 * same length and in the same order – which is what lets a row carry one label
 * and a cell from each side. The comparison is the whole point of this table,
 * and a check that is only shown for one of the two domains would defeat it.
 */
const factRows = computed(() => factsFor(props.textDomainStats).map((left, index) => ({
  id: left.id,
  label: left.label,
  left,
  right: factsFor(props.destStats)[index],
})))

const summaryRow = computed(() => {
  const left = summaryFor(props.textDomainStats)
  const right = summaryFor(props.destStats)
  return left && right ? { left, right } : null
})
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
          {{ t('linkInterceptDomain') }}
        </th>
        <td><SecureText :text="textDomain" size="m" /></td>
        <td><SecureText :text="destDomain" size="m" :diff="destDiff" /></td>
      </tr>
      <tr>
        <th scope="row">
          {{ t('linkInterceptStatus') }}
        </th>
        <td v-for="side in [{ safe: textDomainIsSafe, stats: textDomainStats, key: 'shown' }, { safe: destIsSafe, stats: destStats, key: 'dest' }]" :key="side.key">
          <VzBadge :tone="statusLabel(side.safe, side.stats.count).tone" :icon="statusLabel(side.safe, side.stats.count).icon" :data-verdict="statusLabel(side.safe, side.stats.count).verdict">
            {{ statusLabel(side.safe, side.stats.count).text }}
          </VzBadge>
        </td>
      </tr>
      <template v-if="shouldShowCount(textDomainIsSafe) || shouldShowCount(destIsSafe)">
        <tr v-for="row in factRows" :key="row.id">
          <th scope="row">
            {{ row.label }}
          </th>
          <td v-for="side in [{ fact: row.left, shown: shouldShowCount(textDomainIsSafe), key: 'shown' }, { fact: row.right, shown: shouldShowCount(destIsSafe), key: 'dest' }]" :key="side.key">
            <span v-if="side.shown" class="comparison-fact">
              <VzIcon :name="side.fact.met ? 'pass' : 'fail'" :label="t(side.fact.met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="side.fact.met ? 'tone-safe' : 'tone-danger'" :data-passed="row.id" :data-result="side.fact.met ? 'pass' : 'fail'" />
              <span class="vz-fact__value" :class="{ 'vz-fact__value--none': !side.fact.known }">{{ cell(side.fact) }}</span>
            </span>
            <span v-else class="text-ink-3">{{ t('mismatchVisitsHidden') }}</span>
          </td>
        </tr>
        <tr v-if="summaryRow">
          <th scope="row">
            {{ t('badgeContentChecks') }}
          </th>
          <td v-for="side in [{ fact: summaryRow.left, shown: shouldShowCount(textDomainIsSafe), key: 'shown' }, { fact: summaryRow.right, shown: shouldShowCount(destIsSafe), key: 'dest' }]" :key="side.key">
            <span v-if="side.shown" class="comparison-fact font-bold">
              <VzIcon :name="side.fact.met ? 'pass' : 'fail'" :label="t(side.fact.met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="side.fact.met ? 'tone-safe' : 'tone-danger'" data-passed="checks" :data-result="side.fact.met ? 'pass' : 'fail'" />
              <span class="vz-fact__value">{{ side.fact.combined }}</span>
            </span>
            <span v-else class="text-ink-3">{{ t('mismatchVisitsHidden') }}</span>
          </td>
        </tr>
      </template>
      <tr>
        <td />
        <td>
          <button class="vz-btn vz-btn--sm vz-btn--block" data-action="details-shown" @click="emit('details', textDomain)">
            {{ t('linkTooltipDetails') }}
          </button>
        </td>
        <td>
          <button class="vz-btn vz-btn--sm vz-btn--block" data-action="details-dest" @click="emit('details', destDomain)">
            {{ t('linkTooltipDetails') }}
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
  white-space: nowrap;
}
</style>
