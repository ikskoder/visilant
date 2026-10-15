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
const { t, factsFor, summaryFor, withThresholds } = useFamiliarityFacts()

const facts = computed(() => factsFor(props.stats))
const summary = computed(() => summaryFor(props.stats))
</script>

<template>
  <div class="familiarity-facts">
    <!-- The verdict comes first, right under the address it is about. It is the
         answer, and the numbers below it are the working – a reader who only
         wants the answer should not have to get past three rows to reach it. -->
    <div v-if="slots.status" class="mb-2">
      <slot name="status" />
    </div>

    <!--
      Two shapes for the same facts, because the bar changes what the numbers
      need around them. Without it a line explains itself – "Visits 209" – and
      one fact per line is all the structure it takes. With it there are four
      things to hold per check, and a bare "209 / 10" a moment later is a pair of
      numbers whose meaning nobody remembers. So the bar brings headings with it.

      The value itself is never coloured. The mark carries the result, in a
      shape as well as a colour: a tick or a cross in a disc.
    -->
    <table v-if="withThresholds" class="vz-table familiarity-table">
      <thead>
        <tr>
          <th><span class="sr-only">{{ t('familiarityFactResult') }}</span></th>
          <th>{{ t('familiarityFactCheck') }}</th>
          <th>{{ t('familiarityFactValue') }}</th>
          <th>{{ t('familiarityFactNeeded') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fact in facts" :key="fact.id" :title="fact.title">
          <td class="familiarity-mark">
            <VzIcon :name="fact.met ? 'pass' : 'fail'" :label="t(fact.met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="fact.met ? 'tone-safe' : 'tone-danger'" :data-passed="fact.id" :data-result="fact.met ? 'pass' : 'fail'" />
          </td>
          <th scope="row">
            {{ fact.label }}
          </th>
          <td class="vz-fact__value" :class="{ 'vz-fact__value--none': !fact.known }" :data-criterion="fact.id">
            <FactText :text="fact.value" />
          </td>
          <td class="vz-fact__need" :data-required="fact.id">
            <FactText :text="fact.required" />
          </td>
        </tr>

        <!-- Bold, because this row is the conclusion and the ones above it are
             the working that led there -->
        <tr v-if="summary" class="font-bold" :title="summary.title">
          <td class="familiarity-mark">
            <VzIcon :name="summary.met ? 'pass' : 'fail'" :label="t(summary.met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="summary.met ? 'tone-safe' : 'tone-danger'" data-passed="checks" :data-result="summary.met ? 'pass' : 'fail'" />
          </td>
          <th scope="row">
            {{ t('badgeContentChecks') }}
          </th>
          <td class="vz-fact__value" data-criterion="checks">
            {{ summary.value }}
          </td>
          <td class="vz-fact__need" data-required="checks">
            {{ summary.required }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- One fact per line rather than one run of them separated by dots. Three
         checks do not fit the width of a phone, and a line that wraps mid-fact
         is worse than a line break put where it belongs. The mark opens each
         line, so the marks stand in one column – the fastest read on the whole
         block. -->
    <ul v-else class="vz-facts">
      <li v-for="fact in facts" :key="fact.id" class="vz-fact" :title="fact.title">
        <VzIcon :name="fact.met ? 'pass' : 'fail'" :label="t(fact.met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="fact.met ? 'tone-safe' : 'tone-danger'" :data-passed="fact.id" :data-result="fact.met ? 'pass' : 'fail'" />
        <span class="vz-fact__label">{{ fact.label }}</span>
        <span class="vz-fact__value" :class="{ 'vz-fact__value--none': !fact.known }" :data-criterion="fact.id"><FactText :text="fact.value" /></span>
      </li>

      <li v-if="summary" class="vz-fact font-bold" :title="summary.title">
        <VzIcon :name="summary.met ? 'pass' : 'fail'" :label="t(summary.met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="summary.met ? 'tone-safe' : 'tone-danger'" data-passed="checks" :data-result="summary.met ? 'pass' : 'fail'" />
        <span class="vz-fact__label">{{ t('badgeContentChecks') }}</span>
        <span class="vz-fact__value" data-criterion="checks">{{ summary.combined }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.familiarity-table {
  width: auto;
}

.familiarity-mark {
  width: 1px;
  padding-right: 0;
}
</style>
