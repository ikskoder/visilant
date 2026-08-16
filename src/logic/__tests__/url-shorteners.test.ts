import type { ResolvedUrlResult } from '../url-shorteners'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addCustomShortener,
  getCachedResolvedUrl,
  getCustomShorteners,
  getShortenerCount,
  isShortenedUrl,
  loadCustomShorteners,
  parseDomainList,
  setCachedResolvedUrl,
  updateShortenerList,
} from '../url-shorteners'

describe('parseDomainList', () => {
  it('parses newline-separated domains', () => {
    const result = parseDomainList('bit.ly\ntiny.cc\ngoo.gl')
    expect(result).toEqual(['bit.ly', 'tiny.cc', 'goo.gl'])
  })

  it('ignores empty lines', () => {
    const result = parseDomainList('bit.ly\n\n\ntiny.cc')
    expect(result).toEqual(['bit.ly', 'tiny.cc'])
  })

  it('ignores comment lines starting with #', () => {
    const result = parseDomainList('# This is a comment\nbit.ly\n# Another comment\ntiny.cc')
    expect(result).toEqual(['bit.ly', 'tiny.cc'])
  })

  it('trims whitespace', () => {
    const result = parseDomainList('  bit.ly  \n  tiny.cc  ')
    expect(result).toEqual(['bit.ly', 'tiny.cc'])
  })

  it('lowercases domains', () => {
    const result = parseDomainList('BIT.LY\nTiny.CC')
    expect(result).toEqual(['bit.ly', 'tiny.cc'])
  })

  it('filters entries without dots', () => {
    const result = parseDomainList('bitly\nbit.ly\nlocalhost')
    expect(result).toEqual(['bit.ly'])
  })

  it('returns empty array for empty input', () => {
    expect(parseDomainList('')).toEqual([])
  })
})

describe('isShortenedUrl', () => {
  it('recognizes known shortener domains', () => {
    expect(isShortenedUrl('bit.ly')).toBe(true)
    expect(isShortenedUrl('tinyurl.com')).toBe(true)
    expect(isShortenedUrl('t.co')).toBe(true)
    expect(isShortenedUrl('goo.gl')).toBe(true)
  })

  it('returns false for regular domains', () => {
    expect(isShortenedUrl('google.com')).toBe(false)
    expect(isShortenedUrl('github.com')).toBe(false)
    expect(isShortenedUrl('example.com')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isShortenedUrl('BIT.LY')).toBe(true)
    expect(isShortenedUrl('Bit.Ly')).toBe(true)
  })

  it('detects subdomains of shorteners', () => {
    expect(isShortenedUrl('custom.bit.ly')).toBe(true)
    expect(isShortenedUrl('my.tinyurl.com')).toBe(true)
  })

  it('does not false-positive on partial matches', () => {
    // "notbit.ly" should NOT match "bit.ly"
    expect(isShortenedUrl('notbit.ly')).toBe(false)
  })
})

describe('custom shorteners', () => {
  it('adds a custom shortener domain', () => {
    const before = getShortenerCount()
    addCustomShortener('myshort.test')
    expect(isShortenedUrl('myshort.test')).toBe(true)
    expect(getShortenerCount()).toBe(before + 1)
  })

  it('does not duplicate custom shorteners', () => {
    addCustomShortener('dupe.test')
    const countAfterFirst = getShortenerCount()
    addCustomShortener('dupe.test')
    expect(getShortenerCount()).toBe(countAfterFirst)
  })

  it('trims and lowercases custom domains', () => {
    addCustomShortener('  UPPER.TEST  ')
    expect(isShortenedUrl('upper.test')).toBe(true)
  })

  it('loads custom shorteners from array', () => {
    loadCustomShorteners(['bulk1.test', 'bulk2.test'])
    expect(isShortenedUrl('bulk1.test')).toBe(true)
    expect(isShortenedUrl('bulk2.test')).toBe(true)
  })

  it('returns custom shorteners list', () => {
    loadCustomShorteners(['list1.test', 'list2.test'])
    const customs = getCustomShorteners()
    expect(customs).toContain('list1.test')
    expect(customs).toContain('list2.test')
  })
})

describe('getShortenerCount', () => {
  it('returns a positive number (built-in list is large)', () => {
    expect(getShortenerCount()).toBeGreaterThan(100)
  })
})

describe('resolved URL cache', () => {
  const mockResult: ResolvedUrlResult = {
    finalUrl: 'https://example.com/page',
    finalHostname: 'example.com',
    chain: ['https://bit.ly/abc', 'https://example.com/page'],
    status: 'resolved',
  }

  it('returns null for uncached URL', () => {
    expect(getCachedResolvedUrl('https://never-cached.com')).toBeNull()
  })

  it('caches and retrieves resolved URL', () => {
    setCachedResolvedUrl('https://bit.ly/test', mockResult)
    const cached = getCachedResolvedUrl('https://bit.ly/test')
    expect(cached).toEqual(mockResult)
  })

  it('returns null for expired cache (5 min TTL)', () => {
    setCachedResolvedUrl('https://bit.ly/expired', mockResult)

    vi.useFakeTimers()
    vi.advanceTimersByTime(301_000) // 5 min + 1 sec

    expect(getCachedResolvedUrl('https://bit.ly/expired')).toBeNull()

    vi.useRealTimers()
  })
})

describe('remote shortener list', () => {
  afterEach(() => {
    updateShortenerList([])
    loadCustomShorteners([])
  })

  it('adds remotely fetched domains to the runtime set', () => {
    expect(isShortenedUrl('remote-only.test')).toBe(false)
    updateShortenerList(['remote-only.test'])
    expect(isShortenedUrl('remote-only.test')).toBe(true)
  })

  it('keeps the built-in list alongside the remote one', () => {
    updateShortenerList(['remote-only.test'])
    expect(isShortenedUrl('bit.ly')).toBe(true)
  })

  it('survives a custom domain being added afterwards', () => {
    // The set used to be rebuilt from built-in + custom only, so adding one
    // custom domain silently discarded everything that had been fetched
    updateShortenerList(['remote-only.test'])
    addCustomShortener('mine.test')

    expect(isShortenedUrl('remote-only.test')).toBe(true)
    expect(isShortenedUrl('mine.test')).toBe(true)
    expect(isShortenedUrl('bit.ly')).toBe(true)
  })

  it('replaces the previous remote list rather than accumulating', () => {
    updateShortenerList(['first.test'])
    updateShortenerList(['second.test'])

    expect(isShortenedUrl('first.test')).toBe(false)
    expect(isShortenedUrl('second.test')).toBe(true)
  })
})
