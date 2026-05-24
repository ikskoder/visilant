<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

defineProps<{
  safetyLevel: boolean | null
  show: boolean
  warningType: 'input' | 'copy'
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'ignoreSite'): void
}>()

const { t } = useI18n()
</script>

<template>
  <Transition name="slide-fade">
    <div
      v-if="show && safetyLevel === false"
      class="fixed top-4 right-4 p-1 rounded-lg shadow-2xl z-[2147483647] bg-gradient-to-r from-red-500 to-red-600 text-white popup-container pointer-events-auto"
    >
      <div class="relative">
        <!-- Animated border effect -->
        <div class="absolute inset-0 bg-gradient-to-r from-yellow-200 to-red-300 rounded-lg animate-pulse opacity-50" />

        <!-- Main content -->
        <div class="relative px-4 pb-3 pt-0 rounded-lg border border-red-400/30" :class="isDark ? 'bg-gray-900 bg-opacity-95' : 'bg-white bg-opacity-98 shadow-lg'">
          <!-- Title + close -->
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-5 h-5 text-red-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 class="text-red-500 font-bold flex-1 heading-text">
              {{ t('securityWarning') }}
            </h3>
            <button
              class="close-btn flex-shrink-0 transition-opacity hover:opacity-70 cursor-pointer"
              @click="emit('close')"
            >
              <span class="sr-only">{{ t('dismiss') }}</span>
              <svg class="w-5 h-5" :class="isDark ? 'text-gray-300' : 'text-gray-500'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="text-left" :class="isDark ? 'text-gray-100' : 'text-gray-700'">
            <p class="leading-relaxed">
              <template v-if="warningType === 'input'">
                {{ t('inputWarningMessage') }}
              </template>
              <template v-else>
                {{ t('copyWarningMessage') }}
              </template>
            </p>
            <ul class="mt-2 space-y-1">
              <li>{{ t('checkUrl') }}</li>
              <template v-if="warningType === 'input'">
                <li>{{ t('avoidPasswords') }}</li>
                <li>{{ t('beCareful') }}</li>
              </template>
              <template v-else>
                <li>{{ t('avoidShell') }}</li>
                <li>{{ t('verifyContent') }}</li>
              </template>
            </ul>
          </div>

          <!-- Actions -->
          <div class="mt-3 flex items-center">
            <button
              class="duration-200 flex items-center space-x-1 group px-3 py-2 rounded-lg"
              :class="isDark ? 'text-black bg-white' : 'text-white bg-red-600 hover:bg-red-700'"
              @click="emit('ignoreSite')"
            >
              <span class="group-hover:underline">{{ t('dontShowAgain') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
* {
  font-family: Arial, Helvetica, sans-serif !important;
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(0, 1, 0.5, 1);
}

.slide-fade-enter-from {
  transform: translateY(-20px);
  opacity: 0;
}

.slide-fade-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

/* Custom animation for the border effect */
@keyframes border-pulse {
  0% {
    opacity: 0.2;
  }

  50% {
    opacity: 0.5;
  }

  100% {
    opacity: 0.2;
  }
}

.animate-border-pulse {
  animation: border-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Fixed pixel-based styles to ensure consistent sizing across all websites */
.popup-container {
  width: min(500px, calc(100vw - 32px)) !important;
  box-sizing: border-box !important;
  font-size: 14px !important;
  line-height: 18px !important;
}

.heading-text {
  font-size: 18px !important;
  line-height: 22px !important;
}

.close-btn {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}
</style>
