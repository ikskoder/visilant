import type { Settings } from '~/logic/storage'
import { createApp } from 'vue'
import { setupApp } from '~/logic/common-setup'
import { settings } from '~/logic/storage'
import App from './views/App.vue'

// Helper to send message safely (fallback to runtime.sendMessage)
async function sendMessageSafe<T = any>(id: string, data: any): Promise<T> {
  // Always use runtime.sendMessage to avoid long-lived ports that cause bfcache issues
  return await browser.runtime.sendMessage({ type: id, data }) as T
}

// Function to check if a hostname is an internal page (no dots in hostname)
function isInternalPage(hostname: string): boolean {
  return !hostname.includes('.')
}

function generateSecureId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  // Determine a random length between 8 and 16
  const length = 8 + crypto.getRandomValues(new Uint8Array(1))[0] % 9
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)
  let id = ''
  for (let i = 0; i < length; i++) {
    // Use secure random numbers to pick characters from the pool
    id += chars[randomValues[i] % chars.length]
  }
  return id
}

// Check if site is safe based on visit count
async function checkSiteSafety(url: string): Promise<boolean> {
  const response = await sendMessageSafe<{ count: number }>('get-visit-count', { url })
  if (!response)
    return true // Default to safe if no response

  const visitData = response
  const count = visitData.count

  // Site is considered safe if count >= safety threshold
  return count >= settings.value.safety
}

// Load settings from storage
async function loadSettings() {
  try {
    // Request settings from background script
    const settingsData = await sendMessageSafe<Settings>('get-settings', {})
    if (settingsData) {
      // Update settings with values from storage
      settings.value = settingsData
    }
  }
  catch (error) {
    console.error('Failed to load settings:', error)
  }
  return settings.value
}

let app: ReturnType<typeof createApp> | null = null
let container: HTMLElement | null = null
let isMounting = false

async function mount() {
  if (isMounting)
    return

  isMounting = true
  try {
    // Check if current page is an internal page
    const hostname = window.location.hostname
    if (isInternalPage(hostname)) {
      // Exit early for internal pages
      return
    }

    // Load settings before proceeding
    await loadSettings()

    // Only inject if notifications are enabled and site is not safe
    const isNotificationsEnabled = settings.value.showWarningNotification
    const isSiteSafe = await checkSiteSafety(window.location.href)
    // Exit if notifications are disabled or site is safe
    if (!isNotificationsEnabled || isSiteSafe) {
      return
    }

    container = document.createElement('div')
    container.id = generateSecureId()
    const root = document.createElement('div')

    const styleEl = document.createElement('style')
    const response = await fetch(browser.runtime.getURL('dist/contentScripts/style.css'))
    const cssText = await response.text()
    styleEl.textContent = cssText

    const shadowDOM = container.attachShadow?.({ mode: __DEV__ ? 'open' : 'closed' }) || container
    shadowDOM.appendChild(styleEl)
    shadowDOM.appendChild(root)
    document.body.appendChild(container)

    app = createApp(App)
    setupApp(app)
    app.mount(root)
  }
  catch (e) {
    console.error('Failed to mount content script:', e)
  }
  finally {
    isMounting = false
  }
}

// Firefox `browser.tabs.executeScript()` requires scripts return a primitive value
(async () => {
  await mount()
})()

// Handle backward-forward cache
window.addEventListener('pageshow', async (event) => {
  if (event.persisted) {
    // Clean up existing instance if any
    if (app) {
      app.unmount()
      app = null
    }
    if (container) {
      container.remove()
      container = null
    }

    // Re-mount
    await mount()
  }
})
