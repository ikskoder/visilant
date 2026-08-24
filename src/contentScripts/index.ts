import type { FamiliarityStats } from '~/logic/familiarity'
import type { VisitFacts } from '~/logic/link-safety'
import type { Settings } from '~/logic/storage'
import type { TamperWatch } from '~/logic/tamper-watch'
import type { CheckPanelData, DomainFamilyInfo, EmailRecipientInfo, LinkTooltipData, RawPayloadInfo } from '~/logic/ui-state'
import type { ResolvedUrlResult } from '~/logic/url-shorteners'
import { createApp, watch, watchEffect } from 'vue'
import { setupApp } from '~/logic/common-setup'
import { classifyEmailDomain, loadEmailListsFromStorage } from '~/logic/email-providers'
import { analyzeEmailAddress, collectMailtoRecipients, extractEmailFromText, MAX_MAILTO_RECIPIENTS, parseMailtoUrl } from '~/logic/email-safety'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { alternateSpelling, anchorLabel, checkDomainMismatch, clearVisitCache, extractDomainFromText, findAnchorFromEvent, getCachedVisitCount, getHostnameFromHref, isDomainInScope, isExternalLink, isMailtoHref, setCachedVisitCount } from '~/logic/link-safety'
import { watchListStorage } from '~/logic/list-sync'
import { describePastePayload, editableTargetOf, isEditableEventTarget, isPasteSink, shouldHoldPasteUndecided, shouldInterceptPaste } from '~/logic/paste-guard'
import { classifyQrPayload, extractCheckTarget } from '~/logic/payload-classify'
import { resolveTooltipTrigger } from '~/logic/platform'
import { applySettingsSnapshot, defaultSettings, makeSettingsReadOnly, parseStoredSettings, settings, settingsReady } from '~/logic/storage'
import { applyHostStyles, createTamperWatch } from '~/logic/tamper-watch'
import { checkPanelData, checkPanelVisible, hasNotifiedOnThisPage, isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, pasteAllowedOnThisPage, pasteInterceptData, pasteInterceptResolve, pasteInterceptVisible, safetyLevel, setOnTooltipHoverEnter, setOnTooltipHoverLeave, showWarning, warningFrameHost, warningType } from '~/logic/ui-state'
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

/**
 * How far this tab has got in working out where it is.
 *
 * `safetyLevel` alone could not say the difference between "not judged yet" and
 * "will never be judged": both read as `null`, and every guard below treated
 * that as nothing to warn about. A page that killed the bootstrap, or a
 * background that would not wake, therefore looked exactly like a page that had
 * just been checked and found familiar.
 */
type BootstrapState = 'initializing' | 'ready' | 'error'
let bootstrapState: BootstrapState = 'initializing'

/** Resolves once `safetyLevel` holds a verdict, or once it is known it never will. */
let verdictSettled: Promise<void> = Promise.resolve()

/**
 * A keystroke or a copy that happened before this page had been judged.
 *
 * Typing cannot be held the way a paste can, so the warning it deserves is owed
 * rather than lost: if the verdict turns out to be unfamiliar, it is raised as
 * soon as the page is mounted. Without this, everything typed in the first
 * moment of a page went unremarked and the warning only appeared if the user
 * happened to type again afterwards.
 */
let warningOwedFor: 'input' | 'copy' | null = null

function noteUndecidedActivity(type: 'input' | 'copy') {
  warningOwedFor ??= type
}

// Check if site is safe based on visit count
async function checkSiteSafety(url: string, settingsArrived?: Promise<void>): Promise<boolean> {
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

  // Both halves of the verdict are asked for together. Waiting for the settings
  // before even sending this doubled the window in which the page was loaded,
  // the user was typing, and nothing had been judged yet.
  const visits = sendMessageSafe<VisitCountResponse>('get-visit-count', { url })
  const [response] = await Promise.all([visits, settingsArrived ?? Promise.resolve()])
  if (!response) {
    safetyLevel.value = true
    return true // Default to safe if no response
  }

  const visitData = response

  // Assigned either way. Only ever set to true, it was a door that opened once:
  // Resume warnings in the popup cleared the flag on the record, told the page
  // its records had changed, and the page read the new answer and went on
  // believing the old one until it was reloaded.
  isIgnored.value = Boolean(visitData.ignored)

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

/**
 * Whether pastes are to be held, read straight from storage at document start.
 *
 * The listeners go up at `document_start` and the settings arrive later: they
 * are asked of the background, which may be asleep and take a moment to wake.
 * Until they land the ref holds the defaults, where the guard is off - so the
 * first paste on the page, which is exactly the paste this feature exists for,
 * was let through for somebody who had switched the guard on.
 *
 * One storage read in this document answers the one question that cannot wait.
 * The rest of the verdict still comes from the background, and `interceptPaste`
 * already knows how to hold a paste while it is on its way.
 */
let earlyGuardPaste: boolean | null = null
let settingsHydrated = false

void browser.storage.sync.get('settings')
  .then((stored) => {
    earlyGuardPaste = Boolean(parseStoredSettings(stored.settings)?.blockPasteOnUnfamiliar)
  })
  .catch(() => {
    // Nothing was read, so nothing is claimed. Off is what the setting ships as,
    // and holding a paste for a feature nobody asked for is the worse mistake.
    earlyGuardPaste = false
  })

/** The setting as it stands, from whichever source has it first. */
function pasteGuardOn(current: Settings): boolean {
  if (settingsHydrated)
    return Boolean(current.blockPasteOnUnfamiliar)
  return earlyGuardPaste ?? Boolean(current.blockPasteOnUnfamiliar)
}

/**
 * The settings, from the background if it answers and from storage if it does not.
 *
 * The background is asked first because it is the one context that has run the
 * migrations. When it cannot be reached the ref reads `storage.sync` itself,
 * which is the same value from the same place – so a background that will not
 * wake costs the migrations, not the settings.
 */
async function loadSettingsSnapshot(): Promise<void> {
  try {
    const settingsData = await sendMessageSafe<Settings>('get-settings', {})
    if (settingsData) {
      // Taken as a snapshot, not assigned: assigning would save it straight back
      applySettingsSnapshot(settingsData)
      settingsHydrated = true
      return
    }
  }
  catch (error) {
    console.error('Visilant: the background did not answer for the settings', error)
  }

  await settingsReady()
  if (!settings.value)
    applySettingsSnapshot(defaultSettings)
  settingsHydrated = true
}

/** The lists and the platform answer, none of which the verdict waits for. */
async function loadClassifiers(): Promise<void> {
  // Load user-defined and remotely fetched shortener domains
  await loadShortenersFromStorage()
  // Load public/disposable email-domain lists for address classification
  await loadEmailListsFromStorage()
  // Answered before the link-safety setup below reads it
  await loadPlatformCapabilities()
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
    if (safetyLevel.value === false && settings.value?.showWarningNotification)
      await showNotifications('copy')
    else if (safetyLevel.value === null)
      noteUndecidedActivity('copy')
    return
  }

  // Skip triggering warnings for any keys pressed with a modifier. Meta belongs
  // here as much as the other two: on macOS it is the menu key, so Cmd+F,
  // Cmd+L and Cmd+R were all reported as somebody typing into the page.
  if (event.ctrlKey || event.altKey || event.metaKey) {
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

  // The warning is about text going into a field. A site's own single-key
  // shortcuts – `j` and `k` to move down a list, `/` to open a search – are not
  // that, and warning about them turned the whole feature into noise.
  if (!isEditableEventTarget(event)) {
    return
  }

  // Trigger notification if conditions are met.
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('input')
  else if (safetyLevel.value === null)
    noteUndecidedActivity('input')
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
/**
 * How long a held paste waits for a verdict before giving up on getting one.
 *
 * The paste is already cancelled by then, so this is not a deadline on the
 * protection – it is the point at which the dialog stops saying "checking" and
 * starts saying it could not check.
 */
const PASTE_VERDICT_TIMEOUT_MS = 5000

async function interceptPaste(target: HTMLElement, text: string, undecided = false) {
  const hostname = window.location.hostname
  const punycode = alternateSpelling(hostname)
  const payload = describePastePayload(text)

  // One resolver, claimed before the dialog goes up. A second paste arriving
  // mid-dialog used to overwrite it, leaving the first one waiting forever on a
  // promise nobody could settle.
  let answered = false
  const answer = new Promise<boolean>((resolve) => {
    pasteInterceptResolve.value = (allowed: boolean) => {
      answered = true
      resolve(allowed)
    }
  })

  try {
    // Inside the try, and its answer is looked at. The paste was cancelled
    // before this function was called, so a mount that throws - or that comes
    // back with nothing in the page - used to end with the field empty, no
    // dialog, and nothing said about either.
    if (!await ensureTooltipUiMounted())
      throw new Error('the in-page dialog could not be mounted')

    if (undecided) {
      // The paste has already been stopped, so the wait has to be on screen. A
      // field that silently stays empty is the outcome this replaces.
      pasteInterceptData.value = { domain: hostname, stats: { count: 0 }, punycode, payload, status: 'checking' }
      pasteInterceptVisible.value = true

      await Promise.race([
        verdictSettled,
        answer,
        new Promise(resolve => setTimeout(resolve, PASTE_VERDICT_TIMEOUT_MS)),
      ])
    }

    if (!answered) {
      const visits = await sendMessageSafe<VisitCountResponse>('get-visit-count', { url: window.location.href })
        .catch(() => null)

      // Whatever the verdict turned out to be, the dialog says so rather than
      // vanishing: the text was not inserted either way and the user has to know
      const status = safetyLevel.value === false
        ? 'unfamiliar'
        : safetyLevel.value === true ? 'safe' : 'error'

      pasteInterceptData.value = {
        domain: hostname,
        stats: { count: visits?.count || 0, activeDays: visits?.activeDays, firstSeen: visits?.firstSeen },
        punycode,
        payload,
        status,
      }
      pasteInterceptVisible.value = true
    }

    const allowed = await answer
    if (allowed)
      pasteAllowedOnThisPage.value = true
  }
  catch (error) {
    // Nothing here may end with the dialog gone and the paste unexplained
    console.error('Visilant: the paste dialog failed', error)
    pasteInterceptVisible.value = false
  }
  finally {
    pasteInterceptResolve.value = null
    // Either way the user is done with the dialog and wants to be back in the field
    target.focus({ preventScroll: true })
  }
}

// Handle paste event
async function handlePaste(event: ClipboardEvent) {
  const current = settings.value || defaultSettings
  const guardOn = pasteGuardOn(current)
  const text = event.clipboardData?.getData('text/plain') || ''

  // A dialog is already up over an earlier paste. Cancelling this one keeps the
  // two from racing for the same resolver, and it is the safe half of the race:
  // the user is being asked about this very page.
  if (pasteInterceptVisible.value && guardOn) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }

  // The guard is on and this page has not been judged. Held rather than let
  // through: the whole point is the paste that happens seconds after the page
  // loaded, which is exactly when the verdict is still in flight.
  if (shouldHoldPasteUndecided({
    enabled: guardOn,
    verdictKnown: safetyLevel.value !== null && bootstrapState !== 'error',
    ignored: isIgnored.value,
    hasText: text.length > 0,
    targetIsEditable: isPasteSink(event),
    alreadyAllowed: pasteAllowedOnThisPage.value,
  })) {
    event.preventDefault()
    event.stopImmediatePropagation()
    await interceptPaste(editableTargetOf(event) ?? event.target as HTMLElement, text, true)
    return
  }

  if (shouldInterceptPaste({
    enabled: guardOn,
    siteIsSafe: safetyLevel.value,
    ignored: isIgnored.value,
    hasText: text.length > 0,
    targetIsEditable: isPasteSink(event),
    alreadyAllowed: pasteAllowedOnThisPage.value,
  })) {
    // Stopping propagation as well as the default is the point: a page with its
    // own paste handler reads the clipboard itself and inserts the text, so
    // cancelling only the default would be theatre rather than protection
    event.preventDefault()
    event.stopImmediatePropagation()
    await interceptPaste(editableTargetOf(event) ?? event.target as HTMLElement, text)
    return
  }

  if (safetyLevel.value === false && current.showWarningNotification)
    await showNotifications('input')
}

// Handle copy/cut events
async function handleCopyCut() {
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('copy')
  else if (safetyLevel.value === null)
    noteUndecidedActivity('copy')
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

  // `beforeinput` only fires on something editable, but a page can dispatch its
  // own, and the check costs a walk of a path that is already in hand
  if (!isEditableEventTarget(event))
    return

  // Taking text out is not putting any in, and neither is undo or redo
  if (kind.startsWith('delete') || kind === 'historyUndo' || kind === 'historyRedo')
    return

  // Paste has its own handler, which asks a better question than this one and
  // may still be waiting for the answer
  if (kind === 'insertFromPaste' || kind === 'insertFromPasteAsQuotation')
    return

  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('input')
  else if (safetyLevel.value === null)
    noteUndecidedActivity('input')
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

/**
 * Which tooltip request is the current one.
 *
 * Everything after the first `await` in the functions below used to belong to
 * whichever request finished last. A slow answer for link A could open a tooltip
 * after the pointer had left it, or land on top of link B carrying A's facts and
 * A's rectangle - the one shape of bug where a security tool says something
 * perfectly true about the wrong address.
 */
let tooltipRequest = 0

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
          resolvedPunycode: alternateSpelling(result.finalHostname),
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
    punycode: alternateSpelling(hostname),
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

  // Asked for by name rather than by hovering, so it takes the slot: a hover
  // still in flight must not land on top of what the user actually asked about
  const request = ++tooltipRequest

  const visitData = await fetchLinkData(url, hostname)
  if (request !== tooltipRequest)
    return

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
    punycode: alternateSpelling(hostname),
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

  // Everyone the message would reach, worked out before anything is headed with
  // one of them. It used to start from `addresses[0]`, the part before the
  // question mark, and `mailto:?bcc=attacker@evil.example` has nothing there –
  // so the one link that hides its recipient was the one that got no tooltip.
  const allRecipients = isMailto
    ? collectMailtoRecipients(parsed)
    : [{ field: 'to' as const, address: addrOrMailto }]
  const checked = allRecipients.slice(0, MAX_MAILTO_RECIPIENTS)
  const analysed = checked
    .map(recipient => ({ recipient, analysis: analyzeEmailAddress(recipient.address) }))
    .filter((entry): entry is { recipient: typeof checked[number], analysis: NonNullable<ReturnType<typeof analyzeEmailAddress>> } => entry.analysis !== null)

  // The first address that reads as one, whichever box it sits in
  const primary = analysed[0]
  if (!primary)
    return null

  const address = primary.recipient.address
  const analysis = primary.analysis

  const visitData = await fetchLinkData(`https://${analysis.domain}`, analysis.domain)

  // All at once, not one after another. Twenty-five round trips in a row, each
  // of which may have to wake a sleeping service worker, is seconds of a tooltip
  // that is supposed to appear while the pointer is still on the link.
  const facts = await Promise.all(
    analysed.map(entry => fetchLinkData(`https://${entry.analysis.domain}`, entry.analysis.domain)),
  )

  const recipients: EmailRecipientInfo[] = analysed.map((entry, index) => ({
    field: entry.recipient.field,
    analysis: entry.analysis,
    providerKind: classifyEmailDomain(entry.analysis.domain),
    stats: facts[index].stats,
    isSafe: facts[index].isSafe,
  }))

  let mismatch: { textAddress: string } | null = null
  if (anchorText) {
    const textEmail = extractEmailFromText(anchorText)
    if (textEmail) {
      // Held against every recipient, not just the first: a link whose text
      // names the second address of three is still telling the truth about it,
      // and one that names nobody on the list is the case worth flagging
      const named = recipients.some(r => r.analysis.raw.toLowerCase() === textEmail.toLowerCase())
      if (!named)
        mismatch = { textAddress: textEmail }
    }
    else {
      const textDomain = extractDomainFromText(anchorText)
      const bare = textDomain?.replace(/^www\./, '')
      if (bare && !recipients.some(r => r.analysis.domain === bare))
        mismatch = { textAddress: textDomain! }
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
    email: {
      analysis,
      params: parsed?.params ?? [],
      mismatch,
      providerKind: classifyEmailDomain(analysis.domain),
      recipients,
      recipientsNotChecked: allRecipients.length - checked.length,
    },
  }
}

async function showEmailTooltip(anchor: HTMLAnchorElement) {
  const request = ++tooltipRequest
  const data = await buildEmailTooltipData(anchor.href, anchorLabel(anchor), getAnchorRect(anchor))

  // The pointer has moved on, or something else claimed the tooltip while the
  // recipients were being looked up
  if (!data || request !== tooltipRequest || currentHoveredAnchor !== anchor || !anchor.isConnected)
    return

  // Measured now rather than before the lookup: the page may have scrolled
  data.anchorRect = getAnchorRect(anchor)
  linkTooltipData.value = data
  linkTooltipVisible.value = true
}

async function showEmailTooltipByAddress(addrOrMailto: string) {
  const request = ++tooltipRequest
  const data = await buildEmailTooltipData(addrOrMailto, null, syntheticAnchorRect())
  if (!data || request !== tooltipRequest)
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
    punycode: alternateSpelling(hostname),
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
async function resolveAndUpdateTooltip(url: string, originalHostname: string, retry = false) {
  // Set loading state
  if (linkTooltipData.value && linkTooltipData.value.href === url && linkTooltipData.value.shortUrl) {
    linkTooltipData.value = {
      ...linkTooltipData.value,
      shortUrl: { ...linkTooltipData.value.shortUrl, status: 'loading' },
    }
  }

  try {
    const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url, retry })
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
          resolvedPunycode: alternateSpelling(result.finalHostname),
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
    // Pressing it after an error is a retry, and a retry has to reach past
    // whatever the last attempt left behind
    resolveAndUpdateTooltip(data.href, data.domain, data.shortUrl.status === 'error')
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
async function resolveAndUpdateIntercept(retry = false) {
  const data = linkInterceptData.value
  if (!data?.shortUrl)
    return

  const url = data.url
  const isKnownShortener = data.shortUrl.isKnownShortener

  try {
    const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url, retry })
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
          resolvedPunycode: alternateSpelling(result.finalHostname),
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

  // Pressed after an error, this is a retry, and a retry has to reach past
  // whatever the last attempt left behind
  const retry = data.shortUrl.status === 'error'

  // Set loading state
  linkInterceptData.value = {
    ...data,
    shortUrl: { ...data.shortUrl, status: 'loading' },
  }

  await resolveAndUpdateIntercept(retry)
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

  const request = ++tooltipRequest
  /** Still the link this was asked about, and still on the page? */
  const stillCurrent = () => request === tooltipRequest
    && currentHoveredAnchor === anchor
    && anchor.isConnected

  const visitData = await fetchLinkData(href, hostname)
  if (!stillCurrent())
    return

  // Check for domain mismatch (link text vs href)
  const linkText = anchorLabel(anchor)
  const mismatchResult = checkDomainMismatch(linkText, hostname)

  // Fetch textDomain visit data if mismatch
  let mismatch: { textDomain: string, textDomainStats: FamiliarityStats, textDomainIsSafe: boolean } | null = null
  if (mismatchResult.mismatch && mismatchResult.textDomain) {
    const textDomainData = await fetchLinkData(`https://${mismatchResult.textDomain}`, mismatchResult.textDomain)
    if (!stillCurrent())
      return
    mismatch = { textDomain: mismatchResult.textDomain, textDomainStats: textDomainData.stats, textDomainIsSafe: textDomainData.isSafe }
  }

  // Measured here, immediately before the tooltip is placed. Taken before the
  // awaits above, this would be where the link was when the pointer arrived
  // rather than where it is now, and a page that scrolled in between put the
  // tooltip somewhere the link no longer is.
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
    punycode: alternateSpelling(hostname),
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

/**
 * The click we are putting back, so our own handler lets it through.
 *
 * Set for the length of one synchronous dispatch and cleared immediately after.
 */
let replayingClick: HTMLAnchorElement | null = null

/**
 * Send the user where the link said, as much like a real click as possible.
 *
 * The old way was `location.href = url`, which is not what a link does. It threw
 * away the named target, `download`, `rel`, `referrerpolicy` and `ping`, turned
 * every link into a full page load - so a single-page app reloaded itself
 * instead of routing - and skipped the page's own click handler entirely.
 *
 * A click dispatched on the anchor keeps all of that: the browser follows the
 * element with its attributes, and the page's handlers run. The one thing that
 * cannot be put back is a modifier: a browser only honours ctrl and shift on an
 * event it produced itself, so a middle or ctrl click is opened by hand and
 * loses the rest.
 */
function followLink(anchor: HTMLAnchorElement, openInNewTab: boolean, confirmed?: string) {
  // The address that was on screen when the user said yes, checked again right
  // before the browser is sent anywhere. A dialog stays open for as long as it
  // takes somebody to read it, and the page owns the anchor the whole time: it
  // can point the same element somewhere else, and a click dispatched afterwards
  // follows the element as it stands rather than the link that was approved.
  // The same goes for an element the page has since taken out of the document,
  // where dispatching a click does nothing at all and the link dies silently.
  if (confirmed !== undefined && (anchor.href !== confirmed || !anchor.isConnected)) {
    // Not the link that was agreed to any more, so it is not the one asked to do
    // the navigating. The address the user actually read is opened directly.
    if (openInNewTab)
      window.open(confirmed, '_blank', 'noopener,noreferrer')
    else
      window.location.href = confirmed
    return
  }

  if (openInNewTab) {
    const rel = anchor.rel?.toLowerCase() ?? ''
    const features = rel.includes('noreferrer') ? 'noopener,noreferrer' : 'noopener'
    window.open(anchor.href, '_blank', features)
    return
  }

  replayingClick = anchor
  try {
    anchor.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    }))
  }
  finally {
    replayingClick = null
  }
}

async function handleLinkIntercept(anchor: HTMLAnchorElement, openInNewTab: boolean): Promise<boolean> {
  const href = anchor.href
  const target = openInNewTab ? '_blank' : (anchor.target || '_self')
  const hostname = getHostnameFromHref(href)
  if (!hostname) {
    followLink(anchor, openInNewTab)
    return false
  }

  const currentHostname = window.location.hostname
  if (!isExternalLink(href, currentHostname)) {
    followLink(anchor, openInNewTab)
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
          resolvedPunycode: alternateSpelling(result.finalHostname),
          resolvedIsSafe: resolvedVisitData.isSafe,
          chain: result.chain,
          status: 'resolved',
          isKnownShortener,
        }
        // Use resolved domain's safety for intercept decision
        if (resolvedVisitData.isSafe) {
          followLink(anchor, openInNewTab, href)
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
    followLink(anchor, openInNewTab, href)
    return false
  }

  // Check for mismatch and punycode
  const linkText = anchorLabel(anchor)
  const mismatchResult = checkDomainMismatch(linkText, hostname)

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
    punycode: alternateSpelling(hostname),
    shortUrl: shortUrlInfo,
    // There is a real link behind this one, and it is put back as a click
    ownNavigation: false,
  }
  linkInterceptVisible.value = true

  const proceed = await new Promise<boolean>((resolve) => {
    linkInterceptResolve.value = resolve
  })

  if (proceed)
    followLink(anchor, openInNewTab, href)

  return proceed
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

    const anchor = findAnchorFromEvent(event)
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

    const anchor = findAnchorFromEvent(event)
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

    const anchor = findAnchorFromEvent(event)
    if (!anchor || !anchor.href)
      return

    // The click we are putting back after checking it. Letting it through is the
    // whole point - the browser and the page get to handle it as they would have.
    if (replayingClick === anchor)
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

    // Already known to be a site the user knows, and nothing to resolve. Not
    // cancelled at all, so the link behaves exactly like a link: the page's own
    // router runs, `download` downloads, and a modified click does what the
    // browser does with one.
    const hostname = getHostnameFromHref(anchor.href)
    const known = hostname ? getCachedVisitCount(hostname) : null
    const shortUrl = settings.value.linkSafety.shortUrlMode
    const mightBeShort = shortUrl === 'auto'
      && (settings.value.linkSafety.shortUrlResolveAny || (hostname ? isShortenedUrl(hostname) : false))
    if (known?.isSafe && !mightBeShort)
      return

    event.preventDefault()
    event.stopPropagation()

    // Cancelled, so this must end in a navigation or a dialog. Failing silently
    // leaves a link that does nothing at all when it is clicked.
    // Captured before the check runs, for the same reason the dialog captures
    // it: this ends in a navigation either way, and it has to be the one that
    // was read off the page rather than whatever the anchor says by then
    const intended = anchor.href
    handleLinkIntercept(anchor, event.ctrlKey || event.metaKey).catch((error) => {
      console.error('Visilant: could not check this link', error)
      followLink(anchor, event.ctrlKey || event.metaKey, intended)
    })
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
// Kept so the tamper watch can be started or stopped after the fact, when the
// exclusion list changes in a tab that is already open
let shadowRoot: ShadowRoot | HTMLElement | null = null
let guardedNodes: Element[] = []
let tamperWatch: TamperWatch | null = null
let stopUiVisibilityWatch: (() => void) | null = null
let isMounting = false

/** How long a document has to produce a body before this gives up on it. */
const MOUNT_BODY_TIMEOUT_MS = 10_000
const MOUNT_BODY_POLL_MS = 50
// Set while we take our own UI down, so our removal is not read as the page's.
// This has to be an explicit flag rather than "has the app mounted yet": a page
// that rips the container out in the moments before Vue finishes mounting is
// exactly the page worth catching.
let isSelfRemoving = false

/**
 * Start the tamper watch on the UI that is already there.
 *
 * Its own function rather than part of the mount, so taking a site out of the
 * exclusion list reaches a tab that is already open. Before, the decision was
 * made once at mount and the tab kept it until it was reloaded.
 */
function startTamperWatch() {
  if (tamperWatch || !container || !shadowRoot)
    return

  tamperWatch = createTamperWatch({
    container,
    shadow: shadowRoot,
    guardedNodes,
    isSelfRemoving: () => isSelfRemoving,
    onTamper: (reason) => {
      sendMessageSafe('tampering-detected', { reason, url: window.location.href })
    },
  })
}

/** Follow the exclusion list, in this tab, now rather than after a reload. */
function applyTamperingSetting() {
  const excluded = isAntiTamperingExcluded(window.location.hostname)

  if (excluded && tamperWatch) {
    tamperWatch.stop()
    tamperWatch = null
    if (stopUiVisibilityWatch) {
      stopUiVisibilityWatch()
      stopUiVisibilityWatch = null
    }
    return
  }

  if (!excluded && !tamperWatch && container) {
    startTamperWatch()
    stopUiVisibilityWatch ??= watchEffect(() => {
      const anythingShowing = showWarning.value
        || linkTooltipVisible.value
        || checkPanelVisible.value
        || linkInterceptVisible.value
        || pasteInterceptVisible.value
      tamperWatch?.setUiVisible(anythingShowing)
    })
  }
}

/**
 * Take a settings change into use without waiting for a reload.
 *
 * Every one of these used to be read once, at document start, and kept for the
 * life of the tab: the trigger, the scope, the hover delay, the exclusion list
 * and the familiarity rules the verdict was reached under. Turning the link
 * check off left it intercepting clicks until the page was reloaded, and raising
 * a threshold left the page and every cached tooltip on the old verdict while
 * the settings page next door already showed the new one.
 */
async function applySettingsChange() {
  // Every entry in it is a verdict reached under the rules as they were
  clearVisitCache()

  verdictSettled = checkSiteSafety(window.location.href)
    .then(() => {
      bootstrapState = 'ready'
    })
    .catch(() => {
      bootstrapState = 'error'
    })
  await verdictSettled

  // Anything on screen was drawn under the old rules too
  if (linkTooltipVisible.value) {
    linkTooltipVisible.value = false
    linkTooltipData.value = null
  }

  if (container) {
    linkSafetyCleanup?.()
    linkSafetyCleanup = null
    setupLinkSafety()
    applyTamperingSetting()
  }

  // A page that skipped mounting may need the UI now – a warning that was off
  // when this page loaded, or a link check that has just been switched on
  await mount()
}

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

    // Wait for body to be available. Bounded, because a document that never
    // gets one - an XML or SVG file opened directly - would otherwise spin for
    // as long as the tab is open.
    for (let waited = 0; !document.body && waited < MOUNT_BODY_TIMEOUT_MS; waited += MOUNT_BODY_POLL_MS)
      await new Promise(resolve => setTimeout(resolve, MOUNT_BODY_POLL_MS))

    if (!document.body)
      return

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
    shadowRoot = shadowDOM
    guardedNodes = [root, styleEl]

    const tamperingEnabled = !isAntiTamperingExcluded(hostname)

    if (tamperingEnabled) {
      // Start watching BEFORE appending, so a page that rips the container out
      // the instant it appears is caught along with the patient ones
      startTamperWatch()
    }

    document.body.appendChild(container)

    if (tamperingEnabled) {
      // Immediate verification, in case the append itself was undone
      const problem = tamperWatch?.verify()
      if (problem)
        sendMessageSafe('tampering-detected', { reason: problem, url: window.location.href })
    }

    app = createApp(App)
    setupApp(app)
    app.mount(root)

    // The hit test for an element laid over our panel only makes sense while a
    // panel is on screen, and that is also the only time being covered matters
    if (tamperingEnabled) {
      stopUiVisibilityWatch ??= watchEffect(() => {
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

    // Put back whatever got as far as being assigned. Without this a failure
    // after the container was created left it set, and the guard at the top of
    // this function turned every later attempt into an immediate return - so
    // the tab had no UI and no way to get one.
    isSelfRemoving = true
    try {
      stopUiVisibilityWatch?.()
      tamperWatch?.stop()
      app?.unmount()
      container?.remove()
    }
    catch {
      // Nothing here may throw on top of the error being handled
    }
    stopUiVisibilityWatch = null
    tamperWatch = null
    app = null
    container = null
    shadowRoot = null
    guardedNodes = []
    isSelfRemoving = false
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

  // The verdict first, and its two inputs together. Everything else on this page
  // waits for it, and the guards above have no honest answer until it lands.
  const settingsArrived = loadSettingsSnapshot()

  verdictSettled = checkSiteSafety(window.location.href, settingsArrived)
    .then(() => {
      bootstrapState = 'ready'
    })
    .catch((error) => {
      // Said out loud and recorded. This used to leave the whole bootstrap
      // half-done with no catch at all, so the page stayed unjudged until it was
      // reloaded and every guard read that silence as "nothing to warn about".
      console.error('Visilant: could not check this site', error)
      bootstrapState = 'error'
    })

  await verdictSettled

  // The lists and the platform answer. A failure here costs a classifier, not
  // the verdict, so it is caught on its own rather than taking the mount with it.
  try {
    await loadClassifiers()
  }
  catch (error) {
    console.error('Visilant: could not load the domain lists', error)
  }

  await mount()

  // Anything typed or copied while this page was still being judged. Raised now
  // rather than never, since the answer has arrived and it is the bad one.
  if (warningOwedFor && safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications(warningOwedFor)

  // Follow the settings for as long as this tab lives. The ref reads
  // `storage.sync` itself, so this works whether the change came from the
  // settings page, the popup or another device – and whether or not the
  // background happens to be awake to tell us about it.
  watch(
    () => JSON.stringify({
      linkSafety: settings.value?.linkSafety,
      familiarity: settings.value?.familiarity,
      antiTampering: settings.value?.antiTamperingExcludedDomains,
      warnings: [
        settings.value?.showWarningNotification,
        settings.value?.showInputWarning,
        settings.value?.showCopyWarning,
        settings.value?.blockPasteOnUnfamiliar,
      ],
    }),
    () => {
      void applySettingsChange()
    },
  )
})()

// The Vue app is only mounted when the page needs a warning or link safety is
// on, so message-triggered tooltips (context menu, QR) must force-mount it first
async function ensureTooltipUiMounted(): Promise<boolean> {
  if (!container)
    await mount(true)
  // Answered rather than assumed. A mount that fails and a mount that returns
  // with nothing in the page look the same to a caller that only awaits it, and
  // one of the callers has already cancelled a paste by the time it asks.
  return Boolean(container)
}

/**
 * Show a warning an iframe on this page raised.
 *
 * The frame has no UI of its own – a dialog inside a payment widget would be
 * clipped to the widget – so it hands the fact over and this document draws it.
 * The name shown is the frame's, because that is the site the box belongs to and
 * the one the address bar does not mention.
 */
async function showFrameWarning(kind: 'input' | 'copy', frameHost: string) {
  if (hasNotifiedOnThisPage.value || isIgnored.value)
    return
  if (kind === 'input' && !settings.value.showInputWarning)
    return
  if (kind === 'copy' && !settings.value.showCopyWarning)
    return

  await ensureTooltipUiMounted()
  warningType.value = kind
  warningFrameHost.value = frameHost
  hasNotifiedOnThisPage.value = true
  showWarning.value = true
}

/**
 * Hold a paste an iframe caught, and answer it.
 *
 * Same dialog as a paste into this document, drawn about the frame's own site.
 * The answer travels back so the frame knows whether to stop asking.
 */
async function showFramePasteIntercept(data: { hostname: string, status: 'unfamiliar' | 'settled' }): Promise<{ allowed: boolean }> {
  // The frame is holding a cancelled paste and is waiting on this answer. With
  // no dialog to answer from, saying no now is what stops it waiting.
  if (!await ensureTooltipUiMounted())
    return { allowed: false }

  const facts = await fetchLinkData(`https://${data.hostname}`, data.hostname).catch(() => null)

  // A second dialog over the first would leave the first paste unanswered
  if (pasteInterceptVisible.value)
    return { allowed: false }

  const answer = new Promise<boolean>((resolve) => {
    pasteInterceptResolve.value = resolve
  })

  pasteInterceptData.value = {
    domain: data.hostname,
    stats: facts?.stats ?? { count: 0 },
    punycode: alternateSpelling(data.hostname),
    // The payload stays in the frame. Only its shape would be worth showing and
    // sending the text across for that is not worth what it is.
    payload: describePastePayload(''),
    status: data.status === 'unfamiliar' ? 'unfamiliar' : 'safe',
    inFrame: true,
  }
  pasteInterceptVisible.value = true

  const allowed = await answer
  pasteInterceptResolve.value = null
  return { allowed }
}

// Listen for context menu requests from background
browser.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response?: any) => void) => {
  // Raised by an iframe on this page, which has no UI of its own
  if (message.type === 'frame-warning' && message.data?.hostname) {
    void showFrameWarning(message.data.kind === 'copy' ? 'copy' : 'input', message.data.hostname)
    return undefined
  }
  if (message.type === 'frame-paste-intercept' && message.data?.hostname) {
    // The only message here that answers. The frame is holding a cancelled paste
    // and cannot stop holding it until the user has said something.
    showFramePasteIntercept(message.data).then(sendResponse, () => sendResponse({ allowed: false }))
    return true
  }

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
  // The records this tab's verdict was drawn from have changed – a history
  // import finished, or the user wiped the visits. Both make everything this
  // page believes about itself wrong, including the tooltips already cached.
  if (message.type === 'visit-data-changed') {
    clearVisitCache()
    verdictSettled = checkSiteSafety(window.location.href)
      .then(() => {
        bootstrapState = 'ready'
      })
      .catch(() => {
        bootstrapState = 'error'
      })
    return undefined
  }
  if (message.type === 'show-qr-result' && message.data?.payload) {
    const payload: string = message.data.payload
    ensureTooltipUiMounted().then(() => {
      // The same reading the check page gives it – see `classifyQrPayload`
      const { kind, value } = classifyQrPayload(payload)
      if (kind === 'url')
        showLinkTooltipByUrl(value, { force: true })
      else if (kind === 'email')
        showEmailTooltipByAddress(value)
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
