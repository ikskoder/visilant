<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'

/**
 * Puts one address, or one payload, on the clipboard exactly as it is, not as
 * the case setting draws it.
 *
 * Only through the asynchronous clipboard API. Inside a web page this runs in
 * the content script's own world, so the page's wrapper of that API never sees
 * the call, and no `copy` event fires that the page could rewrite on the way.
 * `execCommand('copy')` would fire one, which is why there is no fallback to it:
 * where the API is missing or refused, the button says it could not copy.
 */
const props = defineProps<{
  text: string
  /** Small enough to sit in a line of text rather than beside a heading-sized address. */
  inline?: boolean
}>()

const { t } = useI18n()

const state = ref<'idle' | 'copied' | 'failed'>('idle')
let reset: ReturnType<typeof setTimeout> | undefined
let gone = false

async function copy() {
  clearTimeout(reset)
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error('No clipboard here')
    await navigator.clipboard.writeText(props.text)
    state.value = 'copied'
  }
  catch {
    state.value = 'failed'
  }
  // The write can outlast the button, and nothing is left to put back then
  if (gone)
    return
  reset = setTimeout(() => state.value = 'idle', state.value === 'failed' ? 4000 : 1500)
}

onBeforeUnmount(() => {
  gone = true
  clearTimeout(reset)
})

const label = computed(() => t.value(state.value === 'copied' ? 'copyDone' : state.value === 'failed' ? 'copyFailed' : 'copyAction'))
</script>

<template>
  <!-- The words live in the title and in a status line only a screen reader
       hears, never as visible text, so the text of the address beside it, and
       anything that reads it, stays the address alone -->
  <button
    type="button"
    class="vz-iconbtn vz-copy"
    :class="inline ? 'vz-iconbtn--xs' : 'vz-iconbtn--sm'"
    data-action="copy"
    :data-copy-state="state"
    :title="label"
    :aria-label="t('copyAction')"
    @click.stop="copy"
  >
    <VzIcon :name="state === 'copied' ? 'check-mark' : state === 'failed' ? 'fail' : 'copy'" />
  </button>
  <!-- Beside the button, not in it: a button's contents are not read out as a
       live region. Empty while nothing has happened, so it adds no text. -->
  <span class="sr-only" role="status">{{ state === 'idle' ? '' : label }}</span>
</template>
