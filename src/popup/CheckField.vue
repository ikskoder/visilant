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
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { belongsToSite, siteDomainOrSelf, visitKey } from '~/logic/domain-boundary'
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
import { isTrackableHostname } from '~/logic/visit-stats'

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
const { isDark } = useTheme()

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

// Visits are stored per record key (see visitKey), but "have I been here" should
// count the whole domain family (gmail.com visits may live under mail.gmail.com)
async function getVisitData(hostname: string): Promise<{ stats: FamiliarityStats, isSafe: boolean, mailSites: MailSiteFamily[] }> {
  const base = siteDomainOrSelf(hostname)
  const allData = await browser.storage.local.get(null)
  const records: SiteVisitData[] = []
  for (const key of Object.keys(allData)) {
    if (key === 'settings' || key === 'customShorteners')
      continue
    if (belongsToSite(key, base))
      records.push(allData[key] as SiteVisitData)
  }
  const stats = aggregateFamiliarityStats(records)
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

// Hostnames without a dot (localhost and the like) are never counted, so their
// zero says "there is no question here", not "you have never been". A red
// "never visited" would be a verdict on the user's own machine.
function statusText(isSafe: boolean, count: number, hostname: string) {
  if (!isTrackableHostname(hostname))
    return { text: t.value('untrackedHostBadge'), class: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  if (isSafe)
    return { text: t.value('linkTooltipFamiliar'), class: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' }
  if (count === 0)
    return { text: t.value('linkTooltipNeverVisited'), class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' }
  return { text: t.value('linkTooltipUnfamiliar'), class: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' }
}

function payloadTypeLabel(payloadKind: string) {
  const key = `qrType${payloadKind.charAt(0).toUpperCase()}${payloadKind.slice(1)}`
  return t.value(key)
}
</script>

<template>
  <div
    class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
    @paste="onPaste"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="text-xs uppercase tracking-wider opacity-50 mb-1.5">
      {{ t('checkFieldTitle') }}
    </div>

    <!-- Aligned to the top rather than the middle, so the buttons stay beside
         the first line of an address instead of sliding down the middle of a
         long one. -->
    <div class="flex gap-1.5 items-start">
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
        class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-sm leading-snug resize-none overflow-hidden break-all focus:outline-none focus:border-blue-400 dark:focus:border-blue-500"
        :placeholder="t('checkFieldPlaceholder')"
        @input="growInput"
        @keydown.enter.prevent="onSubmit"
      />
      <!-- The only name this button had was a `title`, which a touchscreen never
           shows: on a phone it was a 32 px picture of a QR code and nothing
           else. `tap-target` comes from the popup and grows the hit area to
           44 px where the pointer is a finger. -->
      <button
        class="tap-target w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
        :title="t('checkFieldSelectFile')"
        :aria-label="t('checkFieldSelectFile')"
        @click="fileInput?.click()"
      >
        <div i-carbon-qr-code />
      </button>
      <button
        class="px-3 h-8 flex-shrink-0 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm transition-colors"
        @click="onSubmit"
      >
        {{ t('checkFieldButton') }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelected">
    </div>

    <div class="text-[11px] opacity-40 mt-1">
      {{ t('checkFieldPasteHint') }}
    </div>

    <!-- Results -->
    <div v-if="result" class="mt-2">
      <!-- URL / domain -->
      <template v-if="result.type === 'url'">
        <!-- Nothing about the checked name is drawn here while the card below
             is about it: the name, the verdict, the facts, the other spelling,
             the markers, the lookalike line and the lookup links are all the
             card's, drawn once. Each of them used to be printed here as well,
             so one screen said everything twice. The field names the host only
             once the card is about another one, after Expand has moved the card
             on to where the link lands and left the pasted name with nobody
             else to speak for it. Its verdict comes with it then, because a
             link that bounces a request on to a real, familiar site would
             otherwise leave the page green all over, with the address that was
             actually pasted unjudged. -->
        <template v-if="!panelCovers(result.hostname)">
          <div class="flex items-center flex-wrap gap-1.5 mb-1">
            <span data-field-hostname class="font-medium break-words secure-domain-display">
              <SecureText :text="result.hostname" />
            </span>
            <span v-if="result.isShortener" class="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
              {{ t('linkTooltipShortener') }}
            </span>
            <span v-else data-field-verdict class="text-xs px-1.5 py-0.5 rounded" :class="statusText(result.isSafe, result.stats.count, result.hostname).class">
              {{ statusText(result.isSafe, result.stats.count, result.hostname).text.toLowerCase() }}
            </span>
          </div>
          <DomainMarkers :hostname="result.hostname" :url="result.url" />
          <LookalikeNotice :hostname="result.hostname" />
        </template>

        <!-- Nobody opens an address domain, so a zero of its own says nothing.
             The visits that mean anything are on the site its mail is read on –
             and they are the ones worth judging, so that site gets the same
             evidence every other check surface shows rather than one number. -->
        <div v-if="result.mailSites.length" class="mail-sites mb-1">
          <span class="opacity-60">{{ t('mailSiteLabel') }}:</span>
          <div v-for="site in result.mailSites" :key="site.site" class="mt-0.5">
            <!-- Same weight as the address halves above: this is the other name
                 the reader is here to look at, not a caption on the table -->
            <div class="font-bold text-[1.3em] leading-tight break-all">
              <SecureText :text="site.site" :force-highlight="true" :danger-only="true" />
            </div>
            <FamiliarityFacts :stats="site.stats" class="mt-0.5" />
            <!-- The address domain is a name on an envelope, this is a site
                 somebody actually opens – so it is the one worth looking up -->
            <ExternalLookups :hostname="site.site" />
          </div>
        </div>

        <!-- Expand shortened URL -->
        <button
          v-if="result.resolve.status === 'idle' || result.resolve.status === 'error'"
          class="mt-1 px-3 py-1 rounded-lg border text-xs transition-colors"
          :class="result.isShortener
            ? 'bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-700/60 dark:hover:bg-orange-600/60 dark:text-orange-100 dark:border-orange-700/50'
            : 'bg-gray-100 hover:bg-gray-200 text-gray-600 border-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 dark:border-gray-600'"
          @click="expandUrl"
        >
          {{ t('checkFieldExpand') }}
        </button>
        <div v-if="result.resolve.status === 'error'" class="text-xs opacity-60 mt-1">
          {{ t('linkTooltipResolveError') }}
        </div>

        <div v-if="result.resolve.status === 'loading'" class="flex items-center gap-2 mt-1 text-xs opacity-70">
          <div class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          {{ t('linkTooltipResolvingUrl') }}
        </div>

        <div v-if="result.resolve.status === 'resolved'" class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <!-- The address only. The site it lands on is the card's now, with its
               name, its facts and its warnings, and printed here as well it
               was one more copy of each. -->
          <div class="text-xs opacity-60 break-all mb-1">
            {{ result.resolve.finalUrl }}
          </div>
          <div v-if="result.resolve.chain && result.resolve.chain.length > 2" class="text-xs opacity-70">
            <div class="opacity-70 mb-0.5">
              {{ t('linkTooltipRedirectChain') }} ({{ result.resolve.chain.length }})
            </div>
            <div v-for="(hop, i) in result.resolve.chain" :key="i" class="break-all">
              {{ i + 1 }}. {{ hop }}
            </div>
          </div>
        </div>
      </template>

      <!-- Email -->
      <template v-else-if="result.type === 'email'">
        <!-- What the text was read as, and nothing more. The verdict on the
             domain is the card's, and whether it is a public or a throwaway
             provider is said in words by the breakdown below. -->
        <div class="text-xs opacity-50 mb-1">
          {{ t('emailTooltipTitle') }}
        </div>
        <EmailBreakdown
          :analysis="result.analysis"
          :params="result.params"
          :provider-kind="result.providerKind"
          :is-dark="isDark"
          :domain-elsewhere="panelCovers(result.analysis.domain, 'email')"
          case-control
        />

        <!-- A mailto carries a list, cc and bcc included -->
        <MailRecipients :recipients="result.recipients" :not-checked="result.recipientsNotChecked" :is-dark="isDark" />

        <!-- The address domain's own facts are in the checked-domain card below,
             once. A mail site further down keeps its own, because that is a
             different name and no other block on the page carries it. -->
        <!-- The part after the @ is a domain like any other, and an address one
             letter off a provider the user knows is the whole point of checking.
             The checked-domain card below asks that question for this name, in
             the email context, and carries its lookup links, so this block is
             only drawn when the card is about another name. -->
        <div v-if="!panelCovers(result.analysis.domain, 'email')" class="mt-1">
          <DomainMarkers :hostname="result.analysis.domain" context="email" />
          <LookalikeNotice :hostname="result.analysis.domain" context="email" />
        </div>

        <!-- Nobody opens an address domain, so a zero of its own says nothing.
             The visits that mean anything are on the site its mail is read on –
             and they are the ones worth judging, so that site gets the same
             evidence every other check surface shows rather than one number. -->
        <div v-if="result.mailSites.length" class="mail-sites mt-1">
          <span class="opacity-60">{{ t('mailSiteLabel') }}:</span>
          <div v-for="site in result.mailSites" :key="site.site" class="mt-0.5">
            <!-- Same weight as the address halves above: this is the other name
                 the reader is here to look at, not a caption on the table -->
            <div class="font-bold text-[1.3em] leading-tight break-all">
              <SecureText :text="site.site" :force-highlight="true" :danger-only="true" />
            </div>
            <FamiliarityFacts :stats="site.stats" class="mt-0.5" />
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
        <div class="text-xs opacity-50 mb-1">
          {{ t('qrPayloadType') }}: {{ payloadTypeLabel(result.payloadKind) }}
        </div>
        <div class="text-sm p-2 rounded bg-gray-100 dark:bg-gray-900 break-all">
          <SecureText :text="result.payload" :force-highlight="true" :danger-only="true" :preserve-case="true" />
        </div>
      </template>

      <!-- Nothing recognized -->
      <div v-else-if="result.type === 'invalid'" class="text-xs opacity-60">
        {{ t('checkFieldInvalid') }}
      </div>

      <!-- QR decode failed -->
      <div v-else-if="result.type === 'qr-error'" class="text-xs text-red-500 dark:text-red-400">
        {{ t('qrNotFound') }}
      </div>
    </div>
  </div>
</template>
