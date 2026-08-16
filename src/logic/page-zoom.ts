/**
 * Keeping the browser's zoom on our own pages away from the popup.
 *
 * Chrome stores a zoom factor per origin, and every page of an extension shares
 * one origin. Pressing Ctrl+ on the settings page therefore zooms the action
 * popup as well, which is not a size change so much as a layout accident: the
 * popup is a fixed-width column in a window the browser sizes for it.
 *
 * The fix is to put our tabs on a per-tab zoom scope. The browser then resets
 * that zoom on every navigation, so the factor is remembered here and put back
 * when the page opens. Kept out of the synced settings on purpose, since the
 * comfortable zoom on a laptop is not the comfortable zoom on a desktop.
 */

export const PAGE_ZOOM_KEY = '__visilantPageZoom'

const DEFAULT_ZOOM = 1
/** Zoom factors come back as floats, so they are compared with a tolerance. */
const EPSILON = 0.001

export function isDefaultZoom(factor: number): boolean {
  return Math.abs(factor - DEFAULT_ZOOM) < EPSILON
}

export interface ZoomIsolationPlan {
  /** Factor to store as ours, taken over from the origin. Null when nothing to take. */
  adopt: number | null
  /** Reset the origin's factor, which is what the popup has been inheriting. */
  clearOrigin: boolean
  /** Factor this tab should end up at. */
  apply: number
}

export function planZoomIsolation(state: {
  scope: string
  currentFactor: number
  remembered?: number
}): ZoomIsolationPlan {
  // Only a per-origin scope can be holding a factor the popup picks up
  const originHoldsZoom = state.scope === 'per-origin' && !isDefaultZoom(state.currentFactor)

  // A zoom set before any of this existed is still the user's own choice, so it
  // is carried over rather than thrown away. Only when nothing is remembered
  // yet, or reopening a page would keep resurrecting an old factor.
  const adopt = originHoldsZoom && state.remembered === undefined ? state.currentFactor : null

  return {
    adopt,
    clearOrigin: originHoldsZoom,
    apply: state.remembered ?? adopt ?? DEFAULT_ZOOM,
  }
}

/**
 * Run on any extension page that opens as a tab. In the action popup this does
 * nothing, because a popup is not a tab and has no zoom of its own to set.
 */
export async function isolatePageZoom(): Promise<void> {
  try {
    const tab = await browser.tabs.getCurrent()
    if (!tab?.id)
      return

    const tabId = tab.id
    const [zoomSettings, stored, currentFactor] = await Promise.all([
      browser.tabs.getZoomSettings(tabId),
      browser.storage.local.get(PAGE_ZOOM_KEY),
      browser.tabs.getZoom(tabId),
    ])

    const rememberedValue = stored[PAGE_ZOOM_KEY]
    const plan = planZoomIsolation({
      scope: zoomSettings.scope ?? 'per-origin',
      currentFactor,
      remembered: typeof rememberedValue === 'number' ? rememberedValue : undefined,
    })

    if (plan.adopt !== null)
      await browser.storage.local.set({ [PAGE_ZOOM_KEY]: plan.adopt })

    // Cleared while the scope still reaches the origin. Afterwards this tab can
    // no longer touch it, and the popup would go on inheriting the old factor.
    if (plan.clearOrigin)
      await browser.tabs.setZoom(tabId, DEFAULT_ZOOM)

    await browser.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' })

    if (!isDefaultZoom(plan.apply))
      await browser.tabs.setZoom(tabId, plan.apply)

    // Registered last. Everything above is our own doing, and recording what we
    // just set would overwrite the very factor being restored.
    browser.tabs.onZoomChange.addListener((info) => {
      if (info.tabId === tabId)
        browser.storage.local.set({ [PAGE_ZOOM_KEY]: info.newZoomFactor })
    })
  }
  catch {
    // Zoom is a comfort setting. If the browser will not play along, the page
    // still works, it just shares the origin's zoom the way it always did.
  }
}
