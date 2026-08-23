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

import { isEditableEventTarget, shouldInterceptPaste } from '~/logic/paste-guard'
import { isTrackableHostname } from '~/logic/visit-stats'

/** What the background can say about the frame's own address. */
interface FrameVerdict {
  /** null when nothing could be worked out about this frame. */
  isSafe: boolean | null
  ignored: boolean
  /** Whether the user asked for pastes to be held on unfamiliar sites. */
  guardPaste: boolean
  /** Whether the user wants warnings at all. */
  warn: boolean
  /**
   * The address the verdict is about, named by the background.
   *
   * Not always this frame's own: a frame the page wrote – `about:blank`, a
   * `srcdoc`, a blob – has no address, and belongs to the page that made it.
   * Its events still do not reach the top document, so it is still guarded, and
   * the name shown is the page's.
   */
  hostname: string
}

const UNKNOWN: FrameVerdict = { isSafe: null, ignored: false, guardPaste: false, warn: false, hostname: '' }

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

function send<T>(type: string, data: unknown): Promise<T> {
  return browser.runtime.sendMessage({ type, data }) as Promise<T>
}

function install() {
  // A dotless name is not tracked anywhere in this extension, so there is no
  // verdict to be had about one. Anything else – including a frame with no
  // address of its own – is asked about, and the background says what applies.
  const own = window.location.hostname
  if (own && !isTrackableHostname(own))
    return

  /** The verdict once it has arrived. Read by the paste handler, which cannot wait. */
  let settled: FrameVerdict | null = null
  let pending: Promise<FrameVerdict> | null = null

  /**
   * Ask what this frame is, once.
   *
   * Started by the first sign of a person rather than by the frame loading. An
   * advertisement nobody touches never sends a message at all, and a form
   * somebody is about to type into has its answer well before the first key.
   */
  function prime(): Promise<FrameVerdict> {
    pending ??= send<FrameVerdict>('frame-verdict', { url: window.location.href })
      .then((answer) => {
        settled = answer ?? UNKNOWN
        return settled
      })
      .catch(() => {
        settled = UNKNOWN
        return settled
      })
    return pending
  }

  window.addEventListener('pointerdown', prime, true)
  window.addEventListener('focusin', prime, true)

  /** Raised at most once per frame, the same as the top document's warning. */
  let warned = false

  async function warn(kind: 'input' | 'copy') {
    if (warned)
      return

    const answer = await prime()
    if (answer.isSafe !== false || answer.ignored || !answer.warn || !answer.hostname)
      return

    warned = true
    await send('frame-warning', { kind, hostname: answer.hostname }).catch(() => undefined)
  }

  window.addEventListener('keydown', (event) => {
    // Copy and cut have events of their own, which say what happened instead of
    // guessing from a chord, and Meta is a menu key on macOS rather than typing
    if (event.ctrlKey || event.altKey || event.metaKey)
      return
    if (IGNORED_KEYS.has(event.key))
      return
    void warn('input')
  }, true)

  window.addEventListener('beforeinput', (event) => {
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
      const shown = status === 'checking'
        ? (answer.guardPaste && answer.isSafe === false && !answer.ignored ? 'unfamiliar' : 'settled')
        : 'unfamiliar'

      const proceed = await send<{ allowed: boolean }>('frame-paste-intercept', {
        hostname: answer.hostname,
        isSafe: answer.isSafe,
        status: shown,
      })
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
    if (!text || allowed || !isEditableEventTarget(event))
      return

    // A dialog about this frame is already up. Cancelling is the safe half of
    // the race and keeps two of them from stacking over one another.
    if (holding) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    // No answer yet. Only reachable by pasting into a frame that has never been
    // clicked or focused, which is close to impossible - but the paste is held
    // rather than let through, because held is the recoverable half.
    if (!settled) {
      event.preventDefault()
      event.stopImmediatePropagation()
      void hold('checking')
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
