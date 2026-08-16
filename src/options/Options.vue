<script setup lang="ts">
import type { Ref } from 'vue'
import type { HistoryImportState, ImportHealth } from '~/logic/history-import'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import logo from '~/assets/logo.svg'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { fetchRemoteDomainLists, parseListUrls, STORAGE_KEY_CUSTOM_DISPOSABLE, STORAGE_KEY_CUSTOM_PUBLIC, STORAGE_KEY_REMOTE_DISPOSABLE, STORAGE_KEY_REMOTE_PUBLIC, updateDisposableList, updatePublicList } from '~/logic/email-providers'
import { describeImportHealth, HISTORY_AUTO_IMPORT_KEY, readHistoryImportState, runHistoryImport } from '~/logic/history-import'
import { DEFAULT_LOOKUP_SERVICES, serializeLookupServices } from '~/logic/lookup-services'
import { isolatePageZoom } from '~/logic/page-zoom'
import { hasHistoryApi, supportsHover } from '~/logic/platform'
import { fetchRemoteShortenerLists, STORAGE_KEY_REMOTE_SHORTENERS } from '~/logic/shortener-lists'
import { defaultSettings, settings } from '~/logic/storage'
import SectionNav from './SectionNav.vue'

const { t, setLanguage, currentLanguage, isLoaded } = useI18n()
useTheme()

// Reactive translations
const translations = ref<Record<string, string>>({})

// Function to update translations
function updateTranslations() {
  if (!isLoaded.value)
    return

  const translationKeys = [
    'extensionName',
    'settings',
    'generalSettings',
    'onThisPage',
    'languageSettings',
    'selectLanguage',
    'languageEnglish',
    'languageRussian',
    'languageUkrainian',
    'safetyLevels',
    'visitsThreshold',
    'visitsThresholdDesc',
    'displaySettings',
    'displaySettingsPinNote',
    'dynamicIcon',
    'dynamicIconDesc',
    'showBadge',
    'showBadgeDesc',
    'notificationSettings',
    'showWarningNotification',
    'showWarningNotificationDesc',
    'showInputWarning',
    'showInputWarningDesc',
    'showCopyWarning',
    'showCopyWarningDesc',
    'notificationStyle',
    'browserNotifications',
    'browserNotificationsDesc',
    'inPageNotifications',
    'inPageNotificationsDesc',
    'bothNotifications',
    'notificationStylePinNote',
    'notificationCooldown',
    'notificationCooldownDesc',
    'databaseManagement',
    'importHistoryIntro',
    'importStatusNever',
    'importStatusRunning',
    'importStatusComplete',
    'importStatusPartial',
    'importStatusInterrupted',
    'importStatusCancelled',
    'importStatusFailed',
    'importStatusUnsupported',
    'importKeepPageOpen',
    'importLastRun',
    'importSitesStored',
    'importHistoryFull',
    'importHistoryFullDesc',
    'importHistoryQuick',
    'importHistoryQuickDesc',
    'lookupServicesLabel',
    'lookupServicesDesc',
    'lookupServicesNote',
    'lookupServicesReset',
    'emailDisposableSources',
    'emailDisposableSourcesFailed',
    'importing',
    'resetData',
    'visitsInfo',
    'allSettings',
    'resetSelectedData',
    'selectDataToReset',
    'confirmReset',
    'confirmResetMessage',
    'cannotBeUndone',
    'cancel',
    'reset',
    'notificationPermissionRequired',
    'warningTriggerEventsTitle',
    'bothWarningTriggers',
    'blockPasteOnUnfamiliar',
    'blockPasteOnUnfamiliarDesc',
    'defaultSafetyThreshold',
    'linkSafetySettings',
    'linkSafetySettingsDesc',
    'linkSafetyEnabled',
    'linkTooltipTrigger',
    'linkTooltipTriggerHover',
    'linkTooltipTriggerHoverDesc',
    'linkHoverDelay',
    'linkHoverDelayDesc',
    'linkHoverDelaySeconds',
    'linkHoverDelayInstant',
    'linkTooltipTriggerClickLeft',
    'linkTooltipTriggerClickRight',
    'linkTooltipTriggerClickLeftDesc',
    'linkTooltipTriggerClickRightDesc',
    'linkTooltipTriggerTouchNote',
    'linkTooltipTriggerHoverUnavailable',
    'linkTooltipTriggerClickRightUnavailable',
    'linkShowVisitCount',
    'linkShowVisitCountDesc',
    'linkShowVisitCountAlways',
    'linkShowVisitCountNever',
    'linkShowVisitCountUnfamiliar',
    'linkShowVisitCountFamiliar',
    'linkShortUrlSection',
    'linkShortUrlSectionWarning',
    'linkShortUrlModeOff',
    'linkShortUrlModeButton',
    'linkShortUrlModeButtonDesc',
    'linkShortUrlModeAuto',
    'linkShortUrlModeAutoDesc',
    'linkShortUrlShowFullUrl',
    'linkShortUrlTraceChain',
    'linkShortUrlResolveAny',
    'linkShortUrlResolveAnyDesc',
    'linkShortUrlListUpdateUrl',
    'linkShortUrlListUpdateUrlDesc',
    'linkShortUrlResetCustom',
    'linkScopeMode',
    'linkScopeModeDesc',
    'linkScopeEverywhere',
    'linkScopeWhitelist',
    'linkScopeBlacklist',
    'linkScopeDomains',
    'linkScopeDomainsNote',
    'antiTamperingSettings',
    'antiTamperingSettingsDesc',
    'antiTamperingExcludedDomains',
    'antiTamperingExcludedDomainsDesc',
    'linkShortUrlCustomDomains',
    'linkShortUrlCustomDomainsDesc',
    'themeSettings',
    'themeSystem',
    'themeLight',
    'themeDark',
    'emailListsTitle',
    'emailListsDesc',
    'emailCustomPublicLabel',
    'emailCustomPublicDesc',
    'emailCustomDisposableLabel',
    'emailCustomDisposableDesc',
    'emailDisposableUpdateUrlLabel',
    'emailDisposableUpdateUrlDesc',
    'emailPublicUpdateUrlLabel',
    'emailPublicUpdateUrlDesc',
    'emailDisposableUpdateNow',
    'emailDisposableUpdateSuccess',
    'emailDisposableUpdateError',
  ]

  const newTranslations: Record<string, string> = {}
  for (const key of translationKeys) {
    newTranslations[key] = t.value(key)
  }
  translations.value = newTranslations
}

// Update translations when language changes or when translations are loaded
watch([currentLanguage, isLoaded], () => {
  updateTranslations()
}, { immediate: true })

// Watch notification settings changes
watch(() => settings.value.showWarningNotification, async (newVal) => {
  if (newVal && ['browser', 'both'].includes(settings.value.notificationStyle)) {
    const granted = await browser.permissions.request({
      permissions: ['notifications'],
    })
    if (!granted) {
      // If permission denied, fallback to in-page notifications
      settings.value.notificationStyle = 'in-page'
      // eslint-disable-next-line no-alert
      alert(t.value('notificationPermissionRequired'))
    }
  }
})

watch(() => settings.value.notificationStyle, async (newVal) => {
  if (settings.value.showWarningNotification && ['browser', 'both'].includes(newVal)) {
    const granted = await browser.permissions.request({
      permissions: ['notifications'],
    })
    if (!granted) {
      // If permission denied, fallback to in-page notifications
      settings.value.notificationStyle = 'in-page'
      // eslint-disable-next-line no-alert
      alert(t.value('notificationPermissionRequired'))
    }
  }
})

// The shipped list is ordinary editable text rather than a hidden default, so a
// line the user does not want can simply be deleted – including all of them.
// Reset puts the shipped list back for when an edit goes wrong.
const lookupServicesDefault = serializeLookupServices(DEFAULT_LOOKUP_SERVICES)

function resetLookupServices() {
  settings.value.lookupServices = lookupServicesDefault
}

// Custom shorteners (stored in browser.storage.local as string[])
const customShortenersText = ref('')

// Custom email domain lists (stored in browser.storage.local as string[])
const customPublicProvidersText = ref('')
const customDisposableText = ref('')

type UpdateStatus = 'idle' | 'loading' | 'success' | 'error'
interface RemoteListInfo { count: number, updatedAt: number, sources?: number, failed?: number }

const publicUpdateStatus = ref<UpdateStatus>('idle')
const publicRemoteInfo = ref<RemoteListInfo | null>(null)
const disposableUpdateStatus = ref<UpdateStatus>('idle')
const disposableRemoteInfo = ref<RemoteListInfo | null>(null)
const shortenerUpdateStatus = ref<UpdateStatus>('idle')
const shortenerRemoteInfo = ref<RemoteListInfo | null>(null)

// Last import of any kind, including the automatic one at install
const lastImport = ref<HistoryImportState | null>(null)
const lastImportLabel = computed(() => {
  const state = lastImport.value
  if (!state || !state.finishedAt || !state.domains)
    return null
  return `${new Date(state.finishedAt).toLocaleDateString()} · ${state.domains.toLocaleString()}`
})

onMounted(async () => {
  // Zoom set on this page belongs to this page. Extension pages share one
  // origin, so without this the popup inherits whatever is chosen here.
  isolatePageZoom()

  const stored = await browser.storage.local.get([
    'customShorteners',
    STORAGE_KEY_CUSTOM_PUBLIC,
    STORAGE_KEY_CUSTOM_DISPOSABLE,
    STORAGE_KEY_REMOTE_PUBLIC,
    STORAGE_KEY_REMOTE_DISPOSABLE,
    STORAGE_KEY_REMOTE_SHORTENERS,
  ])
  const list = (stored.customShorteners as string[]) || []
  customShortenersText.value = list.join('\n')
  customPublicProvidersText.value = ((stored[STORAGE_KEY_CUSTOM_PUBLIC] as string[]) || []).join('\n')
  customDisposableText.value = ((stored[STORAGE_KEY_CUSTOM_DISPOSABLE] as string[]) || []).join('\n')

  // What a previous update fetched, so the page opens showing the current state
  for (const [key, info] of [
    [STORAGE_KEY_REMOTE_PUBLIC, publicRemoteInfo],
    [STORAGE_KEY_REMOTE_DISPOSABLE, disposableRemoteInfo],
    [STORAGE_KEY_REMOTE_SHORTENERS, shortenerRemoteInfo],
  ] as const) {
    const remote = stored[key] as { domains?: string[], updatedAt?: number } | undefined
    if (remote?.domains?.length)
      info.value = { count: remote.domains.length, updatedAt: remote.updatedAt || 0 }
  }

  lastImport.value = await readHistoryImportState()
})

watch(customShortenersText, async (newVal) => {
  const list = newVal.split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean)
  await browser.storage.local.set({ customShorteners: list })
})

watch(customPublicProvidersText, async (newVal) => {
  const list = newVal.split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean)
  await browser.storage.local.set({ [STORAGE_KEY_CUSTOM_PUBLIC]: list })
})

watch(customDisposableText, async (newVal) => {
  const list = newVal.split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean)
  await browser.storage.local.set({ [STORAGE_KEY_CUSTOM_DISPOSABLE]: list })
})

const publicListUrls = computed(() => parseListUrls(settings.value.publicEmailListUrl || ''))
const disposableListUrls = computed(() => parseListUrls(settings.value.disposableEmailListUrl || ''))
const shortenerListUrls = computed(() => parseListUrls(settings.value.linkSafety?.shortUrlListUpdateUrl || ''))

/**
 * Fetch every source for one list, merge, persist for all contexts.
 *
 * Every source failing is an error, and anything less is a partial success worth
 * keeping, with the failure count shown rather than swallowed.
 */
async function updateRemoteList(options: {
  urls: string[]
  status: Ref<UpdateStatus>
  info: Ref<RemoteListInfo | null>
  storageKey: string
  fetchLists: (urls: string[]) => Promise<{ domains: string[], ok: number, failed: number }>
  /** Applies the result to this page's own runtime sets, where it has them */
  apply?: (domains: string[]) => void
}) {
  const { urls, status, info, storageKey, fetchLists, apply } = options
  if (!urls.length || status.value === 'loading')
    return

  status.value = 'loading'

  const { domains, ok, failed } = await fetchLists(urls)
  if (!ok) {
    status.value = 'error'
    return
  }

  const updatedAt = Date.now()
  await browser.storage.local.set({ [storageKey]: { domains, updatedAt, urls } })
  apply?.(domains)

  info.value = { count: domains.length, updatedAt, sources: ok, failed }
  status.value = 'success'
}

function updatePublicListNow() {
  return updateRemoteList({
    urls: publicListUrls.value,
    status: publicUpdateStatus,
    info: publicRemoteInfo,
    storageKey: STORAGE_KEY_REMOTE_PUBLIC,
    fetchLists: fetchRemoteDomainLists,
    apply: updatePublicList,
  })
}

function updateDisposableListNow() {
  return updateRemoteList({
    urls: disposableListUrls.value,
    status: disposableUpdateStatus,
    info: disposableRemoteInfo,
    storageKey: STORAGE_KEY_REMOTE_DISPOSABLE,
    fetchLists: fetchRemoteDomainLists,
    apply: updateDisposableList,
  })
}

// No `apply` here: the settings page deliberately does not import the shortener
// module, which carries the built-in list as a ~100 kB string
function updateShortenerListNow() {
  return updateRemoteList({
    urls: shortenerListUrls.value,
    status: shortenerUpdateStatus,
    info: shortenerRemoteInfo,
    storageKey: STORAGE_KEY_REMOTE_SHORTENERS,
    fetchLists: fetchRemoteShortenerLists,
  })
}

// Loading states
const isImporting = ref(false)
const importProgress = ref({ current: 0, total: 0 })
const importCancelled = ref(false)
const showResetConfirm = ref(false)

// Said out loud rather than left to be inferred from a date, because the whole
// point of this line is that nobody has to guess whether the import worked
// Firefox for Android has no history API, so there is nothing to import and no
// state to report – the browser is the answer, before any stored state is read
const canImportHistory = hasHistoryApi()

// A phone has no hovering and no right click, which decides what the link-check
// trigger below can actually do
const pointerCanHover = supportsHover()
const importHealth = computed<ImportHealth>(() => canImportHistory
  ? describeImportHealth(lastImport.value, Date.now(), isImporting.value)
  : 'unsupported')
const importStatusText = computed(() => translations.value[`importStatus${
  importHealth.value.charAt(0).toUpperCase()}${importHealth.value.slice(1)}`])
const importStatusColor = computed(() => ({
  complete: 'bg-green-500',
  running: 'bg-blue-500',
  never: 'bg-gray-400',
  partial: 'bg-amber-500',
  interrupted: 'bg-amber-500',
  cancelled: 'bg-amber-500',
  failed: 'bg-red-500',
  // Not a failure, but not a shrug either: nothing will ever be imported here,
  // and that is worth seeing rather than reading past
  unsupported: 'bg-amber-500',
}[importHealth.value]))

// Reset selection states
const resetSelections = ref({
  visits: false,
  settings: false,
  customShorteners: false,
})

// Language settings
const availableLanguages = [
  { code: 'en', name: 'languageEnglish' },
  { code: 'ru', name: 'languageRussian' },
  { code: 'uk', name: 'languageUkrainian' },
]

// Function to change language
async function changeLanguage(langCode: string) {
  // setLanguage handles both UI update and storage persistence
  await setLanguage(langCode)
  updateTranslations()
}

// Milliseconds are the unit the code needs, seconds are what a person reads
const hoverDelayLabel = computed(() => {
  const ms = settings.value.linkSafety?.hoverDelay ?? defaultSettings.linkSafety.hoverDelay
  return ms === 0 ? translations.value.linkHoverDelayInstant : `${(ms / 1000).toFixed(2)} ${translations.value.linkHoverDelaySeconds}`
})

function updateHoverDelay(value: string) {
  settings.value = {
    ...settings.value,
    linkSafety: { ...settings.value.linkSafety, hoverDelay: Number(value) },
  }
}

// Convert string values to numbers when updating thresholds
function updateSafetyThreshold(value: string) {
  settings.value = {
    ...settings.value,
    safety: Number(value),
  }
}

// Database management functions

function cancelImport() {
  importCancelled.value = true
}

/**
 * Re-run an import by hand.
 *
 * The quick import already ran on its own at install, so both buttons here are
 * top-ups rather than setup: full fills in the first-visit dates and active-day
 * counts the quick pass cannot know, quick catches up a history that has moved
 * on since (another device syncing in, a profile that was empty at install).
 * Both are idempotent – mergeImportedStats folds by min/max, never by addition.
 */
async function importHistory(mode: 'quick' | 'full') {
  isImporting.value = true
  importCancelled.value = false

  try {
    const result = await runHistoryImport({
      mode,
      onProgress: (state) => {
        importProgress.value = { current: state.current, total: state.total }
      },
      shouldStop: () => importCancelled.value,
    })
    lastImport.value = result

    // An import can move thousands of domains across the familiarity threshold,
    // so the lookalike reference set has to be rebuilt rather than nudged
    try {
      await browser.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} })
    }
    catch {
      // Background asleep – it rebuilds on next use anyway
    }
  }
  finally {
    isImporting.value = false
    importCancelled.value = false
    importProgress.value = { current: 0, total: 0 }
  }
}

async function resetSelected() {
  showResetConfirm.value = false

  if (resetSelections.value.visits) {
    // Get all keys from storage
    const result = await browser.storage.local.get(null)
    const keysToRemove = Object.keys(result).filter(key =>
      // Remove only visit counts (entries that are not settings). The
      // auto-import flag survives: wiping the visits is a deliberate choice,
      // and without the flag the next extension update would see an empty
      // profile and quietly import the history back.
      key !== 'settings' && key !== HISTORY_AUTO_IMPORT_KEY,
    )
    // Remove all visit count entries
    await browser.storage.local.remove(keysToRemove)
  }

  if (resetSelections.value.settings) {
    // Reset settings to defaults
    settings.value = { ...defaultSettings }
    // Custom shorteners are part of settings UI, reset them too
    await browser.storage.local.remove('customShorteners')
    customShortenersText.value = ''
  }

  if (resetSelections.value.customShorteners) {
    await browser.storage.local.remove('customShorteners')
    customShortenersText.value = ''
  }

  // Reset selections
  resetSelections.value = {
    visits: false,
    settings: false,
    customShorteners: false,
  }
}

// ==========================================
// Contents of the page
// ==========================================

/** In page order, which is the only order a table of contents may be in. */
const SECTION_IDS = [
  ['general', 'generalSettings'],
  ['display', 'displaySettings'],
  ['notifications', 'notificationSettings'],
  ['tampering', 'antiTamperingSettings'],
  ['link-safety', 'linkSafetySettings'],
  ['lookups', 'lookupServicesLabel'],
  ['email-lists', 'emailListsTitle'],
  ['data', 'databaseManagement'],
] as const

const sections = computed(() =>
  SECTION_IDS.map(([id, key]) => ({ id, title: translations.value[key] || key })))

const activeSection = ref<string>(SECTION_IDS[0][0])

/**
 * Which section the reader is looking at.
 *
 * Whichever crossed the top of the viewport last, rather than whichever is most
 * visible: a short section sandwiched between long ones would never win on area
 * and could not be reached by scrolling at all.
 */
function watchSections() {
  const observed = SECTION_IDS
    .map(([id]) => document.getElementById(`section-${id}`))
    .filter((el): el is HTMLElement => Boolean(el))

  if (!observed.length)
    return

  const onScroll = () => {
    // The last section never reaches the top of the viewport – the page runs out
    // of scroll before it gets there – so it could never be marked as read
    // without this. At the bottom, anything that has come into view has won.
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

    let current = observed[0]
    for (const el of observed) {
      const { top } = el.getBoundingClientRect()
      // A little slack, so a section resting just under the top edge counts as
      // the one being read rather than the one above it
      if (top <= 80 || (atBottom && top < window.innerHeight))
        current = el
    }
    activeSection.value = current.id.replace('section-', '')
  }

  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  onUnmounted(() => window.removeEventListener('scroll', onScroll))
}

// The whole page is behind a loading spinner until the translations land, so
// there is nothing to observe before that
watch(isLoaded, async (loaded) => {
  if (!loaded)
    return
  await nextTick()
  watchSections()
}, { immediate: true })

// Watch for changes in settings
watch(settings, (_newVal, _oldVal) => { }, { deep: true })
</script>

<template>
  <!-- Left-aligned by default. The page used to centre everything and have each
       block opt out, which meant a new description was centred until somebody
       noticed – so the two things that really are centred say so themselves. -->
  <main class="px-4 py-10 text-left text-gray-700 dark:text-gray-200">
    <div v-if="!isLoaded" class="flex justify-center items-center h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
    </div>

    <div v-else>
      <img :src="logo" style="max-width: 300px;" class="mx-auto" :alt="translations.extensionName">
      <div class="text-xl font-bold mb-6 text-center">
        {{ translations.settings }}
      </div>

      <!-- Too narrow for a column beside the settings, so it goes above them -->
      <div class="xl:hidden max-w-md mx-auto mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <SectionNav :sections="sections" :active-id="activeSection" :heading="translations.onThisPage" />
      </div>

      <div class="relative max-w-md mx-auto space-y-6">
        <!-- General Settings -->
        <div id="section-general" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-4">
            {{ translations.generalSettings }}
          </h2>

          <!-- Language Settings -->
          <div class="flex flex-col items-start mb-6">
            <label class="text-sm font-medium mb-2">{{ translations.selectLanguage }}</label>
            <select
              v-model="currentLanguage"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              @change="(e) => changeLanguage((e.target as HTMLSelectElement).value)"
            >
              <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">
                {{ translations[lang.name] }}
              </option>
            </select>
          </div>

          <!-- Theme Settings -->
          <div class="flex flex-col items-start mb-6">
            <label class="text-sm font-medium mb-2">{{ translations.themeSettings }}</label>
            <select
              v-model="settings.theme"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="system">
                {{ translations.themeSystem }}
              </option>
              <option value="light">
                {{ translations.themeLight }}
              </option>
              <option value="dark">
                {{ translations.themeDark }}
              </option>
            </select>
          </div>

          <!-- Threshold Settings -->
          <div class="space-y-4">
            <div class="flex flex-col items-start">
              <label class="text-sm font-medium mb-1">{{ translations.visitsThreshold }}</label>
              <div class="flex items-center w-full">
                <input
                  :value="settings.safety" type="number" min="1"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  :placeholder="translations.defaultSafetyThreshold" @input="updateSafetyThreshold(($event.target as HTMLInputElement).value)"
                >
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.visitsThresholdDesc }}
              </p>
            </div>
          </div>
        </div>

        <!-- Display Settings -->
        <div id="section-display" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.displaySettings }}
          </h2>

          <!-- Said once for the whole section: both toggles draw on the same
               icon, and neither shows anything while it is hidden in the menu -->
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.displaySettingsPinNote }}
          </p>

          <div class="space-y-4">
            <div class="flex items-start justify-between">
              <div>
                <label class="text-sm font-medium">{{ translations.dynamicIcon }}</label>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ translations.dynamicIconDesc }}
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input v-model="settings.changeIcon" type="checkbox" class="sr-only peer">
                <div
                  class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
                />
              </label>
            </div>

            <div class="flex items-start justify-between">
              <div>
                <label class="text-sm font-medium">{{ translations.showBadge }}</label>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ translations.showBadgeDesc }}
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input v-model="settings.showBadge" type="checkbox" class="sr-only peer">
                <div
                  class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
                />
              </label>
            </div>
          </div>
        </div>

        <!-- Notification Settings -->
        <div id="section-notifications" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-4">
            {{ translations.notificationSettings }}
          </h2>

          <!-- Show Notifications Toggle -->
          <div class="flex items-start justify-between mb-4">
            <div>
              <label class="text-sm font-medium">{{ translations.showWarningNotification }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ translations.showWarningNotificationDesc }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="settings.showWarningNotification" type="checkbox" class="sr-only peer">
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
              />
            </label>
          </div>
          <!-- <div> -->
          <div v-if="settings.showWarningNotification">
            <!-- Warning Trigger Events Section -->
            <div class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-3">
                {{ translations.warningTriggerEventsTitle }}:
              </h3>

              <div class="space-y-3">
                <label class="flex items-start">
                  <input
                    type="radio" name="warningType" value="input"
                    :checked="settings.showInputWarning && !settings.showCopyWarning"
                    class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;" @change="() => {
                      settings.showInputWarning = true;
                      settings.showCopyWarning = false;
                    }"
                  >
                  <span class="ml-2">
                    <span class="block">{{ translations.showInputWarning }}</span>
                    <span class="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {{ translations.showInputWarningDesc }}
                    </span>
                  </span>
                </label>
                <label class="flex items-start">
                  <input
                    type="radio" name="warningType" value="copy"
                    :checked="!settings.showInputWarning && settings.showCopyWarning"
                    class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;" @change="() => {
                      settings.showInputWarning = false;
                      settings.showCopyWarning = true;
                    }"
                  >
                  <span class="ml-2">
                    <span class="block">{{ translations.showCopyWarning }}</span>
                    <span class="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {{ translations.showCopyWarningDesc }}
                    </span>
                  </span>
                </label>
                <label class="flex items-start">
                  <input
                    type="radio" name="warningType" value="both"
                    :checked="settings.showInputWarning && settings.showCopyWarning"
                    class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;" @change="() => {
                      settings.showInputWarning = true;
                      settings.showCopyWarning = true;
                    }"
                  >
                  <span class="ml-2">{{ translations.bothWarningTriggers }}</span>
                </label>
              </div>

              <!-- Only offered where it applies: holding a paste is meaningless
                   if pasting is not one of the moments being watched -->
              <div v-if="settings.showInputWarning" class="flex items-start justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div class="pr-3">
                  <label class="text-sm font-medium">{{ translations.blockPasteOnUnfamiliar }}</label>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ translations.blockPasteOnUnfamiliarDesc }}
                  </p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input v-model="settings.blockPasteOnUnfamiliar" type="checkbox" class="sr-only peer">
                  <div
                    class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
                  />
                </label>
              </div>
            </div>

            <!-- Notification Style -->
            <div class="space-y-2">
              <div class="mt-6">
                <h3 class="text-sm font-medium mb-3">
                  {{ translations.notificationStyle }}
                </h3>
                <div class="space-y-3">
                  <label class="flex items-start">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="browser"
                      class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2">
                      <span class="block">{{ translations.browserNotifications }}</span>
                      <span class="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {{ translations.browserNotificationsDesc }}
                      </span>
                    </span>
                  </label>
                  <label class="flex items-start">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="in-page"
                      class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2">
                      <span class="block">{{ translations.inPageNotifications }}</span>
                      <span class="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {{ translations.inPageNotificationsDesc }}
                      </span>
                    </span>
                  </label>
                  <label class="flex items-start">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="both"
                      class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2">{{ translations.bothNotifications }}</span>
                  </label>
                </div>

                <!-- Below the options rather than beside one of them: it is a
                     remark on the choice as a whole, and the point only lands
                     once both trade-offs have been read -->
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  {{ translations.notificationStylePinNote }}
                </p>
              </div>
            </div>
          </div>
        </div>
        <!-- Anti-Tampering Settings -->
        <div id="section-tampering" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.antiTamperingSettings }}
          </h2>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.antiTamperingSettingsDesc }}
          </p>

          <div>
            <label class="text-sm font-medium">{{ translations.antiTamperingExcludedDomains }}</label>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {{ translations.antiTamperingExcludedDomainsDesc }}
            </p>
            <textarea
              v-model="settings.antiTamperingExcludedDomains"
              wrap="off"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              rows="3"
              placeholder="example.com&#10;another-site.org"
            />
          </div>
        </div>

        <!-- Link Safety Settings -->
        <div id="section-link-safety" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.linkSafetySettings }}
          </h2>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.linkSafetySettingsDesc }}
          </p>

          <!-- Master Toggle -->
          <div class="flex items-start justify-between mb-4">
            <div>
              <label class="text-sm font-medium">{{ translations.linkSafetyEnabled }}</label>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="settings.linkSafety.enabled" type="checkbox" class="sr-only peer">
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
              />
            </label>
          </div>

          <div v-if="settings.linkSafety.enabled">
            <!-- Scope Mode -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-1">
                {{ translations.linkScopeMode }}:
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkScopeModeDesc }}
              </p>
              <div class="space-y-2">
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="everywhere"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkScopeEverywhere }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="whitelist"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkScopeWhitelist }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="blacklist"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkScopeBlacklist }}</span>
                </label>
              </div>

              <!-- Domain List -->
              <div v-if="settings.linkSafety.scopeMode !== 'everywhere'" class="mt-3">
                <textarea
                  v-model="settings.linkSafety.scopeDomains"
                  wrap="off"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  rows="3"
                  :placeholder="translations.linkScopeDomains"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ translations.linkScopeDomainsNote }}
                </p>
              </div>
            </div>

            <!-- Tooltip Trigger -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-3">
                {{ translations.linkTooltipTrigger }}:
              </h3>
              <!-- Said before the choice, not after it: on a touchscreen two of
                   the three options below cannot fire at all -->
              <p v-if="!pointerCanHover" class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkTooltipTriggerTouchNote }}
              </p>
              <div class="space-y-2">
                <!-- Hovering and right-clicking are disabled rather than hidden
                     on a touchscreen: a choice that silently does nothing is
                     worse than one the device visibly cannot offer, and hiding
                     them would leave a profile whose stored trigger is one of
                     the two with nothing on screen to explain itself. -->
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="hover"
                    :disabled="!pointerCanHover"
                    class="h-4 w-4 flex-shrink-0" :class="{ 'opacity-50': !pointerCanHover }" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">
                    <span :class="{ 'opacity-50': !pointerCanHover }">{{ translations.linkTooltipTriggerHover }}</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400" :class="{ 'opacity-50': !pointerCanHover }">{{ translations.linkTooltipTriggerHoverDesc }}</p>
                    <!-- Full strength while the option it belongs to is dimmed: the
                         reason is the one thing here still worth reading -->
                    <p v-if="!pointerCanHover" class="text-xs text-amber-600 dark:text-amber-400">
                      {{ translations.linkTooltipTriggerHoverUnavailable }}
                    </p>
                  </span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="click-left"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">
                    <span>{{ translations.linkTooltipTriggerClickLeft }}</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ translations.linkTooltipTriggerClickLeftDesc }}</p>
                  </span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="click-right"
                    :disabled="!pointerCanHover"
                    class="h-4 w-4 flex-shrink-0" :class="{ 'opacity-50': !pointerCanHover }" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">
                    <span :class="{ 'opacity-50': !pointerCanHover }">{{ translations.linkTooltipTriggerClickRight }}</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400" :class="{ 'opacity-50': !pointerCanHover }">{{ translations.linkTooltipTriggerClickRightDesc }}</p>
                    <p v-if="!pointerCanHover" class="text-xs text-amber-600 dark:text-amber-400">
                      {{ translations.linkTooltipTriggerClickRightUnavailable }}
                    </p>
                  </span>
                </label>
              </div>

              <!-- Below the options rather than nested inside one: a control that
                   outweighed the choice it belongs to read as the more important
                   of the two. Only the hover trigger has a delay to set, and only
                   where hovering happens at all. -->
              <div v-if="settings.linkSafety.tooltipTrigger === 'hover' && pointerCanHover" class="mt-4">
                <div class="flex items-center justify-between gap-3 mb-1">
                  <label class="text-sm font-medium">{{ translations.linkHoverDelay }}</label>
                  <span class="text-sm font-mono flex-shrink-0">{{ hoverDelayLabel }}</span>
                </div>
                <input
                  :value="settings.linkSafety.hoverDelay"
                  type="range" min="0" max="1500" step="50"
                  class="w-full"
                  style="accent-color: #3b82f6;"
                  @input="updateHoverDelay(($event.target as HTMLInputElement).value)"
                >
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ translations.linkHoverDelayDesc }}
                </p>
              </div>
            </div>

            <!-- Show Visit Count -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-1">
                {{ translations.linkShowVisitCount }}:
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkShowVisitCountDesc }}
              </p>
              <div class="space-y-2">
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="always"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountAlways }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="unfamiliar"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountUnfamiliar }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="familiar"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountFamiliar }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="never"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountNever }}</span>
                </label>
              </div>
            </div>

            <!-- Shortened URL Settings -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-1">
                {{ translations.linkShortUrlSection }}
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkShortUrlSectionWarning }}
              </p>

              <!-- Mode: off / button / auto -->
              <div class="space-y-3 mb-3">
                <label class="flex items-start cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="off" class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">{{ translations.linkShortUrlModeOff }}</span>
                </label>
                <label class="flex items-start cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="button" class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">
                    <span class="block">{{ translations.linkShortUrlModeButton }}</span>
                    <span class="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {{ translations.linkShortUrlModeButtonDesc }}
                    </span>
                  </span>
                </label>
                <label class="flex items-start cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="auto" class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">
                    <span class="block">{{ translations.linkShortUrlModeAuto }}</span>
                    <span class="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {{ translations.linkShortUrlModeAutoDesc }}
                    </span>
                  </span>
                </label>
              </div>

              <!-- Sub-options (only when not off) -->
              <div v-if="settings.linkSafety.shortUrlMode !== 'off'" class="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                <!-- Show full URL -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlShowFullUrl" type="checkbox" class="flex-shrink-0 rounded" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; accent-color: #3b82f6;">
                  <span class="text-sm">{{ translations.linkShortUrlShowFullUrl }}</span>
                </label>

                <!-- Show redirect chain -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlTraceChain" type="checkbox" class="flex-shrink-0 rounded" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; accent-color: #3b82f6;">
                  <span class="text-sm">{{ translations.linkShortUrlTraceChain }}</span>
                </label>

                <!-- Resolve any URL -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlResolveAny" type="checkbox" class="flex-shrink-0 rounded" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; accent-color: #3b82f6;">
                  <span class="text-sm">{{ translations.linkShortUrlResolveAny }}</span>
                </label>
                <p v-if="settings.linkSafety.shortUrlResolveAny" class="text-xs text-gray-500 dark:text-gray-400 ml-6">
                  {{ translations.linkShortUrlResolveAnyDesc }}
                </p>

                <!-- Custom shortener domains -->
                <div>
                  <label class="text-sm font-medium">{{ translations.linkShortUrlCustomDomains }}</label>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {{ translations.linkShortUrlCustomDomainsDesc }}
                  </p>
                  <textarea
                    v-model="customShortenersText"
                    wrap="off"
                    class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    rows="3"
                    placeholder="short.link&#10;go.example.com"
                  />
                </div>

                <!-- Remote list update URLs -->
                <div>
                  <label class="text-sm font-medium">{{ translations.linkShortUrlListUpdateUrl }}</label>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {{ translations.linkShortUrlListUpdateUrlDesc }}
                  </p>
                  <textarea
                    v-model="settings.linkSafety.shortUrlListUpdateUrl"
                    wrap="off"
                    rows="3"
                    spellcheck="false"
                    class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                    placeholder="https://raw.githubusercontent.com/...&#10;https://example.com/another-list.txt"
                  />
                  <button
                    class="btn-primary btn-sm w-full mt-2 whitespace-nowrap"
                    :disabled="shortenerUpdateStatus === 'loading' || !shortenerListUrls.length"
                    @click="updateShortenerListNow"
                  >
                    {{ translations.emailDisposableUpdateNow }}
                  </button>
                  <p v-if="shortenerUpdateStatus === 'success' && shortenerRemoteInfo" class="text-xs mt-1" :class="shortenerRemoteInfo.failed ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">
                    {{ translations.emailDisposableUpdateSuccess }}: {{ shortenerRemoteInfo.count }}
                    <template v-if="shortenerRemoteInfo.sources">
                      · {{ translations.emailDisposableSources }}: {{ shortenerRemoteInfo.sources }}
                    </template>
                    <template v-if="shortenerRemoteInfo.failed">
                      · {{ translations.emailDisposableSourcesFailed }}: {{ shortenerRemoteInfo.failed }}
                    </template>
                  </p>
                  <p v-else-if="shortenerUpdateStatus === 'error'" class="text-xs text-red-500 dark:text-red-400 mt-1">
                    {{ translations.emailDisposableUpdateError }}
                  </p>
                  <p v-else-if="shortenerRemoteInfo" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {{ translations.emailDisposableUpdateSuccess }}: {{ shortenerRemoteInfo.count }} ({{ new Date(shortenerRemoteInfo.updatedAt).toLocaleDateString() }})
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Lookup links – links the user may follow, never requests the extension makes -->
        <div id="section-lookups" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-semibold text-center">
              {{ translations.lookupServicesLabel }}
            </h2>
            <button
              class="btn-ghost btn-sm !rounded"
              :disabled="settings.lookupServices === lookupServicesDefault"
              @click="resetLookupServices"
            >
              {{ translations.lookupServicesReset }}
            </button>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.lookupServicesNote }}
          </p>

          <div>
            <textarea
              v-model="settings.lookupServices"
              wrap="off"
              rows="6"
              spellcheck="false"
              class="w-full px-2 py-1.5 text-xs font-mono rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 bg-white"
            />
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {{ translations.lookupServicesDesc }}
            </p>
          </div>
        </div>

        <!-- Email Domain Lists -->
        <div id="section-email-lists" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.emailListsTitle }}
          </h2>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.emailListsDesc }}
          </p>

          <div class="space-y-4">
            <!-- Public providers: what the user adds, then where more come from -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailCustomPublicLabel }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {{ translations.emailCustomPublicDesc }}
              </p>
              <textarea
                v-model="customPublicProvidersText"
                wrap="off"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                rows="3"
                placeholder="mail.example.com"
              />
            </div>

            <!-- Remote public provider list update -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailPublicUpdateUrlLabel }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {{ translations.emailPublicUpdateUrlDesc }}
              </p>
              <textarea
                v-model="settings.publicEmailListUrl"
                wrap="off"
                rows="3"
                spellcheck="false"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                placeholder="https://raw.githubusercontent.com/.../free.txt&#10;https://example.com/another-list.txt"
              />
              <button
                class="btn-primary btn-sm w-full mt-2 whitespace-nowrap"
                :disabled="publicUpdateStatus === 'loading' || !publicListUrls.length"
                @click="updatePublicListNow"
              >
                {{ translations.emailDisposableUpdateNow }}
              </button>
              <p v-if="publicUpdateStatus === 'success' && publicRemoteInfo" class="text-xs mt-1" :class="publicRemoteInfo.failed ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">
                {{ translations.emailDisposableUpdateSuccess }}: {{ publicRemoteInfo.count }}
                <template v-if="publicRemoteInfo.sources">
                  · {{ translations.emailDisposableSources }}: {{ publicRemoteInfo.sources }}
                </template>
                <template v-if="publicRemoteInfo.failed">
                  · {{ translations.emailDisposableSourcesFailed }}: {{ publicRemoteInfo.failed }}
                </template>
              </p>
              <p v-else-if="publicUpdateStatus === 'error'" class="text-xs text-red-500 dark:text-red-400 mt-1">
                {{ translations.emailDisposableUpdateError }}
              </p>
              <p v-else-if="publicRemoteInfo" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.emailDisposableUpdateSuccess }}: {{ publicRemoteInfo.count }} ({{ new Date(publicRemoteInfo.updatedAt).toLocaleDateString() }})
              </p>
            </div>

            <!-- Disposable domains: the same pair, own list then sources -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailCustomDisposableLabel }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {{ translations.emailCustomDisposableDesc }}
              </p>
              <textarea
                v-model="customDisposableText"
                wrap="off"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                rows="3"
                placeholder="temp-mail.example&#10;trash.example.org"
              />
            </div>

            <!-- Remote disposable list update -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailDisposableUpdateUrlLabel }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {{ translations.emailDisposableUpdateUrlDesc }}
              </p>
              <textarea
                v-model="settings.disposableEmailListUrl"
                wrap="off"
                rows="3"
                spellcheck="false"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                placeholder="https://raw.githubusercontent.com/.../disposable_email_blocklist.conf&#10;https://example.com/another-list.txt"
              />
              <button
                class="btn-primary btn-sm w-full mt-2 whitespace-nowrap"
                :disabled="disposableUpdateStatus === 'loading' || !disposableListUrls.length"
                @click="updateDisposableListNow"
              >
                {{ translations.emailDisposableUpdateNow }}
              </button>
              <p v-if="disposableUpdateStatus === 'success' && disposableRemoteInfo" class="text-xs mt-1" :class="disposableRemoteInfo.failed ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">
                {{ translations.emailDisposableUpdateSuccess }}: {{ disposableRemoteInfo.count }}
                <template v-if="disposableRemoteInfo.sources">
                  · {{ translations.emailDisposableSources }}: {{ disposableRemoteInfo.sources }}
                </template>
                <template v-if="disposableRemoteInfo.failed">
                  · {{ translations.emailDisposableSourcesFailed }}: {{ disposableRemoteInfo.failed }}
                </template>
              </p>
              <p v-else-if="disposableUpdateStatus === 'error'" class="text-xs text-red-500 dark:text-red-400 mt-1">
                {{ translations.emailDisposableUpdateError }}
              </p>
              <p v-else-if="disposableRemoteInfo" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.emailDisposableUpdateSuccess }}: {{ disposableRemoteInfo.count }} ({{ new Date(disposableRemoteInfo.updatedAt).toLocaleDateString() }})
              </p>
            </div>
          </div>
        </div>

        <!-- Database Management -->
        <div id="section-data" class="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold text-center mb-4">
            {{ translations.databaseManagement }}
          </h2>

          <div class="space-y-4">
            <div>
              <!-- The import already ran on install, say so, or the two buttons
                   read as setup the user forgot to do. On a browser without a
                   history API there was no such run, and the status line below
                   is the whole story -->
              <p v-if="canImportHistory" class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {{ translations.importHistoryIntro }}
              </p>
              <div class="flex items-start gap-2 mb-3">
                <span class="mt-1.5 h-2 w-2 rounded-full flex-shrink-0" :class="importStatusColor" />
                <p
                  class="text-xs"
                  :class="importHealth === 'unsupported'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-600 dark:text-gray-300'"
                >
                  {{ importStatusText }}
                  <template v-if="lastImportLabel">
                    <br>
                    <span class="text-gray-500 dark:text-gray-400">
                      {{ translations.importLastRun }}: {{ lastImportLabel }} {{ translations.importSitesStored }}
                    </span>
                  </template>
                </p>
              </div>
              <button
                class="btn-primary w-full"
                :disabled="isImporting || !canImportHistory" @click="importHistory('full')"
              >
                <template v-if="!isImporting">
                  {{ translations.importHistoryFull }}
                </template>
                <template v-else>
                  {{ translations.importing }} {{ importProgress.current }}/{{ importProgress.total }}
                </template>
              </button>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.importHistoryFullDesc }}
              </p>
              <div v-if="isImporting" class="w-full h-1 mt-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-500 transition-all duration-200"
                  :style="{ width: `${importProgress.total ? (importProgress.current / importProgress.total) * 100 : 0}%` }"
                />
              </div>
              <button
                v-if="isImporting"
                class="btn-ghost btn-sm w-full mt-2"
                @click="cancelImport"
              >
                {{ translations.cancel }}
              </button>
              <!-- Unlike the automatic import, this one runs in the page and dies with it -->
              <p v-if="isImporting" class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {{ translations.importKeepPageOpen }}
              </p>

              <button
                class="btn-ghost w-full mt-3"
                :disabled="isImporting || !canImportHistory" @click="importHistory('quick')"
              >
                {{ translations.importHistoryQuick }}
              </button>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.importHistoryQuickDesc }}
              </p>
            </div>

            <div class="space-y-2">
              <div>
                <h3 class="text-sm font-medium mb-2">
                  {{ translations.resetData }}
                </h3>
                <div class="space-y-2">
                  <label class="flex items-start">
                    <input
                      v-model="resetSelections.visits" type="checkbox"
                      class="h-4 w-4 flex-shrink-0 rounded" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.visitsInfo }}</span>
                  </label>
                  <label class="flex items-start">
                    <input
                      v-model="resetSelections.settings" type="checkbox"
                      class="h-4 w-4 flex-shrink-0 rounded" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.allSettings }}</span>
                  </label>
                  <label class="flex items-start">
                    <input
                      v-model="resetSelections.customShorteners" type="checkbox"
                      class="h-4 w-4 flex-shrink-0 rounded" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.linkShortUrlResetCustom }}</span>
                  </label>
                </div>
              </div>

              <button
                class="btn-danger w-full mt-4"
                :disabled="isImporting || !Object.values(resetSelections).some(Boolean)"
                @click="showResetConfirm = true"
              >
                {{ translations.resetSelectedData }}
              </button>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.selectDataToReset }}
              </p>
            </div>
          </div>
        </div>

        <!-- Hung off the column's left edge rather than sharing a row with it:
             a row would push the settings off centre on every window wide
             enough to show the contents. Last child and out of the flow, so the
             column above is laid out exactly as it was without it – hence the
             forced margin reset, which the column's own spacing would undo. -->
        <div class="hidden xl:block absolute right-full top-0 h-full w-52 pr-8 !mt-0">
          <SectionNav
            :sections="sections" :active-id="activeSection"
            :heading="translations.onThisPage" class="sticky top-10"
          />
        </div>
      </div>
    </div>
  </main>

  <!-- Reset Confirmation Dialog -->
  <div v-if="showResetConfirm" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full">
      <h3 class="text-lg font-semibold mb-4">
        {{ translations.confirmReset }}
      </h3>
      <p class="text-sm text-gray-600 dark:text-gray-300 mb-2">
        {{ translations.confirmResetMessage }}
      </p>
      <ul class="list-disc list-inside mb-6 text-sm text-gray-600 dark:text-gray-300">
        <li v-if="resetSelections.visits">
          {{ translations.visitsInfo }}
        </li>
        <li v-if="resetSelections.settings">
          {{ translations.allSettings }}
        </li>
        <li v-if="resetSelections.customShorteners">
          {{ translations.linkShortUrlResetCustom }}
        </li>
      </ul>
      <p class="text-sm text-gray-600 dark:text-gray-300 mb-6">
        {{ translations.cannotBeUndone }}!
      </p>
      <div class="flex space-x-3">
        <button
          class="btn-primary flex-1"
          @click="showResetConfirm = false"
        >
          {{ translations.cancel }}
        </button>
        <button
          class="btn-danger flex-1"
          @click="resetSelected"
        >
          {{ translations.reset }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
}
</style>
