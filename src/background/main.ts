import type { FamiliarDomain, FamiliarIndex } from '~/logic/domain-similarity'
import type { FamiliarityStats } from '~/logic/familiarity'
import type { SiteVisitData } from '~/logic/storage'
import { onMessage } from 'webext-bridge/background'
import { badgeText } from '~/logic/badge'
import { fetchBlobBounded } from '~/logic/bounded-fetch'
import { belongsToSite, siteDomain, siteDomainOrSelf } from '~/logic/domain-boundary'
import { buildFamiliarIndex, findLookalikes } from '~/logic/domain-similarity'
import { getProviderReferenceDomains } from '~/logic/email-providers'
import { analyzeEmailAddress, collectMailtoRecipients, parseMailtoUrl } from '~/logic/email-safety'
import { applyVisitToFamiliar, collectFamiliarDomains, FAMILIAR_INDEX_KEY } from '~/logic/familiar-index'
import { aggregateFamiliarityStats, familiaritySignature, isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { HISTORY_AUTO_IMPORT_KEY, HISTORY_IMPORT_STATE_KEY, isImportAlive, newImportRunId, readHistoryImportState, runHistoryImport, shouldAutoImport } from '~/logic/history-import'
import { watchListStorage } from '~/logic/list-sync'
import { collectMailSiteFamilies, loadMailSitesFromRecords } from '~/logic/mail-sites'
import { hasContextMenus } from '~/logic/platform'
import { decodeQrFromImageBitmapSource } from '~/logic/qr'
import { settings as appSettings, parseStoredSettings, settingsReady } from '~/logic/storage'
import { clearAllTamperAlarms, clearTamperAlarm, hasTamperAlarm, raiseTamperAlarm } from '~/logic/tamper-alarms'
import { addCustomShortener, clearCachedResolvedUrl, getCachedResolvedUrl, loadShortenersFromStorage, resolveUrlChain, setCachedResolvedUrl } from '~/logic/url-shorteners'
import { visitKeysToRemove } from '~/logic/visit-reset'
import { applyVisit, isTrackableHostname } from '~/logic/visit-stats'
import { removeVisitRecords, updateVisitRecord, visitGeneration } from '~/logic/visit-store'

// Load user-defined and remotely fetched shortener domains on service worker start
loadShortenersFromStorage()

// ...and follow them afterwards, so an edit in the settings reaches a worker that
// is already running rather than waiting for the next time it is torn down
watchListStorage()

/**
 * The settings, read and migrated, before this worker answers for them.
 *
 * A service worker is started by the event it has to handle, so there is always
 * a first navigation, a first message or a first badge refresh that arrives
 * while `storage.sync` is still being read. Until this resolves the settings ref
 * holds the shipped defaults, and handing those out as the user's choice is how
 * a threshold of 25 becomes 10 and stays there. Everything below waits for it.
 *
 * Migrations run here too, and only here: one context, once, before anything
 * else can write the blob they are rewriting.
 */
const backgroundReady = settingsReady({ migrate: true })

// The locales this build actually ships. Russian and Ukrainian were dropped
// rather than kept half-checked, so the picking machinery stays and the list is
// all that has to grow to bring a language back.
const availableLanguages = [
  'en',
]

// Function to generate icon paths for different sizes
function getIconPaths(baseName: string) {
  return {
    16: browser.runtime.getURL(`assets/${baseName}-16.png`),
    32: browser.runtime.getURL(`assets/${baseName}-32.png`),
    48: browser.runtime.getURL(`assets/${baseName}-48.png`),
    128: browser.runtime.getURL(`assets/${baseName}-128.png`),
  }
}

// Function to get the best matching language
async function getBestMatchingLanguage(): Promise<string> {
  // Get browser languages in order of preference
  const browserLangs = navigator.languages || [navigator.language]

  for (const lang of browserLangs) {
    // Get the base language code (e.g., 'en' from 'en-US')
    const baseLang = lang.split('-')[0].toLowerCase()

    if (availableLanguages.includes(baseLang))
      return baseLang
  }
  return 'en' // Default to English if no match found
}

// Site safety level types
type IsSafe = boolean // true = safe, false = dangerous

/** The familiarity rules as they currently stand, normalized for missing fields. */
function currentFamiliarityRules() {
  return normalizeFamiliarity(appSettings.value.familiarity)
}

// Whether a site clears the user's familiarity rules – visits, active days and
// age, in whatever combination they chose
function checkIfSiteIsSafe(stats: FamiliarityStats): IsSafe {
  return isFamiliar(stats, currentFamiliarityRules())
}

// Function to get badge color based on safety level
function getBadgeColor(isSiteSafe: IsSafe): string {
  return isSiteSafe ? '#00C851' : '#ff4444'
}

// Function to update extension icon based on safety level
async function updateExtensionIcon(stats: FamiliarityStats, tabId?: number) {
  if (!appSettings.value.changeIcon) {
    // Set default icon when colors are disabled
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
      ...(tabId != null && { tabId }),
    })
    return
  }

  const isSiteSafe = checkIfSiteIsSafe(stats)
  const iconType = isSiteSafe ? 'icon-default' : 'site-danger'
  await browser.action.setIcon({
    path: getIconPaths(iconType),
    ...(tabId != null && { tabId }),
  })
}

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

// Handle extension icon click to open options page
// browser.action.onClicked.addListener(() => {
//   browser.runtime.openOptionsPage()
// })

// Function to get hostname from URL
function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  }
  catch {
    return url
  }
}

// Function to check if a hostname is an internal page (no dots in hostname).
// One definition of the rule, shared with the content script and the popup, so
// "not counted here" and "not warned about here" can never drift apart.
function isInternalPage(hostname: string): boolean {
  return !isTrackableHostname(hostname)
}

// Function to increment visit count for a URL (storage only – does NOT touch badge)
async function incrementVisitCount(url: string) {
  const hostname = getHostname(url)

  // Read and written as one step. Read separately, this raced the ignore command
  // and the history import for the same record, and the loser's field was put
  // back to whatever the winner had read a moment earlier.
  let counted = false
  const updated = await updateVisitRecord(hostname, (existing) => {
    const next = applyVisit(existing, Date.now())
    counted = next.count !== (existing?.count ?? 0)
    return next
  })
  if (!updated)
    return

  // Whether this was a visit or a reload inside the debounce window – the same
  // question the counter above just answered, and the index has to give the
  // same answer or the two drift apart
  await noteVisitForFamiliarIndex(hostname, updated, counted)
}

// Function to update badge for current URL
async function updateBadge(hostname: string, tabId?: number) {
  // Never paint over a tampering alarm with a routine visit count. Kept in
  // `storage.session`, because this worker is stopped between the alarm and the
  // next badge refresh far more often than not – see logic/tamper-alarms.ts
  if (tabId != null && await hasTamperAlarm(tabId))
    return

  if (isInternalPage(hostname)) {
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
      ...(tabId != null && { tabId }),
    })
    await browser.action.setBadgeText({ text: '', ...(tabId != null && { tabId }) })
    return
  }

  const result = await browser.storage.local.get(hostname)
  const siteData = result[hostname] as SiteVisitData | undefined
  const stats: FamiliarityStats = {
    count: siteData?.count || 0,
    activeDays: siteData?.activeDays,
    firstSeen: siteData?.firstSeen,
  }

  if (appSettings.value.showBadge) {
    // One number is all the badge holds, and which one is the user's choice. Its
    // colour is the full verdict either way, so a site can read as unfamiliar
    // with a high count behind it
    await browser.action.setBadgeText({
      text: badgeText(stats, currentFamiliarityRules(), appSettings.value.badgeContent),
      ...(tabId != null && { tabId }),
    })
    const isSiteSafe = checkIfSiteIsSafe(stats)
    const color = getBadgeColor(isSiteSafe)
    await browser.action.setBadgeBackgroundColor({ color, ...(tabId != null && { tabId }) })
  }
  else {
    await browser.action.setBadgeText({ text: '', ...(tabId != null && { tabId }) })
  }

  await updateExtensionIcon(stats, tabId)
}

// ==========================================
// One-off automatic history import
// ==========================================

const WELCOME_PAGE = 'dist/welcome/index.html'

/**
 * Bring every open tab up to date after the visit records changed underneath it.
 *
 * The badge is drawn from a record and the content script holds a verdict drawn
 * from one, so both are wrong the moment an import or a reset lands. The tabs
 * are told rather than left to find out on the next navigation, which for a tab
 * somebody is looking at may be never.
 */
async function refreshOpenTabs() {
  const tabs = await browser.tabs.query({})
  for (const tab of tabs) {
    if (!tab.url || tab.id == null)
      continue
    await updateBadge(getHostname(tab.url), tab.id)
    await sendToTabSafe(tab.id, { type: 'visit-data-changed', data: {} })
  }
}

/**
 * Take a finished import into use: thousands of domains just crossed the
 * familiarity threshold at once, and every open tab is showing a stale badge.
 */
async function applyImportedHistory() {
  await rebuildFamiliarIndex()
  await refreshOpenTabs()
}

/**
 * Import the browser history once, without being asked.
 *
 * Two passes rather than one, and never a button to press between them. The
 * quick pass is a single API call, so the visit counts – the thing that decides
 * what gets warned about – are right within seconds of install. The full pass
 * then re-reads the same history for the per-visit detail that gives real
 * first-visit dates and active-day counts. It takes as long as it takes, and by
 * then the extension is already behaving correctly. Merging folds by min/max,
 * so the slow pass cannot disturb what the fast one wrote.
 */
/**
 * Stop an import the moment the records it is writing are declared gone.
 *
 * A reset moves the generation on, so the writes are dropped either way – this
 * is what stops the run from carrying on for another few thousand hostnames and
 * then reporting a number of domains it never wrote.
 */
function stopOnReset(startedAt: number) {
  return () => visitGeneration() !== startedAt
}

export async function runAutoHistoryImport(attempts = 0, existingRunId?: string): Promise<void> {
  await browser.storage.local.set({ [HISTORY_AUTO_IMPORT_KEY]: true })
  const shouldStop = stopOnReset(visitGeneration())
  const runId = existingRunId ?? newImportRunId()

  // The quick pass leaves `full-pending` behind rather than `done`. The rebuild
  // below takes a while, and a worker torn down during it used to leave a state
  // that said the whole import had finished – losing the full pass, and with it
  // every first-visit date, for good.
  const quick = await runHistoryImport({
    mode: 'quick',
    auto: true,
    attempts,
    shouldStop,
    runId,
    stage: 'quick-running',
    nextStage: 'full-pending',
  })
  if (quick.status !== 'done')
    return
  await applyImportedHistory()

  const full = await runHistoryImport({
    mode: 'full',
    auto: true,
    attempts,
    resume: true,
    shouldStop,
    runId,
    stage: 'full-running',
  })
  if (full.status === 'done')
    await applyImportedHistory()
}

/** Give up rather than restart a full import forever if it keeps dying. */
const MAX_IMPORT_ATTEMPTS = 5

/**
 * Pick up an automatic import that a closed browser or a killed service worker
 * cut short.
 *
 * Runs on every service-worker start, which is cheap – one key read, and all but
 * the first read finds a state that is finished or still ticking. The full pass
 * checkpoints whole hostnames as it goes, so resuming costs only the hostnames
 * that had not been written yet.
 */
async function resumeInterruptedImport(): Promise<void> {
  // An import decides what counts as familiar as it writes, so it may not start
  // on a threshold that is only the shipped default
  await backgroundReady

  const state = await readHistoryImportState()
  if (!state)
    return
  if (isImportAlive(state, Date.now()))
    return

  // A chain that stopped between its two passes. The quick pass finished and
  // said so, which is why the status is not `running` – but the stage says the
  // full pass never started, and that is the one with the dates in it.
  if (state.status !== 'running') {
    if (state.stage === 'full-pending' && state.auto) {
      const full = await runHistoryImport({
        mode: 'full',
        auto: true,
        resume: true,
        shouldStop: stopOnReset(visitGeneration()),
        runId: state.runId,
        stage: 'full-running',
      })
      if (full.status === 'done')
        await applyImportedHistory()
    }
    return
  }

  // An import driven by the options page dies with its tab and is nobody's to
  // restart. Just stop the UI from showing it as forever running.
  if (!state.auto) {
    await browser.storage.local.set({
      [HISTORY_IMPORT_STATE_KEY]: { ...state, status: 'cancelled', finishedAt: Date.now() },
    })
    return
  }

  // A run that wrote at least one checkpoint before dying was making progress,
  // not failing – otherwise a large history spread over several browser sessions
  // would exhaust the attempt budget and give up while it was still working.
  const attempts = state.domains > 0 ? 0 : (state.attempts || 0) + 1
  if (attempts > MAX_IMPORT_ATTEMPTS) {
    await browser.storage.local.set({
      [HISTORY_IMPORT_STATE_KEY]: { ...state, status: 'failed', finishedAt: Date.now() },
    })
    return
  }

  if (state.mode === 'full') {
    const full = await runHistoryImport({
      mode: 'full',
      auto: true,
      attempts,
      resume: true,
      shouldStop: stopOnReset(visitGeneration()),
      runId: state.runId,
      stage: 'full-running',
    })
    if (full.status === 'done')
      await applyImportedHistory()
    return
  }

  await runAutoHistoryImport(attempts, state.runId)
}

// Both hooks are wanted: onStartup covers the browser being closed and reopened,
// the bare call covers a service worker that was killed while the browser stayed up
browser.runtime.onStartup.addListener(async () => {
  // An alarm is about a page that is on screen now. A browser that has just
  // started has no such page – and where `storage.session` is missing, nothing
  // else would ever clear these.
  await clearAllTamperAlarms()
  await resumeInterruptedImport()
})
resumeInterruptedImport()

browser.runtime.onInstalled.addListener(async (details): Promise<void> => {
  // Settings first: the language below is written into them, and an update
  // arrives while the migrations are still running
  await backgroundReady

  if (details.reason === 'install') {
    // Get the best matching language
    const detectedLang = await getBestMatchingLanguage()

    // Set the detected language in the settings
    appSettings.value = {
      ...appSettings.value,
      selectedLanguage: detectedLang,
    }
  }

  const records = await browser.storage.local.get(null)
  if (!shouldAutoImport({
    reason: details.reason,
    alreadyDecided: Boolean(records[HISTORY_AUTO_IMPORT_KEY]),
    records,
  })) {
    return
  }

  // The welcome page explains what is being read and why. Open it first so it
  // can show the import running rather than only its result
  if (details.reason === 'install')
    await browser.tabs.create({ url: browser.runtime.getURL(WELCOME_PAGE) })

  await runAutoHistoryImport()
})

// Update visit count when tab is updated
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url)
    return

  // The badge and the icon are the settings made visible, so neither may be
  // drawn from the defaults while the real ones are still being read
  await backgroundReady

  // We act on status changes only (loading or complete). url-only updates,
  // favicon-only updates, etc. are ignored.
  const status = changeInfo.status
  if (status !== 'loading' && status !== 'complete')
    return

  const hostname = getHostname(tab.url)

  // A fresh document gets a clean slate: whatever the previous page did, this
  // one has not done anything yet. Cleared on 'loading' so an alarm raised by
  // the new page, which arrives afterwards, is the one that survives.
  if (status === 'loading')
    await clearTamperAlarm(tabId)

  // Only increment the visit count once per navigation, on complete.
  // Always count the visit, even if the tab is in the background.
  if (status === 'complete' && !isInternalPage(hostname))
    await incrementVisitCount(tab.url)

  // Only touch action badge/icon for the tab the user is actually looking at.
  // In Chrome, ctrl+click opens a background tab whose onUpdated fires while
  // the user stays on the original tab – setting per-tab badge state for that
  // background tab would visibly change the action icon shown for the active
  // tab. onActivated will refresh the badge if/when the user switches to it.
  if (!tab.active)
    return

  // Re-assert the badge on 'loading' too, not just 'complete'. Chrome resets
  // per-tab action state at the start of any navigation (including F5), so
  // without the loading-phase update the badge briefly falls back to the
  // global default or another tab's state until 'complete' arrives. Firefox
  // preserves per-tab state across navigations, so it doesn't need this.
  if (isInternalPage(hostname) && !await hasTamperAlarm(tabId)) {
    await browser.action.setBadgeText({ text: '', tabId })
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
      tabId,
    })
    return
  }

  await updateBadge(hostname, tabId)
})

// A closed tab's id can be handed out again, so let go of it
browser.tabs.onRemoved.addListener(async (tabId) => {
  await clearTamperAlarm(tabId)
})

// Update badge when switching tabs
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  // Switching away and back must not quietly clear a tampering alarm
  if (await hasTamperAlarm(tabId))
    return

  await backgroundReady

  const tab = await browser.tabs.get(tabId)
  if (tab.url) {
    const hostname = getHostname(tab.url)

    // Skip internal pages
    if (isInternalPage(hostname)) {
      // Reset badge for internal pages
      await browser.action.setBadgeText({ text: '', tabId })
      // Set default icon for internal pages
      await browser.action.setIcon({
        path: getIconPaths('icon-default'),
        tabId,
      })
      return
    }

    await updateBadge(hostname, tabId)
  }
})

// Collect visit data for a whole domain family (base domain + subdomains),
// the same aggregation the popup dashboard shows
async function getDomainFamilyLogic(hostname: string) {
  const base = siteDomainOrSelf(hostname)
  const allData = await browser.storage.local.get(null)
  const entries: { hostname: string, count: number, activeDays?: number, firstSeen?: number }[] = []
  const records: SiteVisitData[] = []
  for (const key of Object.keys(allData)) {
    if (!belongsToSite(key, base))
      continue
    const record = allData[key] as SiteVisitData | undefined
    if (typeof record?.count === 'number') {
      entries.push({ hostname: key, count: record.count, activeDays: record.activeDays, firstSeen: record.firstSeen })
      records.push(record)
    }
  }
  entries.sort((a, b) => b.count - a.count)
  // The family's own facts travel with it, so the panel can reach the same
  // verdict the badge did instead of re-deriving one from the total alone
  const stats = aggregateFamiliarityStats(records)
  // An address domain is not a site anyone opens, so its family is empty by
  // nature. Where the mail is read is, and that is what the panel shows instead.
  loadMailSitesFromRecords(allData)
  const mailSites = collectMailSiteFamilies(allData, hostname, currentFamiliarityRules())
  return { baseDomain: base, entries, total: stats.count, stats, mailSites }
}

// Add message handler to get visit count
async function getVisitCountLogic(url: string) {
  const hostname = getHostname(url)
  const result = await browser.storage.local.get(hostname)
  const record = result[hostname] as SiteVisitData | undefined
  // Everything a familiarity verdict needs, so the caller does not have to ask
  // twice or judge on the visit count alone
  return {
    hostname,
    count: record?.count || 0,
    lastSeen: record?.lastSeen || 0,
    ignored: record?.ignored || false,
    activeDays: record?.activeDays,
    firstSeen: record?.firstSeen,
  }
}

// ==========================================
// Familiar domain index (lookalike detection)
// ==========================================

/** A stored list older than this is rebuilt from scratch on next use. */
const FAMILIAR_INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Which boundary the stored list was built under.
 *
 * Bumped whenever the line between one site and the next moves, because every
 * entry in the stored list is a domain drawn at that line. Version 1 folded all
 * of `github.io` into one entry – reading that list under the current boundary
 * would compare tenants against a name no tenant has.
 */
const FAMILIAR_INDEX_BOUNDARY = 2

interface StoredFamiliarList {
  domains: FamiliarDomain[]
  /** Rules the list was built under – see `familiaritySignature` */
  rules: string
  /** See `FAMILIAR_INDEX_BOUNDARY`. Absent on a list written before it existed. */
  boundary?: number
  builtAt: number
}

// The service worker is torn down constantly, so nothing here can live only in
// memory. These are a cache in front of the stored list, not the source of truth
let familiarDomains: FamiliarDomain[] | null = null
let familiarIndex: FamiliarIndex | null = null
let familiarIndexStale = false
let familiarLoad: Promise<void> | null = null

function invalidateFamiliarIndex() {
  familiarDomains = null
  familiarIndex = null
  familiarIndexStale = false
  familiarLoad = null
}

async function persistFamiliarDomains(domains: FamiliarDomain[]) {
  const payload: StoredFamiliarList = {
    domains,
    rules: familiaritySignature(currentFamiliarityRules()),
    boundary: FAMILIAR_INDEX_BOUNDARY,
    builtAt: Date.now(),
  }
  await browser.storage.local.set({ [FAMILIAR_INDEX_KEY]: payload })
}

/** Read every stored hostname and derive the familiar list from scratch. */
async function rebuildFamiliarDomains(): Promise<FamiliarDomain[]> {
  const records = await browser.storage.local.get(null)
  const domains = collectFamiliarDomains(records, {
    rules: currentFamiliarityRules(),
    toRegistrable: hostname => siteDomain(hostname),
  })

  await persistFamiliarDomains(domains)
  return domains
}

async function loadFamiliarDomains(): Promise<void> {
  const stored = (await browser.storage.local.get(FAMILIAR_INDEX_KEY))[FAMILIAR_INDEX_KEY] as StoredFamiliarList | undefined

  const isUsable = stored
    && Array.isArray(stored.domains)
    && stored.rules === familiaritySignature(currentFamiliarityRules())
    && stored.boundary === FAMILIAR_INDEX_BOUNDARY
    && Date.now() - (stored.builtAt || 0) < FAMILIAR_INDEX_MAX_AGE_MS

  familiarDomains = isUsable ? stored.domains : await rebuildFamiliarDomains()
  familiarIndex = buildFamiliarIndex(familiarDomains)
}

/**
 * Throw the stored list away and derive it again from what is in storage now.
 *
 * Dropping the in-memory cache is not enough on its own: the reload that follows
 * finds the persisted list still fresh and still matching the threshold, takes it
 * as usable, and hands back exactly what was just discarded. Anything that has
 * changed the visit records – an import above all – has to say so this way.
 */
async function rebuildFamiliarIndex(): Promise<FamiliarIndex> {
  invalidateFamiliarIndex()
  familiarDomains = await rebuildFamiliarDomains()
  familiarIndex = buildFamiliarIndex(familiarDomains)
  return familiarIndex
}

async function getFamiliarIndex(): Promise<FamiliarIndex> {
  if (familiarIndex && !familiarIndexStale)
    return familiarIndex

  // Rebuilding the lookup structures costs a couple of milliseconds, so browsing
  // only marks them stale and the next query pays for it – once, not per visit
  if (familiarIndex && familiarIndexStale && familiarDomains) {
    familiarIndex = buildFamiliarIndex(familiarDomains)
    familiarIndexStale = false
    return familiarIndex
  }

  // Concurrent callers share one load rather than each reading storage
  familiarLoad ??= loadFamiliarDomains()
  await familiarLoad

  return familiarIndex ?? buildFamiliarIndex([])
}

/**
 * Keep the list current as the user browses, so a full rebuild is only needed
 * after a history import, a threshold change, or a day of use.
 *
 * Deliberately works from the record already read by the visit counter: reading
 * the whole domain family would mean scanning all of storage on every single
 * navigation.
 */
async function noteVisitForFamiliarIndex(hostname: string, visitData: SiteVisitData, counted: boolean) {
  if (!familiarDomains)
    return

  const registrable = siteDomain(hostname)
  if (!registrable)
    return

  const added = applyVisitToFamiliar(familiarDomains, registrable, visitData, currentFamiliarityRules(), Date.now(), counted)
  familiarIndexStale = true

  // Only a new member is worth a write, and drifting counts are corrected by the
  // next rebuild and affect nothing but the order of equally strong matches
  if (added)
    await persistFamiliarDomains(familiarDomains)
}

/**
 * The history index widened with the mail providers, cached alongside it.
 *
 * Rebuilt from whatever the history index currently is, so it follows every
 * invalidation for free rather than needing its own lifecycle.
 */
let emailIndex: FamiliarIndex | null = null
let emailIndexBuiltFrom: FamiliarIndex | null = null

function getEmailIndex(history: FamiliarIndex): FamiliarIndex {
  if (emailIndex && emailIndexBuiltFrom === history)
    return emailIndex

  // History first, so a provider the user actually visits keeps its real visit
  // count and reads as a site they know rather than as a name off a list
  emailIndex = buildFamiliarIndex([
    ...history.entries,
    ...getProviderReferenceDomains().map(entry => ({ ...entry, visits: 0, source: 'provider' as const })),
  ])
  emailIndexBuiltFrom = history
  return emailIndex
}

/**
 * Domains this address resembles.
 *
 * `context: 'email'` widens the comparison to the mail providers, which is the
 * only place a shipped list is consulted – see `PROVIDER_REFERENCE_NOTE`.
 */
async function findLookalikesLogic(hostname: string, context?: 'email') {
  if (!hostname || isInternalPage(hostname))
    return []

  const history = await getFamiliarIndex()
  const index = context === 'email' ? getEmailIndex(history) : history
  return findLookalikes(hostname, index, siteDomain(hostname) || undefined)
}

// Handle ignore site requests
async function handleIgnoreSite(hostname: string, ignored = true) {
  if (!hostname)
    return 'Error: No hostname provided'

  // The flag is set on the record as it stands, not on a copy read earlier: a
  // navigation writing its own count in between used to carry the old flag back
  await updateVisitRecord(hostname, existing => ({
    count: 0,
    lastSeen: 0,
    ...existing,
    ignored,
  }))

  return ignored ? 'Site ignored successfully' : 'Site un-ignored successfully'
}

// Add message handler to get settings
async function getSettingsLogic() {
  // Return a plain object copy of the settings to avoid Proxy cloning issues in Firefox
  return JSON.parse(JSON.stringify(appSettings.value))
}

// Function to load messages for a language
async function loadTranslation(key: string): Promise<string> {
  try {
    const lang = appSettings.value.selectedLanguage || 'en'

    const response = await fetch(browser.runtime.getURL(`/_locales/${lang}/messages.json`))
    if (!response.ok) {
      throw new Error(`Failed to load translations for ${lang}`)
    }
    const translations = await response.json()
    return translations[key]?.message || key
  }
  catch {
    // Fallback to English
    try {
      const response = await fetch(browser.runtime.getURL('/_locales/en/messages.json'))
      const translations = await response.json()
      return translations[key]?.message || key
    }
    catch {
      return key
    }
  }
}

// Handle notification requests
async function handleShowNotification(warningType: 'input' | 'copy') {
  // For browser notification, we translate here
  const title = await loadTranslation('securityWarning')

  // Get the appropriate message based on the warning type
  const messageKey = warningType === 'input' ? 'inputWarningMessage' : 'copyWarningMessage'
  const notificationMessage = await loadTranslation(messageKey)

  const iconPath = 'assets/site-danger-48.png'

  // Send browser notification
  await browser.notifications.create({
    type: 'basic',
    title,
    message: notificationMessage,
    iconUrl: browser.runtime.getURL(iconPath),
  })

  return 'Notification sent'
}

// Handle tampering detection
async function handleTampering(tabId?: number, url?: string) {
  // The page watcher keeps going after its first report now, so a page that
  // strikes repeatedly reports repeatedly. The alarm and the badge are worth
  // re-asserting every time – the notification is worth showing once.
  const alreadyAlarmed = tabId != null && await hasTamperAlarm(tabId)

  // Marked before anything else is awaited: a page that strikes mid-load would
  // otherwise have its alarm painted over by the load's own badge refresh
  if (tabId != null)
    await raiseTamperAlarm(tabId, url ?? '')

  if (!alreadyAlarmed) {
    const title = await loadTranslation('securityWarning')
    const message = await loadTranslation('tamperingMessage')

    // Show high-priority notification
    await browser.notifications.create({
      type: 'basic',
      title,
      message,
      iconUrl: browser.runtime.getURL('assets/site-danger-48.png'),
      priority: 2,
    })
  }

  // Update badge to show error state (per-tab if available)
  await browser.action.setBadgeText({ text: '!!!', ...(tabId != null && { tabId }) })
  await browser.action.setBadgeBackgroundColor({ color: '#FF0000', ...(tabId != null && { tabId }) })
  await browser.action.setIcon({ path: getIconPaths('site-danger'), ...(tabId != null && { tabId }) })

  return 'Tampering handled'
}

/**
 * Open the check page with something already in it.
 *
 * Used for a `mailto:` with more than one recipient, where there is no single
 * domain a dashboard could be about. The check page reads every address in the
 * link, which is the whole point – the domain view could only ever have shown
 * the first one.
 */
async function handleOpenCheckTab(value: string) {
  const url = browser.runtime.getURL(`dist/popup/index.html?check=1&value=${encodeURIComponent(value)}`)
  await browser.tabs.create({ url })
  return 'Check tab opened'
}

// Open popup page in a new tab with domain context
async function handleOpenPopupTab(domain: string) {
  const popupUrl = browser.runtime.getURL(`dist/popup/index.html?domain=${encodeURIComponent(domain)}`)
  await browser.tabs.create({ url: popupUrl })
  return 'Popup tab opened'
}

/**
 * Throw away the visit records, and everything derived from them.
 *
 * One command in the background rather than a storage wipe from the settings
 * page. The page could delete the records, but not the copies: the familiar
 * index went on answering lookalike questions from memory and could be written
 * back out, a running import kept writing records the user had just deleted, and
 * every badge and every open tab carried on showing a verdict about data that
 * was no longer there.
 */
async function handleResetVisits() {
  // The scan and the delete are one step, and the generation moves with them, so
  // an import batch queued behind this is dropped and one queued ahead of it has
  // its records swept up rather than surviving a wipe that missed them
  const removed = await removeVisitRecords(visitKeysToRemove)

  // The derived copies, none of which mean anything now
  invalidateFamiliarIndex()
  emailIndex = null
  emailIndexBuiltFrom = null

  await refreshOpenTabs()
  return { success: true, removed }
}

/**
 * Answer an iframe about itself.
 *
 * A frame keeps nothing: no settings, no lists, no verdict. It asks once, when
 * somebody first touches it, and this is the whole answer – see
 * src/contentScripts/frame.ts for why it is kept that thin.
 */
async function handleFrameVerdict(url: string, tabUrl?: string) {
  // A frame the page wrote rather than fetched – `about:blank`, `srcdoc`, a
  // blob – has no address of its own and belongs to the page that made it. Its
  // events still never reach the top document, so it is still guarded, and the
  // page is what its verdict is about.
  const own = getHostname(url)
  const judged = own && !isInternalPage(own) ? url : (tabUrl ?? '')
  const hostname = getHostname(judged)

  if (!hostname || isInternalPage(hostname)) {
    return {
      isSafe: true,
      ignored: false,
      guardPaste: false,
      warn: false,
      hostname: '',
    }
  }

  const record = await getVisitCountLogic(judged)
  return {
    isSafe: checkIfSiteIsSafe({ count: record.count, activeDays: record.activeDays, firstSeen: record.firstSeen }),
    ignored: record.ignored,
    guardPaste: Boolean(appSettings.value.blockPasteOnUnfamiliar),
    warn: Boolean(appSettings.value.showWarningNotification),
    hostname,
  }
}

/**
 * Hand something an iframe caught to the document the user can actually see.
 *
 * A dialog drawn inside the frame would be clipped to the frame's own box, which
 * for an advert or a payment widget is a couple of hundred pixels. `frameId: 0`
 * is the top document of the same tab, which owns the whole viewport.
 */
async function sendToTopFrame<T>(tabId: number | undefined, type: string, data: any): Promise<T | null> {
  if (tabId == null)
    return null
  try {
    return await browser.tabs.sendMessage(tabId, { type, data }, { frameId: 0 }) as T
  }
  catch {
    return null
  }
}

/** What a handler is told about where the message came from. */
interface MessageContext {
  tabId?: number
  /** The tab's top-level URL, which a frame with no address of its own needs. */
  tabUrl?: string
}

// Centralized message handlers map
const messageHandlers = {
  'get-visit-count': (data: any) => getVisitCountLogic(data.url),
  'get-domain-family': (data: any) => getDomainFamilyLogic(data.hostname),
  'find-lookalikes': (data: any) => findLookalikesLogic(data.hostname, data.context),
  // The options page calls this once a history import finishes, since an import
  // can move thousands of domains across the familiarity threshold at once
  'rebuild-familiar-index': async () => {
    await rebuildFamiliarIndex()
    return { success: true }
  },
  // Retry from the welcome page when the automatic import did not finish
  'run-history-import': async () => {
    await runAutoHistoryImport()
    return { success: true }
  },
  'ignore-site': (data: any) => handleIgnoreSite(data.hostname, data.ignored !== false),
  // What an iframe asks about itself, and the two things it can ask for
  'frame-verdict': (data: any, ctx?: MessageContext) => handleFrameVerdict(data.url, ctx?.tabUrl),
  'frame-warning': (data: any, ctx?: MessageContext) =>
    sendToTopFrame(ctx?.tabId, 'frame-warning', data),
  'frame-paste-intercept': async (data: any, ctx?: MessageContext) =>
    (await sendToTopFrame<{ allowed: boolean }>(ctx?.tabId, 'frame-paste-intercept', data)) ?? { allowed: false },
  // The settings page asks for this rather than emptying storage itself – see
  // `handleResetVisits` for what else has to go with the records
  'reset-visits': () => handleResetVisits(),
  'get-settings': () => getSettingsLogic(),
  // The menus namespace is not exposed to content scripts anywhere, so the one
  // context that can answer this is the one that would create the menu
  'get-platform': async () => ({ contextMenus: hasContextMenus() }),
  'show-notification': (data: any) => handleShowNotification(data.warningType),
  'tampering-detected': (data: any, ctx?: MessageContext) => handleTampering(ctx?.tabId, data?.url),
  'open-popup-tab': (data: any) => handleOpenPopupTab(data.domain),
  'resolve-short-url': async (data: any) => {
    // A retry is the user saying the answer they were given is not good enough.
    // Answering it from the same cache is the one thing this must not do.
    if (data.retry)
      clearCachedResolvedUrl(data.url)

    const cached = getCachedResolvedUrl(data.url)
    if (cached)
      return cached
    const result = await resolveUrlChain(data.url)
    setCachedResolvedUrl(data.url, result)
    return result
  },
  'add-custom-shortener': async (data: any) => {
    const domain = data.domain?.trim().toLowerCase()
    if (!domain)
      return { success: false }
    addCustomShortener(domain)
    const stored = await browser.storage.local.get('customShorteners')
    const list: string[] = (stored.customShorteners as string[]) || []
    if (!list.includes(domain)) {
      list.push(domain)
      await browser.storage.local.set({ customShorteners: list })
    }
    return { success: true }
  },
}

// Registered synchronously, answered only once the settings are real. A worker
// woken by the message cannot register its listeners after an await – the event
// would be gone – so the wait belongs inside the handler, not around it.
Object.entries(messageHandlers).forEach(([type, handler]) => {
  onMessage(type, async ({ data, sender }: any) => {
    await backgroundReady
    return (handler as (data: any, ctx?: MessageContext) => Promise<any>)(data, { tabId: sender?.tabId })
  })
})

// Add native runtime.onMessage listener for fallback (bfcache support)
browser.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  // Validate sender
  if (sender.id !== browser.runtime.id)
    return

  const handler = messageHandlers[message.type as keyof typeof messageHandlers]
  if (handler) {
    backgroundReady
      .then(() => (handler as (data: any, ctx?: MessageContext) => Promise<any>)(
        message.data,
        { tabId: sender.tab?.id, tabUrl: sender.tab?.url },
      ))
      .then(sendResponse)
    return true
  }
})

// ==========================================
// Context Menu for Link Safety (right-click)
// ==========================================

const CONTEXT_MENU_DOMAIN_ID = 'visilant-check-domain'
const CONTEXT_MENU_LINK_ID = 'visilant-check-link-safety'
const CONTEXT_MENU_SELECTION_ID = 'visilant-check-selection'
const CONTEXT_MENU_QR_IMAGE_ID = 'visilant-decode-qr-image'

async function setupContextMenu() {
  if (!hasContextMenus())
    return

  // Remove existing items first
  await browser.contextMenus.removeAll()

  // Always show domain safety check
  const domainTitle = await loadTranslation('linkContextMenuCheckDomain')
  browser.contextMenus.create({
    id: CONTEXT_MENU_DOMAIN_ID,
    title: domainTitle,
    contexts: ['link'],
  })

  // Show link safety check only when right-click trigger is selected
  if (appSettings.value.linkSafety?.enabled && appSettings.value.linkSafety?.tooltipTrigger === 'click-right') {
    const linkTitle = await loadTranslation('linkContextMenuCheckLink')
    browser.contextMenus.create({
      id: CONTEXT_MENU_LINK_ID,
      title: linkTitle,
      contexts: ['link'],
    })
  }

  // Check selected text (email address, URL or domain)
  const selectionTitle = await loadTranslation('contextMenuCheckSelection')
  browser.contextMenus.create({
    id: CONTEXT_MENU_SELECTION_ID,
    title: selectionTitle,
    contexts: ['selection'],
  })

  // Decode QR code from an image
  const qrTitle = await loadTranslation('contextMenuDecodeQr')
  browser.contextMenus.create({
    id: CONTEXT_MENU_QR_IMAGE_ID,
    title: qrTitle,
    contexts: ['image'],
  })
}

/**
 * Send a message to a tab without throwing when no content script is present.
 *
 * Addressed to the top document rather than broadcast. Every frame now runs a
 * script of its own, and a broadcast would put the same tooltip or dialog up
 * once per frame on the page.
 */
async function sendToTabSafe(tabId: number, message: { type: string, data: any }): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, message, { frameId: 0 })
    return true
  }
  catch {
    return false
  }
}

async function showQrNotification(messageKey: string, detail?: string) {
  const title = await loadTranslation('securityWarning')
  const message = await loadTranslation(messageKey)
  await browser.notifications.create({
    type: 'basic',
    title,
    message: detail ? `${message}\n${detail}` : message,
    iconUrl: browser.runtime.getURL('assets/site-danger-48.png'),
  })
}

/**
 * Ceiling on a right-clicked image. A QR code is a few kilobytes, and this is
 * fetched with the extension's own host permissions from whatever URL the page
 * put in the `src` – so it gets the same deadline and byte cap as a remote list.
 */
const MAX_QR_IMAGE_BYTES = 16 * 1024 * 1024

// Fetch an image by URL, decode a QR code from it and push the payload to the tab
async function handleQrImageCheck(srcUrl: string, tabId?: number) {
  let payload: string | null = null
  try {
    const blob = await fetchBlobBounded(srcUrl, {
      maxBytes: MAX_QR_IMAGE_BYTES,
      // A page can point `src` at anything. Whatever this is, it is not an image
      // and there is no QR code in it.
      accept: type => type.startsWith('image/'),
    })
    payload = await decodeQrFromImageBitmapSource(blob)
  }
  catch {
    await showQrNotification('qrDecodeError')
    return
  }

  if (!payload) {
    await showQrNotification('qrNotFound')
    return
  }

  const delivered = tabId != null && await sendToTabSafe(tabId, { type: 'show-qr-result', data: { payload } })
  if (!delivered) {
    // Content script unreachable (chrome://, PDF viewer...) – at least show the payload
    await showQrNotification('qrPayloadType', payload.slice(0, 120))
  }
}

// Create context menu on install
browser.runtime.onInstalled.addListener(async () => {
  await backgroundReady
  await setupContextMenu()
})

// Handle context menu click. Asked rather than assumed, because on a browser
// without the menus API touching the namespace throws, and a throw at this level
// would take every listener below it with it – including the settings watcher.
if (hasContextMenus()) {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_DOMAIN_ID && info.linkUrl) {
      if (/^mailto:/i.test(info.linkUrl)) {
        const parsed = parseMailtoUrl(info.linkUrl)
        const recipients = collectMailtoRecipients(parsed)
        // One recipient still gets the domain dashboard it always did. Several,
        // and there is no one domain to show – the check page reads them all.
        if (recipients.length > 1) {
          await handleOpenCheckTab(info.linkUrl)
        }
        else {
          const analysis = recipients[0] ? analyzeEmailAddress(recipients[0].address) : null
          if (analysis?.domain)
            await handleOpenPopupTab(analysis.domain)
        }
      }
      else {
        const hostname = getHostname(info.linkUrl)
        if (hostname)
          await handleOpenPopupTab(hostname)
      }
    }

    if (info.menuItemId === CONTEXT_MENU_LINK_ID && info.linkUrl && tab?.id) {
      // Send message to content script to show intercept dialog for this link
      await sendToTabSafe(tab.id, {
        type: 'show-link-intercept',
        data: { url: info.linkUrl },
      })
    }

    if (info.menuItemId === CONTEXT_MENU_SELECTION_ID && tab?.id) {
      await sendToTabSafe(tab.id, {
        type: 'check-selection',
        data: { selectionText: info.selectionText ?? '' },
      })
    }

    if (info.menuItemId === CONTEXT_MENU_QR_IMAGE_ID && info.srcUrl)
      await handleQrImageCheck(info.srcUrl, tab?.id)
  })
}

// Listen for changes in storage
browser.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    await backgroundReady

    // Parsed rather than cast: the stored value is a JSON string, and reading
    // fields straight off it yields `undefined` for every one of them – which
    // makes the comparison below always equal and the icon check below always true
    const previous = parseStoredSettings(changes.settings.oldValue)
    const current = parseStoredSettings(changes.settings.newValue)

    // The familiarity rules decide what goes in the index, so a change to any of
    // them invalidates the whole thing. Left to the next reader to rebuild, which
    // is also the point at which the new rules are certain to have landed.
    const previousRules = previous && familiaritySignature(normalizeFamiliarity(previous.familiarity))
    const currentRules = current && familiaritySignature(normalizeFamiliarity(current.familiarity))
    if (previousRules !== currentRules)
      invalidateFamiliarIndex()

    // Rebuild context menu when link safety settings change
    await setupContextMenu()

    // If settings changed and icon colors are disabled, reset all icons to default first
    if (current && !current.changeIcon) {
      await browser.action.setIcon({
        path: getIconPaths('icon-default'),
      })
    }

    // Update all tabs
    const tabs = await browser.tabs.query({})
    for (const tab of tabs) {
      if (tab.url && tab.id != null) {
        const hostname = getHostname(tab.url)
        await updateBadge(hostname, tab.id)
      }
    }
  }
})
