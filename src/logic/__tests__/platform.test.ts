import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasContextMenus, hasHistoryApi, resolveTooltipTrigger, supportsHover } from '../platform'

/** Answer `(hover: hover)` the way a mouse or a touchscreen would. */
function stubHover(canHover: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('hover: hover') ? canHover : !canHover,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser capabilities', () => {
  it('sees the menus API the mocked browser provides', () => {
    expect(hasContextMenus()).toBe(true)
  })

  it('reports a missing history API rather than throwing on it', () => {
    // The mocked browser has no history namespace, which is also what Firefox
    // for Android hands out
    expect(hasHistoryApi()).toBe(false)
  })
})

describe('supportsHover', () => {
  it('follows the media query', () => {
    stubHover(true)
    expect(supportsHover()).toBe(true)

    stubHover(false)
    expect(supportsHover()).toBe(false)
  })

  it('assumes a hovering pointer where the query cannot be asked', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(supportsHover()).toBe(true)
  })
})

describe('resolveTooltipTrigger', () => {
  it('leaves the choice alone on a hovering pointer', () => {
    stubHover(true)
    expect(resolveTooltipTrigger('hover')).toBe('hover')
    expect(resolveTooltipTrigger('click-right')).toBe('click-right')
    expect(resolveTooltipTrigger('click-left')).toBe('click-left')
  })

  it('falls back to the tap on a touchscreen, where neither of the others can fire', () => {
    stubHover(false)
    expect(resolveTooltipTrigger('hover')).toBe('click-left')
    expect(resolveTooltipTrigger('click-right')).toBe('click-left')
    expect(resolveTooltipTrigger('click-left')).toBe('click-left')
  })
})
