/**
 * The guard inside an iframe.
 *
 * The main content script runs in the top document only, and events do not
 * cross a frame boundary: a keypress inside an iframe, a paste into a form in
 * one, or a copy out of one never reaches the top document's listeners. A login
 * form served in an iframe, which is how a great many of them are served,
 * therefore bypassed every warning the extension has.
 *
 * This is deliberately not the main content script with a flag on it. It runs in
 * every frame of every page, the ad frames and the tracking pixels included, so
 * what it costs while nothing is happening is the whole design:
 *
 * - no Vue, no stylesheet, no shadow root, no tamper watch
 * - none of the domain lists, which are the expensive part of the main script
 * - nothing at all is asked of the background until the user touches the frame
 *
 * What is left is a handful of listeners. The first sign that somebody is using
 * this frame - a click in it, a focus, a key - asks for its verdict, and from
 * then on the frame can answer for itself. Anything that needs to be seen is
 * handed to the top document to draw, because a dialog inside a 200-pixel advert
 * would be clipped to nothing.
 */

import { isMessageError } from '~/logic/message-error'
import { isEditableEventTarget, isPasteSink, shouldInterceptPaste } from '~/logic/paste-guard'
import { parseStoredSettings } from '~/logic/storage'

/**
 * What the background says about the page this frame sits in.
 *
 * The page, not the frame. A cross-origin frame is unfamiliar by definition –
 * visits are counted for top-level navigations, so a host that only ever
 * appears inside a frame can never leave zero – and judging frames by their own
 * address meant warning about every embedded preview and payment box for ever.
 * The guard is about what the top document cannot see, which is the events, and
 * the verdict about those is the verdict about the page they happened on.
 */
interface FrameVerdict {
  /** null when nothing could be worked out about the page. */
  isSafe: boolean | null
  ignored: boolean
  /** Whether the user asked for pastes to be held on unfamiliar sites. */
  guardPaste: boolean
  /** Whether the user wants warnings at all. */
  warn: boolean
  /** The page's address, named by the background. Empty on an internal page. */
  hostname: string
}

const UNKNOWN: FrameVerdict = { isSafe: null, ignored: false, guardPaste: false, warn: false, hostname: '' }

/** How long a held paste waits for a verdict before the dialog stops waiting. */
const HOLD_TIMEOUT_MS = 6000

const IGNORED_KEYS = new Set([
  'Shift',
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
])

async function send<T>(type: string, data: unknown): Promise<T> {
  const answer = await browser.runtime.sendMessage({ type, data })
  // A background that failed says so. Read as an answer it would be read as
  // "nothing to guard against here", which is the opposite of what it means.
  if (isMessageError(answer))
    throw new Error(answer.error)
  return answer as T
}

function install() {
  // Nothing here is judged by this frame's own address any more, so nothing
  // here filters on it either: a form served from a dotless host inside an
  // unfamiliar page is the same form. The background answers for the page, and
  // an internal one comes back with nothing to guard.

  /** The verdict once it has arrived. Read by the paste handler, which cannot wait. */
  let settled: FrameVerdict | null = null
  let pending: Promise<FrameVerdict> | null = null

  /**
   * Whether the user asked for pastes to be held, read straight from storage.
   *
   * Separate from the verdict, and deliberately so. The verdict has to come from
   * the background, which may be asleep and take a moment to wake. This is one
   * storage read in this document, and it answers the only question a paste
   * handler cannot afford to get wrong: whether to hold at all. Without it, a
   * paste arriving before the background answered was held on a page belonging
   * to somebody who had switched the whole feature off.
   */
  let guardPaste: boolean | null = null

  async function primeSettings(): Promise<void> {
    if (guardPaste !== null)
      return
    try {
      const stored = await browser.storage.sync.get('settings')
      guardPaste = Boolean(parseStoredSettings(stored.settings)?.blockPasteOnUnfamiliar)
    }
    catch {
      // Nothing was read, so nothing is claimed and nothing is remembered. Off
      // is how this paste is treated, because holding one for a feature nobody
      // asked for is the worse of the two mistakes - but the next one asks
      // again rather than inheriting a failure from minutes ago.
      guardPaste = null
    }
  }

  /**
   * Ask what this frame is, once.
   *
   * Started by the first sign of a person rather than by the frame loading. An
   * advertisement nobody touches never sends a message at all, and a form
   * somebody is about to type into has its answer well before the first key.
   *
   * A failed round trip is not remembered. The background is asleep, or the
   * extension was just reloaded - and pinning the frame to "nothing is known"
   * for the life of the document turns the guard off silently, which is the one
   * thing this file exists to prevent.
   */
  function prime(): Promise<FrameVerdict> {
    void primeSettings()

    // Nothing is sent about this frame: the browser tells the background which
    // tab the message came from, and the tab's address is the whole question.
    pending ??= send<FrameVerdict>('frame-verdict', {})
      .then((answer) => {
        // An empty answer is not a verdict either. Kept as one, it left the
        // frame believing nothing was known - and `UNKNOWN` holds nothing to
        // guard against - for the life of the document.
        if (!answer) {
          pending = null
          return UNKNOWN
        }
        settled = answer
        return settled
      })
      .catch(() => {
        pending = null
        return UNKNOWN
      })
    return pending
  }

  window.addEventListener('pointerdown', prime, true)
  window.addEventListener('focusin', prime, true)

  /** Raised at most once per frame, the same as the top document's warning. */
  let warned = false

  /**
   * Forget what was worked out about this frame, so the next event asks again.
   *
   * The verdict was asked for once and kept for the life of the document, and a
   * document in an iframe outlives a great many changes. A frame somebody had
   * already touched never learned that the paste guard had just been switched
   * on, that the visits had been wiped or imported, or that the site had been
   * taken off the ignore list – it went on answering from a verdict reached
   * before any of that, which for the guard means answering "let it through".
   */
  function forget() {
    settled = null
    pending = null
    warned = false
  }

  // Storage says all of this without a single message: the change is delivered
  // to the frame, and nothing is asked of the background until the next time
  // somebody touches this frame – which is the whole rule this file lives by.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      guardPaste = Boolean(parseStoredSettings(changes.settings.newValue)?.blockPasteOnUnfamiliar)
      forget()
      return
    }

    // The visit records are keyed by hostname, and a change to somebody else's
    // record says nothing about the page this frame is on. A wipe reports the
    // key as removed, which is a change to it like any other. Nothing to forget
    // before the first answer arrives, so an unsettled frame ignores this.
    if (area === 'local') {
      const host = settled?.hostname
      if (host && Object.prototype.hasOwnProperty.call(changes, host))
        forget()
    }
  })

  async function warn(kind: 'input' | 'copy') {
    if (warned)
      return

    const answer = await prime()
    if (answer.isSafe !== false || answer.ignored || !answer.warn || !answer.hostname)
      return

    warned = true
    // Only the kind: the top document knows which page it is, and drawing the
    // frame's own name beside the warning is the claim this guard no longer makes
    await send('frame-warning', { kind }).catch(() => undefined)
  }

  window.addEventListener('keydown', (event) => {
    // Copy and cut have events of their own, which say what happened instead of
    // guessing from a chord, and Meta is a menu key on macOS rather than typing
    if (event.ctrlKey || event.altKey || event.metaKey)
      return
    if (IGNORED_KEYS.has(event.key))
      return
    // Only where the key puts text somewhere. A site's single-key shortcuts land
    // on whatever has the focus, and warning about those is noise about nothing
    // being entered - the top document has asked this since the beginning.
    if (!isEditableEventTarget(event))
      return
    void warn('input')
  }, true)

  window.addEventListener('beforeinput', (event) => {
    // `beforeinput` only fires on something editable, but a page can raise one
    // of its own and this walks a path that is already in hand
    if (!isEditableEventTarget(event))
      return

    const kind = (event as InputEvent).inputType || ''
    if (kind.startsWith('delete') || kind === 'historyUndo' || kind === 'historyRedo')
      return
    // The paste handler below asks a better question about the same event
    if (kind === 'insertFromPaste' || kind === 'insertFromPasteAsQuotation')
      return
    void warn('input')
  }, true)

  window.addEventListener('copy', () => void warn('copy'), true)
  window.addEventListener('cut', () => void warn('copy'), true)

  /** Set while a dialog about this frame is on screen in the top document. */
  let holding = false
  /** Lifted once the user has confirmed a paste into this frame. */
  let allowed = false

  async function hold(status: 'unfamiliar' | 'checking') {
    holding = true
    try {
      const answer = await prime()

      // Held before the answer was in, and the answer turned out to be that
      // there was nothing to hold for. The paste is already cancelled, so the
      // user is told rather than left looking at an empty field.
      //
      // No verdict at all is its own outcome. Shown as "settled" it read as a
      // site that had been checked and found familiar, which is a claim about a
      // frame nobody managed to check.
      const shown = status === 'checking'
        ? (answer.isSafe === null
            ? 'error'
            : (answer.isSafe === false && !answer.ignored ? 'unfamiliar' : 'settled'))
        : 'unfamiliar'

      // Raced against a deadline. Without one, a top document that took the
      // message and never answered - two frames pasting at once used to manage
      // exactly that - left `holding` set, and from then on every paste in this
      // frame was cancelled with no dialog and no way to get one.
      const proceed = await Promise.race([
        send<{ allowed: boolean }>('frame-paste-intercept', {
          hostname: answer.hostname,
          isSafe: answer.isSafe,
          status: shown,
        }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), HOLD_TIMEOUT_MS)),
      ])
      if (proceed?.allowed)
        allowed = true
    }
    catch {
      // The top document could not be reached. The paste stays cancelled, which
      // is the safe outcome, and the next one is asked about again.
    }
    finally {
      holding = false
    }
  }

  window.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') || ''
    if (!text || allowed || !isPasteSink(event))
      return

    // A dialog about this frame is already up. Cancelling is the safe half of
    // the race and keeps two of them from stacking over one another.
    if (holding) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    // No verdict yet, but the setting is known - and the setting is what says
    // whether to hold at all. Held only where the user asked for it, which is
    // the difference between protecting a secret and dropping somebody's paste
    // for a feature they switched off.
    if (!settled) {
      void prime()
      if (guardPaste) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void hold('checking')
      }
      return
    }

    if (shouldInterceptPaste({
      enabled: settled.guardPaste,
      siteIsSafe: settled.isSafe,
      ignored: settled.ignored,
      hasText: true,
      targetIsEditable: true,
      alreadyAllowed: allowed,
    })) {
      event.preventDefault()
      event.stopImmediatePropagation()
      void hold('unfamiliar')
    }
  }, true)
}

// The top document has its own script, which does all of this and a great deal more
if (window.top !== window)
  install()
