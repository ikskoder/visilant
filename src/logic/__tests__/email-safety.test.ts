import { describe, expect, it } from 'vitest'
import { analyzeEmailAddress, collectMailtoRecipients, extractEmailFromText, parseMailtoUrl } from '../email-safety'

describe('analyzeEmailAddress', () => {
  it('analyzes a plain ASCII address', () => {
    const result = analyzeEmailAddress('john.doe@example.com')
    expect(result).not.toBeNull()
    expect(result!.localPart).toBe('john.doe')
    expect(result!.domain).toBe('example.com')
    expect(result!.local.hasUnicode).toBe(false)
    expect(result!.local.suspiciousChars).toEqual([])
    expect(result!.domainInfo.hasUnicode).toBe(false)
    expect(result!.domainInfo.punycode).toBeNull()
    expect(result!.suspiciousPattern).toBeNull()
  })

  it('lowercases the domain but keeps local part case', () => {
    const result = analyzeEmailAddress('John@EXAMPLE.COM')
    expect(result!.localPart).toBe('John')
    expect(result!.domain).toBe('example.com')
  })

  it('detects Cyrillic characters in the local part', () => {
    const result = analyzeEmailAddress('привет@gmail.com')
    expect(result!.local.hasUnicode).toBe(true)
    expect(result!.local.suspiciousChars.length).toBeGreaterThan(0)
    expect(result!.domainInfo.hasUnicode).toBe(false)
  })

  it('produces punycode for a Cyrillic domain', () => {
    const result = analyzeEmailAddress('user@почта.рф')
    expect(result!.domainInfo.hasUnicode).toBe(true)
    expect(result!.domainInfo.punycode).toMatch(/^xn--/)
  })

  it('detects a single homoglyph in an otherwise-Latin domain', () => {
    // 'а' is Cyrillic
    const result = analyzeEmailAddress('support@pаypal.com')
    expect(result!.domainInfo.hasUnicode).toBe(true)
    expect(result!.domainInfo.suspiciousChars).toContain('а')
  })

  it('flags an embedded TLD (paypal.com.evil.ru)', () => {
    const result = analyzeEmailAddress('security@paypal.com.evil.ru')
    expect(result!.suspiciousPattern).toEqual({ type: 'embedded-tld', label: 'com' })
  })

  it('does not flag legitimate ccTLD combos', () => {
    expect(analyzeEmailAddress('news@bbc.co.uk')!.suspiciousPattern).toBeNull()
    expect(analyzeEmailAddress('a@example.com')!.suspiciousPattern).toBeNull()
  })

  it('rejects invalid inputs', () => {
    expect(analyzeEmailAddress('no-at-sign')).toBeNull()
    expect(analyzeEmailAddress('a@')).toBeNull()
    expect(analyzeEmailAddress('@b.com')).toBeNull()
    expect(analyzeEmailAddress('a@b@c.com')).toBeNull()
    expect(analyzeEmailAddress('a b@c.com')).toBeNull()
    expect(analyzeEmailAddress('a@nodots')).toBeNull()
    expect(analyzeEmailAddress('')).toBeNull()
    expect(analyzeEmailAddress(`${'a'.repeat(320)}@b.com`)).toBeNull()
  })
})

describe('parseMailtoUrl', () => {
  it('parses a bare address', () => {
    expect(parseMailtoUrl('mailto:a@b.com')).toEqual({ addresses: ['a@b.com'], params: [] })
  })

  it('parses multiple addresses', () => {
    expect(parseMailtoUrl('mailto:a@b.com,c@d.com')!.addresses).toEqual(['a@b.com', 'c@d.com'])
  })

  it('parses and decodes query params', () => {
    const result = parseMailtoUrl('mailto:a@b.com?cc=x@y.com&subject=Hello%20World&body=Click%20here')
    expect(result!.addresses).toEqual(['a@b.com'])
    expect(result!.params).toEqual([
      { key: 'cc', value: 'x@y.com' },
      { key: 'subject', value: 'Hello World' },
      { key: 'body', value: 'Click here' },
    ])
  })

  it('decodes percent-encoded addresses', () => {
    expect(parseMailtoUrl('mailto:a%40b.com')!.addresses).toEqual(['a@b.com'])
  })

  it('accepts uppercase MAILTO:', () => {
    expect(parseMailtoUrl('MAILTO:a@b.com')!.addresses).toEqual(['a@b.com'])
  })

  it('returns null for non-mailto input', () => {
    expect(parseMailtoUrl('https://example.com')).toBeNull()
    expect(parseMailtoUrl('a@b.com')).toBeNull()
  })
})

describe('extractEmailFromText', () => {
  it('finds an email embedded in prose', () => {
    expect(extractEmailFromText('Contact us at help@example.com for details')).toBe('help@example.com')
  })

  it('finds a unicode-domain email', () => {
    expect(extractEmailFromText('пишите на user@почта.рф сегодня')).toBe('user@почта.рф')
  })

  it('returns null when no email present', () => {
    expect(extractEmailFromText('just some words')).toBeNull()
    expect(extractEmailFromText('')).toBeNull()
  })

  it('still finds an email near the start of very long text', () => {
    expect(extractEmailFromText(`a@b.com ${'x'.repeat(1000)}`)).toBe('a@b.com')
  })
})

describe('collectMailtoRecipients', () => {
  it('finds every address, not only the first', () => {
    const parsed = parseMailtoUrl('mailto:trusted@known.example,attacker@evil.example')
    expect(collectMailtoRecipients(parsed).map(r => r.address)).toEqual([
      'trusted@known.example',
      'attacker@evil.example',
    ])
  })

  it('reads cc and bcc, which reach real people too', () => {
    const parsed = parseMailtoUrl('mailto:a@one.example?cc=b@two.example,c@three.example&bcc=d@four.example&subject=hi')
    expect(collectMailtoRecipients(parsed)).toEqual([
      { field: 'to', address: 'a@one.example' },
      { field: 'cc', address: 'b@two.example' },
      { field: 'cc', address: 'c@three.example' },
      { field: 'bcc', address: 'd@four.example' },
    ])
  })

  it('counts a person named twice once', () => {
    const parsed = parseMailtoUrl('mailto:a@one.example?cc=A@One.example')
    expect(collectMailtoRecipients(parsed)).toHaveLength(1)
  })

  it('ignores the parameters that are not recipients', () => {
    const parsed = parseMailtoUrl('mailto:a@one.example?subject=b@evil.example&body=c@evil.example')
    expect(collectMailtoRecipients(parsed).map(r => r.address)).toEqual(['a@one.example'])
  })

  it('has nothing to say about a plain address', () => {
    expect(collectMailtoRecipients(null)).toEqual([])
  })
})

describe('international names written in ascii', () => {
  // `xn--p1ai` is letters, digits and hyphens, and the pattern only allowed
  // letters - so an address at an international domain matched nothing at all
  // and was never read as an address. That is exactly the shape worth reading.
  it('finds an address at a punycode domain', () => {
    expect(extractEmailFromText('ivan@xn--80a1acny.xn--p1ai')).toBe('ivan@xn--80a1acny.xn--p1ai')
  })

  it('still finds an ordinary one, and stops where it should', () => {
    expect(extractEmailFromText('write to a@example.com now')).toBe('a@example.com')
  })

  it('analyses a punycode address as an address', () => {
    const result = analyzeEmailAddress('ivan@xn--80a1acny.xn--p1ai')
    expect(result?.domain).toBe('xn--80a1acny.xn--p1ai')
  })
})

describe('recipients that hide in the query', () => {
  it('reads a link whose only recipient is a bcc', () => {
    const parsed = parseMailtoUrl('mailto:?bcc=attacker@evil.example')
    expect(parsed!.addresses).toEqual([])
    expect(collectMailtoRecipients(parsed)).toEqual([{ field: 'bcc', address: 'attacker@evil.example' }])
  })

  it('reads a recipient list written entirely as `to`', () => {
    const parsed = parseMailtoUrl('mailto:?to=a@one.example,b@two.example')
    expect(collectMailtoRecipients(parsed).map(r => r.address)).toEqual(['a@one.example', 'b@two.example'])
  })

  // A mailto query is not an HTML form. `URLSearchParams` turned this `+` into a
  // space, and the address then read as no address at all.
  it('keeps a plus in an address', () => {
    const parsed = parseMailtoUrl('mailto:?bcc=finance+invoices@evil.example')
    expect(collectMailtoRecipients(parsed)[0].address).toBe('finance+invoices@evil.example')
  })

  it('still decodes what is percent-encoded', () => {
    const parsed = parseMailtoUrl('mailto:?subject=one%20two&cc=b%40two.example')
    expect(parsed!.params.find(p => p.key === 'subject')!.value).toBe('one two')
    expect(collectMailtoRecipients(parsed).map(r => r.address)).toEqual(['b@two.example'])
  })
})
