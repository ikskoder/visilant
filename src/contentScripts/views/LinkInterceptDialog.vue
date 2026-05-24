<script setup lang="ts">
import type { LinkInterceptData } from '~/logic/ui-state'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'

defineProps<{
  visible: boolean
  data: LinkInterceptData | null
}>()

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
</script>

<template>
  <Transition name="overlay-fade">
    <div
      v-if="visible && data"
      class="fixed inset-0 z-[2147483647] flex items-center justify-center pointer-events-auto"
      @click.self="emit('cancel')"
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60" />

      <!-- Dialog card -->
      <div class="relative dialog-container bg-gray-900 rounded-xl shadow-2xl border border-gray-700/50 p-6">
        <!-- Warning icon -->
        <div class="flex items-center gap-3 mb-4">
          <div class="flex-shrink-0 relative">
            <div class="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20" />
            <div class="relative w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <h2 class="dialog-title text-white font-bold">
            {{ t('linkInterceptTitle') }}
          </h2>
        </div>

        <!-- Message -->
        <p class="dialog-text text-gray-300 mb-4">
          {{ t('linkInterceptMessage') }}
        </p>

        <!-- Domain info -->
        <div class="bg-gray-800 rounded-lg p-3 mb-4">
          <div class="flex items-center gap-2 mb-2">
            <span
              class="inline-block w-3 h-3 rounded-full flex-shrink-0"
              :class="data.isSafe ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="dialog-domain text-white font-medium">
              <SecureText :text="data.domain" :force-highlight="true" />
            </span>
          </div>
          <div class="dialog-label text-gray-400">
            {{ t('linkTooltipVisits') }}:
            <span class="text-white font-medium">{{ data.count }}</span>
            <span class="mx-1">&middot;</span>
            <span
              :class="data.isSafe
                ? 'text-green-400'
                : data.count === 0
                  ? 'text-red-400'
                  : 'text-yellow-400'"
            >
              {{ data.isSafe
                ? t('linkTooltipFamiliar')
                : data.count === 0
                  ? t('linkTooltipNeverVisited')
                  : t('linkTooltipUnfamiliar')
              }}
            </span>
          </div>

          <!-- Punycode -->
          <div v-if="data.punycode" class="dialog-label text-yellow-400 mt-2">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>
        </div>

        <!-- Mismatch warning -->
        <div v-if="data.mismatch" class="bg-red-900/30 border border-red-500/40 rounded-lg p-3 mb-4">
          <div class="flex items-center gap-2 mb-1">
            <svg class="w-4 h-4 text-red-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="dialog-label text-red-400 font-medium">{{ t('linkTooltipMismatchWarning') }}</span>
          </div>
          <div class="dialog-label text-red-300 mt-1">
            {{ t('linkTooltipShowsDomain') }}: <span class="font-medium">{{ data.mismatch.textDomain }}</span>
          </div>
          <div class="dialog-label text-red-300">
            {{ t('linkTooltipLeadsTo') }}: <span class="font-medium">{{ data.domain }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3">
          <button
            class="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors dialog-button font-medium"
            @click="emit('cancel')"
          >
            {{ t('linkInterceptGoBack') }}
          </button>
          <button
            class="flex-1 px-4 py-2.5 bg-transparent border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white rounded-lg transition-colors dialog-button"
            @click="emit('continue')"
          >
            {{ t('linkInterceptContinue') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
* {
  font-family: Arial, Helvetica, sans-serif !important;
}

.dialog-container {
  width: 420px !important;
  max-width: 90vw !important;
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
