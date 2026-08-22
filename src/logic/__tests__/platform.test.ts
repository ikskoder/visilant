import { afterEach, describe, expect, it, vi } from 'vitest'
import browser from 'webextension-polyfill'
import { hasContextMenus, hasHistoryApi, isAndroidBrowser, resolveTooltipTrigger, supportsHover } from '../platform'

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

describe('isAndroidBrowser', () => {
  const platform = browser.runtime.getPlatformInfo as ReturnType<typeof vi.fn>

  it('reads the browser own answer', async () => {
    platform.mockResolvedValueOnce({ os: 'android', arch: 'aarch64' })
    await expect(isAndroidBrowser()).resolves.toBe(true)

    platform.mockResolvedValueOnce({ os: 'linux', arch: 'x86-64' })
    await expect(isAndroidBrowser()).resolves.toBe(false)
  })

  // What this decides is wording, so a browser that will not answer is better
  // treated as the desktop it probably is than left to throw
  it('says no where the question cannot be asked', async () => {
    platform.mockRejectedValueOnce(new Error('nope'))
    await expect(isAndroidBrowser()).resolves.toBe(false)
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
  it('leaves the choice alone on a hovering pointer with a menus API', () => {
    stubHover(true)
    expect(resolveTooltipTrigger('hover', true)).toBe('hover')
    expect(resolveTooltipTrigger('click-right', true)).toBe('click-right')
    expect(resolveTooltipTrigger('click-left', true)).toBe('click-left')
  })

  it('falls back to the tap on a touchscreen, where neither of the others can fire', () => {
    stubHover(false)
    expect(resolveTooltipTrigger('hover', true)).toBe('click-left')
    expect(resolveTooltipTrigger('click-right', true)).toBe('click-left')
    expect(resolveTooltipTrigger('click-left', true)).toBe('click-left')
  })

  // A phone with a Bluetooth mouse: the pointer can hover, and Firefox for
  // Android still has nowhere to put a menu item. Answered as one question,
  // this device kept a right-click trigger that could never fire again.
  it('falls back to the tap for a right click the browser has no menu for', () => {
    stubHover(true)
    expect(resolveTooltipTrigger('click-right', false)).toBe('click-left')
    // The other two do not depend on the menus API and are left alone
    expect(resolveTooltipTrigger('hover', false)).toBe('hover')
    expect(resolveTooltipTrigger('click-left', false)).toBe('click-left')
  })

  // The content script is never handed the menus namespace, so it starts from
  // no and asks the background. Silence is the one failure this must not have.
  it('assumes there is no menu until told otherwise', () => {
    stubHover(true)
    expect(resolveTooltipTrigger('click-right')).toBe('click-left')
  })
})
