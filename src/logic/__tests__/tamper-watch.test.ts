/**
 * Every case here started as a proof that the previous watch missed it. The
 * control case has to keep passing for the rest to mean anything: if plain
 * removal ever stops being caught, the others are testing nothing.
 */
import type { TamperReason, TamperWatch, TamperWatchOptions } from '../tamper-watch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHostStyles, createTamperWatch, HOST_STYLES, isHiddenByAncestor, isHostStyleIntact, isVisuallyHidden } from '../tamper-watch'

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** The confirmation window every watch here is built with. */
const CONFIRM_MS = 5

/**
 * Every watch made here, so `afterEach` can put it down.
 *
 * A watch left running keeps its observers on `document.documentElement`, which
 * survives the reset between cases – so it went on reporting into the previous
 * case's mock, and was still repairing a container out of a window jsdom had
 * already taken apart.
 */
const live: TamperWatch[] = []

function makeWatch(options: TamperWatchOptions): TamperWatch {
  const w = createTamperWatch(options)
  live.push(w)
  return w
}

afterEach(() => {
  live.splice(0).forEach(w => w.stop())
})

function mountContainer() {
  const container = document.createElement('div')
  applyHostStyles(container)
  const shadow = document.createElement('div')
  const root = document.createElement('div')
  const styleEl = document.createElement('style')
  shadow.appendChild(styleEl)
  shadow.appendChild(root)
  container.appendChild(shadow)
  document.body.appendChild(container)
  return { container, shadow, root, styleEl }
}

describe('tamperWatch', () => {
  let onTamper: (reason: TamperReason) => void
  let selfRemoving: boolean

  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>'
    onTamper = vi.fn()
    selfRemoving = false
  })

  function watch(parts: ReturnType<typeof mountContainer>) {
    return makeWatch({
      container: parts.container,
      shadow: parts.shadow,
      guardedNodes: [parts.root, parts.styleEl],
      onTamper,
      isSelfRemoving: () => selfRemoving,
      // Short enough to run in real time. The logic counts windows, not
      // milliseconds, so the length of one changes nothing it decides.
      repairConfirmMs: CONFIRM_MS,
    })
  }

  /** Let one confirmation window open and close. */
  function confirmWindow() {
    return new Promise(resolve => setTimeout(resolve, CONFIRM_MS * 2))
  }

  /** Long enough for every window the watch is willing to give. */
  function allWindows() {
    return new Promise(resolve => setTimeout(resolve, CONFIRM_MS * 10))
  }

  /**
   * A page that will not have the container on it.
   *
   * Every time the repair puts it back, this takes it away again – and takes a
   * node of its own along, so it never looks like the singled-out case and has
   * to be caught the patient way, by the repair failing to hold. This is the
   * shape of a page that actually means it, as opposed to a router, which
   * removes the container once and then leaves it alone.
   */
  function keepsFighting(container: HTMLElement, strike: () => void) {
    // The watch is what has to end this exchange, by giving up on the repair
    // once the page is clearly in a loop. The budget is only here so a watch
    // that stops doing that fails the run instead of hanging it.
    let budget = 500
    const enemy = new MutationObserver(() => {
      if (budget > 0 && document.body?.contains(container)) {
        budget -= 1
        strike()
      }
    })
    enemy.observe(document.documentElement, { childList: true, subtree: true })
    return () => enemy.disconnect()
  }

  it('control: catches the container being removed', async () => {
    const parts = mountContainer()
    watch(parts)

    parts.container.remove()
    await settle()

    expect(onTamper).toHaveBeenCalledWith('removed')
  })

  it('catches the style attribute being rewritten to hide the host', async () => {
    const parts = mountContainer()
    watch(parts)

    parts.container.setAttribute('style', 'display: none !important')
    await settle()

    expect(onTamper).toHaveBeenCalledWith('hidden')
  })

  it('puts the guard styles back when the page strips them', async () => {
    const parts = mountContainer()
    watch(parts)

    parts.container.removeAttribute('style')
    await settle()

    expect(onTamper).toHaveBeenCalledWith('hidden')
    // Reported and repaired: a warning about a panel nobody can see is worth less
    expect(isHostStyleIntact(parts.container)).toBe(true)
  })

  it('catches a body that is replaced out from under it over and over', async () => {
    const parts = mountContainer()
    watch(parts)
    const done = keepsFighting(parts.container, () => {
      document.documentElement.replaceChild(document.createElement('body'), document.body)
    })

    document.documentElement.replaceChild(document.createElement('body'), document.body)
    await allWindows()
    done()

    expect(onTamper).toHaveBeenCalledWith('document-replaced')
  })

  it('catches a body that is cleared and cleared again', async () => {
    const parts = mountContainer()
    watch(parts)
    const done = keepsFighting(parts.container, () => {
      document.body.innerHTML = '<p></p>'
    })

    document.body.appendChild(document.createElement('p'))
    document.body.innerHTML = '<p></p>'
    await allWindows()
    done()

    expect(onTamper).toHaveBeenCalledWith('removed')
  })

  // Between the two ways of being caught there is a rate that is neither: too
  // steady to be a router, too slow to be the loop the burst cap ends. This is
  // the band the confirmation windows are for, and the only thing that shows it
  // is that the panel never gets to stay where it was put.
  it('catches a page keeping at it below the burst cap', async () => {
    // A long window on purpose. This is the one test here whose page strikes on
    // a timer rather than from a mutation, so it is the one that has to survive
    // the scheduler being busy with the rest of the suite. The window has to
    // stay wide enough that jitter cannot drop it to a single strike, which is
    // the count that would let the window be scored as held.
    const slow = 60
    const parts = mountContainer()
    makeWatch({
      container: parts.container,
      shadow: parts.shadow,
      guardedNodes: [parts.root, parts.styleEl],
      onTamper,
      isSelfRemoving: () => selfRemoving,
      repairConfirmMs: slow,
    })
    document.body.appendChild(document.createElement('p'))

    // Three strikes to a window – above the one that would count as held, well
    // under the five that end it as a burst. The page's own node goes each time,
    // so none of them is the singled-out case either.
    const beat = setInterval(() => {
      document.body.innerHTML = '<p></p>'
    }, slow / 3)
    await new Promise(resolve => setTimeout(resolve, slow * 6))
    clearInterval(beat)

    expect(onTamper).toHaveBeenCalledWith('removed')
  })

  it('catches the shadow tree being gutted', async () => {
    const parts = mountContainer()
    watch(parts)

    parts.root.remove()
    await settle()

    expect(onTamper).toHaveBeenCalledWith('shadow-stripped')
  })

  it('stays quiet while the extension takes its own UI down', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    selfRemoving = true
    w.stop()
    parts.container.remove()
    await settle()

    expect(onTamper).not.toHaveBeenCalled()
  })

  it('reports once and then stops, rather than looping on the same page', async () => {
    const parts = mountContainer()
    watch(parts)

    parts.container.setAttribute('style', 'display: none !important')
    await settle()
    parts.container.remove()
    await settle()

    expect(onTamper).toHaveBeenCalledTimes(1)
  })

  it('stops on browser pagehide and protects a fresh restored mount', async () => {
    const spy = vi.spyOn(window, 'addEventListener')
    const parts = mountContainer()
    const w = watch(parts)
    const handler = spy.mock.calls.find(([type]) => type === 'pagehide')![1] as EventListener
    spy.mockRestore()
    handler({ isTrusted: true, persisted: true } as PageTransitionEvent)
    parts.container.remove()
    await settle()
    expect(onTamper).not.toHaveBeenCalled()
    w.stop()

    const restored = mountContainer()
    const next = watch(restored)
    restored.container.remove()
    await settle()
    expect(onTamper).toHaveBeenCalledWith('removed')
    next.stop()
  })

  it('ignores synthetic pagehide events', async () => {
    const parts = mountContainer()
    const w = watch(parts)
    window.dispatchEvent(new Event('pagehide'))
    parts.container.remove()
    await settle()
    expect(onTamper).toHaveBeenCalledWith('removed')
    w.stop()
  })

  it('defers visual checks until the document is visible', () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const parts = mountContainer()
    const w = watch(parts)
    try {
      document.body.style.opacity = '0'
      visibility.mockReturnValue('hidden')
      w.setUiVisible(true)
      vi.advanceTimersByTime(3000)
      expect(onTamper).not.toHaveBeenCalled()
      visibility.mockReturnValue('visible')
      vi.advanceTimersByTime(3000)
      expect(onTamper).toHaveBeenCalledWith('hidden')
    }
    finally {
      w.stop()
      visibility.mockRestore()
      vi.useRealTimers()
    }
  })

  it('puts the container back into the body it was taken out of', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    parts.container.remove()
    await settle()

    expect(onTamper).toHaveBeenCalledWith('removed')
    // Reported and repaired, the same way a stripped style attribute is
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  it('puts the container into the new body after a swap, and keeps watching it', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    document.documentElement.replaceChild(document.createElement('body'), document.body)
    await settle()
    expect(document.body.contains(parts.container)).toBe(true)

    // The watch used to be left observing the body that had just been thrown
    // away, so nothing the page did to the new one was ever seen again. A plain
    // removal is the proof: only the body watch catches that, and it has to be
    // on the body the container is in now for this to be caught at all.
    document.body.removeChild(parts.container)
    await settle()
    expect(onTamper).toHaveBeenCalledWith('removed')
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  // The false alarm all of this exists for: going back or forward on a site that
  // draws its own pages swaps the body for the one belonging to the new route,
  // and our container goes with it
  it('stays quiet when a body swap lets the repair stand', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    document.documentElement.replaceChild(document.createElement('body'), document.body)
    await settle()
    await confirmWindow()

    expect(onTamper).not.toHaveBeenCalled()
    // Quiet, but never absent: the panel is back on the page the router drew
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  it('allows a route that renders itself twice over', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    // One window with two losses in it, which a framework hydrating over its own
    // first render produces. A single bad window is not a verdict.
    document.documentElement.replaceChild(document.createElement('body'), document.body)
    await settle()
    document.documentElement.replaceChild(document.createElement('body'), document.body)
    await settle()
    await allWindows()

    expect(onTamper).not.toHaveBeenCalled()
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  it('stays quiet through a run of navigations, however fast they come', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    // Somebody leaning on the back button. Each one is a single loss that the
    // repair survives, which is the whole difference from the case above.
    for (let i = 0; i < 10; i++) {
      document.documentElement.replaceChild(document.createElement('body'), document.body)
      await settle()
      await confirmWindow()
    }

    expect(onTamper).not.toHaveBeenCalled()
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  it('will not be quietened by a page that changes its address first', async () => {
    const parts = mountContainer()
    const w = watch(parts)
    // Changing the address used to buy a page one silent removal, and it could
    // change the address as often as it liked. Nothing reads it any more.
    const done = keepsFighting(parts.container, () => {
      history.pushState({}, '', `/route-${Date.now()}`)
      document.body.innerHTML = '<p></p>'
    })

    history.pushState({}, '', '/route-first')
    document.body.appendChild(document.createElement('p'))
    document.body.innerHTML = '<p></p>'
    await allWindows()
    done()

    expect(onTamper).toHaveBeenCalledWith('removed')
    w.stop()
  })

  it('says so at once when the container alone is picked out of a full body', async () => {
    const parts = mountContainer()
    const w = watch(parts)
    document.body.appendChild(document.createElement('p'))

    // No router reaches past a page's own nodes for one injected element, so
    // this one does not get the benefit of the doubt
    parts.container.remove()
    await settle()

    expect(onTamper).toHaveBeenCalledWith('removed')
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  it('gives the benefit of the doubt to a body cleared of everything', async () => {
    const parts = mountContainer()
    const w = watch(parts)
    document.body.appendChild(document.createElement('p'))

    // Our container went, but so did the page's own – this is a render, not aim
    document.body.innerHTML = ''
    await settle()
    await confirmWindow()

    expect(onTamper).not.toHaveBeenCalled()
    expect(document.body.contains(parts.container)).toBe(true)
    w.stop()
  })

  it('does not repair while the extension is taking its own UI down', async () => {
    const parts = mountContainer()
    const w = watch(parts)

    selfRemoving = true
    parts.container.remove()
    await settle()

    expect(onTamper).not.toHaveBeenCalled()
    expect(document.body.contains(parts.container)).toBe(false)
    w.stop()
  })

  it('verify() reports the current state without waiting for a mutation', () => {
    const parts = mountContainer()
    const w = watch(parts)

    expect(w.verify()).toBeNull()
    parts.container.remove()
    expect(w.verify()).toBe('removed')
  })
})

describe('host style checks', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>'
  })

  it('accepts the styles it applies itself', () => {
    const el = document.createElement('div')
    applyHostStyles(el)
    expect(isHostStyleIntact(el)).toBe(true)
    expect(isVisuallyHidden(el)).toBe(false)
  })

  it('rejects a guard property that lost its important flag', () => {
    const el = document.createElement('div')
    applyHostStyles(el)
    // A page can re-declare the property without the flag, which drops the
    // protection while leaving the value looking right
    el.style.setProperty('display', 'block')
    expect(isHostStyleIntact(el)).toBe(false)
  })

  it('sees through display, visibility and opacity', () => {
    for (const [prop, value] of [['display', 'none'], ['visibility', 'hidden'], ['opacity', '0']]) {
      const el = document.createElement('div')
      applyHostStyles(el)
      document.body.appendChild(el)
      el.style.setProperty(prop, value, 'important')
      expect(isVisuallyHidden(el), `${prop}: ${value}`).toBe(true)
    }
  })

  it('treats the hidden attribute as hiding', () => {
    const el = document.createElement('div')
    applyHostStyles(el)
    el.setAttribute('hidden', '')
    expect(isHostStyleIntact(el)).toBe(false)
  })
})

describe('the ways a page can hide a panel without hiding it', () => {
  // Every property here neutralises the panel without touching `display`,
  // `visibility` or `opacity` – which used to be the whole check. They are held
  // at their neutral value by an inline `!important`, so the page has to strip
  // the guard to use any of them, and stripping it is what gets caught.
  it.each([
    'transform',
    'filter',
    'clip-path',
    'content-visibility',
    'contain',
    'translate',
    'scale',
    'rotate',
  ])('pins %s, so a page rule cannot reach the host', (prop) => {
    expect(Object.keys(HOST_STYLES)).toContain(prop)
  })

  it('reads an unset opacity as unset rather than as invisible', () => {
    // `Number('')` is 0. Reading a property the engine has no answer for as a
    // deliberate zero declares every page on the web to be hiding the panel.
    const container = document.createElement('div')
    applyHostStyles(container)
    document.body.appendChild(container)

    expect(isVisuallyHidden(container)).toBe(false)
  })
})

describe('the watch after it has said something', () => {
  let onTamper: (reason: TamperReason) => void

  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>'
    onTamper = vi.fn()
  })

  function watchWith(container: HTMLElement, shadow: HTMLElement) {
    return makeWatch({
      container,
      shadow,
      guardedNodes: [],
      onTamper,
      isSelfRemoving: () => false,
    })
  }

  // The first report used to be the last: the watch shut itself down, so a page
  // only had to trip it once to be left alone for the rest of the visit
  it('keeps repairing the guard after the first report', async () => {
    const container = document.createElement('div')
    applyHostStyles(container)
    const shadow = document.createElement('div')
    container.appendChild(shadow)
    document.body.appendChild(container)
    watchWith(container, shadow)

    container.removeAttribute('style')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onTamper).toHaveBeenCalledWith('hidden')
    expect(isHostStyleIntact(container)).toBe(true)

    // Second strike, well after the first
    container.setAttribute('style', 'display:none')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(isHostStyleIntact(container)).toBe(true)
  })
})

describe('what an ordinary page does on its way in', () => {
  // Both of these are everywhere: a theme that fades the body in on load, and
  // the web-font guard that hides the body until the face arrives. Read once at
  // mount time, they raised the alarm on a large part of the web.
  it('does not read a fading-in body as tampering', () => {
    document.documentElement.innerHTML = '<head></head><body style="opacity: 0"></body>'
    const container = document.createElement('div')
    applyHostStyles(container)
    document.body.appendChild(container)

    // The check that runs at mount time says nothing about the ancestors
    expect(isVisuallyHidden(container)).toBe(false)
    // The slow repeat check sees it, and only believes it the second time round
    expect(isHiddenByAncestor(container)).toBe(true)
  })

  it('still sees the panel own styles being taken away', () => {
    document.documentElement.innerHTML = '<head></head><body></body>'
    const container = document.createElement('div')
    applyHostStyles(container)
    document.body.appendChild(container)
    expect(isHostStyleIntact(container)).toBe(true)

    container.removeAttribute('style')
    expect(isHostStyleIntact(container)).toBe(false)
  })
})
