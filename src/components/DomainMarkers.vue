<script setup lang="ts">
import type { DomainMarkerId } from '~/logic/domain-markers'
import { computed, inject, ref } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { findDomainMarkers } from '~/logic/domain-markers'

// Structural facts about an address – never a verdict, so this renders as a
// short list of observations rather than as a safe/unsafe badge.
const props = defineProps<{
  hostname: string
  url?: string | null
  /**
   * Lines the caller knows and this component does not – what a list says about
   * the host, say. Drawn first, in the same shape, so a notice and a marker under
   * one address read as one list rather than two blocks with a gap between them.
   */
  notes?: { id: string, text: string }[]
}>()

const isDark = inject('isDark', ref(false))
const { t } = useI18n()

const TRANSLATION_KEYS: Record<DomainMarkerId, string> = {
  'url-userinfo': 'domainMarkerUserinfo',
  'ip-host': 'domainMarkerIpHost',
  'embedded-public-suffix': 'domainMarkerEmbeddedSuffix',
  'deep-subdomains': 'domainMarkerDeepSubdomains',
  'mixed-scripts': 'domainMarkerMixedScripts',
}

const markers = computed(() => {
  if (!props.hostname)
    return []
  return findDomainMarkers(props.hostname, props.url)
})
</script>

<template>
  <div v-if="markers.length || notes?.length" class="mb-2 flex flex-col gap-1">
    <div
      v-for="note in notes"
      :key="note.id"
      :data-marker-note="note.id"
      class="flex items-start gap-1 leading-snug"
      :class="isDark ? 'text-amber-400' : 'text-amber-700'"
    >
      <span class="flex-shrink-0" aria-hidden="true">⚠</span>
      <span class="break-words">{{ note.text }}</span>
    </div>
    <div
      v-for="marker in markers"
      :key="marker.id"
      class="flex items-start gap-1 leading-snug"
      :class="isDark ? 'text-amber-400' : 'text-amber-700'"
    >
      <span class="flex-shrink-0" aria-hidden="true">⚠</span>
      <!-- break-words, not break-all: wrap between words, and only ever split a
           word that cannot fit on its own. An address or an IPv4 stays intact. -->
      <span class="break-words">
        {{ t(TRANSLATION_KEYS[marker.id]) }}<template v-if="marker.detail">:
          <SecureText :text="marker.detail" force-highlight danger-only class="font-mono whitespace-nowrap" />
        </template>
      </span>
    </div>
  </div>
</template>
