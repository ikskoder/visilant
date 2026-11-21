<script setup lang="ts">
import type { LinkTooltipData } from '~/logic/ui-state'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AddressFindings from '~/components/AddressFindings.vue'
import EmailBreakdown from '~/components/EmailBreakdown.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import MailRecipients from '~/components/MailRecipients.vue'
import MailServiceBadge from '~/components/MailServiceBadge.vue'
import RedFlagCount from '~/components/RedFlagCount.vue'
import SecureText from '~/components/SecureText.vue'
import VzBadge from '~/components/VzBadge.vue'
import VzIcon from '~/components/VzIcon.vue'
import VzNotice from '~/components/VzNotice.vue'
import VzSig from '~/components/VzSig.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { useRedFlagCount } from '~/composables/useRedFlags'
import { useTopLayer } from '~/composables/useTopLayer'
import { canonicalMailDomain } from '~/logic/email-safety'
import { listedAddresses, mailLinkStanding, mailUsernameRedFlag, recipientsAreListed } from '~/logic/mail-recipient-list'
import { showsVisitFacts } from '~/logic/show-visit-facts'
import { usernameRedFlag } from '~/logic/username-characters'
import EmailMismatchTable from './EmailMismatchTable.vue'
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
  (e: 'open', href: string): void
  (e: 'dismiss'): void
  (e: 'details', domain: string): void
  /** The details of an email address: the address, or the mail link whole */
  (e: 'emailDetails', value: string): void
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

// The addresses the list of recipients shows, when it is on show at all
const listedRecipients = computed(() => listedAddresses(props.data?.email?.recipients, props.data?.email?.recipientsNotChecked))
/** The link writes to several: the list tells about each, and no address is set apart above it. */
const listed = computed(() => recipientsAreListed(props.data?.email?.recipients, props.data?.email?.recipientsNotChecked))
// Where a mail link goes when its text shows another address: every recipient,
// in the order the link names them, or the one address of a bare one
const mismatchTargets = computed(() => {
  const data = props.data
  if (!data?.email?.mismatch)
    return []
  const recipients = data.email.recipients?.length ? data.email.recipients : null
  if (recipients)
    return recipients.map(r => ({ username: r.analysis.localPart, domain: r.analysis.domain, providerKind: r.providerKind, stats: r.stats, isSafe: r.isSafe, unchecked: r.unchecked }))
  return [{ username: data.email.analysis.localPart, domain: data.email.analysis.domain, providerKind: data.email.providerKind, stats: data.stats, isSafe: data.isSafe, unchecked: data.unchecked }]
})
// The table of a mail link whose text shows another domain sets the visits of
// the two side by side, and the facts under the address would say them again
const factsInMismatch = computed(() => {
  const shown = props.data?.email?.mismatch
  return Boolean(shown) && mismatchTargets.value.some(goes => canonicalMailDomain(goes.domain) !== canonicalMailDomain(shown!.domain))
})

// The steps a followed link went through, when there is more than the link and
// where it ended, and the setting asks for them
const showChain = computed(() => props.traceChain && props.data?.shortUrl?.status === 'resolved' && props.data.shortUrl.chain.length > 2)

const { t } = useI18n()
const { statusLabel } = useFamiliarityFacts()
// In place of a verdict on a known short-link service
const shortLinkBadge = computed(() => ({ verdict: 'shortener', text: t.value('linkTooltipShortener'), tone: 'caution' as const, icon: 'shield-alert' as const }))

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
// What a followed link grows to: both addresses with their verdicts, the facts
// of the one it ends at and the chain. Too small a figure opens the tooltip on
// the side with less room, where it then scrolls inside itself
const EXPANDED_ESTIMATE = 440
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

/** The top edge, kept from the first press inside the tooltip, see `reposition` */
const heldTop = ref<number | null>(null)
// A tooltip shown again is placed afresh. Not on every new data object: the
// same tooltip gets one each time a short link it follows moves a step
watch(() => props.visible, (shown) => {
  if (shown)
    heldTop.value = null
})

function holdTop() {
  // Where it is placed, not where the enter animation has it at this moment
  const placed = Number.parseFloat(String(tooltipStyle.value.top ?? ''))
  if (heldTop.value === null && Number.isFinite(placed) && placed > -1000)
    heldTop.value = placed
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
  // Once the reader has pressed something in it, the top edge stays where it
  // is: a row of recipients opened in a tooltip above the link used to push
  // everything over it upwards, and the row just pressed slid out from under
  // the pointer. It grows downwards then, into what is left of the screen.
  if (heldTop.value !== null) {
    // Moved up only as far as it must to stay on the screen
    top = Math.max(MARGIN, Math.min(heldTop.value, vh - MARGIN - tooltipHeight))
  }
  else if (placement.value === 'below') {
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
  const room = placement.value === 'below' || heldTop.value !== null ? vh - top - MARGIN : anchor.top - GAP - MARGIN
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
  // Over every recipient, by the answer the click is held on
  const standing = mailLinkStanding(email, { isSafe: Boolean(props.data?.isSafe), unchecked: props.data?.unchecked })
  // A username made to pass for another is a red flag, as the hold counts it
  return Boolean(email.mismatch) || !standing.familiar || standing.unchecked || mailUsernameRedFlag(email)
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

/**
 * Opening the address of a tooltip that was asked for (a QR code, mostly):
 * the same button the link dialog has, red and deaf for half a second unless
 * the destination is familiar and nothing was found about the link.
 */
const linkFlags = useRedFlagCount(() => props.data && props.data.kind !== 'email' && props.data.kind !== 'text' ? props.data.domain : '', () => props.data?.href, () => undefined)
const linkIsRisky = computed(() => {
  const data = props.data
  if (!data)
    return false
  if (!data.isSafe || data.unchecked || data.mismatch || linkFlags.value > 0)
    return true
  // A short link is as good as where it ends, and until that is known, unknown
  // Not calm while that is still being looked up or only offered either, as
  // in the dialog: the answer may yet turn it red under the pointer
  const short = data.shortUrl
  if (short?.status === 'resolved')
    return !short.resolvedIsSafe || Boolean(short.resolvedUnchecked)
  return Boolean(short)
})

// A tooltip that was asked for stays until it is closed: the pointer crossing
// it on its way somewhere else is not a pointer that left a link
function onPointerLeave() {
  if (!props.data?.asked)
    emit('close')
}

const closable = computed(() => Boolean(props.data?.asked || props.data?.heldClick))

function openLink(href: string) {
  if (linkIsRisky.value && !goArmed.value)
    return
  emit('open', href)
}

// Decide placement synchronously when a new tooltip is shown so the enter
// animation slides in from the correct side. Reposition will refine later
// once the actual tooltip height is known.
watch(
  () => props.data?.href,
  () => {
    placementLocked.value = false
    heldTop.value = null
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
      @mouseleave="onPointerLeave"
      @pointerdown.capture="holdTop"
    >
      <div
        class="tooltip-container vz-overlay vz-tooltip"
        :class="{ 'tooltip-wide': data.mismatch || showChain || (data.kind === 'email' && (listed || data.email?.mismatch)), 'tooltip-container--closable': closable }"
        :style="{ '--vz-scale': fontScale }"
      >
        <!-- Email address (mailto link, selection or QR payload) -->
        <template v-if="data.kind === 'email' && data.email">
          <!-- What it is, the address, then what is known about it: the verdict,
               the count of red flags and the flags themselves, in that order.
               The verdict used to sit beside the heading, above the address it
               was about -->
          <div class="grid gap-1">
            <div class="tooltip-label">
              <VzSig />
              <!-- Several recipients are a link, not an address: none of them
                   is set apart above the list, each is told about in it -->
              <span class="vz-eyebrow">{{ t(listed ? 'mailLinkHeading' : 'emailTooltipTitle') }}</span>
            </div>
            <EmailBreakdown :analysis="data.email.analysis" :params="data.email.params" :listed-recipients="listedRecipients" :domain-elsewhere="listed" compact>
              <template #under-address>
                <div v-if="!listed" class="tooltip-label">
                  <span class="vz-eyebrow">{{ t('linkInterceptStatus') }}</span>
                  <!-- A mail service: a visit count says nothing about one -->
                  <MailServiceBadge v-if="data.email.providerKind !== 'regular'" :kind="data.email.providerKind" />
                  <VzBadge v-else-if="data.unchecked" tone="neutral" icon="shield-unknown" data-verdict="unchecked">
                    {{ t('verdictUnchecked') }}
                  </VzBadge>
                  <VzBadge v-else :tone="statusLabel(data.domain, data.isSafe, data.stats.count).tone" :icon="statusLabel(data.domain, data.isSafe, data.stats.count).icon" :data-verdict="statusLabel(data.domain, data.isSafe, data.stats.count).verdict">
                    {{ statusLabel(data.domain, data.isSafe, data.stats.count).text }}
                  </VzBadge>
                  <!-- The address's lines below, and the link that shows another one -->
                  <RedFlagCount :hostname="data.domain" context="email" :extra="(data.email.mismatch ? 1 : 0) + (usernameRedFlag(data.email.analysis.localPart) ? 1 : 0)" />
                </div>

                <!-- Visible text shows a different address than the actual mailto
                     target: the two set side by side part by part, one table per
                     address the mail goes to -->
                <template v-if="data.email.mismatch">
                  <VzNotice tone="danger" icon="flag" data-red-flag>
                    <p class="vz-body-strong">
                      {{ t('emailTooltipMismatchWarning') }}
                    </p>
                    <p>{{ t('emailMismatchHowTo') }}</p>
                  </VzNotice>
                  <EmailMismatchTable
                    v-for="(goes, index) in mismatchTargets"
                    :key="index"
                    :shows="data.email.mismatch"
                    :goes="goes"
                    :position="mismatchTargets.length > 1 ? { n: index + 1, total: mismatchTargets.length } : undefined"
                    :show-visit-count="showVisitCount"
                  />
                </template>

                <!-- Structural markers of the address's domain -->
                <AddressFindings v-if="!listed" :hostname="data.domain" context="email" :familiar="data.isSafe" :mail-service="data.email.providerKind" />
              </template>
            </EmailBreakdown>
          </div>

          <!-- A mailto carries a list. Only the first name used to be checked. -->
          <MailRecipients
            v-if="data.email.recipients"
            :recipients="data.email.recipients"
            :not-checked="data.email.recipientsNotChecked"
          />

          <!-- Visit facts for the address's domain (regular domains only).
               Named, because the address printed above is not what was visited. -->
          <VzNotice v-if="!listed && data.email.providerKind === 'regular' && data.unchecked" tone="neutral" icon="unknown" data-status="unchecked">
            {{ t('linkUncheckedNotice') }}
          </VzNotice>
          <!-- Not for a site never visited: the verdict under the address has said so -->
          <div v-else-if="!listed && !factsInMismatch && data.email.providerKind === 'regular' && Number(data.stats.count) > 0 && showsVisitFacts(showVisitCount, data.isSafe)" class="grid gap-2">
            <span class="vz-small">{{ t('baseDomain') }}: <SecureText :text="data.domain" size="s" :diff="linkDiff(data.domain)"><CopyButton :text="data.domain" /></SecureText></span>
            <FamiliarityFacts :stats="data.stats" verdict-beside />
          </div>

          <div class="tooltip-actions">
            <button v-if="showGoButton" class="vz-btn vz-btn--sm" :class="{ 'vz-btn--risk': mailIsRisky }" data-action="go" @click="goToMail(data.href)">
              {{ t('emailOpenMailApp') }}<VzIcon v-if="!mailIsRisky" name="arrow-right" />
            </button>
            <!-- The check page with the address in it. The link whole when the
                 tooltip is about a mail link, so the page lists every recipient -->
            <button class="vz-btn vz-btn--sm" data-action="details" @click="emit('emailDetails', data.email.writing ? data.href : data.email.analysis.raw)">
              {{ t('emailAddressDetails') }}
            </button>
          </div>
        </template>

        <!-- Raw payload (QR tel:/WIFI:/plain text or unrecognized selection) -->
        <template v-else-if="data.kind === 'text' && data.rawText">
          <div class="tooltip-label">
            <VzSig />
            <!-- Somebody who asked for a mail link to be checked is told it is
                 one: "Content type: Text" answered a question nobody put -->
            <span v-if="data.rawText.mailWithoutAddress" class="vz-eyebrow">{{ t('mailLinkHeading') }}</span>
            <span v-else class="vz-eyebrow">
              {{ t('qrPayloadType') }}: {{ t(`qrType${data.rawText.payloadKind.charAt(0).toUpperCase()}${data.rawText.payloadKind.slice(1)}`) }}
            </span>
          </div>
          <p v-if="data.rawText.mailWithoutAddress" class="vz-small" data-status="no-address">
            {{ t('mailLinkNoAddress') }}
          </p>
          <div class="vz-well tooltip-payload">
            <SecureText kind="raw" :text="data.rawText.payload" size="m">
              <CopyButton :text="data.rawText.payload" />
            </SecureText>
          </div>
        </template>

        <!-- Mismatch: warning + comparison table -->
        <template v-else-if="data.mismatch">
          <!-- Link text naming another site is a red flag, and the title says it.
               No count beside it: the box names two sites, each with its own
               verdict in the table, and one number for both would leave the
               reader to guess whose it is. The flags under the destination
               carry their own sign. -->
          <div class="tooltip-title" data-red-flag>
            <VzSig mark="flag" large />
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

          <!-- The destination's other spelling, straight under the table that
               names it, then its red flags and what is only worth a look -->
          <OtherSpelling :shown="data.domain" :other="data.punycode" :diff="data.punycode ? linkDiff(data.punycode) : undefined" />
          <AddressFindings :hostname="data.domain" :url="data.href" :familiar="data.isSafe" />
        </template>

        <!-- No mismatch: the address, what is known about it, and where it leads if that was looked up -->
        <template v-else>
          <!-- A known short-link service says nothing about where it leads, so
               it gets its own badge, never a verdict on the service itself,
               and no facts. An address a link was followed from keeps its
               verdict: the one it ends at gets its own under its own name -->
          <AddressBlock
            :heading="t('linkTooltipDestination')"
            :hostname="data.domain"
            :url="data.href"
            :punycode="data.punycode"
            :badge="data.shortUrl?.isKnownShortener ? shortLinkBadge : statusLabel(data.domain, data.isSafe, data.stats.count, data.unchecked)"
            :familiar="data.isSafe"
            :service="Boolean(data.shortUrl?.isKnownShortener)"
            :facts="!data.shortUrl?.isKnownShortener && showsVisitFacts(showVisitCount, data.isSafe) ? data.stats : null"
            :unchecked="data.unchecked"
          >
            <template #lead>
              <VzSig />
            </template>
          </AddressBlock>

          <ShortLinkBlock
            v-if="data.shortUrl"
            :link="data.shortUrl"
            :show-visit-count="showVisitCount"
            :show-full-url="showFullUrl"
            :trace-chain="traceChain"
            compact
            @resolve="handleResolveClick()"
            @mark-shortener="handleMarkAsShortener()"
          />

          <div class="tooltip-actions">
            <button v-if="data.asked" class="vz-btn vz-btn--sm" :class="{ 'vz-btn--risk': linkIsRisky }" data-action="open" @click="openLink(data.href)">
              {{ t('linkInterceptOpenNewTab') }}
            </button>
            <button class="vz-btn vz-btn--sm" data-action="details" @click="emit('details', data.shortUrl?.status === 'resolved' ? data.shortUrl.resolvedDomain : data.domain)">
              {{ t('linkInterceptDomainInfo') }}
            </button>
            <!-- Follow once: when the domain is not a known shortener and short
                 link detection is on. "Mark as shortener" is not offered here:
                 nothing yet says this site is one, and a stray press would hide
                 every link from it. It appears once following has shown the link
                 really leads somewhere else, in the block above. -->
            <template v-if="!data.shortUrl && shortUrlMode !== 'off'">
              <button class="vz-btn vz-btn--sm vz-btn--quiet" data-action="resolve-once" @click.stop="handleResolveOnce()">
                <VzIcon name="link" />{{ t('linkResolveTry') }}
              </button>
              <VzHelp :text="t('linkResolveHelp')" :about="data.href" />
            </template>
          </div>
        </template>
      </div>
      <!-- Asked for from the menu, or put up by a click that was held: no
           pointer is resting on it, so it closes by its own button. Outside
           the box that scrolls, so it stays in its corner under a long chain,
           and the first row of the box keeps clear of it -->
      <button v-if="closable" class="vz-iconbtn vz-iconbtn--sm tooltip-close" :style="{ '--vz-scale': fontScale }" :title="t('closeDialog')" :aria-label="t('closeDialog')" data-action="close" @click="emit('dismiss')">
        <VzIcon name="close" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.tooltip-close {
  position: absolute;
  top: 4px;
  right: 4px;
}

/* The first row of the box ends where the close button begins */
.tooltip-container--closable > :first-child {
  padding-right: calc(var(--control-sm) * var(--vz-scale, 1));
}

@media (pointer: coarse) {
  .tooltip-container--closable > :first-child {
    padding-right: var(--touch-target);
  }
}

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

.tooltip-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* Beside the button it explains, not a row's gap away from it */
.tooltip-actions :deep(.vz-help) {
  margin-left: calc(-1 * var(--space-2) - 4px);
}

.tooltip-payload {
  max-height: 120px;
  overflow-y: auto;
  overflow-wrap: anywhere;
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
