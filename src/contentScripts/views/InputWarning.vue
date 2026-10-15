<script setup lang="ts">
import VzIcon from '~/components/VzIcon.vue'
import VzSig from '~/components/VzSig.vue'
import { useI18n } from '~/composables/useI18n'
import { useTopLayer } from '~/composables/useTopLayer'

const props = defineProps<{
  safetyLevel: boolean | null
  show: boolean
  warningType: 'input' | 'copy'
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()

// Above anything the page can lay over it, without blocking the page – see
// `useTopLayer`
const layer = useTopLayer({
  mode: 'popover',
  visible: () => props.show && props.safetyLevel === false,
})
</script>

<template>
  <Transition name="slide-fade" appear @enter="layer.enter">
    <!-- `left-auto bottom-auto`: a popover is pinned to all four edges until told otherwise -->
    <div
      v-if="show && safetyLevel === false"
      popover="manual"
      class="vz-layer fixed top-4 right-4 left-auto bottom-auto z-[2147483647] pointer-events-auto popup-container vz-overlay vz-toast vz-toast--danger"
      role="alert"
      data-verdict="unfamiliar"
    >
      <!-- A tinted band carries the warning. No pulsing frame and no glow: they
           drew the eye to the box, not to what it says. -->
      <div class="vz-toast__head">
        <VzIcon name="alert" large class="tone-danger" />
        <h3 class="vz-title">
          {{ t('securityWarning') }}
        </h3>
        <button
          class="vz-iconbtn"
          :aria-label="t('dismiss')"
          :title="t('dismiss')"
          @click="emit('close')"
        >
          <VzIcon name="close" />
        </button>
      </div>

      <div class="vz-toast__body">
        <p class="vz-body-strong">
          <template v-if="warningType === 'input'">
            {{ t('inputWarningMessage') }}
          </template>
          <template v-else>
            {{ t('copyWarningMessage') }}
          </template>
        </p>
        <!-- Typing is about which site this is, and the message itself sends
             the reader to the toolbar window for that. Copying is about what
             ended up in the clipboard, which no check of the address can tell. -->
        <ul v-if="warningType === 'copy'" class="toast-list vz-body">
          <li>{{ t('avoidShell') }}</li>
          <li>{{ t('verifyContent') }}</li>
        </ul>

        <!--
          A line, and deliberately not a button.

          This used to be "Don't show again", one click from silencing every
          warning about the site for good. The page cannot press it – the
          shadow root is closed, so there is no path from the page to this
          button – but it does not need to. It only has to write "press Don't
          show again to continue" somewhere above, and an honest reader
          silences the guard on the attacker's own hostname themselves.

          So the switch moved to the popup, which is browser chrome: a page
          cannot draw over it, script it, or know it was opened, and the
          reader decides while looking at our description of the site rather
          than at the page's. The last sentence is here to be read at exactly
          the moment such an instruction would be.
        -->
        <p class="vz-small">
          {{ t('warningSilenceHint') }}
        </p>
        <VzSig />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.popup-container {
  width: min(400px, calc(100vw - 32px));
  max-width: none;
}

.toast-list {
  list-style: disc;
  padding-left: 20px;
  display: grid;
  gap: 2px;
}

/* Fade and lift by 8px, nothing more */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-8px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .slide-fade-enter-from,
  .slide-fade-leave-to {
    transform: none;
  }
}
</style>
