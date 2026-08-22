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
 * Is this the Android build of the browser?
 *
 * Asked of the browser, not guessed from the pointer: the two disagree on a
 * phone with a mouse attached, and what this decides is wording rather than
 * capability. Used where the same feature is real on both but reached
 * differently – the extension icon is on a toolbar on desktop and inside the
 * browser's menu here, so telling an Android user to pin it is an instruction
 * with nothing to follow.
 */
export async function isAndroidBrowser(): Promise<boolean> {
  try {
    const info = await browser.runtime.getPlatformInfo()
    return info?.os === 'android'
  }
  catch {
    return false
  }
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
 *
 * The two are not the same question, which is why `canUseContextMenus` is asked
 * separately. Right-clicking needs a menu to put the item in, and Firefox for
 * Android has no menus API however good the pointer is – so a phone with a
 * Bluetooth mouse answers yes to hover and still cannot do it. Left as one
 * question, that device kept `click-right` and the link check never fired
 * again, with nothing on screen to explain it.
 *
 * A content script cannot answer the second one: the menus namespace is not
 * exposed to it on any platform. It asks the background, and until the answer
 * arrives the safe assumption is no – a trigger that fires too eagerly is
 * recoverable, one that never fires is not.
 */
export function resolveTooltipTrigger(trigger: TooltipTrigger, canUseContextMenus = false): TooltipTrigger {
  if (!supportsHover())
    return 'click-left'
  if (trigger === 'click-right' && !canUseContextMenus)
    return 'click-left'
  return trigger
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
