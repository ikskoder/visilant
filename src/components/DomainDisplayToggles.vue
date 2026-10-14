<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { settings } from '~/logic/storage'

/**
 * How an address is drawn: case, frames around its labels, and
 * which spelling of an international name is shown.
 *
 * One row rather than three copies. The controls used to live inside the
 * related-domain list, which only exists once a site has visits – so the check page,
 * where somebody is looking hard at an address they do not know, had no way to
 * switch any of it on. They are settings, not list controls, and they belong
 * next to the other display control there is, the font size.
 *
 * Each button shows the state it is in and says the action in its tooltip: a
 * control that only shows state leaves the reader guessing what pressing it
 * does.
 */
const { t } = useI18n()

// `t` is a computed holding the lookup function, so a script-side read goes
// through `.value` – in a template Vue unwraps it and `t(key)` is enough
const caseTitle = computed(() => settings.value.domainCase === 'upper'
  ? t.value('caseToLower')
  : t.value('caseToUpper'))

const framesTitle = computed(() => settings.value.addressFrames !== false
  ? t.value('framesTurnOff')
  : t.value('framesTurnOn'))

const punycodeTitle = computed(() => settings.value.punycodeListMode === 'unicode'
  ? t.value('punycodeShowAscii')
  : t.value('punycodeShowUnicode'))

function toggleDomainCase() {
  settings.value.domainCase = settings.value.domainCase === 'upper' ? 'lower' : 'upper'
}

function toggleFrames() {
  settings.value.addressFrames = settings.value.addressFrames === false
}

function togglePunycodeListMode() {
  settings.value.punycodeListMode = settings.value.punycodeListMode === 'unicode' ? 'ascii' : 'unicode'
}
</script>

<template>
  <!-- Each one shows the state it is in by being pressed or not, and says in its
       tooltip what a press will do next -->
  <div class="vz-toggles" role="group" :aria-label="t('addressDisplayGroup')">
    <button
      class="vz-toggle"
      :title="caseTitle"
      :aria-label="caseTitle"
      :aria-pressed="settings.domainCase === 'upper'"
      data-toggle="case"
      @click="toggleDomainCase"
    >
      <VzIcon name="case" />
    </button>
    <button
      class="vz-toggle"
      :title="framesTitle"
      :aria-label="framesTitle"
      :aria-pressed="settings.addressFrames !== false"
      data-toggle="frames"
      @click="toggleFrames"
    >
      <VzIcon name="frames" />
    </button>
    <button
      class="vz-toggle"
      :title="punycodeTitle"
      :aria-label="punycodeTitle"
      :aria-pressed="settings.punycodeListMode === 'ascii'"
      data-toggle="script"
      @click="togglePunycodeListMode"
    >
      <VzIcon name="script" />
    </button>
  </div>
</template>
