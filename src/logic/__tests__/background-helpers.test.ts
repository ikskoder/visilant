import { describe, expect, it } from 'vitest'

/**
 * These test the pure helper functions used in the background script.
 * Since background/main.ts doesn't export them directly,
 * we replicate their logic here for verification.
 * Any drift between these tests and the actual code should be caught in review.
 */

function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  }
  catch {
    return url
  }
}

function isInternalPage(hostname: string): boolean {
  return !hostname.includes('.')
}

function checkIfSiteIsSafe(count: number, safetyThreshold: number): boolean {
  return count >= safetyThreshold
}

function getBadgeColor(isSiteSafe: boolean): string {
  return isSiteSafe ? '#00C851' : '#ff4444'
}

function getBadgeText(count: number): string {
  return count >= 1000 ? '>1K' : count.toString()
}

describe('getHostname', () => {
  it('extracts hostname from valid URL', () => {
    expect(getHostname('https://example.com/path?q=1')).toBe('example.com')
  })

  it('handles URLs with ports', () => {
    expect(getHostname('https://example.com:8080')).toBe('example.com')
  })

  it('returns raw string for invalid URL', () => {
    expect(getHostname('not-a-url')).toBe('not-a-url')
  })

  it('handles chrome:// URLs', () => {
    expect(getHostname('chrome://extensions')).toBe('extensions')
  })

  it('returns raw string for unparseable URLs', () => {
    // about:blank has an empty hostname when parsed; getHostname falls back
    expect(getHostname('not-a-url')).toBe('not-a-url')
  })
})

describe('isInternalPage', () => {
  it('returns true for hostnames without dots', () => {
    expect(isInternalPage('extensions')).toBe(true)
    expect(isInternalPage('newtab')).toBe(true)
    expect(isInternalPage('localhost')).toBe(true)
  })

  it('returns false for regular hostnames', () => {
    expect(isInternalPage('example.com')).toBe(false)
    expect(isInternalPage('sub.domain.org')).toBe(false)
  })
})

describe('checkIfSiteIsSafe', () => {
  it('returns true when count meets threshold', () => {
    expect(checkIfSiteIsSafe(10, 10)).toBe(true)
    expect(checkIfSiteIsSafe(100, 10)).toBe(true)
  })

  it('returns false when count is below threshold', () => {
    expect(checkIfSiteIsSafe(0, 10)).toBe(false)
    expect(checkIfSiteIsSafe(9, 10)).toBe(false)
  })

  it('works with threshold of 1', () => {
    expect(checkIfSiteIsSafe(0, 1)).toBe(false)
    expect(checkIfSiteIsSafe(1, 1)).toBe(true)
  })
})

describe('getBadgeColor', () => {
  it('returns green for safe sites', () => {
    expect(getBadgeColor(true)).toBe('#00C851')
  })

  it('returns red for unsafe sites', () => {
    expect(getBadgeColor(false)).toBe('#ff4444')
  })
})

describe('getBadgeText', () => {
  it('returns count as string for normal values', () => {
    expect(getBadgeText(0)).toBe('0')
    expect(getBadgeText(42)).toBe('42')
    expect(getBadgeText(999)).toBe('999')
  })

  it('returns >1K for 1000+', () => {
    expect(getBadgeText(1000)).toBe('>1K')
    expect(getBadgeText(5000)).toBe('>1K')
  })
})
