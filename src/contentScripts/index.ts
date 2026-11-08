import type { FamiliarityStats } from '~/logic/familiarity'
import type { InterceptReason, LinkFacts } from '~/logic/intercept'
import type { LinkElement } from '~/logic/link-element'
import type { ContextLinkSnapshot, VisitFacts } from '~/logic/link-safety'
import type { Settings } from '~/logic/storage'
import type { TamperWatch } from '~/logic/tamper-watch'
import type { CheckPanelData, DomainFamilyInfo, EmailRecipientInfo, LinkMismatch, LinkTooltipData, RawPayloadInfo, ShortUrlInfo } from '~/logic/ui-state'
import type { ResolvedUrlResult } from '~/logic/url-shorteners'
import { createApp, watch, watchEffect } from 'vue'
import { lookalikeAnswer } from '~/composables/useLookalikes'
import { raiseTopLayer } from '~/composables/useTopLayer'
import { listenForScriptedClipboardWrites } from '~/logic/clipboard-signal'
import { setupApp } from '~/logic/common-setup'
import { classifyEmailDomain, loadEmailListsFromStorage } from '~/logic/email-providers'
import { analyzeEmailAddress, collectMailtoRecipients, extractEmailFromText, MAX_MAILTO_RECIPIENTS, parseMailtoUrl } from '~/logic/email-safety'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { interceptReasons, interceptsAnything } from '~/logic/intercept'
import { anchorLabel, anchorLabels, findAnchorFromEvent, linkHref, linkRect, linkRel, linkTarget } from '~/logic/link-element'
import { alternateSpelling, checkAnchorMismatch, checkDomainMismatch, checkLabelsMismatch, clearVisitCache, contextLinkTextDomain, extractDomainFromText, getCachedVisitCount, getHostnameFromHref, isDomainInScope, isExternalLink, isFileLikeName, isMailtoHref, namesASite, setCachedVisitCount, snapshotContextLink } from '~/logic/link-safety'
import { watchListStorage } from '~/logic/list-sync'
import { isMessageError } from '~/logic/message-error'
import { describePastePayload, editableTargetOf, isEditableEventTarget, isPasteSink, shouldHoldPasteUndecided, shouldInterceptPaste } from '~/logic/paste-guard'
import { classifyQrPayload, extractCheckTarget } from '~/logic/payload-classify'
import { resolveTooltipTrigger } from '~/logic/platform'
import { addressRedFlagCount } from '~/logic/red-flags'
import { applySettingsSnapshot, defaultSettings, makeSettingsReadOnly, normalizeLinkSafety, parseStoredSettings, settings, settingsReady } from '~/logic/storage'
import { applyHostStyles, createTamperWatch } from '~/logic/tamper-watch'
import { checkPanelData, checkPanelVisible, isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, notifiedOnThisPage, pasteAllowedOnThisPage, pasteInterceptData, pasteInterceptResolve, pasteInterceptVisible, safetyLevel, setOnTooltipHoverEnter, setOnTooltipHoverLeave, showWarning, warningType } from '~/logic/ui-state'
import { addCustomShortener, isOwnServiceShortLink, isShortenedUrl, loadShortenersFromStorage } from '~/logic/url-shorteners'
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
  listed?: boolean
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
  const answer = await browser.runtime.sendMessage({ type: id, data })
  // A handler that failed answers with a reason rather than with nothing, and
  // the reason is raised here so no caller can read it as data
  if (isMessageError(answer))
    throw new Error(answer.error)
  return answer as T
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
const warningsOwed = new Set<'input' | 'copy'>()

function noteUndecidedActivity(type: 'input' | 'copy') {
  warningsOwed.add(type)
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
  const visits = sendMessageSafe<VisitCountResponse>('get-visit-count', { url }).catch(() => null)
  const [response] = await Promise.all([visits, settingsArrived ?? Promise.resolve()])
  if (!response) {
    // Nothing came back, so nothing is known. This used to record the page as
    // safe, which is the one answer it certainly could not give: a background
    // that fails to answer is exactly the case the guards exist for. Left
    // undecided, the paste guard holds and asks, and no warning is raised about
    // a page nobody has judged.
    safetyLevel.value = null
    return false
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
    // Left as no, which resolves a right-click trigger to hovering
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
/**
 * What became of a request for a warning. `later` means it was turned away for
 * now and should be asked for again, which a frame needs to know: it stops
 * sending a kind once the top document has settled it.
 */
type WarningOutcome = 'shown' | 'refused' | 'later'

async function showNotifications(type: 'input' | 'copy'): Promise<WarningOutcome> {
  // Ensure settings are initialized
  if (!settings.value)
    applySettingsSnapshot(defaultSettings)

  // Check if this site is ignored
  if (isIgnored.value) {
    return 'refused'
  }

  // Confirming a paste answers the same question this warning asks, so asking it
  // again straight afterwards is the noise the confirmation was meant to end
  if (pasteAllowedOnThisPage.value) {
    return 'refused'
  }

  // One warning of each kind per page
  if (notifiedOnThisPage.value[type]) {
    return 'refused'
  }

  // Check if the specific warning type is enabled
  if (type === 'input' && !settings.value.showInputWarning) {
    return 'refused'
  }

  if (type === 'copy' && !settings.value.showCopyWarning) {
    return 'refused'
  }

  // One panel for two messages. A typing warning never takes the place of a
  // copy warning still on screen: it would rewrite the text while somebody reads
  // it, on exactly the page where it matters, and the next key after this one is
  // closed raises it anyway. Its turn is not used up by being turned away.
  if (type === 'input' && showWarning.value && warningType.value === 'copy')
    return 'later'

  // Set the warning type
  warningType.value = type

  // Claimed here rather than at the end: a keystroke and the `beforeinput` it
  // produces arrive in the same tick, and both would clear the check above
  // before either had finished awaiting its way to setting the flag.
  notifiedOnThisPage.value = { ...notifiedOnThisPage.value, [type]: true }

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
  return 'shown'
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

/**
 * Every listener this script keeps on the window, in the order it was added.
 *
 * Kept so they can be put back. `document.open()` erases every listener on the
 * window and on the document, a content script's as much as the page's, and
 * before this the tab simply went quiet: no typing warning, no paste guard, no
 * copy warning until it was reloaded. See `watchForDocumentOpen`.
 */
const pageListeners: [string, EventListener, AddEventListenerOptions][] = []

/**
 * Listen on the window in the capture phase, ahead of the page, and remember it.
 * The options are kept with it, so a passive listener comes back passive.
 */
function onPage<E extends Event>(type: string, listener: (event: E) => unknown, options: AddEventListenerOptions = {}) {
  const registered = listener as unknown as EventListener
  const kept = { ...options, capture: true }
  pageListeners.push([type, registered, kept])
  window.addEventListener(type, registered, kept)
}

/**
 * Only what the browser raised.
 *
 * A page can dispatch a `keydown`, a `paste` or a `copy` of its own, which
 * types nothing, pastes nothing and copies nothing. Each one still used to spend
 * the warning the real one was owed, so a page could fire one at load and type
 * its way past the warning about the password. Not for `click`: an untrusted
 * click on a link still opens it.
 */
function trusted<E extends Event>(handler: (event: E) => unknown) {
  return (event: E) => {
    if (event.isTrusted)
      return handler(event)
  }
}

/**
 * A visit is counted once a person does something on the page.
 *
 * A finished load proves nothing about a person: a site reloading itself in a
 * background tab used to collect a visit every minute, and visits are the one
 * check that can be passed in a day. So the first pointer, touch, key or wheel
 * the browser raises on this document is what reports it, once. A reload counts
 * only as the first visit of its day, see `applyReport`.
 *
 * What this costs: a page read top to bottom with nothing pressed and nothing
 * scrolled is not counted. That is rare, and the next visit counts.
 */
let visitReported = false
function reportVisit() {
  if (visitReported)
    return
  visitReported = true

  // Said rather than decided here: whether a reload counts depends on whether
  // the site was seen earlier today, which only the record knows.
  //
  // A page that navigates itself with `location.assign` or `location.href` is
  // not caught: the timing says "navigate", as for a click. Chromium's
  // `webNavigation` would flag those as `client_redirect`, but Firefox (157 and
  // ESR 140) flags only meta refresh, so the permission, and the prompt it costs
  // every user on update, would close the gap in one browser only. Not taken:
  // a visit still needs a person to act on the page, a minute apart.
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const reload = navigation?.type === 'reload'

  sendMessageSafe('record-visit', { url: window.location.href, reload }).catch((error) => {
    // Left open, so the next thing the person does tries again
    visitReported = false
    console.error('Visilant: could not record this visit', error)
  })
}
for (const type of ['pointerdown', 'touchstart', 'keydown', 'wheel'])
  onPage(type, trusted(reportVisit))
// A page brought back from the back-forward cache keeps this script and its
// flag, and coming back to it is a visit like any other
onPage('pageshow', (event: PageTransitionEvent) => {
  if (event.persisted)
    visitReported = false
})

// Every editable field warns alike. Keeping the warning loud in a password or
// card field and softening it in a search box was considered and dropped: the
// page decides what a field says it is, and a password box declared as
// `type="search"` with a masking font would have been the quiet one.
onPage('keydown', trusted(handleKeydown))
onPage('beforeinput', trusted(handleBeforeInput))
onPage('paste', trusted(handlePaste))
onPage('copy', trusted(handleCopyCut))
onPage('cut', trusted(handleCopyCut))
// A page writing to the clipboard through `navigator.clipboard`, which fires no
// `copy` event, so it gets the copy warning on exactly the path a copy takes.
// Must stay a synchronous top-level call: it has to be listening before the page
// has run anything. See src/logic/clipboard-signal.ts.
listenForScriptedClipboardWrites(() => void handleCopyCut())

/**
 * The link the context menu was last opened on, as it read at the time.
 *
 * "Check this link" arrives with an address and no link text, so without this
 * the dialog could never say that the text names one site and the link opens
 * another – which is the trick the check is most often asked about. See
 * `snapshotContextLink`.
 *
 * Taken on the pointer press rather than on `contextmenu`: a page's own
 * handlers see the press first and could rewrite the text before the menu event
 * fires. Any other press clears it. The menu key, a long press on a touchscreen
 * and a menu opened a second time have no right-button press of their own, so
 * `contextmenu` takes a fresh one unless it is the menu that very press opened.
 * A link in a frame is kept out by the frame id the menu item sends, see
 * `contextLinkTextDomain`. On `window` in the capture phase, like the
 * listeners above, so it runs before anything the page registers.
 */
let contextLink: ContextLinkSnapshot | null = null
/** The last right-button press has not had its menu yet. */
let contextPressPending = false

onPage<PointerEvent>('pointerdown', (event) => {
  if (!event.isTrusted)
    return
  contextPressPending = event.button === 2
  contextLink = contextPressPending ? snapshotContextLink(findAnchorFromEvent(event)) : null
})

onPage<MouseEvent>('contextmenu', (event) => {
  if (!event.isTrusted)
    return
  const pressed = contextPressPending
  contextPressPending = false
  const link = findAnchorFromEvent(event)
  const href = link ? linkHref(link) : ''
  if (pressed && contextLink && href && href === contextLink.href)
    return
  contextLink = snapshotContextLink(findAnchorFromEvent(event))
})

// ==========================================
// Link Safety – tooltip and intercept logic
// ==========================================

let hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null
let tooltipGraceTimer: ReturnType<typeof setTimeout> | null = null
let currentHoveredAnchor: LinkElement | null = null
let linkSafetyCleanup: (() => void) | null = null

/**
 * What the link listeners do, while link safety is set up on this page.
 *
 * The listeners are on the window from the start, through `onPage`, and call
 * whatever is here. On the window in the capture phase and added before the
 * page has run anything, they hear a click before any listener the page adds,
 * and the page's own handlers see a held click already cancelled. They also
 * come back after `document.open()`, which a listener added later on the
 * document did not, though only once the script that called it has finished:
 * a listener that script adds to the window comes first (see
 * `watchForDocumentOpen` and the README's Limitations).
 *
 * Empty until the settings are read and the UI is up, and emptied again when
 * the settings change, so until then a click goes through untouched as it did
 * before. Not "held from the first moment": that waits for `mount`.
 */
interface LinkHandlers {
  mouseover: (event: MouseEvent) => void
  mouseout: (event: MouseEvent) => void
  click: (event: MouseEvent) => void
  auxclick: (event: MouseEvent) => void
  prefetch: (event: Event) => void
  scroll: () => void
  keydown: (event: KeyboardEvent) => void
}
let linkHandlers: LinkHandlers | null = null

/**
 * Whether links are held on this page: `pending` until the settings are read
 * and the UI is up, and again while they are being applied anew. Told apart
 * from `off` for a frame asking about its links: "not held on this page" can
 * be remembered for the page, "not known yet" must not be.
 */
let linkSafetyState: 'pending' | 'on' | 'off' = 'pending'

onPage<MouseEvent>('mouseover', event => linkHandlers?.mouseover(event))
onPage<MouseEvent>('mouseout', event => linkHandlers?.mouseout(event))
onPage<MouseEvent>('click', event => linkHandlers?.click(event))
onPage<MouseEvent>('auxclick', event => linkHandlers?.auxclick(event))
onPage('pointerdown', event => linkHandlers?.prefetch(event))
onPage('touchstart', event => linkHandlers?.prefetch(event), { passive: true })
onPage('focusin', event => linkHandlers?.prefetch(event))
onPage('scroll', () => linkHandlers?.scroll())
onPage<KeyboardEvent>('keydown', event => linkHandlers?.keydown(event))

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

  // Fetch from background. No answer is not a verdict, see `VisitFacts.unchecked`
  const unchecked: VisitFacts = { stats: { count: 0 }, isSafe: false, ignored: false, unchecked: true }
  let response: VisitCountResponse | undefined
  try {
    response = await sendMessageSafe<VisitCountResponse>('get-visit-count', { url: href })
  }
  catch (error) {
    console.error('Visilant: could not ask about this site', error)
    return unchecked
  }
  if (!response)
    return unchecked

  // Every fact travels on, not just the count: the check surfaces show the
  // evidence a verdict rests on, and only the background can read it
  const stats: FamiliarityStats = { count: response.count, activeDays: response.activeDays, firstSeen: response.firstSeen }
  const isSafe = isFamiliar(stats, normalizeFamiliarity(settings.value.familiarity))
  const data: VisitFacts = { stats, isSafe, ignored: response.ignored, listed: response.listed }
  setCachedVisitCount(hostname, data)
  return data
}

/**
 * What a link's text names, when it names another site, with what is known of
 * that site. Null for text that only looks like a domain, see `namesASite`.
 */
async function linkMismatch(textDomain: string | undefined): Promise<LinkMismatch | null> {
  if (!textDomain)
    return null
  const data = await fetchLinkData(`https://${textDomain}`, textDomain)
  if (!namesASite(textDomain, data))
    return null
  return { textDomain, textDomainStats: data.stats, textDomainIsSafe: data.isSafe, textDomainUnchecked: data.unchecked }
}

function getAnchorRect(anchor: LinkElement) {
  const rect = linkRect(anchor)
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

/**
 * Follow a link's redirects for the intercept dialog, in auto mode.
 *
 * A failure is kept as a failure rather than dropped. Dropping it left the
 * dialog with nothing to say about a short link it could not see through, and
 * with no way to tell that a lookup had even been tried – so a familiar
 * shortener read as a familiar destination.
 */
async function resolveForIntercept(url: string, hostname: string, isKnownShortener: boolean): Promise<ShortUrlInfo> {
  const failed = (error: string, chain: string[] = [url]): ShortUrlInfo => ({
    originalUrl: url,
    resolvedUrl: '',
    resolvedDomain: '',
    resolvedStats: { count: 0 },
    resolvedIsSafe: false,
    chain,
    status: 'error',
    error,
    isKnownShortener,
  })

  try {
    const result = await sendMessageSafe<ResolvedUrlResult>('resolve-short-url', { url })
    if (!result)
      return failed('failed')
    if (result.status !== 'resolved')
      return failed(result.error || 'failed', result.chain)
    if (!result.finalHostname || result.finalHostname === hostname)
      return failed('same_domain', result.chain)

    const resolvedVisitData = await fetchLinkData(`https://${result.finalHostname}`, result.finalHostname)
    return {
      originalUrl: url,
      resolvedUrl: result.finalUrl,
      resolvedDomain: result.finalHostname,
      resolvedStats: resolvedVisitData.stats,
      resolvedPunycode: alternateSpelling(result.finalHostname),
      resolvedIsSafe: resolvedVisitData.isSafe,
      resolvedUnchecked: resolvedVisitData.unchecked,
      chain: result.chain,
      status: 'resolved',
      isKnownShortener,
    }
  }
  catch {
    return failed('failed')
  }
}

// Show intercept dialog for a URL without an anchor element (used by right-click context menu).
// `textDomain` is what the link's own text named, read off the right-click that
// opened the menu, when it named somewhere else.
async function showLinkInterceptByUrl(url: string, textDomain: string | null = null) {
  const hostname = getHostnameFromHref(url)
  if (!hostname)
    return

  // No external-link gate here, unlike the hover and click paths. Those run on
  // every link the pointer meets, and one on the same site says nothing new.
  // This one runs because the user picked "Check this link" on this link, and
  // an answer about the site they are on is still an answer, where returning
  // left the menu item doing nothing at all.

  const visitData = await fetchLinkData(url, hostname)

  // Handle shortened URLs
  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  const isKnownShortener = isShortenedUrl(hostname)
  const resolveAny = settings.value.linkSafety.shortUrlResolveAny
  const shouldResolve = shortUrlMode === 'auto' && (isKnownShortener || resolveAny)
  let shortUrlInfo: ShortUrlInfo | null = null

  if (shouldResolve) {
    shortUrlInfo = await resolveForIntercept(url, hostname, isKnownShortener)
    // A failure only has something to say about a known shortener. For any other
    // host the dialog keeps its "Show where it leads" and "Mark as shortener"
    // buttons, which is how a shortener missing from the list gets added.
    if (!isKnownShortener && shortUrlInfo.status === 'error')
      shortUrlInfo = null
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

  const mismatch = await linkMismatch(textDomain ?? undefined)

  linkInterceptData.value = {
    domain: hostname,
    url,
    target: '_blank',
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    unchecked: visitData.unchecked,
    mismatch,
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
    unchecked: visitData.unchecked,
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
    unchecked: facts[index].unchecked,
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
      // Compared as sites, the way a link's text is: text reading `acme.com` on
      // an address at `careers.acme.com` names the company the mail goes to.
      // A file name is not a site, see `namesASite`.
      const textDomain = extractDomainFromText(anchorText)
      if (textDomain && !isFileLikeName(textDomain) && recipients.every(r => checkDomainMismatch(textDomain, r.analysis.domain).mismatch))
        mismatch = { textAddress: textDomain }
    }
  }

  return {
    kind: 'email',
    domain: analysis.domain,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    unchecked: visitData.unchecked,
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

async function showEmailTooltip(anchor: LinkElement) {
  const request = ++tooltipRequest
  const data = await buildEmailTooltipData(linkHref(anchor), anchorLabel(anchor), getAnchorRect(anchor))

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
          resolvedUnchecked: resolvedVisitData.unchecked,
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
          resolvedUnchecked: resolvedVisitData.unchecked,
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

async function showLinkTooltip(anchor: LinkElement) {
  const href = linkHref(anchor)
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

  // Check for domain mismatch (link text vs href), whichever name it wears
  const mismatchResult = checkAnchorMismatch(anchor, hostname)

  // Fetch textDomain visit data if mismatch
  let mismatch: LinkMismatch | null = null
  if (mismatchResult.mismatch && mismatchResult.textDomain) {
    mismatch = await linkMismatch(mismatchResult.textDomain)
    if (!stillCurrent())
      return
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
    unchecked: visitData.unchecked,
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
 * Whether a click put back opens a new tab, and where.
 *
 * What the press asked for: a middle click and ctrl or cmd open one behind the
 * page, shift and ctrl+shift one in front. Shift on its own opens a new window,
 * and a tab in front is the nearest a click put back can come.
 */
type NewTab = false | 'background' | 'front'

function newTabFor(event: MouseEvent): NewTab {
  if (event.shiftKey)
    return 'front'
  return event.button === 1 || event.ctrlKey || event.metaKey ? 'background' : false
}

/**
 * Open a link in a new tab, from the background.
 *
 * A page can open a tab only in front of itself, so a middle or ctrl click put
 * back that way took the user off the page they were reading, which the browser
 * never does with one. The background places it beside this tab, behind or in
 * front as the press said, and sends no referrer.
 *
 * Only while the person's press is still fresh. The background opens a tab no
 * popup blocker looks at, so without a press behind it this would be a way for a
 * page to open tabs on its own. Otherwise, and whenever the background does not
 * open it, the page opens it, where the browser's own rules apply.
 */
function openTab(url: string, newTab: 'background' | 'front', rel = '') {
  const byPage = () => {
    const features = rel.toLowerCase().includes('noreferrer') ? 'noopener,noreferrer' : 'noopener'
    window.open(url, '_blank', features)
  }
  if (!pressStillFresh()) {
    byPage()
    return
  }
  sendMessageSafe<{ opened?: boolean }>('open-link-tab', { url, active: newTab === 'front' })
    .then((answer) => {
      if (!answer?.opened)
        byPage()
    }, byPage)
}

/**
 * Whether the press that started this is still one the browser counts, which it
 * does for about five seconds. A browser that cannot say is taken at its word
 * that a held click came from a person, which `isTrusted` already checked.
 */
function pressStillFresh(): boolean {
  return !navigator.userActivation || navigator.userActivation.isActive
}

/**
 * The click we are putting back, so our own handler lets it through.
 *
 * Set for the length of one synchronous dispatch and cleared immediately after.
 */
let replayingClick: LinkElement | null = null

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
 * event it produced itself, so a middle, ctrl or shift click is opened by
 * `openTab` and loses the rest, `rel` and the referrer included.
 */
function followLink(anchor: LinkElement, newTab: NewTab, confirmed?: string) {
  // The address that was on screen when the user said yes, checked again right
  // before the browser is sent anywhere. A dialog stays open for as long as it
  // takes somebody to read it, and the page owns the anchor the whole time: it
  // can point the same element somewhere else, and a click dispatched afterwards
  // follows the element as it stands rather than the link that was approved.
  // The same goes for an element the page has since taken out of the document,
  // where dispatching a click does nothing at all and the link dies silently.
  if (confirmed !== undefined && (linkHref(anchor) !== confirmed || !anchor.isConnected)) {
    // Not the link that was agreed to any more, so it is not the one asked to do
    // the navigating. The address the user actually read is opened directly,
    // where the link would have opened it: a page that makes a link to a new
    // tab, clicks it and takes it away again must not lose the tab it is on.
    if (newTab)
      openTab(confirmed, newTab)
    else if (linkTarget(anchor).toLowerCase() === '_blank')
      window.open(confirmed, '_blank', 'noopener,noreferrer')
    else
      window.location.href = confirmed
    return
  }

  if (newTab) {
    // The address that was agreed to, where there was one. Read off the element
    // it would be whatever the element says by now.
    openTab(confirmed ?? linkHref(anchor), newTab, linkRel(anchor))
    return
  }

  /**
   * The last look at the address, after the page's handlers and before the
   * browser acts on the click.
   *
   * Checking before the dispatch is not enough: the click runs the page's own
   * handlers first, and one of them can point the anchor somewhere else while
   * the browser is still on its way to following it. This runs at the end of
   * the bubble, which is the last moment anything can, and sends the user where
   * the dialog said rather than where the element now points.
   */
  let lastWord: ((event: Event) => void) | null = null
  if (confirmed !== undefined) {
    let acted = false
    lastWord = (event: Event) => {
      if (acted || linkHref(anchor) === confirmed)
        return
      acted = true
      event.preventDefault()
      window.location.href = confirmed
    }
    // Both, because a page handler that stops the click at the anchor would
    // keep it from ever reaching the window
    anchor.addEventListener('click', lastWord)
    window.addEventListener('click', lastWord)
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
    if (lastWord) {
      anchor.removeEventListener('click', lastWord)
      window.removeEventListener('click', lastWord)
    }
  }
}

// ==========================================
// Whether a click on a link is held
// ==========================================

/** Everything a click on a link is decided on, and the decision. */
interface LinkAssessment {
  href: string
  hostname: string
  visit: VisitFacts
  mismatch: LinkMismatch | null
  reasons: InterceptReason[]
}

interface AssessmentEntry<T> {
  at: number
  promise: Promise<T>
  /** Set once the promise has resolved, so a click can be decided without waiting. */
  settled?: T
}

/** As long as a visit answer is trusted, see the visit cache. */
const ASSESSMENT_TTL_MS = 30_000
const ASSESSMENT_LIMIT = 100
/**
 * How long a click waits for its answer before the dialog shows with what is
 * known. The answer is asked for when the pointer or the finger comes down, so
 * by the click it is nearly always in, and a click is almost never held at all.
 */
const HOLD_LIMIT_MS = 1500

const linkAssessments = new Map<string, AssessmentEntry<LinkAssessment>>()
const mailAssessments = new Map<string, AssessmentEntry<MailAssessment>>()
/** Links whose click is being held, so a second click does not start a second hold. */
const heldClicks = new WeakSet<LinkElement>()

function interceptSettings() {
  return normalizeLinkSafety(settings.value.linkSafety).intercept
}

/**
 * Keyed by the address and by what the link says, since a mismatch is about the
 * text, and taken from the anchor as it is at the moment of asking: a page can
 * show a clean href on hover and swap it when the button goes down.
 */
function assessmentKey(labels: string[], href: string): string {
  // Cut short: a card-sized link can carry a whole article as its text, and
  // a domain it might name sits in the first few words of it
  return [href, ...labels.map(label => label.slice(0, 200))].join('\u0000')
}

function remember<T>(
  cache: Map<string, AssessmentEntry<T>>,
  key: string,
  compute: () => Promise<T>,
  unchecked: (result: T) => boolean,
): AssessmentEntry<T> {
  const now = Date.now()
  const existing = cache.get(key)
  if (existing && now - existing.at < ASSESSMENT_TTL_MS)
    return existing
  if (!existing && cache.size >= ASSESSMENT_LIMIT)
    cache.delete(cache.keys().next().value!)

  const entry: AssessmentEntry<T> = { at: now, promise: compute() }
  // Only this entry is forgotten: a newer one under the same key, after the
  // settings changed or this one went stale, is somebody else's answer
  const forget = () => {
    if (cache.get(key) === entry)
      cache.delete(key)
  }
  entry.promise.then((result) => {
    // An answer that did not come is asked again next time, never kept
    if (unchecked(result))
      forget()
    else
      entry.settled = result
  }, forget)
  cache.set(key, entry)
  return entry
}

async function computeLinkAssessment(labels: string[], href: string, hostname: string): Promise<LinkAssessment> {
  const named = checkLabelsMismatch(labels, hostname)
  const [visit, mismatch, lookalikes] = await Promise.all([
    fetchLinkData(href, hostname),
    named.mismatch ? linkMismatch(named.textDomain) : Promise.resolve(null),
    lookalikeAnswer(hostname),
  ])
  const matches = lookalikes.status === 'answered' ? lookalikes.matches : null
  const shortener = isShortenedUrl(hostname)
  const linkSafety = normalizeLinkSafety(settings.value.linkSafety)
  // The site's own short link on the site, which the user asked not to stop.
  // Not "unfamiliar" either: nobody ever visits t.co, so it is unfamiliar to
  // everybody, and that says nothing about where the link goes.
  // Only while short links are stopped at all: the box is greyed out otherwise,
  // and a control nobody can reach must not change anything
  const ownService = shortener && linkSafety.intercept.shortLinks && !linkSafety.intercept.shortLinksOnOwnSite
    && isOwnServiceShortLink(hostname, window.location.hostname)
  const facts: LinkFacts = {
    familiar: visit.isSafe || ownService,
    unchecked: Boolean(visit.unchecked) || lookalikes.status === 'failed',
    // "Resolve any link" on its own setting is a request to follow every link
    // before it opens, which is what holding it as a short link does
    shortLink: (shortener && !ownService) || (linkSafety.shortUrlMode === 'auto' && linkSafety.shortUrlResolveAny),
    // Counted as the dialog draws them: the address's own lines, and the link's
    // text when it names another site. Not for a short link, whose text naming
    // its destination is how short links are written (every external link on X
    // reads as its site and goes through t.co): it cannot be checked, and that
    // is what the short-link reason is for.
    redFlags: addressRedFlagCount(hostname, href, matches) + (mismatch && !shortener ? 1 : 0),
  }
  return { href, hostname, visit, mismatch, reasons: interceptReasons(facts, interceptSettings()) }
}

/**
 * The assessment of a link by the names it goes by, which is all a link in a
 * frame can send up. Read once off an element, at the moment of asking.
 */
function assessLabels(labels: string[], href: string, hostname: string) {
  return remember(linkAssessments, assessmentKey(labels, href), () => computeLinkAssessment(labels, href, hostname), result => result.reasons.includes('unchecked'))
}

function assessLink(anchor: LinkElement, href: string, hostname: string) {
  return assessLabels(anchorLabels(anchor), href, hostname)
}

interface MailAssessment {
  data: LinkTooltipData | null
  reasons: InterceptReason[]
}

async function computeMailAssessment(anchor: LinkElement, href: string): Promise<MailAssessment> {
  const data = await buildEmailTooltipData(href, anchorLabel(anchor), getAnchorRect(anchor))
  if (!data?.email)
    return { data: null, reasons: [] }

  // Every recipient, not just the one the tooltip is headed with: a copy of
  // a lookalike address in `bcc=` is the one an attacker would hide there.
  // The count beside the verdict is the first address's, the recipient list
  // below it names the rest.
  const domains = [...new Set([data.domain, ...(data.email.recipients ?? []).map(recipient => recipient.analysis.domain)])]
  const answers = await Promise.all(domains.map(domain => lookalikeAnswer(domain, 'email')))
  const flagsPerDomain = domains.map((domain, index) => addressRedFlagCount(domain, null, answers[index].status === 'answered' ? answers[index].matches : null))
  // Nobody visits a public or a throwaway mail service, so "unfamiliar" is a
  // question about an ordinary domain only
  const regular = data.email.providerKind === 'regular'
  const facts: LinkFacts = {
    familiar: !regular || data.isSafe,
    unchecked: Boolean(data.unchecked) || answers.some(answer => answer.status === 'failed'),
    shortLink: false,
    redFlags: Math.max(...flagsPerDomain) + (data.email.mismatch ? 1 : 0),
  }
  return { data, reasons: interceptReasons(facts, interceptSettings()) }
}

function assessMail(anchor: LinkElement, href: string) {
  return remember(mailAssessments, assessmentKey(anchorLabels(anchor), href), () => computeMailAssessment(anchor, href), result => result.reasons.includes('unchecked'))
}

function forgetLinkAssessments() {
  linkAssessments.clear()
  mailAssessments.clear()
}

/** The answer, or null once the click has waited as long as it should. */
function withinHold<T>(promise: Promise<T>): Promise<T | null> {
  return Promise.race([promise, new Promise<null>(resolve => setTimeout(resolve, HOLD_LIMIT_MS, null))])
}

/**
 * Whether this content script still belongs to a running extension.
 *
 * One left behind by an update has no background to ask, so every answer it
 * could get is "not checked". Holding clicks on that would stop every link in
 * every tab left open across the update, so it holds nothing: the tab's next
 * load brings a script that can ask.
 */
function extensionAlive(): boolean {
  try {
    return Boolean(browser.runtime?.id)
  }
  catch {
    return false
  }
}

/**
 * A link whose click is being held, wherever it is: an element in this
 * document, or a link in a frame, which only its frame can follow.
 */
interface HeldLink {
  /** The browsing context it names, `''` when none. */
  target: string
  follow: (newTab: NewTab, confirmed: string) => void
  /** Called when the answer is "go back", so a frame can let go of its click. */
  cancel?: () => void
  /** The dialog says the link has to be clicked again, see `FrameLinkClick.canReplay`. */
  clickAgain?: boolean
  /**
   * Asked just before the dialog is drawn, after any waiting. False when the
   * click is no longer there to be decided, and then nothing is drawn.
   */
  beforeShow?: () => boolean
}

function heldElement(anchor: LinkElement): HeldLink {
  return {
    target: linkTarget(anchor),
    follow: (newTab, confirmed) => followLink(anchor, newTab, confirmed),
  }
}

async function handleLinkIntercept(link: HeldLink, newTab: NewTab, assessment: LinkAssessment): Promise<boolean> {
  const { href, hostname, visit: visitData, mismatch, reasons } = assessment
  const target = newTab ? '_blank' : (link.target || '_self')

  // Resolve shortened URL if auto mode is enabled
  const shortUrlMode = settings.value.linkSafety.shortUrlMode
  const isKnownShortener = isShortenedUrl(hostname)
  const resolveAny = settings.value.linkSafety.shortUrlResolveAny
  const shouldResolve = shortUrlMode === 'auto' && (isKnownShortener || resolveAny)
  let shortUrlInfo: ShortUrlInfo | null = null
  // A red flag is about the link itself, and no destination makes it go away
  const onlyTheDestinationMatters = reasons.every(reason => reason === 'short-link' || reason === 'unfamiliar')

  if (shouldResolve) {
    shortUrlInfo = await resolveForIntercept(href, hostname, isKnownShortener)
    // A new tab needs a press the browser still counts, and following a short
    // link can take longer than that lasts. Past it the dialog is shown, with
    // the calm "Go to link", whose own press opens the tab. Where the link
    // turned out to stay on a familiar site that dialog has little to add, and
    // is shown anyway: rare, and a tab the popup blocker ate is worse.
    // A link in a frame that has to be clicked again is never followed here
    // without a word: the dialog is what says so.
    const canFollowNow = !link.clickAgain && (!newTab || pressStillFresh())
    // Use resolved domain's safety for intercept decision
    if (canFollowNow && onlyTheDestinationMatters && shortUrlInfo.status === 'resolved' && shortUrlInfo.resolvedIsSafe) {
      link.follow(newTab, href)
      return false
    }
    // "Resolve any link" asks about every link, and most of them go nowhere
    // else. One that stays on a familiar host leads where it says, and stopping
    // it put a dialog in front of every ordinary link on the page.
    if (canFollowNow && onlyTheDestinationMatters && !isKnownShortener && shortUrlInfo.error === 'same_domain' && visitData.isSafe) {
      link.follow(newTab, href)
      return false
    }
    // See `showLinkInterceptByUrl` for why a failure on any other host is dropped
    if (!isKnownShortener && shortUrlInfo.status === 'error')
      shortUrlInfo = null
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

  if (link.beforeShow && !link.beforeShow())
    return false

  // A dialog already up for another held link is answered "go back" before this
  // one takes its place, or that click would wait on an answer for ever
  if (linkInterceptResolve.value) {
    linkInterceptResolve.value(false)
    linkInterceptResolve.value = null
  }

  linkInterceptData.value = {
    domain: hostname,
    url: href,
    target,
    stats: visitData.stats,
    isSafe: visitData.isSafe,
    unchecked: visitData.unchecked,
    mismatch,
    punycode: alternateSpelling(hostname),
    shortUrl: shortUrlInfo,
    // There is a real link behind this one, and it is put back as a click
    ownNavigation: false,
    reasons,
    clickAgain: link.clickAgain,
  }
  linkInterceptVisible.value = true

  const proceed = await new Promise<boolean>((resolve) => {
    linkInterceptResolve.value = resolve
  })

  if (proceed)
    link.follow(newTab, href)
  else
    link.cancel?.()

  return proceed
}

/** A held link click, decided once its answer is in or the hold runs out. */
async function decideHeldLinkClick(link: HeldLink, href: string, hostname: string, newTab: NewTab, entry: AssessmentEntry<LinkAssessment>) {
  const answer = await withinHold(entry.promise)
  if (answer && !answer.reasons.length) {
    link.follow(newTab, href)
    return
  }
  await handleLinkIntercept(link, newTab, answer ?? uncheckedAssessment(href, hostname))
}

/**
 * What the dialog shows when the hold ran out: what is known, its lines filling
 * in as the answers arrive. Said as not checked, since nothing was.
 */
function uncheckedAssessment(href: string, hostname: string): LinkAssessment {
  return {
    href,
    hostname,
    visit: { ...(getCachedVisitCount(hostname) ?? { stats: { count: 0 }, isSafe: false, ignored: false }), unchecked: true },
    mismatch: null,
    reasons: ['unchecked'],
  }
}

// ==========================================
// Links in frames
// ==========================================

/**
 * A link somebody is reaching for or has clicked inside a frame on this page.
 *
 * Events do not leave a frame, so a phishing link in a mail body served in an
 * iframe was never held. The frame guard has no checks of its own and no UI:
 * it sends the link's address and names, this document judges it exactly as it
 * judges its own links, and the dialog is drawn here.
 */
interface FrameLink {
  frameId: number
  href: string
  labels: string[]
}

interface FrameLinkClick extends FrameLink {
  /** Random per click, so an answer can never reach a click it was not about. */
  id: string
  target: string
  /**
   * Whether the frame can still follow the link itself once the dialog has
   * taken the press. A frame on this page's own origin shares the press on the
   * dialog (measured in Firefox 157 and ESR 140, and the HTML rule Chromium
   * follows), and any frame can navigate itself without one. A cross-origin
   * frame opening a window or moving the page needs a press of its own, and this
   * document does not do it in the frame's place: the frame's sandbox, which it
   * cannot read, may forbid exactly that. Such a link is allowed once instead,
   * and the dialog says to click it again.
   */
  canReplay: boolean
}

/**
 * `pageOff`: no link is held on this page, which the frame may remember until
 * the settings change. `unknown`: nothing could be said now, and nothing is to
 * be remembered. `hold`: the answer about this link. `dialog`: the dialog is
 * up, and the answer comes as `frame-link-decision`.
 */
type FrameLinkAnswer = { pageOff: true } | { unknown: true } | { hold: boolean } | { dialog: true }

/** At most this many names, each as long as `assessmentKey` keeps. */
const FRAME_LABEL_LIMIT = 12

function frameLinkFrom(data: any): FrameLink | null {
  if (typeof data?.href !== 'string' || typeof data?.frameId !== 'number')
    return null
  const labels = Array.isArray(data.labels)
    ? data.labels.filter((label: unknown) => typeof label === 'string').slice(0, FRAME_LABEL_LIMIT).map((label: string) => label.slice(0, 200))
    : []
  return { frameId: data.frameId, href: data.href, labels }
}

/**
 * The assessment, or the answer to give instead. Only "off" and "nothing is
 * held at all" are about the page. A link to this page's own site is about that
 * link, and must not be read as the page holding nothing: a mail body's first
 * link to the webmail itself would otherwise switch the hold off for the
 * phishing link below it.
 */
function frameLinkAssessment(link: FrameLink): { hostname: string, entry: AssessmentEntry<LinkAssessment> } | FrameLinkAnswer {
  if (!extensionAlive() || linkSafetyState === 'pending' || !linkHandlers)
    return linkSafetyState === 'off' ? { pageOff: true } : { unknown: true }
  if (!interceptsAnything(interceptSettings()))
    return { pageOff: true }
  // Judged against this page, which is the one the user is on: a link in the
  // frame to this very site leaves nothing the user does not know
  const hostname = getHostnameFromHref(link.href)
  if (!hostname || !isExternalLink(link.href, window.location.hostname))
    return { hold: false }
  return { hostname, entry: assessLabels(link.labels, link.href, hostname) }
}

async function answerFrameLinkPrefetch(data: any): Promise<FrameLinkAnswer> {
  const link = frameLinkFrom(data)
  if (!link)
    return { unknown: true }
  const found = frameLinkAssessment(link)
  if (!('entry' in found))
    return found
  const answer = await withinHold(found.entry.promise)
  return answer ? { hold: answer.reasons.length > 0 } : { unknown: true }
}

/** The frame click a dialog is up for, so the frame can take it back. */
let frameClickInDialog: { frameId: number, id: string } | null = null
/** Clicks a frame took back before their dialog came up, by frame and id. */
const withdrawnFrameClicks = new Set<string>()

/**
 * The frame gave up waiting and followed its link already. A dialog about it
 * is about a page that has opened, so it goes, without a word to the frame.
 */
function withdrawFrameLinkClick(data: any) {
  if (typeof data?.id === 'string' && typeof data?.frameId === 'number') {
    if (withdrawnFrameClicks.size >= 50)
      withdrawnFrameClicks.delete(withdrawnFrameClicks.values().next().value!)
    withdrawnFrameClicks.add(`${data.frameId}:${data.id}`)
  }
  if (!frameClickInDialog || frameClickInDialog.id !== data?.id || frameClickInDialog.frameId !== data?.frameId)
    return
  frameClickInDialog = null
  linkInterceptVisible.value = false
  linkInterceptData.value = null
  const resolve = linkInterceptResolve.value
  linkInterceptResolve.value = null
  resolve?.(false)
}

async function answerFrameLinkClick(data: any): Promise<FrameLinkAnswer> {
  const link = frameLinkFrom(data)
  if (!link || typeof data.id !== 'string')
    return { unknown: true }
  const click: FrameLinkClick = { ...link, id: data.id, target: typeof data.target === 'string' ? data.target : '', canReplay: data.canReplay === true }
  const found = frameLinkAssessment(click)
  if (!('entry' in found))
    return found

  const answer = await withinHold(found.entry.promise)
  // The frame follows it, with its own press still fresh. Or it has already,
  // having given up on this answer.
  if ((answer && !answer.reasons.length) || withdrawnFrameClicks.has(`${click.frameId}:${click.id}`))
    return { hold: false }

  const mine = { frameId: click.frameId, id: click.id }
  const decide = (follow: boolean, allowOnce = false) => {
    if (frameClickInDialog === mine)
      frameClickInDialog = null
    return sendMessageSafe('frame-link-decision', { ...mine, href: click.href, follow, allowOnce })
      .catch(error => console.error('Visilant: could not answer a frame about its link', error))
  }
  // What "go ahead" means for this frame after the dialog: followed there, or
  // let through for the next click when the frame cannot follow it any more
  const goAhead = () => void decide(click.canReplay, !click.canReplay)
  const withdrawn = () => withdrawnFrameClicks.has(`${click.frameId}:${click.id}`)
  const held: HeldLink = {
    target: click.target,
    clickAgain: !click.canReplay,
    follow: goAhead,
    cancel: () => void decide(false),
    // Taken back while the dialog was being prepared: the link is open already
    beforeShow: () => {
      if (withdrawn())
        return false
      frameClickInDialog = mine
      return true
    },
  }
  // No dialog could be drawn, and a link that does nothing is the one outcome
  // that is never right: followed, as a click with no answer is. The frame's
  // own press was never spent on a dialog, so it still has it.
  const noDialog = () => void decide(true)
  ensureTooltipUiMounted()
    .then(mounted => mounted ? handleLinkIntercept(held, false, answer ?? uncheckedAssessment(click.href, found.hostname)) : noDialog())
    .catch((error) => {
      console.error('Visilant: could not check a link in a frame', error)
      noDialog()
    })
  return { dialog: true }
}

/** A held mail-link click: the tooltip with its "Open mail app", or on its way. */
async function decideHeldMailClick(anchor: LinkElement, href: string, entry: AssessmentEntry<MailAssessment>) {
  const answer = await withinHold(entry.promise)
  if (answer && (!answer.reasons.length || !answer.data)) {
    followLink(anchor, false, href)
    return
  }
  // Out of time: the address is drawn from what can be read now, with no
  // second wait on the background
  const data = answer?.data ?? await withinHold(buildEmailTooltipData(href, anchorLabel(anchor), getAnchorRect(anchor)))
  if (!data) {
    followLink(anchor, false, href)
    return
  }
  // The tooltip only opens over the link it is current for
  if (tooltipGraceTimer) {
    clearTimeout(tooltipGraceTimer)
    tooltipGraceTimer = null
  }
  currentHoveredAnchor = anchor
  data.anchorRect = getAnchorRect(anchor)
  linkTooltipData.value = { ...data, heldClick: true }
  linkTooltipVisible.value = true
}

function setupLinkSafety() {
  const linkSafety = normalizeLinkSafety(settings.value.linkSafety)
  if (!linkSafety.enabled) {
    linkSafetyState = 'off'
    return
  }

  const currentHostname = window.location.hostname

  // Check scope
  if (!isDomainInScope(currentHostname, linkSafety)) {
    linkSafetyState = 'off'
    return
  }

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
    const href = anchor ? linkHref(anchor) : ''
    if (!anchor || !href)
      return

    const mailto = isMailtoHref(href)
    if (!mailto && !isExternalLink(href, currentHostname))
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

  /**
   * Ask about a link as soon as somebody reaches for it, so the click finds its
   * answer waiting. The pointer and the finger come down a little before the
   * click, and the keyboard focuses a link before Enter follows it. Only links
   * that could be held are asked about.
   */
  function prefetchLink(event: Event) {
    if (!event.isTrusted || !interceptsAnything(interceptSettings()))
      return
    const anchor = findAnchorFromEvent(event)
    const href = anchor ? linkHref(anchor) : ''
    if (!anchor || !href)
      return
    if (isMailtoHref(href)) {
      assessMail(anchor, href)
      return
    }
    if (!isExternalLink(href, currentHostname))
      return
    const hostname = getHostnameFromHref(href)
    if (hostname)
      assessLink(anchor, href, hostname)
  }

  /**
   * Hold a click on a link only when there is a reason to, see
   * `interceptReasons`. A link whose answer is already in and gives no reason
   * is not cancelled at all, so it behaves exactly like a link: the page's own
   * router runs, `download` downloads, and a modified click does what the
   * browser does with one.
   */
  function handleClick(event: MouseEvent) {
    // A click the page made up is still held, since it still follows the link,
    // but never as a new tab: a page can set ctrl and shift on an event of its
    // own, and a tab opened from the background passes no popup blocker. It is
    // put back as a plain click, in this tab.
    if (event.button === 0)
      holdClick(event, event.isTrusted ? newTabFor(event) : false)
  }

  /**
   * A middle click opens the link in a new tab, and is held on the same rules.
   * It arrives as `auxclick`, not `click`, and cancelling that is what stops
   * the tab: measured in Chromium 151, Firefox 157 and ESR 140, where cancelling
   * the `mousedown` or a `click` does not.
   */
  function handleAuxClick(event: MouseEvent) {
    // A made-up one opens nothing, so there is nothing to hold
    if (event.button === 1 && event.isTrusted)
      holdClick(event, newTabFor(event))
  }

  function holdClick(event: MouseEvent, newTab: NewTab) {
    const anchor = findAnchorFromEvent(event)
    if (!anchor)
      return
    // Captured before anything is awaited: this ends in a navigation either
    // way, and it has to be the one that was read off the page rather than
    // whatever the anchor says by then
    const href = linkHref(anchor)
    if (!href)
      return

    // The click we are putting back after checking it. Letting it through is the
    // whole point - the browser and the page get to handle it as they would have.
    if (replayingClick === anchor)
      return

    if (!interceptsAnything(interceptSettings()) || !extensionAlive())
      return

    // Alt saves the link in some browsers, which a click put back cannot do
    if (event.altKey)
      return

    if (isMailtoHref(href)) {
      const entry = assessMail(anchor, href)
      if (entry.settled && !entry.settled.reasons.length)
        return
      event.preventDefault()
      event.stopPropagation()
      if (heldClicks.has(anchor))
        return
      heldClicks.add(anchor)
      decideHeldMailClick(anchor, href, entry)
        .catch((error) => {
          console.error('Visilant: could not check this address', error)
          followLink(anchor, false, href)
        })
        .finally(() => heldClicks.delete(anchor))
      return
    }

    if (!isExternalLink(href, currentHostname))
      return
    const hostname = getHostnameFromHref(href)
    if (!hostname)
      return

    const entry = assessLink(anchor, href, hostname)
    if (entry.settled && !entry.settled.reasons.length)
      return

    event.preventDefault()
    event.stopPropagation()
    // A second click while the first is held would hold it twice and replay it twice
    if (heldClicks.has(anchor))
      return
    heldClicks.add(anchor)

    // Cancelled, so this must end in a navigation or a dialog. Failing silently
    // leaves a link that does nothing at all when it is clicked.
    decideHeldLinkClick(heldElement(anchor), href, hostname, newTab, entry)
      .catch((error) => {
        console.error('Visilant: could not check this link', error)
        followLink(anchor, newTab, href)
      })
      .finally(() => heldClicks.delete(anchor))
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

  // The listeners themselves were put on the window when the script started,
  // see `linkHandlers`
  linkHandlers = {
    mouseover: handleMouseOver,
    mouseout: handleMouseOut,
    click: handleClick,
    auxclick: handleAuxClick,
    prefetch: prefetchLink,
    scroll: handleScroll,
    // Only a key somebody pressed. A page could otherwise send an Escape of
    // its own and keep the link check shut for as long as it liked
    keydown: trusted(handleEscape),
  }

  linkSafetyState = 'on'

  linkSafetyCleanup = () => {
    linkHandlers = null
    linkSafetyState = 'pending'
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

/**
 * Set when a mount stopped waiting for a body that had not come.
 *
 * Giving up used to be for good: a page that held its body back for longer -
 * a slow script in the head on a slow line, or a page doing it on purpose -
 * had no warnings and no link check for as long as it stayed open, and the
 * warning it was owed was spent with nothing on screen. The body is watched
 * for instead, and the mount runs when it arrives. A document that never gets
 * one, an XML or SVG file, keeps an observer on its root that never fires.
 */
let bodyWatch: MutationObserver | null = null
/** Whether the mount that is waiting for a body was a forced one. */
let bodyWatchForce = false

function mountWhenBodyArrives(force: boolean) {
  bodyWatch?.disconnect()
  bodyWatchForce = force
  const root = document.documentElement
  if (!root)
    return
  bodyWatch = new MutationObserver(() => {
    if (!document.body)
      return
    bodyWatch?.disconnect()
    bodyWatch = null
    void mount(force)
  })
  bodyWatch.observe(root, { childList: true })
}
// Set while we take our own UI down, so our removal is not read as the page's.
// This has to be an explicit flag rather than "has the app mounted yet": a page
// that rips the container out in the moments before Vue finishes mounting is
// exactly the page worth catching.
let isSelfRemoving = false
/** Moved on by every teardown, so a mount that was under way can tell. */
let uiGeneration = 0

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
      sendMessageSafe('tampering-detected', { reason })
    },
    raise: raiseTopLayer,
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
  forgetLinkAssessments()
  // Not known again until `setupLinkSafety` has run under the new settings,
  // which waits for the verdict below: a frame told "off" in between would
  // stop holding links for good
  if (linkSafetyState === 'off')
    linkSafetyState = 'pending'

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
  // Which teardown this mount belongs to. A teardown in the middle of it, the
  // page replacing its root while the stylesheet loads, leaves this mount
  // holding a container that is no longer ours, and it stops at the next step
  // rather than finishing it. See the `finally` below for what happens then.
  const generation = uiGeneration
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

    if (generation !== uiGeneration)
      return
    if (!document.body) {
      mountWhenBodyArrives(force)
      return
    }

    // Whether this page gets the UI at all, decided by the settings alone and
    // never by what is known about this site. The box is an element in the page,
    // and it used to go only on pages that might need a warning: with the link
    // check off, any script on the page, analytics present on half the web
    // included, could read "this person comes here often" from its absence, and
    // collect that site by site. Not by this site's own exceptions either (the
    // ignore list, the scope lists, the tamper exclusions), which are facts
    // about the site too. (The tamper watch putting a removed box back does
    // follow the exclusion list, which is the user's own choice about the site,
    // not their history.) The app inside is mounted with it every time rather
    // than when first needed: mounting is a long task on the page's thread, and
    // a page timing its frames would see it only where it was needed at once.
    // What that costs falls on profiles with the link check off, since it is on
    // by default and already put the UI on every page.
    const anyProtection = settings.value.showWarningNotification
      || settings.value.linkSafety?.enabled
      || settings.value.blockPasteOnUnfamiliar
    if (!force && !anyProtection)
      return

    container = document.createElement('div')
    container.id = generateSecureId()

    // Robust styles keeping the host on top and visible, set with 'important'
    // priority so page-level `div { ... !important }` rules cannot override it.
    // The same declarations are what the tamper watch checks against.
    applyHostStyles(container)

    const root = document.createElement('div')
    // `all: initial` below resets the font to the browser default, which is a
    // serif. The app's own wrapper (`.vz-root--page` in App.vue) names the
    // generic families and every token, so nothing is set here: a family named
    // inline would be one the page can redefine with an @font-face of its own.

    const styleEl = document.createElement('style')
    const response = await fetch(browser.runtime.getURL('dist/contentScripts/style.css'))
    const cssText = await response.text()
    if (generation !== uiGeneration) {
      // Never attached, and not ours to keep: the teardown that moved the
      // generation on has already let go of everything else
      container = null
      return
    }
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
        sendMessageSafe('tampering-detected', { reason: problem })
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
    // Torn down while this was under way, and the teardown's own remount found
    // this one still running and returned. Started again here, or a page that
    // replaced its root at the right moment would be left with no UI at all.
    if (generation !== uiGeneration && !container)
      void mount(force)
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
  // A copy first: typing comes back with the next key and raises its own warning
  // then, a copy happens once and its warning is the one a ClickFix page is read
  // against. Typing next if the copy was not shown, so that with the copy warning
  // switched off the owed typing warning does not go with it.
  if (safetyLevel.value === false && settings.value?.showWarningNotification) {
    const copied = warningsOwed.has('copy') ? await showNotifications('copy') : 'refused'
    if (copied !== 'shown' && warningsOwed.has('input'))
      await showNotifications('input')
  }

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

// The Vue app is not mounted with every protection switched off, so
// message-triggered tooltips (context menu, QR) must force-mount it first
async function ensureTooltipUiMounted(): Promise<boolean> {
  if (!container)
    await mount(true)
  // Answered rather than assumed. A mount that fails and a mount that returns
  // with nothing in the page look the same to a caller that only awaits it, and
  // one of the callers has already cancelled a paste by the time it asks.
  return Boolean(container)
}

/**
 * Show a warning for something an iframe on this page caught.
 *
 * The frame has no UI of its own – a dialog inside a payment widget would be
 * clipped to the widget – so it hands the fact over and this document draws it.
 *
 * The same warning, word for word, as one raised by typing in the page itself.
 * It used to name the frame's own host and say the box belonged to another
 * site, which is a warning nobody can act on: a frame is unfamiliar by
 * definition, since visits are only counted for top-level navigations, and if
 * somebody has got their frame onto a site the user knows then the site is
 * already theirs. What the frame is for is the events, which are the half this
 * document cannot see – so a typed key is a typed key wherever it landed, and
 * the verdict is the one about the page.
 */
async function showFrameWarning(kind: 'input' | 'copy'): Promise<WarningOutcome> {
  if (safetyLevel.value === null)
    return 'later'
  if (safetyLevel.value !== false || !settings.value?.showWarningNotification)
    return 'refused'

  await ensureTooltipUiMounted()
  return showNotifications(kind)
}

/**
 * Hold a paste an iframe caught, and answer it.
 *
 * The same dialog as a paste into this document, and about the same site: the
 * page, not the frame. The frame names it from the verdict the background gave
 * it, and this document's own address is the fallback for the one case the
 * frame cannot be told about – an internal page, where there is nothing to
 * guard anyway. The answer travels back so the frame knows whether to stop
 * asking.
 */
async function showFramePasteIntercept(data: { id?: string, frameId?: number, hostname?: string, status: 'unfamiliar' | 'settled' | 'error' }): Promise<{ dialog: boolean }> {
  // With no dialog to answer from, saying so now is what tells the frame there
  // is nothing to wait for
  if (!await ensureTooltipUiMounted())
    return { dialog: false }

  const host = data.hostname || window.location.hostname
  const facts = await fetchLinkData(`https://${host}`, host).catch(() => null)

  // A second dialog over the first would leave the first paste unanswered
  if (pasteInterceptVisible.value)
    return { dialog: false }

  const answer = new Promise<boolean>((resolve) => {
    pasteInterceptResolve.value = resolve
  })

  pasteInterceptData.value = {
    domain: host,
    stats: facts?.stats ?? { count: 0 },
    punycode: alternateSpelling(host),
    // The payload stays in the frame. Only its shape would be worth showing and
    // sending the text across for that is not worth what it is.
    payload: describePastePayload(''),
    // Three answers, not two: a frame nobody could get a verdict about is not
    // a frame that came back safe, and the dialog has a wording for that
    status: data.status === 'unfamiliar' ? 'unfamiliar' : (data.status === 'error' ? 'error' : 'safe'),
    inFrame: true,
  }
  pasteInterceptVisible.value = true

  // The reply goes now, the decision whenever the reader makes it: a reply
  // kept open while somebody reads was ended by the browser, Firefox after
  // about 30 idle seconds, and the answer went nowhere
  void answer.then((allowed) => {
    pasteInterceptResolve.value = null
    if (typeof data.id === 'string' && typeof data.frameId === 'number') {
      return sendMessageSafe('frame-paste-decision', { id: data.id, frameId: data.frameId, allowed })
        .catch(error => console.error('Visilant: could not answer a frame about its paste', error))
    }
  })
  return { dialog: true }
}

// Listen for context menu requests from background
// The published types offer three listener shapes, and none of them is the one
// MV3 documents: answer some messages asynchronously and leave the rest to
// whoever else is listening. Always returning `true` would hold a response
// channel open for a message meant for somebody else, so the shape stays and
// the cast carries it across.
browser.runtime.onMessage.addListener(((message: any, _sender: any, sendResponse: (response?: any) => void) => {
  // Raised by an iframe on this page, which has no UI of its own
  if (message.type === 'frame-warning' && message.data) {
    // Answered, so the frame knows whether to ask again for this kind
    showFrameWarning(message.data.kind === 'copy' ? 'copy' : 'input')
      .then(outcome => sendResponse({ outcome }), () => sendResponse({ outcome: 'later' }))
    return true
  }
  // A link in a frame, asked about before the click and when it comes
  if ((message.type === 'frame-link-prefetch' || message.type === 'frame-link-click') && message.data) {
    const answer = message.type === 'frame-link-click' ? answerFrameLinkClick : answerFrameLinkPrefetch
    answer(message.data).then(sendResponse, () => sendResponse({ unknown: true }))
    return true
  }
  if (message.type === 'frame-link-withdraw' && message.data) {
    withdrawFrameLinkClick(message.data)
    return undefined
  }
  if (message.type === 'frame-paste-intercept' && message.data) {
    // Answers whether the dialog went up. What the reader decides there goes
    // back to the frame as a message of its own, see showFramePasteIntercept.
    showFramePasteIntercept(message.data).then(sendResponse, () => sendResponse({ dialog: false }))
    return true
  }

  // Keep this listener synchronous (returning a Promise here would hijack the
  // response channel of unrelated webext-bridge messages)
  if (message.type === 'show-link-intercept' && message.data?.url) {
    const url: string = message.data.url
    // Taken now, not after the mount below: a right-click in the meantime would
    // otherwise put a different link's words into this link's dialog
    const textDomain = contextLinkTextDomain(contextLink, url, message.data.frameId)
    contextLink = null
    // A mailto link has no site to open and nothing for the dialog to say. It
    // gets the address check a held click on it gives, instead of the menu item
    // doing nothing at all.
    if (isMailtoHref(url))
      ensureTooltipUiMounted().then(() => showEmailTooltipByAddress(url))
    else
      ensureTooltipUiMounted().then(() => showLinkInterceptByUrl(url, textDomain))
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
}) as Parameters<typeof browser.runtime.onMessage.addListener>[0])

/**
 * Take the whole in-page UI down, so `mount` can build it again from nothing.
 *
 * Anything that was waiting on a dialog is answered no. The dialog it was
 * waiting on is gone, and a paste held for an answer nobody can give any more
 * would stay held for the life of the page.
 */
function tearDownUi() {
  uiGeneration++
  linkSafetyCleanup?.()
  linkSafetyCleanup = null

  linkTooltipVisible.value = false
  linkTooltipData.value = null
  linkInterceptVisible.value = false
  linkInterceptResolve.value?.(false)
  linkInterceptResolve.value = null
  linkInterceptData.value = null
  pasteInterceptVisible.value = false
  pasteInterceptResolve.value?.(false)
  pasteInterceptResolve.value = null
  pasteInterceptData.value = null
  checkPanelVisible.value = false
  checkPanelData.value = null

  // The flag has to be raised before the first teardown step and lowered after
  // the last, or our own removal comes back as a tampering report
  isSelfRemoving = true
  try {
    stopUiVisibilityWatch?.()
    tamperWatch?.stop()
    app?.unmount()
    container?.remove()
  }
  finally {
    stopUiVisibilityWatch = null
    tamperWatch = null
    app = null
    container = null
    shadowRoot = null
    guardedNodes = []
    isSelfRemoving = false
  }
}

// Handle backward-forward cache
onPage<PageTransitionEvent>('pageshow', async (event) => {
  if (event.persisted) {
    tearDownUi()
    await mount()
  }
})

/**
 * Put everything back after the page called `document.open()`.
 *
 * That call erases every listener on the window and on everything in the
 * document, and nothing tells a content script it happened. The typing, paste
 * and copy listeners went, the link check went, and so did the listeners inside
 * our own panel, whose buttons stopped answering. The tamper watch was left
 * watching a body that was no longer there. A MutationObserver is not a
 * listener and survives it, and the call always ends with a new root element,
 * which is what this watches for. Adding a listener that is already there does
 * nothing, so a root replaced some other way costs nothing but a remount.
 *
 * What it cannot do is be first. The observer runs after the script that called
 * `document.open()` has finished, and a page that adds its own listeners in
 * that same script gets ahead of these. The README says so under Limitations.
 * The clipboard signal does not depend on any of this: it travels on a node
 * outside the document, see src/logic/clipboard-signal.ts.
 */
function watchForDocumentOpen() {
  let root = document.documentElement
  /** The UI was up when the root went, and goes back up with the next one. */
  let rebuild = false
  new MutationObserver(() => {
    const now = document.documentElement
    if (now === root)
      return
    const replaced = root !== null
    root = now

    // Root gone and none in its place yet, as when the page opens the document
    // and writes to it later. Taken down now rather than left for the tamper
    // watch to find missing and raise an alarm about an ordinary page.
    if (!now) {
      // A mount waiting for a body was waiting in the root that just went
      if (container || isMounting || bodyWatch) {
        tearDownUi()
        rebuild = true
      }
      return
    }

    // The first root of a document that had none at document start is not a
    // replacement, and there is nothing to put back yet
    if (!replaced && !rebuild)
      return
    for (const [type, listener, options] of pageListeners)
      window.addEventListener(type, listener, options)
    // A mount still waiting for a body was waiting in the old root
    if (container || isMounting || rebuild || bodyWatch) {
      rebuild = false
      const force = bodyWatch ? bodyWatchForce : false
      bodyWatch?.disconnect()
      bodyWatch = null
      tearDownUi()
      void mount(force)
    }
  }).observe(document, { childList: true })
}

watchForDocumentOpen()
