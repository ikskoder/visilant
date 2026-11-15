<script setup lang="ts">
import type { LookalikeMatch, LookalikeReason } from '~/logic/domain-similarity'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikes } from '~/composables/useLookalikes'
import { getRegistrableDomain } from '~/logic/domain-markers'
import { isRedFlagLookalike } from '~/logic/red-flags'

// Does this address resemble one the user already knows? The question and its
// memoised answer live in useLookalikes, which the structural markers read too.
const props = defineProps<{
  hostname: string
  /**
   * Set when the hostname came out of an email address. Widens the comparison to
   * the mail providers, which the history cannot supply: somebody who lives in
   * Gmail has only `mail.google.com` on record.
   */
  context?: 'email'
  /** One half of the lines, see `DomainMarkers`: the sure lookalikes, which are red flags, or the near misses. */
  show?: 'flags' | 'cautions'
}>()

const { t } = useI18n()

const REASON_KEYS: Record<LookalikeReason, string> = {
  'confusable': 'lookalikeReasonConfusable',
  'edit-distance': 'lookalikeReasonEditDistance',
  'contains-familiar': 'lookalikeReasonContains',
  'familiar-as-subdomain': 'lookalikeReasonSubdomain',
  'same-name': 'lookalikeReasonSameName',
}

/**
 * One sentence per match, with the imitated domain inside it.
 *
 * It used to be two lines, the domain on the first and the reason on the
 * second, and the reason said "that name" – which reads as nothing at all to
 * somebody meeting it for the first time. The domain is now named in the
 * sentence and drawn as a filled block, so where the name starts and stops is
 * plain, and the reason follows it directly.
 */
function sentence(match: LookalikeMatch): { before: string, glue: string, after: string, real: string, end: string } {
  const who = t.value(match.source === 'provider' ? 'lookalikeWhoProvider' : 'lookalikeWhoFamiliar')
  const [before = '', rest = ''] = t.value(REASON_KEYS[match.reason]).replace('{who}', who).split('{site}')
  // The comma after the name stays with it. Left to wrap on its own it opened
  // the next line, which reads as a sentence starting with a comma.
  const glue = /^[^\s\p{L}\p{N}]*/u.exec(rest)?.[0] ?? ''
  // `{real}` is the site the address actually belongs to, which only the
  // subdomain sentence names
  const [after = '', end] = rest.slice(glue.length).split('{real}')
  const real = end === undefined ? '' : match.site || getRegistrableDomain(props.hostname)
  return { before, glue, after, real, end: end ?? '' }
}

/**
 * The familiar names the line gives: one, or every domain parked in front of
 * the same site, so the real site is named once. Joined with "or" between
 * every two, never a comma, which beside an address reads as one of its dots.
 */
function names(match: LookalikeMatch): string[] {
  return [match.domain, ...(match.also ?? []).map(item => item.domain)]
}

const answer = useLookalikes(() => props.hostname, () => props.context)
// Background asleep or unreachable – say nothing rather than guess
const matches = computed<LookalikeMatch[]>(() => {
  const all = answer.value?.status === 'answered' ? answer.value.matches : []
  // The red flags first, as among the markers
  return [
    ...(props.show === 'cautions' ? [] : all.filter(isRedFlagLookalike)),
    ...(props.show === 'flags' ? [] : all.filter(match => !isRedFlagLookalike(match))),
  ]
})
</script>

<template>
  <!-- A sure lookalike is a red flag, red with a flag. A near miss is orange
       with the shield and its exclamation mark: on its own it is as often an
       honest neighbour as a copy (see logic/red-flags.ts). -->
  <div v-if="matches.length" class="lookalike-notice grid gap-2">
    <VzNotice
      v-for="match in matches"
      :key="match.domain"
      :tone="isRedFlagLookalike(match) ? 'danger' : 'caution'"
      :icon="isRedFlagLookalike(match) ? 'flag' : undefined"
      :data-red-flag="isRedFlagLookalike(match) ? '' : undefined"
      data-lookalike
      :data-lookalike-reason="match.reason"
      :data-lookalike-source="match.source ?? 'history'"
      :data-lookalike-severity="match.severity"
    >
      <!-- Both names drawn as addresses, with their frames: the heavier ones
           show whose site each really is, which is the whole point of the line.
           Each keeps the punctuation after it on its own line. -->
      {{ sentence(match).before }}<template v-for="(name, index) in names(match)" :key="name">
        <!-- Spaced here: the template compiler trims a line of its own -->
        <template v-if="index">
          {{ ` ${t('listOr')} ` }}
        </template><span class="vz-nobr"><SecureText
          :text="name"
          size="s"
          plain
          data-lookalike-site
        /><template v-if="index === names(match).length - 1">{{ sentence(match).glue }}</template></span>
      </template>{{ sentence(match).after }}<span
        v-if="sentence(match).real"
        class="vz-nobr"
      ><SecureText :text="sentence(match).real" size="s" plain data-lookalike-real /></span>{{ sentence(match).end }}
      <!-- No visit count after it. "The familiar site" already gives the
           verdict, and a number at the end of a sentence about another address
           read as that address's visits rather than the familiar site's. -->
    </VzNotice>
  </div>
</template>
