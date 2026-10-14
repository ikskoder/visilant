<script setup lang="ts">
import type { LookalikeMatch, LookalikeReason } from '~/logic/domain-similarity'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikes } from '~/composables/useLookalikes'
import { getRegistrableDomain } from '~/logic/domain-markers'

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
  /** No box around each line, for the tooltip where space is tight. */
  bare?: boolean
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

const answer = useLookalikes(() => props.hostname, () => props.context)
// Background asleep or unreachable – say nothing rather than guess
const matches = computed<LookalikeMatch[]>(() => answer.value?.status === 'answered' ? answer.value.matches : [])
</script>

<template>
  <!-- Red whatever the severity: a near miss and a sure one ask the same thing
       of the reader, to look again before going on. The words say how close. -->
  <div v-if="matches.length" class="lookalike-notice grid gap-2">
    <VzNotice
      v-for="match in matches"
      :key="match.domain"
      tone="danger"
      :bare="bare"
      data-lookalike
      :data-lookalike-reason="match.reason"
      :data-lookalike-source="match.source ?? 'history'"
      :data-lookalike-severity="match.severity"
    >
      <!-- Both names drawn as addresses, with their frames: the heavier ones
           show whose site each really is, which is the whole point of the line.
           Each keeps the punctuation after it on its own line. -->
      {{ sentence(match).before }}<span class="vz-nobr"><SecureText
        :text="match.domain"
        size="s"

        data-lookalike-site
      />{{ sentence(match).glue }}</span>{{ sentence(match).after }}<span
        v-if="sentence(match).real"
        class="vz-nobr"
      ><SecureText :text="sentence(match).real" size="s" data-lookalike-real /></span>{{ sentence(match).end }}
      <!-- No visit count after it. "The familiar site" already gives the
           verdict, and a number at the end of a sentence about another address
           read as that address's visits rather than the familiar site's. -->
    </VzNotice>
  </div>
</template>
