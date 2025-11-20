import type { Settings } from '~/logic/storage'
import { onMessage } from 'webext-bridge/background'
import { settings as appSettings } from '~/logic/storage'

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
async function updateExtensionIcon(count: number) {
  if (!appSettings.value.changeIcon) {
    // Set default icon when colors are disabled
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
    })
    return
  }

  const isSiteSafe = await checkIfSiteIsSafe(count)
  const iconType = isSiteSafe ? 'icon-default' : 'site-danger'
  await browser.action.setIcon({ path: getIconPaths(iconType) })
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

// Function to update visit count for a URL
async function updateVisitCount(url: string) {
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

  // Update badge
  await updateBadge(hostname)
}

// Function to update badge for current URL
async function updateBadge(hostname: string) {
  if (isInternalPage(hostname)) {
    await browser.action.setIcon({
      path: getIconPaths('icon-default'),
    })
    await browser.action.setBadgeText({ text: '' })
    return
  }

  const result = await browser.storage.local.get(hostname)
  const siteData = result[hostname] as { count: number, lastSeen: number, ignored: boolean } | undefined
  const count = siteData?.count || 0

  if (appSettings.value.showBadge) {
    await browser.action.setBadgeText({ text: count >= 1000 ? '>1K' : count.toString() })
    const isSiteSafe = await checkIfSiteIsSafe(count)
    const color = getBadgeColor(isSiteSafe)
    await browser.action.setBadgeBackgroundColor({ color })
  }
  else {
    await browser.action.setBadgeText({ text: '' })
  }

  await updateExtensionIcon(count)
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
  if (changeInfo.status === 'complete' && tab.url) {
    const hostname = getHostname(tab.url)

    // Skip internal pages
    if (isInternalPage(hostname)) {
      // Reset badge for internal pages
      await browser.action.setBadgeText({ text: '' })
      // Set default icon for internal pages
      await browser.action.setIcon({
        path: getIconPaths('icon-default'),
      })
      return
    }

    await updateVisitCount(tab.url)
  }
})

// Update badge when switching tabs
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await browser.tabs.get(tabId)
  if (tab.url) {
    const hostname = getHostname(tab.url)

    // Skip internal pages
    if (isInternalPage(hostname)) {
      // Reset badge for internal pages
      await browser.action.setBadgeText({ text: '' })
      // Set default icon for internal pages
      await browser.action.setIcon({
        path: getIconPaths('icon-default'),
      })
      return
    }

    await updateBadge(hostname)
  }
})

// Add message handler to get visit count
onMessage('get-visit-count', async ({ data }) => {
  const url = (data as { url: string }).url
  const hostname = getHostname(url)

  const result = await browser.storage.local.get(hostname)
  return (result[hostname] as { count: number, lastSeen: number, ignored: boolean, hostname: string } | undefined)
    || { count: 0, hostname, lastSeen: 0, ignored: false }
})

// Handle ignore site requests
onMessage<{ hostname: string }, string>('ignore-site', async ({ data }) => {
  const { hostname } = data

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
})

// Add message handler to get settings
onMessage('get-settings', async () => {
  // Return a plain object copy of the settings to avoid Proxy cloning issues in Firefox
  return JSON.parse(JSON.stringify(appSettings.value))
})

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
onMessage<{ warningType: 'input' | 'copy' }, string>('show-notification', async (req) => {
  // For browser notification, we translate here
  const title = await loadTranslation('securityWarning')

  // Get the appropriate message based on the warning type
  const messageKey = req.data.warningType === 'input' ? 'inputWarningMessage' : 'copyWarningMessage'
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
})

// Listen for changes in storage
browser.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
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
      if (tab.url) {
        const hostname = getHostname(tab.url)
        await updateBadge(hostname)
      }
    }
  }
})
