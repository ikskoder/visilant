<script setup lang="ts">
import type { Ref } from 'vue'
import type { BadgeContent } from '~/logic/badge'
import type { FamiliarityCriterionId, FamiliaritySettings } from '~/logic/familiarity'
import type { HistoryImportState, ImportHealth } from '~/logic/history-import'
import type { Settings, SiteVisitData } from '~/logic/storage'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { resolveBadgeContent } from '~/logic/badge'
import { fetchRemoteDomainLists, parseListUrls, STORAGE_KEY_CUSTOM_DISPOSABLE, STORAGE_KEY_CUSTOM_PUBLIC, STORAGE_KEY_REMOTE_DISPOSABLE, STORAGE_KEY_REMOTE_PUBLIC, updateDisposableList, updatePublicList } from '~/logic/email-providers'
import { enabledCriteria, FAMILIARITY_CRITERIA, normalizeFamiliarity, requiredMatches } from '~/logic/familiarity'
import { describeImportHealth, readHistoryImportState, runHistoryImport } from '~/logic/history-import'
import { fetchRemoteMailSiteLists, STORAGE_KEY_CUSTOM_MAIL_SITES, STORAGE_KEY_REMOTE_MAIL_SITES, updateRemoteMailSites } from '~/logic/mail-sites'
import { isolatePageZoom } from '~/logic/page-zoom'
import { hasContextMenus, hasHistoryApi, isAndroidBrowser, supportsHover } from '~/logic/platform'
import { fetchRemoteShortenerLists, STORAGE_KEY_REMOTE_SHORTENERS } from '~/logic/shortener-lists'
import { defaultSettings, settings } from '~/logic/storage'
import { visitKeysToRemove } from '~/logic/visit-reset'
import SectionNav from './SectionNav.vue'
import SectionReset from './SectionReset.vue'

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
    'familiaritySettings',
    'familiarityIntro',
    'familiarityVisits',
    'familiarityVisitsDesc',
    'familiarityActiveDays',
    'familiarityActiveDaysDesc',
    'familiarityAge',
    'familiarityAgeDesc',
    'familiarityAtLeastLabel',
    'familiarityVisitsUnit',
    'familiarityDaysUnit',
    'familiarityModeLabel',
    'familiarityModeAll',
    'familiarityModeAny',
    'familiarityModeAtLeast',
    'familiarityModeAtLeastLabel',
    'familiaritySummaryAll',
    'familiaritySummaryAny',
    'familiaritySummaryAtLeast',
    'familiarityKeepOne',
    'familiarityNeedsImportTitle',
    'familiarityNoDatesTitle',
    'familiarityNoDatesText',
    'familiarityNoImportTitle',
    'familiarityNoImportText',
    'familiarityNeedsImportText',
    'familiarityNeedsImportLink',
    'displaySettings',
    'displaySettingsPinNote',
    'displaySettingsPinNoteAndroid',
    'dynamicIcon',
    'dynamicIconDesc',
    'showBadge',
    'badgeContentLabel',
    'badgeContentDesc',
    'badgeContentVisits',
    'badgeContentActiveDays',
    'badgeContentAge',
    'badgeContentChecks',
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
    'importHistoryRun',
    'importHistoryFirstRun',
    'importHistoryRunDesc',
    'lookupServicesLabel',
    'lookupServicesDesc',
    'lookupServicesNote',
    'sectionReset',
    'optionsVerbose',
    'optionsVerboseDesc',
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
    'linkTooltipTriggerNoMenusNote',
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
    'emailMailSitesLabel',
    'emailMailSitesDesc',
    'emailMailSitesUpdateUrlLabel',
    'emailMailSitesUpdateUrlDesc',
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

// Custom shorteners (stored in browser.storage.local as string[])
const customShortenersText = ref('')

// Custom email domain lists (stored in browser.storage.local as string[])
const customPublicProvidersText = ref('')
const customDisposableText = ref('')

// Extra `address-domain = site` lines, on top of the built-in table
const customMailSitesText = ref('')

// Both the dynamic icon and the counter work on Firefox for Android – they are
// drawn in the browser's own menu, under Extensions – so this decides wording
// and nothing else. Asked of the browser rather than of the pointer, and once.
const isAndroid = ref(false)

/**
 * Which settings each section owns.
 *
 * Keyed by the section ids the table of contents already uses, so a card, its
 * entry in the contents and its reset button all name the same thing. A reset
 * cannot reach past the card it was pressed in, which is the whole point of
 * having one per section rather than a single button for the page. "Your data"
 * is absent on purpose: it holds no settings, and what it does hold – visits,
 * lists, the wholesale reset – is already spelled out there.
 */
const SECTION_SETTINGS: Record<string, (keyof Settings)[]> = {
  'general': ['theme', 'verboseOptions'],
  'familiarity': ['familiarity'],
  'display': ['showBadge', 'badgeContent', 'changeIcon'],
  'notifications': ['showWarningNotification', 'notificationStyle', 'showInputWarning', 'showCopyWarning', 'blockPasteOnUnfamiliar'],
  'tampering': ['antiTamperingExcludedDomains'],
  'link-safety': ['linkSafety'],
  'lookups': ['lookupServices'],
  'email-lists': ['disposableEmailListUrl', 'publicEmailListUrl', 'mailSiteListUrl'],
}

/**
 * The rest of what a section owns – lists kept in `storage.local` rather than in
 * the settings, edited on this page as one domain per line. Empty is their
 * default, and the watchers above write that through.
 */
const SECTION_TEXTS: Record<string, Ref<string>[]> = {
  'link-safety': [customShortenersText],
  'email-lists': [customPublicProvidersText, customDisposableText, customMailSitesText],
}

type UpdateStatus = 'idle' | 'loading' | 'success' | 'error'
interface RemoteListInfo { count: number, updatedAt: number, sources?: number, failed?: number }

const publicUpdateStatus = ref<UpdateStatus>('idle')
const publicRemoteInfo = ref<RemoteListInfo | null>(null)
const disposableUpdateStatus = ref<UpdateStatus>('idle')
const disposableRemoteInfo = ref<RemoteListInfo | null>(null)
const shortenerUpdateStatus = ref<UpdateStatus>('idle')
const shortenerRemoteInfo = ref<RemoteListInfo | null>(null)
const mailSiteUpdateStatus = ref<UpdateStatus>('idle')
const mailSiteRemoteInfo = ref<RemoteListInfo | null>(null)

/**
 * The last thing each section owns: the lists fetched from a source, cached in
 * `storage.local` for every context to read.
 *
 * A reset that put the source URL back to its default and emptied the custom
 * list used to leave the downloaded list untouched, still classifying links and
 * addresses by whatever the old URL had answered – while the reset button went
 * dead, reporting a section that stood at its defaults. Resetting a section
 * means what it says, so the cache goes with it.
 */
const SECTION_REMOTE: Record<string, { key: string, info: Ref<RemoteListInfo | null>, status: Ref<UpdateStatus>, clear?: () => void }[]> = {
  'link-safety': [
    // No `clear` on purpose: the settings page does not import the shortener
    // module, and the other contexts pick the removal up from storage
    { key: STORAGE_KEY_REMOTE_SHORTENERS, info: shortenerRemoteInfo, status: shortenerUpdateStatus },
  ],
  'email-lists': [
    { key: STORAGE_KEY_REMOTE_PUBLIC, info: publicRemoteInfo, status: publicUpdateStatus, clear: () => updatePublicList([]) },
    { key: STORAGE_KEY_REMOTE_DISPOSABLE, info: disposableRemoteInfo, status: disposableUpdateStatus, clear: () => updateDisposableList([]) },
    { key: STORAGE_KEY_REMOTE_MAIL_SITES, info: mailSiteRemoteInfo, status: mailSiteUpdateStatus, clear: () => updateRemoteMailSites([]) },
  ],
}

/** Whether a section already stands at its defaults, in which case its reset does nothing. */
function sectionIsDefault(id: string): boolean {
  const keys = SECTION_SETTINGS[id] || []
  const stored = settings.value
  return keys.every(key => JSON.stringify(stored[key]) === JSON.stringify(defaultSettings[key]))
    && (SECTION_TEXTS[id] || []).every(text => text.value.trim() === '')
    && (SECTION_REMOTE[id] || []).every(cache => cache.info.value === null)
}

/** Put one section back to how it ships, and nothing outside it. */
async function resetSection(id: string) {
  const patch: Record<string, unknown> = {}
  for (const key of SECTION_SETTINGS[id] || [])
    patch[key] = structuredClone(defaultSettings[key])

  settings.value = { ...settings.value, ...patch }

  for (const text of SECTION_TEXTS[id] || [])
    text.value = ''

  for (const cache of SECTION_REMOTE[id] || []) {
    await browser.storage.local.remove(cache.key)
    // This page holds its own copy of some of these lists, and the other
    // contexts are watching the same keys – so the removal above is what
    // reaches them, and this is only about the page doing the removing.
    cache.clear?.()
    cache.info.value = null
    cache.status.value = 'idle'
  }
}

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

  isAndroid.value = await isAndroidBrowser()

  const stored = await browser.storage.local.get([
    'customShorteners',
    STORAGE_KEY_CUSTOM_PUBLIC,
    STORAGE_KEY_CUSTOM_DISPOSABLE,
    STORAGE_KEY_REMOTE_PUBLIC,
    STORAGE_KEY_REMOTE_DISPOSABLE,
    STORAGE_KEY_REMOTE_SHORTENERS,
    STORAGE_KEY_CUSTOM_MAIL_SITES,
    STORAGE_KEY_REMOTE_MAIL_SITES,
  ])
  const list = (stored.customShorteners as string[]) || []
  customShortenersText.value = list.join('\n')
  customPublicProvidersText.value = ((stored[STORAGE_KEY_CUSTOM_PUBLIC] as string[]) || []).join('\n')
  customDisposableText.value = ((stored[STORAGE_KEY_CUSTOM_DISPOSABLE] as string[]) || []).join('\n')
  customMailSitesText.value = ((stored[STORAGE_KEY_CUSTOM_MAIL_SITES] as string[]) || []).join('\n')

  // What a previous update fetched, so the page opens showing the current state
  for (const [key, info] of [
    [STORAGE_KEY_REMOTE_PUBLIC, publicRemoteInfo],
    [STORAGE_KEY_REMOTE_DISPOSABLE, disposableRemoteInfo],
    [STORAGE_KEY_REMOTE_SHORTENERS, shortenerRemoteInfo],
    [STORAGE_KEY_REMOTE_MAIL_SITES, mailSiteRemoteInfo],
  ] as const) {
    const remote = stored[key] as { domains?: string[], updatedAt?: number } | undefined
    if (remote?.domains?.length)
      info.value = { count: remote.domains.length, updatedAt: remote.updatedAt || 0 }
  }

  lastImport.value = await readHistoryImportState()
  await readStatsCoverage()
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

// Mapping lines are stored as typed, separator and all – the parser is the one
// place that decides what a line means
watch(customMailSitesText, async (newVal) => {
  const list = newVal.split(/\n/).map(line => line.trim()).filter(Boolean)
  await browser.storage.local.set({ [STORAGE_KEY_CUSTOM_MAIL_SITES]: list })
})

const publicListUrls = computed(() => parseListUrls(settings.value.publicEmailListUrl || ''))
const disposableListUrls = computed(() => parseListUrls(settings.value.disposableEmailListUrl || ''))
const shortenerListUrls = computed(() => parseListUrls(settings.value.linkSafety?.shortUrlListUpdateUrl || ''))
const mailSiteListUrls = computed(() => parseListUrls(settings.value.mailSiteListUrl || ''))

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

  // Anything thrown past the fetcher's own handling – a storage quota, a source
  // that answered with a gigabyte – has to land on the button. Without this the
  // status stayed on `loading`, which also disables the button, so one unlucky
  // update left the section unable to try again until the page was reloaded.
  try {
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
  catch {
    status.value = 'error'
  }
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

function updateMailSiteListNow() {
  return updateRemoteList({
    urls: mailSiteListUrls.value,
    status: mailSiteUpdateStatus,
    info: mailSiteRemoteInfo,
    storageKey: STORAGE_KEY_REMOTE_MAIL_SITES,
    fetchLists: fetchRemoteMailSiteLists,
    apply: updateRemoteMailSites,
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

// Two questions, not one. Right-clicking needs somewhere to put the menu item,
// and Firefox for Android has no menus API however good the pointer is – so a
// phone with a Bluetooth mouse can hover and still never fire a right-click
// check. Read here rather than in the content script, which is not given the
// menus namespace on any platform.
const canRightClick = pointerCanHover && hasContextMenus()

const importHealth = computed<ImportHealth>(() => canImportHistory
  ? describeImportHealth(lastImport.value, Date.now(), isImporting.value)
  : 'unsupported')
const importStatusText = computed(() => translations.value[`importStatus${
  importHealth.value.charAt(0).toUpperCase()}${importHealth.value.slice(1)}`])
// Nothing has ever been imported here, so there is nothing to re-do – the same
// button, called what it is about to do
const importButtonLabel = computed(() => importHealth.value === 'never'
  ? translations.value.importHistoryFirstRun
  : translations.value.importHistoryRun)

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
// The shortener list is not here: it belongs to Link safety, and that section's
// own reset button clears it. This is for the two things no single section owns.
const resetSelections = ref({
  visits: false,
  settings: false,
})

// Language settings. Only the locales this build ships – see the same list in
// the background script
const availableLanguages = [
  { code: 'en', name: 'languageEnglish' },
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

// ==========================================
// Familiarity rules
// ==========================================

const familiarity = computed(() => normalizeFamiliarity(settings.value.familiarity))

/** How many checks a site has to pass right now, with the mode applied. */
const familiarityRequired = computed(() => requiredMatches(familiarity.value))
const familiarityEnabledCount = computed(() => enabledCriteria(familiarity.value).length)

/**
 * What the badge can be set to show, given the checks that are on.
 *
 * A check the user switched off is a number they said is not worth the icon, so
 * it does not go in the list either. Counting the passed checks joins them once
 * there is more than one to count – which is also the only time this list is
 * worth showing at all.
 */
const badgeContentOptions = computed(() => [
  ...enabledCriteria(familiarity.value).map(id => ({
    value: id,
    label: translations.value[`badgeContent${id[0].toUpperCase()}${id.slice(1)}`],
  })),
  { value: 'checks', label: translations.value.badgeContentChecks },
])

// The stored choice can name a check that has since been switched off. The badge
// resolves that at drawing time, and the select shows the same answer rather
// than an empty box.
const shownBadgeContent = computed(() => resolveBadgeContent(settings.value.badgeContent, familiarity.value))

/** One row per criterion, in the order they are shown. */
const familiarityRows = computed(() => FAMILIARITY_CRITERIA.map(id => ({
  id,
  criterion: familiarity.value[id],
  title: translations.value[`familiarity${id[0].toUpperCase()}${id.slice(1)}`],
  description: translations.value[`familiarity${id[0].toUpperCase()}${id.slice(1)}Desc`],
  unit: id === 'visits' ? translations.value.familiarityVisitsUnit : translations.value.familiarityDaysUnit,
  // Only the visit count is recorded for every site from the start
  needsImport: id !== 'visits',
})))

/** The rule in one sentence, above the checkboxes that spell it out. */
const familiaritySummary = computed(() => {
  if (familiarity.value.mode === 'any')
    return translations.value.familiaritySummaryAny
  if (familiarity.value.mode === 'atLeast')
    return (translations.value.familiaritySummaryAtLeast || '').replace('{n}', String(familiarityRequired.value))
  return translations.value.familiaritySummaryAll
})

function updateFamiliarity(patch: Partial<FamiliaritySettings>) {
  settings.value = {
    ...settings.value,
    familiarity: { ...familiarity.value, ...patch },
  }
}

/**
 * Turn a check on or off, except for the last one left on.
 *
 * With nothing enabled there is no question left to answer, and the fallback
 * that keeps the extension working in that case is not something to arrive at by
 * clicking – so the last checkbox simply cannot be cleared.
 */
function toggleCriterion(id: FamiliarityCriterionId) {
  const criterion = familiarity.value[id]
  if (criterion.enabled && familiarityEnabledCount.value <= 1)
    return

  updateFamiliarity({ [id]: { ...criterion, enabled: !criterion.enabled } })
}

/**
 * The whole card is the switch, not just the checkbox in its corner.
 *
 * The checkbox is a small target on a wide card, and every miss used to do
 * nothing. Only the threshold field is left out, where a click is aiming at the
 * number – the checkbox itself takes no pointer events, so a click on it lands
 * here too and toggles once rather than twice.
 */
function onCriterionCardClick(id: FamiliarityCriterionId, event: MouseEvent) {
  if ((event.target as HTMLElement | null)?.closest('input[type="number"]'))
    return

  toggleCriterion(id)
}

/**
 * Take the typed threshold, and let it be half-typed.
 *
 * An empty box is a moment on the way to a new number, not a number of its own.
 * Writing a 1 into the settings the instant it is cleared puts that 1 straight
 * back under the cursor, which is what made these fields impossible to retype –
 * the only way through was to type beside the old value and delete it after.
 */
function updateCriterionMin(id: FamiliarityCriterionId, value: string) {
  if (value.trim() === '')
    return

  const min = Math.max(1, Math.floor(Number(value)) || 1)
  updateFamiliarity({ [id]: { ...familiarity.value[id], min } })
}

/**
 * Put the stored number back if the box is left empty.
 *
 * Nothing was written while it stood empty, so the setting is still whatever it
 * was – this only makes the field say so again.
 */
function restoreCriterionMin(id: FamiliarityCriterionId, el: HTMLInputElement) {
  if (el.value.trim() === '')
    el.value = String(familiarity.value[id].min)
}

function updateFamiliarityMode(mode: string) {
  updateFamiliarity({ mode: mode as FamiliaritySettings['mode'] })
}

function updateFamiliarityAtLeast(value: string) {
  const wanted = Math.floor(Number(value)) || 1
  updateFamiliarity({ atLeast: Math.min(Math.max(1, wanted), Math.max(1, familiarityEnabledCount.value)) })
}

/**
 * How much of the stored history can answer the two newer checks.
 *
 * Active days and first-visit dates are only recorded for sites seen since they
 * existed, and a record without them fails its check rather than being waived.
 * That is a surprise worth heading off in the one place where somebody is about
 * to switch those checks on, with the import that fixes it named on the spot.
 */
const statsCoverage = ref<{ total: number, missing: number } | null>(null)

async function readStatsCoverage() {
  const records = await browser.storage.local.get(null)
  let total = 0
  let missing = 0
  for (const [key, value] of Object.entries(records)) {
    const record = value as SiteVisitData | undefined
    if (!key.includes('.') || typeof record?.count !== 'number')
      continue
    total++
    if (typeof record.activeDays !== 'number' || typeof record.firstSeen !== 'number')
      missing++
  }
  statsCoverage.value = { total, missing }
}

const showStatsCoverageWarning = computed(() =>
  (familiarity.value.activeDays.enabled || familiarity.value.age.enabled)
  && (statsCoverage.value?.missing ?? 0) > 0)

/**
 * Whether the records still without dates can ever get any.
 *
 * A full import reads the browser history and nothing else, so a site the
 * history no longer holds – cleared, or simply older than the browser keeps –
 * stays dateless however many times the import is re-run. Once the full pass has
 * finished, pointing at it again is a promise it cannot keep.
 *
 * `unsupported` is the same answer arrived at from the other end: on Firefox for
 * Android there is no history to read at all, so there is no import to point at
 * either. It used to fall through to the fixable wording, which offered a link
 * to a section that says the browser will not allow it.
 */
const statsGapIsPermanent = computed(() =>
  importHealth.value === 'complete' || importHealth.value === 'unsupported')

/**
 * The two permanent cases read differently and must not borrow each other's
 * words: one says the import has already run, the other that there was never
 * one to run.
 */
const statsGapTitle = computed(() => {
  if (importHealth.value === 'unsupported')
    return translations.value.familiarityNoImportTitle
  return statsGapIsPermanent.value
    ? translations.value.familiarityNoDatesTitle
    : translations.value.familiarityNeedsImportTitle
})

const statsGapText = computed(() => {
  if (importHealth.value === 'unsupported')
    return translations.value.familiarityNoImportText
  return statsGapIsPermanent.value
    ? translations.value.familiarityNoDatesText
    : translations.value.familiarityNeedsImportText
})

// Database management functions

function cancelImport() {
  importCancelled.value = true
}

/**
 * Re-run an import by hand.
 *
 * The same two passes the automatic import runs at install, in the same order.
 * The quick pass reads one summary for the whole history, so visit counts are
 * current within a second, and the full pass then reads every recorded visit,
 * which is the only place first-visit dates and active days can come from.
 * Splitting the two across two buttons only asked the user to answer a question
 * about browser APIs. Both passes are idempotent – mergeImportedStats folds by
 * min/max, never by addition – so the counts the quick pass just wrote are not
 * doubled by the full one behind it.
 */
async function importHistory() {
  isImporting.value = true
  importCancelled.value = false

  try {
    const progress = (state: HistoryImportState) => {
      importProgress.value = { current: state.current, total: state.total }
    }

    const quick = await runHistoryImport({
      mode: 'quick',
      onProgress: progress,
      shouldStop: () => importCancelled.value,
    })

    // Cancelled or unsupported: the slow pass would only fail the same way, and
    // a cancel means the user is done waiting
    const result = quick.status === 'done'
      ? await runHistoryImport({
        mode: 'full',
        resume: true,
        onProgress: progress,
        shouldStop: () => importCancelled.value,
      })
      : quick

    lastImport.value = result
    // A full pass fills in first-visit dates and active days, so the warning
    // about missing ones has to be asked again rather than left standing
    await readStatsCoverage()

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
    // Picked by shape, not by exclusion: the same storage area holds the lists
    // the user typed, the lists they fetched and the migration flags, and a
    // checkbox that names visit information may not reach any of them.
    const result = await browser.storage.local.get(null)
    await browser.storage.local.remove(visitKeysToRemove(result))

    // The import state was one of those keys, and the paragraph above still
    // reports the import that has just been wiped. Re-read rather than listen:
    // this page is the one that emptied the storage, so it knows exactly when
    // there is something new to say.
    lastImport.value = await readHistoryImportState()
    await readStatsCoverage()
  }

  if (resetSelections.value.settings) {
    // Reset settings to defaults
    settings.value = { ...defaultSettings }
    // Custom shorteners are part of settings UI, reset them too
    await browser.storage.local.remove('customShorteners')
    customShortenersText.value = ''
  }

  // Reset selections
  resetSelections.value = {
    visits: false,
    settings: false,
  }
}

// ==========================================
// Contents of the page
// ==========================================

/** In page order, which is the only order a table of contents may be in. */
const SECTION_IDS = [
  ['general', 'generalSettings'],
  ['familiarity', 'familiaritySettings'],
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
 * Scroll to a section from inside the page.
 *
 * Same reason as the one in the table of contents: a fragment link does nothing
 * at all on an extension page, so the scrolling is done by hand.
 */
function goToSection(id: string) {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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
  <main class="px-4 py-10 text-left text-gray-700 dark:text-gray-200" :class="{ 'hints-hidden': !settings.verboseOptions }">
    <div v-if="!isLoaded" class="flex justify-center items-center h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
    </div>

    <div v-else>
      <Logo style="max-width: 300px;" class="mx-auto" />
      <div class="text-xl font-bold mb-6 text-center">
        {{ translations.settings }}
      </div>

      <!-- Too narrow for a column beside the settings, so it goes above them -->
      <div class="xl:hidden max-w-md mx-auto mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <SectionNav :sections="sections" :active-id="activeSection" :heading="translations.onThisPage" />
      </div>

      <div class="relative max-w-md mx-auto space-y-6">
        <!-- General Settings -->
        <div id="section-general" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('general')" @reset="resetSection('general')" />
          <h2 class="text-lg font-semibold text-center mb-4">
            {{ translations.generalSettings }}
          </h2>

          <!-- Language Settings. A picker with one entry is a control that
               cannot do anything, so it stays out of the way until a second
               language ships -->
          <div v-if="availableLanguages.length > 1" class="flex flex-col items-start mb-6">
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

          <!-- Its own description is not a hint and never hides: switched off,
               it would be the one line explaining how to get the rest back -->
          <div class="flex items-start justify-between">
            <div>
              <label class="text-sm font-medium">{{ translations.optionsVerbose }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ translations.optionsVerboseDesc }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="settings.verboseOptions" type="checkbox" class="sr-only peer">
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
              />
            </label>
          </div>
        </div>

        <!-- Familiarity – the one verdict everything else follows from, which is
             why it has a section of its own rather than a number in General -->
        <div id="section-familiarity" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('familiarity')" @reset="resetSection('familiarity')" />
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.familiaritySettings }}
          </h2>
          <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.familiarityIntro }}
          </p>

          <!-- How many checks have to agree, said before the checks themselves,
               because it is what they are being read against -->
          <div class="flex flex-col items-start mb-2">
            <label class="text-sm font-medium mb-2">{{ translations.familiarityModeLabel }}</label>
            <select
              :value="familiarity.mode"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              @change="updateFamiliarityMode(($event.target as HTMLSelectElement).value)"
            >
              <option value="all">
                {{ translations.familiarityModeAll }}
              </option>
              <option value="any">
                {{ translations.familiarityModeAny }}
              </option>
              <option value="atLeast">
                {{ translations.familiarityModeAtLeast }}
              </option>
            </select>

            <!-- A list rather than a number field: there are never more than
                 three checks to choose from, and every one of them is a valid
                 answer, so nothing here has to be typed or corrected -->
            <div v-if="familiarity.mode === 'atLeast'" class="flex items-center gap-2 mt-2">
              <label class="text-sm">{{ translations.familiarityModeAtLeastLabel }}</label>
              <select
                :value="familiarityRequired"
                class="px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                @change="updateFamiliarityAtLeast(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="n in familiarityEnabledCount" :key="n" :value="n">
                  {{ n }}
                </option>
              </select>
              <span class="text-sm text-gray-500 dark:text-gray-400">/ {{ familiarityEnabledCount }}</span>
            </div>
          </div>

          <p class="text-sm mb-4 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300">
            {{ familiaritySummary }}
          </p>

          <div class="space-y-3">
            <div
              v-for="row in familiarityRows" :key="row.id"
              class="rounded-lg border p-3 transition-colors cursor-pointer"
              :class="row.criterion.enabled
                ? 'border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-900/10'
                : 'border-gray-200 dark:border-gray-700'"
              @click="onCriterionCardClick(row.id, $event)"
            >
              <!-- Not a label any more: the card around it is the click target,
                   and a label would toggle a second time on its way there -->
              <div class="flex items-start gap-2">
                <input
                  type="checkbox" class="mt-1 h-4 w-4 pointer-events-none"
                  :checked="row.criterion.enabled"
                  :disabled="row.criterion.enabled && familiarityEnabledCount <= 1"
                  :aria-label="row.title"
                  :title="row.criterion.enabled && familiarityEnabledCount <= 1 ? translations.familiarityKeepOne : undefined"
                  @change="toggleCriterion(row.id)"
                >
                <span>
                  <span class="text-sm font-medium">{{ row.title }}</span>
                  <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ row.description }}</span>
                </span>
              </div>

              <div class="flex items-center gap-2 mt-2 ml-6" :class="{ 'opacity-50': !row.criterion.enabled }">
                <span class="text-sm">{{ translations.familiarityAtLeastLabel }}</span>
                <input
                  :value="row.criterion.min" type="number" min="1"
                  :disabled="!row.criterion.enabled"
                  class="w-14 px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-text"
                  @input="updateCriterionMin(row.id, ($event.target as HTMLInputElement).value)"
                  @blur="restoreCriterionMin(row.id, $event.target as HTMLInputElement)"
                >
                <span class="text-sm text-gray-500 dark:text-gray-400">{{ row.unit }}</span>
              </div>
            </div>
          </div>

          <!-- Only shown when it is actually about to bite: one of the two newer
               checks is on, and there are records that cannot answer it -->
          <div
            v-if="showStatsCoverageWarning"
            class="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50"
          >
            <div class="text-sm font-medium text-amber-800 dark:text-amber-300">
              {{ statsGapTitle }}
            </div>
            <p class="text-xs text-amber-900/80 dark:text-amber-200/80 mt-1">
              {{ statsCoverage?.missing }} / {{ statsCoverage?.total }} – {{ statsGapText }}
            </p>
            <!-- No link once the import has run: there is nothing there to press -->
            <a
              v-if="!statsGapIsPermanent"
              href="#section-data"
              class="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
              @click.prevent="goToSection('data')"
            >
              {{ translations.familiarityNeedsImportLink }}
            </a>
          </div>
        </div>

        <!-- Display Settings -->
        <div id="section-display" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('display')" @reset="resetSection('display')" />
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.displaySettings }}
          </h2>

          <!-- Said once for the whole section: both toggles draw on the same
               icon, and neither shows anything while it is hidden in the menu -->
          <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ isAndroid ? translations.displaySettingsPinNoteAndroid : translations.displaySettingsPinNote }}
          </p>

          <div class="space-y-4">
            <div class="flex items-start justify-between">
              <div>
                <label class="text-sm font-medium">{{ translations.dynamicIcon }}</label>
                <p class="hint text-xs text-gray-500 dark:text-gray-400">
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
                <p class="hint text-xs text-gray-500 dark:text-gray-400">
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

            <!-- Nothing to choose while there is no counter to choose for, and
                 nothing to choose between while a single check is on: the badge
                 can only be that check's number -->
            <div v-if="settings.showBadge && familiarityEnabledCount > 1" class="flex flex-col items-start">
              <label class="text-sm font-medium mb-1">{{ translations.badgeContentLabel }}</label>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-2">
                {{ translations.badgeContentDesc }}
              </p>
              <select
                :value="shownBadgeContent"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                @change="settings.badgeContent = ($event.target as HTMLSelectElement).value as BadgeContent"
              >
                <option v-for="option in badgeContentOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Notification Settings -->
        <div id="section-notifications" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('notifications')" @reset="resetSection('notifications')" />
          <h2 class="text-lg font-semibold text-center mb-4">
            {{ translations.notificationSettings }}
          </h2>

          <!-- Show Notifications Toggle -->
          <div class="flex items-start justify-between mb-4">
            <div>
              <label class="text-sm font-medium">{{ translations.showWarningNotification }}</label>
              <p class="hint text-xs text-gray-500 dark:text-gray-400">
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
                  <span class="ml-2 text-sm">
                    <span class="block">{{ translations.showInputWarning }}</span>
                    <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
                  <span class="ml-2 text-sm">
                    <span class="block">{{ translations.showCopyWarning }}</span>
                    <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
                  <span class="ml-2 text-sm">{{ translations.bothWarningTriggers }}</span>
                </label>
              </div>

              <!-- Only offered where it applies: holding a paste is meaningless
                   if pasting is not one of the moments being watched -->
              <div v-if="settings.showInputWarning" class="flex items-start justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div class="pr-3">
                  <label class="text-sm font-medium">{{ translations.blockPasteOnUnfamiliar }}</label>
                  <p class="hint text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
                    <span class="ml-2 text-sm">
                      <span class="block">{{ translations.browserNotifications }}</span>
                      <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {{ translations.browserNotificationsDesc }}
                      </span>
                    </span>
                  </label>
                  <label class="flex items-start">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="in-page"
                      class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">
                      <span class="block">{{ translations.inPageNotifications }}</span>
                      <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {{ translations.inPageNotificationsDesc }}
                      </span>
                    </span>
                  </label>
                  <label class="flex items-start">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="both"
                      class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.bothNotifications }}</span>
                  </label>
                </div>

                <!-- Below the options rather than beside one of them: it is a
                     remark on the choice as a whole, and the point only lands
                     once both trade-offs have been read -->
                <p class="hint text-xs text-gray-500 dark:text-gray-400 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  {{ translations.notificationStylePinNote }}
                </p>
              </div>
            </div>
          </div>
        </div>
        <!-- Anti-Tampering Settings -->
        <div id="section-tampering" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('tampering')" @reset="resetSection('tampering')" />
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.antiTamperingSettings }}
          </h2>
          <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.antiTamperingSettingsDesc }}
          </p>

          <div>
            <label class="text-sm font-medium">{{ translations.antiTamperingExcludedDomains }}</label>
            <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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
        <div id="section-link-safety" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('link-safety')" @reset="resetSection('link-safety')" />
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.linkSafetySettings }}
          </h2>
          <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-4">
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
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkScopeModeDesc }}
              </p>
              <div class="space-y-2">
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="everywhere"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkScopeEverywhere }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="whitelist"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkScopeWhitelist }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="blacklist"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkScopeBlacklist }}</span>
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
                <p class="hint text-xs text-gray-500 dark:text-gray-400 mt-1">
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
              <!-- A pointer that can hover, on a browser with no menus API: the
                   note above does not apply and the right-click option below is
                   the only one that cannot fire -->
              <p v-else-if="!canRightClick" class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkTooltipTriggerNoMenusNote }}
              </p>
              <div class="space-y-2">
                <!-- Hovering and right-clicking are disabled rather than hidden
                     where they cannot fire: a choice that silently does nothing
                     is worse than one the device visibly cannot offer, and
                     hiding them would leave a profile whose stored trigger is
                     one of the two with nothing on screen to explain itself.
                     Each carries its own reason, because they are not the same
                     reason – one is about the pointer, the other about an API
                     the browser does not have. -->
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="hover"
                    :disabled="!pointerCanHover"
                    class="h-4 w-4 flex-shrink-0" :class="{ 'opacity-50': !pointerCanHover }" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">
                    <span :class="{ 'opacity-50': !pointerCanHover }">{{ translations.linkTooltipTriggerHover }}</span>
                    <p class="hint text-xs text-gray-500 dark:text-gray-400" :class="{ 'opacity-50': !pointerCanHover }">{{ translations.linkTooltipTriggerHoverDesc }}</p>
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
                  <span class="ml-2 text-sm">
                    <span>{{ translations.linkTooltipTriggerClickLeft }}</span>
                    <p class="hint text-xs text-gray-500 dark:text-gray-400">{{ translations.linkTooltipTriggerClickLeftDesc }}</p>
                  </span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="click-right"
                    :disabled="!canRightClick"
                    class="h-4 w-4 flex-shrink-0" :class="{ 'opacity-50': !canRightClick }" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">
                    <span :class="{ 'opacity-50': !canRightClick }">{{ translations.linkTooltipTriggerClickRight }}</span>
                    <p class="hint text-xs text-gray-500 dark:text-gray-400" :class="{ 'opacity-50': !canRightClick }">{{ translations.linkTooltipTriggerClickRightDesc }}</p>
                    <p v-if="!canRightClick" class="text-xs text-amber-600 dark:text-amber-400">
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
                <p class="hint text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ translations.linkHoverDelayDesc }}
                </p>
              </div>
            </div>

            <!-- Show Visit Count -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-1">
                {{ translations.linkShowVisitCount }}:
              </h3>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-3">
                {{ translations.linkShowVisitCountDesc }}
              </p>
              <div class="space-y-2">
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="always"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkShowVisitCountAlways }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="unfamiliar"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkShowVisitCountUnfamiliar }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="familiar"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkShowVisitCountFamiliar }}</span>
                </label>
                <label class="flex items-start">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="never"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2 text-sm">{{ translations.linkShowVisitCountNever }}</span>
                </label>
              </div>
            </div>

            <!-- Shortened URL Settings -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-sm font-medium mb-1">
                {{ translations.linkShortUrlSection }}
              </h3>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-3">
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
                    <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {{ translations.linkShortUrlModeButtonDesc }}
                    </span>
                  </span>
                </label>
                <label class="flex items-start cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="auto" class="h-4 w-4 flex-shrink-0 mt-0.5" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">
                    <span class="block">{{ translations.linkShortUrlModeAuto }}</span>
                    <span class="hint block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
                  <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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
                  <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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
        <div id="section-lookups" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('lookups')" @reset="resetSection('lookups')" />
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.lookupServicesLabel }}
          </h2>
          <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-4">
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
            <p class="hint text-xs text-gray-500 dark:text-gray-400 mt-1">
              {{ translations.lookupServicesDesc }}
            </p>
          </div>
        </div>

        <!-- Email Domain Lists -->
        <div id="section-email-lists" class="relative scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <SectionReset :label="translations.sectionReset" :disabled="sectionIsDefault('email-lists')" @reset="resetSection('email-lists')" />
          <h2 class="text-lg font-semibold text-center mb-2">
            {{ translations.emailListsTitle }}
          </h2>
          <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-4">
            {{ translations.emailListsDesc }}
          </p>

          <div class="space-y-4">
            <!-- Public providers: what the user adds, then where more come from -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailCustomPublicLabel }}</label>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
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

            <!-- Where a mail domain is read, for the brands the built-in table
                 does not cover -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailMailSitesLabel }}</label>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
                {{ translations.emailMailSitesDesc }}
              </p>
              <textarea
                v-model="customMailSitesText"
                wrap="off"
                rows="3"
                spellcheck="false"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                placeholder="example.com = mail.example.com&#10;example.net = webmail.example.org"
              />
            </div>

            <!-- Remote mapping sources. Empty by default, so this stays a way in
                 for somebody who keeps a list rather than a promise of one -->
            <div>
              <label class="text-sm font-medium">{{ translations.emailMailSitesUpdateUrlLabel }}</label>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mb-1">
                {{ translations.emailMailSitesUpdateUrlDesc }}
              </p>
              <textarea
                v-model="settings.mailSiteListUrl"
                wrap="off"
                rows="3"
                spellcheck="false"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                placeholder="https://example.com/mail-sites.txt"
              />
              <button
                class="btn-primary btn-sm w-full mt-2 whitespace-nowrap"
                :disabled="mailSiteUpdateStatus === 'loading' || !mailSiteListUrls.length"
                @click="updateMailSiteListNow"
              >
                {{ translations.emailDisposableUpdateNow }}
              </button>
              <p v-if="mailSiteUpdateStatus === 'success' && mailSiteRemoteInfo" class="text-xs mt-1" :class="mailSiteRemoteInfo.failed ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">
                {{ translations.emailDisposableUpdateSuccess }}: {{ mailSiteRemoteInfo.count }}
                <template v-if="mailSiteRemoteInfo.sources">
                  · {{ translations.emailDisposableSources }}: {{ mailSiteRemoteInfo.sources }}
                </template>
                <template v-if="mailSiteRemoteInfo.failed">
                  · {{ translations.emailDisposableSourcesFailed }}: {{ mailSiteRemoteInfo.failed }}
                </template>
              </p>
              <p v-else-if="mailSiteUpdateStatus === 'error'" class="text-xs text-red-500 dark:text-red-400 mt-1">
                {{ translations.emailDisposableUpdateError }}
              </p>
              <p v-else-if="mailSiteRemoteInfo" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.emailDisposableUpdateSuccess }}: {{ mailSiteRemoteInfo.count }} ({{ new Date(mailSiteRemoteInfo.updatedAt).toLocaleDateString() }})
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
              <p v-if="canImportHistory" class="hint text-xs text-gray-500 dark:text-gray-400 mb-2">
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
              <!-- Both of these are gone where there is no history to read.
                   A dead button called "Re-import history", with a paragraph
                   describing the two passes it would run, sits directly under a
                   line saying the browser will not allow any of it – which is
                   how it read on Firefox for Android. The status line above is
                   the whole story there. -->
              <button
                v-if="canImportHistory"
                class="btn-primary w-full"
                :disabled="isImporting" @click="importHistory()"
              >
                <template v-if="!isImporting">
                  {{ importButtonLabel }}
                </template>
                <template v-else>
                  {{ translations.importing }} {{ importProgress.current }}/{{ importProgress.total }}
                </template>
              </button>
              <p v-if="canImportHistory" class="hint text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ translations.importHistoryRunDesc }}
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
              <p v-if="isImporting" class="hint text-xs text-gray-500 dark:text-gray-400 mt-2">
                {{ translations.importKeepPageOpen }}
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
                </div>
              </div>

              <button
                class="btn-danger w-full mt-4"
                :disabled="isImporting || !Object.values(resetSelections).some(Boolean)"
                @click="showResetConfirm = true"
              >
                {{ translations.resetSelectedData }}
              </button>
              <p class="hint text-xs text-gray-500 dark:text-gray-400 mt-1">
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
        <div class="hidden xl:block absolute right-full top-0 h-full w-64 pr-8 !mt-0">
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
/**
 * The explanation under a setting, hidden in one place rather than by a `v-if`
 * on each of the forty of them. Marked by hand, so a line that reports state –
 * when a list was last updated, what this device can do – keeps its place on a
 * compact page.
 */
.hints-hidden .hint {
  display: none;
}

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
