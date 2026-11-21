import { onBeforeUnmount, watch } from 'vue'
import { closeOpenAddressParts } from './openAddressParts'

/** Every surface up in the top layer right now, by what puts it back on top. */
const raisers = new Set<() => boolean>()

/**
 * Put every surface of ours back on top of the top layer.
 *
 * Whatever entered last is drawn above the rest, so a page that opens a modal
 * or a popover of its own after ours covers it. The tamper watch calls this
 * once before reporting the panel covered. True when there was anything to
 * raise.
 */
export function raiseTopLayer(): boolean {
  // A card that reads an address would end up under the surface it is about
  closeOpenAddressParts()
  let raised = false
  for (const raise of raisers)
    raised = raise() || raised
  return raised
}

/**
 * Puts one of the in-page surfaces into the browser's top layer.
 *
 * Drawn the ordinary way, with `position: fixed` and the highest z-index, a
 * surface could be hidden by the page in a dozen ways: an element of its own
 * laid over it at the same z-index, a `transform` or `clip-path` on the body,
 * `opacity: 0` on the body or the root, a video gone full screen. The tamper
 * watch noticed, and that was all it could do. The top layer is drawn above
 * the whole document and takes nothing from the page's ancestors, so those
 * tricks no longer hide anything. Measured in Chromium and Firefox, see
 * `.tmp/followups/toplayer.md`.
 *
 * It is not armour. A page can still open a modal or a popover of its own
 * after ours, which lands above it, and `display: none` on the body takes the
 * whole tree away. The tamper watch stays for those.
 *
 * `modal` is a `<dialog>` opened with `showModal()`, for the surfaces that
 * already block the page: the two intercept dialogs and the check panel.
 * `popover` is a manual popover, which blocks nothing, for the link tooltip
 * and the typing warning.
 *
 * Call `enter` from the `<Transition>`'s `enter` hook, and give the
 * transition `appear`. That is the first moment the element is in the
 * document, and before the first frame is drawn. Without `appear` a surface
 * that is already up when the app mounts, as after `document.open()` rebuilds
 * it, never enters, and a popover that never opened is not drawn at all.
 *
 * When `visible` turns false the element leaves the top layer at once, not at
 * the end of the fade: while a modal dialog is open everything else is
 * inert, and the focus handed back to the page, or the click put back on a
 * link, would land on nothing.
 */
export function useTopLayer(options: {
  mode: 'modal' | 'popover'
  visible: () => boolean
  /**
   * The browser closed it rather than us: a second Escape the page had
   * swallowed the first of, the back gesture on Android. For a dialog that is
   * a way out, never a way through.
   */
  onDismiss?: () => void
}) {
  let current: HTMLElement | null = null
  /** Closes of our own making while raising it, whose events are still to come. */
  let raisingCloses = 0

  function onNativeClose(event: Event) {
    if (event.target !== current)
      return
    if (options.mode === 'modal' && raisingCloses > 0) {
      raisingCloses--
      return
    }
    if (options.mode === 'popover' && (event as ToggleEvent).newState !== 'closed')
      return
    options.onDismiss?.()
  }

  function enter(node: Element) {
    leave()
    const element = node as HTMLElement
    current = element
    try {
      if (options.mode === 'modal')
        (element as HTMLDialogElement).showModal()
      else
        element.showPopover()
    }
    catch {
      // Without the top layer it still draws, the way it always did: the
      // element's own classes keep it fixed above the page, a dialog's `flex`
      // and a popover's `display` from `.vz-layer[popover]`
      return
    }
    element.addEventListener(options.mode === 'modal' ? 'close' : 'toggle', onNativeClose)
    raisers.add(raise)
  }

  /**
   * Out of the top layer and straight back in, which puts it on top again.
   *
   * For a modal the `close()` in between hands the focus to the page for a
   * moment, so the page sees a focus and a blur before it comes back here.
   */
  function raise(): boolean {
    const element = current
    if (!element)
      return false
    // Opening a modal moves the focus, and the user was somewhere in it
    const root = element.getRootNode() as Document | ShadowRoot
    const focused = root.activeElement as HTMLElement | null
    try {
      if (options.mode === 'modal') {
        raisingCloses++
        ;(element as HTMLDialogElement).close()
        ;(element as HTMLDialogElement).showModal()
      }
      else {
        element.hidePopover()
        element.showPopover()
      }
    }
    catch {
      return false
    }
    if (focused && element.contains(focused))
      focused.focus()
    return true
  }

  function leave() {
    const element = current
    if (!element)
      return
    current = null
    raisers.delete(raise)
    raisingCloses = 0
    // Taken off first, so the close this causes is not mistaken for the
    // browser's. The event is queued, and finds nobody listening.
    element.removeEventListener('close', onNativeClose)
    element.removeEventListener('toggle', onNativeClose)
    try {
      if (options.mode === 'modal') {
        if ((element as HTMLDialogElement).open)
          (element as HTMLDialogElement).close()
      }
      else if (element.matches(':popover-open')) {
        element.hidePopover()
      }
    }
    catch {
      // Already gone from the document, which takes it out of the top layer too
    }
  }

  // Synchronous, so it runs before anything else that reacts to the dialog
  // closing: the focus going back, the paste or the click going ahead
  watch(options.visible, (open) => {
    if (!open)
      leave()
  }, { flush: 'sync' })

  onBeforeUnmount(leave)

  return { enter }
}
