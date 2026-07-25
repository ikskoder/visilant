import type { Settings } from '~/logic/storage'
import { getDomain } from 'tldts'
import { onMessage } from 'webext-bridge/background'
import { analyzeEmailAddress, parseMailtoUrl } from '~/logic/email-safety'
import { decodeQrFromImageBitmapSource } from '~/logic/qr'
import { settings as appSettings } from '~/logic/storage'
import { addCustomShortener, getCachedResolvedUrl, loadCustomShorteners, resolveUrlChain, setCachedResolvedUrl } from '~/logic/url-shorteners'

// Load user-defined shortener domains on service worker start
browser.storage.local.get('customShorteners').then((stored) => {
  const list = (stored.customShorteners as string[]) || []
  if (list.length > 0)
    loadCustomShorteners(list)
})

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

// Function to check if a hostname is an internal page (no dots in hostname)
function isInternalPage(hostname: string): boolean {
  return !hostname.includes('.')
}

// Function to increment visit count for a URL (storage only — does NOT touch badge)
async function incrementVisitCount(url: string) {
  const hostname = getHostname(url)
  const result = await browser.storage.local.get(hostname)
  const now = Date.now()

  // Get existing data or create default
  const existingData = result[hostname] as {
    count: number
    lastSeen?: number
    ignored?: boolean
  } | undefined

  const currentCount = existingData?.count || 0
  const lastSeen = existingData?.lastSeen || 0
  const ignored = existingData?.ignored || false

  // Only increment count if more than 1 minute has passed since last visit
  const oneMinuteMs = 60000
  const shouldIncrement = !lastSeen || (now - lastSeen) > oneMinuteMs

  await browser.storage.local.set({
    [hostname]: {
      count: shouldIncrement ? currentCount + 1 : currentCount,
      lastSeen: now,
      ignored,
    },
  })
}

// Function to update badge for current URL
async function updateBadge(hostname: string, tabId?: number) {
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
  else if (details.reason === 'update') {
    // TODO: add some code that needs to run after ext was updated
  }
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

  // Only increment the visit count once per navigation, on complete.
  // Always count the visit, even if the tab is in the background.
  if (status === 'complete' && !isInternalPage(hostname))
    await incrementVisitCount(tab.url)

  // Only touch action badge/icon for the tab the user is actually looking at.
  // In Chrome, ctrl+click opens a background tab whose onUpdated fires while
  // the user stays on the original tab — setting per-tab badge state for that
  // background tab would visibly change the action icon shown for the active
  // tab. onActivated will refresh the badge if/when the user switches to it.
  if (!tab.active)
    return

  // Re-assert the badge on 'loading' too, not just 'complete'. Chrome resets
  // per-tab action state at the start of any navigation (including F5), so
  // without the loading-phase update the badge briefly falls back to the
  // global default or another tab's state until 'complete' arrives. Firefox
  // preserves per-tab state across navigations, so it doesn't need this.
  if (isInternalPage(hostname)) {
    await browser.action.setBadgeText({ text: '', tabId })
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
      tabId,
    })
    return
  }

  await updateBadge(hostname, tabId)
})

// Update badge when switching tabs
browser.tabs.onActivated.addListener(async ({ tabId }) => {
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
    // Content script unreachable (chrome://, PDF viewer...) — at least show the payload
    await showQrNotification('qrPayloadType', payload.slice(0, 120))
  }
}

// Create context menu on install
browser.runtime.onInstalled.addListener(async () => {
  await setupContextMenu()
})

// Handle context menu click
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

// Listen for changes in storage
browser.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    // Rebuild context menu when link safety settings change
    await setupContextMenu()

    // If settings changed and icon colors are disabled, reset all icons to default first
    const newSettings = changes.settings.newValue as Settings
    if (!newSettings.changeIcon) {
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
