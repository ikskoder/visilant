import { describe, expect, it } from 'vitest'
import { useFamiliarityFacts } from '../useFamiliarityFacts'

// No locale is loaded under jsdom, so `t` hands back the key it was given
describe('statusLabel', () => {
  const { statusLabel } = useFamiliarityFacts()

  // An answer that never came used to read as a familiar site, and the link
  // went through unchecked. It is its own verdict, and never the green one.
  it('calls a site nobody could ask about unchecked, whatever else it was given', () => {
    const label = statusLabel('example.com', true, 40, true)

    expect(label.verdict).toBe('unchecked')
    expect(label.text).toBe('verdictUnchecked')
    expect(label.tone).not.toBe('safe')
  })

  it('keeps the three verdicts it had when the check did run', () => {
    expect(statusLabel('example.com', true, 40).verdict).toBe('familiar')
    expect(statusLabel('example.com', false, 0).verdict).toBe('never')
    expect(statusLabel('example.com', false, 3).verdict).toBe('unfamiliar')
  })

  it('draws every verdict as the shield', () => {
    expect(statusLabel('example.com', true, 40).icon).toBe('shield-pass')
    expect(statusLabel('example.com', false, 0).icon).toBe('shield-fail')
    expect(statusLabel('example.com', false, 3, true).icon).toBe('shield-unknown')
  })

  // A name without a dot is never counted, so its zero is no verdict at all
  it('gives an address that is never counted no familiarity verdict', () => {
    for (const hostname of ['intranet', '192.168.1.1']) {
      const label = statusLabel(hostname, false, 0)
      expect(label.verdict).toBe('untracked')
      expect(label.tone).toBe('neutral')
    }
    expect(statusLabel('example.com', false, 0).verdict).toBe('never')
    // A public IP address is counted like any site
    expect(statusLabel('8.8.8.8', false, 0).verdict).toBe('never')
  })

  // One record, one verdict: "Unfamiliar site" over a line reading "Never
  // visited" was two
  it('tells a site never visited from one seen a few times', () => {
    expect(statusLabel('example.com', false, 0).verdict).toBe('never')
    expect(statusLabel('example.com', false, 3).verdict).toBe('unfamiliar')
    expect(statusLabel('example.com', true, 9).verdict).toBe('familiar')
  })
})
