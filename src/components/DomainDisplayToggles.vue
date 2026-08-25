<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { settings } from '~/logic/storage'

/**
 * How an address is drawn: case, highlighting, and which spelling of an
 * international name is shown.
 *
 * One row rather than three copies. The controls used to live inside the
 * subdomain list, which only exists once a site has visits – so the check page,
 * where somebody is looking hard at an address they do not know, had no way to
 * switch any of it on. They are settings, not list controls, and they belong
 * next to the other display control there is, the font size.
 *
 * Each button shows the state it is in and says the action in its tooltip: a
 * control that only shows state leaves the reader guessing what pressing it
 * does, and highlighting leaves a plain Latin address untouched, so without the
 * button's own state that one reads as broken.
 */
const { t } = useI18n()

// `t` is a computed holding the lookup function, so a script-side read goes
// through `.value` – in a template Vue unwraps it and `t(key)` is enough
const caseTitle = computed(() => settings.value.domainCase === 'upper'
  ? t.value('caseToLower')
  : t.value('caseToUpper'))

const highlightingTitle = computed(() => {
  const action = settings.value.domainHighlighting
    ? t.value('highlightingTurnOff')
    : t.value('highlightingTurnOn')
  return `${action}\n\n${t.value('highlightingLegend')}`
})

const punycodeTitle = computed(() => settings.value.punycodeListMode === 'unicode'
  ? t.value('punycodeShowAscii')
  : t.value('punycodeShowUnicode'))

function toggleDomainCase() {
  settings.value.domainCase = settings.value.domainCase === 'upper' ? 'lower' : 'upper'
}

function toggleHighlighting() {
  settings.value.domainHighlighting = !settings.value.domainHighlighting
}

function togglePunycodeListMode() {
  settings.value.punycodeListMode = settings.value.punycodeListMode === 'unicode' ? 'ascii' : 'unicode'
}
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
      :title="caseTitle"
      :aria-label="caseTitle"
      @click="toggleDomainCase"
    >
      {{ settings.domainCase === 'upper' ? 'AA' : 'aa' }}
    </button>
    <button
      class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
      :class="settings.domainHighlighting ? '!bg-blue-100 !border-blue-200 dark:!bg-blue-900/40 dark:!border-blue-700' : 'grayscale opacity-60'"
      :title="highlightingTitle"
      :aria-label="highlightingTitle"
      :aria-pressed="settings.domainHighlighting"
      @click="toggleHighlighting"
    >
      🌈
    </button>
    <button
      class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center font-bold"
      :title="punycodeTitle"
      :aria-label="punycodeTitle"
      @click="togglePunycodeListMode"
    >
      {{ settings.punycodeListMode === 'unicode' ? 'O' : 'P' }}
    </button>
  </div>
</template>
