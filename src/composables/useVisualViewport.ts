import type { CSSProperties } from 'vue'
import { onScopeDispose, ref, watch } from 'vue'

/** The part of the page that is on the screen, in the page's CSS pixels. */
export interface ViewportBox {
  offsetLeft: number
  offsetTop: number
  width: number
  height: number
  /** Screen pixels per page pixel, relative to the device's ideal width. */
  scale: number
}

/**
 * Where a surface goes so that it covers what the user can actually see.
 *
 * `position: fixed` places a box in the layout viewport, and on a phone that is
 * not the screen. A page with no mobile viewport is laid out 980px wide and
 * drawn zoomed out, and when a field takes the focus Firefox for Android zooms
 * in on it: the screen then shows a 408px slice of the page, and a warning
 * pinned to the top right corner of the 980px sat off the edge, unseen, at the
 * one moment it was raised for. Measured on Firefox 157.
 *
 * So the box is laid over the visual viewport instead, and drawn at the size
 * the device would draw it at on a page made for it: sized in screen pixels,
 * then scaled by `1 / scale` back into page pixels. Zoomed out, the dialog is
 * no longer a postage stamp. Zoomed in, it no longer runs off the screen. On a
 * desktop at rest the numbers are those of `inset: 0`.
 *
 * `--vz-vw` and `--vz-vh` are the box's size in its own pixels, for the cards
 * inside it to measure themselves against in place of `100vw` and `100dvh`,
 * which still mean the layout viewport.
 *
 * The standalone `scale` property rather than `transform`, which the typing
 * warning's fade in and out already uses on this same box for its 8px lift.
 *
 * It follows the screen one frame late. While a zoomed page is panned the
 * browser moves the picture first, so a surface drifts with the page for a
 * frame and settles back.
 */
export function viewportCoverStyle(box: ViewportBox): CSSProperties {
  const scale = box.scale > 0 ? box.scale : 1
  const width = box.width * scale
  const height = box.height * scale
  return {
    'position': 'fixed',
    'top': `${box.offsetTop}px`,
    'left': `${box.offsetLeft}px`,
    'right': 'auto',
    'bottom': 'auto',
    'width': `${width}px`,
    'height': `${height}px`,
    'scale': `${1 / scale}`,
    'transformOrigin': '0 0',
    '--vz-vw': `${width}px`,
    '--vz-vh': `${height}px`,
  }
}

function measure(view: Window): ViewportBox {
  const visual = view.visualViewport
  if (!visual)
    return { offsetLeft: 0, offsetTop: 0, width: view.innerWidth, height: view.innerHeight, scale: 1 }
  return {
    offsetLeft: visual.offsetLeft,
    offsetTop: visual.offsetTop,
    width: visual.width,
    height: visual.height,
    scale: visual.scale,
  }
}

/**
 * The cover style for a surface, kept current while it is on screen.
 *
 * Listens only while `active` is true: panning a zoomed page fires `scroll`
 * on every frame, and nothing needs to hear it while no surface is up. The
 * events are folded into one measurement per frame. The numbers are read from
 * the browser each time, so an event the page dispatches itself only costs a
 * measurement.
 */
export function useVisualViewport(active: () => boolean) {
  const view = window
  const style = ref<CSSProperties>(viewportCoverStyle(measure(view)))
  let frame = 0
  let stop: (() => void) | null = null

  const update = () => {
    frame = 0
    style.value = viewportCoverStyle(measure(view))
  }
  const schedule = () => {
    if (!frame)
      frame = view.requestAnimationFrame(update)
  }

  function start() {
    const target: EventTarget = view.visualViewport ?? view
    target.addEventListener('resize', schedule)
    target.addEventListener('scroll', schedule)
    update()
    stop = () => {
      target.removeEventListener('resize', schedule)
      target.removeEventListener('scroll', schedule)
      if (frame)
        view.cancelAnimationFrame(frame)
      frame = 0
    }
  }

  watch(active, (on) => {
    stop?.()
    stop = null
    if (on)
      start()
  }, { immediate: true })

  onScopeDispose(() => {
    stop?.()
    stop = null
  })

  return style
}
