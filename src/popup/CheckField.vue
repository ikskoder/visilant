<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import type { EmailAnalysis } from '~/logic/email-safety'
import type { FamiliarityStats } from '~/logic/familiarity'
import type { MailSiteFamily } from '~/logic/mail-sites'
import type { SiteVisitData } from '~/logic/storage'
import type { EmailRecipientInfo } from '~/logic/ui-state'
import type { ResolvedUrlResult } from '~/logic/url-shorteners'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AddressCompare from '~/components/AddressCompare.vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import EmailBreakdown from '~/components/EmailBreakdown.vue'
import EmailCheckCaveat from '~/components/EmailCheckCaveat.vue'
import ExternalLookups from '~/components/ExternalLookups.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import MailRecipients from '~/components/MailRecipients.vue'
import RedFlagCount from '~/components/RedFlagCount.vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { visitKey } from '~/logic/domain-boundary'
import { classifyEmailDomain, loadEmailListsFromStorage } from '~/logic/email-providers'
import { analyzeEmailAddress, collectMailtoRecipients, MAX_MAILTO_RECIPIENTS, parseMailtoUrl } from '~/logic/email-safety'
import { aggregateFamiliarityStats, isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { getHostnameFromHref } from '~/logic/link-safety'
import { watchListStorage } from '~/logic/list-sync'
import { collectMailSiteFamilies, loadMailSitesFromRecords } from '~/logic/mail-sites'
import { classifyQrPayload } from '~/logic/payload-classify'
import { decodeQrFromImageBitmapSource } from '~/logic/qr'
import { settings } from '~/logic/storage'
import { isShortenedUrl, loadShortenersFromStorage } from '~/logic/url-shorteners'

const props = defineProps<{
  /** Something to check straight away, when the page was opened about it. */
  initial?: string
  /**
   * The name the checked-domain card under this field is about, and the
   * context it was asked in. The card draws the markers and the lookalike line
   * for its name, so the field leaves them out for the same name rather than
   * printing the same warning twice on one screen.
   */
  panelHostname?: string
  panelContext?: 'email'
}>()

const emit = defineEmits<{
  (e: 'checkedDomain', hostname: string, context?: 'email', url?: string): void
}>()

/**
 * Whether the card below already speaks for this name, asked the same way.
 *
 * Usually it does, since every check hands the card its name. It stops doing so
 * once a link has been expanded to another site: the card moves to where the
 * link lands, and the name that was pasted is left with the field alone.
 */
function panelCovers(hostname: string, context?: 'email'): boolean {
  return props.panelHostname === hostname && props.panelContext === context
}

const { t } = useI18n()

interface UrlResolveState {
  status: 'idle' | 'loading' | 'resolved' | 'error'
  finalHostname?: string
  finalUrl?: string
  chain?: string[]
}

type CheckResult
  = | { type: 'url', url: string, hostname: string, stats: FamiliarityStats, isSafe: boolean, isShortener: boolean, resolve: UrlResolveState, mailSites: MailSiteFamily[] }
    | { type: 'email', analysis: EmailAnalysis, params: { key: string, value: string }[], providerKind: EmailProviderKind, mailSites: MailSiteFamily[], recipients: EmailRecipientInfo[], recipientsNotChecked: number }
    | { type: 'raw', payloadKind: string, payload: string }
    | { type: 'invalid' }
    | { type: 'qr-error' }

const inputText = ref('')
const result = ref<CheckResult | null>(null)
// The letters a lookalike changed, underlined in the checked address. Asked as
// the lookalike notice under it asks, so both read one answer. An email address
// is marked by EmailBreakdown, which draws it.
const fieldDiff = useLookalikeDiff(() => result.value?.type === 'url' ? result.value.hostname : '')
const fileInput = ref<HTMLInputElement | null>(null)
const checkInput = ref<HTMLTextAreaElement | null>(null)

/**
 * The field takes the height of what is in it.
 *
 * Measured rather than counted: the box is collapsed to nothing first, because
 * `scrollHeight` on an element already tall enough reports the height it has
 * rather than the height it needs, and a field that has grown once would then
 * never shrink again.
 */
function growInput() {
  const box = checkInput.value
  if (!box)
    return

  box.style.height = 'auto'
  box.style.height = `${box.scrollHeight}px`
}

// Not every address arrives by typing – a QR code, a drop, a paste and the value
// the check page is opened with all set the text from the outside
watch(inputText, () => nextTick(growInput))

// And whenever the field's width changes. Measured once at a width the page had
// not settled on yet, a prefilled address on a phone left a field many times
// taller than its four lines.
let widthWatch: ResizeObserver | null = null
let lastWidth = 0
onMounted(() => {
  if (!checkInput.value || typeof ResizeObserver === 'undefined')
    return
  widthWatch = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width
    if (width !== lastWidth) {
      lastWidth = width
      growInput()
    }
  })
  widthWatch.observe(checkInput.value)
})
onUnmounted(() => widthWatch?.disconnect())

/** Set once the lists this page classifies by have actually been read. */
let stopWatchingLists: (() => void) | null = null

/**
 * The lists, on their way in, so a check can wait for them.
 *
 * The field is usable the moment the page draws, which is before the lists have
 * been read: a domain typed straight away was classified without the user's own
 * shorteners and mail providers, and answered a question about lists it had not
 * seen yet.
 */
let listsReady: Promise<unknown> = Promise.resolve()

onMounted(async () => {
  // Both lists, and awaited. The shortener lists were never loaded here at all,
  // so a domain the user had added by hand was flagged as a shortener in a
  // tooltip and not on this page – and the email lists were started and left to
  // land whenever, so the first check ran against whatever was ready.
  listsReady = Promise.all([
    loadEmailListsFromStorage(),
    loadShortenersFromStorage(),
  ])
  await listsReady

  // ...and followed, so an edit made in the settings next door reaches a check
  // page that is already open
  stopWatchingLists = watchListStorage()

  // Opened about something – a mailto with several recipients, most often.
  // Run after the lists are in, or the first check would classify without them.
  if (props.initial) {
    inputText.value = props.initial
    await runCheck(props.initial)
  }
})

onUnmounted(() => {
  stopWatchingLists?.()
  stopWatchingLists = null
})

/**
 * Which check is the current one.
 *
 * Decoding a QR image, reading a domain family out of storage and resolving a
 * short link all take a moment, and nothing tied them together: a slow QR image
 * dropped on the page could publish its result over the answer to a question the
 * user typed afterwards. Every path through the checker takes a number, and only
 * the newest one is allowed to say anything.
 */
let checkGeneration = 0

/** The number a new check takes, so the one before it stops publishing. */
function nextCheck(): number {
  checkGeneration += 1
  return checkGeneration
}

/**
 * The checked address's own record, judged the way the link tooltip, the
 * warnings and the toolbar judge it.
 *
 * It used to fold the whole domain family, so `checkout.paypal.test` read
 * "Familiar site" here because of visits to `paypal.test`, while a link to it
 * showed red and a form on it raised the typing warning. A check that answers
 * differently from what the extension then does misleads exactly the person who
 * asked. The family's own figures are still on the screen, under the site's
 * name in the dashboard below, where they are named as the family's.
 */
async function getVisitData(hostname: string): Promise<{ stats: FamiliarityStats, isSafe: boolean, mailSites: MailSiteFamily[] }> {
  const allData = await browser.storage.local.get(null)
  const own = allData[visitKey(hostname)] as SiteVisitData | undefined
  const stats = aggregateFamiliarityStats([own])
  const rules = normalizeFamiliarity(settings.value.familiarity)
  // A mail domain is never opened as a site, so a zero here says nothing. The
  // same read already holds the mapping and the visits it points at.
  loadMailSitesFromRecords(allData)
  return {
    stats,
    isSafe: isFamiliar(stats, rules),
    mailSites: collectMailSiteFamilies(allData, hostname, rules, Date.now(), visitKey),
  }
}

async function checkUrl(url: string, generation = nextCheck()) {
  const hostname = getHostnameFromHref(url)
  if (!hostname) {
    result.value = { type: 'invalid' }
    return
  }
  const visitData = await getVisitData(hostname)
  // Something newer has been asked about while this was being read
  if (generation !== checkGeneration)
    return

  result.value = {
    type: 'url',
    url,
    hostname,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    isShortener: isShortenedUrl(hostname),
    resolve: { status: 'idle' },
    mailSites: visitData.mailSites,
  }
  emit('checkedDomain', hostname, undefined, url)
}

async function checkEmail(addrOrMailto: string, generation = nextCheck()) {
  const isMailto = /^mailto:/i.test(addrOrMailto)
  const parsed = isMailto ? parseMailtoUrl(addrOrMailto) : null

  // Everyone the message would reach. `cc` and `bcc` are recipients too, and
  // checking only the first address let the rest travel unexamined. The heading
  // comes from the same list rather than from the part before the question
  // mark, which `mailto:?bcc=attacker@evil.example` leaves empty.
  const allRecipients = isMailto ? collectMailtoRecipients(parsed) : [{ field: 'to' as const, address: addrOrMailto }]
  const checked = allRecipients.slice(0, MAX_MAILTO_RECIPIENTS)
  const analysis = checked.map(recipient => analyzeEmailAddress(recipient.address)).find(Boolean) ?? null
  if (!analysis) {
    result.value = { type: 'invalid' }
    return
  }
  const visitData = await getVisitData(analysis.domain)
  const recipients: EmailRecipientInfo[] = []
  for (const recipient of checked) {
    const recipientAnalysis = analyzeEmailAddress(recipient.address)
    if (!recipientAnalysis)
      continue
    const facts = await getVisitData(recipientAnalysis.domain)
    recipients.push({
      field: recipient.field,
      analysis: recipientAnalysis,
      providerKind: classifyEmailDomain(recipientAnalysis.domain),
      stats: facts.stats,
      isSafe: facts.isSafe,
    })
  }

  if (generation !== checkGeneration)
    return

  result.value = {
    type: 'email',
    analysis,
    params: parsed?.params ?? [],
    providerKind: classifyEmailDomain(analysis.domain),
    mailSites: visitData.mailSites,
    recipients,
    recipientsNotChecked: allRecipients.length - checked.length,
  }
  emit('checkedDomain', analysis.domain, 'email')
}

async function runCheck(rawText: string) {
  const generation = nextCheck()
  const trimmed = rawText.trim()
  if (!trimmed) {
    result.value = null
    return
  }

  // Nothing is classified before the lists are in. A check started in the first
  // moment of the page waits for them rather than answering without them.
  await listsReady
  if (generation !== checkGeneration)
    return

  // The same reading the long-press menu gives a QR payload, which is the point
  // of it being one function: a bare `example.com` is a domain through both
  const { kind, value } = classifyQrPayload(trimmed)
  if (kind === 'url') {
    await checkUrl(value, generation)
  }
  else if (kind === 'email') {
    // Keep the full mailto: string so params get parsed and shown
    await checkEmail(/^mailto:/i.test(trimmed) ? trimmed : value, generation)
  }
  else if (kind !== 'text') {
    if (generation === checkGeneration)
      result.value = { type: 'raw', payloadKind: kind, payload: trimmed }
  }
  else if (generation === checkGeneration) {
    result.value = { type: 'invalid' }
  }
}

function onSubmit() {
  runCheck(inputText.value)
}

async function expandUrl() {
  if (result.value?.type !== 'url' || result.value.resolve.status === 'loading')
    return
  const checked = result.value
  // Read before the loading state overwrites it. Pressed again after an error,
  // this is a retry, and a retry must not hand back the error it just showed.
  const retry = checked.resolve.status === 'error'
  checked.resolve = { status: 'loading' }
  try {
    const resolved = await browser.runtime.sendMessage({
      type: 'resolve-short-url',
      data: { url: checked.url, retry },
    }) as ResolvedUrlResult
    if (result.value !== checked)
      return // a new check replaced this result meanwhile
    if (resolved && resolved.status === 'resolved' && resolved.finalHostname) {
      checked.resolve = {
        status: 'resolved',
        finalHostname: resolved.finalHostname,
        finalUrl: resolved.finalUrl,
        chain: resolved.chain,
      }
      // The real destination is what matters – switch the dashboard to it. Its
      // name and its facts are drawn there, not here.
      emit('checkedDomain', resolved.finalHostname, undefined, resolved.finalUrl)
    }
    else {
      checked.resolve = { status: 'error' }
    }
  }
  catch {
    if (result.value === checked)
      checked.resolve = { status: 'error' }
  }
}

// --- QR image intake: clipboard paste / drag-drop / file picker ---

async function handleImage(blob: Blob) {
  // Claimed before the decode, which is the slow part. A large image dropped on
  // the page used to publish its answer over a question typed after it.
  const generation = nextCheck()
  try {
    const payload = await decodeQrFromImageBitmapSource(blob)
    if (generation !== checkGeneration)
      return
    if (!payload) {
      result.value = { type: 'qr-error' }
      return
    }
    inputText.value = payload
    await runCheck(payload)
  }
  catch {
    if (generation === checkGeneration)
      result.value = { type: 'qr-error' }
  }
}

function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items)
    return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        event.preventDefault()
        handleImage(file)
        return
      }
    }
  }
  // No image – let the text paste proceed normally
}

function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/'))
    handleImage(file)
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    handleImage(file)
  input.value = ''
}

const { statusLabel } = useFamiliarityFacts()

// The same badge as on every other surface, see `statusLabel` for the
// hostnames that are never counted
function statusText(isSafe: boolean, count: number, hostname: string) {
  return statusLabel(isSafe, count, false, { hostname })
}

function payloadTypeLabel(payloadKind: string) {
  const key = `qrType${payloadKind.charAt(0).toUpperCase()}${payloadKind.slice(1)}`
  return t.value(key)
}
</script>

<template>
  <section
    class="vz-card check-field"
    data-check-field
    @paste="onPaste"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <span class="vz-eyebrow">{{ t('checkFieldTitle') }}</span>

    <!-- Aligned to the top rather than the middle, so the buttons stay beside
         the first line of an address instead of sliding down the middle of a
         long one. -->
    <div class="vz-field__row items-start">
      <!-- A box that grows, not a one-line field that scrolls. The whole point
           of this field is to read an address closely, and the part of a long
           URL that matters – where the host ends, what the path really says – is
           exactly the part that had scrolled out of sight. Enter still checks
           rather than opening a second line: nothing here is ever more than one
           address long. The spelling check is off: every domain is a word no
           dictionary has, and a red wave under it reads as the field marking
           the part of the address that is wrong. -->
      <textarea
        ref="checkInput"
        v-model="inputText"
        rows="1"
        spellcheck="false"
        class="vz-input vz-input--addr check-input"
        :placeholder="t('checkFieldPlaceholder')"
        @input="growInput"
        @keydown.enter.prevent="onSubmit"
      />
      <!-- The only name this button had was a `title`, which a touchscreen never
           shows, so it has an aria-label too. `tap-target` grows the hit area
           where the pointer is a finger. -->
      <button
        class="vz-iconbtn vz-iconbtn--outline tap-target"
        :title="t('checkFieldSelectFile')"
        :aria-label="t('checkFieldSelectFile')"
        @click="fileInput?.click()"
      >
        <VzIcon name="qr-code" />
      </button>
      <button class="vz-btn vz-btn--primary" @click="onSubmit">
        {{ t('checkFieldButton') }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelected">
    </div>

    <p class="vz-small">
      {{ t('checkFieldPasteHint') }}
    </p>

    <!-- Results -->
    <div v-if="result" class="check-result">
      <!-- URL / domain -->
      <template v-if="result.type === 'url'">
        <!-- Nothing about the checked name is drawn here while the card below
             is about it: the name, the verdict, the facts, the other spelling,
             the markers, the lookalike line and the lookup links are all the
             card's, drawn once. The field names the host only once the card is
             about another one, after Expand has moved the card on to where the
             link lands and left the pasted name with nobody else to speak for
             it. Its verdict comes with it then, because a link that bounces a
             request on to a real, familiar site would otherwise leave the page
             green all over, with the address that was actually pasted unjudged. -->
        <template v-if="!panelCovers(result.hostname)">
          <div class="flex items-center flex-wrap gap-2">
            <span data-field-hostname class="min-w-0">
              <SecureText :text="result.hostname" size="l" :diff="fieldDiff(result.hostname)">
                <CopyButton :text="result.hostname" />
              </SecureText>
            </span>
            <VzBadge v-if="result.isShortener" tone="danger" icon="alert" data-verdict="shortener">
              {{ t('linkTooltipShortener') }}
            </VzBadge>
            <VzBadge
              v-else
              data-field-verdict
              :tone="statusText(result.isSafe, result.stats.count, result.hostname).tone"
              :icon="statusText(result.isSafe, result.stats.count, result.hostname).icon"
              :data-verdict="statusText(result.isSafe, result.stats.count, result.hostname).verdict"
            >
              {{ statusText(result.isSafe, result.stats.count, result.hostname).text }}
            </VzBadge>
            <RedFlagCount :hostname="result.hostname" :url="result.url" />
          </div>
          <DomainMarkers :hostname="result.hostname" :url="result.url" :familiar="result.isSafe" />
          <LookalikeNotice :hostname="result.hostname" />
        </template>

        <!-- Nobody opens an address domain, so a zero of its own says nothing.
             The visits that mean anything are on the site its mail is read on –
             and they are the ones worth judging, so that site gets the same
             evidence every other check surface shows rather than one number. -->
        <div v-if="result.mailSites.length" class="mail-sites grid gap-2">
          <span class="vz-eyebrow">{{ t('mailSiteLabel') }}</span>
          <div v-for="site in result.mailSites" :key="site.site" class="grid gap-2">
            <SecureText :text="site.site" size="l">
              <CopyButton :text="site.site" />
            </SecureText>
            <FamiliarityFacts :stats="site.stats" />
            <!-- The address domain is a name on an envelope, this is a site
                 somebody actually opens – so it is the one worth looking up -->
            <ExternalLookups :hostname="site.site" />
          </div>
        </div>

        <!-- Expand shortened URL -->
        <button
          v-if="result.resolve.status === 'idle' || result.resolve.status === 'error'"
          class="vz-btn vz-btn--sm justify-self-start"
          data-action="expand"
          @click="expandUrl"
        >
          <VzIcon name="link" />{{ t(result.isShortener ? 'linkResolveKnown' : 'linkResolveTry') }}
        </button>
        <VzNotice v-if="result.resolve.status === 'error'" tone="neutral" bare>
          {{ t('linkTooltipResolveError') }}
        </VzNotice>

        <button v-if="result.resolve.status === 'loading'" class="vz-btn vz-btn--sm justify-self-start" disabled>
          <VzIcon name="pending" />{{ t('linkTooltipResolvingUrl') }}
        </button>

        <div v-if="result.resolve.status === 'resolved'" class="check-resolved">
          <!-- The address only. The site it lands on is the card's now, with its
               name, its facts and its warnings, and printed here as well it
               was one more copy of each. -->
          <p class="vz-small check-url">
            {{ result.resolve.finalUrl }}<CopyButton :text="result.resolve.finalUrl" inline />
          </p>
          <div v-if="result.resolve.chain && result.resolve.chain.length > 2" class="grid gap-1">
            <span class="vz-eyebrow">{{ t('linkTooltipRedirectChain') }} ({{ result.resolve.chain.length }})</span>
            <ol class="check-chain vz-well">
              <li v-for="(hop, i) in result.resolve.chain" :key="i" class="check-url">
                {{ i + 1 }}. {{ hop }}
              </li>
            </ol>
          </div>
        </div>
      </template>

      <!-- Email -->
      <template v-else-if="result.type === 'email'">
        <!-- What the text was read as, and nothing more. The verdict on the
             domain is the card's, and whether it is a public or a throwaway
             provider is said in words by the breakdown below. -->
        <div class="flex items-center flex-wrap gap-2">
          <span class="vz-eyebrow">{{ t('emailTooltipTitle') }}</span>
          <!-- Only where the lines it counts are drawn here, see below -->
          <RedFlagCount v-if="!panelCovers(result.analysis.domain, 'email')" :hostname="result.analysis.domain" context="email" />
        </div>
        <EmailBreakdown
          :analysis="result.analysis"
          :params="result.params"
          :provider-kind="result.providerKind"
          :domain-elsewhere="panelCovers(result.analysis.domain, 'email')"
          case-control
        />

        <!-- A mailto carries a list, cc and bcc included -->
        <MailRecipients :recipients="result.recipients" :not-checked="result.recipientsNotChecked" />

        <!-- The part after the @ is a domain like any other, and an address one
             letter off a provider the user knows is the whole point of checking.
             The checked-domain card below asks that question for this name, in
             the email context, and carries its lookup links, so this block is
             only drawn when the card is about another name. -->
        <template v-if="!panelCovers(result.analysis.domain, 'email')">
          <!-- No `familiar` here: nobody visits an address domain, so there is no
               verdict that could vouch for it, and the platform line stays -->
          <DomainMarkers :hostname="result.analysis.domain" context="email" />
          <LookalikeNotice :hostname="result.analysis.domain" context="email" />
        </template>

        <!-- Nobody opens an address domain, so a zero of its own says nothing.
             The visits that mean anything are on the site its mail is read on –
             and they are the ones worth judging, so that site gets the same
             evidence every other check surface shows rather than one number. -->
        <div v-if="result.mailSites.length" class="mail-sites grid gap-2">
          <span class="vz-eyebrow">{{ t('mailSiteLabel') }}</span>
          <div v-for="site in result.mailSites" :key="site.site" class="grid gap-2">
            <SecureText :text="site.site" size="l">
              <CopyButton :text="site.site" />
            </SecureText>
            <FamiliarityFacts :stats="site.stats" />
            <!-- The address domain is a name on an envelope, this is a site
                 somebody actually opens – so it is the one worth looking up -->
            <ExternalLookups :hostname="site.site" />
          </div>
        </div>

        <!-- After the domain material, because that is the order the reader
             works in: settle the half history can speak for, then look hard at
             the half it cannot -->
        <AddressCompare :address="result.analysis.raw" />

        <!-- Last, because it qualifies everything above it -->
        <EmailCheckCaveat />
      </template>

      <!-- tel: / WIFI: / sms: / geo: payloads -->
      <template v-else-if="result.type === 'raw'">
        <span class="vz-eyebrow">{{ t('qrPayloadType') }}: {{ payloadTypeLabel(result.payloadKind) }}</span>
        <div class="vz-well check-url">
          <SecureText kind="raw" :text="result.payload" size="m">
            <CopyButton :text="result.payload" />
          </SecureText>
        </div>
      </template>

      <!-- Nothing recognized -->
      <VzNotice v-else-if="result.type === 'invalid'" tone="neutral">
        {{ t('checkFieldInvalid') }}
      </VzNotice>

      <!-- QR decode failed. Said as what it is, and not as a warning about any site -->
      <VzNotice v-else-if="result.type === 'qr-error'" tone="neutral">
        {{ t('qrNotFound') }}
      </VzNotice>
    </div>
  </section>
</template>

<style scoped>
.check-field {
  display: grid;
  /* An auto track is as wide as its widest child can get, and the row with the
     field and its two buttons will not go narrower than the field's own default
     width: at a large text size the card spilled out of the page */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}

.check-input {
  /* Below about 14 characters the buttons move under the field rather than
     leaving it too narrow to read an address in */
  flex: 1 1 14em;
  min-width: 0;
  height: auto;
  min-height: calc(var(--control-md) * var(--vz-scale, 1));
  /* Scaled with everything else, so at 70% the field is as tall as the two
     buttons beside it rather than hanging below them */
  padding-top: calc(7px * var(--vz-scale, 1));
  padding-bottom: calc(7px * var(--vz-scale, 1));
  line-height: calc(20px * var(--vz-scale, 1));
  resize: none;
  overflow: hidden;
  overflow-wrap: anywhere;
}

/* The hint stays on one line and is cut short with an ellipsis. Wrapped, its
   second line hid under the foot of a field one line tall, at a larger text
   size or in a narrow window. Typed text still wraps and grows the field. */
.check-input:placeholder-shown {
  white-space: nowrap;
  text-overflow: ellipsis;
}

.check-input::placeholder {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.check-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.check-resolved {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}

.check-url {
  overflow-wrap: anywhere;
}

.check-chain {
  list-style: none;
  display: grid;
  gap: 2px;
  font-size: calc(13px * var(--vz-scale, 1));
  color: var(--ink-2);
}
</style>
