<script setup lang="ts">
import type { LinkInterceptData } from '~/logic/ui-state'
import { computed, ref } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useModalDialog } from '~/composables/useModalDialog'
import MismatchTable from './MismatchTable.vue'

const props = defineProps<{
  visible: boolean
  data: LinkInterceptData | null
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  showFullUrl: boolean
  traceChain: boolean
  shortUrlMode: 'off' | 'button' | 'auto'
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'cancel'): void
  (e: 'details', domain: string): void
  (e: 'resolveShortUrl'): void
}>()

const { t } = useI18n()

/**
 * The dialog, and where focus lands when it opens.
 *
 * The close cross, not Continue: this dialog is here because something about the
 * link is worth a second look, and a stray Enter must not be the thing that
 * follows it. See `useModalDialog`.
 */
const card = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLElement | null>(null)

useModalDialog({
  visible: () => props.visible && Boolean(props.data),
  container: () => card.value,
  initialFocus: () => closeButton.value,
  onEscape: () => emit('cancel'),
})
const { statusLabel } = useFamiliarityFacts()

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

const hasTraceData = computed(() => {
  return props.traceChain && props.data?.shortUrl?.status === 'resolved' && (props.data.shortUrl.chain.length > 2)
})

// After tracing, if the resolved destination is safe – soften the warning
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
      <!-- Backdrop. Transparent to clicks, or it would sit between the user and
           the overlay behind it and swallow every click-outside -->
      <div class="absolute inset-0 bg-black/60 pointer-events-none" />

      <!-- Dialog card -->
      <div ref="card" role="dialog" aria-modal="true" :aria-label="t('linkInterceptTitle')" class="relative dialog-container rounded-xl shadow-2xl px-5 pb-3 pt-0" :class="[isDark ? 'bg-gray-900 border border-gray-700/50' : 'bg-white border border-gray-200', { 'dialog-wide': data?.mismatch, 'dialog-full': hasTraceData }]">
        <!-- Warning icon + title + close -->
        <div class="flex items-center gap-2 mb-3">
          <svg class="w-5 h-5 text-red-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 class="dialog-title font-bold flex-1" :class="isDark ? 'text-white' : 'text-gray-900'">
            {{ t('linkInterceptTitle') }}
          </h2>
          <button
            ref="closeButton"
            class="close-x w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg transition-colors"
            :class="isDark ? 'text-gray-500 hover:text-white hover:bg-gray-700/50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200/50'"
            @click="emit('cancel')"
          >
            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Message -->
        <p class="dialog-text mb-2" :class="isDark ? 'text-gray-300' : 'text-gray-600'">
          {{ t('linkInterceptMessage') }}
        </p>
        <p class="dialog-label mb-4" :class="isDark ? 'text-yellow-400/80' : 'text-yellow-600'">
          {{ t('linkInterceptPhishingHint') }}
        </p>

        <!-- Mismatch: warning + comparison table -->
        <div v-if="data.mismatch" class="mb-4">
          <div class="flex items-center gap-2 mb-3">
            <svg class="w-6 h-6 text-red-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="dialog-text font-medium" :class="isDark ? 'text-red-400' : 'text-red-600'">{{ t('linkInterceptMismatchWarning') }}</span>
          </div>

          <MismatchTable
            class="dialog-label"
            :text-domain="data.mismatch.textDomain"
            :text-domain-is-safe="data.mismatch.textDomainIsSafe"
            :text-domain-stats="data.mismatch.textDomainStats"
            :dest-domain="data.domain"
            :dest-is-safe="data.isSafe"
            :dest-stats="data.stats"
            :show-visit-count="showVisitCount"
            cell-padding="p-2"
            @details="emit('details', $event)"
          />

          <!-- Punycode. Skipped when it would repeat the domain verbatim -->
          <div v-if="data.punycode && data.punycode !== data.domain" class="dialog-label mt-2" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>

          <!-- Structural markers -->
          <DomainMarkers :hostname="data.domain" :url="data.url" class="dialog-label mt-2" />
          <LookalikeNotice :hostname="data.domain" class="dialog-label mt-2" />
        </div>

        <!-- No mismatch: standard domain info -->
        <div v-else class="rounded-lg p-3 mb-4" :class="isDark ? 'bg-gray-800' : 'bg-gray-50 border border-gray-200'">
          <div class="flex items-center gap-2 mb-2">
            <span
              class="inline-block w-3 h-3 rounded-full flex-shrink-0"
              :class="data.shortUrl?.isKnownShortener
                ? 'bg-orange-500'
                : data.isSafe ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="dialog-domain font-medium" :class="isDark ? 'text-white' : 'text-gray-900'">
              <SecureText :text="data.domain" :force-highlight="true" :danger-only="true" />
            </span>
            <span v-if="data.shortUrl?.isKnownShortener" class="dialog-label px-1.5 py-0.5 rounded" :class="isDark ? 'bg-orange-900/40 text-orange-400' : 'bg-orange-100 text-orange-700'">
              {{ t('linkTooltipShortener').toLowerCase() }}
            </span>
          </div>
          <div v-if="!data.shortUrl?.isKnownShortener" class="dialog-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
            <FamiliarityFacts v-if="shouldShowCount(data.isSafe)" :stats="data.stats">
              <template #status>
                <span :class="statusLabel(data.isSafe, data.stats.count).class">
                  {{ statusLabel(data.isSafe, data.stats.count).text }}
                </span>
              </template>
            </FamiliarityFacts>
            <span v-else :class="statusLabel(data.isSafe, data.stats.count).class">
              {{ statusLabel(data.isSafe, data.stats.count).text }}
            </span>
          </div>

          <!-- Short URL: idle – resolve button -->
          <div v-if="data.shortUrl?.status === 'idle'" class="mt-3 pt-3" :class="isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'">
            <div v-if="data.shortUrl.isKnownShortener" class="dialog-label mb-2" :class="isDark ? 'text-orange-400/80' : 'text-orange-600'">
              {{ t('linkTooltipShortUrlWarning') }}
            </div>
            <button
              class="w-full px-3 py-2 rounded-lg border transition-colors dialog-button text-center"
              :class="isDark ? 'bg-orange-700/60 hover:bg-orange-600/60 text-orange-100 border-orange-700/50' : 'bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300'"
              @click="emit('resolveShortUrl')"
            >
              {{ t('linkTooltipResolveButton') }}
            </button>
          </div>

          <!-- Short URL: loading -->
          <div v-if="data.shortUrl?.status === 'loading'" class="mt-3 pt-3" :class="isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'">
            <button
              class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border dialog-button text-center cursor-wait"
              :class="isDark ? 'bg-gray-700 text-gray-400 border-gray-600' : 'bg-gray-100 text-gray-500 border-gray-300'"
              disabled
            >
              <div class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              {{ t('linkTooltipResolvingUrl') }}
            </button>
          </div>

          <!-- Short URL: resolved -->
          <div v-if="data.shortUrl?.status === 'resolved'" class="mt-3 pt-3" :class="isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'">
            <div class="flex items-center gap-1 mb-2 dialog-label" :class="isDark ? 'text-orange-400' : 'text-orange-600'">
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
              <span class="dialog-domain font-medium" :class="isDark ? 'text-white' : 'text-gray-900'">
                <SecureText :text="data.shortUrl.resolvedDomain" :force-highlight="true" :danger-only="true" />
              </span>
            </div>

            <!-- Full URL -->
            <div v-if="showFullUrl && data.shortUrl.resolvedUrl" class="dialog-label mb-1 break-all" :class="isDark ? 'text-gray-400' : 'text-gray-500'" style="word-break: break-all !important;">
              {{ data.shortUrl.resolvedUrl }}
            </div>

            <div class="dialog-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
              <FamiliarityFacts v-if="shouldShowCount(data.shortUrl.resolvedIsSafe)" :stats="data.shortUrl.resolvedStats">
                <template #status>
                  <span :class="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count).class">
                    {{ statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count).text }}
                  </span>
                </template>
              </FamiliarityFacts>
              <span v-else :class="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count).class">
                {{ statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count).text }}
              </span>
            </div>

            <!-- Redirect chain trace -->
            <div v-if="traceChain && data.shortUrl.chain.length > 2" class="mt-3 pt-3" :class="isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'">
              <div class="dialog-label mb-2" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
                {{ t('linkTooltipRedirectChain') }} ({{ data.shortUrl.chain.length }})
              </div>
              <div class="dialog-label space-y-1" :class="isDark ? 'text-gray-300' : 'text-gray-600'" style="max-height: 200px !important; overflow-y: auto !important;">
                <div v-for="(hop, i) in data.shortUrl.chain" :key="i" class="flex items-start gap-1.5">
                  <span class="text-gray-500 flex-shrink-0 font-mono">{{ i + 1 }}.</span>
                  <span class="break-all" style="word-break: break-all !important;">{{ hop }}</span>
                </div>
              </div>
            </div>

            <!-- Disclaimer -->
            <div class="mt-3 dialog-label italic" :class="isDark ? 'text-white' : 'text-gray-600'" style="font-size: 11px !important;">
              {{ t('linkTooltipResolveDisclaimer') }}
            </div>

            <!-- Mark as shortener after successful resolve (only if not already known) -->
            <button
              v-if="!data.shortUrl.isKnownShortener"
              class="w-full mt-3 px-3 py-2 rounded-lg border transition-colors dialog-button text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-orange-400 border-transparent' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-orange-600 border-gray-300'"
              @click.stop="handleMarkAsShortener()"
            >
              {{ t('linkTooltipMarkAsShortener') }}
            </button>
          </div>

          <!-- Short URL: error -->
          <div v-if="data.shortUrl?.status === 'error'" class="mt-3 pt-3" :class="isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'">
            <div class="dialog-label mb-2" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
              {{ data.shortUrl.error === 'same_domain' ? t('linkTooltipResolveSameDomain') : t('linkTooltipResolveError') }}
            </div>
            <button
              v-if="data.shortUrl.error !== 'same_domain'"
              class="w-full px-3 py-2 rounded-lg border transition-colors dialog-button text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
              @click="emit('resolveShortUrl')"
            >
              {{ t('linkTooltipRetryResolve') }}
            </button>
          </div>

          <!-- Punycode. Skipped when it would repeat the domain verbatim -->
          <div v-if="data.punycode && data.punycode !== data.domain" class="dialog-label mt-2" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
            {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
          </div>

          <!-- Structural markers -->
          <DomainMarkers :hostname="data.domain" :url="data.url" class="dialog-label mt-2" />
          <LookalikeNotice :hostname="data.domain" class="dialog-label mt-2" />

          <!-- Resolve once + Mark as shortener: shown when domain is not detected as shortener and short URL detection is enabled -->
          <div v-if="!data.shortUrl && shortUrlMode !== 'off'" class="flex gap-2 mt-3 pt-3" :class="isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'">
            <button
              class="flex-1 px-3 py-2 rounded-lg border transition-colors dialog-button text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white border-transparent' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-gray-800 border-gray-300'"
              @click.stop="handleResolveOnce()"
            >
              {{ t('linkTooltipResolveOnce') }}
            </button>
            <button
              class="flex-1 px-3 py-2 rounded-lg border transition-colors dialog-button text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-orange-400 border-transparent' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-orange-600 border-gray-300'"
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
            class="flex-1 px-4 py-2.5 rounded-lg border transition-colors dialog-button"
            :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
            @click="emit('details', data.shortUrl?.status === 'resolved' ? data.shortUrl.resolvedDomain : data.domain)"
          >
            {{ t('linkInterceptDomainInfo') }}
          </button>
          <button
            class="flex-1 px-4 py-2.5 rounded-lg border transition-colors dialog-button"
            :class="resolvedIsSafe
              ? (isDark ? 'bg-blue-700/60 border-blue-700 hover:bg-blue-600/60 text-white' : 'bg-blue-600 border-blue-600 hover:bg-blue-700 text-white')
              : (isDark ? 'bg-red-900/40 border-red-700 hover:bg-red-800/50 text-white' : 'bg-red-600 border-red-600 hover:bg-red-700 text-white')"
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

.close-x {
  background-color: transparent !important;
  border: none !important;
}

.dialog-container {
  width: min(420px, 90vw) !important;
  max-width: 90vw !important;
  /* Continue and Cancel are at the bottom, and on a phone this dialog is the
     whole link check: hover and right-click are gone there, so every external
     link comes through here. Landscape, a large font size or a mismatch table
     can leave it taller than the viewport, and it had no scroll of its own –
     the two buttons simply sat off the screen with no way to reach them.
     `dvh` rather than `vh` so a soft keyboard shrinking the viewport is what
     gets measured, and the safe-area insets for the notch and gesture bar. */
  max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
  box-sizing: border-box !important;
}

.dialog-container.dialog-wide {
  width: min(560px, 90vw) !important;
}

.dialog-container.dialog-full {
  width: min(680px, 90vw) !important;
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
