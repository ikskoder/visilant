<script setup lang="ts">
import type { LookalikeMatch, LookalikeReason } from '~/logic/domain-similarity'
import { inject, ref, watch } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'

// Does this address resemble one the user already knows? The comparison needs the
// familiar-domain index, which only the background holds, so this asks rather
// than computes. Results are memoised because the same address is checked again
// on every hover, navigation and panel open.
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
function sentence(match: LookalikeMatch): { before: string, glue: string, after: string } {
  const who = t.value(match.source === 'provider' ? 'lookalikeWhoProvider' : 'lookalikeWhoFamiliar')
  const [before = '', rest = ''] = t.value(REASON_KEYS[match.reason]).replace('{who}', who).split('{site}')
  // The comma after the name stays with it. Left to wrap on its own it opened
  // the next line, which reads as a sentence starting with a comma.
  const glue = /^[^\s\p{L}\p{N}]*/u.exec(rest)?.[0] ?? ''
  return { before, glue, after: rest.slice(glue.length) }
}

const CACHE_TTL_MS = 5 * 60_000
const CACHE_LIMIT = 200
const cache = new Map<string, { matches: LookalikeMatch[], at: number }>()

const matches = ref<LookalikeMatch[]>([])

async function lookup(hostname: string, context?: 'email'): Promise<LookalikeMatch[]> {
  // Keyed by context too: the same address is compared against a wider set when
  // it came out of an email, so one answer must not be served for the other
  const key = `${context ?? 'page'}:${hostname}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS)
    return cached.matches

  try {
    const result = await browser.runtime.sendMessage({
      type: 'find-lookalikes',
      data: { hostname, context },
    }) as LookalikeMatch[] | undefined

    const found = Array.isArray(result) ? result : []

    // A plain FIFO trim: this only guards against unbounded growth on a page
    // with thousands of distinct links, not against a hot-set eviction problem
    if (cache.size >= CACHE_LIMIT)
      cache.delete(cache.keys().next().value!)
    cache.set(key, { matches: found, at: Date.now() })

    return found
  }
  catch {
    // Background asleep or unreachable – say nothing rather than guess
    return []
  }
}

watch(() => props.hostname, async (hostname) => {
  matches.value = []
  if (!hostname)
    return

  const found = await lookup(hostname, props.context)
  // The hostname may have changed while the message was in flight
  if (hostname === props.hostname)
    matches.value = found
}, { immediate: true })
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
          --><span
            data-lookalike-site
            class="inline-block max-w-full font-mono px-1 rounded whitespace-normal"
            :class="match.severity === 'high'
              ? (isDark ? 'bg-red-400/20 text-red-200' : 'bg-red-100 text-red-800')
              : (isDark ? 'bg-amber-400/20 text-amber-100' : 'bg-amber-100 text-amber-900')"
            ><SecureText :text="match.domain" force-highlight danger-only /></span>{{ sentence(match).glue }}</span>{{ sentence(match).after }}
        </span>
        <!-- No visit count after it. "The familiar site" already gives the
             verdict, and a number at the end of a sentence about another address
             read as that address's visits rather than the familiar site's. -->
      </span>
    </div>
  </div>
</template>
