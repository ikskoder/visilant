/**
 * The channel between the clipboard wrapper in the page's world and the content
 * scripts that raise the warning.
 *
 * `navigator.clipboard.writeText()` and `.write()` fire no event at all, so a
 * page that puts a command in the clipboard through them was invisible to the
 * copy warning. The wrapper that sees those calls has to live in the page's own
 * world (see src/contentScripts/clipboard-main.ts), and the page sees everything
 * there. This file is the half both sides share, and it is written so that the
 * page can at most raise an extra warning, never swallow a real one.
 *
 * Why not a plain event on `window`. A listener there is first in line only
 * until `document.open()`, which erases every listener on the window and on the
 * document – the content script's included, in Chrome and in Firefox alike.
 * After that the page registers its own listener first and stops the event
 * before ours ever sees it. So the signal travels on a node that never joins
 * the document instead: the spec erases listeners on the document's
 * descendants and its window, and a detached node is neither.
 *
 * The node is handed over once, at `document_start`, before any of the page's
 * own code has run. The content script is declared ahead of the wrapper in the
 * manifest and runs first, so it is already listening when the wrapper
 * announces itself. Should the order ever come out the other way, the content
 * script asks, and the wrapper announces again. Once the content script has the
 * node it says so on the node itself, and from then on the wrapper answers no
 * more asking, so in a document loaded with the extension already in place the
 * page never sees the node, and its only way to raise the signal is a real write.
 * That is all it buys: a page can still spend the copy warning with a harmless
 * real write on its first click, but it can no longer do so with no write at all. A
 * document the extension arrived in late, a tab open at install or update, is
 * the exception, since its page was running before either script. Even there a
 * page that listens on the node is too late to stop anything: ours was first,
 * and a capturing listener at the node runs ahead of every bubbling one.
 *
 * Nothing in here may import anything. The page-world bundle includes it, and
 * that bundle must not pull in the polyfill or any of the extension's modules.
 */

/** Sent on `window` by the wrapper, with the channel node as `relatedTarget`. */
export const CLIPBOARD_HELLO = '__visilant-clipboard-hello'

/** Sent on `window` by a content script that arrived after the wrapper. */
export const CLIPBOARD_ASK = '__visilant-clipboard-ask'

/** Sent on the channel node by the content script once it has the node. */
export const CLIPBOARD_ACK = '__visilant-clipboard-ack'

/** Sent on the channel node each time the page wrote to the clipboard. */
export const CLIPBOARD_WRITE = '__visilant-clipboard-write'

/**
 * Listen for clipboard writes made through the Clipboard API.
 *
 * Has to be called synchronously at `document_start`, from the top level of the
 * content script. Every guarantee above rests on this listener being in place
 * before the page has run a single line.
 *
 * `onWrite` is called with an event no browser marks as trusted, since the
 * wrapper creates it. Checking `isTrusted` in a handler here would drop every
 * real signal along with the forged ones.
 */
export function listenForScriptedClipboardWrites(onWrite: () => void) {
  let channel: EventTarget | null = null

  const onHello = (event: Event) => {
    // The first announcement wins. It comes from the wrapper at document start,
    // before the page could have sent one of its own.
    if (channel)
      return
    const node = (event as FocusEvent).relatedTarget
    if (!node)
      return
    channel = node
    // Capture, not bubble. The event is dispatched at the node itself, and there a
    // capturing listener runs ahead of every bubbling one whenever it was added,
    // so a page that got hold of the node could otherwise get in front of this.
    node.addEventListener(CLIPBOARD_WRITE, () => onWrite(), true)
    window.removeEventListener(CLIPBOARD_HELLO, onHello, true)
    node.dispatchEvent(new Event(CLIPBOARD_ACK))
  }

  window.addEventListener(CLIPBOARD_HELLO, onHello, true)
  // Answered synchronously if the wrapper is already here, and harmless if not:
  // the wrapper's own announcement is still to come
  window.dispatchEvent(new Event(CLIPBOARD_ASK))
}
