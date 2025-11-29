import type { Settings } from '~/logic/storage'
import { createApp } from 'vue'
import { setupApp } from '~/logic/common-setup'
import { defaultSettings, settings } from '~/logic/storage'
import { hasNotifiedOnThisPage, isIgnored, safetyLevel, showWarning, warningType } from '~/logic/ui-state'
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
  const response = await sendMessageSafe<{ count: number, ignored: boolean }>('get-visit-count', { url })
  if (!response) {
    safetyLevel.value = true
    return true // Default to safe if no response
  }

  const visitData = response
  const count = visitData.count

  // Update ignored state
  if (visitData.ignored) {
    isIgnored.value = true
  }

  // Site is considered safe if count >= safety threshold
  const isSafe = count >= settings.value.safety
  safetyLevel.value = isSafe
  return isSafe
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
  // Ensure settings are initialized
  if (!settings.value) {
    settings.value = defaultSettings
  }
  return settings.value
}

// Show notifications based on user preferences
async function showNotifications(type: 'input' | 'copy') {
  // Ensure settings are initialized
  if (!settings.value) {
    settings.value = defaultSettings
  }

  // Check if this site is ignored
  if (isIgnored.value) {
    return
  }

  // Check if we've already shown a notification on this page
  if (hasNotifiedOnThisPage.value) {
    return
  }

  // Check if the specific warning type is enabled
  if (type === 'input' && !settings.value.showInputWarning) {
    return
  }

  if (type === 'copy' && !settings.value.showCopyWarning) {
    return
  }

  // Set the warning type
  warningType.value = type

  const style = settings.value.notificationStyle || defaultSettings.notificationStyle

  if (style === 'browser' || style === 'both')
    await sendMessageSafe('show-notification', { warningType: type }) // Show browser notification with type

  if (style === 'in-page' || style === 'both')
    showWarning.value = true

  // Update tracking state
  hasNotifiedOnThisPage.value = true
}

// Handle keydown event
async function handleKeydown(event: KeyboardEvent) {
  // Check for copy/cut key combinations (Ctrl+C or Ctrl+X)
  if (event.ctrlKey && (event.key === 'c' || event.key === 'C' || event.key === 'x' || event.key === 'X')) {
    // For copy/cut operations, use the copy notification type instead of input
    if (safetyLevel.value === false && settings.value?.showWarningNotification) {
      await showNotifications('copy')
    }
    return
  }

  // Skip triggering warnings for any keys pressed with modifiers (Ctrl or Alt)
  if (event.ctrlKey || event.altKey) {
    return
  }

  // List of keys to ignore (special keys and navigation keys)
  const ignoredKeys = [
    'Shift',
    // Ctrl is used in copy/cut/paste so it might be dangerous to ignore it
    // UPD: Made dedicated copy/cut/paste handler, so now it's fine
    'Control',
    'Alt',
    'Meta',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Tab',
    'Escape',
    'Enter',
    'CapsLock',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'F1',
    'F2',
    'F3',
    'F4',
    'F5',
    'F6',
    'F7',
    'F8',
    'F9',
    'F10',
    'F11',
    'F12',
  ]

  // If the pressed key is in the ignored list, do nothing.
  if (ignoredKeys.includes(event.key)) {
    return
  }

  // Trigger notification if conditions are met.
  if (safetyLevel.value === false && settings.value?.showWarningNotification) {
    await showNotifications('input')
  }
}

// Handle paste event
async function handlePaste() {
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('input')
}

// Handle copy/cut events
async function handleCopyCut() {
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('copy')
}

// Register listeners immediately with capture: true to prevent blocking
window.addEventListener('keydown', handleKeydown, true)
window.addEventListener('paste', handlePaste, true)
window.addEventListener('copy', handleCopyCut, true)
window.addEventListener('cut', handleCopyCut, true)

let app: ReturnType<typeof createApp> | null = null
let container: HTMLElement | null = null
let observer: MutationObserver | null = null
let internalObserver: MutationObserver | null = null
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

    // Wait for body to be available
    while (!document.body) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }

    // Only inject if notifications are enabled and site is not safe
    // Note: settings and safety are already loaded by the init function
    const isNotificationsEnabled = settings.value.showWarningNotification
    const isSiteSafe = safetyLevel.value

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

    // Watch for tampering (removal of our container)
    // Start observing BEFORE appending to catch immediate removals
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.removedNodes.forEach((node) => {
          if (node === container) {
            // Our container was removed!
            // Check if it was intentional (e.g. during unmount)
            if (app) { // If app still exists, it means we didn't initiate the unmount
              sendMessageSafe('tampering-detected', {})
              // Disconnect observer to avoid loops
              observer?.disconnect()
              observer = null
              internalObserver?.disconnect()
              internalObserver = null
            }
          }
        })
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: false, // We only care if our direct container is removed from body
    })

    document.body.appendChild(container)

    // Immediate verification
    if (!document.body.contains(container)) {
      if (app) {
        sendMessageSafe('tampering-detected', {})
        observer?.disconnect()
        observer = null
      }
    }

    // Watch for internal tampering (removal of shadow DOM content)
    internalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.removedNodes.forEach((node) => {
          // If the root div or style element is removed from shadow DOM
          if (node === root || node === styleEl) {
            if (app) {
              sendMessageSafe('tampering-detected', {})
              internalObserver?.disconnect()
              internalObserver = null
              observer?.disconnect()
              observer = null
            }
          }
        })
      }
    })

    internalObserver.observe(shadowDOM, {
      childList: true,
      subtree: true, // Watch deep changes inside shadow DOM too if needed, but childList on shadowRoot is enough for direct children
    })

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
  // Initialize settings and check safety immediately
  await loadSettings()
  await checkSiteSafety(window.location.href)
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
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (internalObserver) {
      internalObserver.disconnect()
      internalObserver = null
    }
    if (container) {
      container.remove()
      container = null
    }

    // Re-mount
    await mount()
  }
})
