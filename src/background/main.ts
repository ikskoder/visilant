import type { FamiliarDomain, FamiliarIndex } from '~/logic/domain-similarity'
import type { SiteVisitData } from '~/logic/storage'
import { getDomain } from 'tldts'
import { onMessage } from 'webext-bridge/background'
import { buildFamiliarIndex, findLookalikes } from '~/logic/domain-similarity'
import { getProviderReferenceDomains } from '~/logic/email-providers'
import { analyzeEmailAddress, parseMailtoUrl } from '~/logic/email-safety'
import { applyVisitToFamiliar, collectFamiliarDomains } from '~/logic/familiar-index'
import { HISTORY_AUTO_IMPORT_KEY, HISTORY_IMPORT_STATE_KEY, isImportAlive, readHistoryImportState, runHistoryImport, shouldAutoImport } from '~/logic/history-import'
import { hasContextMenus } from '~/logic/platform'
import { decodeQrFromImageBitmapSource } from '~/logic/qr'
import { settings as appSettings, parseStoredSettings, seedTextDefaultsOnce } from '~/logic/storage'
import { addCustomShortener, getCachedResolvedUrl, loadShortenersFromStorage, resolveUrlChain, setCachedResolvedUrl } from '~/logic/url-shorteners'
import { applyVisit, isTrackableHostname } from '~/logic/visit-stats'

// Load user-defined and remotely fetched shortener domains on service worker start
loadShortenersFromStorage()

// Available languages in the extension
const availableLanguages = [
  'en',
  'ru',
  'uk',
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

// Function to determine site safety level based on visit count
async function checkIfSiteIsSafe(count: number): Promise<IsSafe> {
  // Ensure we have numeric values
  const safetyThreshold = Number(appSettings.value.safety)
  return count >= safetyThreshold
}

// Function to get badge color based on safety level
function getBadgeColor(isSiteSafe: IsSafe): string {
  return isSiteSafe ? '#00C851' : '#ff4444'
}

// Function to update extension icon based on safety level
async function updateExtensionIcon(count: number, tabId?: number) {
  if (!appSettings.value.changeIcon) {
    // Set default icon when colors are disabled
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
      ...(tabId != null && { tabId }),
    })
    return
  }

  const isSiteSafe = await checkIfSiteIsSafe(count)
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
  const result = await browser.storage.local.get(hostname)
  const existingData = result[hostname] as SiteVisitData | undefined
  const updated = applyVisit(existingData, Date.now())

  await browser.storage.local.set({ [hostname]: updated })
  await noteVisitForFamiliarIndex(hostname, updated)
}

/**
 * Tabs where a page was caught removing or hiding our UI.
 *
 * The tampering badge has to outlast the ordinary badge refreshes, or the alarm
 * is undone by the next page-load event or by the user switching tabs and back.
 * Cleared when the tab starts loading something else, since that is a new page
 * and it has done nothing yet.
 */
const tamperedTabs = new Set<number>()

// Function to update badge for current URL
async function updateBadge(hostname: string, tabId?: number) {
  // Never paint over a tampering alarm with a routine visit count
  if (tabId != null && tamperedTabs.has(tabId))
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
  const siteData = result[hostname] as { count: number, lastSeen: number, ignored: boolean } | undefined
  const count = siteData?.count || 0

  if (appSettings.value.showBadge) {
    await browser.action.setBadgeText({
      text: count >= 1000 ? '>1K' : count.toString(),
      ...(tabId != null && { tabId }),
    })
    const isSiteSafe = await checkIfSiteIsSafe(count)
    const color = getBadgeColor(isSiteSafe)
    await browser.action.setBadgeBackgroundColor({ color, ...(tabId != null && { tabId }) })
  }
  else {
    await browser.action.setBadgeText({ text: '', ...(tabId != null && { tabId }) })
  }

  await updateExtensionIcon(count, tabId)
}

// ==========================================
// One-off automatic history import
// ==========================================

const WELCOME_PAGE = 'dist/welcome/index.html'

/**
 * Take a finished import into use: thousands of domains just crossed the
 * familiarity threshold at once, and every open tab is showing a stale badge.
 */
async function applyImportedHistory() {
  await rebuildFamiliarIndex()

  const tabs = await browser.tabs.query({})
  for (const tab of tabs) {
    if (tab.url && tab.id != null)
      await updateBadge(getHostname(tab.url), tab.id)
  }
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
export async function runAutoHistoryImport(attempts = 0): Promise<void> {
  await browser.storage.local.set({ [HISTORY_AUTO_IMPORT_KEY]: true })

  const quick = await runHistoryImport({ mode: 'quick', auto: true, attempts })
  if (quick.status !== 'done')
    return
  await applyImportedHistory()

  const full = await runHistoryImport({ mode: 'full', auto: true, attempts, resume: true })
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
  const state = await readHistoryImportState()
  if (!state || state.status !== 'running')
    return
  if (isImportAlive(state, Date.now()))
    return

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
    const full = await runHistoryImport({ mode: 'full', auto: true, attempts, resume: true })
    if (full.status === 'done')
      await applyImportedHistory()
    return
  }

  await runAutoHistoryImport(attempts)
}

// Both hooks are wanted: onStartup covers the browser being closed and reopened,
// the bare call covers a service worker that was killed while the browser stayed up
browser.runtime.onStartup.addListener(() => resumeInterruptedImport())
resumeInterruptedImport()

browser.runtime.onInstalled.addListener(async (details): Promise<void> => {
  if (details.reason === 'install') {
    // Get the best matching language
    const detectedLang = await getBestMatchingLanguage()

    // Set the detected language in the settings
    appSettings.value = {
      ...appSettings.value,
      selectedLanguage: detectedLang,
    }
  }
  // Fills in links and list sources for profiles whose settings predate them
  await seedTextDefaultsOnce()

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
    tamperedTabs.delete(tabId)

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
  if (isInternalPage(hostname) && !tamperedTabs.has(tabId)) {
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
browser.tabs.onRemoved.addListener((tabId) => {
  tamperedTabs.delete(tabId)
})

// Update badge when switching tabs
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  // Switching away and back must not quietly clear a tampering alarm
  if (tamperedTabs.has(tabId))
    return

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
  const base = getDomain(hostname) || hostname
  const allData = await browser.storage.local.get(null)
  const entries: { hostname: string, count: number }[] = []
  let total = 0
  for (const key of Object.keys(allData)) {
    if (key !== base && !key.endsWith(`.${base}`))
      continue
    const count = (allData[key] as { count?: number } | undefined)?.count
    if (typeof count === 'number') {
      entries.push({ hostname: key, count })
      total += count
    }
  }
  entries.sort((a, b) => b.count - a.count)
  return { baseDomain: base, entries, total }
}

// Add message handler to get visit count
async function getVisitCountLogic(url: string) {
  const hostname = getHostname(url)
  const result = await browser.storage.local.get(hostname)
  return (result[hostname] as { count: number, lastSeen: number, ignored: boolean, hostname: string } | undefined)
    || { count: 0, hostname, lastSeen: 0, ignored: false }
}

// ==========================================
// Familiar domain index (lookalike detection)
// ==========================================

const FAMILIAR_INDEX_KEY = '__visilantFamiliar'
/** A stored list older than this is rebuilt from scratch on next use. */
const FAMILIAR_INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface StoredFamiliarList {
  domains: FamiliarDomain[]
  threshold: number
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
    threshold: appSettings.value.safety,
    builtAt: Date.now(),
  }
  await browser.storage.local.set({ [FAMILIAR_INDEX_KEY]: payload })
}

/** Read every stored hostname and derive the familiar list from scratch. */
async function rebuildFamiliarDomains(): Promise<FamiliarDomain[]> {
  const records = await browser.storage.local.get(null)
  const domains = collectFamiliarDomains(records, {
    threshold: appSettings.value.safety,
    toRegistrable: hostname => getDomain(hostname),
  })

  await persistFamiliarDomains(domains)
  return domains
}

async function loadFamiliarDomains(): Promise<void> {
  const stored = (await browser.storage.local.get(FAMILIAR_INDEX_KEY))[FAMILIAR_INDEX_KEY] as StoredFamiliarList | undefined

  const isUsable = stored
    && Array.isArray(stored.domains)
    && stored.threshold === appSettings.value.safety
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
async function noteVisitForFamiliarIndex(hostname: string, visitData: SiteVisitData) {
  if (!familiarDomains)
    return

  const registrable = getDomain(hostname)
  if (!registrable)
    return

  const added = applyVisitToFamiliar(familiarDomains, registrable, visitData.count, appSettings.value.safety)
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
  return findLookalikes(hostname, index, getDomain(hostname) || undefined)
}

// Handle ignore site requests
async function handleIgnoreSite(hostname: string) {
  if (!hostname)
    return 'Error: No hostname provided'

  // Get current site data
  const result = await browser.storage.local.get(hostname)
  const siteData = result[hostname] || { count: 0, lastSeen: 0, ignored: false }

  // Update ignored status
  await browser.storage.local.set({
    [hostname]: {
      ...siteData,
      ignored: true,
    },
  })

  return 'Site ignored successfully'
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
async function handleTampering(tabId?: number) {
  // Marked before anything is awaited: a page that strikes mid-load would
  // otherwise have its alarm painted over by the load's own badge refresh
  if (tabId != null)
    tamperedTabs.add(tabId)

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

  // Update badge to show error state (per-tab if available)
  await browser.action.setBadgeText({ text: '!!!', ...(tabId != null && { tabId }) })
  await browser.action.setBadgeBackgroundColor({ color: '#FF0000', ...(tabId != null && { tabId }) })
  await browser.action.setIcon({ path: getIconPaths('site-danger'), ...(tabId != null && { tabId }) })

  return 'Tampering handled'
}

// Open popup page in a new tab with domain context
async function handleOpenPopupTab(domain: string) {
  const popupUrl = browser.runtime.getURL(`dist/popup/index.html?domain=${encodeURIComponent(domain)}`)
  await browser.tabs.create({ url: popupUrl })
  return 'Popup tab opened'
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
  'ignore-site': (data: any) => handleIgnoreSite(data.hostname),
  'get-settings': () => getSettingsLogic(),
  'show-notification': (data: any) => handleShowNotification(data.warningType),
  'tampering-detected': (_data: any, ctx?: { tabId?: number }) => handleTampering(ctx?.tabId),
  'open-popup-tab': (data: any) => handleOpenPopupTab(data.domain),
  'resolve-short-url': async (data: any) => {
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

// Register webext-bridge handlers
Object.entries(messageHandlers).forEach(([type, handler]) => {
  onMessage(type, async ({ data, sender }: any) => handler(data, { tabId: sender?.tabId }))
})

// Add native runtime.onMessage listener for fallback (bfcache support)
browser.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  // Validate sender
  if (sender.id !== browser.runtime.id)
    return

  const handler = messageHandlers[message.type as keyof typeof messageHandlers]
  if (handler) {
    handler(message.data, { tabId: sender.tab?.id }).then(sendResponse)
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

// Send a message to a tab without throwing when no content script is present
async function sendToTabSafe(tabId: number, message: { type: string, data: any }): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, message)
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

// Fetch an image by URL, decode a QR code from it and push the payload to the tab
async function handleQrImageCheck(srcUrl: string, tabId?: number) {
  let payload: string | null = null
  try {
    const response = await fetch(srcUrl)
    if (!response.ok)
      throw new Error(`fetch failed: ${response.status}`)
    const blob = await response.blob()
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
  await setupContextMenu()
})

// Handle context menu click. Asked rather than assumed, because on a browser
// without the menus API touching the namespace throws, and a throw at this level
// would take every listener below it with it – including the settings watcher.
if (hasContextMenus()) {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_DOMAIN_ID && info.linkUrl) {
      // Open detailed popup in a new tab for the link's domain
      let hostname: string | null = null
      if (/^mailto:/i.test(info.linkUrl)) {
        const parsed = parseMailtoUrl(info.linkUrl)
        const analysis = parsed?.addresses[0] ? analyzeEmailAddress(parsed.addresses[0]) : null
        hostname = analysis?.domain ?? null
      }
      else {
        hostname = getHostname(info.linkUrl)
      }
      if (hostname)
        await handleOpenPopupTab(hostname)
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
    // Parsed rather than cast: the stored value is a JSON string, and reading
    // fields straight off it yields `undefined` for every one of them – which
    // makes the comparison below always equal and the icon check below always true
    const previous = parseStoredSettings(changes.settings.oldValue)
    const current = parseStoredSettings(changes.settings.newValue)

    // The familiarity threshold decides what goes in the index, so a change to
    // it invalidates the whole thing. Left to the next reader to rebuild, which
    // is also the point at which the new threshold is certain to have landed.
    if (previous?.safety !== current?.safety)
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
