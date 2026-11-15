<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'

// The evidence behind a familiarity verdict: the facts the user's own rules are
// drawn from, and nothing else. Whatever the surface, the same numbers appear in
// the same order and mean the same thing – see useFamiliarityFacts.
const props = defineProps<{
  stats: FamiliarityStats
  /**
   * The verdict is drawn as a badge right beside these facts.
   *
   * It only matters for a site with no visits at all. Every fact of such a
   * record is a zero that fails, so the three lines said "never visited" three
   * more times under a badge that had just said it. Beside a badge they are
   * left out, and anywhere else they fold into the one line that is true.
   */
  verdictBeside?: boolean
}>()

const { t, factsFor, summaryFor, withThresholds } = useFamiliarityFacts()

const never = computed(() => !(Number(props.stats?.count) > 0))
const facts = computed(() => factsFor(props.stats))
const summary = computed(() => summaryFor(props.stats))
</script>

<template>
  <div v-if="!never || !verdictBeside" class="familiarity-facts">
    <!-- Nothing recorded: one line, and nothing at all where a badge says it -->
    <ul v-if="never" class="vz-facts">
      <li class="vz-fact" data-never-visited>
        <VzIcon name="fail" :label="t('familiarityFactFailed')" class="tone-danger" />
        <span class="vz-fact__label">{{ t('linkTooltipNeverVisited') }}</span>
      </li>
    </ul>

    <!--
      Two shapes for the same facts, because the bar changes what the numbers
      need around them. Without it a line explains itself – "Visits 209" – and
      one fact per line is all the structure it takes. With it there are four
      things to hold per check, and a bare "209 / 10" a moment later is a pair of
      numbers whose meaning nobody remembers. So the bar brings headings with it.

      The value itself is never coloured. The mark carries the result, in a
      shape as well as a colour: a tick or a cross in a disc.
    -->
    <table v-else-if="withThresholds" class="vz-table familiarity-table">
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
            {{ fact.value }}
          </td>
          <td class="vz-fact__need" :data-required="fact.id">
            {{ fact.required }}
          </td>
        </tr>

        <!-- Bold, because this row is the conclusion and the ones above it are
             the working that led there -->
        <tr v-if="summary" class="vz-fact--total" :title="summary.title">
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
        <span class="vz-fact__value" :class="{ 'vz-fact__value--none': !fact.known }" :data-criterion="fact.id">{{ fact.value }}</span>
      </li>

      <li v-if="summary" class="vz-fact vz-fact--total" :title="summary.title">
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
