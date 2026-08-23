import type { LinkSafetySettings } from '../storage'
import { describe, expect, it, vi } from 'vitest'
import {
  alternateSpelling,
  checkDomainMismatch,
  extractDomainFromText,
  findAnchorElement,
  findAnchorFromEvent,
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
    setCachedVisitCount('cached.com', { stats: { count: 5, activeDays: 3 }, isSafe: true, ignored: false })
    const result = getCachedVisitCount('cached.com')
    expect(result).not.toBeNull()
    expect(result!.stats.count).toBe(5)
    // Every fact the verdict rests on comes back out, not the count alone
    expect(result!.stats.activeDays).toBe(3)
    expect(result!.isSafe).toBe(true)
    expect(result!.ignored).toBe(false)
  })

  it('returns null for expired cache entries', () => {
    setCachedVisitCount('expired.com', { stats: { count: 3 }, isSafe: false, ignored: false })

    // Fast-forward time past TTL (30 seconds)
    vi.useFakeTimers()
    vi.advanceTimersByTime(31_000)

    expect(getCachedVisitCount('expired.com')).toBeNull()

    vi.useRealTimers()
  })
})

describe('findAnchorFromEvent', () => {
  // A link inside a custom element's shadow root retargets: `event.target` is
  // the host element and `closest('a')` from there finds nothing, so the link
  // check simply never ran on it.
  function eventWithPath(path: EventTarget[]): Event {
    return { target: path[path.length - 1], composedPath: () => path } as unknown as Event
  }

  it('finds a link the event was retargeted away from', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/'
    const host = document.createElement('my-card')

    expect(findAnchorElement(host)).toBeNull()
    expect(findAnchorFromEvent(eventWithPath([anchor, host]))).toBe(anchor)
  })

  it('ignores an anchor with no href, which goes nowhere', () => {
    const anchor = document.createElement('a')
    expect(findAnchorFromEvent(eventWithPath([anchor]))).toBeNull()
  })

  it('falls back to walking up from the target where there is no path', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/'
    const span = document.createElement('span')
    anchor.appendChild(span)

    expect(findAnchorFromEvent({ target: span } as unknown as Event)).toBe(anchor)
  })
})

describe('checkDomainMismatch and international names', () => {
  // The two sides arrive in different alphabets: `URL.hostname` is punycode by
  // the time it reaches here, the text on the page is what the author typed
  it('does not call an honest unicode link a mismatch', () => {
    const result = checkDomainMismatch('münich.example', 'xn--mnich-kva.example')
    expect(result.mismatch).toBe(false)
  })

  it('still catches a unicode name pointing somewhere else', () => {
    const result = checkDomainMismatch('münich.example', 'evil.example')
    expect(result.mismatch).toBe(true)
    expect(result.textDomain).toBe('münich.example')
  })

  it('reads the two spellings of the same name as the same name', () => {
    expect(checkDomainMismatch('xn--mnich-kva.example', 'xn--mnich-kva.example').mismatch).toBe(false)
  })

  it('ignores a trailing dot and a www', () => {
    expect(checkDomainMismatch('www.example.com', 'example.com').mismatch).toBe(false)
  })

  it('control: the trick it exists for still trips it', () => {
    expect(checkDomainMismatch('paypal.com', 'evil.com').mismatch).toBe(true)
  })
})

describe('alternateSpelling', () => {
  // Every surface shows the ASCII form as the name, and every caller used to
  // keep the ASCII form as the alternate too - so the pair was claimed, found
  // to be a duplicate, and hidden. It was never once on screen for a link.
  it('answers with the readable form when the ascii one is shown', () => {
    expect(alternateSpelling('xn--mnich-kva.example')).toBe('münich.example')
  })

  it('answers with the ascii form when the readable one is shown', () => {
    expect(alternateSpelling('münich.example')).toBe('xn--mnich-kva.example')
  })

  it('has no alternate for a name with only one spelling', () => {
    expect(alternateSpelling('example.com')).toBeNull()
  })
})

describe('checkDomainMismatch and where one site ends', () => {
  // Half the web puts its login on a subdomain, and a red mismatch marker on
  // that pattern costs more than the marker is worth
  it('does not flag a link to a subdomain of the name it shows', () => {
    expect(checkDomainMismatch('example.com', 'login.example.com').mismatch).toBe(false)
    expect(checkDomainMismatch('login.example.com', 'example.com').mismatch).toBe(false)
  })

  it('still flags a name used as a label in front of somebody else', () => {
    const result = checkDomainMismatch('paypal.com', 'paypal.com.evil.net')
    expect(result.mismatch).toBe(true)
    expect(result.textDomain).toBe('paypal.com')
  })

  it('flags a name that merely ends in the same letters', () => {
    expect(checkDomainMismatch('example.com', 'notexample.com').mismatch).toBe(true)
  })

  it('sees a name with an invisible character hidden in it', () => {
    // A zero-width space between the letters. The pattern used not to match at
    // all, so nothing was compared and nothing was reported.
    expect(checkDomainMismatch('paypa​l.com', 'evil.net').mismatch).toBe(true)
    expect(checkDomainMismatch('paypa​l.com', 'evil.net').textDomain).toBe('paypal.com')
  })
})
