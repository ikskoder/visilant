<script setup lang="ts">
import type { LinkTooltipData } from '~/logic/ui-state'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import MismatchTable from './MismatchTable.vue'

const props = defineProps<{
  visible: boolean
  data: LinkTooltipData | null
  showGoButton: boolean
  fontSize: number
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  showFullUrl: boolean
  traceChain: boolean
  shortUrlMode: 'off' | 'button' | 'auto'
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'go', href: string): void
  (e: 'details', domain: string): void
  (e: 'hoverEnter'): void
}>()

const fontScale = computed(() => props.fontSize / 100)

function shouldShowCount(isSafe: boolean) {
  switch (props.showVisitCount) {
    case 'always': return true
    case 'never': return false
    case 'unfamiliar': return !isSafe
    case 'familiar': return isSafe
    default: return true
  }
}

const { t } = useI18n()

const statusLabel = computed(() => (isSafe: boolean, count: number) => {
  if (isSafe)
    return { text: t.value('linkTooltipFamiliar'), class: 'text-green-400' }
  if (count === 0)
    return { text: t.value('linkTooltipNeverVisited'), class: 'text-red-400' }
  return { text: t.value('linkTooltipUnfamiliar'), class: 'text-yellow-400' }
})

function handleResolveClick() {
  ;(window as any).__visilant_resolveTooltipUrl?.()
}

function handleMarkAsShortener() {
  ;(window as any).__visilant_markAsShortener?.()
}

function handleResolveOnce() {
  ;(window as any).__visilant_resolveOnce?.()
}

// --- Runtime positioning ---
const tooltipEl = ref<HTMLElement | null>(null)
const tooltipStyle = ref({ top: '-9999px', left: '-9999px' })
const placement = ref<'below' | 'above'>('below')
const placementLocked = ref(false)

const GAP = 12
const MARGIN = 8
// Estimated height for expanded tooltip with resolved shortUrl + chain + disclaimer
const EXPANDED_ESTIMATE = 280
// Fallback height used to decide placement before the tooltip is mounted
const INITIAL_HEIGHT_ESTIMATE = 160

function decidePlacement(anchor: { top: number, bottom: number }, estimatedHeight: number) {
  const vh = window.innerHeight
  const spaceBelow = vh - anchor.bottom - GAP - MARGIN
  const spaceAbove = anchor.top - GAP - MARGIN

  if (spaceBelow >= estimatedHeight)
    return 'below'
  if (spaceAbove >= estimatedHeight)
    return 'above'
  return spaceBelow >= spaceAbove ? 'below' : 'above'
}

function reposition() {
  const el = tooltipEl.value
  if (!el || !props.data)
    return

  const content = el.querySelector('.tooltip-container') as HTMLElement
  if (!content)
    return

  const anchor = props.data.anchorRect
  const tooltipHeight = content.offsetHeight
  const tooltipWidth = content.offsetWidth
  const vw = window.innerWidth

  // Decide placement only once per tooltip show — lock after first decision
  if (!placementLocked.value) {
    // If there's a shortener that may expand, use generous estimate for initial placement
    const estimatedHeight = props.data.shortUrl ? Math.max(tooltipHeight, EXPANDED_ESTIMATE) : tooltipHeight
    placement.value = decidePlacement(anchor, estimatedHeight)
    placementLocked.value = true
  }

  // Calculate position based on locked placement
  // Below: top edge is fixed at anchor.bottom + GAP, tooltip grows downward (away from cursor)
  // Above: bottom edge is anchored at anchor.top - GAP, tooltip grows upward (away from cursor)
  let top: number
  if (placement.value === 'below') {
    top = anchor.bottom + GAP
  }
  else {
    top = anchor.top - GAP - tooltipHeight
    top = Math.max(MARGIN, top)
  }

  let left = anchor.left
  if (left + tooltipWidth > vw - MARGIN)
    left = vw - tooltipWidth - MARGIN
  if (left < MARGIN)
    left = MARGIN

  tooltipStyle.value = { top: `${top}px`, left: `${left}px` }
}

// Decide placement synchronously when a new tooltip is shown so the enter
// animation slides in from the correct side. Reposition will refine later
// once the actual tooltip height is known.
watch(
  () => props.data?.href,
  () => {
    placementLocked.value = false
    if (props.data) {
      const estimate = props.data.shortUrl ? EXPANDED_ESTIMATE : INITIAL_HEIGHT_ESTIMATE
      placement.value = decidePlacement(props.data.anchorRect, estimate)
    }
  },
  { immediate: true },
)

// Reposition whenever visibility or data changes
watch(
  () => [props.visible, props.data],
  () => {
    if (props.visible && props.data)
      nextTick(reposition)
  },
  { deep: true },
)

// Use ResizeObserver to reposition when tooltip content changes size (e.g. shortener resolves)
let resizeObserver: ResizeObserver | null = null

watch(tooltipEl, (el) => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (el) {
    const content = el.querySelector('.tooltip-container')
    if (content) {
      resizeObserver = new ResizeObserver(() => reposition())
      resizeObserver.observe(content)
    }
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <Transition name="tooltip-fade">
    <div
      v-if="visible && data"
      ref="tooltipEl"
      class="fixed z-[2147483647] pointer-events-auto"
      :class="`tooltip-placement-${placement}`"
      :style="tooltipStyle"
      @mouseenter="emit('hoverEnter')"
      @mouseleave="emit('close')"
    >
      <div class="tooltip-container rounded-lg shadow-2xl p-3" :class="[isDark ? 'bg-gray-900 bg-opacity-95 border border-gray-700/50' : 'bg-white border border-gray-200', { 'tooltip-wide': data.mismatch || (data.shortUrl?.status === 'resolved' && traceChain && data.shortUrl.chain.length > 2) }]" :style="{ fontSize: `${fontScale}em` }">
        <!-- Mismatch: warning + comparison table -->
        <template v-if="data.mismatch">
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-6 h-6 text-red-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="tooltip-label font-medium" :class="isDark ? 'text-red-400' : 'text-red-600'">{{ t('linkTooltipMismatchWarning') }}</span>
          </div>

          <MismatchTable
            class="tooltip-label mb-2"
            :text-domain="data.mismatch.textDomain"
            :text-domain-is-safe="data.mismatch.textDomainIsSafe"
            :text-domain-count="data.mismatch.textDomainCount"
            :dest-domain="data.domain"
            :dest-is-safe="data.isSafe"
            :dest-count="data.count"
            :show-visit-count="showVisitCount"
            cell-padding="p-1.5"
            @details="emit('details', $event)"
          />

          <!-- Punycode warning -->
          <div v-if="data.punycode" class="flex items-center gap-1 mb-2 tooltip-label" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
            <span>{{ t('linkTooltipPunycode') }}: {{ data.punycode }}</span>
          </div>

          <!-- Go button -->
          <button
            v-if="showGoButton"
            class="w-full px-3 py-1.5 rounded-lg border transition-colors tooltip-label text-center"
            :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
            @click="emit('go', data.href)"
          >
            {{ t('linkTooltipGoToLink') }} &rarr;
          </button>
        </template>

        <!-- No mismatch: standard view -->
        <template v-else>
          <!-- Destination label + status -->
          <div class="flex items-center flex-wrap gap-1.5 mb-1">
            <span class="tooltip-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">{{ t('linkTooltipDestination') }}</span>
            <!-- For known shorteners: only show orange "shortener" badge, never safe/unfamiliar -->
            <template v-if="data.shortUrl?.isKnownShortener">
              <span class="tooltip-label px-1.5 py-0.5 rounded" :class="isDark ? 'bg-orange-900/40 text-orange-400' : 'bg-orange-100 text-orange-700'">
                {{ t('linkTooltipShortener') }}
              </span>
            </template>
            <!-- For regular links: show safety status -->
            <template v-else-if="!data.shortUrl || data.shortUrl.status !== 'resolved'">
              <span
                class="tooltip-label px-1.5 py-0.5 rounded"
                :class="data.isSafe
                  ? (isDark ? 'bg-green-900/40 text-green-400' : 'bg-green-100 text-green-700')
                  : data.count === 0
                    ? (isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700')
                    : (isDark ? 'bg-yellow-900/40 text-yellow-400' : 'bg-yellow-100 text-yellow-700')"
              >
                {{ statusLabel(data.isSafe, data.count).text.toLowerCase() }}
              </span>
            </template>
          </div>

          <!-- Domain -->
          <div class="flex items-center gap-2 mb-1">
            <span
              class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              :class="data.shortUrl?.isKnownShortener
                ? 'bg-orange-500'
                : data.isSafe ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="font-medium tooltip-domain" :class="isDark ? 'text-white' : 'text-gray-900'">
              <SecureText :text="data.domain" :force-highlight="true" :danger-only="true" />
            </span>
          </div>

          <!-- Visit count: never show for known shorteners -->
          <div v-if="!data.shortUrl?.isKnownShortener && shouldShowCount(data.isSafe)" class="tooltip-label mb-2" :class="isDark ? 'text-white' : 'text-gray-800'">
            {{ t('linkTooltipVisits') }}: {{ data.count }}
          </div>

          <!-- Short URL: idle state — resolve button -->
          <div v-if="data.shortUrl?.status === 'idle'" class="mt-2 mb-1">
            <div v-if="data.shortUrl.isKnownShortener" class="tooltip-label text-orange-400/80 mb-2">
              {{ t('linkTooltipShortUrlWarning') }}
            </div>
            <button
              class="w-full px-3 py-1.5 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-orange-700/60 hover:bg-orange-600/60 text-orange-100 border-orange-700/50' : 'bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300'"
              @click.stop="handleResolveClick()"
            >
              {{ t('linkTooltipResolveButton') }}
            </button>
          </div>

          <!-- Short URL: loading -->
          <div v-if="data.shortUrl?.status === 'loading'" class="mt-2 mb-1">
            <button
              class="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border tooltip-label text-center cursor-wait"
              :class="isDark ? 'bg-gray-700 text-gray-400 border-gray-600' : 'bg-gray-100 text-gray-500 border-gray-300'"
              disabled
            >
              <div class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              {{ t('linkTooltipResolvingUrl') }}
            </button>
          </div>

          <!-- Short URL: resolved -->
          <div v-if="data.shortUrl?.status === 'resolved'" class="mt-2 mb-2 pt-2" :class="isDark ? 'border-t border-gray-700/50' : 'border-t border-gray-200'">
            <div class="flex items-center gap-1 mb-1 tooltip-label" :class="isDark ? 'text-orange-400' : 'text-orange-600'">
              <svg class="w-3.5 h-3.5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span>{{ t('linkTooltipShortenedUrl') }}</span>
            </div>

            <!-- Resolved domain -->
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                :class="data.shortUrl.resolvedIsSafe ? 'bg-green-500' : 'bg-red-500'"
              />
              <span class="font-medium tooltip-domain" :class="isDark ? 'text-white' : 'text-gray-900'">
                <SecureText :text="data.shortUrl.resolvedDomain" :force-highlight="true" :danger-only="true" />
              </span>
            </div>

            <!-- Full URL if enabled -->
            <div v-if="showFullUrl && data.shortUrl.resolvedUrl" class="tooltip-label mb-1 break-all" :class="isDark ? 'text-gray-400' : 'text-gray-500'" style="word-break: break-all !important; max-width: min(560px, 85vw) !important;">
              {{ data.shortUrl.resolvedUrl }}
            </div>

            <!-- Status + visit count -->
            <div class="flex items-center flex-wrap gap-1.5 mb-1">
              <span
                class="tooltip-label px-1.5 py-0.5 rounded"
                :class="data.shortUrl.resolvedIsSafe
                  ? (isDark ? 'bg-green-900/40 text-green-400' : 'bg-green-100 text-green-700')
                  : data.shortUrl.resolvedCount === 0
                    ? (isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700')
                    : (isDark ? 'bg-yellow-900/40 text-yellow-400' : 'bg-yellow-100 text-yellow-700')"
              >
                {{ statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedCount).text.toLowerCase() }}
              </span>
            </div>
            <div v-if="shouldShowCount(data.shortUrl.resolvedIsSafe)" class="tooltip-label" :class="isDark ? 'text-white' : 'text-gray-800'">
              {{ t('linkTooltipVisits') }}: {{ data.shortUrl.resolvedCount }}
            </div>

            <!-- Redirect chain trace -->
            <div v-if="traceChain && data.shortUrl.chain.length > 2" class="mt-2 pt-2" :class="isDark ? 'border-t border-gray-700/50' : 'border-t border-gray-200'">
              <div class="tooltip-label mb-1" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
                {{ t('linkTooltipRedirectChain') }} ({{ data.shortUrl.chain.length }})
              </div>
              <div class="tooltip-label space-y-0.5" :class="isDark ? 'text-gray-300' : 'text-gray-600'" style="max-height: 120px !important; overflow-y: auto !important;">
                <div v-for="(hop, i) in data.shortUrl.chain" :key="i" class="flex items-start gap-1">
                  <span class="text-gray-500 flex-shrink-0">{{ i + 1 }}.</span>
                  <span class="break-all" style="word-break: break-all !important;">{{ hop }}</span>
                </div>
              </div>
            </div>

            <!-- Disclaimer -->
            <div class="mt-2 tooltip-label italic" :class="isDark ? 'text-white' : 'text-gray-600'" style="font-size: 0.75em !important;">
              {{ t('linkTooltipResolveDisclaimer') }}
            </div>

            <!-- Mark as shortener after successful resolve (only if not already known) -->
            <button
              v-if="!data.shortUrl.isKnownShortener"
              class="w-full mt-2 px-3 py-1 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-orange-400 border-transparent' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-orange-600 border-gray-300'"
              @click.stop="handleMarkAsShortener()"
            >
              {{ t('linkTooltipMarkAsShortener') }}
            </button>
          </div>

          <!-- Short URL: error -->
          <div v-if="data.shortUrl?.status === 'error'" class="mt-2 mb-1">
            <div class="tooltip-label mb-2" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
              {{ data.shortUrl.error === 'same_domain' ? t('linkTooltipResolveSameDomain') : t('linkTooltipResolveError') }}
            </div>
            <button
              v-if="data.shortUrl.error !== 'same_domain'"
              class="w-full px-3 py-1.5 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
              @click.stop="handleResolveClick()"
            >
              {{ t('linkTooltipRetryResolve') }}
            </button>
          </div>

          <!-- Punycode warning -->
          <div v-if="data.punycode" class="flex items-center gap-1 mb-2 tooltip-label" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
            <span>{{ t('linkTooltipPunycode') }}: {{ data.punycode }}</span>
          </div>

          <!-- Action buttons -->
          <div class="flex gap-2 mt-1">
            <button
              v-if="showGoButton"
              class="flex-1 px-3 py-1.5 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'"
              @click="emit('go', data.href)"
            >
              {{ t('linkTooltipGoToLink') }} &rarr;
            </button>
            <button
              class="flex-1 px-3 py-1.5 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
              @click="emit('details', data.shortUrl?.status === 'resolved' ? data.shortUrl.resolvedDomain : data.domain)"
            >
              {{ t('linkTooltipDetails') }}
            </button>
          </div>

          <!-- Resolve once + Mark as shortener: shown when domain is not detected as shortener and short URL detection is enabled -->
          <div v-if="!data.shortUrl && shortUrlMode !== 'off'" class="flex gap-2 mt-2">
            <button
              class="flex-1 px-3 py-1 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white border-transparent' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-gray-800 border-gray-300'"
              @click.stop="handleResolveOnce()"
            >
              {{ t('linkTooltipResolveOnce') }}
            </button>
            <button
              class="flex-1 px-3 py-1 rounded-lg border transition-colors tooltip-label text-center"
              :class="isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-orange-400 border-transparent' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-orange-600 border-gray-300'"
              @click.stop="handleMarkAsShortener()"
            >
              {{ t('linkTooltipMarkAsShortener') }}
            </button>
          </div>
        </template>
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

.tooltip-container {
  min-width: min(200px, 80vw) !important;
  max-width: min(600px, 90vw) !important;
  width: auto !important;
  box-sizing: border-box !important;
}

.tooltip-container.tooltip-wide {
  width: min(600px, 90vw) !important;
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
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}

.tooltip-fade-leave-active {
  transition: opacity 0.1s ease-in, transform 0.1s ease-in;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

.tooltip-placement-below.tooltip-fade-enter-from,
.tooltip-placement-below.tooltip-fade-leave-to {
  transform: translateY(8px);
}

.tooltip-placement-above.tooltip-fade-enter-from,
.tooltip-placement-above.tooltip-fade-leave-to {
  transform: translateY(-8px);
}
</style>
