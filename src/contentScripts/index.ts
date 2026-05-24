import type { Settings } from '~/logic/storage'
import { createApp } from 'vue'
import { setupApp } from '~/logic/common-setup'
import { checkDomainMismatch, findAnchorElement, getCachedVisitCount, getHostnameFromHref, getPunycodeInfo, isDomainInScope, isExternalLink, setCachedVisitCount } from '~/logic/link-safety'
import { defaultSettings, settings } from '~/logic/storage'
import { hasNotifiedOnThisPage, isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, safetyLevel, setOnTooltipHoverEnter, showWarning, warningType } from '~/logic/ui-state'
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

// ==========================================
// Link Safety — tooltip and intercept logic
// ==========================================

let hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null
let tooltipGraceTimer: ReturnType<typeof setTimeout> | null = null
let currentHoveredAnchor: HTMLAnchorElement | null = null
let linkSafetyCleanup: (() => void) | null = null

// Register callback so tooltip component can cancel the grace timer on mouseenter
setOnTooltipHoverEnter(() => {
  if (tooltipGraceTimer) {
    clearTimeout(tooltipGraceTimer)
    tooltipGraceTimer = null
  }
})

async function fetchLinkData(href: string, hostname: string) {
  // Check cache first
  const cached = getCachedVisitCount(hostname)
  if (cached)
    return cached

  // Fetch from background
  const response = await sendMessageSafe<{ count: number, ignored: boolean }>('get-visit-count', { url: href })
  if (!response)
    return { count: 0, isSafe: true, ignored: false }

  const isSafe = response.count >= settings.value.safety
  const data = { count: response.count, isSafe, ignored: response.ignored }
  setCachedVisitCount(hostname, data)
  return data
}

function calculateTooltipPosition(anchor: HTMLAnchorElement): { top: number, left: number } {
  const rect = anchor.getBoundingClientRect()
  const tooltipHeight = 120 // estimated base height (expands with mismatch/punycode warnings)
  const tooltipWidth = 320

  let top = rect.bottom + 6
  let left = rect.left

  // Flip above if near bottom of viewport
  if (top + tooltipHeight > window.innerHeight)
    top = rect.top - tooltipHeight - 6

  // Clamp horizontally
  if (left + tooltipWidth > window.innerWidth)
    left = window.innerWidth - tooltipWidth - 8

  if (left < 8)
    left = 8

  return { top, left }
}

// Show tooltip for a URL without an anchor element (used by context menu)
async function showLinkTooltipByUrl(url: string) {
  const hostname = getHostnameFromHref(url)
  if (!hostname)
    return

  const currentHostname = window.location.hostname
  if (!isExternalLink(url, currentHostname))
    return

  const visitData = await fetchLinkData(url, hostname)
  const punycodeResult = getPunycodeInfo(hostname)

  // Position in center-top of viewport since we don't have anchor position
  const position = {
    top: 80,
    left: Math.max(8, (window.innerWidth - 320) / 2),
  }

  linkTooltipData.value = {
    domain: hostname,
    count: visitData.count,
    isSafe: visitData.isSafe,
    mismatch: null, // No text to compare from context menu
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    position,
    href: url,
  }
  linkTooltipVisible.value = true
}

async function showLinkTooltip(anchor: HTMLAnchorElement) {
  const href = anchor.href
  const hostname = getHostnameFromHref(href)
  if (!hostname)
    return

  const currentHostname = window.location.hostname
  if (!isExternalLink(href, currentHostname))
    return

  const visitData = await fetchLinkData(href, hostname)

  // Check for domain mismatch (link text vs href)
  const linkText = anchor.textContent || ''
  const mismatchResult = checkDomainMismatch(linkText, hostname)

  // Fetch textDomain visit data if mismatch
  let mismatch: { textDomain: string, textDomainCount: number, textDomainIsSafe: boolean } | null = null
  if (mismatchResult.mismatch && mismatchResult.textDomain) {
    const textDomainData = await fetchLinkData(`https://${mismatchResult.textDomain}`, mismatchResult.textDomain)
    mismatch = { textDomain: mismatchResult.textDomain, textDomainCount: textDomainData.count, textDomainIsSafe: textDomainData.isSafe }
  }

  // Check for punycode/unicode
  const punycodeResult = getPunycodeInfo(hostname)

  const position = calculateTooltipPosition(anchor)

  linkTooltipData.value = {
    domain: hostname,
    count: visitData.count,
    isSafe: visitData.isSafe,
    mismatch,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    position,
    href,
  }
  linkTooltipVisible.value = true
}

function navigateToUrl(url: string, target: string) {
  if (target === '_blank' || target === '_new')
    window.open(url, '_blank', 'noopener,noreferrer')
  else
    window.location.href = url
}

async function handleLinkIntercept(anchor: HTMLAnchorElement, openInNewTab: boolean): Promise<boolean> {
  const href = anchor.href
  const target = openInNewTab ? '_blank' : (anchor.target || '_self')
  const hostname = getHostnameFromHref(href)
  if (!hostname) {
    navigateToUrl(href, target)
    return false
  }

  const currentHostname = window.location.hostname
  if (!isExternalLink(href, currentHostname)) {
    navigateToUrl(href, target)
    return false
  }

  const visitData = await fetchLinkData(href, hostname)

  // Safe site — allow navigation
  if (visitData.isSafe) {
    navigateToUrl(href, target)
    return false
  }

  // Check for mismatch and punycode
  const linkText = anchor.textContent || ''
  const mismatchResult = checkDomainMismatch(linkText, hostname)
  const punycodeResult = getPunycodeInfo(hostname)

  // Fetch textDomain visit data if mismatch
  let interceptMismatch: { textDomain: string, textDomainCount: number, textDomainIsSafe: boolean } | null = null
  if (mismatchResult.mismatch && mismatchResult.textDomain) {
    const textDomainData = await fetchLinkData(`https://${mismatchResult.textDomain}`, mismatchResult.textDomain)
    interceptMismatch = { textDomain: mismatchResult.textDomain, textDomainCount: textDomainData.count, textDomainIsSafe: textDomainData.isSafe }
  }

  linkInterceptData.value = {
    domain: hostname,
    url: href,
    target,
    count: visitData.count,
    isSafe: visitData.isSafe,
    mismatch: interceptMismatch,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
  }
  linkInterceptVisible.value = true

  // Return a promise that resolves when user decides
  return new Promise<boolean>((resolve) => {
    linkInterceptResolve.value = resolve
  })
}

function setupLinkSafety() {
  const linkSafety = settings.value.linkSafety
  if (!linkSafety?.enabled)
    return

  const currentHostname = window.location.hostname

  // Check scope
  if (!isDomainInScope(currentHostname, linkSafety))
    return

  const trigger = linkSafety.tooltipTrigger

  // Hover trigger: mouseenter/mouseleave via event delegation
  function handleMouseOver(event: MouseEvent) {
    if (trigger !== 'hover')
      return

    const anchor = findAnchorElement(event.target)
    if (!anchor || !anchor.href)
      return

    if (!isExternalLink(anchor.href, currentHostname))
      return

    // Clear any grace timer (user moved back to a link)
    if (tooltipGraceTimer) {
      clearTimeout(tooltipGraceTimer)
      tooltipGraceTimer = null
    }

    // If hovering same anchor, keep showing
    if (currentHoveredAnchor === anchor && linkTooltipVisible.value)
      return

    // If switching to a different link, immediately hide the old tooltip
    if (currentHoveredAnchor && currentHoveredAnchor !== anchor && linkTooltipVisible.value) {
      linkTooltipVisible.value = false
      linkTooltipData.value = null
    }

    currentHoveredAnchor = anchor

    // Debounce
    if (hoverDebounceTimer)
      clearTimeout(hoverDebounceTimer)

    hoverDebounceTimer = setTimeout(() => {
      if (currentHoveredAnchor === anchor)
        showLinkTooltip(anchor)
    }, 300)
  }

  function handleMouseOut(event: MouseEvent) {
    if (trigger !== 'hover')
      return

    const anchor = findAnchorElement(event.target)
    if (!anchor)
      return

    if (anchor === currentHoveredAnchor) {
      // Clear debounce
      if (hoverDebounceTimer) {
        clearTimeout(hoverDebounceTimer)
        hoverDebounceTimer = null
      }

      // Grace period before hiding (allows moving cursor to tooltip)
      tooltipGraceTimer = setTimeout(() => {
        currentHoveredAnchor = null
        linkTooltipVisible.value = false
        linkTooltipData.value = null
      }, 300)
    }
  }

  // Click handler for left-click tooltip trigger AND navigation intercept
  function handleClick(event: MouseEvent) {
    const anchor = findAnchorElement(event.target)
    if (!anchor || !anchor.href)
      return

    if (!isExternalLink(anchor.href, currentHostname))
      return

    // Left click tooltip trigger
    if (trigger === 'click-left') {
      event.preventDefault()
      event.stopPropagation()
      showLinkTooltip(anchor)
      return
    }

    // Navigation intercept (only for left clicks, not already handled by click-left trigger)
    // Block navigation immediately (synchronously) before async check
    if (linkSafety.interceptEnabled && event.button === 0) {
      event.preventDefault()
      event.stopPropagation()
      handleLinkIntercept(anchor, event.ctrlKey || event.metaKey)
    }
  }

  // Dismiss tooltip on scroll or Escape
  function handleScroll() {
    if (linkTooltipVisible.value) {
      linkTooltipVisible.value = false
      linkTooltipData.value = null
      currentHoveredAnchor = null
    }
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (linkTooltipVisible.value) {
        linkTooltipVisible.value = false
        linkTooltipData.value = null
        currentHoveredAnchor = null
      }
      if (linkInterceptVisible.value) {
        linkInterceptVisible.value = false
        linkInterceptData.value = null
        if (linkInterceptResolve.value) {
          linkInterceptResolve.value(false)
          linkInterceptResolve.value = null
        }
      }
    }
  }

  // Register all listeners
  document.addEventListener('mouseover', handleMouseOver, true)
  document.addEventListener('mouseout', handleMouseOut, true)
  document.addEventListener('click', handleClick, true)
  window.addEventListener('scroll', handleScroll, true)
  document.addEventListener('keydown', handleEscape, true)

  // Return cleanup function
  linkSafetyCleanup = () => {
    document.removeEventListener('mouseover', handleMouseOver, true)
    document.removeEventListener('mouseout', handleMouseOut, true)
    document.removeEventListener('click', handleClick, true)
    window.removeEventListener('scroll', handleScroll, true)
    document.removeEventListener('keydown', handleEscape, true)
    if (hoverDebounceTimer)
      clearTimeout(hoverDebounceTimer)
    if (tooltipGraceTimer)
      clearTimeout(tooltipGraceTimer)
    currentHoveredAnchor = null
  }
}

// ==========================================
// Mount / Lifecycle
// ==========================================

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

    // Determine if we need to mount the UI
    const isNotificationsEnabled = settings.value.showWarningNotification
    const isSiteSafe = safetyLevel.value
    const isLinkSafetyEnabled = settings.value.linkSafety?.enabled

    // Mount if: (warnings needed) OR (link safety enabled)
    const needsWarningUI = isNotificationsEnabled && !isSiteSafe
    if (!needsWarningUI && !isLinkSafetyEnabled) {
      return
    }

    container = document.createElement('div')
    container.id = generateSecureId()

    // Add robust styles to container to ensure it's on top and visible
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      overflow: 'visible',
      zIndex: '2147483647', // Max z-index
      pointerEvents: 'none', // Let clicks pass through the container itself
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    })

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
      subtree: true,
    })

    app = createApp(App)
    setupApp(app)
    app.mount(root)

    // Setup link safety after app is mounted
    setupLinkSafety()
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

// Listen for context menu tooltip requests from background
browser.runtime.onMessage.addListener((message: any) => {
  if (message.type === 'show-link-tooltip-at-cursor' && message.data?.url) {
    showLinkTooltipByUrl(message.data.url)
  }
})

// Handle backward-forward cache
window.addEventListener('pageshow', async (event) => {
  if (event.persisted) {
    // Clean up link safety listeners
    if (linkSafetyCleanup) {
      linkSafetyCleanup()
      linkSafetyCleanup = null
    }

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
