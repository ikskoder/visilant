import type { LinkSafetySettings } from '../storage'
import { describe, expect, it, vi } from 'vitest'
import {
  checkDomainMismatch,
  extractDomainFromText,
  findAnchorElement,
  getCachedVisitCount,
  getHostnameFromHref,
  getPunycodeInfo,
  isDomainInScope,
  isExternalLink,
  setCachedVisitCount,
} from '../link-safety'

describe('isExternalLink', () => {
  it('returns true for different hostname', () => {
    expect(isExternalLink('https://evil.com/path', 'example.com')).toBe(true)
  })

  it('returns false for same hostname', () => {
    expect(isExternalLink('https://example.com/path', 'example.com')).toBe(false)
  })

  it('returns false for non-http protocols', () => {
    expect(isExternalLink('mailto:user@evil.com', 'example.com')).toBe(false)
    expect(isExternalLink('javascript:void(0)', 'example.com')).toBe(false)
    expect(isExternalLink('ftp://files.com/doc', 'example.com')).toBe(false)
  })

  it('returns false for invalid URLs', () => {
    expect(isExternalLink('not-a-url', 'example.com')).toBe(false)
    expect(isExternalLink('', 'example.com')).toBe(false)
  })

  it('handles subdomains correctly', () => {
    expect(isExternalLink('https://sub.example.com', 'example.com')).toBe(true)
    expect(isExternalLink('https://example.com', 'sub.example.com')).toBe(true)
  })
})

describe('extractDomainFromText', () => {
  it('extracts domain from plain text', () => {
    expect(extractDomainFromText('google.com')).toBe('google.com')
  })

  it('extracts domain from URL with protocol', () => {
    expect(extractDomainFromText('https://google.com/path')).toBe('google.com')
  })

  it('strips www prefix', () => {
    expect(extractDomainFromText('www.google.com')).toBe('google.com')
  })

  it('returns null for non-domain text', () => {
    expect(extractDomainFromText('Click here')).toBeNull()
    expect(extractDomainFromText('hello')).toBeNull()
    expect(extractDomainFromText('')).toBeNull()
  })

  it('returns null for very long text', () => {
    expect(extractDomainFromText('a'.repeat(501))).toBeNull()
  })

  it('handles whitespace', () => {
    expect(extractDomainFromText('  google.com  ')).toBe('google.com')
  })

  it('lowercases the result', () => {
    expect(extractDomainFromText('Google.COM')).toBe('google.com')
  })

  it('extracts from URL with query and hash', () => {
    expect(extractDomainFromText('https://example.com?q=1#section')).toBe('example.com')
  })
})

describe('checkDomainMismatch', () => {
  it('detects mismatch when link text shows different domain', () => {
    const result = checkDomainMismatch('paypal.com', 'evil.com')
    expect(result.mismatch).toBe(true)
    expect(result.textDomain).toBe('paypal.com')
  })

  it('returns no mismatch for matching domains', () => {
    const result = checkDomainMismatch('google.com', 'google.com')
    expect(result.mismatch).toBe(false)
  })

  it('normalizes www prefix', () => {
    expect(checkDomainMismatch('www.google.com', 'google.com').mismatch).toBe(false)
    expect(checkDomainMismatch('google.com', 'www.google.com').mismatch).toBe(false)
  })

  it('returns no mismatch for non-domain link text', () => {
    expect(checkDomainMismatch('Click here', 'evil.com').mismatch).toBe(false)
    expect(checkDomainMismatch('Login now', 'phishing.com').mismatch).toBe(false)
  })

  it('detects full URL in link text vs different href', () => {
    const result = checkDomainMismatch('https://bank.com/login', 'attacker.com')
    expect(result.mismatch).toBe(true)
    expect(result.textDomain).toBe('bank.com')
  })
})

describe('getPunycodeInfo', () => {
  it('returns hasUnicode false for ASCII hostname', () => {
    expect(getPunycodeInfo('example.com')).toEqual({ hasUnicode: false })
  })

  it('detects Unicode characters in hostname', () => {
    const result = getPunycodeInfo('exаmple.com') // 'а' is Cyrillic
    expect(result.hasUnicode).toBe(true)
  })

  it('returns punycode ASCII conversion', () => {
    const result = getPunycodeInfo('münchen.de')
    expect(result.hasUnicode).toBe(true)
    expect(result.ascii).toBeDefined()
    expect(result.ascii).toContain('xn--')
  })

  it('handles plain ASCII domains', () => {
    expect(getPunycodeInfo('google.com').hasUnicode).toBe(false)
    expect(getPunycodeInfo('sub.domain.example.org').hasUnicode).toBe(false)
  })
})

describe('isDomainInScope', () => {
  const baseLinkSafety: LinkSafetySettings = {
    enabled: true,
    tooltipTrigger: 'hover',
    hoverDelay: 300,
    showVisitCount: 'always',
    shortUrlMode: 'off',
    shortUrlShowFullUrl: false,
    shortUrlTraceChain: false,
    shortUrlResolveAny: false,
    shortUrlListUpdateUrl: '',
    scopeMode: 'everywhere',
    scopeDomains: '',
  }

  it('returns true when scopeMode is everywhere', () => {
    expect(isDomainInScope('any.com', { ...baseLinkSafety, scopeMode: 'everywhere' })).toBe(true)
  })

  describe('whitelist mode', () => {
    it('returns true for domains in whitelist', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'whitelist' as const, scopeDomains: 'example.com\ngoogle.com' }
      expect(isDomainInScope('example.com', settings)).toBe(true)
    })

    it('returns false for domains not in whitelist', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'whitelist' as const, scopeDomains: 'example.com' }
      expect(isDomainInScope('other.com', settings)).toBe(false)
    })

    it('returns false when whitelist is empty', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'whitelist' as const, scopeDomains: '' }
      expect(isDomainInScope('any.com', settings)).toBe(false)
    })

    it('matches subdomains', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'whitelist' as const, scopeDomains: 'example.com' }
      expect(isDomainInScope('sub.example.com', settings)).toBe(true)
    })
  })

  describe('blacklist mode', () => {
    it('returns false for domains in blacklist', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'blacklist' as const, scopeDomains: 'blocked.com' }
      expect(isDomainInScope('blocked.com', settings)).toBe(false)
    })

    it('returns true for domains not in blacklist', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'blacklist' as const, scopeDomains: 'blocked.com' }
      expect(isDomainInScope('allowed.com', settings)).toBe(true)
    })

    it('returns true when blacklist is empty (everywhere)', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'blacklist' as const, scopeDomains: '' }
      expect(isDomainInScope('any.com', settings)).toBe(true)
    })

    it('blocks subdomains too', () => {
      const settings = { ...baseLinkSafety, scopeMode: 'blacklist' as const, scopeDomains: 'blocked.com' }
      expect(isDomainInScope('sub.blocked.com', settings)).toBe(false)
    })
  })

  it('handles domains with www and whitespace', () => {
    const settings = { ...baseLinkSafety, scopeMode: 'whitelist' as const, scopeDomains: '  www.example.com  \n  google.com  ' }
    expect(isDomainInScope('example.com', settings)).toBe(true)
    expect(isDomainInScope('google.com', settings)).toBe(true)
  })
})

describe('getHostnameFromHref', () => {
  it('extracts hostname from valid URL', () => {
    expect(getHostnameFromHref('https://example.com/path')).toBe('example.com')
  })

  it('returns null for invalid URL', () => {
    expect(getHostnameFromHref('not-a-url')).toBeNull()
  })

  it('handles URLs with ports', () => {
    expect(getHostnameFromHref('https://example.com:8080/path')).toBe('example.com')
  })
})

describe('findAnchorElement', () => {
  it('returns null for null target', () => {
    expect(findAnchorElement(null)).toBeNull()
  })

  it('returns null for non-Element target', () => {
    expect(findAnchorElement(document.createTextNode('text'))).toBeNull()
  })

  it('finds anchor from nested element', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com'
    const span = document.createElement('span')
    anchor.appendChild(span)
    document.body.appendChild(anchor)

    expect(findAnchorElement(span)).toBe(anchor)

    document.body.removeChild(anchor)
  })

  it('returns null when no anchor parent', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    expect(findAnchorElement(div)).toBeNull()

    document.body.removeChild(div)
  })
})

describe('visit count cache', () => {
  it('returns null for uncached hostname', () => {
    expect(getCachedVisitCount('unknown.com')).toBeNull()
  })

  it('caches and retrieves visit count', () => {
    setCachedVisitCount('cached.com', { count: 5, isSafe: true, ignored: false })
    const result = getCachedVisitCount('cached.com')
    expect(result).not.toBeNull()
    expect(result!.count).toBe(5)
    expect(result!.isSafe).toBe(true)
    expect(result!.ignored).toBe(false)
  })

  it('returns null for expired cache entries', () => {
    setCachedVisitCount('expired.com', { count: 3, isSafe: false, ignored: false })

    // Fast-forward time past TTL (30 seconds)
    vi.useFakeTimers()
    vi.advanceTimersByTime(31_000)

    expect(getCachedVisitCount('expired.com')).toBeNull()

    vi.useRealTimers()
  })
})
