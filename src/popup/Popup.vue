<script setup lang="ts">
import type { DomainMetric, MetricReading } from '~/logic/domain-metric'
import type { SiteVisitData } from '~/logic/storage'
import punycode from 'punycode'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { belongsToSite, siteDomainOrSelf, visitKey } from '~/logic/domain-boundary'
import { displayDomain } from '~/logic/domain-display'
import { DOMAIN_METRICS, metricReading, metricSortValue } from '~/logic/domain-metric'
import { aggregateFamiliarityStats, isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { getPunycodeInfo } from '~/logic/link-safety'
import { applyListChanges } from '~/logic/list-sync'
import { isolatePageZoom } from '~/logic/page-zoom'
import { popupWidthCap } from '~/logic/platform'
import { STORAGE_KEY_REMOTE_SHORTENERS } from '~/logic/shortener-lists'
import { editSettingsThroughBackground, settings } from '~/logic/storage'
import { isShortenedUrl, loadShortenersFromStorage } from '~/logic/url-shorteners'
import { classifyHost, isTrackableHostname, untrackedReason } from '~/logic/visit-stats'
import Logo from '../components/Logo.vue'
import SecureText from '../components/SecureText.vue'
import CheckField from './CheckField.vue'

const { t, isLoaded, loadedTranslations } = useI18n()
useTheme()

// The sort order, the case of the names, the punycode toggle: small edits, sent
// to the background like every other. Written from here they carried the rest of
// the settings as this window read them, which for a window left open is a copy
// from before whatever was changed in the settings page since.
editSettingsThroughBackground()

// Reactive translations
const translations = ref<Record<string, string>>({})

// Function to update translations
function updateTranslations() {
  if (!isLoaded.value)
    return

  const translationKeys = [
    'currentDomain',
    'checkedDomain',
    'currentAddress',
    'checkedAddress',
    'baseDomain',
    'relatedDomains',
    'familySummaryTitle',
    'familyOnlyCheckedDomain',
    'familyOnlyCurrentDomain',
    'shortenerHostNotice',
    'listNumberLabel',
    'listSortLabel',
    'sortByName',
    'sortToName',
    'sortToNumber',
    'sortOrderToAsc',
    'sortOrderToDesc',
    'domainOriginal',
    'domainPunycode',
    'punycodeHelpTitle',
    'punycodeHelpContent',
    'current',
    'noVisitData',
    'visitWebsite',
    'settings',
    'antiTamperingProtected',
    'antiTamperingNotProtected',
    'antiTamperingParentRule',
    'ignoredSiteNotice',
    'ignoredSiteResume',
    'ignoredSiteSilence',
    'ignoredSiteTooltip',
    'warningsActiveNotice',
    'warningsActiveTooltip',
    'antiTamperingDisableForSite',
    'antiTamperingEnableForSite',
    'antiTamperingTooltipWhat',
    'antiTamperingTooltipOn',
    'antiTamperingTooltipOff',
    'checkExternalButton',
    'firstVisitOn',
    'statsUnknown',
    'statsImportHint',
    'externalLookupsTitle',
    'untrackedHostTitle',
    'untrackedHostText',
    'untrackedIpTitle',
    'untrackedIpText',
    'familiarityRequiredAtLeast',
    'familiarityDaysUnit',
    // The metric chips are named after the checks themselves – these are the
    // same four facts the badge can draw, not a second vocabulary for them
    'familiarityVisits',
    'familiarityActiveDays',
    'familiarityAge',
    'badgeContentChecks',
  ]

  const newTranslations: Record<string, string> = {}
  for (const key of translationKeys) {
    newTranslations[key] = t.value(key)
  }
  translations.value = newTranslations
}

// Update translations when language changes or when translations are loaded
watch([loadedTranslations, isLoaded], () => {
  updateTranslations()
}, { immediate: true })

// The cap the popup column is held to, read from the screen rather than from
// the viewport – see popupWidthCap.
//
// Re-read on resize, because the Android panel outlives a rotation: a cap taken
// in landscape and kept through the turn is wider than the portrait display it
// then has to fit in, and one taken in portrait leaves most of a landscape
// screen unused. Reading the screen rather than the viewport is also what makes
// listening safe – the popup resizing itself cannot change the answer, so there
// is no loop of the kind the desktop popup would otherwise fall into.
const widthCap = ref(popupWidthCap())
const popupMaxWidth = computed(() =>
  Number.isFinite(widthCap.value) ? `${widthCap.value}px` : undefined)

function refreshWidthCap() {
  widthCap.value = popupWidthCap()
}

const isStandalonePage = ref(false)

/**
 * The "check anything" page, as opposed to the details page for one domain.
 *
 * The two are both standalone, and they differ in where the domain on screen
 * came from: the details page was opened about a site the reader was just
 * looking at, while here they typed or pasted a name into a field.
 */
const isCheckPage = ref(false)
// What the check page starts with, when it was opened about something
const checkPageInitial = ref('')
// The same document serves as the browser's own popup and, opened by URL, as an
// ordinary tab. In a tab it should behave like a page: use the whole window and
// scroll. tabs.getCurrent() is what tells the two apart, resolving to undefined
// inside a popup, and it must not become a width guess: the popup window sizes
// itself to the document, so a full-width column there would collapse it.
const isTabView = ref(false)
// Layout follows the container, wording follows the query string, so the two
// are kept apart on purpose
const isPageView = computed(() => isStandalonePage.value || isTabView.value)
const currentHostname = ref('')
/**
 * How the name was met. Set to `email` when the check field handed over the
 * part after an @, so the card compares it against the mail providers as well,
 * which is the question the field asked before the card took the line over.
 */
const currentContext = ref<'email' | undefined>()
/**
 * The whole link, when the name came out of one on the check page. Only for
 * what the link says beyond its host – a name hidden before an @ – so the card
 * carries that warning too and the field above it needs to draw nothing.
 */
const currentUrl = ref<string | undefined>()
/**
 * The record this host's figures are kept under. The heading keeps the name as
 * the address bar has it, but `www.example.com` and `example.com` are one
 * record – see visitKey – so every lookup and every "is this the current host"
 * compares this instead.
 */
const currentKey = computed(() => currentHostname.value ? visitKey(currentHostname.value) : '')
const baseDomain = ref('')
const visits = ref<Record<string, any>>({})
/**
 * Every recorded host under the base domain, this one among them.
 *
 * Not "subdomains", which is what this was called and what the list above it
 * was headed: the base domain sits in here and is nobody's subdomain, the depth
 * is not limited to one, and the address the window is about is in here too.
 */
const familyHosts = ref<string[]>([])
const showPunycodeHelp = ref(false)

const unicodeHostname = computed(() => {
  if (!currentHostname.value)
    return ''
  return punycode.toUnicode(currentHostname.value)
})

/**
 * The name as the browser sends it. Not always the one on screen: an email
 * domain arrives in the letters it was typed in, and only a link's host comes
 * already converted.
 */
const asciiHostname = computed(() => getPunycodeInfo(currentHostname.value).ascii ?? currentHostname.value)

/**
 * Whether suspicious characters in the name are marked even with highlighting
 * switched off. For an address domain, which the check field used to draw that
 * way before the card took it over: nobody visits an address domain, so it has
 * no history to vouch for its letters.
 */

const isPunycode = computed(() => {
  return asciiHostname.value !== unicodeHostname.value
})

/**
 * The rest of the family – every recorded host under the base domain except the
 * one this window is already about.
 *
 * The list and its total are drawn only when this is not empty. A single row
 * repeating the address at the top of the panel, under a heading and beside a
 * total that equals the number already shown there, is the same fact written
 * three times.
 */
const otherFamilyHosts = computed(() =>
  familyHosts.value.filter(domain => domain !== currentKey.value))

const showFamily = computed(() => otherFamilyHosts.value.length > 0)

/**
 * The line drawn where the family's figures would be.
 *
 * With this host the only one on record, the fold is the card above number for
 * number and is left out, but a card with a name and no figures read as if the
 * figures had been forgotten. It names that card by its heading rather than by
 * the address, so the wording follows the heading from page to popup.
 */
const onlyThisHostText = computed(() => isStandalonePage.value
  ? translations.value.familyOnlyCheckedDomain
  : translations.value.familyOnlyCurrentDomain)

/**
 * Whether the base domain gets a card of its own.
 *
 * Two separate reasons for it, and either is enough. A subdomain was checked, so
 * the name it sits under is worth spelling out and worth offering the lookups
 * for – the check field used to print that name in a line of its own and no
 * longer does. Or there is a family, whose figures belong under the base
 * domain's name rather than under one member's.
 *
 * The figures inside it follow the second reason only: with no other host
 * recorded, the family is this host and its row would repeat the card above it.
 */
const showBaseDomainCard = computed(() =>
  Boolean(baseDomain.value) && (baseDomain.value !== currentKey.value || showFamily.value))

// Hostnames without a dot (localhost, a machine name on the local network) are
// never counted, so their zero is not a fact about the user. Showing it as a red
// 0 would accuse a machine on their own desk of being unfamiliar, and no amount
// of visiting could ever clear it. Say plainly that nothing is counted instead.
const isUntrackedHost = computed(() => {
  return Boolean(currentHostname.value) && !isTrackableHostname(currentHostname.value)
})
const untrackedIsIp = computed(() => untrackedReason(currentHostname.value) === 'ip')
/** An IP address is not a domain, so the card is not headed as one. */
const isIpHost = computed(() => ['ipv4', 'ipv6', 'private-ip'].includes(classifyHost(currentHostname.value)))

/**
 * This exact host's own record, and nothing borrowed.
 *
 * It used to fall back to the family whenever the host had no record of its own,
 * which kept a details page from showing nothing – but it also meant the number
 * under a hostname was sometimes the family's and sometimes the host's, with
 * only a caption to say which. Two of them then sat on one screen: the check
 * field above folds the family, so `Visits 5` and `Visits 2` appeared forty
 * pixels apart under names that looked like the same name.
 *
 * The family's figures did not go away – they are drawn under the base domain
 * now, which is the name they are actually about. So this one can say the plain
 * truth about the host it names, zero included.
 */
const currentStats = computed<SiteVisitData | undefined>(() => {
  const own = visits.value[currentKey.value]
  if (own)
    return own

  // A host nothing is counted for has its own notice, and a red 0 under it would
  // accuse a machine on the user's desk of being unfamiliar for ever
  return isUntrackedHost.value || !currentHostname.value ? undefined : { count: 0, lastSeen: 0 }
})

/**
 * Everything recorded under the base domain, folded the way a verdict folds it.
 *
 * This is what a check's verdict is decided on – "have I been here" is one
 * question about `example.com` and `mail.example.com` – so the evidence for it
 * belongs under the base domain's own name rather than under one subdomain's.
 */
const familyStats = computed(() => {
  const records = familyHosts.value.map(domain => visits.value[domain]).filter(Boolean)
  return records.length ? aggregateFamiliarityStats(records) : undefined
})

/**
 * Whether the user has silenced the warnings for this exact host.
 *
 * There was a command to set this and nothing at all to unset it: "do not show
 * again" was a one-way door, and the only way back was to delete every visit
 * record in the profile. A security exception you cannot see and cannot undo is
 * worse than no exception at all.
 */
const isIgnoredHost = computed(() => {
  const host = currentKey.value
  return Boolean(host && (visits.value[host] as SiteVisitData | undefined)?.ignored)
})

/**
 * Turning the warnings for this host off and back on.
 *
 * Off used to be a button inside the warning itself, on the page the warning
 * was about. A page cannot press it – the in-page UI is in a closed shadow root
 * – but it does not have to: writing "press Don't show again to continue" next
 * to it was enough, and one honest click silenced the guard on the attacker's
 * own hostname for good. Here the page has no such reach. It cannot draw in
 * this window, script it, or know it was opened, and the name being silenced is
 * the one this window spells out rather than the one the page claims.
 */
async function setWarnings(ignored: boolean) {
  const host = currentHostname.value
  const context = currentContext.value
  const url = currentUrl.value
  if (!host)
    return

  await browser.runtime.sendMessage({ type: 'ignore-site', data: { hostname: host, ignored } })
  await loadDomainData(host, context, url)
}

const familiarityRules = computed(() => normalizeFamiliarity(settings.value.familiarity))

/**
 * Whether a warning could fire on this page at all.
 *
 * Drawn from the record for this exact hostname, never from the family: the
 * content script judges the host it is on, so borrowing the family's verdict
 * here would take the switch away from a page that is about to warn.
 *
 * An address that is never counted is safe by the same rule the content script
 * uses: a zero that can never move would otherwise warn about the router's own
 * page forever.
 */
const warningsCanFire = computed(() => {
  if (!currentHostname.value || isUntrackedHost.value)
    return false

  return !isFamiliar(visits.value[currentKey.value] ?? { count: 0 }, familiarityRules.value)
})

/**
 * Whether the warnings row is worth its line.
 *
 * On a familiar site there is nothing to silence: no warning fires there, so a
 * switch offering to turn one off promises a guard that was never posted. It
 * comes back the moment the site stops passing the checks – by the bar being
 * raised, or by the visits being reset.
 *
 * A silenced site keeps the row whatever its verdict, and that is the important
 * half: this window is the only place an exception can be lifted, and one that
 * cannot be seen or undone is worse than no exception at all. The check page
 * has no site of its own, so it has neither.
 */
const showWarningsRow = computed(() =>
  !isCheckPage.value && (isIgnoredHost.value || warningsCanFire.value))

// A long hostname cannot fit at the headline size. Stepping the size down keeps
// it to one or two lines instead of breaking a label apart, which is exactly
// what someone reading a suspicious address must not have to untangle. Absent,
// the address keeps its own `address-xl`.
/**
 * The text size the popup is drawn at. Below 80% the smallest labels fall to
 * about 9px, too small to read, so a size saved under the old 70% floor is
 * drawn at 80% rather than kept.
 */
const TEXT_SIZE_MIN = 80
const TEXT_SIZE_MAX = 150
const textSize = computed(() => Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, settings.value.popupFontSize || 100)))

const currentDomainFontSize = computed(() => {
  const length = Math.max(asciiHostname.value.length, unicodeHostname.value.length)
  const size = length <= 24 ? undefined : length <= 34 ? 22 : length <= 46 ? 18 : 15
  return size === undefined
    ? undefined
    : { fontSize: `calc(${size}px * var(--vz-scale, 1))`, lineHeight: '1.5' }
})

function formatTimestamp(timestamp?: number) {
  if (!timestamp)
    return ''
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const METRIC_LABEL_KEYS: Record<DomainMetric, string> = {
  visits: 'familiarityVisits',
  activeDays: 'familiarityActiveDays',
  age: 'familiarityAge',
  checks: 'badgeContentChecks',
}

function metricLabel(metric: DomainMetric) {
  return translations.value[METRIC_LABEL_KEYS[metric]]
}

/**
 * The number drawn beside each host.
 *
 * One chip row, two questions kept apart: these chips say what the column
 * holds, and the two buttons at the end of the row say what order it is in.
 * They were one control, with `name` among the chips – so choosing alphabetical
 * order also had to choose a number, and the only answer available was to drop
 * whatever the reader had picked and go back to visits. Now ordering by name
 * leaves the column exactly as it was.
 */
const listMetric = computed<DomainMetric>(() => settings.value.listMetric || 'visits')

function readingFor(domain: string): MetricReading {
  return metricReading(listMetric.value, visits.value[domain] ?? { count: 0 }, familiarityRules.value)
}

const sortedFamilyHosts = computed(() => {
  const domains = [...familyHosts.value]

  const order = settings.value.sortOrder || 'desc'
  const multiplier = order === 'asc' ? 1 : -1

  if (settings.value.sortByName)
    return domains.sort((a, b) => a.localeCompare(b) * multiplier)

  return domains.sort((a, b) => {
    const valueA = metricSortValue(readingFor(a))
    const valueB = metricSortValue(readingFor(b))
    if (valueA !== valueB)
      return (valueA - valueB) * multiplier

    // Fallback to name where the metric cannot separate them
    return a.localeCompare(b)
  })
})

/**
 * A reading as it should read, in a column three characters wide.
 *
 * Bare numbers: the chip above the list names the fact, and repeating "days" on
 * every row of a column that holds nothing else says it a dozen times over.
 * Checks are the exception, since what they are out of is part of the number –
 * the same way the badge draws them.
 */
function readingText(reading: MetricReading) {
  if (reading.value === undefined)
    return translations.value.statsUnknown

  return reading.outOf === undefined ? String(reading.value) : `${reading.value} / ${reading.outOf}`
}

/** The date an age reading was measured from, which the number alone does not say. */
function readingTitle(reading: MetricReading) {
  return reading.firstSeen ? `${translations.value.firstVisitOn} ${formatTimestamp(reading.firstSeen)}` : undefined
}

// One convention across the whole row: a button always shows the state it is in,
// never the state a click would take you to. The sort arrow and the rainbow
// already did, but the case and format buttons showed the opposite, so `AA` meant
// "currently lowercase" and read as the exact reverse of what it looked like.
//
// The tooltips complete it by naming the action, since a button that only shows
// its state does not say what pressing it does.
const sortOrderTitle = computed(() => settings.value.sortOrder === 'asc'
  ? translations.value.sortOrderToDesc
  : translations.value.sortOrderToAsc)

/** Alphabetical, or by whichever number the chips have put in the column. */
const sortByNameTitle = computed(() => settings.value.sortByName
  ? translations.value.sortToNumber
  : translations.value.sortToName)

function toggleSortOrder() {
  settings.value.sortOrder = settings.value.sortOrder === 'asc' ? 'desc' : 'asc'
}

function toggleSortByName() {
  settings.value.sortByName = !settings.value.sortByName
}

function setListMetric(metric: DomainMetric) {
  settings.value.listMetric = metric
}

function onListMetricChange(event: Event) {
  setListMetric((event.target as HTMLSelectElement).value as DomainMetric)
}

/**
 * Get out of the way once the user has been sent somewhere else.
 *
 * A desktop popup closes itself the moment focus leaves it, so this is a no-op
 * there. The Android popup is a panel rather than a window: it stays on top of
 * the tab it just opened, and the destination is invisible until it is
 * dismissed by hand. Skipped in the page view, where this document is the tab
 * itself and closing it would take the user's own tab down.
 */
function leaveForOpenedTab() {
  if (!isPageView.value)
    window.close()
}

async function openOptionsPage() {
  await browser.runtime.openOptionsPage()
  leaveForOpenedTab()
}

function excludedDomains(): string[] {
  return (settings.value.antiTamperingExcludedDomains || '')
    .split(/\n/)
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * The line in the exclusion list that this host is off by, if any.
 *
 * Kept as the rule rather than as a yes or no, because that is what the switch
 * has to remove. `sub.example.com` is excluded by a line reading `example.com`,
 * and Enable used to look for a line reading `sub.example.com` – which is not
 * there. Nothing was removed, the switch flipped back, and the site stayed
 * unprotected with no way to say otherwise from here.
 */
const antiTamperingRule = computed(() => {
  const hostname = currentHostname.value?.toLowerCase()
  if (!hostname)
    return null

  return excludedDomains().find(domain => hostname === domain || hostname.endsWith(`.${domain}`)) ?? null
})

const isAntiTamperingExcluded = computed(() => antiTamperingRule.value !== null)

/** Whether the rule that covers this host is a parent domain rather than the host. */
const antiTamperingRuleIsParent = computed(() =>
  antiTamperingRule.value !== null && antiTamperingRule.value !== currentHostname.value?.toLowerCase())

function toggleAntiTampering() {
  const hostname = currentHostname.value
  if (!hostname)
    return

  const excluded = excludedDomains()
  const lowerHostname = hostname.toLowerCase()
  const rule = antiTamperingRule.value

  if (rule) {
    // The line that actually covers this host, which for a subdomain is the
    // parent's. Removing it puts protection back on every host under it, and
    // the line below the switch says so before it is pressed.
    settings.value.antiTamperingExcludedDomains = excluded.filter(d => d !== rule).join('\n')
  }
  else {
    excluded.push(lowerHostname)
    settings.value.antiTamperingExcludedDomains = excluded.join('\n')
  }
}

/**
 * The colour a number carries: its own check, never the whole verdict.
 *
 * The visit count used to be painted by `isFamiliar`, which is the answer to a
 * different question and reads as a lie next to the number it is painting:
 * under "at least 2 of 3", three visits against a bar of ten came out green
 * because the two date checks passed, and under "all", fifty visits came out
 * red because the site was first seen yesterday. Every fact in this panel is
 * coloured by the check it belongs to, so no two of them answer different
 * questions in the same colour.
 *
 * Uncoloured when that check is switched off, since a number with no say in the
 * verdict has no business being tinted as though it had one.
 */
async function loadDomainData(hostname: string, context?: 'email', url?: string) {
  currentHostname.value = hostname
  // Before anything is awaited, so the card never asks about the new name in
  // the old name's context
  currentContext.value = context
  currentUrl.value = url
  // An IP address and an intranet name have no site to belong to, so each is a
  // family of one. Leaving this empty used to hide a record that plainly exists:
  // the page had visits stored under `192.168.1.10` and showed nothing at all.
  baseDomain.value = siteDomainOrSelf(hostname)
  visits.value = {}
  familyHosts.value = []

  if (!baseDomain.value)
    return

  const allData = await browser.storage.local.get(null)

  const matched: string[] = []
  for (const key of Object.keys(allData)) {
    if (key === 'settings')
      continue

    if (belongsToSite(key, baseDomain.value)) {
      matched.push(key)
      visits.value[key] = allData[key]
    }
  }

  // Sort: current hostname first, then alphabetical
  const own = visitKey(hostname)
  familyHosts.value = matched.sort((a, b) => {
    if (a === own)
      return -1
    if (b === own)
      return 1
    return a.localeCompare(b)
  })
}

async function openCheckPage() {
  await browser.tabs.create({ url: browser.runtime.getURL('dist/popup/index.html?check=1') })
  leaveForOpenedTab()
}

// The browser popup sizes itself to its content and must not scroll. The same
// document opened as a tab is an ordinary page, so it has to – a long list of
// related domains would otherwise be cut off with no way to reach the rest.
watch(isPageView, (pageView) => {
  document.documentElement.classList.toggle('standalone-page', pageView)
}, { immediate: true })

/**
 * Bumped whenever the shortener lists change under this window.
 *
 * The lists are plain module sets, not reactive, so a computed reading them
 * needs something that is. The toolbar popup had no list at all – only the check
 * field loaded one – and a host the user had marked as a shortener carried no
 * sign of it here.
 */
const shortenerListsVersion = ref(0)

const isShortenerHost = computed(() => {
  void shortenerListsVersion.value
  return Boolean(currentHostname.value) && isShortenedUrl(currentHostname.value)
})

/**
 * What the lists say about this host, drawn with the structural markers.
 *
 * A shortener keeps its figures, since somebody who uses one every day may want
 * to know it is the same site. They say nothing about where its links lead,
 * though, and a count drawn over one without a word reads as if they did.
 */
const hostNotes = computed(() => isShortenerHost.value
  ? [{ id: 'shortener', text: translations.value.shortenerHostNotice, icon: 'link' as const }]
  : [])

const SHORTENER_KEYS = new Set(['customShorteners', STORAGE_KEY_REMOTE_SHORTENERS])

function onShortenerListChange(changes: Record<string, { newValue?: unknown }>, area: string) {
  if (area !== 'local' || !Object.keys(changes).some(key => SHORTENER_KEYS.has(key)))
    return
  applyListChanges(changes)
  shortenerListsVersion.value += 1
}

onMounted(async () => {
  window.addEventListener('resize', refreshWidthCap)
  browser.storage.onChanged.addListener(onShortenerListChange)
  await loadShortenersFromStorage()
  shortenerListsVersion.value += 1
})

onUnmounted(() => {
  window.removeEventListener('resize', refreshWidthCap)
  browser.storage.onChanged.removeListener(onShortenerListChange)
})

onMounted(async () => {
  // Settled before anything can return early, since the whole layout hangs on
  // it. Guarded because this decides a margin, and nothing about a margin is
  // worth losing the dashboard over: without an answer, stay the popup.
  try {
    isTabView.value = Boolean(await browser.tabs.getCurrent())
  }
  catch {
    isTabView.value = false
  }

  // Only does anything in a tab, and keeps a zoom set here from reaching the
  // popup, where a fixed-width column in a resized window just looks broken
  isolatePageZoom()

  // Check if opened with a domain query param (from tooltip "Details" button or context menu)
  const urlParams = new URLSearchParams(window.location.search)
  const domainParam = urlParams.get('domain')

  if (domainParam) {
    isStandalonePage.value = true
    await loadDomainData(domainParam)
    return
  }

  // Standalone "check anything" page opened from the popup button
  if (urlParams.get('check')) {
    isStandalonePage.value = true
    isCheckPage.value = true
    // Opened from the long-press menu on a mailto with several recipients:
    // the address list travels with the link, not as a single domain
    checkPageInitial.value = urlParams.get('value') ?? ''
    return
  }

  // Default: use active tab's domain
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  if (tabs.length > 0 && tabs[0].url) {
    try {
      const url = new URL(tabs[0].url)
      if (!url.protocol.startsWith('http'))
        return
      await loadDomainData(url.hostname)
    }
    catch (e) {
      console.error('Invalid URL', e)
    }
  }
})
</script>

<template>
  <!-- items-start: a flex child stretches to the full height by default, and the
       grid inside then shares the empty space out between its rows -->
  <div :class="isStandalonePage ? 'min-h-screen flex justify-center items-start bg-bg py-8 px-4' : ''">
    <!-- The 600px column is the desktop popup, whose window sizes itself to the
         document. Firefox for Android has no such window – the popup is a panel
         the width of the screen, so the column has to be capped at the display
         or the whole dashboard hangs off the right edge -->
    <!-- The same margin at the sides and at the foot, so the last block on the
         page sits as far from the bottom edge as it does from the left one. What
         separates the blocks from one another is the gap of the column, so no
         block has to remember whether something follows it. -->
    <main
      class="popup-main relative"
      :class="isStandalonePage
        ? 'w-full max-w-[600px] vz-card'
        : (isTabView ? 'w-full' : 'w-[600px]')"
      :style="{
        'fontSize': `${textSize}%`,
        '--vz-scale': textSize / 100,
        ...(isPageView ? {} : { maxWidth: popupMaxWidth }),
      }"
    >
      <header class="popup-header">
        <Logo class="popup-logo" />
        <div class="flex items-center gap-2 flex-wrap justify-end">
          <!-- How an address is drawn. Here rather than by the related-domain
               list, which is not on screen at all until a site has visits – and the
               check page, where somebody is reading an address they do not
               know, is exactly where they are worth reaching -->
          <DomainDisplayToggles />
          <!-- Text size, with the gear kept beside it: when the row wraps at a
               large size on a phone, the gear alone on a third line looked lost.
               The readout between the two is not a toggle, it only says where
               the size stands -->
          <div class="flex items-center gap-2">
            <div class="vz-toggles" role="group" :aria-label="t('popupTextSize')">
              <button
                class="vz-toggle tap-target"
                :title="t('popupTextSmaller')"
                :aria-label="t('popupTextSmaller')"
                :disabled="textSize <= TEXT_SIZE_MIN"
                @click="settings.popupFontSize = Math.max(TEXT_SIZE_MIN, textSize - 10)"
              >
                A−
              </button>
              <span class="popup-size-readout">{{ textSize }}%</span>
              <button
                class="vz-toggle tap-target"
                :title="t('popupTextLarger')"
                :aria-label="t('popupTextLarger')"
                :disabled="textSize >= TEXT_SIZE_MAX"
                @click="settings.popupFontSize = Math.min(TEXT_SIZE_MAX, textSize + 10)"
              >
                A+
              </button>
            </div>
            <button class="vz-iconbtn tap-target" :title="translations.settings" :aria-label="translations.settings" @click="openOptionsPage">
              <VzIcon name="settings" />
            </button>
          </div>
        </div>
      </header>

      <!-- In the popup, a button opening the full check page. On the standalone page, the field itself -->
      <button
        v-if="!isStandalonePage"
        class="vz-btn vz-btn--block"
        @click="openCheckPage"
      >
        <VzIcon name="qr-code" />
        {{ translations.checkExternalButton }}
      </button>
      <CheckField
        v-else
        :initial="checkPageInitial"
        :panel-hostname="currentHostname"
        :panel-context="currentContext"
        @checked-domain="loadDomainData"
      />

      <template v-if="currentHostname">
        <section data-domain-panel class="vz-card popup-card">
          <span class="vz-eyebrow">
            {{ isIpHost
              ? (isStandalonePage ? translations.checkedAddress : translations.currentAddress)
              : (isStandalonePage ? translations.checkedDomain : translations.currentDomain) }}
          </span>
          <!-- The address gets the whole width. The visit count used to sit at
               the right of this line, where it was the same number the facts
               below already give – in a column that says which check it belongs
               to and how far it is from the bar, which a lone figure beside the
               hostname never did. -->
          <div class="popup-address">
            <template v-if="isPunycode">
              <span class="vz-eyebrow">{{ translations.domainOriginal }}</span>
              <SecureText :text="unicodeHostname" size="xl" :style="currentDomainFontSize" />
              <div class="flex items-center gap-1 mt-2">
                <span class="vz-eyebrow">{{ translations.domainPunycode }}</span>
                <button
                  class="vz-iconbtn vz-iconbtn--sm"
                  :title="translations.punycodeHelpTitle"
                  :aria-label="translations.punycodeHelpTitle"
                  @click="showPunycodeHelp = !showPunycodeHelp"
                >
                  <VzIcon name="help" />
                </button>
              </div>
              <SecureText :text="asciiHostname" size="xl" :style="currentDomainFontSize" />
            </template>
            <SecureText v-else :text="currentHostname" size="xl" :style="currentDomainFontSize" />
          </div>

          <!-- Said before the numbers, because it explains why there are none -->
          <VzNotice v-if="isUntrackedHost" tone="neutral" icon="unknown">
            <p class="vz-body-strong">
              {{ untrackedIsIp ? translations.untrackedIpTitle : translations.untrackedHostTitle }}
            </p>
            <p>{{ untrackedIsIp ? translations.untrackedIpText : translations.untrackedHostText }}</p>
          </VzNotice>

          <!-- Structural markers and resemblance to a domain the user knows.
               The only place they are drawn for this name: the check field above
               leaves them out while this card is about the name it checked.
               Both take the same context, because they read one shared answer. -->
          <DomainMarkers :hostname="currentHostname" :url="currentUrl" :context="currentContext" :notes="hostNotes" />
          <LookalikeNotice :hostname="currentHostname" :context="currentContext" />
          <!-- Not for an address that only means something inside one network:
               no site elsewhere has anything to say about the reader's router -->
          <ExternalLookups v-if="!isUntrackedHost" :hostname="currentHostname" />

          <!-- Visit history facts, for this exact host and nothing else. The
               family's own figures are under the base domain further down, which
               is the name they are about. firstSeen/activeDays stay empty until
               a full history import supplies them – nothing guesses a date. -->
          <FamiliarityGrid
            v-if="currentStats"
            :stats="currentStats"
            class="popup-rule"
          />

          <!--
            Whether the warnings are on here. Both ways round, on a site the
            warnings have something to say about – see `showWarningsRow`. Not
            only once they are off: this is the only place they can be turned
            off at all, so a row that appeared solely when there was something
            to undo would leave the switch with nowhere to live.
          -->
          <div v-if="showWarningsRow" class="popup-row popup-rule">
            <span
              class="popup-state"
              :data-status="isIgnoredHost ? 'off' : 'on'"
              :title="isIgnoredHost ? translations.ignoredSiteTooltip : translations.warningsActiveTooltip"
            >
              <VzBadge v-if="isIgnoredHost" tone="neutral" icon="silenced">{{ translations.ignoredSiteNotice }}</VzBadge>
              <template v-else>{{ translations.warningsActiveNotice }}</template>
            </span>
            <button
              class="vz-btn vz-btn--sm vz-btn--quiet"
              :title="isIgnoredHost ? translations.warningsActiveTooltip : translations.ignoredSiteTooltip"
              @click="setWarnings(!isIgnoredHost)"
            >
              {{ isIgnoredHost ? translations.ignoredSiteResume : translations.ignoredSiteSilence }}
            </button>
          </div>

          <!--
            Anti-tampering status, and only where there is a site it is about.

            It reports on a site the reader was just on, which is why the wording
            says "this site" – over a tab, or on the details page opened from a
            link there. The check page is the one place with no such site: the
            name on screen was typed into a field, and the page the reader is
            actually on is the extension's own, so saying protection is active
            there is a claim about nothing. The exclusion list stays reachable
            from the details page and from the settings either way.
          -->
          <div v-if="!isCheckPage" class="popup-row popup-rule">
            <span
              class="popup-state"
              :data-status="isAntiTamperingExcluded ? 'off' : 'on'"
              :title="`${translations.antiTamperingTooltipWhat}\n\n${isAntiTamperingExcluded ? translations.antiTamperingTooltipOff : translations.antiTamperingTooltipOn}`"
            >
              <VzBadge v-if="isAntiTamperingExcluded" tone="neutral" icon="unknown">{{ translations.antiTamperingNotProtected }}</VzBadge>
              <template v-else>{{ translations.antiTamperingProtected }}</template>
              <!-- Named, because the switch removes this line and that puts
                   protection back on every host under it, not just this one -->
              <template v-if="antiTamperingRuleIsParent">
                – {{ translations.antiTamperingParentRule }} <SecureText :text="antiTamperingRule" size="s" />
              </template>
            </span>
            <button
              class="vz-btn vz-btn--sm vz-btn--quiet"
              data-anti-tampering-toggle
              :title="isAntiTamperingExcluded ? translations.antiTamperingTooltipOn : translations.antiTamperingTooltipOff"
              @click="toggleAntiTampering"
            >
              {{ isAntiTamperingExcluded ? translations.antiTamperingEnableForSite : translations.antiTamperingDisableForSite }}
            </button>
          </div>
        </section>

        <!-- The base domain, and the family's own figures under it.

             This is the name those figures are about: "have I been here" folds
             `example.com` and `mail.example.com` into one question, and it is the
             fold the check field's verdict is taken on. Drawn under the
             subdomain's name it read as that host's own count and disagreed with
             the card above it by however much the rest of the family came to.
             The same card and the same grid as the checked domain, deliberately,
             so the two rows can be compared rather than puzzled over.

             The name and its lookups are skipped where the base domain is the
             address already spelled out at the top of the page. The figures are
             skipped where nothing but this host is recorded under it, since the
             fold would then be the card above, number for number. -->
        <section v-if="showBaseDomainCard" data-base-domain class="vz-card popup-card">
          <template v-if="baseDomain !== currentKey">
            <span class="vz-eyebrow">{{ translations.baseDomain }}</span>
            <SecureText :text="baseDomain" size="l" />
            <ExternalLookups :hostname="baseDomain" />
            <!-- Where the figures would be. Only when this host is on record: with
                 nothing recorded at all, the notice further down says so -->
            <p
              v-if="!showFamily && familyHosts.includes(currentKey)"
              data-family-only-host
              class="vz-small"
            >
              {{ onlyThisHostText }}
            </p>
          </template>
          <!-- Said before the numbers, and said whether or not the name above
               them is drawn. Where the base domain is the address the window is
               already about, the name and its heading are skipped – and that
               used to leave this card as a bare row of figures with nothing at
               all to say what they were about or what they covered. -->
          <template v-if="showFamily && familyStats">
            <span class="vz-eyebrow" :class="{ 'mt-2': baseDomain !== currentKey }">{{ translations.familySummaryTitle }}</span>
            <FamiliarityGrid
              :stats="familyStats"
              aggregated
              data-family-stats
            />
          </template>
        </section>

        <!-- The rest of the family, and only where there is one. A list holding
             nothing but the address already on show above says nothing that
             panel has not said, so it and its heading stay away. -->
        <section v-if="showFamily" class="grid gap-2">
          <!-- One row, two questions. On the left, what order the rows are in:
               by the hostname or by the number, and which way up. On the right,
               which number that is. Keeping them apart is what lets a list be
               alphabetical without also having to give up the number it shows.

               Each group is one item of the outer row rather than a run of
               loose buttons, so a row too narrow for both breaks between them
               and not through the middle of a group. -->
          <div class="popup-list-controls">
            <div class="flex items-center gap-2">
              <span class="vz-small">{{ translations.listSortLabel }}</span>
              <button
                class="vz-btn vz-btn--sm popup-sort-by"
                data-sort-by-name
                :title="sortByNameTitle"
                :aria-pressed="settings.sortByName"
                @click="toggleSortByName"
              >
                {{ settings.sortByName ? translations.sortByName : translations.listNumberLabel }}
              </button>
              <button
                class="vz-iconbtn vz-iconbtn--sm vz-iconbtn--outline tap-target"
                :title="sortOrderTitle"
                :aria-label="sortOrderTitle"
                @click="toggleSortOrder"
              >
                <VzIcon :name="settings.sortOrder === 'asc' ? 'sort-asc' : 'sort-desc'" />
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="vz-small">{{ translations.listNumberLabel }}</span>
              <span class="vz-selectbox">
                <select
                  class="vz-select vz-select--sm"
                  data-list-metric
                  :value="listMetric"
                  :aria-label="translations.listNumberLabel"
                  @change="onListMetricChange"
                >
                  <option v-for="metric in DOMAIN_METRICS" :key="metric" :value="metric">
                    {{ metricLabel(metric) }}
                  </option>
                </select>
              </span>
            </div>
          </div>

          <!-- No family figure beside this heading any more: it was the same
               fold, for the same family, as the grid under the base domain a few
               lines above – and for visits it was the very same number. -->
          <span class="vz-eyebrow">{{ translations.relatedDomains }}</span>
          <ul
            class="vz-list popup-list"
            :class="isPageView ? '' : 'popup-list--capped'"
          >
            <li
              v-for="domain in sortedFamilyHosts"
              :key="domain"
              class="vz-list__row"
              :class="{ 'vz-list__row--current': domain === currentKey }"
            >
              <!-- No hover repeating the name: it said exactly what the row
                   already says. The name is allowed to wrap instead, which needs
                   no mouse and no second look.

                   The one hover left is for a name whose two spellings differ:
                   the row draws whichever the header's toggle asked for, and the
                   other one is not on screen to be read. -->
              <div class="vz-list__main" :title="displayDomain(domain) === domain ? undefined : domain">
                <SecureText :text="displayDomain(domain)" size="m" />
                <VzBadge v-if="domain === currentKey" tone="brand">
                  {{ translations.current }}
                </VzBadge>
              </div>
              <!-- The number first and its mark after it, so the numbers line up
                   on the right edge. A number nobody judges by has no mark. -->
              <span
                class="vz-list__num"
                data-family-reading
                :title="readingTitle(readingFor(domain))"
              >
                <span data-family-value :class="{ 'vz-fact__value--none': readingFor(domain).value === undefined }">{{ readingText(readingFor(domain)) }}</span>
                <VzIcon
                  v-if="readingFor(domain).met !== undefined"
                  :name="readingFor(domain).met ? 'pass' : 'fail'"
                  :label="t(readingFor(domain).met ? 'familiarityFactPassed' : 'familiarityFactFailed')"
                  :class="readingFor(domain).met ? 'tone-safe' : 'tone-danger'"
                  :data-result="readingFor(domain).met ? 'pass' : 'fail'"
                />
              </span>
            </li>
          </ul>
        </section>
        <!-- Skipped for untracked hosts: "no visit data" reads as a gap waiting
             to be filled, and the notice above has already said why it never will be -->
        <p v-else-if="!familyHosts.length && !isUntrackedHost" class="vz-well vz-small text-center">
          {{ translations.noVisitData }}
        </p>
      </template>
      <!-- Hidden on the standalone check page until something is checked -->
      <p v-else-if="!isStandalonePage" class="vz-body text-center py-8" data-no-site>
        {{ translations.visitWebsite }}
      </p>

      <!-- What punycode is, over the card -->
      <div v-if="showPunycodeHelp" class="absolute inset-0 vz-scrim flex items-center justify-center z-50 p-4">
        <div class="vz-overlay vz-dialog relative" role="dialog" aria-modal="true" :aria-label="translations.punycodeHelpTitle">
          <div class="vz-dialog__head">
            <VzIcon name="script" large class="tone-brand" />
            <h3 class="vz-title">
              {{ translations.punycodeHelpTitle }}
            </h3>
            <button class="vz-iconbtn" :title="t('closeDialog')" :aria-label="t('closeDialog')" @click="showPunycodeHelp = false">
              <VzIcon name="close" />
            </button>
          </div>
          <p class="vz-body whitespace-pre-wrap">
            {{ translations.punycodeHelpContent }}
          </p>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
/* Prevent popup-level scrollbar – but not on the standalone page, which is a
   normal tab and scrolls like one (see the class toggle in the script) */
html:not(.standalone-page),
html:not(.standalone-page) body {
  overflow: hidden;
}

/* Inner lists hide their scrollbar in the popup, where space is tight. On the
   standalone page they have no height cap, so there is nothing to hide. */
html:not(.standalone-page) .popup-list--capped::-webkit-scrollbar {
  display: none;
}

html:not(.standalone-page) .popup-list--capped {
  -ms-overflow-style: none;  /* IE and Edge */
  scrollbar-width: none;  /* Firefox */
}

/* A 24 px button is comfortable under a mouse and a poor target for a fingertip,
   which is why this is asked of the pointer rather than applied everywhere: the
   box stays as it is on desktop, and grows to the 44 px an accessible touch
   target wants where there is nothing more precise than a finger. The icon does
   not change size – only the area that answers the tap. */
@media (pointer: coarse) {
  .tap-target {
    min-width: var(--touch-target) !important;
    min-height: var(--touch-target) !important;
  }
}

.popup-main {
  /* Below 100% the spacing shrinks with the text, or a small text size floats in
     wide margins. Above it the spacing stays, since a phone has no room for more. */
  --space-1: calc(4px * min(1, var(--vz-scale, 1)));
  --space-2: calc(8px * min(1, var(--vz-scale, 1)));
  --space-3: calc(12px * min(1, var(--vz-scale, 1)));
  --space-4: calc(16px * min(1, var(--vz-scale, 1)));
  --space-5: calc(20px * min(1, var(--vz-scale, 1)));
  --space-6: calc(24px * min(1, var(--vz-scale, 1)));
  --space-8: calc(32px * min(1, var(--vz-scale, 1)));
  display: grid;
  /* minmax(0, …): an auto track grows to its widest child, so at a large text
     size on a phone the header pushed every card past the right edge */
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-3) var(--space-3);
  background: var(--bg);
  color: var(--ink);
}

.popup-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.popup-logo {
  flex: none;
  /* Follows the text size like the controls beside it */
  height: calc(32px * var(--vz-scale, 1));
  width: auto;
}

.popup-size-readout {
  align-self: center;
  min-width: 3.2em;
  text-align: center;
  font-size: calc(13px * var(--vz-scale, 1));
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}

.popup-card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4);
  min-width: 0;
}

.popup-address {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.popup-rule {
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.popup-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* The action keeps to the right, on a line of its own if it has to wrap */
.popup-row > .vz-btn { flex: none; margin-left: auto; }

.popup-state {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
}

.popup-list-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}

.popup-sort-by {
  min-width: 5.5em;
}

.popup-list--capped {
  max-height: 265px;
  overflow-y: auto;
}
</style>
