/**
 * Every case here started as a proof that the previous watch missed it. The
 * control case has to keep passing for the rest to mean anything: if plain
 * removal ever stops being caught, the others are testing nothing.
 */
import type { TamperReason } from '../tamper-watch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHostStyles, createTamperWatch, HOST_STYLES, isHostStyleIntact, isVisuallyHidden } from '../tamper-watch'

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

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
    return createTamperWatch({
      container: parts.container,
      shadow: parts.shadow,
      guardedNodes: [parts.root, parts.styleEl],
      onTamper,
      isSelfRemoving: () => selfRemoving,
    })
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

  it('catches the document body being replaced under it', async () => {
    const parts = mountContainer()
    watch(parts)

    document.documentElement.replaceChild(document.createElement('body'), document.body)
    await settle()

    expect(onTamper).toHaveBeenCalledWith('document-replaced')
  })

  it('catches the whole document element being wiped', async () => {
    const parts = mountContainer()
    watch(parts)

    document.documentElement.innerHTML = '<head></head><body>gone</body>'
    await settle()

    expect(onTamper).toHaveBeenCalledWith('document-replaced')
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
    return createTamperWatch({
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
