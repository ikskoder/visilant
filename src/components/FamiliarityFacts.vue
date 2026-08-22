<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed, useSlots } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'

// The evidence behind a familiarity verdict: the facts the user's own rules are
// drawn from, and nothing else. Whatever the surface, the same numbers appear in
// the same order and mean the same thing – see useFamiliarityFacts.
const props = defineProps<{
  stats: FamiliarityStats
}>()

const slots = useSlots()
const { t, factsFor, summaryFor, valueClass, withThresholds } = useFamiliarityFacts()

const facts = computed(() => factsFor(props.stats))
const summary = computed(() => summaryFor(props.stats))
</script>

<template>
  <div class="familiarity-facts">
    <!-- The verdict comes first, right under the address it is about. It is the
         answer, and the numbers below it are the working – a reader who only
         wants the answer should not have to get past three rows to reach it. -->
    <div v-if="slots.status" class="mb-1">
      <slot name="status" />
    </div>

    <!--
      Two shapes for the same facts, because the bar changes what the numbers
      need around them. Without it a line explains itself – "Visits: 209" – and
      one fact per line is all the structure it takes. With it there are four
      things to hold per check, and a bare "209 / 10" a moment later is a pair of
      numbers whose meaning nobody remembers. So the bar brings headings with it.
    -->
    <table v-if="withThresholds" class="familiarity-table w-full text-left">
      <thead>
        <tr class="opacity-60">
          <th class="font-normal" />
          <th class="font-normal">
            {{ t('familiarityFactCheck') }}
          </th>
          <th class="font-normal">
            {{ t('familiarityFactValue') }}
          </th>
          <th class="font-normal">
            {{ t('familiarityFactNeeded') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fact in facts" :key="fact.id" :title="fact.title">
          <!-- The marks open the rows so that they line up as a column against
               the left edge, which is the fastest read on the whole block. Never
               grey, whatever the cell beside it says: a check that did not pass
               is a check that did not pass. -->
          <td class="text-center" :class="valueClass(fact.met)" :data-passed="fact.id">
            {{ fact.met ? '✓' : '✗' }}
          </td>
          <td>{{ fact.label }}</td>
          <td class="font-medium whitespace-nowrap" :class="valueClass(fact.met, fact.known)" :data-criterion="fact.id">
            {{ fact.value }}
          </td>
          <td class="opacity-70 whitespace-nowrap" :data-required="fact.id">
            {{ fact.required }}
          </td>
        </tr>

        <!-- Bold, because this row is the conclusion and the ones above it are
             the working that led there -->
        <tr v-if="summary" class="font-bold" :title="summary.title">
          <td class="text-center" :class="valueClass(summary.met)" data-passed="checks">
            {{ summary.met ? '✓' : '✗' }}
          </td>
          <td>{{ t('badgeContentChecks') }}</td>
          <td :class="valueClass(summary.met)" data-criterion="checks">
            {{ summary.value }}
          </td>
          <td class="opacity-70" data-required="checks">
            {{ summary.required }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- One fact per line rather than one run of them separated by dots. Three
         checks do not fit the width of a phone, and a line that wraps mid-fact
         is worse than a line break put where it belongs. The mark opens each
         line rather than closing it: the lines are of different lengths, so a
         trailing mark would sit at a different place on every one and the column
         of them – which is the fastest read on the whole block – would be gone.
         It is there at all because the colour alone asks the reader to already
         know what green means here. -->
    <span v-else class="flex flex-col items-start gap-y-0.5 leading-snug">
      <span v-for="fact in facts" :key="fact.id" class="whitespace-nowrap" :title="fact.title">
        <span class="mr-1" :class="valueClass(fact.met)" :data-passed="fact.id">{{ fact.met ? '✓' : '✗' }}</span>
        {{ fact.label }}:
        <span class="font-medium" :class="valueClass(fact.met, fact.known)" :data-criterion="fact.id">{{ fact.value }}</span>
      </span>

      <span v-if="summary" class="whitespace-nowrap font-bold" :title="summary.title">
        <span class="mr-1" :class="valueClass(summary.met)" data-passed="checks">{{ summary.met ? '✓' : '✗' }}</span>
        {{ t('badgeContentChecks') }}:
        <span :class="valueClass(summary.met)" data-criterion="checks">{{ summary.combined }}</span>
      </span>
    </span>
  </div>
</template>

<style scoped>
/* Drawn rather than implied. The page underneath has its own table styling and
   the shadow root does not keep all of it out, so every rule here is explicit. */
.familiarity-table {
  border-collapse: collapse !important;
  border: 1px solid rgba(107, 114, 128, 0.4) !important;
}

.familiarity-table th,
.familiarity-table td {
  border: 1px solid rgba(107, 114, 128, 0.25) !important;
  padding: 2px 6px !important;
  vertical-align: baseline !important;
}
</style>
