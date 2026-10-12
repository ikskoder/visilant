/**
 * The clipboard wrapper, in the page's own world.
 *
 * `navigator.clipboard.writeText()` and `.write()` put text in the clipboard
 * without firing a `copy` event, so the copy warning never saw them. That is
 * the whole of a ClickFix page: a fake check asks for Win+R, paste, Enter, and
 * the command was put in the clipboard by the page when the button was pressed.
 * An isolated content script cannot see a page's calls, so this one runs in the
 * page's world and wraps both methods.
 *
 * It only tells – the call goes through untouched and its result is returned as
 * it came. The warning is raised by the content scripts, on the same path as a
 * copy, through the channel in src/logic/clipboard-signal.ts.
 *
 * The page sees everything here and can change anything it can reach, so every
 * built-in this file uses is taken before the page has run, and nothing is
 * looked up on a shared object after that: not `call` or `bind`, which the page
 * can replace on `Function.prototype`, and not a spread, which goes through the
 * array iterator. What it cannot do is reach into this closure.
 *
 * What it does not cover, and cannot: a page can take a clean `writeText` from
 * a frame it has just created, before the browser has run this script in it,
 * and call that one. See Limitations in the README.
 *
 * This file is bundled on its own and may import nothing but the channel names.
 * The polyfill, Vue or any extension module would run in the page's world, where
 * they fail and where the page can read them.
 */

import { CLIPBOARD_ACK, CLIPBOARD_ASK, CLIPBOARD_HELLO, CLIPBOARD_WRITE } from '~/logic/clipboard-signal'

function install() {
  // Absent outside a secure context, where there is nothing to wrap
  if (typeof Clipboard === 'undefined')
    return

  const apply = Reflect.apply
  const defineProperty = Object.defineProperty
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
  const addEventListener = EventTarget.prototype.addEventListener
  const dispatchEvent = EventTarget.prototype.dispatchEvent
  const createElement = Document.prototype.createElement
  const BareEvent = Event
  const HandOver = FocusEvent
  const enqueue = queueMicrotask
  const global = window
  const proto = Clipboard.prototype
  // The same object for the life of the document, so a call on anything else
  // is this document's method borrowed for another one's clipboard
  const own: unknown = navigator.clipboard

  // Never attached to the document, which is what keeps the content script's
  // listener on it through a `document.open()`
  const channel: EventTarget = apply(createElement, document, ['span'])

  const announce = () => {
    // No prototype on the options, so reading them runs nothing of the page's
    const init = { __proto__: null, relatedTarget: channel } as FocusEventInit
    apply(dispatchEvent, global, [new HandOver(CLIPBOARD_HELLO, init)])
  }

  let queued = false
  const signal = () => {
    // Cleared before dispatching, so a dispatch that somehow throws cannot leave
    // every later write unreported
    queued = false
    apply(dispatchEvent, channel, [new BareEvent(CLIPBOARD_WRITE)])
  }

  /**
   * Report a write, from a clean stack.
   *
   * Dispatching right here would run the content script's listener at whatever
   * depth the page called from, and a page can recurse to just short of the
   * limit: the listener then overflows, the browser swallows a listener's error,
   * and the native call, which needs less stack, still goes through. A
   * microtask runs on an empty stack, and it runs before anything the page does
   * with the promise it gets back. Queueing is not caught: if even that fails,
   * the error stops the call before anything reaches the clipboard. The flag is
   * set only once the microtask is queued, or a page that made queueing fail
   * once would have silenced every write after it.
   *
   * The one exception is a borrowed call: this frame's method called on another
   * document's clipboard. Only this frame hears about that one, and the page
   * can remove the frame straight after the call, before a microtask here ever
   * runs. So it is told at once, at whatever depth the page chose. A page that
   * goes to that much trouble is in the territory of the clean frame described
   * in the README, which needs no trick at all.
   */
  const report = (self: unknown) => {
    if (self !== own) {
      apply(dispatchEvent, channel, [new BareEvent(CLIPBOARD_WRITE)])
      return
    }
    if (queued)
      return
    apply(enqueue, global, [signal])
    queued = true
  }

  const wrap = (name: 'writeText' | 'write') => {
    const original = getOwnPropertyDescriptor(proto, name)
    if (!original || typeof original.value !== 'function')
      return
    const native = original.value as (...args: unknown[]) => unknown

    // Method shorthand, so the wrapper has no `prototype` and cannot be called
    // with `new`, like the method it stands in for. The names and lengths match.
    const wrappers = {
      writeText(this: unknown, _data: unknown) {
        report(this)
        // eslint-disable-next-line prefer-rest-params -- forwards exactly what was passed, without the array iterator a spread goes through
        return apply(native, this, arguments as unknown as unknown[])
      },
      write(this: unknown, _data: unknown) {
        report(this)
        // eslint-disable-next-line prefer-rest-params -- see above
        return apply(native, this, arguments as unknown as unknown[])
      },
    }
    defineProperty(proto, name, { ...original, value: wrappers[name] })
  }

  wrap('writeText')
  wrap('write')

  // Told once the content script has the node. After that nobody is asked
  // about again, so the page never gets to see it. Nothing is read off the
  // event: it is the page's world, and the fact that it arrived is enough.
  let linked = false
  apply(addEventListener, channel, [CLIPBOARD_ACK, () => {
    linked = true
  }])

  // A content script that arrived after this asks to be told again. Unanswered
  // once linked, which also means a second copy of the content script, as the
  // dev build's reload injects, never hears clipboard writes. Production never
  // injects twice.
  apply(addEventListener, global, [CLIPBOARD_ASK, () => {
    if (!linked)
      announce()
  }, true])
  announce()
}

install()
