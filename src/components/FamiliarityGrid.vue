<script setup lang="ts">
import type { DomainMetric } from '~/logic/domain-metric'
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { metricAggregation } from '~/logic/domain-metric'

/**
 * The same facts `FamiliarityFacts` draws, laid out as a row of cells.
 *
 * Two names on the popup carry them – the host the window is about, and the base
 * domain under it – and they are different numbers about different things. One
 * shape drawn twice is what keeps that readable: a reader compares two rows of
 * the same cells and sees which one moved, where two different-looking blocks
 * would first have to be worked out before they could be compared at all.
 *
 * The wording, the bar and the colour are the composable's, never a second copy.
 * Only the shape belongs here.
 */
const props = defineProps<{
  stats: FamiliarityStats | undefined
  /**
   * Whether these figures are a whole family folded into one row.
   *
   * Each heading then says how its own number was arrived at, because they are
   * not all arrived at the same way: visits are a sum and the rest are the best
   * single host. Unsaid, a row reading 11961 visits over 90 active days invites
   * the reader to divide one by the other, and the answer means nothing.
   */
  aggregated?: boolean
}>()

const { t, factsFor, summaryFor, valueClass, withThresholds } = useFamiliarityFacts()

function foldLabel(metric: DomainMetric) {
  if (!props.aggregated)
    return ''
  return ` · ${t.value(metricAggregation(metric) === 'total' ? 'foldTotal' : 'foldMax')}`
}

const facts = computed(() => factsFor(props.stats))
const summary = computed(() => summaryFor(props.stats))

/**
 * The date the age is counted from, which the count itself does not say.
 *
 * "79 days" is the fact the check is made of, and the date is what makes it
 * checkable – so it rides on the hover rather than asking the reader to count
 * months back from today before the number means anything.
 */
const ageTitle = computed(() => {
  const firstSeen = props.stats?.firstSeen
  const fact = facts.value.find(entry => entry.id === 'age')
  if (!firstSeen || !fact)
    return fact?.title

  const date = new Date(firstSeen).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `${t.value('firstVisitOn')} ${date}\n${fact.title}`
})
</script>

<template>
  <!-- Cells rather than columns: the row holds three facts, or four once the
       tally joins them, and a fixed column count would leave the fourth alone on
       a line of its own in a popup this narrow. -->
  <div class="familiarity-grid grid gap-2 text-left">
    <div v-for="fact in facts" :key="fact.id">
      <div class="uppercase tracking-wider opacity-50">
        {{ fact.label }}<span v-if="aggregated" class="opacity-80" :data-fold="fact.id">{{ foldLabel(fact.id) }}</span>
      </div>
      <div
        class="font-mono"
        :class="valueClass(fact.met, fact.known)"
        :data-criterion="fact.id"
        :title="fact.id === 'age' ? ageTitle : fact.title"
      >
        {{ withThresholds ? fact.combined : fact.value }}
      </div>
    </div>

    <!-- Only where the tally is a question: under "all" every check has to pass
         and the colours have already said so. -->
    <div v-if="summary">
      <div class="uppercase tracking-wider opacity-50">
        {{ t('badgeContentChecks') }}<span v-if="aggregated" class="opacity-80" data-fold="checks">{{ foldLabel('checks') }}</span>
      </div>
      <div
        class="font-mono font-bold"
        :class="valueClass(summary.met)"
        data-criterion="checks"
        :title="summary.title"
      >
        {{ summary.combined }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.familiarity-grid {
  grid-template-columns: repeat(auto-fit, minmax(5.5em, 1fr));
}
</style>
