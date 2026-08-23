import type { FamiliarityStats } from '~/logic/familiarity'
import type { VisitFacts } from '~/logic/link-safety'
import type { Settings } from '~/logic/storage'
import type { TamperWatch } from '~/logic/tamper-watch'
import type { CheckPanelData, DomainFamilyInfo, LinkTooltipData, RawPayloadInfo } from '~/logic/ui-state'
import type { ResolvedUrlResult } from '~/logic/url-shorteners'
import { createApp, watchEffect } from 'vue'
import { setupApp } from '~/logic/common-setup'
import { classifyEmailDomain, loadEmailListsFromStorage } from '~/logic/email-providers'
import { analyzeEmailAddress, extractEmailFromText, parseMailtoUrl } from '~/logic/email-safety'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { checkDomainMismatch, extractDomainFromText, findAnchorElement, getCachedVisitCount, getHostnameFromHref, getPunycodeInfo, isDomainInScope, isExternalLink, isMailtoHref, setCachedVisitCount } from '~/logic/link-safety'
import { watchListStorage } from '~/logic/list-sync'
import { describePastePayload, isEditableTarget, shouldInterceptPaste } from '~/logic/paste-guard'
import { classifyPayload, extractCheckTarget } from '~/logic/payload-classify'
import { resolveTooltipTrigger } from '~/logic/platform'
import { applySettingsSnapshot, defaultSettings, makeSettingsReadOnly, settings } from '~/logic/storage'
import { applyHostStyles, createTamperWatch } from '~/logic/tamper-watch'
import { checkPanelData, checkPanelVisible, hasNotifiedOnThisPage, isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, pasteAllowedOnThisPage, pasteInterceptData, pasteInterceptResolve, pasteInterceptVisible, safetyLevel, setOnTooltipHoverEnter, setOnTooltipHoverLeave, showWarning, warningType } from '~/logic/ui-state'
import { addCustomShortener, isShortenedUrl, loadShortenersFromStorage } from '~/logic/url-shorteners'
import { isTrackableHostname } from '~/logic/visit-stats'
import App from './views/App.vue'

/** What the background hands back for one hostname – see `getVisitCountLogic`. */
interface VisitCountResponse {
  hostname: string
  count: number
  lastSeen: number
  ignored: boolean
  activeDays?: number
  firstSeen?: number
}

/**
 * A tab shows what the settings say, it does not decide what they are.
 *
 * Said before anything reads them. Every open document holds its own copy of the
 * same blob, so a document allowed to write is a document that can put its copy
 * back over a newer one – and there is no edit in a tab worth that risk. The
 * settings page and the popup are the writers.
 */
makeSettingsReadOnly()

// Helper to send message safely (fallback to runtime.sendMessage)
async function sendMessageSafe<T = any>(id: string, data: any): Promise<T> {
  // Always use runtime.sendMessage to avoid long-lived ports that cause bfcache issues
  return await browser.runtime.sendMessage({ type: id, data }) as T
}

// Function to check if a hostname is an internal page (no dots in hostname)
function isInternalPage(hostname: string): boolean {
  return !isTrackableHostname(hostname)
}

// Check if a domain is excluded from anti-tampering protection
function isAntiTamperingExcluded(hostname: string): boolean {
  const excludedStr = settings.value.antiTamperingExcludedDomains
  if (!excludedStr)
    return false
  const excluded = excludedStr.split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean)
  const lowerHostname = hostname.toLowerCase()
  return excluded.some(domain => lowerHostname === domain || lowerHostname.endsWith(`.${domain}`))
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
  // Dotless hostnames (localhost, intranet names) are deliberately never counted,
  // so their visit count is permanently 0. Reading that as "unfamiliar" would
  // warn about them forever with no way for the user to teach it otherwise, which
  // is the opposite of what not tracking them was supposed to mean.
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  }
  catch {
    // Unparseable URL: nothing to judge, so judge nothing
  }
  if (!hostname || isInternalPage(hostname)) {
    safetyLevel.value = true
    return true
  }

  const response = await sendMessageSafe<VisitCountResponse>('get-visit-count', { url })
  if (!response) {
    safetyLevel.value = true
    return true // Default to safe if no response
  }

  const visitData = response

  // Update ignored state
  if (visitData.ignored) {
    isIgnored.value = true
  }

  // Visits, active days and age, in whatever combination the user asked for
  const isSafe = isFamiliar(visitData, normalizeFamiliarity(settings.value.familiarity))
  safetyLevel.value = isSafe
  return isSafe
}

/**
 * Whether the browser can put an item in the long-press menu.
 *
 * Asked of the background, because the menus namespace is not handed to content
 * scripts on any platform. Starts as no: a right-click trigger that cannot fire
 * is silence, and silence is the one failure this feature must not have.
 */
let canUseContextMenus = false

async function loadPlatformCapabilities() {
  try {
    const platform = await sendMessageSafe<{ contextMenus?: boolean }>('get-platform', {})
    canUseContextMenus = platform?.contextMenus === true
  }
  catch {
    // Left as no, which resolves a right-click trigger to the tap
  }
}

// Load settings from storage
async function loadSettings() {
  try {
    // Request settings from background script
    const settingsData = await sendMessageSafe<Settings>('get-settings', {})
    if (settingsData) {
      // Taken as a snapshot, not assigned: assigning would save it straight back
      applySettingsSnapshot(settingsData)
    }
    // Load user-defined and remotely fetched shortener domains
    await loadShortenersFromStorage()
    // Load public/disposable email-domain lists for address classification
    await loadEmailListsFromStorage()
    // Answered before the link-safety setup below reads it
    await loadPlatformCapabilities()
  }
  catch (error) {
    console.error('Failed to load settings:', error)
  }
  // Ensure settings are initialized
  if (!settings.value)
    applySettingsSnapshot(defaultSettings)
  return settings.value
}

// Show notifications based on user preferences
async function showNotifications(type: 'input' | 'copy') {
  // Ensure settings are initialized
  if (!settings.value)
    applySettingsSnapshot(defaultSettings)

  // Check if this site is ignored
  if (isIgnored.value) {
    return
  }

  // Confirming a paste answers the same question this warning asks, so asking it
  // again straight afterwards is the noise the confirmation was meant to end
  if (pasteAllowedOnThisPage.value) {
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

  // Claimed here rather than at the end: a keystroke and the `beforeinput` it
  // produces arrive in the same tick, and both would clear the check above
  // before either had finished awaiting its way to setting the flag.
  hasNotifiedOnThisPage.value = true

  const style = settings.value.notificationStyle || defaultSettings.notificationStyle

  // In-page first, and never behind the system one. `both` used to await the
  // browser notification and only then raise this, so anything that rejected on
  // the way – a background that would not wake, an Android that refuses to show
  // notifications at all – took the in-page warning down with it. This is the
  // half that always works, so it goes first and does not depend on the other.
  if (style === 'in-page' || style === 'both')
    showWarning.value = true

  if (style === 'browser' || style === 'both') {
    try {
      await sendMessageSafe('show-notification', { warningType: type })
    }
    catch {
      // A warning that did not appear is the one outcome this feature cannot
      // have, so the system notification failing falls back to the page
      showWarning.value = true
    }
  }
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

/**
 * Stop the paste, ask, and then get out of the way.
 *
 * Deliberately never inserts the text itself. Re-inserting would mean plain text
 * only, a rebuilt undo stack and the page's own paste handling skipped, which is
 * a lot of ways to break a page in exchange for saving one keystroke. Allowing
 * simply stops the blocking, and the user's next paste is an ordinary paste that
 * the extension does not touch at all.
 */
async function interceptPaste(target: HTMLElement, text: string) {
  const hostname = window.location.hostname
  const visits = await sendMessageSafe<VisitCountResponse>('get-visit-count', { url: window.location.href })
  const punycodeResult = getPunycodeInfo(hostname)

  await ensureTooltipUiMounted()
  pasteInterceptData.value = {
    domain: hostname,
    stats: { count: visits?.count || 0, activeDays: visits?.activeDays, firstSeen: visits?.firstSeen },
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    payload: describePastePayload(text),
  }

  const allowed = await new Promise<boolean>((resolve) => {
    pasteInterceptResolve.value = resolve
    pasteInterceptVisible.value = true
  })

  if (allowed)
    pasteAllowedOnThisPage.value = true

  // Either way the user is done with the dialog and wants to be back in the field
  target.focus({ preventScroll: true })
}

// Handle paste event
async function handlePaste(event: ClipboardEvent) {
  const current = settings.value || defaultSettings
  const text = event.clipboardData?.getData('text/plain') || ''

  if (shouldInterceptPaste({
    enabled: Boolean(current.blockPasteOnUnfamiliar),
    siteIsSafe: safetyLevel.value,
    ignored: isIgnored.value,
    hasText: text.length > 0,
    targetIsEditable: isEditableTarget(event.target),
    alreadyAllowed: pasteAllowedOnThisPage.value,
  })) {
    // Stopping propagation as well as the default is the point: a page with its
    // own paste handler reads the clipboard itself and inserts the text, so
    // cancelling only the default would be theatre rather than protection
    event.preventDefault()
    event.stopImmediatePropagation()
    await interceptPaste(event.target as HTMLElement, text)
    return
  }

  if (safetyLevel.value === false && current.showWarningNotification)
    await showNotifications('input')
}

// Handle copy/cut events
async function handleCopyCut() {
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('copy')
}

// Register listeners immediately with capture: true to prevent blocking
/**
 * The other half of "something is being entered here".
 *
 * `keydown` is a keyboard event, and on a phone text does not have to come from
 * a keyboard. A word taken from the suggestion bar, an IME composition,
 * dictation and autofill can all put characters in a field with no key press
 * behind them – and the warning whose whole job is to catch a password going
 * into an unfamiliar site would never appear. `beforeinput` fires for all of
 * them, whatever produced the text.
 *
 * Both listeners stay. `keydown` still answers for the shortcuts above, and a
 * page is free to cancel `beforeinput` before it reaches anything. Whichever
 * arrives first wins: the warning shows at most once per page either way.
 */
async function handleBeforeInput(event: Event) {
  const kind = (event as InputEvent).inputType || ''

  // Taking text out is not putting any in, and neither is undo or redo
  if (kind.startsWith('delete') || kind === 'historyUndo' || kind === 'historyRedo')
    return

  // Paste has its own handler, which asks a better question than this one and
  // may still be waiting for the answer
  if (kind === 'insertFromPaste' || kind === 'insertFromPasteAsQuotation')
    return

  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('input')
}

window.addEventListener('keydown', handleKeydown, true)
window.addEventListener('beforeinput', handleBeforeInput, true)
window.addEventListener('paste', handlePaste, true)
window.addEventListener('copy', handleCopyCut, true)
window.addEventListener('cut', handleCopyCut, true)

// ==========================================
// Link Safety – tooltip and intercept logic
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

// Register callback so tooltip component can start grace timer on mouseleave
setOnTooltipHoverLeave(() => {
  if (tooltipGraceTimer)
    clearTimeout(tooltipGraceTimer)
  tooltipGraceTimer = setTimeout(() => {
    currentHoveredAnchor = null
    linkTooltipVisible.value = false
    linkTooltipData.value = null
  }, 300)
})

async function fetchLinkData(href: string, hostname: string) {
  // Check cache first
  const cached = getCachedVisitCount(hostname)
  if (cached)
    return cached

  // Fetch from background
  const response = await sendMessageSafe<VisitCountResponse>('get-visit-count', { url: href })
  if (!response)
    return { stats: { count: 0 }, isSafe: true, ignored: false }

  // Every fact travels on, not just the count: the check surfaces show the
  // evidence a verdict rests on, and only the background can read it
  const stats: FamiliarityStats = { count: response.count, activeDays: response.activeDays, firstSeen: response.firstSeen }
  const isSafe = isFamiliar(stats, normalizeFamiliarity(settings.value.familiarity))
  const data: VisitFacts = { stats, isSafe, ignored: response.ignored }
  setCachedVisitCount(hostname, data)
  return data
}

function getAnchorRect(anchor: HTMLAnchorElement) {
  const rect = anchor.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

// Show intercept dialog for a URL without an anchor element (used by right-click context menu)
async function showLinkInterceptByUrl(url: string) {
  const hostname = getHostnameFromHref(url)
  if (!hostname)
    return

  const currentHostname = window.location.hostname
  if (!isExternalLink(url, currentHostname))
    return

  const visitData = await fetchLinkData(url, hostname)
  const punycodeResult = getPunycodeInfo(hostname)

  // Handle shortened URLs
  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  const isKnownShortener = isShortenedUrl(hostname)
  const resolveAny = settings.value.linkSafety.shortUrlResolveAny
  const shouldResolve = shortUrlMode === 'auto' && (isKnownShortener || resolveAny)
  let shortUrlInfo: import('~/logic/ui-state').ShortUrlInfo | null = null

  if (shouldResolve) {
    try {
      const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url })
      if (result && result.status === 'resolved' && result.finalHostname && result.finalHostname !== hostname) {
        const resolvedVisitData = await fetchLinkData(`https://${result.finalHostname}`, result.finalHostname)
        shortUrlInfo = {
          originalUrl: url,
          resolvedUrl: result.finalUrl,
          resolvedDomain: result.finalHostname,
          resolvedStats: resolvedVisitData.stats,
          resolvedIsSafe: resolvedVisitData.isSafe,
          chain: result.chain,
          status: 'resolved',
          isKnownShortener,
        }
      }
    }
    catch {
      // Resolution failed – show intercept anyway
    }
  }
  else if (shortUrlMode === 'button' && (isKnownShortener || resolveAny)) {
    shortUrlInfo = {
      originalUrl: url,
      resolvedUrl: '',
      resolvedDomain: '',
      resolvedStats: { count: 0 },
      resolvedIsSafe: false,
      chain: [],
      status: 'idle',
      isKnownShortener,
    }
  }

  linkInterceptData.value = {
    domain: hostname,
    url,
    target: '_blank',
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    mismatch: null,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    shortUrl: shortUrlInfo,
  }
  linkInterceptVisible.value = true

  return new Promise<boolean>((resolve) => {
    linkInterceptResolve.value = resolve
  })
}

// Synthetic anchor rect in center-top of viewport for tooltips without an anchor element
function syntheticAnchorRect() {
  return {
    top: 70,
    bottom: 80,
    left: Math.max(8, (window.innerWidth - 320) / 2),
    right: Math.min(window.innerWidth - 8, (window.innerWidth + 320) / 2),
  }
}

// Show tooltip for a URL without an anchor element (used by context menu)
// `force` skips the external-link gate: the user explicitly asked to check this URL
async function showLinkTooltipByUrl(url: string, opts?: { force?: boolean }) {
  const hostname = getHostnameFromHref(url)
  if (!hostname)
    return

  const currentHostname = window.location.hostname
  if (!opts?.force && !isExternalLink(url, currentHostname))
    return

  const visitData = await fetchLinkData(url, hostname)
  const punycodeResult = getPunycodeInfo(hostname)

  const anchorRect = syntheticAnchorRect()

  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  const isKnownShortener = isShortenedUrl(hostname)
  const resolveAny = settings.value.linkSafety.shortUrlResolveAny
  const shouldShowShortUrl = shortUrlMode !== 'off' && (isKnownShortener || resolveAny)
  const shouldAutoResolve = shortUrlMode === 'auto' && shouldShowShortUrl

  linkTooltipData.value = {
    domain: hostname,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    mismatch: null, // No text to compare from context menu
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    shortUrl: shouldShowShortUrl
      ? { originalUrl: url, resolvedUrl: '', resolvedDomain: '', resolvedStats: { count: 0 }, resolvedIsSafe: false, chain: [], status: shouldAutoResolve ? 'loading' : 'idle', isKnownShortener }
      : null,
    anchorRect,
    href: url,
  }
  linkTooltipVisible.value = true

  if (shouldAutoResolve)
    resolveAndUpdateTooltip(url, hostname)
}

// Build tooltip data for an email address or full mailto: URL.
// anchorText (visible link text) is compared against the real target to catch
// the classic trick: text shows boss@company.com, mailto goes elsewhere.
async function buildEmailTooltipData(
  addrOrMailto: string,
  anchorText: string | null,
  anchorRect: { top: number, bottom: number, left: number, right: number },
): Promise<LinkTooltipData | null> {
  const isMailto = /^mailto:/i.test(addrOrMailto.trim())
  const parsed = isMailto ? parseMailtoUrl(addrOrMailto) : null
  const address = isMailto ? parsed?.addresses[0] : addrOrMailto
  if (!address)
    return null

  const analysis = analyzeEmailAddress(address)
  if (!analysis)
    return null

  const visitData = await fetchLinkData(`https://${analysis.domain}`, analysis.domain)

  let mismatch: { textAddress: string } | null = null
  if (anchorText) {
    const textEmail = extractEmailFromText(anchorText)
    if (textEmail) {
      if (textEmail.toLowerCase() !== analysis.raw.toLowerCase())
        mismatch = { textAddress: textEmail }
    }
    else {
      const textDomain = extractDomainFromText(anchorText)
      if (textDomain && textDomain.replace(/^www\./, '') !== analysis.domain)
        mismatch = { textAddress: textDomain }
    }
  }

  return {
    kind: 'email',
    domain: analysis.domain,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    mismatch: null,
    punycode: analysis.domainInfo.punycode,
    shortUrl: null,
    anchorRect,
    href: isMailto ? addrOrMailto : `mailto:${address}`,
    email: { analysis, params: parsed?.params ?? [], mismatch, providerKind: classifyEmailDomain(analysis.domain) },
  }
}

async function showEmailTooltip(anchor: HTMLAnchorElement) {
  const data = await buildEmailTooltipData(anchor.href, anchor.textContent, getAnchorRect(anchor))
  if (!data)
    return
  linkTooltipData.value = data
  linkTooltipVisible.value = true
}

async function showEmailTooltipByAddress(addrOrMailto: string) {
  const data = await buildEmailTooltipData(addrOrMailto, null, syntheticAnchorRect())
  if (!data)
    return
  linkTooltipData.value = data
  linkTooltipVisible.value = true
}

// Open the in-page check panel: full domain-family dashboard (like the popup)
// for a selection-checked domain, URL or email address
async function showCheckPanelForTarget(target: { kind: 'email' | 'url' | 'domain', value: string }) {
  let hostname: string
  let email: CheckPanelData['email'] = null

  if (target.kind === 'email') {
    const analysis = analyzeEmailAddress(target.value)
    if (!analysis)
      return
    hostname = analysis.domain
    email = { analysis, providerKind: classifyEmailDomain(analysis.domain) }
  }
  else {
    const url = target.kind === 'url' ? target.value : `https://${target.value}`
    const parsedHostname = getHostnameFromHref(url)
    if (!parsedHostname)
      return
    hostname = parsedHostname
  }

  const punycodeResult = getPunycodeInfo(hostname)
  let family: DomainFamilyInfo | null = null
  try {
    family = await sendMessageSafe<DomainFamilyInfo>('get-domain-family', { hostname })
  }
  catch {
    // background unreachable – show the panel without visit data
  }

  checkPanelData.value = {
    kind: email ? 'email' : 'domain',
    hostname,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    email,
    family: family || { baseDomain: hostname, entries: [], total: 0 },
  }
  checkPanelVisible.value = true
}

// Show a non-navigable payload (QR tel:/WIFI:/plain text) with unicode highlighting
function showRawPayloadTooltip(payload: string, payloadKind: RawPayloadInfo['payloadKind']) {
  linkTooltipData.value = {
    kind: 'text',
    domain: '',
    stats: { count: 0 },
    isSafe: true,
    mismatch: null,
    punycode: null,
    shortUrl: null,
    anchorRect: syntheticAnchorRect(),
    href: payload,
    rawText: { payload, payloadKind },
  }
  linkTooltipVisible.value = true
}

/**
 * Resolve a shortened URL and update the current tooltip data.
 * Called automatically (auto mode) or on button click (button mode).
 */
async function resolveAndUpdateTooltip(url: string, originalHostname: string) {
  // Set loading state
  if (linkTooltipData.value && linkTooltipData.value.href === url && linkTooltipData.value.shortUrl) {
    linkTooltipData.value = {
      ...linkTooltipData.value,
      shortUrl: { ...linkTooltipData.value.shortUrl, status: 'loading' },
    }
  }

  try {
    const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url })
    if (!linkTooltipData.value || linkTooltipData.value.href !== url)
      return // tooltip already dismissed or changed

    const isKnownShortener = linkTooltipData.value.shortUrl?.isKnownShortener ?? false

    // If final hostname is still the same as original – resolution failed to uncover real destination
    const didResolve = result && result.status === 'resolved' && result.finalHostname && result.finalHostname !== originalHostname

    if (didResolve) {
      const resolvedVisitData = await fetchLinkData(`https://${result.finalHostname}`, result.finalHostname)
      linkTooltipData.value = {
        ...linkTooltipData.value,
        shortUrl: {
          originalUrl: url,
          resolvedUrl: result.finalUrl,
          resolvedDomain: result.finalHostname,
          resolvedStats: resolvedVisitData.stats,
          resolvedIsSafe: resolvedVisitData.isSafe,
          chain: result.chain,
          status: 'resolved',
          isKnownShortener,
        },
      }
    }
    else {
      linkTooltipData.value = {
        ...linkTooltipData.value,
        shortUrl: {
          originalUrl: url,
          resolvedUrl: '',
          resolvedDomain: '',
          resolvedStats: { count: 0 },
          resolvedIsSafe: false,
          chain: result?.chain || [url],
          status: 'error',
          error: result?.error || 'same_domain',
          isKnownShortener,
        },
      }
    }
  }
  catch {
    if (linkTooltipData.value && linkTooltipData.value.href === url) {
      const isKnownShortener = linkTooltipData.value.shortUrl?.isKnownShortener ?? false
      linkTooltipData.value = {
        ...linkTooltipData.value,
        shortUrl: { originalUrl: url, resolvedUrl: '', resolvedDomain: '', resolvedStats: { count: 0 }, resolvedIsSafe: false, chain: [url], status: 'error', error: 'failed', isKnownShortener },
      }
    }
  }
}

// Expose resolve function for tooltip button click
;(window as any).__visilant_resolveTooltipUrl = () => {
  const data = linkTooltipData.value
  if (data?.shortUrl && (data.shortUrl.status === 'idle' || data.shortUrl.status === 'error')) {
    resolveAndUpdateTooltip(data.href, data.domain)
  }
}

// Expose function to resolve once without marking domain as shortener
;(window as any).__visilant_resolveOnce = () => {
  const data = linkTooltipData.value
  if (!data)
    return

  // Set shortUrl to loading state without persisting domain
  linkTooltipData.value = {
    ...data,
    shortUrl: {
      originalUrl: data.href,
      resolvedUrl: '',
      resolvedDomain: '',
      resolvedStats: { count: 0 },
      resolvedIsSafe: false,
      chain: [],
      status: 'loading',
      isKnownShortener: false,
    },
  }

  resolveAndUpdateTooltip(data.href, data.domain)
}

// Expose function to mark current tooltip domain as shortener
;(window as any).__visilant_markAsShortener = async () => {
  const data = linkTooltipData.value
  if (!data)
    return

  const domain = data.domain
  // Update content script's own runtime set so isShortenedUrl() works on this page
  addCustomShortener(domain)
  // Persist via background
  await sendMessageSafe('add-custom-shortener', { domain })

  // Immediately update tooltip to show resolve button
  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  if (shortUrlMode === 'off')
    return

  const shouldAutoResolve = shortUrlMode === 'auto'
  linkTooltipData.value = {
    ...data,
    shortUrl: {
      originalUrl: data.href,
      resolvedUrl: '',
      resolvedDomain: '',
      resolvedStats: { count: 0 },
      resolvedIsSafe: false,
      chain: [],
      status: shouldAutoResolve ? 'loading' : 'idle',
      isKnownShortener: true,
    },
  }

  if (shouldAutoResolve)
    resolveAndUpdateTooltip(data.href, domain)
}

// Core intercept resolve logic (shared by button click and resolve-once)
async function resolveAndUpdateIntercept() {
  const data = linkInterceptData.value
  if (!data?.shortUrl)
    return

  const url = data.url
  const isKnownShortener = data.shortUrl.isKnownShortener

  try {
    const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url })
    if (!linkInterceptData.value || linkInterceptData.value.url !== url)
      return

    const didResolve = result && result.status === 'resolved' && result.finalHostname && result.finalHostname !== data.domain

    if (didResolve) {
      const resolvedVisitData = await fetchLinkData(`https://${result.finalHostname}`, result.finalHostname)
      linkInterceptData.value = {
        ...linkInterceptData.value,
        shortUrl: {
          originalUrl: url,
          resolvedUrl: result.finalUrl,
          resolvedDomain: result.finalHostname,
          resolvedStats: resolvedVisitData.stats,
          resolvedIsSafe: resolvedVisitData.isSafe,
          chain: result.chain,
          status: 'resolved',
          isKnownShortener,
        },
      }
    }
    else {
      linkInterceptData.value = {
        ...linkInterceptData.value,
        shortUrl: {
          originalUrl: url,
          resolvedUrl: '',
          resolvedDomain: '',
          resolvedStats: { count: 0 },
          resolvedIsSafe: false,
          chain: result?.chain || [url],
          status: 'error',
          error: result?.error || 'same_domain',
          isKnownShortener,
        },
      }
    }
  }
  catch {
    if (linkInterceptData.value && linkInterceptData.value.url === url) {
      linkInterceptData.value = {
        ...linkInterceptData.value,
        shortUrl: {
          originalUrl: url,
          resolvedUrl: '',
          resolvedDomain: '',
          resolvedStats: { count: 0 },
          resolvedIsSafe: false,
          chain: [url],
          status: 'error',
          error: 'failed',
          isKnownShortener,
        },
      }
    }
  }
}

// Expose resolve function for intercept dialog button click
;(window as any).__visilant_resolveInterceptUrl = async () => {
  const data = linkInterceptData.value
  if (!data?.shortUrl || (data.shortUrl.status !== 'idle' && data.shortUrl.status !== 'error'))
    return

  // Set loading state
  linkInterceptData.value = {
    ...data,
    shortUrl: { ...data.shortUrl, status: 'loading' },
  }

  await resolveAndUpdateIntercept()
}

// Expose function to resolve once in intercept without marking domain as shortener
;(window as any).__visilant_resolveInterceptOnce = () => {
  const data = linkInterceptData.value
  if (!data)
    return

  linkInterceptData.value = {
    ...data,
    shortUrl: {
      originalUrl: data.url,
      resolvedUrl: '',
      resolvedDomain: '',
      resolvedStats: { count: 0 },
      resolvedIsSafe: false,
      chain: [],
      status: 'loading',
      isKnownShortener: false,
    },
  }

  resolveAndUpdateIntercept()
}

// Expose function to mark intercept domain as shortener
;(window as any).__visilant_markInterceptAsShortener = async () => {
  const data = linkInterceptData.value
  if (!data)
    return

  const domain = data.domain
  addCustomShortener(domain)
  await sendMessageSafe('add-custom-shortener', { domain })

  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  if (shortUrlMode === 'off')
    return

  const shouldAutoResolve = shortUrlMode === 'auto'
  linkInterceptData.value = {
    ...data,
    shortUrl: {
      originalUrl: data.url,
      resolvedUrl: '',
      resolvedDomain: '',
      resolvedStats: { count: 0 },
      resolvedIsSafe: false,
      chain: [],
      status: shouldAutoResolve ? 'loading' : 'idle',
      isKnownShortener: true,
    },
  }

  if (shouldAutoResolve)
    (window as any).__visilant_resolveInterceptUrl?.()
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
  let mismatch: { textDomain: string, textDomainStats: FamiliarityStats, textDomainIsSafe: boolean } | null = null
  if (mismatchResult.mismatch && mismatchResult.textDomain) {
    const textDomainData = await fetchLinkData(`https://${mismatchResult.textDomain}`, mismatchResult.textDomain)
    mismatch = { textDomain: mismatchResult.textDomain, textDomainStats: textDomainData.stats, textDomainIsSafe: textDomainData.isSafe }
  }

  // Check for punycode/unicode
  const punycodeResult = getPunycodeInfo(hostname)

  const anchorRect = getAnchorRect(anchor)

  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  const isKnownShortener = isShortenedUrl(hostname)
  const resolveAny = settings.value.linkSafety.shortUrlResolveAny
  const shouldShowShortUrl = shortUrlMode !== 'off' && (isKnownShortener || resolveAny)
  const shouldAutoResolve = shortUrlMode === 'auto' && shouldShowShortUrl

  linkTooltipData.value = {
    domain: hostname,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    mismatch,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    shortUrl: shouldShowShortUrl
      ? { originalUrl: href, resolvedUrl: '', resolvedDomain: '', resolvedStats: { count: 0 }, resolvedIsSafe: false, chain: [], status: shouldAutoResolve ? 'loading' : 'idle', isKnownShortener }
      : null,
    anchorRect,
    href,
  }
  linkTooltipVisible.value = true

  if (shouldAutoResolve)
    resolveAndUpdateTooltip(href, hostname)
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

  // Resolve shortened URL if auto mode is enabled
  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  const isKnownShortener = isShortenedUrl(hostname)
  const resolveAny = settings.value.linkSafety.shortUrlResolveAny
  const shouldResolve = shortUrlMode === 'auto' && (isKnownShortener || resolveAny)
  let shortUrlInfo: import('~/logic/ui-state').ShortUrlInfo | null = null

  if (shouldResolve) {
    try {
      const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url: href })
      if (result && result.status === 'resolved' && result.finalHostname && result.finalHostname !== hostname) {
        const resolvedVisitData = await fetchLinkData(`https://${result.finalHostname}`, result.finalHostname)
        shortUrlInfo = {
          originalUrl: href,
          resolvedUrl: result.finalUrl,
          resolvedDomain: result.finalHostname,
          resolvedStats: resolvedVisitData.stats,
          resolvedIsSafe: resolvedVisitData.isSafe,
          chain: result.chain,
          status: 'resolved',
          isKnownShortener,
        }
        // Use resolved domain's safety for intercept decision
        if (resolvedVisitData.isSafe) {
          navigateToUrl(href, target)
          return false
        }
      }
    }
    catch {
      // Resolution failed – show intercept as safe default
    }
  }
  else if (shortUrlMode === 'button' && (isKnownShortener || resolveAny)) {
    // Button mode: show idle state so user can resolve manually in the dialog
    shortUrlInfo = {
      originalUrl: href,
      resolvedUrl: '',
      resolvedDomain: '',
      resolvedStats: { count: 0 },
      resolvedIsSafe: false,
      chain: [],
      status: 'idle',
      isKnownShortener,
    }
  }

  // Safe site – allow navigation (only if we didn't auto-resolve, which was handled above)
  if (!shouldResolve && visitData.isSafe) {
    navigateToUrl(href, target)
    return false
  }

  // Check for mismatch and punycode
  const linkText = anchor.textContent || ''
  const mismatchResult = checkDomainMismatch(linkText, hostname)
  const punycodeResult = getPunycodeInfo(hostname)

  // Fetch textDomain visit data if mismatch
  let interceptMismatch: { textDomain: string, textDomainStats: FamiliarityStats, textDomainIsSafe: boolean } | null = null
  if (mismatchResult.mismatch && mismatchResult.textDomain) {
    const textDomainData = await fetchLinkData(`https://${mismatchResult.textDomain}`, mismatchResult.textDomain)
    interceptMismatch = { textDomain: mismatchResult.textDomain, textDomainStats: textDomainData.stats, textDomainIsSafe: textDomainData.isSafe }
  }

  linkInterceptData.value = {
    domain: hostname,
    url: href,
    target,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    mismatch: interceptMismatch,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    shortUrl: shortUrlInfo,
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

  // What the user picked, corrected for what this device can do: on a
  // touchscreen the hover and right-click triggers can never fire
  const trigger = resolveTooltipTrigger(linkSafety.tooltipTrigger, canUseContextMenus)
  // Read once alongside the trigger, so both come from the same settings snapshot
  const hoverDelay = Math.max(0, Number(linkSafety.hoverDelay ?? defaultSettings.linkSafety.hoverDelay))

  // Hover trigger: mouseenter/mouseleave via event delegation
  function handleMouseOver(event: MouseEvent) {
    if (trigger !== 'hover')
      return

    const anchor = findAnchorElement(event.target)
    if (!anchor || !anchor.href)
      return

    const mailto = isMailtoHref(anchor.href)
    if (!mailto && !isExternalLink(anchor.href, currentHostname))
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
      if (currentHoveredAnchor === anchor) {
        if (mailto)
          showEmailTooltip(anchor)
        else
          showLinkTooltip(anchor)
      }
    }, hoverDelay)
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

  // Click handler for left-click intercept trigger
  function handleClick(event: MouseEvent) {
    if (trigger !== 'click-left' || event.button !== 0)
      return

    const anchor = findAnchorElement(event.target)
    if (!anchor || !anchor.href)
      return

    // mailto: never goes through the intercept dialog – show the email tooltip
    // instead. Its "open mail app" button performs the actual navigation
    if (isMailtoHref(anchor.href)) {
      event.preventDefault()
      event.stopPropagation()
      showEmailTooltip(anchor)
      return
    }

    if (!isExternalLink(anchor.href, currentHostname))
      return

    event.preventDefault()
    event.stopPropagation()
    handleLinkIntercept(anchor, event.ctrlKey || event.metaKey)
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
let tamperWatch: TamperWatch | null = null
let stopUiVisibilityWatch: (() => void) | null = null
let isMounting = false
// Set while we take our own UI down, so our removal is not read as the page's.
// This has to be an explicit flag rather than "has the app mounted yet": a page
// that rips the container out in the moments before Vue finishes mounting is
// exactly the page worth catching.
let isSelfRemoving = false

async function mount(force = false) {
  if (isMounting || container)
    return

  isMounting = true
  try {
    // Check if current page is an internal page
    const hostname = window.location.hostname
    if (!force && isInternalPage(hostname)) {
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

    // Mount if: (warnings needed) OR (link safety enabled) OR explicitly requested
    // (message-triggered tooltips need the UI even on pages that skipped mounting)
    const needsWarningUI = isNotificationsEnabled && !isSiteSafe
    if (!force && !needsWarningUI && !isLinkSafetyEnabled) {
      return
    }

    container = document.createElement('div')
    container.id = generateSecureId()

    // Robust styles keeping the host on top and visible, set with 'important'
    // priority so page-level `div { ... !important }` rules cannot override it.
    // The same declarations are what the tamper watch checks against.
    applyHostStyles(container)

    const root = document.createElement('div')
    // `all: initial` below resets the font to the browser default, which is a
    // serif, so every component has to name its own or come out in Times. This
    // is the floor under all of them, set on the wrapper inside the shadow root
    // where no page rule can reach it – anything the stylesheet misses still
    // reads as the extension rather than as the page's book type.
    root.style.setProperty('font-family', 'Arial, Helvetica, sans-serif')

    const styleEl = document.createElement('style')
    const response = await fetch(browser.runtime.getURL('dist/contentScripts/style.css'))
    const cssText = await response.text()
    // `:host { all: initial }` stops inherited page styles (font, color,
    // letter-spacing, text-transform...) from leaking through the shadow
    // boundary. The inline host styles above still win for positioning.
    styleEl.textContent = `:host { all: initial; }\n${cssText}`

    const shadowDOM = container.attachShadow?.({ mode: __DEV__ ? 'open' : 'closed' }) || container
    shadowDOM.appendChild(styleEl)
    shadowDOM.appendChild(root)

    const tamperingEnabled = !isAntiTamperingExcluded(hostname)

    if (tamperingEnabled) {
      // Start watching BEFORE appending, so a page that rips the container out
      // the instant it appears is caught along with the patient ones
      tamperWatch = createTamperWatch({
        container,
        shadow: shadowDOM,
        guardedNodes: [root, styleEl],
        isSelfRemoving: () => isSelfRemoving,
        onTamper: (reason) => {
          sendMessageSafe('tampering-detected', { reason })
        },
      })
    }

    document.body.appendChild(container)

    if (tamperingEnabled) {
      // Immediate verification, in case the append itself was undone
      const problem = tamperWatch?.verify()
      if (problem)
        sendMessageSafe('tampering-detected', { reason: problem })
    }

    app = createApp(App)
    setupApp(app)
    app.mount(root)

    // The hit test for an element laid over our panel only makes sense while a
    // panel is on screen, and that is also the only time being covered matters
    if (tamperingEnabled) {
      stopUiVisibilityWatch = watchEffect(() => {
        const anythingShowing = showWarning.value
          || linkTooltipVisible.value
          || checkPanelVisible.value
          || linkInterceptVisible.value
          || pasteInterceptVisible.value
        tamperWatch?.setUiVisible(anythingShowing)
      })
    }

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
  // Follow the lists for as long as this tab lives. Registered before anything
  // can fail: a tab open at the time of an edit would otherwise keep classifying
  // by the lists it started with until it is reloaded.
  watchListStorage()

  // Initialize settings and check safety immediately
  await loadSettings()
  await checkSiteSafety(window.location.href)
  await mount()
})()

// The Vue app is only mounted when the page needs a warning or link safety is
// on, so message-triggered tooltips (context menu, QR) must force-mount it first
async function ensureTooltipUiMounted() {
  if (!container)
    await mount(true)
}

// Listen for context menu requests from background
browser.runtime.onMessage.addListener((message: any) => {
  // Keep this listener synchronous (returning a Promise here would hijack the
  // response channel of unrelated webext-bridge messages)
  if (message.type === 'show-link-tooltip-at-cursor' && message.data?.url) {
    ensureTooltipUiMounted().then(() => showLinkTooltipByUrl(message.data.url))
    return undefined
  }
  if (message.type === 'show-link-intercept' && message.data?.url) {
    ensureTooltipUiMounted().then(() => showLinkInterceptByUrl(message.data.url))
    return undefined
  }
  if (message.type === 'check-selection') {
    // Prefer the live page selection: immune to selectionText truncation
    const text = window.getSelection()?.toString() || message.data?.selectionText || ''
    ensureTooltipUiMounted().then(() => {
      const target = extractCheckTarget(text)
      if (target)
        showCheckPanelForTarget(target)
      else
        showRawPayloadTooltip(text.trim().slice(0, 300), 'text')
    })
    return undefined
  }
  if (message.type === 'show-qr-result' && message.data?.payload) {
    const payload: string = message.data.payload
    ensureTooltipUiMounted().then(() => {
      const { kind, value } = classifyPayload(payload)
      if (kind === 'url')
        showLinkTooltipByUrl(value, { force: true })
      else if (kind === 'email')
        showEmailTooltipByAddress(payload)
      else
        showRawPayloadTooltip(payload, kind)
    })
    return undefined
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

    // Clean up existing instance if any. The flag has to be raised before the
    // first teardown step and lowered after the last, or our own removal comes
    // back as a tampering report.
    isSelfRemoving = true
    if (stopUiVisibilityWatch) {
      stopUiVisibilityWatch()
      stopUiVisibilityWatch = null
    }
    if (tamperWatch) {
      tamperWatch.stop()
      tamperWatch = null
    }
    if (app) {
      app.unmount()
      app = null
    }
    if (container) {
      container.remove()
      container = null
    }
    isSelfRemoving = false

    // Re-mount
    await mount()
  }
})
