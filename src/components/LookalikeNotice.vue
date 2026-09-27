<script setup lang="ts">
import type { LookalikeMatch, LookalikeReason } from '~/logic/domain-similarity'
import { computed, inject, ref } from 'vue'
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
}>()

const isDark = inject('isDark', ref(false))
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
  <div v-if="matches.length" class="mb-2 flex flex-col gap-1.5">
    <div
      v-for="match in matches"
      :key="match.domain"
      data-lookalike
      :data-lookalike-reason="match.reason"
      :data-lookalike-source="match.source ?? 'history'"
      class="flex items-start gap-1"
    >
      <span
        class="flex-shrink-0"
        :class="match.severity === 'high' ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-amber-400' : 'text-amber-700')"
        aria-hidden="true"
      >⚠</span>
      <span class="break-words">
        <!-- Colours named on every part rather than inherited. This renders
             inside a shadow root on somebody else's page, and `color` crosses
             that boundary – text that names no colour takes the host page's. -->
        <span :class="match.severity === 'high' ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-amber-400' : 'text-amber-700')">
          {{ sentence(match).before }}<span class="whitespace-nowrap"><!--
            A block of its own, so it moves to the next line whole. Kept on one
            line with nowrap alone it still split at the dot, since Chrome breaks
            at the <wbr> SecureText puts there regardless. It only breaks inside
            when it is wider than the line on its own.

            Grey whatever the severity. This is the site the user knows, not
            the one to be wary of, and drawn in the warning's red it read as
            though the familiar site were the danger. Not green either: a green
            name inside a warning is the one thing a skimming eye would take
            for "this link is fine".
          --><span
            data-lookalike-site
            class="inline-block max-w-full font-mono px-1 rounded whitespace-normal"
            :class="isDark ? 'bg-gray-700 text-gray-100' : 'bg-gray-100 text-gray-800'"
            ><SecureText :text="match.domain" force-highlight danger-only /></span>{{ sentence(match).glue }}</span>{{ sentence(match).after }}<span
            v-if="sentence(match).real"
            class="whitespace-nowrap"
          ><!--
            The site the address really belongs to, and the one to be wary of,
            so this block is the one in red. Blocked like the familiar name, so
            where it starts and stops is as plain.
          --><span
            data-lookalike-real
            class="inline-block max-w-full font-mono px-1 rounded whitespace-normal"
            :class="isDark ? 'bg-red-400/20 text-red-200' : 'bg-red-100 text-red-800'"
          ><SecureText :text="sentence(match).real" force-highlight danger-only /></span></span>{{ sentence(match).end }}
        </span>
        <!-- No visit count after it. "The familiar site" already gives the
             verdict, and a number at the end of a sentence about another address
             read as that address's visits rather than the familiar site's. -->
      </span>
    </div>
  </div>
</template>
