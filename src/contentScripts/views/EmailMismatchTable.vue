<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import type { FamiliarityStats } from '~/logic/familiarity'
import type { EmailMismatch } from '~/logic/ui-state'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { ADDRESS_DOTS } from '~/logic/domain-markers'
import { canonicalMailDomain } from '~/logic/email-safety'
import { showsVisitFacts } from '~/logic/show-visit-facts'

/**
 * What the text of a mail link shows, set against an address the mail goes
 * to, part by part: the username, the domain, what is known of each domain.
 * Two lines, "Shows:" and "Goes to:", left the reader to hold two addresses
 * against each other letter by letter.
 *
 * A part that is the same on both sides is drawn once, across both columns,
 * and parts that differ stand each in their own, so what differs is what
 * stands in pairs. A domain is said once with its one verdict. Visits are
 * shown only for a side judged by them: a mail service is never opened, its
 * badge names what it is, and a cell says why it has no numbers.
 *
 * A link with several recipients and text that names none of them gets one
 * table per recipient (`position`), since any of them may be the one the text
 * pretends to be.
 */
interface Side {
  username: string | null
  domain: string
  providerKind: EmailProviderKind
  stats: FamiliarityStats
  isSafe: boolean
  unchecked?: boolean
}

const props = defineProps<{
  shows: EmailMismatch
  goes: Side
  /** Which recipient this is, when there are several */
  position?: { n: number, total: number }
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
}>()

const { t } = useI18n()
const { factsFor, summaryFor, withThresholds, statusLabel } = useFamiliarityFacts()

// In any case, and a domain in any spelling: the same address written two ways is one
const sameUsername = computed(() => props.shows.username !== null && props.shows.username.toLowerCase() === props.goes.username?.toLowerCase())
const sameDomain = computed(() => canonicalMailDomain(props.shows.domain) === canonicalMailDomain(props.goes.domain))

/**
 * The letters of the labels of the destination that the text does not have
 * anywhere: `yourbank-help` in `yourbank-help.test` against
 * `yourbank.test`, `evil` and `test` in `acme.com.evil.test` against
 * `acme.com`. Underlined, as a lookalike's changed letters are. Counted as
 * SecureText counts them: in code points, a dot of any kind one of them.
 */
const domainDiff = computed(() => {
  const shown = new Set(canonicalMailDomain(props.shows.domain).split('.'))
  const labels = props.goes.domain.split(ADDRESS_DOTS)
  const marked: number[] = []
  let at = 0
  for (const label of labels) {
    const length = [...label].length
    if (label && !shown.has(canonicalMailDomain(label))) {
      for (let i = 0; i < length; i++)
        marked.push(at + i)
    }
    at += length + 1
  }
  // Every label is somewhere in the text, in another order or twice,
  // `paypal.com.com` against `paypal.com`: the labels that do not stand
  // where they stand in the text, counted from the end
  if (marked.length || sameDomain.value)
    return marked
  const fromEnd = canonicalMailDomain(props.shows.domain).split('.').reverse()
  at = 0
  labels.forEach((label, index) => {
    const length = [...label].length
    if (label && fromEnd[labels.length - 1 - index - (labels.at(-1) === '' ? 1 : 0)] !== canonicalMailDomain(label)) {
      for (let i = 0; i < length; i++)
        marked.push(at + i)
    }
    at += length + 1
  })
  return marked
})

const sides = computed(() => [props.shows, props.goes].map((side) => {
  const service = side.providerKind !== 'regular'
  return {
    side,
    service,
    cells: service
      ? 'service' as const
      : side.unchecked
        ? 'unchecked' as const
        : showsVisitFacts(props.showVisitCount, side.isSafe) ? 'facts' as const : 'hidden' as const,
  }
}))

const factRows = computed(() => {
  const right = factsFor(props.goes.stats)
  return factsFor(props.shows.stats).map((left, index) => ({ id: left.id, label: left.label, facts: [left, right[index]] }))
})
const summaryRow = computed(() => {
  const left = summaryFor(props.shows.stats)
  const right = summaryFor(props.goes.stats)
  return left && right ? [left, right] : null
})
// As in the table of a link: the rows are there while one side has visits on show
const anyFacts = computed(() => !sameDomain.value && sides.value.some(({ side, cells }) => cells === 'facts' && Number(side.stats.count) > 0))
const factRowCount = computed(() => factRows.value.length + (summaryRow.value ? 1 : 0))

function verdict(side: Side) {
  return statusLabel(side.isSafe, side.stats.count, side.unchecked)
}
function cell(fact: { value: string, combined: string }) {
  return withThresholds.value ? fact.combined : fact.value
}
</script>

<template>
  <table class="vz-table email-mismatch" data-email-mismatch>
    <thead>
      <tr>
        <th><span class="sr-only">{{ t('familiarityFactCheck') }}</span></th>
        <!-- Each heading copies its whole address, as the two lines before the table did -->
        <th>
          {{ t('linkTooltipShowsDomain') }}
          <CopyButton :text="shows.textAddress" />
        </th>
        <th>
          {{ position ? t('emailMismatchGoesToOf').replace('{n}', String(position.n)).replace('{total}', String(position.total)) : t('emailTooltipActualAddress') }}
          <CopyButton :text="`${goes.username}@${goes.domain}`" />
        </th>
      </tr>
    </thead>
    <tbody>
      <tr data-row="username">
        <th scope="row">
          {{ t('emailUsernameLabel') }}
        </th>
        <td v-if="sameUsername" colspan="2" class="email-mismatch__once" data-same>
          <SecureText kind="account" :text="goes.username!" size="s" preserve-case />
        </td>
        <template v-else>
          <td data-side="shows">
            <SecureText v-if="shows.username !== null" kind="account" :text="shows.username" size="s" preserve-case />
            <span v-else class="text-ink-3" data-no-username>{{ t('emailMismatchNoUsername') }}</span>
          </td>
          <td data-side="goes" class="email-mismatch__differs">
            <SecureText kind="account" :text="goes.username!" size="s" preserve-case />
          </td>
        </template>
      </tr>
      <tr data-row="domain">
        <th scope="row">
          {{ t('emailDomainLabel') }}
        </th>
        <td v-if="sameDomain" colspan="2" class="email-mismatch__once" data-same>
          <SecureText :text="goes.domain" size="s" />
        </td>
        <template v-else>
          <td data-side="shows">
            <SecureText :text="shows.domain" size="s" />
          </td>
          <td data-side="goes">
            <SecureText :text="goes.domain" size="s" :diff="domainDiff" />
          </td>
        </template>
      </tr>
      <tr data-row="status">
        <th scope="row">
          {{ t('linkInterceptStatus') }}
        </th>
        <template v-for="({ side, service }, at) in sides" :key="at">
          <td v-if="!sameDomain || at === 0" :colspan="sameDomain ? 2 : undefined" :class="{ 'email-mismatch__once': sameDomain }">
            <MailServiceBadge v-if="service" :kind="side.providerKind as Exclude<EmailProviderKind, 'regular'>" />
            <VzBadge v-else :tone="verdict(side).tone" :icon="verdict(side).icon" :data-verdict="verdict(side).verdict">
              {{ verdict(side).text }}
            </VzBadge>
          </td>
        </template>
      </tr>
      <template v-if="anyFacts">
        <tr v-for="(row, index) in factRows" :key="row.id">
          <th scope="row">
            {{ row.label }}
          </th>
          <template v-for="({ cells }, at) in sides" :key="at">
            <!-- One cell down every row of numbers, saying why there are none -->
            <td v-if="cells === 'service' && index === 0" :rowspan="factRowCount" class="text-ink-3 email-mismatch__why" data-not-by-visits>
              {{ t('emailMismatchNotByVisits') }}
            </td>
            <td v-else-if="cells !== 'service'">
              <span v-if="cells === 'unchecked'" class="text-ink-3">–</span>
              <span v-else-if="cells === 'facts'" class="email-mismatch__fact">
                <VzIcon :name="row.facts[at].met ? 'pass' : 'fail'" :label="t(row.facts[at].met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="row.facts[at].met ? 'tone-safe' : 'tone-danger'" :data-passed="row.id" :data-result="row.facts[at].met ? 'pass' : 'fail'" />
                <span class="vz-fact__value" :class="{ 'vz-fact__value--none': !row.facts[at].known }">{{ cell(row.facts[at]) }}</span>
              </span>
              <span v-else class="text-ink-3">{{ t('mismatchVisitsHidden') }}</span>
            </td>
          </template>
        </tr>
        <tr v-if="summaryRow" class="vz-fact--total">
          <th scope="row">
            {{ t('badgeContentChecks') }}
          </th>
          <template v-for="({ cells }, at) in sides" :key="at">
            <td v-if="cells !== 'service'">
              <span v-if="cells === 'unchecked'" class="text-ink-3">–</span>
              <span v-else-if="cells === 'facts'" class="email-mismatch__fact">
                <VzIcon :name="summaryRow[at].met ? 'pass' : 'fail'" :label="t(summaryRow[at].met ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="summaryRow[at].met ? 'tone-safe' : 'tone-danger'" data-passed="checks" :data-result="summaryRow[at].met ? 'pass' : 'fail'" />
                <span class="vz-fact__value">{{ summaryRow[at].combined }}</span>
              </span>
              <span v-else class="text-ink-3">{{ t('mismatchVisitsHidden') }}</span>
            </td>
          </template>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<style scoped>
.email-mismatch {
  table-layout: fixed;
}

.email-mismatch th:first-child {
  /* A share, not a width: at a larger text size on a phone a fixed one left
     the two sides too narrow for a badge */
  width: 26%;
}

/* A part drawn once for both sides stands in the middle of the two */
.email-mismatch__once {
  text-align: center;
}

/* The username the mail really goes to, where it is not the one shown */
.email-mismatch__differs :deep(.vz-addr__acct) {
  border: 2px solid var(--danger);
}

.email-mismatch__fact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.email-mismatch :deep(.vz-badge) {
  white-space: normal;
}
</style>
