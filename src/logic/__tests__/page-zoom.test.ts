import { describe, expect, it } from 'vitest'
import { isDefaultZoom, planZoomIsolation } from '../page-zoom'

describe('planZoomIsolation', () => {
  it('takes over a zoom the user had already set on the origin', () => {
    const plan = planZoomIsolation({ scope: 'per-origin', currentFactor: 1.3 })

    expect(plan.adopt).toBe(1.3)
    // Cleared at the origin, or the popup keeps inheriting it forever
    expect(plan.clearOrigin).toBe(true)
    expect(plan.apply).toBe(1.3)
  })

  it('leaves an unzoomed origin alone', () => {
    const plan = planZoomIsolation({ scope: 'per-origin', currentFactor: 1 })

    expect(plan.adopt).toBeNull()
    expect(plan.clearOrigin).toBe(false)
    expect(plan.apply).toBe(1)
  })

  it('restores what was remembered once the scope is already per-tab', () => {
    const plan = planZoomIsolation({ scope: 'per-tab', currentFactor: 1, remembered: 1.5 })

    expect(plan.adopt).toBeNull()
    expect(plan.clearOrigin).toBe(false)
    expect(plan.apply).toBe(1.5)
  })

  it('prefers what was remembered over a stray factor left on the origin', () => {
    const plan = planZoomIsolation({ scope: 'per-origin', currentFactor: 1.3, remembered: 0.9 })

    // Adopting again would resurrect an old factor every time a page opens
    expect(plan.adopt).toBeNull()
    expect(plan.clearOrigin).toBe(true)
    expect(plan.apply).toBe(0.9)
  })

  it('keeps a remembered zoom-out', () => {
    expect(planZoomIsolation({ scope: 'per-tab', currentFactor: 1, remembered: 0.75 }).apply).toBe(0.75)
  })
})

describe('isDefaultZoom', () => {
  it('accepts the float noise a browser reports', () => {
    expect(isDefaultZoom(1)).toBe(true)
    expect(isDefaultZoom(1.0000001)).toBe(true)
    expect(isDefaultZoom(1.1)).toBe(false)
    expect(isDefaultZoom(0.9)).toBe(false)
  })
})
