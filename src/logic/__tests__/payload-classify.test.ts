import { describe, expect, it } from 'vitest'
import { classifyPayload, classifyQrPayload, extractCheckTarget } from '../payload-classify'

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

describe('classifyQrPayload', () => {
  // One reading for both doors. The long-press menu stopped at
  // `classifyPayload`, so a bare name in a QR code was raw text there and a
  // domain on the check page - two different screens for the same code.
  it('reads a bare name as the site it is', () => {
    expect(classifyQrPayload('example.com')).toEqual({ kind: 'url', value: 'https://example.com' })
  })

  it('leaves a payload that names its own scheme alone', () => {
    expect(classifyQrPayload('https://example.com/path')).toEqual({ kind: 'url', value: 'https://example.com/path' })
    expect(classifyQrPayload('WIFI:S:home;T:WPA;P:secret;;').kind).toBe('wifi')
    expect(classifyQrPayload('tel:+123456').kind).toBe('tel')
  })

  it('finds an address written on its own', () => {
    expect(classifyQrPayload('billing@supplier.example')).toEqual({ kind: 'email', value: 'billing@supplier.example' })
  })

  it('leaves something that is not an address as text', () => {
    expect(classifyQrPayload('just some words').kind).toBe('text')
  })
})
