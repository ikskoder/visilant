/**
 * Watching the in-page UI for a page that tries to get rid of it.
 *
 * The container element lives in the page's DOM, so the page can reach it. Only
 * the shadow root is closed. Everything here is about the ways a page can make
 * the panel stop being seen, which is more than removing the node:
 *
 * - remove the container from the body
 * - replace the body or the whole document element, taking the container along
 * - rewrite or strip the container's style attribute so it renders as nothing
 * - lay its own element over the top, since our z-index is already the maximum
 *   and a later sibling at the same z-index paints above us
 *
 * The first two are structural and are watched all the time. The last one costs
 * a hit test, so it only runs while our own UI is actually on screen. Nothing is
 * hidden at that moment means nothing was hidden.
 */

export type TamperReason
  = | 'removed'
    | 'document-replaced'
    | 'hidden'
    | 'covered'
    | 'shadow-stripped'

/**
 * Inline styles that keep the host on top and visible. Set with `important`, so
 * a page stylesheet cannot outrank them and the page has to touch the attribute
 * itself, which is exactly what the attribute watch below is for.
 */
export const HOST_STYLES: Record<string, string> = {
  'position': 'fixed',
  'top': '0',
  'left': '0',
  'width': '0',
  'height': '0',
  'overflow': 'visible',
  'z-index': '2147483647',
  'pointer-events': 'none',
  'display': 'block',
  'visibility': 'visible',
  'opacity': '1',
}

export function applyHostStyles(container: HTMLElement) {
  for (const [prop, value] of Object.entries(HOST_STYLES))
    container.style.setProperty(prop, value, 'important')
}

/** Does the container still carry the styles that make it render at all? */
export function isHostStyleIntact(container: HTMLElement): boolean {
  for (const prop of ['display', 'visibility', 'opacity', 'position', 'z-index']) {
    if (container.style.getPropertyValue(prop) !== HOST_STYLES[prop])
      return false
    if (container.style.getPropertyPriority(prop) !== 'important')
      return false
  }
  return !container.hasAttribute('hidden')
}

/**
 * Is the element rendered at all, judged from the computed style?
 *
 * Deliberately not a size check: the host is 0x0 by design and everything with
 * a size lives inside the shadow root.
 */
export function isVisuallyHidden(container: HTMLElement): boolean {
  const style = container.ownerDocument.defaultView?.getComputedStyle(container)
  if (!style)
    return false
  return style.display === 'none'
    || style.visibility === 'hidden'
    || style.visibility === 'collapse'
    || Number(style.opacity) === 0
}

/** The largest thing our shadow root is currently rendering, if anything is. */
function largestRenderedRect(shadow: ShadowRoot | HTMLElement): DOMRect | null {
  let best: DOMRect | null = null
  shadow.querySelectorAll('*').forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 24 || rect.height < 24)
      return
    if (!best || rect.width * rect.height > best.width * best.height)
      best = rect
  })
  return best
}

/**
 * Is something of the page's painted over our panel?
 *
 * Point sampling rather than a full geometry check: a hit test at the middle of
 * the panel answers the only question that matters, which is whether the user
 * would be clicking us or something else if they aimed at it.
 */
export function findCoveringElement(
  container: HTMLElement,
  shadow: ShadowRoot | HTMLElement,
): Element | null {
  const rect = largestRenderedRect(shadow)
  if (!rect)
    return null

  const doc = container.ownerDocument
  const x = Math.round(rect.left + rect.width / 2)
  const y = Math.round(rect.top + rect.height / 2)
  if (x < 0 || y < 0 || x > (doc.defaultView?.innerWidth ?? 0) || y > (doc.defaultView?.innerHeight ?? 0))
    return null

  // Shadow content retargets to the host, so a healthy hit gives the container
  const hit = doc.elementFromPoint(x, y)
  if (!hit || hit === container || container.contains(hit))
    return null
  return hit
}

export interface TamperWatchOptions {
  container: HTMLElement
  shadow: ShadowRoot | HTMLElement
  /** Nodes inside the shadow root whose removal means the UI was gutted. */
  guardedNodes: Node[]
  onTamper: (reason: TamperReason) => void
  /** True while the extension itself is taking the container down. */
  isSelfRemoving: () => boolean
  /** How often to re-check visibility while our UI is on screen. */
  visibleCheckInterval?: number
}

export interface TamperWatch {
  /** Tell the watch whether any of our own panels is currently showing. */
  setUiVisible: (visible: boolean) => void
  /** Run every check once. Returns the first problem found, or null. */
  verify: () => TamperReason | null
  stop: () => void
}

const DEFAULT_VISIBLE_CHECK_INTERVAL = 1000

export function createTamperWatch(options: TamperWatchOptions): TamperWatch {
  const { container, shadow, guardedNodes, onTamper, isSelfRemoving } = options
  const doc = container.ownerDocument
  let stopped = false
  // Set while we rewrite the style attribute ourselves, so restoring the guard
  // does not read back as the page having touched it
  let selfWriting = false
  let timer: ReturnType<typeof setInterval> | null = null

  function report(reason: TamperReason) {
    if (stopped || isSelfRemoving())
      return
    stopped = true
    stopObservers()
    onTamper(reason)
  }

  /** Is the container still somewhere the user could see it? */
  function isAttached(): boolean {
    return Boolean(doc.body?.contains(container))
  }

  function checkStructure(): TamperReason | null {
    return isAttached() ? null : 'removed'
  }

  function checkAppearance(): TamperReason | null {
    if (!isHostStyleIntact(container) || isVisuallyHidden(container))
      return 'hidden'
    return null
  }

  function verify(): TamperReason | null {
    return checkStructure() ?? checkAppearance()
  }

  // Removal of the container from the body
  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.removedNodes.forEach((node) => {
        if (node === container || node.contains?.(container))
          report('removed')
      })
    }
  })

  // Replacement of the body itself, which takes the container off the screen
  // without ever recording a removal on the node the body watch is attached to.
  // Nothing was removed from anything we watch, so the check is positional:
  // is the container still inside whatever body the document has now.
  const documentObserver = new MutationObserver(() => {
    if (!isAttached())
      report('document-replaced')
  })

  // Rewriting or stripping the inline guard styles
  const attributeObserver = new MutationObserver(() => {
    if (selfWriting || stopped)
      return
    if (checkAppearance()) {
      // Put the panel back before saying anything: the warning is worth more
      // when the thing it is warning about is visible again
      selfWriting = true
      applyHostStyles(container)
      container.removeAttribute('hidden')
      selfWriting = false
      report('hidden')
    }
  })

  // Gutting the shadow tree, which is only reachable in dev builds where the
  // shadow root is open
  const shadowObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.removedNodes.forEach((node) => {
        if (guardedNodes.includes(node))
          report('shadow-stripped')
      })
    }
  })

  function stopObservers() {
    bodyObserver.disconnect()
    documentObserver.disconnect()
    attributeObserver.disconnect()
    shadowObserver.disconnect()
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  if (doc.body)
    bodyObserver.observe(doc.body, { childList: true })
  if (doc.documentElement)
    documentObserver.observe(doc.documentElement, { childList: true })
  attributeObserver.observe(container, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
  shadowObserver.observe(shadow, { childList: true, subtree: true })

  return {
    setUiVisible(visible: boolean) {
      if (stopped)
        return
      if (!visible) {
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
        return
      }
      if (timer !== null)
        return

      const check = () => {
        if (stopped)
          return
        const problem = verify() ?? (findCoveringElement(container, shadow) ? 'covered' : null)
        if (problem)
          report(problem)
      }
      check()
      timer = setInterval(check, options.visibleCheckInterval ?? DEFAULT_VISIBLE_CHECK_INTERVAL)
    },
    verify,
    stop() {
      stopped = true
      stopObservers()
    },
  }
}
