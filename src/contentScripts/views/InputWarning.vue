<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

defineProps<{
  safetyLevel: boolean | null
  show: boolean
  warningType: 'input' | 'copy'
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
        <div class="relative bg-gray-900 bg-opacity-95 p-4 rounded-lg border border-red-400/30">
          <div class="flex items-start space-x-4">
            <!-- Content -->
            <div class="flex-1 min-w-0">
              <h3 class="text-red-500 font-bold flex items-center space-x-2 heading-text">
                <!-- Warning icon with pulse effect -->
                <div class="flex-shrink-0 relative">
                  <div class="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-25" />
                  <svg
                    class="h-6 w-6 text-red-500 relative" xmlns="http://www.w3.org/2000/svg" fill="none"
                    viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <span>{{ t('securityWarning') }}</span>
              </h3>
              <div class="text-left mt-2 text-gray-100">
                <p class="leading-relaxed">
                  <!-- Display different warning messages based on the warning type -->
                  <template v-if="warningType === 'input'">
                    {{ t('inputWarningMessage') }}
                  </template>
                  <template v-else>
                    {{ t('copyWarningMessage') }}
                  </template>
                </p>
                <ul class="mt-2 space-y-1">
                  <li>{{ t('checkUrl') }}</li>
                  <!-- Display different tips based on the warning type -->
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
              <div class="mt-4 flex items-center justify-between">
                <button
                  class="text-black bg-white duration-200 flex items-center space-x-1 group p-2"
                  @click="emit('ignoreSite')"
                >
                  <span class="group-hover:underline">{{ t('dontShowAgain') }}</span>
                </button>
              </div>
            </div>

            <!-- Close button -->
            <button
              class="flex-shrink-0 text-gray-400 hover:text-white transition-colors duration-200 focus:outline-none"
              @click="emit('close')"
            >
              <span class="sr-only">{{ t('dismiss') }}</span>
              <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
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
  width: 500px !important;
  box-sizing: border-box !important;
  font-size: 14px !important;
  line-height: 18px !important;
}

.heading-text {
  font-size: 18px !important;
  line-height: 22px !important;
}
</style>
