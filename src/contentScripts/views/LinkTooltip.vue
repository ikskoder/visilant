<script setup lang="ts">
import type { LinkTooltipData } from '~/logic/ui-state'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import EmailBreakdown from '~/components/EmailBreakdown.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import MailRecipients from '~/components/MailRecipients.vue'
import RedFlagCount from '~/components/RedFlagCount.vue'
import SecureText from '~/components/SecureText.vue'
import VzBadge from '~/components/VzBadge.vue'
import VzIcon from '~/components/VzIcon.vue'
import VzNotice from '~/components/VzNotice.vue'
import VzSig from '~/components/VzSig.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { useTopLayer } from '~/composables/useTopLayer'
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
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'go', href: string): void
  (e: 'details', domain: string): void
  (e: 'hoverEnter'): void
}>()

const fontScale = computed(() => props.fontSize / 100)

// Above anything the page can lay over it, without blocking the page – see
// `useTopLayer`
const layer = useTopLayer({
  mode: 'popover',
  visible: () => props.visible && Boolean(props.data),
})

// The letters a lookalike changed, underlined in the address. Asked exactly as
// the lookalike notice under it asks, so both read one answer. A raw text
// payload has no notice and no address to mark.
const linkDiff = useLookalikeDiff(
  () => props.data?.kind === 'text' ? '' : props.data?.domain ?? '',
  () => props.data?.kind === 'email' && props.data.email ? 'email' : undefined,
)
const resolvedDiff = useLookalikeDiff(() => props.data?.shortUrl?.resolvedDomain ?? '')

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
const { statusLabel } = useFamiliarityFacts()

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
const tooltipStyle = ref<Record<string, string>>({ top: '-9999px', left: '-9999px' })
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
  // The page's own width, without its scrollbar. The window's included it,
  // and a tooltip pushed against the right edge ended up underneath it. A page
  // with no doctype measures its viewport on the body instead of the root.
  const viewportBox = document.compatMode === 'BackCompat' ? document.body : document.documentElement
  const vw = Math.min(viewportBox?.clientWidth || window.innerWidth, window.innerWidth)
  const vh = window.innerHeight

  // Decide placement only once per tooltip show – lock after first decision
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

  // What is left of the screen on its side of the link. A tall tooltip below a
  // link halfway down ran off the bottom, since its cap was the whole screen.
  const room = placement.value === 'below' ? vh - top - MARGIN : anchor.top - GAP - MARGIN
  tooltipStyle.value = { 'top': `${top}px`, 'left': `${left}px`, '--tooltip-room': `${Math.max(120, room)}px` }
}

/**
 * Writing to an address that is not known to be all right is going ahead past a
 * warning, so the button is drawn as the dialogs draw one: red, no arrow
 * beckoning, and deaf for the first half second. A tooltip opens under the
 * pointer, and the second half of a double click would otherwise press it.
 */
const mailIsRisky = computed(() => {
  const email = props.data?.kind === 'email' ? props.data.email : undefined
  if (!email)
    return false
  if (email.mismatch || email.providerKind === 'disposable' || props.data?.unchecked)
    return true
  return email.providerKind === 'regular' && !props.data?.isSafe
})

const RISK_DELAY_MS = 500
const goArmed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | undefined

watch(() => props.visible && props.data?.href, (open) => {
  clearTimeout(armTimer)
  goArmed.value = false
  if (open)
    armTimer = setTimeout(() => goArmed.value = true, RISK_DELAY_MS)
}, { immediate: true })

onBeforeUnmount(() => clearTimeout(armTimer))

function goToMail(href: string) {
  if (mailIsRisky.value && !goArmed.value)
    return
  emit('go', href)
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
  <Transition name="tooltip-fade" appear @enter="layer.enter">
    <!-- `right-auto bottom-auto`: a popover is pinned to all four edges until
         told otherwise, and this one is placed by its top and left -->
    <div
      v-if="visible && data"
      ref="tooltipEl"
      popover="manual"
      class="vz-layer fixed right-auto bottom-auto z-[2147483647] pointer-events-auto"
      :class="`tooltip-placement-${placement}`"
      :style="tooltipStyle"
      @mouseenter="emit('hoverEnter')"
      @mouseleave="emit('close')"
    >
      <div
        class="tooltip-container vz-overlay vz-tooltip"
        :class="{ 'tooltip-wide': data.mismatch || (data.shortUrl?.status === 'resolved' && traceChain && data.shortUrl.chain.length > 2) }"
        :style="{ '--vz-scale': fontScale }"
      >
        <!-- Email address (mailto link, selection or QR payload) -->
        <template v-if="data.kind === 'email' && data.email">
          <VzSig />
          <!-- The verdict sits beside the name of what it is about, not beside the
               signature, where it read as a verdict on nothing in particular -->
          <div class="tooltip-label">
            <span class="vz-eyebrow">{{ t('emailTooltipTitle') }}</span>
            <!-- Public and throwaway providers: a visit count says nothing about them -->
            <VzBadge v-if="data.email.providerKind === 'disposable'" tone="danger" icon="alert" data-verdict="disposable">
              {{ t('emailDisposableDomain') }}
            </VzBadge>
            <VzBadge v-else-if="data.email.providerKind === 'public'" tone="neutral" icon="email" data-verdict="public">
              {{ t('emailPublicProvider') }}
            </VzBadge>
            <!-- Never "never visited" here: nobody visits an address, and beside
                 "Email address" it read as though they could -->
            <VzBadge v-else-if="data.unchecked" tone="neutral" icon="shield-unknown" data-verdict="unchecked">
              {{ t('verdictUnchecked') }}
            </VzBadge>
            <VzBadge v-else :tone="statusLabel(data.isSafe, data.stats.count, false, { email: true }).tone" :icon="statusLabel(data.isSafe, data.stats.count, false, { email: true }).icon" :data-verdict="statusLabel(data.isSafe, data.stats.count, false, { email: true }).verdict">
              {{ statusLabel(data.isSafe, data.stats.count, false, { email: true }).text }}
            </VzBadge>
            <!-- The address's lines below, and the link that shows another one -->
            <RedFlagCount :hostname="data.domain" context="email" :extra="data.email.mismatch ? 1 : 0" />
          </div>

          <!-- Visible text shows a different address than the actual mailto target -->
          <VzNotice v-if="data.email.mismatch" tone="danger" icon="flag" data-red-flag>
            <p class="vz-body-strong">
              {{ t('emailTooltipMismatchWarning') }}
            </p>
            <p>
              {{ t('emailTooltipShownAddress') }}: <SecureText kind="email" :text="data.email.mismatch.textAddress" size="s" preserve-case>
                <CopyButton :text="data.email.mismatch.textAddress" />
              </SecureText>
            </p>
            <p>
              {{ t('emailTooltipActualAddress') }}: <SecureText kind="email" :text="data.email.analysis.raw" size="s" preserve-case>
                <CopyButton :text="data.email.analysis.raw" />
              </SecureText>
            </p>
          </VzNotice>

          <EmailBreakdown :analysis="data.email.analysis" :params="data.email.params" :provider-kind="data.email.providerKind" compact />

          <!-- A mailto carries a list. Only the first name used to be checked. -->
          <MailRecipients
            v-if="data.email.recipients"
            :recipients="data.email.recipients"
            :not-checked="data.email.recipientsNotChecked"
          />

          <!-- Visit facts for the address's domain (regular domains only).
               Named, because the address printed above is not what was visited. -->
          <VzNotice v-if="data.email.providerKind === 'regular' && data.unchecked" tone="neutral" icon="unknown" bare data-status="unchecked">
            {{ t('linkUncheckedNotice') }}
          </VzNotice>
          <div v-else-if="data.email.providerKind === 'regular' && shouldShowCount(data.isSafe)" class="grid gap-2">
            <span class="vz-small">{{ t('emailSiteFactsLabel') }}: <SecureText :text="data.domain" size="s" :diff="linkDiff(data.domain)"><CopyButton :text="data.domain" /></SecureText></span>
            <FamiliarityFacts :stats="data.stats" />
          </div>

          <!-- Structural markers of the address's domain -->
          <DomainMarkers :hostname="data.domain" context="email" :familiar="data.isSafe" bare />
          <LookalikeNotice :hostname="data.domain" context="email" bare />

          <div class="tooltip-actions">
            <button v-if="showGoButton" class="vz-btn vz-btn--sm" :class="{ 'vz-btn--risk': mailIsRisky }" data-action="go" @click="goToMail(data.href)">
              {{ t('emailOpenMailApp') }}<VzIcon v-if="!mailIsRisky" name="arrow-right" />
            </button>
            <button class="vz-btn vz-btn--sm" data-action="details" @click="emit('details', data.domain)">
              {{ t('linkTooltipDetails') }}
            </button>
          </div>
        </template>

        <!-- Raw payload (QR tel:/WIFI:/plain text or unrecognized selection) -->
        <template v-else-if="data.kind === 'text' && data.rawText">
          <VzSig />
          <span class="vz-eyebrow">
            {{ t('qrPayloadType') }}: {{ t(`qrType${data.rawText.payloadKind.charAt(0).toUpperCase()}${data.rawText.payloadKind.slice(1)}`) }}
          </span>
          <div class="vz-well tooltip-payload">
            <SecureText kind="raw" :text="data.rawText.payload" size="m">
              <CopyButton :text="data.rawText.payload" />
            </SecureText>
          </div>
        </template>

        <!-- Mismatch: warning + comparison table -->
        <template v-else-if="data.mismatch">
          <VzSig />
          <!-- Link text naming another site is a red flag, and the title says it.
               No count beside it: the box names two sites, each with its own
               verdict in the table, and one number for both would leave the
               reader to guess whose it is. The flags under the destination
               carry their own sign. -->
          <div class="tooltip-title" data-red-flag>
            <VzIcon name="flag" large class="tone-danger" />
            <span class="vz-body-strong">{{ t('linkTooltipMismatchWarning') }}</span>
          </div>

          <MismatchTable
            :text-domain="data.mismatch.textDomain"
            :text-domain-is-safe="data.mismatch.textDomainIsSafe"
            :text-domain-stats="data.mismatch.textDomainStats"
            :text-domain-unchecked="data.mismatch.textDomainUnchecked"
            :dest-domain="data.domain"
            :dest-is-safe="data.isSafe"
            :dest-stats="data.stats"
            :dest-unchecked="data.unchecked"
            :dest-diff="linkDiff(data.domain)"
            :show-visit-count="showVisitCount"
            @details="emit('details', $event)"
          />

          <!-- Punycode. Skipped when it would repeat the domain verbatim, which is
               what happens for links that already arrive in punycode form -->
          <VzNotice v-if="data.punycode && data.punycode !== data.domain" tone="danger" bare>
            {{ t('linkTooltipPunycode') }}: <SecureText :text="data.punycode" size="s" :diff="linkDiff(data.punycode)">
              <CopyButton :text="data.punycode" />
            </SecureText>
          </VzNotice>

          <DomainMarkers :hostname="data.domain" :url="data.href" :familiar="data.isSafe" bare />
          <LookalikeNotice :hostname="data.domain" bare />

          <button v-if="showGoButton" class="vz-btn vz-btn--sm vz-btn--block" data-action="go" @click="emit('go', data.href)">
            {{ t('linkTooltipGoToLink') }}<VzIcon name="arrow-right" />
          </button>
        </template>

        <!-- No mismatch: standard view -->
        <template v-else>
          <VzSig />

          <div class="grid gap-1">
            <div class="tooltip-label">
              <span class="vz-eyebrow">{{ t('linkTooltipDestination') }}</span>
              <!-- A known shortener says nothing about where it leads, so it gets
                   its own badge and never a verdict on the shortener itself -->
              <VzBadge v-if="data.shortUrl?.isKnownShortener" tone="danger" icon="alert" data-verdict="shortener">
                {{ t('linkTooltipShortener') }}
              </VzBadge>
              <VzBadge
                v-else-if="!data.shortUrl || data.shortUrl.status !== 'resolved'"
                :tone="statusLabel(data.isSafe, data.stats.count, data.unchecked).tone"
                :icon="statusLabel(data.isSafe, data.stats.count, data.unchecked).icon"
                :data-verdict="statusLabel(data.isSafe, data.stats.count, data.unchecked).verdict"
              >
                {{ statusLabel(data.isSafe, data.stats.count, data.unchecked).text }}
              </VzBadge>
              <RedFlagCount :hostname="data.domain" :url="data.href" />
            </div>
            <SecureText :text="data.domain" size="l" class="tooltip-domain" :diff="linkDiff(data.domain)">
              <CopyButton :text="data.domain" />
            </SecureText>
          </div>

          <!-- Visit facts: never for a known shortener, and none to show when the
               background could not be asked -->
          <VzNotice v-if="data.unchecked" tone="neutral" icon="unknown" bare data-status="unchecked">
            {{ t('linkUncheckedNotice') }}
          </VzNotice>
          <FamiliarityFacts v-else-if="!data.shortUrl?.isKnownShortener && shouldShowCount(data.isSafe)" :stats="data.stats" />

          <!-- Short link: idle, with the button that follows it -->
          <template v-if="data.shortUrl?.status === 'idle'">
            <VzNotice v-if="data.shortUrl.isKnownShortener" tone="danger" bare>
              {{ t('linkTooltipShortUrlWarning') }}
            </VzNotice>
            <button class="vz-btn vz-btn--sm vz-btn--block" data-action="resolve" @click.stop="handleResolveClick()">
              <VzIcon name="link" />{{ t(data.shortUrl.isKnownShortener ? 'linkResolveKnown' : 'linkResolveTry') }}
            </button>
          </template>

          <!-- Short link: being followed -->
          <button v-if="data.shortUrl?.status === 'loading'" class="vz-btn vz-btn--sm vz-btn--block" disabled>
            <VzIcon name="pending" />{{ t('linkTooltipResolvingUrl') }}
          </button>

          <!-- Short link: followed to its end -->
          <div v-if="data.shortUrl?.status === 'resolved'" class="tooltip-section">
            <!-- The heading and the address it names, held together as in the
                 block above rather than a whole section gap apart -->
            <div class="grid gap-1">
              <div class="tooltip-label">
                <span class="vz-eyebrow inline-flex items-center gap-1"><VzIcon name="link" />{{ t('linkTooltipShortenedUrl') }}</span>
                <VzBadge
                  :tone="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).tone"
                  :icon="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).icon"
                  :data-verdict="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).verdict"
                >
                  {{ statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).text }}
                </VzBadge>
                <RedFlagCount :hostname="data.shortUrl.resolvedDomain" />
              </div>
              <SecureText :text="data.shortUrl.resolvedDomain" size="l" class="tooltip-domain" :diff="resolvedDiff(data.shortUrl.resolvedDomain)">
                <CopyButton :text="data.shortUrl.resolvedDomain" />
              </SecureText>
            </div>

            <!-- Full URL if enabled -->
            <!-- Three lines at most, the rest in the title and in the copy. A
                 tracking link can run to twenty lines and push everything else
                 out of the tooltip. -->
            <p v-if="showFullUrl && data.shortUrl.resolvedUrl" class="vz-small tooltip-full-url">
              <span class="tooltip-url tooltip-url--clamp" :title="data.shortUrl.resolvedUrl">{{ data.shortUrl.resolvedUrl }}</span>
              <CopyButton :text="data.shortUrl.resolvedUrl" inline />
            </p>

            <!-- The destination gets the same reading as the address the user
                 could see. It used to get a visit count and nothing else, so a
                 short link to a lookalike or to a punycode name came out as
                 "somewhere you have not been" and no more than that. -->
            <VzNotice v-if="data.shortUrl.resolvedPunycode" tone="danger" bare>
              {{ t('linkTooltipPunycode') }}: <SecureText :text="data.shortUrl.resolvedPunycode" size="s" :diff="resolvedDiff(data.shortUrl.resolvedPunycode)">
                <CopyButton :text="data.shortUrl.resolvedPunycode" />
              </SecureText>
            </VzNotice>
            <DomainMarkers :hostname="data.shortUrl.resolvedDomain" :familiar="data.shortUrl.resolvedIsSafe" bare />
            <LookalikeNotice :hostname="data.shortUrl.resolvedDomain" bare />

            <FamiliarityFacts v-if="!data.shortUrl.resolvedUnchecked && shouldShowCount(data.shortUrl.resolvedIsSafe)" :stats="data.shortUrl.resolvedStats" />

            <!-- Redirect chain trace -->
            <div v-if="traceChain && data.shortUrl.chain.length > 2" class="grid gap-1">
              <span class="vz-eyebrow">{{ t('linkTooltipRedirectChain') }} ({{ data.shortUrl.chain.length }})</span>
              <ol class="tooltip-chain vz-well">
                <li v-for="(hop, i) in data.shortUrl.chain" :key="i">
                  <span class="tooltip-chain__n">{{ i + 1 }}.</span>
                  <span class="tooltip-url">{{ hop }}</span>
                </li>
              </ol>
            </div>

            <p class="vz-small">
              {{ t('linkTooltipResolveDisclaimer') }}
            </p>

            <!-- Mark as shortener after a successful follow (only if not already known) -->
            <button v-if="!data.shortUrl.isKnownShortener" class="vz-btn vz-btn--sm vz-btn--quiet vz-btn--flush justify-self-start" data-action="mark-shortener" @click.stop="handleMarkAsShortener()">
              {{ t('linkTooltipMarkAsShortener') }}
            </button>
          </div>

          <!-- Short link: could not be followed. Said as what it is, never drawn
               as an empty or a passed result -->
          <template v-if="data.shortUrl?.status === 'error'">
            <VzNotice tone="neutral" bare>
              {{ data.shortUrl.error === 'same_domain' ? t(data.shortUrl.isKnownShortener ? 'linkTooltipResolveSameDomainShortener' : 'linkTooltipResolveSameDomain') : t(data.shortUrl.error === 'refused' ? 'linkTooltipResolveRefused' : 'linkTooltipResolveError') }}
            </VzNotice>
            <button v-if="data.shortUrl.error !== 'same_domain' && data.shortUrl.error !== 'refused'" class="vz-btn vz-btn--sm vz-btn--block" data-action="retry" @click.stop="handleResolveClick()">
              {{ t('linkTooltipRetryResolve') }}
            </button>
          </template>

          <!-- Punycode. Skipped when it would repeat the domain verbatim, which is
               what happens for links that already arrive in punycode form -->
          <VzNotice v-if="data.punycode && data.punycode !== data.domain" tone="danger" bare>
            {{ t('linkTooltipPunycode') }}: <SecureText :text="data.punycode" size="s" :diff="linkDiff(data.punycode)">
              <CopyButton :text="data.punycode" />
            </SecureText>
          </VzNotice>

          <DomainMarkers :hostname="data.domain" :url="data.href" :familiar="data.isSafe" bare />
          <LookalikeNotice :hostname="data.domain" bare />

          <div class="tooltip-actions">
            <button v-if="showGoButton" class="vz-btn vz-btn--sm" data-action="go" @click="emit('go', data.href)">
              {{ t('linkTooltipGoToLink') }}<VzIcon name="arrow-right" />
            </button>
            <button class="vz-btn vz-btn--sm" data-action="details" @click="emit('details', data.shortUrl?.status === 'resolved' ? data.shortUrl.resolvedDomain : data.domain)">
              {{ t('linkTooltipDetails') }}
            </button>
            <!-- Follow once: when the domain is not a known shortener and short
                 link detection is on. "Mark as shortener" is not offered here:
                 nothing yet says this site is one, and a stray press would hide
                 every link from it. It appears once following has shown the link
                 really leads somewhere else, in the block above. -->
            <button v-if="!data.shortUrl && shortUrlMode !== 'off'" class="vz-btn vz-btn--sm vz-btn--quiet" data-action="resolve-once" @click.stop="handleResolveOnce()">
              <VzIcon name="link" />{{ t('linkResolveTry') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tooltip-container {
  min-width: min(240px, 100vw - 32px);
  max-width: min(var(--tooltip-max) * var(--vz-scale, 1), 100vw - 32px);
  /* A followed short link with its redirect chain, or a mismatch table, makes
     this far taller than the hover tooltip it started as – and on a phone it is
     opened by a tap and has buttons of its own. It gets the same cap and its
     own scroll as the panel does. `dvh` follows a soft keyboard, and the
     safe-area insets keep the bottom clear of the gesture bar. */
  max-height: min(calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)), var(--tooltip-room, 100dvh));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.tooltip-container.tooltip-wide {
  width: min(var(--tooltip-wide) * var(--vz-scale, 1), 100vw - 32px);
  max-width: min(var(--tooltip-wide) * var(--vz-scale, 1), 100vw - 32px);
}

/* A heading and the verdict on what it names, side by side */
.tooltip-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.tooltip-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tooltip-section {
  display: grid;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.tooltip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.tooltip-payload {
  max-height: 120px;
  overflow-y: auto;
  overflow-wrap: anywhere;
}

.tooltip-url {
  overflow-wrap: anywhere;
}

.tooltip-full-url {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}

.tooltip-url--clamp {
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}

.tooltip-chain {
  list-style: none;
  display: grid;
  gap: 2px;
  max-height: 120px;
  overflow-y: auto;
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
}

.tooltip-chain li {
  display: flex;
  gap: 6px;
}

.tooltip-chain__n {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  flex: none;
}

/* Fade and lift by 8px, from the side the tooltip opens on */
.tooltip-fade-enter-active {
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}

.tooltip-fade-leave-active {
  transition: opacity 100ms ease-in, transform 100ms ease-in;
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

@media (prefers-reduced-motion: reduce) {
  .tooltip-fade-enter-from,
  .tooltip-fade-leave-to {
    transform: none !important;
  }
}
</style>
