<script setup lang="ts">
import type { PasteInterceptData } from '~/logic/ui-state'
import { computed, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  visible: boolean
  data: PasteInterceptData | null
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'allow', dontAskAgain: boolean): void
  (e: 'cancel', dontAskAgain: boolean): void
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()
const { statusLabel } = useFamiliarityFacts()

// Hidden by default. Whatever is pasted here is exactly the kind of thing that
// should not land on a screen without being asked for.
const revealed = ref(false)
// Ticking this turns the site off for good, so it must never carry over from a
// previous dialog on a different address
const dontAskAgain = ref(false)
watch(() => props.visible, () => {
  revealed.value = false
  dontAskAgain.value = false
})

/**
 * What the dialog is for right now.
 *
 * A held paste has to say something even before there is a verdict, and again
 * when the verdict turns out to be "this site is fine" or "no idea". Absent
 * means the case this dialog started life as: an unfamiliar site.
 */
const status = computed(() => props.data?.status ?? 'unfamiliar')
const isDecision = computed(() => status.value === 'unfamiliar' || status.value === 'error')

const title = computed(() => {
  switch (status.value) {
    case 'checking': return t.value('pasteInterceptCheckingTitle')
    case 'safe': return t.value('pasteInterceptSafeTitle')
    case 'error': return t.value('pasteInterceptErrorTitle')
    default: return t.value('pasteInterceptTitle')
  }
})

const message = computed(() => {
  switch (status.value) {
    case 'checking': return t.value('pasteInterceptCheckingMessage')
    case 'safe': return t.value('pasteInterceptSafeMessage')
    case 'error': return t.value('pasteInterceptErrorMessage')
    default: return t.value('pasteInterceptMessage')
  }
})

const payloadKind = computed(() => {
  const kind = props.data?.payload.kind
  return kind ? t.value(`pasteInterceptKind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`) : ''
})
</script>

<template>
  <Transition name="overlay-fade">
    <div
      v-if="visible && data"
      class="fixed inset-0 z-[2147483647] flex items-center justify-center pointer-events-auto"
      @click.self="emit('cancel', dontAskAgain)"
    >
      <!-- Backdrop. Transparent to clicks, or it would sit between the user and
           the overlay behind it and swallow every click-outside -->
      <div class="absolute inset-0 bg-black/60 pointer-events-none" />

      <!-- Dialog card -->
      <div
        class="relative dialog-container rounded-xl shadow-2xl px-5 pb-5 pt-4"
        :class="isDark ? 'bg-gray-900 border border-gray-700/50' : 'bg-white border border-gray-200'"
      >
        <!-- Warning icon + title + close -->
        <div class="flex items-center gap-2 mb-3">
          <svg
            class="w-5 h-5 flex-shrink-0"
            :class="status === 'safe' ? 'text-green-500' : 'text-yellow-500'"
            xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path v-if="status === 'safe'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 class="dialog-title font-bold flex-1" :class="isDark ? 'text-white' : 'text-gray-900'">
            {{ title }}
          </h2>
          <button
            class="close-x w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg transition-colors"
            :class="isDark ? 'text-gray-500 hover:text-white hover:bg-gray-700/50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200/50'"
            @click="emit('cancel', dontAskAgain)"
          >
            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p class="dialog-text mb-4" :class="isDark ? 'text-gray-300' : 'text-gray-600'">
          {{ message }}
        </p>

        <!-- The address is the point of the whole dialog, so it gets the weight.
             The facts under it are only shown once there are any: a dialog put up
             before the check finished has nothing to report but the name. -->
        <div class="rounded-lg p-3 mb-4" :class="isDark ? 'bg-gray-800' : 'bg-gray-50 border border-gray-200'">
          <div class="flex items-center gap-2" :class="status === 'unfamiliar' ? 'mb-2' : ''">
            <span
              class="inline-block w-3 h-3 rounded-full flex-shrink-0"
              :class="status === 'safe' ? 'bg-green-500' : (status === 'unfamiliar' ? 'bg-red-500' : 'bg-gray-400')"
            />
            <span class="dialog-domain font-medium" :class="isDark ? 'text-white' : 'text-gray-900'">
              <SecureText :text="data.domain" :force-highlight="true" :danger-only="true" />
            </span>
          </div>
          <div v-if="status === 'unfamiliar'" class="dialog-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
            <FamiliarityFacts :stats="data.stats">
              <template #status>
                <span :class="statusLabel(false, data.stats.count).class">
                  {{ statusLabel(false, data.stats.count).text }}
                </span>
              </template>
            </FamiliarityFacts>
          </div>

          <!-- Punycode. Skipped when it would repeat the domain verbatim -->
          <div v-if="data.punycode && data.punycode !== data.domain" class="dialog-label mt-2" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>

          <!-- Structural markers. These read the name itself, so they are worth
               showing even when the visit history could not be reached. -->
          <DomainMarkers :hostname="data.domain" class="dialog-label mt-2" />
          <LookalikeNotice v-if="status !== 'checking'" :hostname="data.domain" class="dialog-label mt-2" />
        </div>

        <!-- What is on the clipboard, described before it is shown -->
        <div class="rounded-lg p-3 mb-4" :class="isDark ? 'bg-gray-800' : 'bg-gray-50 border border-gray-200'">
          <div class="flex items-center justify-between gap-2">
            <span class="dialog-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
              {{ payloadKind }}
              <span class="mx-1">&middot;</span>
              {{ data.payload.length }} {{ t('pasteInterceptChars') }}
            </span>
            <button
              class="reveal-btn dialog-label px-2 py-1 rounded-lg transition-colors flex-shrink-0"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
              @click="revealed = !revealed"
            >
              {{ revealed ? t('pasteInterceptHide') : t('pasteInterceptReveal') }}
            </button>
          </div>
          <!-- v-text rather than interpolation: the preview renders with pre-wrap,
               so any indentation the formatter puts inside the tag would show up
               as blank space in front of the payload -->
          <div
            v-if="revealed"
            class="payload-preview dialog-label mt-2 rounded-lg px-2 py-1.5"
            :class="isDark ? 'bg-gray-900 text-gray-300' : 'bg-white border border-gray-200 text-gray-700'"
            v-text="data.payload.preview"
          />
        </div>

        <!-- Said before the button is pressed, so the paste not happening on its
             own reads as the design rather than as a bug -->
        <p v-if="status === 'unfamiliar'" class="dialog-label mb-3" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
          {{ t('pasteInterceptRepeatHint') }}
        </p>

        <!-- Applies to whichever button is pressed: it is about the site, not
             about this one paste. Nothing to turn off while there is no verdict. -->
        <label v-if="status === 'unfamiliar'" class="flex items-start gap-2 mb-4 cursor-pointer">
          <input
            v-model="dontAskAgain"
            type="checkbox"
            class="dont-ask-box flex-shrink-0"
            style="accent-color: #3b82f6;"
          >
          <span class="dialog-label" :class="isDark ? 'text-gray-300' : 'text-gray-600'">
            {{ t('pasteInterceptDontAskAgain') }}
          </span>
        </label>

        <!-- Action buttons. Refusing is named rather than left to the close cross:
             this dialog interrupts a real action, so the way out of it has to be
             as obvious as the way through. -->
        <button
          v-if="status !== 'checking'"
          class="w-full px-4 py-2.5 mb-3 rounded-lg border transition-colors dialog-button"
          :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
          @click="emit('details', data.domain)"
        >
          {{ t('linkInterceptDomainInfo') }}
        </button>

        <!-- One button where there is nothing to weigh up: the paste is already
             cancelled either way, and the only thing left is to say so -->
        <button
          v-if="status === 'safe'"
          class="w-full px-4 py-2.5 rounded-lg border transition-colors dialog-button"
          :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
          @click="emit('allow', false)"
        >
          {{ t('pasteInterceptUnderstood') }}
        </button>
        <div v-else-if="isDecision" class="flex gap-3">
          <button
            class="flex-1 px-4 py-2.5 rounded-lg border transition-colors dialog-button"
            :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
            @click="emit('cancel', dontAskAgain)"
          >
            {{ t('pasteInterceptCancel') }}
          </button>
          <button
            class="flex-1 px-4 py-2.5 rounded-lg border transition-colors dialog-button"
            :class="isDark ? 'bg-red-900/40 border-red-700 hover:bg-red-800/50 text-white' : 'bg-red-600 border-red-600 hover:bg-red-700 text-white'"
            @click="emit('allow', dontAskAgain)"
          >
            {{ t('pasteInterceptAllow') }}
          </button>
        </div>
        <button
          v-else
          class="w-full px-4 py-2.5 rounded-lg border transition-colors dialog-button"
          :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
          @click="emit('cancel', false)"
        >
          {{ t('pasteInterceptCancel') }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
* {
  font-family: Arial, Helvetica, sans-serif !important;
}

button {
  box-shadow: none !important;
  text-shadow: none !important;
  outline: none !important;
}

.close-x,
.reveal-btn {
  border: none !important;
}

/* `all: initial` on the shadow host strips checkboxes down to nothing */
.dont-ask-box {
  width: 15px !important;
  height: 15px !important;
  margin: 1px 0 0 0 !important;
  appearance: auto !important;
  -webkit-appearance: checkbox !important;
}

.dialog-container {
  width: min(420px, 90vw) !important;
  max-width: 90vw !important;
  /* Allow and Cancel are at the bottom, and this dialog is raised by a paste –
     which on a phone means the keyboard is up and the viewport is already half
     of what it was. Without a cap of its own it grew past the visible area and
     took its buttons with it. `dvh` is the measurement that follows the
     keyboard, and the safe-area insets keep it clear of the gesture bar. */
  max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
  box-sizing: border-box !important;
}

.dialog-title {
  font-size: 18px !important;
  line-height: 24px !important;
}

.dialog-text {
  font-size: 14px !important;
  line-height: 20px !important;
}

.dialog-domain {
  font-size: 16px !important;
  line-height: 20px !important;
}

.dialog-label {
  font-size: 13px !important;
  line-height: 18px !important;
}

.dialog-button {
  font-size: 14px !important;
  line-height: 20px !important;
}

/* The payload is arbitrary text from an untrusted page, so it is boxed in:
   wrapped rather than stretching the dialog, and scrolled rather than growing it */
.payload-preview {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  white-space: pre-wrap !important;
  word-break: break-all !important;
  max-height: 120px !important;
  overflow-y: auto !important;
}

.overlay-fade-enter-active {
  transition: all 0.2s ease-out;
}

.overlay-fade-leave-active {
  transition: all 0.15s ease-in;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

.overlay-fade-enter-from .dialog-container {
  transform: scale(0.95);
}

.overlay-fade-leave-to .dialog-container {
  transform: scale(0.95);
}
</style>
