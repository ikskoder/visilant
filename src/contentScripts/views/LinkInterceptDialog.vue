<script setup lang="ts">
import type { LinkInterceptData } from '~/logic/ui-state'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AddressFindings from '~/components/AddressFindings.vue'
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
import { showsVisitFacts } from '~/logic/show-visit-facts'
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
 * "Open link" has nothing to guard and goes at once.
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
 * The badge beside the address the link names. A known short-link service
 * gets its own, never a verdict on the service itself, and none at all while
 * the dialog is headed "Short link": it was the title again, two lines below
 * it. Kept once the link has been followed somewhere else: the address it
 * ends at gets a verdict of its own, and this one stays what is known about
 * where the link goes first.
 */
const addressBadge = computed(() => {
  const data = props.data
  if (!data)
    return null
  if (data.shortUrl?.isKnownShortener)
    return verdict.value === 'hidden' ? null : { verdict: 'shortener', text: t.value('linkTooltipShortener'), tone: 'caution' as const, icon: 'shield-alert' as const }
  return statusLabel(data.isSafe, data.stats.count, data.unchecked)
})

// Asked with the hostnames and URLs the lines in the dialog are drawn with
const destinationFlags = useRedFlagCount(() => props.data?.domain ?? '', () => props.data?.url, () => undefined)
const resolvedFlags = useRedFlagCount(() => props.data?.shortUrl?.status === 'resolved' ? props.data.shortUrl.resolvedDomain : '', () => undefined, () => undefined)

/**
 * Whether going ahead is a plain "Open link".
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
  // The flags of the address the link names count as well as those of where
  // it ends: a decoy name before an @ is no less of one for the link ending
  // on a site the user knows
  if (data.shortUrl?.status === 'resolved')
    return resolvedFlags.value === 0 && destinationFlags.value === 0
  return !data.shortUrl && destinationFlags.value === 0
})

/**
 * Which way the reader came here, because the words depend on it.
 *
 * A click that was held: they were on their way somewhere and were stopped, so
 * the dialog speaks of what lies ahead, and of opening anyway or not. Or the
 * menu item that checks a link: they went nowhere and asked a question, so it
 * is a check, with a result, a way to open the link and a way to close. It
 * used to say "Unfamiliar site ahead" and "Continue anyway" to both, and the
 * second reader had nothing to continue.
 */
const asked = computed(() => props.data?.ownNavigation !== false)

/**
 * Red flags in the link itself, which is the thing to say first, whatever the
 * verdict on the site. Link text naming another site has its own line, and a
 * short link its own title. For a held click it is the reason it was held. A
 * check that was asked for has no such reason, and has the flags all the same.
 */
const stoppedForFlags = computed(() => {
  const data = props.data
  if (!data || data.mismatch || verdict.value === 'hidden')
    return false
  return Boolean(data.reasons?.includes('red-flags')) || (asked.value && destinationFlags.value > 0)
})

const title = computed(() => {
  if (stoppedForFlags.value)
    return t.value('linkInterceptTitleRedFlags')
  switch (verdict.value) {
    case 'familiar': return t.value('linkInterceptTitleFamiliar')
    case 'hidden': return t.value('linkInterceptTitleHidden')
    case 'unchecked': return t.value('linkInterceptTitleUnchecked')
    // "Ahead" is for somebody on their way. A check has its verdict under the address
    default: return t.value(asked.value ? 'linkInterceptTitleFamiliar' : 'linkInterceptTitle')
  }
})

/**
 * What the button that goes ahead says, which is what it does. In a frame
 * from another site the dialog cannot open the link at all: the button lets
 * the next click on it through, and saying "Open" there opened nothing. A
 * check asked for from the menu always opens a new tab.
 */
const proceedLabel = computed(() => {
  if (props.data?.clickAgain)
    return t.value('linkInterceptAllowLink')
  if (asked.value)
    return t.value('linkInterceptOpenNewTab')
  return t.value(calm.value ? 'linkInterceptOpen' : 'linkInterceptContinue')
})
// Nothing was held for a check that was asked for, so there is nothing not to open
const backLabel = computed(() => t.value(asked.value ? 'closeDialog' : 'linkInterceptCancel'))

/**
 * The one icon at the head of the dialog, the signature and the sign in one.
 *
 * The exclamation mark is orange only when nothing red is anywhere in the
 * dialog: a short link nobody has followed yet, or a familiar site whose link
 * is still being looked up. Asked of what is on screen, not of why the click
 * was held, since a short link with a red flag in its address is held as a
 * short link and still shows the flag.
 */
const headSign = computed<{ mark: 'info' | 'flag' | 'unknown' | 'alert', caution?: boolean }>(() => {
  if (calm.value)
    return { mark: 'info' }
  if (stoppedForFlags.value)
    return { mark: 'flag' }
  if (verdict.value === 'unchecked')
    return { mark: 'unknown' }
  const nothingRed = !props.data?.mismatch && destinationFlags.value === 0 && resolvedFlags.value === 0
  return { mark: 'alert', caution: nothingRed && (verdict.value === 'hidden' || verdict.value === 'familiar') }
})

/**
 * The lookalike answer can arrive after the dialog opened calm, and turn the
 * plain "Open link" under the pointer into the red "Open anyway". It then
 * gets its own half second, as if the dialog had just opened: the arming that
 * ran while it was calm was for a button that was not there.
 */
function rearm() {
  clearTimeout(armTimer)
  armed.value = false
  armTimer = setTimeout(() => armed.value = true, RISK_DELAY_MS)
}

watch(calm, (now, before) => {
  if (before && !now)
    rearm()
})

/**
 * A line of help opening or closing makes the card taller or shorter, and the
 * card is centred, so the buttons move under a pointer that has not. The press
 * that follows gets the same half second as the first one.
 */
function onCardPress(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('[data-action="help"]'))
    rearm()
}

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
        @click.capture="onCardPress"
      >
        <div class="vz-dialog__head">
          <VzSig :mark="headSign.mark" :caution="headSign.caution" large />
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
        <!-- What the title "Short link" means, said under it -->
        <p v-else-if="verdict === 'hidden'" class="vz-body">
          {{ t('linkTooltipShortUrlWarning') }}
        </p>

        <!-- Mismatch: warning + comparison table -->
        <div v-if="data.mismatch" class="grid gap-3">
          <!-- A red flag. No count beside it, see the tooltip: the table below
               names two sites, each with its own verdict -->
          <VzNotice tone="danger" icon="flag" data-red-flag>
            <span class="vz-body-strong">{{ t('linkTooltipMismatchWarning') }}</span>
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

          <!-- The destination's other spelling, straight under the table that
               names it, then its red flags and what is only worth a look -->
          <OtherSpelling :shown="data.domain" :other="data.punycode" :diff="data.punycode ? linkDiff(data.punycode) : undefined" />
          <AddressFindings :hostname="data.domain" :url="data.url" :familiar="data.isSafe" />
        </div>

        <!-- No mismatch: the address and the evidence about it -->
        <div v-else class="vz-well grid gap-3">
          <AddressBlock
            :hostname="data.domain"
            :url="data.url"
            :punycode="data.punycode"
            :badge="addressBadge"
            :familiar="data.isSafe"
            :service="Boolean(data.shortUrl?.isKnownShortener)"
            :facts="!data.shortUrl?.isKnownShortener && showsVisitFacts(showVisitCount, data.isSafe) ? data.stats : null"
            :unchecked="data.unchecked"
          />

          <ShortLinkBlock
            v-if="data.shortUrl"
            :link="data.shortUrl"
            :show-visit-count="showVisitCount"
            :show-full-url="showFullUrl"
            :trace-chain="traceChain"
            @resolve="emit('resolveShortUrl')"
            @mark-shortener="handleMarkAsShortener()"
          />

          <!-- Follow once: when the domain is not a known shortener and short
               link detection is on. "Mark as shortener" is not offered here:
               nothing yet says this site is one, and a stray press would hide
               every link from it. It appears once following has shown the link
               really leads somewhere else, in the block above. -->
          <div v-if="!data.shortUrl && shortUrlMode !== 'off'" class="vz-ask">
            <button class="vz-btn vz-btn--sm vz-btn--quiet vz-btn--flush" data-action="resolve-once" @click.stop="handleResolveOnce()">
              <VzIcon name="link" />{{ t('linkResolveTry') }}
            </button>
            <VzHelp :text="t('linkResolveHelp')" :about="data.url" />
          </div>
        </div>

        <!-- A link in a frame that cannot be followed from here: the press on
             this dialog does not reach a frame from another site, so the
             answer is to let that one click through -->
        <p v-if="data.clickAgain" class="vz-small text-ink-2" data-click-again>
          {{ t('linkInterceptClickAgain') }}
        </p>

        <!-- The way out of danger is the loud button. Continuing is the risk
             button, outlined in red, and it ignores a press for the first half
             second. A calm, familiar destination just has "Open link". -->
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
            {{ proceedLabel }}
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
            {{ proceedLabel }}
          </button>
          <button
            v-else
            ref="backButton"
            class="vz-btn vz-btn--primary"
            data-action="back"
            @click="emit('cancel')"
          >
            {{ backLabel }}
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
</style>
