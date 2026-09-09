<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { buildLookupUrl, getLookupServices, openInBackgroundTab } from '~/logic/lookup-services'
import { settings } from '~/logic/storage'

// Plain links, not API calls: the extension issues no request of its own, and
// the user decides whether to follow one. Collapsed until asked for, so a row of
// "maybe look elsewhere" does not crowd out the answer already on screen.
const props = defineProps<{
  hostname: string
}>()

const isDark = inject('isDark', ref(false))
const { t } = useI18n()

const expanded = ref(false)

const links = computed(() => {
  return getLookupServices(settings.value.lookupServices)
    .map(service => ({ name: service.name, url: buildLookupUrl(service, props.hostname) }))
    .filter((link): link is { name: string, url: string } => Boolean(link.url))
})

// A different address is a different question, so do not leave the panel open
watch(() => props.hostname, () => {
  expanded.value = false
})
</script>

<template>
  <div v-if="links.length" class="mt-2">
    <!-- The caveat rides on the toggle rather than sitting under the links. It
         is about what following one of them costs, which is worth knowing
         before the row is even opened, and as a line of its own it was three
         lines of small print under a row of buttons in the busiest panel in
         the extension. -->
    <button
      class="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity"
      :aria-expanded="expanded"
      :title="t('externalLookupsCaveat')"
      @click="expanded = !expanded"
    >
      <span>{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ t('externalLookupsTitle') }}</span>
    </button>

    <div v-if="expanded" class="mt-1">
      <div class="flex flex-wrap gap-1.5">
        <a
          v-for="link in links"
          :key="link.name"
          :href="link.url"
          target="_blank"
          rel="noreferrer noopener"
          class="px-1.5 py-0.5 rounded border transition-colors"
          :class="isDark
            ? 'border-gray-600 hover:bg-gray-700 text-blue-300'
            : 'border-gray-300 hover:bg-gray-100 text-blue-700'"
          @click="openInBackgroundTab($event, link.url)"
        >{{ link.name }} ↗</a>
      </div>
    </div>
  </div>
</template>
