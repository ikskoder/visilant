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
 *
 * All of it is repaired before it is reported – the guard styles go back on the
 * container, the container goes back into the body – because a warning about a
 * panel that is still missing is worth less than one the user can read while it
 * is on the screen in front of them.
 *
 * The repair is also what decides whether there is anything to report. A site
 * that draws its own pages throws its body away on every route it takes, and our
 * container goes with it, which is the same event as a page tearing the panel
 * out and is why back and forward used to raise the alarm on sites doing nothing
 * wrong. What tells the two apart is not the event, it is what happens next: a
 * router removed the container as a side effect of work it has already finished,
 * so once it is put back it stays back, while a page that wants the panel gone
 * has to keep taking it away. See `repairStructure` and `confirmRepair`.
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

  return false
}

/**
 * Is something above us in the tree hiding the whole panel?
 *
 * Kept apart from `isVisuallyHidden`, and asked only on the slow repeat check,
 * because every one of these is an ordinary thing for a page to do for a moment:
 * `body { opacity: 0 }` with a fade-in on load, and the web-font guard that puts
 * `visibility: hidden` on the body until the face arrives, are both everywhere.
 * Read once at mount time - which is where `isVisuallyHidden` is read - they
 * would raise the alarm on a large part of the web.
 *
 * What tells those apart from a page hiding the panel is that they stop. So this
 * is only believed when it is still true on the next check, a second later.
 */
export function isHiddenByAncestor(container: HTMLElement): boolean {
  const view = container.ownerDocument.defaultView
  if (!view)
    return false

  for (let node = container.parentElement; node; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || isTransparent(style.opacity))
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

/**
 * The largest thing our shadow root is currently rendering, if anything is.
 *
 * A full-screen backdrop does not count. Both intercept dialogs draw one -
 * `fixed inset-0`, which is by definition the largest element in the tree - so
 * taking the largest outright measured the viewport rather than the card. Every
 * corner probe then landed on transparent backdrop, and the off-screen check
 * compared the viewport with itself and could never fire.
 */
function largestRenderedRect(shadow: ShadowRoot | HTMLElement): DOMRect | null {
  const view = (shadow as HTMLElement).ownerDocument?.defaultView
  const viewportArea = (view?.innerWidth ?? 0) * (view?.innerHeight ?? 0)

  let best: DOMRect | null = null
  shadow.querySelectorAll('*').forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 24 || rect.height < 24)
      return
    // A backdrop, not a panel
    if (viewportArea > 0 && rect.width * rect.height > viewportArea * 0.9)
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
  /** How long a repair is given to prove it held – see `confirmRepair`. */
  repairConfirmMs?: number
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

/** How long a repair is given to show that it held. */
const DEFAULT_REPAIR_CONFIRM_MS = 150

/**
 * Confirmation windows that may fail in a row before the page is called out.
 *
 * Three of them, so the whole verdict is reached inside half a second. The panel
 * is back on the page for nearly all of that – every window begins by putting it
 * back – so what this really bounds is how long a page can keep taking it away
 * again before it is named for it.
 */
const REPAIR_WINDOWS = 3

/**
 * Repairs allowed inside one window before the watch stops putting it back.
 *
 * A page can strike from inside a mutation observer of its own, which puts its
 * removal and our repair on the same microtask queue. Neither of them yields, so
 * the timer that would end the window never gets to run and the tab locks up –
 * the repair feeding the very loop it is trying to undo. So the repair gives up
 * for the rest of the window once a page has shown it is in a loop, which lets
 * the queue drain, and the window is what lets it try again afterwards.
 *
 * Well above what a page renders in one go. A router replaces its body once, or
 * twice where something hydrates over the top of it.
 */
const MAX_REPAIRS_PER_WINDOW = 5

export function createTamperWatch(options: TamperWatchOptions): TamperWatch {
  const { container, shadow, guardedNodes, onTamper, isSelfRemoving } = options
  const doc = container.ownerDocument
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastReportAt = 0
  /** An ancestor was found hiding us last time round – see `isHiddenByAncestor`. */
  let ancestorHidPreviously = false
  /** The confirmation window that is open, if one is – see `confirmRepair`. */
  let confirmTimer: ReturnType<typeof setTimeout> | null = null
  /** Structural losses seen since the open window began. */
  let strikesInWindow = 0
  /** Windows that ended with the panel still being fought over. */
  let failedWindows = 0
  /** What the last structural loss was, for when it comes to be reported. */
  let structuralReason: TamperReason = 'removed'

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
    let lost = false
    let othersRemoved = 0
    for (const mutation of mutations) {
      mutation.removedNodes.forEach((node) => {
        if (node === container || node.contains?.(container))
          lost = true
        else
          othersRemoved += 1
      })
    }

    // One repair for the batch, and the batch is also what says whether we were
    // singled out: a page clearing its body takes its own nodes with ours.
    if (lost)
      repairStructure('removed', othersRemoved === 0)
  })

  // Replacement of the body itself, which takes the container off the screen
  // without ever recording a removal on the node the body watch is attached to.
  // Nothing was removed from anything we watch, so the check is positional:
  // is the container still inside whatever body the document has now.
  const documentObserver = new MutationObserver(() => {
    // Never singled out: the page's whole body went, ours with it
    if (!isAttached())
      repairStructure('document-replaced', false)
  })

  // Rewriting or stripping the inline guard styles
  const attributeObserver = new MutationObserver(() => {
    if (stopped)
      return

    // Only the inline guard is repairable from here. Restoring it when the panel
    // is hidden by something else – a rule further up the tree – would put the
    // same styles back on every mutation the restore itself produces, forever.
    if (!isHostStyleIntact(container) || container.hasAttribute('hidden')) {
      // Put the panel back before saying anything: the warning is worth more
      // when the thing it is warning about is visible again.
      //
      // The restore below generates mutation records of its own, which arrive
      // as a later callback - a flag set and cleared inside this one cannot
      // suppress them, and one used to be here pretending to. What actually
      // ends it is that the next pass finds the styles intact and does nothing.
      applyHostStyles(container)
      container.removeAttribute('hidden')
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

  /**
   * Put the container back into whatever body the document has now.
   *
   * Nothing used to. The watch reported a body swap and then went blind, because
   * `bodyObserver` was left on a body that is no longer in the document – so the
   * first swap was the last thing it ever saw, and the panel was gone for the
   * rest of the visit with nothing to bring it back. Every panel lives inside
   * the container's shadow root, so moving the container is the whole repair and
   * the Vue app never notices it happened.
   */
  function reattach() {
    if (stopped || isSelfRemoving() || !doc.body)
      return

    if (!doc.body.contains(container))
      doc.body.appendChild(container)

    // Point at the body that is there now. Observing the same node twice is a
    // no-op, so an ordinary removal costs nothing here.
    bodyObserver.disconnect()
    bodyObserver.observe(doc.body, { childList: true })
  }

  /**
   * The container is off the page. Put it back, and work out whether that was
   * worth an alarm.
   *
   * Two questions, and neither of them is "where is the page". Asking the
   * address was the obvious way to tell a router apart from an attack, and it is
   * the wrong one: a page can change its address as often as it likes, so every
   * alarm was one `pushState` away from being suppressed.
   *
   * The first question is whether we were singled out. A site drawing its next
   * page throws its own body away and ours goes with it. Nothing reaches past a
   * page's own nodes to take out one injected element and leave the rest of the
   * page standing – that is not something a router has any reason to do, so it
   * is said at once.
   *
   * The second is asked of everything else, and it is the one that cannot be
   * talked out of: does the repair hold. A router removes the container once as
   * a side effect of work it has already finished, so the moment it is put back,
   * it stays back. A page that wants the panel gone has to keep taking it away,
   * because we keep putting it there – and having to keep doing it is exactly
   * what gives it away. That is what `confirmRepair` waits to see.
   */
  function repairStructure(reason: TamperReason, singledOut: boolean) {
    if (stopped || isSelfRemoving())
      return

    structuralReason = reason
    strikesInWindow += 1
    armConfirm()

    // Nothing is in any doubt by now – see `MAX_REPAIRS_PER_WINDOW` for why the
    // watch has to stop pushing back rather than keep winning the exchange
    if (strikesInWindow > MAX_REPAIRS_PER_WINDOW) {
      report(reason)
      return
    }

    reattach()

    if (singledOut)
      report(reason)
  }

  /**
   * Did the panel we just put back stay put?
   *
   * A window fails on either count: the container is not there at all, or it is
   * there only because it was put back more than once while the window was open.
   * Both mean somebody is still pulling at it.
   *
   * A single loss inside a window is deliberately not a failure. That is what an
   * ordinary navigation looks like, and it is also the shape of the one pattern
   * this cannot catch – a page taking the container out once every window, for
   * ever. It is not worth catching: the panel is on the page for all but a tick
   * of that, which is the whole thing the alarm is protecting.
   */
  function confirmRepair() {
    confirmTimer = null
    if (stopped || isSelfRemoving())
      return

    const held = isAttached() && strikesInWindow <= 1
    strikesInWindow = 0

    if (held) {
      failedWindows = 0
      return
    }

    reattach()
    failedWindows += 1
    if (failedWindows >= REPAIR_WINDOWS) {
      failedWindows = 0
      report(structuralReason)
      return
    }

    armConfirm()
  }

  function armConfirm() {
    if (confirmTimer === null)
      confirmTimer = setTimeout(confirmRepair, options.repairConfirmMs ?? DEFAULT_REPAIR_CONFIRM_MS)
  }

  function resetConfirm() {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer)
      confirmTimer = null
    }
    strikesInWindow = 0
    failedWindows = 0
  }

  function stopObservers() {
    resetConfirm()
    bodyObserver.disconnect()
    documentObserver.disconnect()
    attributeObserver.disconnect()
    shadowObserver.disconnect()
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  /**
   * Stop watching once the document is leaving, cache or no cache.
   *
   * A page put into the back-forward cache is frozen with the watch still armed.
   * Its repeat check and any mutation records it had queued are held, and then
   * all of them run at once on restore – against a document the browser is
   * bringing back and the content script is about to take apart and rebuild.
   * Every one of those looks exactly like the page hiding the panel, which is
   * why going back or forward raised an alarm that visiting the same site
   * directly never did. Nothing is left unguarded: the content script builds a
   * fresh watch when it remounts on a persisted `pageshow`.
   *
   * Only a trusted event counts. A page can dispatch a `pagehide` of its own,
   * and switching the watch off by asking it to would be the easiest way past
   * everything above.
   */
  function onPageHide(event: PageTransitionEvent) {
    if (event.isTrusted)
      stop()
  }

  function stop() {
    stopped = true
    stopObservers()
    doc.defaultView?.removeEventListener('pagehide', onPageHide, true)
  }

  doc.defaultView?.addEventListener('pagehide', onPageHide, true)

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

        // Nothing to judge in a document nobody is looking at. A hidden tab is
        // not laid out, so the rect and the hit test below answer from whatever
        // was left over rather than from the screen, and a tab backgrounded with
        // a panel open reported itself hidden or covered on that. The observers
        // above carry on either way, so removal and a rewritten style attribute
        // are still caught here. The ancestor count starts again from nothing
        // when the tab comes back, because a reading taken before it went away
        // is not a sighting of anything.
        if (doc.visibilityState === 'hidden') {
          ancestorHidPreviously = false
          return
        }

        // Asked first, and separately, because nothing below can be judged of a
        // container that is not in the document: there are no ancestors to walk
        // and no rect to measure. It also has to go through the repair rather
        // than be reported, or a loss the observers somehow missed would be
        // announced once a second and never put right.
        // Nothing here says how the container came to be gone, so this cannot
        // claim it was singled out and goes the patient way round
        const structural = checkStructure()
        if (structural) {
          repairStructure(structural, false)
          return
        }

        // Believed only on the second sighting: a page fading its body in, or
        // holding it hidden until a web font loads, looks exactly like this for
        // a moment and is not tampering with anything
        const ancestorHides = isHiddenByAncestor(container)
        const ancestorConfirmed = ancestorHides && ancestorHidPreviously
        ancestorHidPreviously = ancestorHides

        const problem = checkAppearance()
          ?? (ancestorConfirmed ? 'hidden' : null)
          ?? (isPanelOffScreen(container, shadow) ? 'hidden' : null)
          ?? (findCoveringElement(container, shadow) ? 'covered' : null)
        if (problem)
          report(problem)
      }
      check()
      timer = setInterval(check, options.visibleCheckInterval ?? DEFAULT_VISIBLE_CHECK_INTERVAL)
    },
    verify,
    stop,
  }
}
