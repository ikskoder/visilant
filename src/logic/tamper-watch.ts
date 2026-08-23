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
 * Inline styles that keep the host on top and visible.
 *
 * Set with `important`, which is the top of the cascade – above any page
 * stylesheet, and above animations and transitions too. So a page cannot take
 * any of these away with CSS: it has to reach for the style attribute itself,
 * and that is what the attribute watch below is for.
 *
 * The list is longer than "is it displayed". `display`, `visibility` and
 * `opacity` are only the obvious ways to make an element stop being seen, and a
 * page that knew which three were being checked could use any of the others:
 * `transform` to push it off the screen, `clip-path` or `contain: paint` to cut
 * it away, `filter` to wash it out, `content-visibility` to skip rendering it
 * altogether, and `translate` / `rotate` / `scale`, which do what `transform`
 * does without touching the property of that name.
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
  'transform': 'none',
  'translate': 'none',
  'rotate': 'none',
  'scale': 'none',
  'filter': 'none',
  'clip-path': 'none',
  'mask': 'none',
  'content-visibility': 'visible',
  'contain': 'none',
  'mix-blend-mode': 'normal',
  'isolation': 'auto',
}

/**
 * The properties above that this browser actually understands.
 *
 * A property it does not know is dropped on the floor: setting it does nothing
 * and reading it back gives an empty string. Checking those would fail forever
 * on an older browser and report tampering on every page.
 */
let supportedProps: string[] | null = null

function hostStyleProps(doc: Document): string[] {
  if (supportedProps)
    return supportedProps

  const probe = doc.createElement('div')
  supportedProps = Object.entries(HOST_STYLES)
    .filter(([prop, value]) => {
      probe.style.setProperty(prop, value, 'important')
      return probe.style.getPropertyValue(prop) === value
    })
    .map(([prop]) => prop)
  return supportedProps
}

export function applyHostStyles(container: HTMLElement) {
  for (const [prop, value] of Object.entries(HOST_STYLES))
    container.style.setProperty(prop, value, 'important')
}

/** Does the container still carry the styles that make it render at all? */
export function isHostStyleIntact(container: HTMLElement): boolean {
  for (const prop of hostStyleProps(container.ownerDocument)) {
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
/**
 * Is this computed opacity a real, deliberate zero?
 *
 * `Number('')` is 0, and an engine that has no opinion about a property reports
 * an empty string – so the obvious comparison reads "no answer" as "invisible"
 * and declares every page tampered with.
 */
function isTransparent(opacity: string): boolean {
  const value = Number.parseFloat(opacity)
  return Number.isFinite(value) && value === 0
}

export function isVisuallyHidden(container: HTMLElement): boolean {
  const view = container.ownerDocument.defaultView
  const style = view?.getComputedStyle(container)
  if (!style || !view)
    return false

  if (style.display === 'none'
    || style.visibility === 'hidden'
    || style.visibility === 'collapse'
    || isTransparent(style.opacity)) {
    return true
  }

  // An ancestor can hide us without touching our own styles at all. Only the
  // three that mean "not rendered" are read here – a transform or a clip on the
  // body is an everyday thing on real sites, and where those actually matter is
  // whether the panel ends up on the screen, which `isPanelOffScreen` asks
  // directly rather than by guessing from a property.
  for (let node = container.parentElement; node; node = node.parentElement) {
    const parent = view.getComputedStyle(node)
    if (parent.display === 'none' || parent.visibility === 'hidden' || isTransparent(parent.opacity))
      return true
  }

  return false
}

/**
 * Is the panel that is supposed to be showing actually on the screen?
 *
 * Asked of the geometry rather than of any one property, because there are far
 * too many ways to move something out of sight to check them one at a time: a
 * transform on the body, which becomes the containing block for our fixed
 * position, a clip-path or `contain: paint` on an ancestor, a scale of zero.
 * Whatever was used, the panel is either where the user can see it or it is not.
 *
 * Only asked while one of our own panels is on screen. With nothing showing
 * there is no rect to judge and nothing being hidden.
 */
export function isPanelOffScreen(
  container: HTMLElement,
  shadow: ShadowRoot | HTMLElement,
): boolean {
  const view = container.ownerDocument.defaultView
  const rect = largestRenderedRect(shadow)
  if (!view || !rect)
    return false

  const visibleWidth = Math.max(0, Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0))
  const visibleHeight = Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0))
  const area = rect.width * rect.height
  if (area <= 0)
    return true

  // Half of it has to be inside the window. A dialog three quarters off the
  // edge is not something anybody is going to read.
  return (visibleWidth * visibleHeight) / area < 0.5
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
 * Five points rather than one. The centre alone answers for a sheet laid over
 * the whole dialog and for nothing else: a page that covers only the corner
 * where the buttons are leaves the middle of the panel perfectly visible, and
 * the user still cannot press anything.
 */
export function findCoveringElement(
  container: HTMLElement,
  shadow: ShadowRoot | HTMLElement,
): Element | null {
  const rect = largestRenderedRect(shadow)
  if (!rect)
    return null

  const doc = container.ownerDocument
  const width = doc.defaultView?.innerWidth ?? 0
  const height = doc.defaultView?.innerHeight ?? 0

  // The centre, and a point well inside each corner – far enough in to stay
  // clear of the panel's own rounded edges and shadow
  const inset = 0.15
  const points: [number, number][] = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + rect.width * inset, rect.top + rect.height * inset],
    [rect.right - rect.width * inset, rect.top + rect.height * inset],
    [rect.left + rect.width * inset, rect.bottom - rect.height * inset],
    [rect.right - rect.width * inset, rect.bottom - rect.height * inset],
  ]

  for (const [rawX, rawY] of points) {
    const x = Math.round(rawX)
    const y = Math.round(rawY)
    if (x < 0 || y < 0 || x > width || y > height)
      continue

    // Shadow content retargets to the host, so a healthy hit gives the container
    const hit = doc.elementFromPoint(x, y)
    if (hit && hit !== container && !container.contains(hit))
      return hit
  }

  return null
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

/** One alarm per page strike, rather than one per mutation it makes. */
const REPORT_COOLDOWN_MS = 5000

export function createTamperWatch(options: TamperWatchOptions): TamperWatch {
  const { container, shadow, guardedNodes, onTamper, isSelfRemoving } = options
  const doc = container.ownerDocument
  let stopped = false
  // Set while we rewrite the style attribute ourselves, so restoring the guard
  // does not read back as the page having touched it
  let selfWriting = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastReportAt = 0

  /**
   * Say something, and keep watching.
   *
   * The first report used to be the last: the watch shut itself down, so a page
   * that hid the panel once was free to do anything it liked afterwards. It
   * carries on now, with a quiet period so a page that keeps striking produces
   * one alarm rather than a notification every frame.
   */
  function report(reason: TamperReason) {
    if (stopped || isSelfRemoving())
      return

    const now = Date.now()
    if (now - lastReportAt < REPORT_COOLDOWN_MS)
      return
    lastReportAt = now

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

    // Only the inline guard is repairable from here. Restoring it when the panel
    // is hidden by something else – a rule further up the tree – would put the
    // same styles back on every mutation the restore itself produces, forever.
    if (!isHostStyleIntact(container) || container.hasAttribute('hidden')) {
      // Put the panel back before saying anything: the warning is worth more
      // when the thing it is warning about is visible again
      selfWriting = true
      applyHostStyles(container)
      container.removeAttribute('hidden')
      selfWriting = false
      report('hidden')
      return
    }

    if (isVisuallyHidden(container))
      report('hidden')
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
        const problem = verify()
          ?? (isPanelOffScreen(container, shadow) ? 'hidden' : null)
          ?? (findCoveringElement(container, shadow) ? 'covered' : null)
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
