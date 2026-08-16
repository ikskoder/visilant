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
    <div v-for="match in matches" :key="match.domain" class="flex items-start gap-1">
      <span
        class="flex-shrink-0"
        :class="match.severity === 'high' ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-amber-400' : 'text-amber-700')"
        aria-hidden="true"
      >⚠</span>
      <span class="break-words">
        <span :class="match.severity === 'high' ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-amber-400' : 'text-amber-700')">
          {{ match.source === 'provider' ? t('lookalikeLooksLikeProvider') : t('lookalikeLooksLike') }}
          <SecureText :text="match.domain" force-highlight danger-only class="font-mono" />
        </span>
        <span class="opacity-70">
          <!-- A provider off the list was never visited, so a count of zero
               would read as a finding about the user rather than about it -->
          <template v-if="match.source !== 'provider'">
            · {{ t('linkTooltipVisits') }}: {{ match.visits }}
          </template>
          <br>
          {{ t(REASON_KEYS[match.reason]) }}
        </span>
      </span>
    </div>
  </div>
</template>
