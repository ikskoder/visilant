import { describe, expect, it } from 'vitest'
import { viewportCoverStyle } from '../useVisualViewport'

describe('viewportCoverStyle', () => {
  it('is inset 0 on a desktop at rest', () => {
    const style = viewportCoverStyle({ offsetLeft: 0, offsetTop: 0, width: 1280, height: 720, scale: 1 })
    expect(style).toMatchObject({
      'top': '0px',
      'left': '0px',
      'width': '1280px',
      'height': '720px',
      'scale': '1',
      '--vz-vw': '1280px',
      '--vz-vh': '720px',
    })
  })

  // Measured on Firefox 157 for Android: httpbin.org/forms/post has no mobile
  // viewport, so it is laid out 980px wide, and a focused field zooms the
  // screen in on a 408px slice above the keyboard
  it('follows the slice of a zoomed page that is on the screen', () => {
    const style = viewportCoverStyle({ offsetLeft: 9.67, offsetTop: 0, width: 408, height: 459, scale: 1 })
    expect(style).toMatchObject({ left: '9.67px', top: '0px', width: '408px', height: '459px', scale: '1' })
  })

  it('draws at the device\'s own size on a page drawn zoomed out', () => {
    const scale = 408 / 980
    const style = viewportCoverStyle({ offsetLeft: 0, offsetTop: 0, width: 980, height: 1927, scale })
    // The box is sized in screen pixels and scaled back into the page's
    expect(Number.parseFloat(String(style.width))).toBeCloseTo(408)
    expect(Number.parseFloat(String(style['--vz-vw' as keyof typeof style]))).toBeCloseTo(408)
    expect(Number(style.scale)).toBeCloseTo(980 / 408)
    expect(style.transformOrigin).toBe('0 0')
  })

  it('does not divide by a scale of zero', () => {
    const style = viewportCoverStyle({ offsetLeft: 0, offsetTop: 0, width: 800, height: 600, scale: 0 })
    expect(style.scale).toBe('1')
    expect(style.width).toBe('800px')
  })
})
