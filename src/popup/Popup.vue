<script setup lang="ts">
import type { FamiliarityCriterionId, FamiliarityStats } from '~/logic/familiarity'
import type { SiteVisitData } from '~/logic/storage'
import punycode from 'punycode'
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { belongsToSite, siteDomainOrSelf } from '~/logic/domain-boundary'
import { aggregateFamiliarityStats, evaluateFamiliarity, isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { isolatePageZoom } from '~/logic/page-zoom'
import { popupWidthCap } from '~/logic/platform'
import { settings } from '~/logic/storage'
import { isTrackableHostname } from '~/logic/visit-stats'
import Logo from '../components/Logo.vue'
import SecureText from '../components/SecureText.vue'
import CheckField from './CheckField.vue'

const { t, isLoaded, loadedTranslations } = useI18n()
const { factsFor, withThresholds } = useFamiliarityFacts()
const { isDark } = useTheme()
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
    'subdomains',
    'total',
    'sortBy',
    'sortByName',
    'sortByVisits',
    'sortOrderToAsc',
    'sortOrderToDesc',
    'caseToUpper',
    'caseToLower',
    'highlightingTurnOn',
    'highlightingTurnOff',
    'highlightingLegend',
    'punycodeShowAscii',
    'punycodeShowUnicode',
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
    'antiTamperingDisableForSite',
    'antiTamperingEnableForSite',
    'antiTamperingTooltipWhat',
    'antiTamperingTooltipOn',
    'antiTamperingTooltipOff',
    'checkExternalButton',
    'firstSeenLabel',
    'lastSeenLabel',
    'activeDaysLabel',
    'statsUnknown',
    'statsImportHint',
    'statsFamilyWide',
    'externalLookupsTitle',
    'externalLookupsCaveat',
    'untrackedHostTitle',
    'untrackedHostText',
    'familiarityRequiredAtLeast',
    'familiarityDaysUnit',
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
const subdomains = ref<string[]>([])
const showPunycodeHelp = ref(false)

const unicodeHostname = computed(() => {
  if (!currentHostname.value)
    return ''
  return punycode.toUnicode(currentHostname.value)
})

const isPunycode = computed(() => {
  return currentHostname.value !== unicodeHostname.value
})

const cumulativeCount = computed(() => {
  return subdomains.value.reduce((acc, domain) => {
    return acc + (visits.value[domain]?.count || 0)
  }, 0)
})

const currentDomainCount = computed(() => {
  return visits.value[currentHostname.value]?.count || 0
})

// Hostnames without a dot (localhost, a machine name on the local network) are
// never counted, so their zero is not a fact about the user. Showing it as a red
// 0 would accuse a machine on their own desk of being unfamiliar, and no amount
// of visiting could ever clear it. Say plainly that nothing is counted instead.
const isUntrackedHost = computed(() => {
  return Boolean(currentHostname.value) && !isTrackableHostname(currentHostname.value)
})

// The details page is usually opened for a link or an email domain, which often
// has no record of its own even when the rest of the family does – visits are
// counted per hostname, so `example.com` and `www.example.com` are separate.
// Falling back to the family keeps the facts from vanishing. They are marked as
// family-wide, because facts about a family are not facts about this address.
const statsAreFamilyWide = computed(() => {
  return Boolean(currentHostname.value) && !visits.value[currentHostname.value] && subdomains.value.length > 0
})

const currentStats = computed<SiteVisitData | undefined>(() => {
  const own = visits.value[currentHostname.value]
  if (own)
    return own

  const records = subdomains.value.map(domain => visits.value[domain]).filter(Boolean)
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

const familiarityRules = computed(() => normalizeFamiliarity(settings.value.familiarity))

/** Which of the user's checks this address passes, and whether that is enough. */
const currentVerdict = computed(() =>
  evaluateFamiliarity(currentStats.value ?? { count: 0 }, familiarityRules.value))

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
  const outcome = criterionOutcome(id)
  if (!outcome)
    return ''
  return outcome.met ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

/** The whole domain family's facts, for the cumulative row. */
const familyStats = computed(() =>
  aggregateFamiliarityStats(subdomains.value.map(domain => visits.value[domain])))

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

const sortedSubdomains = computed(() => {
  const domains = [...subdomains.value]

  const option = settings.value.sortOption || 'visits'
  const order = settings.value.sortOrder || 'desc'
  const multiplier = order === 'asc' ? 1 : -1

  return domains.sort((a, b) => {
    if (option === 'visits') {
      const countA = visits.value[a]?.count || 0
      const countB = visits.value[b]?.count || 0
      if (countA !== countB)
        return (countA - countB) * multiplier

      // Fallback to name if counts are equal
      return a.localeCompare(b)
    }
    else {
      // Sort by name
      return a.localeCompare(b) * multiplier
    }
  })
})

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

const caseTitle = computed(() => settings.value.domainCase === 'upper'
  ? translations.value.caseToLower
  : translations.value.caseToUpper)

const highlightingTitle = computed(() => {
  const action = settings.value.domainHighlighting
    ? translations.value.highlightingTurnOff
    : translations.value.highlightingTurnOn
  return `${action}\n\n${translations.value.highlightingLegend}`
})

const punycodeTitle = computed(() => settings.value.punycodeListMode === 'unicode'
  ? translations.value.punycodeShowAscii
  : translations.value.punycodeShowUnicode)

function toggleSortOrder() {
  settings.value.sortOrder = settings.value.sortOrder === 'asc' ? 'desc' : 'asc'
}

function setSortOption(option: 'name' | 'visits') {
  settings.value.sortOption = option
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

// Green means "familiar" under the user's rules, which visits alone no longer
// decide once active days or age are switched on
function getCountColor(stats: FamiliarityStats | undefined) {
  return isFamiliar(stats ?? { count: 0 }, familiarityRules.value)
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-500 dark:text-red-400'
}

function toggleDomainCase() {
  settings.value.domainCase = settings.value.domainCase === 'upper' ? 'lower' : 'upper'
}

function toggleHighlighting() {
  settings.value.domainHighlighting = !settings.value.domainHighlighting
}

function togglePunycodeListMode() {
  settings.value.punycodeListMode = settings.value.punycodeListMode === 'unicode' ? 'ascii' : 'unicode'
}

function displayDomain(domain: string) {
  if (settings.value.punycodeListMode === 'ascii')
    return domain
  return punycode.toUnicode(domain)
}

async function loadDomainData(hostname: string) {
  currentHostname.value = hostname
  // An IP address and an intranet name have no site to belong to, so each is a
  // family of one. Leaving this empty used to hide a record that plainly exists:
  // the page had visits stored under `192.168.1.10` and showed nothing at all.
  baseDomain.value = siteDomainOrSelf(hostname)
  visits.value = {}
  subdomains.value = []

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
  subdomains.value = matched.sort((a, b) => {
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
// subdomains would otherwise be cut off with no way to reach the rest.
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
    <main
      class="px-4 py-5 text-gray-700 dark:text-gray-200 relative"
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
        <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
          <div class="uppercase tracking-wider opacity-60 mb-1" style="font-size: 0.75em;">
            {{ isStandalonePage ? translations.checkedDomain : translations.currentDomain }}
          </div>
          <div class="flex justify-between items-end">
            <div class="secure-domain-display font-bold break-words min-w-0 leading-tight mr-2" :style="{ fontSize: currentDomainFontSize }">
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
            <!-- A dash, not a 0: there is no count here, which is a different
                 thing from a count of zero -->
            <div
              v-if="isUntrackedHost"
              class="font-mono font-bold opacity-40" style="font-size: 1.3em;"
              :title="translations.untrackedHostTitle"
            >
              –
            </div>
            <div v-else class="font-mono font-bold" style="font-size: 1.3em;" :class="getCountColor(currentStats)">
              {{ currentDomainCount }}
            </div>
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
          <!-- Not scaled down like the two above it: the same control appears in
               the check card as well, and one screen showing it at two sizes
               reads as two different things -->
          <ExternalLookups :hostname="currentHostname" />

          <!-- Visit history facts. firstSeen/activeDays stay empty until a full
               history import supplies them – we never guess a date. -->
          <div
            v-if="currentStats"
            class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 grid grid-cols-3 gap-2 text-left"
            style="font-size: 0.85em;"
          >
            <div>
              <div class="uppercase tracking-wider opacity-50">
                {{ translations.firstSeenLabel }}
              </div>
              <div
                v-if="currentStats.firstSeen"
                :class="criterionColor('age')"
                :title="criterionOutcome('age') ? `${translations.familiarityRequiredAtLeast} ${criterionOutcome('age')!.required} ${translations.familiarityDaysUnit}` : undefined"
              >
                {{ formatTimestamp(currentStats.firstSeen) }}
                <span v-if="criterionText('age')" class="opacity-70">
                  ({{ criterionText('age') }})
                </span>
              </div>
              <div v-else class="opacity-40 italic" :title="translations.statsImportHint">
                {{ translations.statsUnknown }}
              </div>
            </div>
            <div>
              <div class="uppercase tracking-wider opacity-50">
                {{ translations.lastSeenLabel }}
              </div>
              <div>{{ formatTimestamp(currentStats.lastSeen) }}</div>
            </div>
            <div>
              <div class="uppercase tracking-wider opacity-50">
                {{ translations.activeDaysLabel }}
              </div>
              <div
                v-if="currentStats.activeDays"
                :class="criterionColor('activeDays')"
                :title="criterionOutcome('activeDays') ? `${translations.familiarityRequiredAtLeast} ${criterionOutcome('activeDays')!.required}` : undefined"
              >
                {{ criterionText('activeDays') ?? currentStats.activeDays }}
              </div>
              <div v-else class="opacity-40 italic" :title="translations.statsImportHint">
                {{ translations.statsUnknown }}
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
          <div v-if="!isCheckPage" class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div
              class="flex items-center gap-1.5 cursor-help"
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

        <div v-if="subdomains.length > 0">
          <div class="mb-2">
            <div class="flex justify-between items-center uppercase tracking-wider mb-1" style="font-size: 0.75em;">
              <span class="opacity-50">{{ translations.baseDomain }}</span>
              <span class="font-mono font-bold" :class="getCountColor(familyStats)">{{ translations.total }}{{ cumulativeCount }}</span>
            </div>
            <div class="secure-domain-display font-bold break-words" style="font-size: 1.1em;">
              <SecureText :text="baseDomain" />
            </div>
          </div>

          <!-- Sort Controls -->
          <div class="flex flex-wrap gap-2 mb-2 items-center" style="font-size: 0.65em;">
            <span class="opacity-50">{{ translations.sortBy }}</span>
            <button
              class="btn-ghost btn-sm !rounded"
              :class="settings.sortOption === 'name' ? '!bg-blue-100 !border-blue-200 !text-blue-700 dark:!bg-blue-900/40 dark:!border-blue-700 dark:!text-blue-300' : ''"
              @click="setSortOption('name')"
            >
              {{ translations.sortByName }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded"
              :class="settings.sortOption === 'visits' ? '!bg-blue-100 !border-blue-200 !text-blue-700 dark:!bg-blue-900/40 dark:!border-blue-700 dark:!text-blue-300' : ''"
              @click="setSortOption('visits')"
            >
              {{ translations.sortByVisits }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded ml-auto w-6 flex items-center justify-center"
              :title="sortOrderTitle"
              :aria-label="sortOrderTitle"
              @click="toggleSortOrder"
            >
              {{ settings.sortOrder === 'asc' ? '↑' : '↓' }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
              :title="caseTitle"
              :aria-label="caseTitle"
              @click="toggleDomainCase"
            >
              {{ settings.domainCase === 'upper' ? 'AA' : 'aa' }}
            </button>
            <!-- Highlighting leaves plain Latin addresses untouched, so the button
                 has to show its own state or it reads as broken -->
            <button
              class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
              :class="settings.domainHighlighting ? '!bg-blue-100 !border-blue-200 dark:!bg-blue-900/40 dark:!border-blue-700' : 'grayscale opacity-60'"
              :title="highlightingTitle"
              :aria-label="highlightingTitle"
              :aria-pressed="settings.domainHighlighting"
              @click="toggleHighlighting"
            >
              🌈
            </button>
            <button
              class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center font-bold"
              :title="punycodeTitle"
              :aria-label="punycodeTitle"
              @click="togglePunycodeListMode"
            >
              {{ settings.punycodeListMode === 'unicode' ? 'O' : 'P' }}
            </button>
          </div>

          <div class="uppercase tracking-wider mb-1 opacity-50" style="font-size: 0.75em;">
            {{ translations.subdomains }}
          </div>
          <div
            class="overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 shadow-sm"
            :class="isPageView ? '' : 'max-h-[265px]'"
            style="font-size: 1.1em;"
          >
            <div
              v-for="domain in sortedSubdomains" :key="domain"
              class="p-2.5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              :class="{ 'bg-blue-50 hover:bg-blue-50 dark:bg-blue-900/30 dark:hover:bg-blue-900/30': domain === currentHostname }"
            >
              <span class="truncate flex-1 mr-3 secure-domain-display" :title="domain">
                <SecureText :text="displayDomain(domain)" />
                <span v-if="domain === currentHostname" class="ml-1 text-[10px] text-blue-500 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 px-1 rounded font-sans">{{ translations.current }}</span>
              </span>
              <span class="font-mono font-bold" :class="getCountColor(visits[domain])">
                {{ visits[domain]?.count || 0 }}
              </span>
            </div>
          </div>
        </div>
        <!-- Skipped for untracked hosts: "no visit data" reads as a gap waiting
             to be filled, and the notice above has already said why it never will be -->
        <div v-else-if="!isUntrackedHost" class="mt-4 text-sm opacity-50 text-center py-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
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
