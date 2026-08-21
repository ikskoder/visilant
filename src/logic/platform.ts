import type { TooltipTrigger } from './storage'

/**
 * What the browser running this build actually implements.
 *
 * Firefox for Android ships neither the menus API nor the history API, and the
 * same Firefox build is what runs there, so the build flavour cannot answer
 * this – only the browser can. A missing namespace is a plain `undefined`, so
 * reading through it throws, and a throw at the top level of the background
 * script takes down every listener registered below it as well.
 */

/** Context menus: present on desktop Firefox and on Chrome, absent on Firefox for Android. */
export function hasContextMenus(): boolean {
  return typeof browser.contextMenus?.create === 'function'
}

/** Reading the browser history: absent on Firefox for Android, so there is nothing to import there. */
export function hasHistoryApi(): boolean {
  return typeof browser.history?.search === 'function'
}

/**
 * Can the pointer rest on something without pressing it?
 *
 * A mouse and a trackpad can, a touchscreen cannot. Asked of the pointer rather
 * than of the browser, because a phone browser and a laptop browser are the
 * same build.
 */
export function supportsHover(): boolean {
  return window.matchMedia?.('(hover: hover)').matches ?? true
}

/**
 * The link-check trigger that can actually fire on this device.
 *
 * Hovering and right-clicking are both gone on a touchscreen, so either setting
 * would leave the link check quietly doing nothing – the worst outcome for a
 * feature whose whole job is to interrupt. The tap is the only moment left to
 * intervene at, which is exactly what the click-left trigger intervenes at.
 */
export function resolveTooltipTrigger(trigger: TooltipTrigger): TooltipTrigger {
  return supportsHover() ? trigger : 'click-left'
}

/**
 * The widest the popup may lay itself out, in CSS pixels.
 *
 * Measured against the screen, never the viewport. A desktop popup window sizes
 * itself to the document, so `100vw` there is the width the document has just
 * asked for: the two chase each other down and the dashboard collapses to the
 * minimum. The screen does not move, and on a phone – where the popup is a
 * panel the full width of the display – it is exactly the cap that is needed.
 */
export function popupWidthCap(): number {
  return window.screen?.width || Number.POSITIVE_INFINITY
}
