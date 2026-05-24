<script setup lang="ts">
import type { LinkTooltipData } from '~/logic/ui-state'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  visible: boolean
  data: LinkTooltipData | null
  showGoButton: boolean
  fontSize: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'go', href: string): void
  (e: 'details', domain: string): void
  (e: 'hoverEnter'): void
}>()

const fontScale = computed(() => props.fontSize / 100)

const { t } = useI18n()
</script>

<template>
  <Transition name="tooltip-fade">
    <div
      v-if="visible && data"
      class="fixed z-[2147483647] pointer-events-auto"
      :style="{ top: `${data.position.top}px`, left: `${data.position.left}px` }"
      @mouseenter="emit('hoverEnter')"
      @mouseleave="emit('close')"
    >
      <div class="tooltip-container bg-gray-900 bg-opacity-95 rounded-lg shadow-2xl border border-gray-700/50 p-3" :style="{ fontSize: `${fontScale}em` }">
        <!-- Destination domain -->
        <div class="flex items-center gap-2 mb-1">
          <span class="tooltip-label text-gray-400">{{ t('linkTooltipDestination') }}</span>
        </div>
        <div class="flex items-center gap-2 mb-2">
          <!-- Safety indicator dot -->
          <span
            class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
            :class="data.isSafe ? 'bg-green-500' : 'bg-red-500'"
          />
          <span class="text-white font-medium tooltip-domain">
            <SecureText :text="data.domain" :force-highlight="true" />
          </span>
        </div>

        <!-- Visit count & safety label -->
        <div class="flex items-center gap-3 mb-2">
          <span class="tooltip-label text-gray-400">
            {{ t('linkTooltipVisits') }}:
            <span class="text-white font-medium">{{ data.count }}</span>
          </span>
          <span
            class="tooltip-label px-1.5 py-0.5 rounded"
            :class="data.isSafe
              ? 'bg-green-900/40 text-green-400'
              : data.count === 0
                ? 'bg-red-900/40 text-red-400'
                : 'bg-yellow-900/40 text-yellow-400'"
          >
            {{ data.isSafe
              ? t('linkTooltipFamiliar')
              : data.count === 0
                ? t('linkTooltipNeverVisited')
                : t('linkTooltipUnfamiliar')
            }}
          </span>
        </div>

        <!-- Punycode warning -->
        <div v-if="data.punycode" class="flex items-center gap-1 mb-2 tooltip-label text-yellow-400">
          <span>{{ t('linkTooltipPunycode') }}: {{ data.punycode }}</span>
        </div>

        <!-- Mismatch warning -->
        <div v-if="data.mismatch" class="bg-red-900/40 border border-red-500/40 rounded p-2 mb-2">
          <div class="flex items-center gap-1 mb-1">
            <svg class="w-3.5 h-3.5 text-red-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="tooltip-label text-red-400 font-medium">{{ t('linkTooltipMismatchWarning') }}</span>
          </div>
          <div class="tooltip-label text-red-300">
            {{ t('linkTooltipShowsDomain') }}: <span class="font-medium">{{ data.mismatch.textDomain }}</span>
          </div>
          <div class="tooltip-label text-red-300">
            {{ t('linkTooltipLeadsTo') }}: <span class="font-medium">{{ data.domain }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-2 mt-1">
          <button
            v-if="showGoButton"
            class="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors tooltip-label text-center"
            @click="emit('go', data.href)"
          >
            {{ t('linkTooltipGoToLink') }} &rarr;
          </button>
          <button
            class="flex-1 px-3 py-1.5 bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 rounded transition-colors tooltip-label text-center"
            @click="emit('details', data.domain)"
          >
            {{ t('linkTooltipDetails') }}
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

.tooltip-container {
  width: 320px !important;
  box-sizing: border-box !important;
}

.tooltip-label {
  font-size: 0.85em !important;
  line-height: 1.3em !important;
}

.tooltip-domain {
  font-size: 1em !important;
  line-height: 1.3em !important;
}

.tooltip-fade-enter-active {
  transition: all 0.15s ease-out;
}

.tooltip-fade-leave-active {
  transition: all 0.1s ease-in;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
