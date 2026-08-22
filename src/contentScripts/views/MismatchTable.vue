<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed, inject, ref } from 'vue'
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
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  cellPadding?: string
}>()

const emit = defineEmits<{
  (e: 'details', domain: string): void
}>()

const isDark = inject('isDark', ref(true))

const { t } = useI18n()
const { factsFor, summaryFor, valueClass, withThresholds, statusLabel } = useFamiliarityFacts()

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

const pad = computed(() => props.cellPadding || 'p-1.5')

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
  <table class="w-full comparison-table">
    <thead>
      <tr>
        <th class="text-gray-500 font-normal text-left" :class="[pad]" />
        <th class="font-medium text-left" :class="[pad, isDark ? 'text-gray-400' : 'text-gray-500']">
          {{ t('linkTooltipShowsDomain') }}
        </th>
        <th class="font-medium text-left" :class="[pad, isDark ? 'text-gray-400' : 'text-gray-500']">
          {{ t('linkTooltipLeadsTo') }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
          {{ t('linkInterceptDomain') }}
        </td>
        <td class="font-medium" :class="[pad, isDark ? 'text-white' : 'text-gray-900']">
          <SecureText :text="textDomain" :force-highlight="true" :danger-only="true" />
        </td>
        <td class="font-medium" :class="[pad, isDark ? 'text-white' : 'text-gray-900']">
          <SecureText :text="destDomain" :force-highlight="true" :danger-only="true" />
        </td>
      </tr>
      <tr>
        <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
          {{ t('linkInterceptStatus') }}
        </td>
        <td class="font-medium" :class="[pad, statusLabel(textDomainIsSafe, textDomainStats.count).class]">
          {{ statusLabel(textDomainIsSafe, textDomainStats.count).text }}
        </td>
        <td class="font-medium" :class="[pad, statusLabel(destIsSafe, destStats.count).class]">
          {{ statusLabel(destIsSafe, destStats.count).text }}
        </td>
      </tr>
      <template v-if="shouldShowCount(textDomainIsSafe) || shouldShowCount(destIsSafe)">
        <tr v-for="row in factRows" :key="row.id">
          <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
            {{ row.label }}
          </td>
          <td :class="[pad, shouldShowCount(textDomainIsSafe) ? `font-medium ${valueClass(row.left.met, row.left.known)}` : 'text-gray-500 italic']">
            <template v-if="shouldShowCount(textDomainIsSafe)">
              {{ cell(row.left) }}
              <span class="ml-1" :class="valueClass(row.left.met)" :data-passed="row.id">{{ row.left.met ? '✓' : '✗' }}</span>
            </template>
            <template v-else>
              {{ t('mismatchVisitsHidden') }}
            </template>
          </td>
          <td :class="[pad, shouldShowCount(destIsSafe) ? `font-medium ${valueClass(row.right.met, row.right.known)}` : 'text-gray-500 italic']">
            <template v-if="shouldShowCount(destIsSafe)">
              {{ cell(row.right) }}
              <span class="ml-1" :class="valueClass(row.right.met)" :data-passed="row.id">{{ row.right.met ? '✓' : '✗' }}</span>
            </template>
            <template v-else>
              {{ t('mismatchVisitsHidden') }}
            </template>
          </td>
        </tr>
        <tr v-if="summaryRow">
          <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
            {{ t('badgeContentChecks') }}
          </td>
          <td :class="[pad, shouldShowCount(textDomainIsSafe) ? `font-medium ${valueClass(summaryRow.left.met)}` : 'text-gray-500 italic']">
            <template v-if="shouldShowCount(textDomainIsSafe)">
              {{ summaryRow.left.combined }}
              <span class="ml-1" :class="valueClass(summaryRow.left.met)" data-passed="checks">{{ summaryRow.left.met ? '✓' : '✗' }}</span>
            </template>
            <template v-else>
              {{ t('mismatchVisitsHidden') }}
            </template>
          </td>
          <td :class="[pad, shouldShowCount(destIsSafe) ? `font-medium ${valueClass(summaryRow.right.met)}` : 'text-gray-500 italic']">
            <template v-if="shouldShowCount(destIsSafe)">
              {{ summaryRow.right.combined }}
              <span class="ml-1" :class="valueClass(summaryRow.right.met)" data-passed="checks">{{ summaryRow.right.met ? '✓' : '✗' }}</span>
            </template>
            <template v-else>
              {{ t('mismatchVisitsHidden') }}
            </template>
          </td>
        </tr>
      </template>
      <tr>
        <td :class="pad" />
        <td :class="pad">
          <button
            class="w-full px-2 py-1 rounded-lg border transition-colors text-center"
            :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
            @click="emit('details', textDomain)"
          >
            {{ t('linkTooltipDetails') }}
          </button>
        </td>
        <td :class="pad">
          <button
            class="w-full px-2 py-1 rounded-lg border transition-colors text-center"
            :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
            @click="emit('details', destDomain)"
          >
            {{ t('linkTooltipDetails') }}
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
button {
  box-shadow: none !important;
  text-shadow: none !important;
  outline: none !important;
}

.comparison-table {
  border-collapse: collapse !important;
  border: 1px solid rgba(107, 114, 128, 0.4) !important;
}

.comparison-table th,
.comparison-table td {
  border: 1px solid rgba(107, 114, 128, 0.25) !important;
}
</style>
