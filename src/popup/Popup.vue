<script setup lang="ts">
import type { DomainMetric, MetricReading } from '~/logic/domain-metric'
import type { FamiliarityCriterionId } from '~/logic/familiarity'
import type { SiteVisitData } from '~/logic/storage'
import punycode from 'punycode'
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { belongsToSite, siteDomainOrSelf } from '~/logic/domain-boundary'
import { displayDomain } from '~/logic/domain-display'
import { DOMAIN_METRICS, metricAggregation, metricReading, metricSortValue, metricTotal } from '~/logic/domain-metric'
import { aggregateFamiliarityStats, daysSince, evaluateFamiliarity, isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { isolatePageZoom } from '~/logic/page-zoom'
import { popupWidthCap } from '~/logic/platform'
import { editSettingsThroughBackground, settings } from '~/logic/storage'
import { isTrackableHostname } from '~/logic/visit-stats'
import Logo from '../components/Logo.vue'
import SecureText from '../components/SecureText.vue'
import CheckField from './CheckField.vue'

const { t, isLoaded, loadedTranslations } = useI18n()
const { factsFor, withThresholds } = useFamiliarityFacts()
const { isDark } = useTheme()

// The sort order, the case of the names, the punycode toggle: small edits, sent
// to the background like every other. Written from here they carried the rest of
// the settings as this window read them, which for a window left open is a copy
// from before whatever was changed in the settings page since.
editSettingsThroughBackground()
// Shared components read the theme through this key, because inside the
// content script's shadow DOM the `dark` class on <html> does not reach them
provide('isDark', isDark)

// Reactive translations
const translations = ref<Record<string, string>>({})

// Function to update translations
function updateTranslations() {
  if (!isLoaded.value)
    return

  const translationKeys = [
    'currentDomain',
    'checkedDomain',
    'baseDomain',
    'relatedDomains',
    'total',
    'max',
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
    'statsFamilyWide',
    'externalLookupsTitle',
    'untrackedHostTitle',
    'untrackedHostText',
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

const isPunycode = computed(() => {
  return currentHostname.value !== unicodeHostname.value
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
  familyHosts.value.filter(domain => domain !== currentHostname.value))

const showFamily = computed(() => otherFamilyHosts.value.length > 0)

// Hostnames without a dot (localhost, a machine name on the local network) are
// never counted, so their zero is not a fact about the user. Showing it as a red
// 0 would accuse a machine on their own desk of being unfamiliar, and no amount
// of visiting could ever clear it. Say plainly that nothing is counted instead.
const isUntrackedHost = computed(() => {
  return Boolean(currentHostname.value) && !isTrackableHostname(currentHostname.value)
})

/**
 * Whether anything at all is drawn under the domain panel.
 *
 * Either the family list or the "nothing recorded" notice, which are the two
 * branches below it. With neither, the panel is the last thing on the page and
 * the space kept for what would follow it is space kept for nothing.
 */
const hasBlockBelowPanel = computed(() =>
  showFamily.value || (!familyHosts.value.length && !isUntrackedHost.value))

// The details page is usually opened for a link or an email domain, which often
// has no record of its own even when the rest of the family does – visits are
// counted per hostname, so `example.com` and `www.example.com` are separate.
// Falling back to the family keeps the facts from vanishing. They are marked as
// family-wide, because facts about a family are not facts about this address.
const statsAreFamilyWide = computed(() => {
  return Boolean(currentHostname.value) && !visits.value[currentHostname.value] && familyHosts.value.length > 0
})

const currentStats = computed<SiteVisitData | undefined>(() => {
  const own = visits.value[currentHostname.value]
  if (own)
    return own

  const records = familyHosts.value.map(domain => visits.value[domain]).filter(Boolean)
  if (!records.length)
    return undefined

  // Folded the same way the familiarity check folds a family: visits add up,
  // active days take the largest single member and the first visit the earliest
  const aggregated = aggregateFamiliarityStats(records)

  return {
    count: aggregated.count,
    lastSeen: Math.max(...records.map(r => r.lastSeen)),
    firstSeen: aggregated.firstSeen,
    activeDays: aggregated.activeDays,
    ignored: false,
  }
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
  const host = currentHostname.value
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
  if (!host)
    return

  await browser.runtime.sendMessage({ type: 'ignore-site', data: { hostname: host, ignored } })
  await loadDomainData(host)
}

const familiarityRules = computed(() => normalizeFamiliarity(settings.value.familiarity))

/** Which of the user's checks this address passes, and whether that is enough. */
const currentVerdict = computed(() =>
  evaluateFamiliarity(currentStats.value ?? { count: 0 }, familiarityRules.value))

/**
 * Whether a warning could fire on this page at all.
 *
 * Drawn from the record for this exact hostname, never from `currentStats`,
 * which falls back to the family so that a details page opened for an address
 * with no visits of its own still has facts to show. The warnings do no such
 * thing – the content script judges the host it is on – so borrowing the
 * family's verdict here would take the switch away from a page that is about to
 * warn.
 *
 * An address that is never counted is safe by the same rule the content script
 * uses: a zero that can never move would otherwise warn about the router's own
 * page forever.
 */
const warningsCanFire = computed(() => {
  if (!currentHostname.value || isUntrackedHost.value)
    return false

  return !isFamiliar(visits.value[currentHostname.value] ?? { count: 0 }, familiarityRules.value)
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

/**
 * The outcome of one check, or undefined when the user has it switched off.
 *
 * Drives the colour on the facts below: a number that has no say in the verdict
 * is left uncoloured rather than being tinted as if it did.
 */
function criterionOutcome(id: FamiliarityCriterionId) {
  return currentVerdict.value.criteria.find(outcome => outcome.id === id)
}

/**
 * The same fact as the check surfaces would word it, for the grid below.
 *
 * The grid lays first visit, last visit and active days out in a shape of its
 * own, but the numbers inside it are the ones every other surface shows – so
 * whether the threshold rides along with them is one setting, not two.
 * Undefined for a criterion the user has switched off, which the grid still
 * lists as a plain fact.
 */
function criterionText(id: FamiliarityCriterionId) {
  const fact = factsFor(currentStats.value ?? { count: 0 }).find(entry => entry.id === id)
  if (!fact)
    return undefined
  // The grid names every row already, so the bar rides along in the cell rather
  // than claiming a column of its own
  return withThresholds.value ? fact.combined : fact.value
}

function criterionColor(id: FamiliarityCriterionId) {
  return readingColor(criterionOutcome(id)?.met)
}

/** The bar a criterion has to clear, for the hover on the fact that has to clear it. */
function criterionBar(id: FamiliarityCriterionId) {
  const outcome = criterionOutcome(id)
  if (!outcome)
    return undefined

  const unit = id === 'age' ? ` ${translations.value.familiarityDaysUnit}` : ''
  return `${translations.value.familiarityRequiredAtLeast} ${outcome.required}${unit}`
}

/**
 * How long ago the first visit was, with the date itself moved to the hover.
 *
 * The date was the number on show here, and it is the one thing in the panel a
 * reader has to do arithmetic on before it means anything: "May 25" answers
 * nothing on its own, while "106 days" is the fact the age check is actually
 * made of. The date is still a click of the mouse away, since it is what makes
 * the count checkable.
 */
const firstSeenText = computed(() => {
  const firstSeen = currentStats.value?.firstSeen
  if (!firstSeen)
    return ''

  // The wording every other surface uses, bar and all, whenever the age check is
  // switched on. Off, it is a plain fact and says so in days.
  return criterionText('age') ?? `${daysSince(firstSeen, Date.now())} ${translations.value.familiarityDaysUnit}`
})

const firstSeenTitle = computed(() => {
  const firstSeen = currentStats.value?.firstSeen
  if (!firstSeen)
    return undefined

  const date = `${translations.value.firstVisitOn} ${formatTimestamp(firstSeen)}`
  const bar = criterionBar('age')
  return bar ? `${date}\n${bar}` : date
})

// The domain display is deliberately wide – a hyperlegible face at 0.25em letter
// spacing – so a long hostname cannot fit at the headline size. Stepping the size
// down keeps it to one or two lines instead of breaking a label apart, which is
// exactly what someone reading a suspicious address must not have to untangle.
const currentDomainFontSize = computed(() => {
  const length = Math.max(currentHostname.value.length, unicodeHostname.value.length)

  if (length <= 24)
    return '1.8em'
  if (length <= 34)
    return '1.45em'
  if (length <= 46)
    return '1.15em'

  return '0.95em'
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

/** The family's figure for the metric on show, and how it was arrived at. */
const familyReading = computed(() =>
  metricTotal(listMetric.value, familyHosts.value.map(domain => visits.value[domain]), familiarityRules.value))

const familyTotalLabel = computed(() => metricAggregation(listMetric.value) === 'total'
  ? translations.value.total
  : translations.value.max)

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
function readingColor(met: boolean | undefined) {
  if (met === undefined)
    return ''

  return met
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-500 dark:text-red-400'
}

async function loadDomainData(hostname: string) {
  currentHostname.value = hostname
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
  familyHosts.value = matched.sort((a, b) => {
    if (a === hostname)
      return -1
    if (b === hostname)
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

onMounted(() => {
  window.addEventListener('resize', refreshWidthCap)
})

onUnmounted(() => {
  window.removeEventListener('resize', refreshWidthCap)
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
  <div :class="isStandalonePage ? 'min-h-screen flex justify-center bg-gray-50 dark:bg-gray-900 py-8' : ''">
    <!-- The 600px column is the desktop popup, whose window sizes itself to the
         document. Firefox for Android has no such window – the popup is a panel
         the width of the screen, so the column has to be capped at the display
         or the whole dashboard hangs off the right edge -->
    <!-- The same margin at the sides and at the foot, so the last block on the
         page sits as far from the bottom edge as it does from the left one. The
         page kept a deeper band below than beside, which the popup window –
         sizing itself to the document – then drew as empty space of its own.
         What separates the blocks from one another is their own margin, and
         only the block that has something under it spends it. -->
    <main
      class="px-3 pt-5 pb-3 text-gray-700 dark:text-gray-200 relative"
      :class="isStandalonePage
        ? 'w-full max-w-[600px] bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700'
        : (isTabView ? 'w-full' : 'w-[600px]')"
      :style="{
        fontSize: `${settings.popupFontSize}%`,
        ...(isPageView ? {} : { maxWidth: popupMaxWidth }),
      }"
    >
      <div class="flex justify-between items-center mb-4">
        <Logo class="h-8 w-auto" />
        <div class="flex items-center gap-2">
          <!-- How an address is drawn. Here rather than by the related-domain
               list, which is not on screen at all until a site has visits – and the
               check page, where somebody is reading an address they do not
               know, is exactly where the three are worth reaching -->
          <DomainDisplayToggles />
          <!-- Font size controls -->
          <div class="flex items-center gap-1 text-gray-400 dark:text-gray-500">
            <button
              class="tap-target w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-bold"
              title="Decrease font size"
              aria-label="Decrease font size"
              :disabled="settings.popupFontSize <= 70"
              :class="{ 'opacity-30 cursor-not-allowed': settings.popupFontSize <= 70 }"
              @click="settings.popupFontSize = Math.max(70, settings.popupFontSize - 10)"
            >
              A-
            </button>
            <span class="text-xs w-8 text-center tabular-nums">{{ settings.popupFontSize }}%</span>
            <button
              class="tap-target w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-bold"
              title="Increase font size"
              aria-label="Increase font size"
              :disabled="settings.popupFontSize >= 150"
              :class="{ 'opacity-30 cursor-not-allowed': settings.popupFontSize >= 150 }"
              @click="settings.popupFontSize = Math.min(150, settings.popupFontSize + 10)"
            >
              A+
            </button>
          </div>
          <button class="icon-btn tap-target text-2xl" :title="translations.settings" :aria-label="translations.settings" @click="openOptionsPage">
            <div i-carbon-settings />
          </button>
        </div>
      </div>

      <!-- Popup: compact button opening the full check page; standalone: the field itself -->
      <button
        v-if="!isStandalonePage"
        class="w-full mb-4 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-500 transition-colors flex items-center justify-center gap-2"
        @click="openCheckPage"
      >
        <div i-carbon-qr-code />
        {{ translations.checkExternalButton }}
      </button>
      <CheckField v-else :initial="checkPageInitial" @checked-domain="loadDomainData" />

      <div v-if="currentHostname">
        <div
          class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
          :class="{ 'mb-4': hasBlockBelowPanel }"
        >
          <div class="uppercase tracking-wider opacity-60 mb-1" style="font-size: 0.75em;">
            {{ isStandalonePage ? translations.checkedDomain : translations.currentDomain }}
          </div>
          <!-- The address gets the whole width. The visit count used to sit at
               the right of this line, where it was the same number the facts
               below already give – in a column that says which check it belongs
               to and how far it is from the bar, which a lone figure beside the
               hostname never did. -->
          <div class="secure-domain-display font-bold break-words min-w-0 leading-tight" :style="{ fontSize: currentDomainFontSize }">
            <template v-if="isPunycode">
              <div class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-sans font-normal mb-0.5">
                {{ translations.domainOriginal }}
              </div>
              <SecureText :text="unicodeHostname" mark-wraps />
              <div class="flex items-center gap-1 mt-2 mb-0.5">
                <div class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-sans font-normal">
                  {{ translations.domainPunycode }}
                </div>
                <button
                  class="w-4 h-4 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 text-[10px] font-sans font-bold transition-colors"
                  @click="showPunycodeHelp = !showPunycodeHelp"
                >
                  ?
                </button>
              </div>
              <SecureText :text="currentHostname" mark-wraps />
            </template>
            <template v-else>
              <SecureText :text="currentHostname" mark-wraps />
            </template>
          </div>

          <!-- Said before the numbers, because it explains why there are none -->
          <div
            v-if="isUntrackedHost"
            class="mt-2 p-2 rounded-lg text-left bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50"
          >
            <div class="font-medium text-blue-800 dark:text-blue-300" style="font-size: 0.85em;">
              {{ translations.untrackedHostTitle }}
            </div>
            <p class="mt-0.5 leading-snug text-blue-900/70 dark:text-blue-200/80" style="font-size: 0.8em;">
              {{ translations.untrackedHostText }}
            </p>
          </div>

          <!-- Structural markers and resemblance to a domain the user knows -->
          <DomainMarkers :hostname="currentHostname" class="mt-2" style="font-size: 0.85em;" />
          <LookalikeNotice :hostname="currentHostname" style="font-size: 0.85em;" />
          <!-- Not scaled down like the two above it: this is the one place the
               lookup links are offered for the checked name, and a control the
               reader is meant to press does not want the size of a footnote -->
          <ExternalLookups :hostname="currentHostname" />

          <!-- Visit history facts. firstSeen/activeDays stay empty until a full
               history import supplies them – we never guess a date. -->
          <div
            v-if="currentStats"
            class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 grid grid-cols-3 gap-2 text-left"
            style="font-size: 0.85em;"
          >
            <!-- Days, not a date. The date is on the hover, where it is still
                 there to be checked without asking the reader to count months
                 back from today before the fact means anything.

                 All three headings are the criteria's own names, the ones the
                 settings page and the chips below use. This row had two of its
                 own – "First known visit" over a count of days, which had
                 stopped being a date, and a second "Active days" written out
                 separately – so the same three facts went under two sets of
                 names on one page. -->
            <div>
              <div class="uppercase tracking-wider opacity-50">
                {{ translations.familiarityAge }}
              </div>
              <div
                v-if="currentStats.firstSeen"
                class="font-mono"
                data-criterion="age"
                :class="criterionColor('age')"
                :title="firstSeenTitle"
              >
                {{ firstSeenText }}
              </div>
              <div v-else class="opacity-40 italic" :title="translations.statsImportHint">
                {{ translations.statsUnknown }}
              </div>
            </div>
            <div>
              <div class="uppercase tracking-wider opacity-50">
                {{ translations.familiarityActiveDays }}
              </div>
              <div
                v-if="currentStats.activeDays"
                class="font-mono"
                data-criterion="activeDays"
                :class="criterionColor('activeDays')"
                :title="criterionBar('activeDays')"
              >
                {{ criterionText('activeDays') ?? currentStats.activeDays }}
              </div>
              <div v-else class="opacity-40 italic" :title="translations.statsImportHint">
                {{ translations.statsUnknown }}
              </div>
            </div>
            <!-- The count that used to sit beside the hostname, now in the row
                 with the other two facts and coloured by its own check -->
            <div>
              <div class="uppercase tracking-wider opacity-50">
                {{ translations.familiarityVisits }}
              </div>
              <div
                class="font-mono"
                data-criterion="visits"
                :class="criterionColor('visits')"
                :title="criterionBar('visits')"
              >
                {{ criterionText('visits') ?? currentStats.count }}
              </div>
            </div>
          </div>
          <p v-if="currentStats && statsAreFamilyWide" class="mt-1 opacity-60 text-left" style="font-size: 0.75em;">
            {{ translations.statsFamilyWide }}
          </p>

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
          <!-- Both ways round, on a site the warnings have something to say
               about – see `showWarningsRow`. Not only once they are off: this
               is the only place they can be turned off at all, so a row that
               appeared solely when there was something to undo would leave the
               switch with nowhere to live. -->
          <div v-if="showWarningsRow" class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div
              class="flex items-center gap-1.5"
              :title="isIgnoredHost ? translations.ignoredSiteTooltip : translations.warningsActiveTooltip"
            >
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="isIgnoredHost ? 'bg-amber-400' : 'bg-green-500'"
              />
              <span style="font-size: 0.8em;" :class="isIgnoredHost ? 'text-amber-600' : 'text-gray-400'">
                {{ isIgnoredHost ? translations.ignoredSiteNotice : translations.warningsActiveNotice }}
              </span>
            </div>
            <button
              class="text-blue-500 hover:text-blue-700 hover:underline transition-colors" style="font-size: 0.8em;"
              :title="isIgnoredHost ? translations.warningsActiveTooltip : translations.ignoredSiteTooltip"
              @click="setWarnings(!isIgnoredHost)"
            >
              {{ isIgnoredHost ? translations.ignoredSiteResume : translations.ignoredSiteSilence }}
            </button>
          </div>

          <div v-if="!isCheckPage" class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div
              class="flex items-center gap-1.5"
              :title="`${translations.antiTamperingTooltipWhat}\n\n${isAntiTamperingExcluded ? translations.antiTamperingTooltipOff : translations.antiTamperingTooltipOn}`"
            >
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="isAntiTamperingExcluded ? 'bg-amber-400' : 'bg-green-500'"
              />
              <span style="font-size: 0.8em;" :class="isAntiTamperingExcluded ? 'text-amber-600' : 'text-gray-400'">
                {{ isAntiTamperingExcluded ? translations.antiTamperingNotProtected : translations.antiTamperingProtected }}
                <!-- Named, because the switch removes this line and that puts
                     protection back on every host under it, not just this one -->
                <template v-if="antiTamperingRuleIsParent">
                  – {{ translations.antiTamperingParentRule }} <span class="break-all">{{ antiTamperingRule }}</span>
                </template>
              </span>
            </div>
            <button
              class="text-blue-500 hover:text-blue-700 hover:underline transition-colors" style="font-size: 0.8em;"
              :title="isAntiTamperingExcluded ? translations.antiTamperingTooltipOn : translations.antiTamperingTooltipOff"
              @click="toggleAntiTampering"
            >
              {{ isAntiTamperingExcluded ? translations.antiTamperingEnableForSite : translations.antiTamperingDisableForSite }}
            </button>
          </div>
        </div>

        <!-- The rest of the family, and only where there is one. A list holding
             nothing but the address already on show above says nothing that
             panel has not said, so it and its heading stay away. -->
        <div v-if="showFamily">
          <!-- The base domain, unless it is the name spelled out at the top of
               the page – in which case this is the same word twice -->
          <div v-if="baseDomain !== currentHostname" class="mb-2">
            <div class="uppercase tracking-wider mb-1 opacity-50" style="font-size: 0.75em;">
              {{ translations.baseDomain }}
            </div>
            <div class="secure-domain-display font-bold break-words" style="font-size: 1.1em;">
              <SecureText :text="baseDomain" />
            </div>
          </div>

          <!-- One row, two questions. On the left, what order the rows are in:
               by the hostname or by the number, and which way up. On the right,
               which number that is – chips named after the checks the verdict
               is made of. Keeping them apart is what lets a list be
               alphabetical without also having to give up the number it shows:
               as one control, `Name` was a chip among the others and choosing
               it meant falling back to visits.

               The order button carries no highlight, because it has no off
               state to be dim about – it names the thing being sorted by, and
               `Number` is the same word that stands over the chips saying which
               one. Its width is held steady so that the arrow beside it does
               not move as the word changes.

               Each group is one item of the outer row rather than a run of
               loose buttons, so a row too narrow for both breaks between them
               and not through the middle of the chips – which used to leave a
               lone `Passed checks` under the word `Sort`, reading as if it
               belonged to it. -->
          <div class="flex flex-wrap justify-between items-center gap-x-4 gap-y-2 mb-2" style="font-size: 0.65em;">
            <div class="flex flex-wrap items-center gap-2">
              <span class="opacity-50">{{ translations.listSortLabel }}</span>
              <button
                class="btn-ghost btn-sm !rounded min-w-[4.5em]"
                data-sort-by-name
                :title="sortByNameTitle"
                :aria-pressed="settings.sortByName"
                @click="toggleSortByName"
              >
                {{ settings.sortByName ? translations.sortByName : translations.listNumberLabel }}
              </button>
              <button
                class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
                :title="sortOrderTitle"
                :aria-label="sortOrderTitle"
                @click="toggleSortOrder"
              >
                {{ settings.sortOrder === 'asc' ? '↑' : '↓' }}
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="opacity-50">{{ translations.listNumberLabel }}</span>
              <button
                v-for="metric in DOMAIN_METRICS" :key="metric"
                class="btn-ghost btn-sm !rounded"
                :class="listMetric === metric ? '!bg-blue-100 !border-blue-200 !text-blue-700 dark:!bg-blue-900/40 dark:!border-blue-700 dark:!text-blue-300' : ''"
                :data-list-metric="metric"
                @click="setListMetric(metric)"
              >
                {{ metricLabel(metric) }}
              </button>
            </div>
          </div>

          <!-- Total or max, named for which one it is: only visits add up -->
          <div class="flex justify-between items-center uppercase tracking-wider mb-1" style="font-size: 0.75em;">
            <span class="opacity-50">{{ translations.relatedDomains }}</span>
            <span
              class="font-mono font-bold" data-family-total
              :class="readingColor(familyReading.met)"
              :title="readingTitle(familyReading)"
            >{{ familyTotalLabel }}{{ readingText(familyReading) }}</span>
          </div>
          <div
            class="overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 shadow-sm"
            :class="isPageView ? '' : 'max-h-[265px]'"
            style="font-size: 1.1em;"
          >
            <div
              v-for="domain in sortedFamilyHosts" :key="domain"
              class="p-2.5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              :class="{ 'bg-blue-50 hover:bg-blue-50 dark:bg-blue-900/30 dark:hover:bg-blue-900/30': domain === currentHostname }"
            >
              <span class="truncate flex-1 mr-3 secure-domain-display" :title="domain">
                <SecureText :text="displayDomain(domain)" />
                <span v-if="domain === currentHostname" class="ml-1 text-[10px] text-blue-500 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 px-1 rounded font-sans">{{ translations.current }}</span>
              </span>
              <span
                class="font-mono font-bold whitespace-nowrap" data-family-value
                :class="readingColor(readingFor(domain).met)"
                :title="readingTitle(readingFor(domain))"
              >
                {{ readingText(readingFor(domain)) }}
              </span>
            </div>
          </div>
        </div>
        <!-- Skipped for untracked hosts: "no visit data" reads as a gap waiting
             to be filled, and the notice above has already said why it never will be -->
        <div v-else-if="!familyHosts.length && !isUntrackedHost" class="mt-4 text-sm opacity-50 text-center py-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          {{ translations.noVisitData }}
        </div>
      </div>
      <!-- Hidden on the standalone check page until something is checked -->
      <div v-else-if="!isStandalonePage" class="py-8 text-center opacity-50">
        <div class="text-4xl mb-2">
          🌍
        </div>
        <div>{{ translations.visitWebsite }}</div>
      </div>

      <!-- Punycode Help Modal -->
      <div v-if="showPunycodeHelp" class="absolute inset-0 bg-black/10 dark:bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-[90%] border border-gray-100 dark:border-gray-700 relative text-left">
          <button class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" @click="showPunycodeHelp = false">
            <div i-carbon-close class="text-lg" />
          </button>
          <h3 class="font-bold text-base mb-3 text-gray-900 dark:text-gray-100 font-sans pr-6">
            {{ translations.punycodeHelpTitle }}
          </h3>
          <div class="text-xs text-gray-600 dark:text-gray-400 font-sans whitespace-pre-wrap leading-relaxed">
            {{ translations.punycodeHelpContent }}
          </div>
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
html:not(.standalone-page) .overflow-y-auto::-webkit-scrollbar {
  display: none;
}

html:not(.standalone-page) .overflow-y-auto {
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
    min-width: 44px !important;
    min-height: 44px !important;
  }
}
</style>
