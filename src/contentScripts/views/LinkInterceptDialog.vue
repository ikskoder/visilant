<script setup lang="ts">
import type { LinkInterceptData } from '~/logic/ui-state'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import MismatchTable from './MismatchTable.vue'

const props = defineProps<{
  visible: boolean
  data: LinkInterceptData | null
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
}>()

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'cancel'): void
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()

function shouldShowCount(isSafe: boolean) {
  switch (props.showVisitCount) {
    case 'always': return true
    case 'never': return false
    case 'unfamiliar': return !isSafe
    case 'familiar': return isSafe
    default: return true
  }
}

const statusLabel = computed(() => (isSafe: boolean, count: number) => {
  if (isSafe)
    return { text: t.value('linkTooltipFamiliar'), class: 'text-green-400' }
  if (count === 0)
    return { text: t.value('linkTooltipNeverVisited'), class: 'text-red-400' }
  return { text: t.value('linkTooltipUnfamiliar'), class: 'text-yellow-400' }
})
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
      <div class="relative dialog-container bg-gray-900 rounded-xl shadow-2xl border border-gray-700/50 p-6" :class="{ 'dialog-wide': data?.mismatch }">
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
        <p class="dialog-text text-gray-300 mb-2">
          {{ t('linkInterceptMessage') }}
        </p>
        <p class="dialog-label text-yellow-400/80 mb-4">
          {{ t('linkInterceptPhishingHint') }}
        </p>

        <!-- Mismatch: warning + comparison table -->
        <div v-if="data.mismatch" class="mb-4">
          <div class="flex items-center gap-2 mb-3">
            <svg class="w-6 h-6 text-red-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="dialog-text text-red-400 font-medium">{{ t('linkInterceptMismatchWarning') }}</span>
          </div>

          <MismatchTable
            class="dialog-label"
            :text-domain="data.mismatch.textDomain"
            :text-domain-is-safe="data.mismatch.textDomainIsSafe"
            :text-domain-count="data.mismatch.textDomainCount"
            :dest-domain="data.domain"
            :dest-is-safe="data.isSafe"
            :dest-count="data.count"
            :show-visit-count="showVisitCount"
            cell-padding="p-2"
            @details="emit('details', $event)"
          />

          <!-- Punycode -->
          <div v-if="data.punycode" class="dialog-label text-yellow-400 mt-2">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>
        </div>

        <!-- No mismatch: standard domain info -->
        <div v-else class="bg-gray-800 rounded-lg p-3 mb-4">
          <div class="flex items-center gap-2 mb-2">
            <span
              class="inline-block w-3 h-3 rounded-full flex-shrink-0"
              :class="data.isSafe ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="dialog-domain text-white font-medium">
              <SecureText :text="data.domain" :force-highlight="true" :danger-only="true" />
            </span>
          </div>
          <div class="dialog-label text-gray-400">
            <template v-if="shouldShowCount(data.isSafe)">
              {{ t('linkTooltipVisits') }}:
              <span class="text-white font-medium">{{ data.count }}</span>
              <span class="mx-1">&middot;</span>
            </template>
            <span :class="statusLabel(data.isSafe, data.count).class">
              {{ statusLabel(data.isSafe, data.count).text }}
            </span>
          </div>

          <!-- Punycode -->
          <div v-if="data.punycode" class="dialog-label text-yellow-400 mt-2">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3">
          <button
            class="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg border border-gray-600 transition-colors dialog-button font-medium"
            @click="emit('cancel')"
          >
            {{ t('linkInterceptGoBack') }}
          </button>
          <button
            v-if="!data.mismatch"
            class="px-4 py-2.5 bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 rounded-lg border border-gray-600 transition-colors dialog-button"
            @click="emit('details', data.domain)"
          >
            {{ t('linkTooltipDetails') }}
          </button>
          <button
            class="flex-1 px-4 py-2.5 bg-red-900/40 border border-red-700 hover:bg-red-800/50 text-red-300 hover:text-red-200 rounded-lg transition-colors dialog-button"
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

button {
  box-shadow: none !important;
  text-shadow: none !important;
  outline: none !important;
}

.dialog-container {
  width: 420px !important;
  max-width: 90vw !important;
  box-sizing: border-box !important;
}

.dialog-container.dialog-wide {
  width: 560px !important;
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
