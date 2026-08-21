<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { buildLookupUrl, getLookupServices } from '~/logic/lookup-services'
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

/**
 * Open the lookup in a background tab so the popup survives the click.
 *
 * A popup closes the moment focus leaves it, so a plain link would let the user
 * check exactly one service and then have to start over. A tab opened
 * unfocused takes no focus, so several can be queued in one go.
 *
 * Modifier and middle clicks are left to the browser, and so is the whole thing
 * when there is no tabs API – the href stays on the anchor either way.
 */
async function openLookup(event: MouseEvent, url: string) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return

  if (!browser?.tabs?.create)
    return

  event.preventDefault()
  await browser.tabs.create({ url, active: false })
}
</script>

<template>
  <div v-if="links.length" class="mt-2">
    <button
      class="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity"
      :aria-expanded="expanded"
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
          @click="openLookup($event, link.url)"
        >{{ link.name }} ↗</a>
      </div>
      <!-- A notch larger than the links above it: the popup already scales this
           whole block down, and a caveat about what a third party gets to see
           has to stay readable at the bottom of that -->
      <p class="mt-1 opacity-60 leading-snug text-[1.1em]">
        {{ t('externalLookupsCaveat') }}
      </p>
    </div>
  </div>
</template>
