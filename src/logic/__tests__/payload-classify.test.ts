import { describe, expect, it } from 'vitest'
import { classifyPayload, extractCheckTarget } from '../payload-classify'

describe('classifyPayload', () => {
  it('classifies http(s) URLs', () => {
    expect(classifyPayload('https://example.com/path')).toEqual({ kind: 'url', value: 'https://example.com/path' })
    expect(classifyPayload('HTTPS://EXAMPLE.COM')).toEqual({ kind: 'url', value: 'HTTPS://EXAMPLE.COM' })
    expect(classifyPayload('http://bit.ly/x')).toEqual({ kind: 'url', value: 'http://bit.ly/x' })
  })

  it('classifies mailto with the first address as value', () => {
    expect(classifyPayload('mailto:a@b.com?cc=c@d.com')).toEqual({ kind: 'email', value: 'a@b.com' })
    expect(classifyPayload('mailto:a@b.com,c@d.com')).toEqual({ kind: 'email', value: 'a@b.com' })
  })

  it('classifies a bare email', () => {
    expect(classifyPayload('user@example.com')).toEqual({ kind: 'email', value: 'user@example.com' })
  })

  it('classifies tel/wifi/sms/geo schemes', () => {
    expect(classifyPayload('tel:+1234567890')).toEqual({ kind: 'tel', value: '+1234567890' })
    expect(classifyPayload('WIFI:S:net;T:WPA;P:pw;;')).toEqual({ kind: 'wifi', value: 'WIFI:S:net;T:WPA;P:pw;;' })
    expect(classifyPayload('SMSTO:+1:hi')).toEqual({ kind: 'sms', value: 'SMSTO:+1:hi' })
    expect(classifyPayload('sms:+1234')).toEqual({ kind: 'sms', value: 'sms:+1234' })
    expect(classifyPayload('geo:55.7,37.6')).toEqual({ kind: 'geo', value: 'geo:55.7,37.6' })
  })

  it('falls back to text for everything else', () => {
    expect(classifyPayload('just a phrase')).toEqual({ kind: 'text', value: 'just a phrase' })
    // email inside prose is not an exact email payload
    expect(classifyPayload('write to a@b.com now').kind).toBe('text')
  })
})

describe('extractCheckTarget', () => {
  it('extracts a URL from surrounding prose', () => {
    expect(extractCheckTarget('check this https://evil.example/login page'))
      .toEqual({ kind: 'url', value: 'https://evil.example/login' })
  })

  it('prefers email over URL when both present', () => {
    expect(extractCheckTarget('a@b.com and https://c.com'))
      .toEqual({ kind: 'email', value: 'a@b.com' })
  })

  it('extracts a bare domain', () => {
    expect(extractCheckTarget('google.com')).toEqual({ kind: 'domain', value: 'google.com' })
  })

  it('extracts a Cyrillic domain', () => {
    expect(extractCheckTarget('почта.рф')).toEqual({ kind: 'domain', value: 'почта.рф' })
  })

  it('extracts the leading full URL even when the tail is truncated', () => {
    expect(extractCheckTarget('https://example.com/full and then https://trunca'))
      .toEqual({ kind: 'url', value: 'https://example.com/full' })
  })

  it('returns null for garbage and empty input', () => {
    expect(extractCheckTarget('just some words')).toBeNull()
    expect(extractCheckTarget('')).toBeNull()
    expect(extractCheckTarget('   ')).toBeNull()
  })
})
