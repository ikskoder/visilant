<script setup lang="ts">
import type { LinkInterceptData } from '~/logic/ui-state'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import RedFlagCount from '~/components/RedFlagCount.vue'
import SecureText from '~/components/SecureText.vue'
import VzBadge from '~/components/VzBadge.vue'
import VzIcon from '~/components/VzIcon.vue'
import VzNotice from '~/components/VzNotice.vue'
import VzSig from '~/components/VzSig.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { useModalDialog } from '~/composables/useModalDialog'
import { useRedFlagCount } from '~/composables/useRedFlags'
import { useTopLayer } from '~/composables/useTopLayer'
import { useVisualViewport } from '~/composables/useVisualViewport'
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

// The letters a lookalike changed, underlined in the address. Asked as the
// lookalike notice under it asks, so both read one answer
const linkDiff = useLookalikeDiff(() => props.data?.domain ?? '')
const resolvedDiff = useLookalikeDiff(() => props.data?.shortUrl?.resolvedDomain ?? '')

/**
 * The dialog, and where focus lands when it opens.
 *
 * The way back, not Continue: this dialog is here because something about the
 * link is worth a second look, and a stray Enter must not be the thing that
 * follows it. See `useModalDialog`.
 */
const card = ref<HTMLElement | null>(null)
const backButton = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLElement | null>(null)

// Above anything the page can lay over it – see `useTopLayer`. A close that
// was not ours is a way back, never a way through.
const layer = useTopLayer({
  mode: 'modal',
  visible: () => props.visible && Boolean(props.data),
  onDismiss: () => emit('cancel'),
})

// Over what is on the screen, not the layout viewport, see `viewportCoverStyle`
const cover = useVisualViewport(() => props.visible && Boolean(props.data))

useModalDialog({
  visible: () => props.visible && Boolean(props.data),
  container: () => card.value,
  initialFocus: () => backButton.value ?? closeButton.value,
  onEscape: () => emit('cancel'),
})

/**
 * How long the risk button ignores a press after the dialog opens.
 *
 * The click that opened the dialog is often the first of a double click, and
 * the second one would land on whatever sits under the pointer. The calm
 * "Go to link" has nothing to guard and goes at once.
 */
const RISK_DELAY_MS = 500
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | undefined

watch(() => props.visible && Boolean(props.data), (open) => {
  clearTimeout(armTimer)
  armed.value = false
  if (open)
    armTimer = setTimeout(() => armed.value = true, RISK_DELAY_MS)
}, { immediate: true })

onBeforeUnmount(() => clearTimeout(armTimer))

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

/**
 * What the dialog has to say about where the link goes.
 *
 * The title used to say "Unfamiliar site ahead" whatever the link was, and the
 * dialog also opens for familiar sites – from the context menu, and for a short
 * link it could not see through – so a red title sat above a green "Familiar
 * site". Once a short link is resolved, only the real destination counts. Until
 * then a known shortener says nothing about where it leads, whether or not the
 * shortener itself is familiar.
 */
const verdict = computed<'unfamiliar' | 'hidden' | 'familiar' | 'unchecked'>(() => {
  const data = props.data
  if (!data)
    return 'unfamiliar'
  if (data.shortUrl?.status === 'resolved') {
    if (data.shortUrl.resolvedUnchecked)
      return 'unchecked'
    return data.shortUrl.resolvedIsSafe ? 'familiar' : 'unfamiliar'
  }
  if (data.shortUrl?.isKnownShortener)
    return 'hidden'
  // Not "unfamiliar ahead" with a hint about impersonation: nothing was found
  // out about this site, which is a different thing to say and to act on
  if (data.unchecked)
    return 'unchecked'
  return data.isSafe ? 'familiar' : 'unfamiliar'
})

/**
 * Stopped for what is in the link itself, which is the thing to say first,
 * whatever the verdict on the site. Link text naming another site has its own
 * line, and a short link its own title.
 */
const stoppedForFlags = computed(() => Boolean(props.data?.reasons?.includes('red-flags') && !props.data.mismatch && verdict.value !== 'hidden'))

const title = computed(() => {
  if (stoppedForFlags.value)
    return t.value('linkInterceptTitleRedFlags')
  switch (verdict.value) {
    case 'familiar': return t.value('linkInterceptTitleFamiliar')
    case 'hidden': return t.value('linkInterceptTitleHidden')
    case 'unchecked': return t.value('linkInterceptTitleUnchecked')
    default: return t.value('linkInterceptTitle')
  }
})

// Asked with the hostnames and URLs the lines in the dialog are drawn with
const destinationFlags = useRedFlagCount(() => props.data?.domain ?? '', () => props.data?.url, () => undefined)
const resolvedFlags = useRedFlagCount(() => props.data?.shortUrl?.status === 'resolved' ? props.data.shortUrl.resolvedDomain : '', () => undefined, () => undefined)

/**
 * Whether going ahead is a plain "Go to link".
 *
 * A familiar destination is not always the end of it. Link text naming another
 * site is worth stopping for wherever the link goes, and a lookup still running
 * – or offered and not yet pressed – may yet turn the answer red after the
 * button was pressed. A red flag on a familiar address is a reason to look as
 * well: a site the user knows does not put a decoy name before an @ or mix
 * alphabets in its name.
 */
const calm = computed(() => {
  const data = props.data
  if (verdict.value !== 'familiar' || !data)
    return false
  if (data.mismatch)
    return false
  if (data.shortUrl?.status === 'resolved')
    return resolvedFlags.value === 0
  return !data.shortUrl && destinationFlags.value === 0
})

/**
 * The lookalike answer can arrive after the dialog opened calm, and turn the
 * plain "Go to link" under the pointer into the red "Continue anyway". It then
 * gets its own half second, as if the dialog had just opened: the arming that
 * ran while it was calm was for a button that was not there.
 */
watch(calm, (now, before) => {
  if (before && !now) {
    clearTimeout(armTimer)
    armed.value = false
    armTimer = setTimeout(() => armed.value = true, RISK_DELAY_MS)
  }
})

function onContinue() {
  if (!calm.value && !armed.value)
    return
  emit('continue')
}
</script>

<template>
  <Transition name="overlay-fade" appear @enter="layer.enter">
    <dialog
      v-if="visible && data"
      :style="cover"
      class="vz-layer z-[2147483647] flex items-center justify-center pointer-events-auto"
      :aria-label="title"
      @click.self="emit('cancel')"
    >
      <!-- Backdrop. Transparent to clicks, or it would sit between the user and
           the overlay behind it and swallow every click-outside -->
      <div class="absolute inset-0 vz-scrim pointer-events-none" />

      <div
        ref="card"
        class="relative dialog-container vz-overlay vz-dialog"
        :class="{ 'dialog-wide': data?.mismatch, 'dialog-full': hasTraceData }"
        :data-verdict="verdict"
      >
        <VzSig />
        <div class="vz-dialog__head">
          <VzIcon v-if="calm" name="info" large class="tone-brand" />
          <VzIcon v-else-if="stoppedForFlags" name="flag" large class="tone-danger" />
          <VzIcon v-else-if="verdict === 'unchecked'" name="unknown" large class="tone-neutral" />
          <VzIcon v-else name="alert" large class="tone-danger" />
          <h2 class="vz-title">
            {{ title }}
          </h2>
          <button
            ref="closeButton"
            :aria-label="t('closeDialog')"
            :title="t('closeDialog')"
            class="vz-iconbtn"
            @click="emit('cancel')"
          >
            <VzIcon name="close" />
          </button>
        </div>

        <!-- Only an unfamiliar destination gets a hint. The title already says it
             is unfamiliar, so the hint is about the one case that matters: the
             reader thinks they know the site, which is what a copy relies on. -->
        <p v-if="verdict === 'unfamiliar'" class="vz-body">
          {{ t('linkInterceptPhishingHint') }}
        </p>

        <!-- Mismatch: warning + comparison table -->
        <div v-if="data.mismatch" class="grid gap-3">
          <!-- A red flag. No count beside it, see the tooltip: the table below
               names two sites, each with its own verdict -->
          <VzNotice tone="danger" icon="flag" data-red-flag>
            <span class="vz-body-strong">{{ t('linkInterceptMismatchWarning') }}</span>
          </VzNotice>

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

          <!-- Punycode. Skipped when it would repeat the domain verbatim -->
          <VzNotice v-if="data.punycode && data.punycode !== data.domain" tone="danger">
            {{ t('linkTooltipPunycode') }}: <SecureText :text="data.punycode" size="s" :diff="linkDiff(data.punycode)">
              <CopyButton :text="data.punycode" />
            </SecureText>
          </VzNotice>

          <DomainMarkers :hostname="data.domain" :url="data.url" :familiar="data.isSafe" />
          <LookalikeNotice :hostname="data.domain" />
        </div>

        <!-- No mismatch: the address and the evidence about it -->
        <div v-else class="vz-well grid gap-3">
          <div class="dialog-address">
            <SecureText :text="data.domain" size="l" :diff="linkDiff(data.domain)">
              <CopyButton :text="data.domain" />
            </SecureText>
            <VzBadge v-if="data.shortUrl?.isKnownShortener" tone="danger" icon="alert" data-verdict="shortener">
              {{ t('linkTooltipShortener') }}
            </VzBadge>
            <VzBadge
              v-else
              :tone="statusLabel(data.isSafe, data.stats.count, data.unchecked).tone"
              :icon="statusLabel(data.isSafe, data.stats.count, data.unchecked).icon"
              :data-verdict="statusLabel(data.isSafe, data.stats.count, data.unchecked).verdict"
            >
              {{ statusLabel(data.isSafe, data.stats.count, data.unchecked).text }}
            </VzBadge>
            <RedFlagCount :hostname="data.domain" :url="data.url" />
          </div>
          <VzNotice v-if="data.unchecked" tone="neutral" icon="unknown" bare data-status="unchecked">
            {{ t('linkUncheckedNotice') }}
          </VzNotice>
          <FamiliarityFacts v-else-if="!data.shortUrl?.isKnownShortener && shouldShowCount(data.isSafe)" :stats="data.stats" />

          <!-- Short link: idle, with the button that follows it -->
          <div v-if="data.shortUrl?.status === 'idle'" class="dialog-section">
            <VzNotice v-if="data.shortUrl.isKnownShortener" tone="danger" bare>
              {{ t('linkTooltipShortUrlWarning') }}
            </VzNotice>
            <button class="vz-btn vz-btn--block" data-action="resolve" @click="emit('resolveShortUrl')">
              <VzIcon name="link" />{{ t(data.shortUrl.isKnownShortener ? 'linkResolveKnown' : 'linkResolveTry') }}
            </button>
          </div>

          <!-- Short link: being followed -->
          <div v-if="data.shortUrl?.status === 'loading'" class="dialog-section">
            <button class="vz-btn vz-btn--block" disabled>
              <VzIcon name="pending" />{{ t('linkTooltipResolvingUrl') }}
            </button>
          </div>

          <!-- Short link: followed to its end -->
          <div v-if="data.shortUrl?.status === 'resolved'" class="dialog-section">
            <span class="vz-eyebrow inline-flex items-center gap-1"><VzIcon name="link" />{{ t('linkInterceptRealDestination') }}</span>
            <div class="dialog-address">
              <SecureText :text="data.shortUrl.resolvedDomain" size="l" :diff="resolvedDiff(data.shortUrl.resolvedDomain)">
                <CopyButton :text="data.shortUrl.resolvedDomain" />
              </SecureText>
              <VzBadge
                :tone="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).tone"
                :icon="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).icon"
                :data-verdict="statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).verdict"
              >
                {{ statusLabel(data.shortUrl.resolvedIsSafe, data.shortUrl.resolvedStats.count, data.shortUrl.resolvedUnchecked).text }}
              </VzBadge>
              <RedFlagCount :hostname="data.shortUrl.resolvedDomain" />
            </div>

            <p v-if="showFullUrl && data.shortUrl.resolvedUrl" class="vz-small dialog-url">
              {{ data.shortUrl.resolvedUrl }}<CopyButton :text="data.shortUrl.resolvedUrl" inline />
            </p>

            <!-- The destination gets the same reading as an address written out
                 in full. Following a short link is the one case where the user
                 could not have looked at it themselves. -->
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
              <ol class="dialog-chain">
                <li v-for="(hop, i) in data.shortUrl.chain" :key="i">
                  <span class="dialog-chain__n">{{ i + 1 }}.</span>
                  <span class="dialog-url">{{ hop }}</span>
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

          <!-- Short link: could not be followed -->
          <div v-if="data.shortUrl?.status === 'error'" class="dialog-section">
            <VzNotice tone="neutral" bare>
              {{ data.shortUrl.error === 'same_domain' ? t(data.shortUrl.isKnownShortener ? 'linkTooltipResolveSameDomainShortener' : 'linkTooltipResolveSameDomain') : t(data.shortUrl.error === 'refused' ? 'linkTooltipResolveRefused' : 'linkTooltipResolveError') }}
            </VzNotice>
            <button v-if="data.shortUrl.error !== 'same_domain' && data.shortUrl.error !== 'refused'" class="vz-btn vz-btn--block" data-action="retry" @click="emit('resolveShortUrl')">
              {{ t('linkTooltipRetryResolve') }}
            </button>
          </div>

          <!-- Punycode. Skipped when it would repeat the domain verbatim -->
          <VzNotice v-if="data.punycode && data.punycode !== data.domain" tone="danger" bare>
            {{ t('linkTooltipPunycode') }}: <SecureText :text="data.punycode" size="s" :diff="linkDiff(data.punycode)">
              <CopyButton :text="data.punycode" />
            </SecureText>
          </VzNotice>

          <DomainMarkers :hostname="data.domain" :url="data.url" :familiar="data.isSafe" bare />
          <LookalikeNotice :hostname="data.domain" bare />

          <!-- Follow once: when the domain is not a known shortener and short
               link detection is on. "Mark as shortener" is not offered here:
               nothing yet says this site is one, and a stray press would hide
               every link from it. It appears once following has shown the link
               really leads somewhere else, in the block above. -->
          <button v-if="!data.shortUrl && shortUrlMode !== 'off'" class="vz-btn vz-btn--sm vz-btn--quiet vz-btn--flush justify-self-start" data-action="resolve-once" @click.stop="handleResolveOnce()">
            <VzIcon name="link" />{{ t('linkResolveTry') }}
          </button>
        </div>

        <!-- A link in a frame that cannot be followed from here: the press on
             this dialog does not reach a frame from another site, so the
             answer is to let that one click through -->
        <p v-if="data.clickAgain" class="vz-small text-ink-2" data-click-again>
          {{ t('linkInterceptClickAgain') }}
        </p>

        <!-- The way out of danger is the loud button. Continuing is the risk
             button, outlined in red, and it ignores a press for the first half
             second. A calm, familiar destination just has "Go to link". -->
        <!-- The way out is at the right edge, where a hand goes without
             looking, and going ahead is at the far left: risk, details, back.
             In this order in the markup, not by CSS order, so Tab goes the way
             the eye does and the focus trap ends on the way back. A calm,
             familiar destination has no way back to offer and just goes. -->
        <div class="vz-dialog__actions">
          <button
            v-if="!calm"
            class="vz-btn vz-btn--risk"
            data-action="continue"
            @click="onContinue"
          >
            {{ t('linkInterceptContinue') }}
          </button>
          <!-- Not on a mismatch, where each column of the table has its own. Not
               for a short link not yet seen through either: all it could open is
               the shortener's own page, which says nothing about the destination. -->
          <button
            v-if="!data.mismatch && verdict !== 'hidden'"
            class="vz-btn"
            data-action="details"
            @click="emit('details', data.shortUrl?.status === 'resolved' ? data.shortUrl.resolvedDomain : data.domain)"
          >
            {{ t('linkInterceptDomainInfo') }}
          </button>
          <button
            v-if="calm"
            class="vz-btn vz-btn--primary"
            data-action="continue"
            @click="onContinue"
          >
            {{ t('linkTooltipGoToLink') }}
          </button>
          <button
            v-else
            ref="backButton"
            class="vz-btn vz-btn--primary"
            data-action="back"
            @click="emit('cancel')"
          >
            {{ t('dialogGoBack') }}
          </button>
        </div>
      </div>
    </dialog>
  </Transition>
</template>

<style scoped>
.dialog-container {
  width: min(440px, var(--vz-vw, 100vw) - 32px);
  max-width: none;
  /* The actions are at the bottom, and on a phone this dialog is the whole
     link check: hover and right-click are gone there, so a held link is the
     only one anybody sees it for. Landscape, a large font size or a mismatch table can
     leave it taller than the viewport, and without a scroll of its own the
     buttons sat off the screen with no way to reach them. `dvh` rather than
     `vh` so a soft keyboard shrinking the viewport is what gets measured, and
     the safe-area insets for the notch and gesture bar. */
  max-height: calc(var(--vz-vh, 100dvh) - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dialog-container.dialog-wide {
  width: min(560px, var(--vz-vw, 100vw) - 32px);
}

.dialog-container.dialog-full {
  width: min(680px, var(--vz-vw, 100vw) - 32px);
}

.dialog-address {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.dialog-section {
  display: grid;
  gap: 10px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.dialog-url {
  overflow-wrap: anywhere;
}

.dialog-chain {
  list-style: none;
  display: grid;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
}

.dialog-chain li {
  display: flex;
  gap: 6px;
}

.dialog-chain__n {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  flex: none;
}
</style>
