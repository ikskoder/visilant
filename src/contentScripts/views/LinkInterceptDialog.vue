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
  showFullUrl: boolean
  traceChain: boolean
  shortUrlMode: 'off' | 'button' | 'auto'
}>()

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'cancel'): void
  (e: 'details', domain: string): void
  (e: 'resolveShortUrl'): void
}>()

const { t } = useI18n()

function handleResolveOnce() {
  ;(window as any).__visilant_resolveInterceptOnce?.()
}

function handleMarkAsShortener() {
  ;(window as any).__visilant_markInterceptAsShortener?.()
}

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

const hasTraceData = computed(() => {
  return props.traceChain && props.data?.shortUrl?.status === 'resolved' && (props.data.shortUrl.chain.length > 2)
})

// After tracing, if the resolved destination is safe — soften the warning
const resolvedIsSafe = computed(() => {
  return props.data?.shortUrl?.status === 'resolved' && props.data.shortUrl.resolvedIsSafe
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
      <div class="relative dialog-container bg-gray-900 rounded-xl shadow-2xl border border-gray-700/50 p-6" :class="{ 'dialog-wide': data?.mismatch, 'dialog-full': hasTraceData }">
        <!-- Close button -->
        <button
          class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-gray-500 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors"
          @click="emit('cancel')"
        >
          <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

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
              :class="data.shortUrl?.isKnownShortener
                ? 'bg-orange-500'
                : data.isSafe ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="dialog-domain text-white font-medium">
              <SecureText :text="data.domain" :force-highlight="true" :danger-only="true" />
            </span>
            <span v-if="data.shortUrl?.isKnownShortener" class="dialog-label px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400">
              {{ t('linkTooltipShortener').toLowerCase() }}
            </span>
          </div>
          <div v-if="!data.shortUrl?.isKnownShortener" class="dialog-label text-gray-400">
            <template v-if="shouldShowCount(data.isSafe)">
              {{ t('linkTooltipVisits') }}:
              <span class="text-white font-medium">{{ data.count }}</span>
              <span class="mx-1">&middot;</span>
            </template>
            <span :class="statusLabel(data.isSafe, data.count).class">
              {{ statusLabel(data.isSafe, data.count).text }}
            </span>
          </div>

          <!-- Short URL: idle — resolve button -->
          <div v-if="data.shortUrl?.status === 'idle'" class="mt-3 pt-3 border-t border-gray-700">
            <div v-if="data.shortUrl.isKnownShortener" class="dialog-label text-orange-400/80 mb-2">
              {{ t('linkTooltipShortUrlWarning') }}
            </div>
            <button
              class="w-full px-3 py-2 bg-orange-700/60 hover:bg-orange-600/60 text-orange-100 rounded-lg border border-orange-700/50 transition-colors dialog-button text-center"
              @click="emit('resolveShortUrl')"
            >
              {{ t('linkTooltipResolveButton') }}
            </button>
          </div>

          <!-- Short URL: loading -->
          <div v-if="data.shortUrl?.status === 'loading'" class="mt-3 pt-3 border-t border-gray-700">
            <button
              class="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 text-gray-400 rounded-lg border border-gray-600 dialog-button text-center cursor-wait"
              disabled
            >
              <div class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              {{ t('linkTooltipResolvingUrl') }}
            </button>
          </div>

          <!-- Short URL: resolved -->
          <div v-if="data.shortUrl?.status === 'resolved'" class="mt-3 pt-3 border-t border-gray-700">
            <div class="flex items-center gap-1 mb-2 dialog-label text-orange-400">
              <svg class="w-3.5 h-3.5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span>{{ t('linkInterceptRealDestination') }}</span>
            </div>
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-block w-3 h-3 rounded-full flex-shrink-0"
                :class="data.shortUrl.resolvedIsSafe ? 'bg-green-500' : 'bg-red-500'"
              />
              <span class="dialog-domain text-white font-medium">
                <SecureText :text="data.shortUrl.resolvedDomain" :force-highlight="true" :danger-only="true" />
              </span>
            </div>

            <!-- Full URL -->
            <div v-if="showFullUrl && data.shortUrl.resolvedUrl" class="dialog-label text-gray-400 mb-1 break-all" style="word-break: break-all !important;">
              {{ data.shortUrl.resolvedUrl }}
            </div>

            <div class="dialog-label text-gray-400">
              <template v-if="shouldShowCount(data.shortUrl.resolvedIsSafe)">
                {{ t('linkTooltipVisits') }}:
                <span class="text-white font-medium">{{ data.shortUrl.resolvedCount }}</span>
                <span class="mx-1">&middot;</span>
              </template>
              <span :class="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedCount).class">
                {{ statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedCount).text }}
              </span>
            </div>

            <!-- Redirect chain trace -->
            <div v-if="traceChain && data.shortUrl.chain.length > 2" class="mt-3 pt-3 border-t border-gray-700">
              <div class="dialog-label text-gray-400 mb-2">
                {{ t('linkTooltipRedirectChain') }} ({{ data.shortUrl.chain.length }})
              </div>
              <div class="dialog-label text-gray-300 space-y-1" style="max-height: 200px !important; overflow-y: auto !important;">
                <div v-for="(hop, i) in data.shortUrl.chain" :key="i" class="flex items-start gap-1.5">
                  <span class="text-gray-500 flex-shrink-0 font-mono">{{ i + 1 }}.</span>
                  <span class="break-all" style="word-break: break-all !important;">{{ hop }}</span>
                </div>
              </div>
            </div>

            <!-- Disclaimer -->
            <div class="mt-3 dialog-label text-white italic" style="font-size: 11px !important;">
              {{ t('linkTooltipResolveDisclaimer') }}
            </div>

            <!-- Mark as shortener after successful resolve (only if not already known) -->
            <button
              v-if="!data.shortUrl.isKnownShortener"
              class="w-full mt-3 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-orange-400 rounded-lg border border-gray-700 transition-colors dialog-button text-center"
              @click.stop="handleMarkAsShortener()"
            >
              {{ t('linkTooltipMarkAsShortener') }}
            </button>
          </div>

          <!-- Short URL: error -->
          <div v-if="data.shortUrl?.status === 'error'" class="mt-3 pt-3 border-t border-gray-700">
            <div class="dialog-label text-gray-400 mb-2">
              {{ data.shortUrl.error === 'same_domain' ? t('linkTooltipResolveSameDomain') : t('linkTooltipResolveError') }}
            </div>
            <button
              v-if="data.shortUrl.error !== 'same_domain'"
              class="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600 transition-colors dialog-button text-center"
              @click="emit('resolveShortUrl')"
            >
              {{ t('linkTooltipRetryResolve') }}
            </button>
          </div>

          <!-- Punycode -->
          <div v-if="data.punycode" class="dialog-label text-yellow-400 mt-2">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>

          <!-- Resolve once + Mark as shortener: shown when domain is not detected as shortener and short URL detection is enabled -->
          <div v-if="!data.shortUrl && shortUrlMode !== 'off'" class="flex gap-2 mt-3 pt-3 border-t border-gray-700">
            <button
              class="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg border border-gray-700 transition-colors dialog-button text-center"
              @click.stop="handleResolveOnce()"
            >
              {{ t('linkTooltipResolveOnce') }}
            </button>
            <button
              class="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-orange-400 rounded-lg border border-gray-700 transition-colors dialog-button text-center"
              @click.stop="handleMarkAsShortener()"
            >
              {{ t('linkTooltipMarkAsShortener') }}
            </button>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3">
          <button
            v-if="!data.mismatch"
            class="flex-1 px-4 py-2.5 bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 rounded-lg border border-gray-600 transition-colors dialog-button"
            @click="emit('details', data.shortUrl?.status === 'resolved' ? data.shortUrl.resolvedDomain : data.domain)"
          >
            {{ t('linkInterceptDomainInfo') }}
          </button>
          <button
            class="flex-1 px-4 py-2.5 rounded-lg border transition-colors dialog-button"
            :class="resolvedIsSafe
              ? 'bg-blue-700/60 border-blue-700 hover:bg-blue-600/60 text-white'
              : 'bg-red-900/40 border-red-700 hover:bg-red-800/50 text-white'"
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

.dialog-container.dialog-full {
  width: 680px !important;
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
