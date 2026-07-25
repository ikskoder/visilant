import { describe, expect, it } from 'vitest'
import {
  decodeHostname,
  findDomainMarkers,
  findEmbeddedPublicSuffix,
  findHostnameMarkers,
  findMixedScriptLabel,
  getSubdomainDepth,
  getUrlUserinfo,
  isIpHost,
} from '../domain-markers'

describe('getUrlUserinfo', () => {
  it('catches a brand name parked in the userinfo field', () => {
    expect(getUrlUserinfo('https://paypal.com@evil.net/login')).toBe('paypal.com')
  })

  it('reports that a password is present without echoing it', () => {
    const detail = getUrlUserinfo('https://user:hunter2@evil.net/')
    expect(detail).toBe('user:…')
    expect(detail).not.toContain('hunter2')
  })

  it('decodes percent-encoded userinfo', () => {
    expect(getUrlUserinfo('https://pay%70al.com@evil.net/')).toBe('paypal.com')
  })

  it('returns null for ordinary URLs', () => {
    expect(getUrlUserinfo('https://example.com/a@b')).toBeNull()
    expect(getUrlUserinfo('https://example.com/?to=a@b.com')).toBeNull()
    expect(getUrlUserinfo('https://example.com/#a@b')).toBeNull()
  })

  it('ignores non-web schemes and unparseable input', () => {
    expect(getUrlUserinfo('mailto:someone@example.com')).toBeNull()
    expect(getUrlUserinfo('not a url')).toBeNull()
  })
})

describe('isIpHost', () => {
  it('recognises dotted-quad addresses', () => {
    expect(isIpHost('192.168.1.1')).toBe(true)
    expect(isIpHost('8.8.8.8')).toBe(true)
  })

  it('recognises the spellings the URL parser normally folds away', () => {
    expect(isIpHost('3232235777')).toBe(true)
    expect(isIpHost('0xc0a80101')).toBe(true)
  })

  it('recognises IPv6', () => {
    expect(isIpHost('[::1]')).toBe(true)
    expect(isIpHost('[2001:db8::1]')).toBe(true)
  })

  it('rejects names, including ones built out of numbers', () => {
    expect(isIpHost('example.com')).toBe(false)
    expect(isIpHost('1.2.3.4.example.com')).toBe(false)
    expect(isIpHost('999.1.1.1')).toBe(false)
    expect(isIpHost('123movies.com')).toBe(false)
  })
})

describe('findEmbeddedPublicSuffix', () => {
  it('catches a whole domain used as a subdomain', () => {
    expect(findEmbeddedPublicSuffix('paypal.com.evil.net')).toBe('com')
    expect(findEmbeddedPublicSuffix('login.microsoft.com.account.xyz')).toBe('com')
    expect(findEmbeddedPublicSuffix('example.org.secure.top')).toBe('org')
  })

  it('deliberately ignores country codes, which the lookalike pass covers instead', () => {
    // Flagging `ru` here would also flag every ru./de./fr. language subdomain
    expect(findEmbeddedPublicSuffix('sberbank.ru.login.top')).toBeNull()
  })

  it('leaves ordinary hostnames alone', () => {
    expect(findEmbeddedPublicSuffix('www.example.com')).toBeNull()
    expect(findEmbeddedPublicSuffix('mail.google.com')).toBeNull()
    expect(findEmbeddedPublicSuffix('s3.eu-west-1.amazonaws.com')).toBeNull()
    expect(findEmbeddedPublicSuffix('example.com')).toBeNull()
  })

  it('leaves real multi-part suffixes alone', () => {
    // co.uk is this hostname's actual suffix, not a label pretending to be one
    expect(findEmbeddedPublicSuffix('www.bbc.co.uk')).toBeNull()
    expect(findEmbeddedPublicSuffix('shop.example.com.br')).toBeNull()
  })

  it('is not fooled by modern gTLDs that are ordinary words or brand names', () => {
    // .shop, .app and .hsbc are all real suffixes, but nobody reads them as
    // "the domain ends here" in the middle of a hostname
    expect(findEmbeddedPublicSuffix('shop.example.net')).toBeNull()
    expect(findEmbeddedPublicSuffix('app.dev.example.net')).toBeNull()
    expect(findEmbeddedPublicSuffix('hsbc.example.net')).toBeNull()
  })

  it('does not mistake language subdomains for a country-code trick', () => {
    expect(findEmbeddedPublicSuffix('de.wikipedia.org')).toBeNull()
    expect(findEmbeddedPublicSuffix('ru.example.com')).toBeNull()
  })

  it('is not fooled by a label that merely looks like a TLD', () => {
    expect(findEmbeddedPublicSuffix('zzzz.example.com')).toBeNull()
  })
})

describe('getSubdomainDepth', () => {
  it('counts labels above the registrable domain', () => {
    expect(getSubdomainDepth('example.com')).toBe(0)
    expect(getSubdomainDepth('www.example.com')).toBe(1)
    expect(getSubdomainDepth('a.b.c.example.com')).toBe(3)
    expect(getSubdomainDepth('a.b.c.d.example.com')).toBe(4)
  })

  it('does not count the public suffix itself', () => {
    expect(getSubdomainDepth('www.bbc.co.uk')).toBe(1)
    expect(getSubdomainDepth('shop.example.com.br')).toBe(1)
  })

  it('handles hostnames with nothing above the registrable domain', () => {
    expect(getSubdomainDepth('localhost')).toBe(0)
    expect(getSubdomainDepth('bbc.co.uk')).toBe(0)
    expect(getSubdomainDepth('')).toBe(0)
  })

  it('under-reports rather than over-reports when the suffix shape is ambiguous', () => {
    // `abc.de` reads like a compound country suffix, so `www` is absorbed into
    // it. Losing a level only costs a flag; inventing one would cost trust.
    expect(getSubdomainDepth('www.abc.de')).toBe(0)
  })
})

describe('findMixedScriptLabel', () => {
  it('catches Latin mixed with Cyrillic in one label', () => {
    // pаypal.com, where the second character is a Cyrillic а
    expect(findMixedScriptLabel('xn--pypal-4ve.com')).toBe('pаypal')
    expect(findMixedScriptLabel('pаypal.com')).toBe('pаypal')
  })

  it('catches a mixed label anywhere in the hostname', () => {
    expect(findMixedScriptLabel('login.pаypal.example.net')).toBe('pаypal')
  })

  it('accepts single-script internationalised domains', () => {
    expect(findMixedScriptLabel('пример.com')).toBeNull()
    expect(findMixedScriptLabel('xn--e1afmkfd.com')).toBeNull()
  })

  it('accepts scripts that legitimately combine', () => {
    // Japanese mixes Han and Hiragana inside a single word
    expect(findMixedScriptLabel('ドメイン名例.com')).toBeNull()
  })

  it('accepts plain ASCII hostnames', () => {
    expect(findMixedScriptLabel('example.com')).toBeNull()
    expect(findMixedScriptLabel('my-shop-123.co.uk')).toBeNull()
  })
})

describe('decodeHostname', () => {
  it('renders punycode as Unicode', () => {
    expect(decodeHostname('xn--e1afmkfd.com')).toBe('пример.com')
  })

  it('passes through anything it cannot decode', () => {
    expect(decodeHostname('example.com')).toBe('example.com')
  })
})

describe('findHostnameMarkers', () => {
  it('reports nothing for an ordinary hostname', () => {
    expect(findHostnameMarkers('www.example.com')).toEqual([])
    expect(findHostnameMarkers('mail.google.com')).toEqual([])
  })

  it('stops after the IP marker — the rest assume a name', () => {
    expect(findHostnameMarkers('192.168.1.1')).toEqual([
      { id: 'ip-host', detail: '192.168.1.1' },
    ])
  })

  it('reports several markers at once', () => {
    const markers = findHostnameMarkers('paypal.com.a.b.secure.evil.net')
    expect(markers.map(marker => marker.id)).toEqual(['embedded-public-suffix', 'deep-subdomains'])
  })

  it('does not flag a hostname sitting exactly on the depth limit', () => {
    expect(findHostnameMarkers('a.b.c.example.com')).toEqual([])
  })
})

describe('findDomainMarkers', () => {
  it('combines URL-level and hostname-level markers', () => {
    const markers = findDomainMarkers('a.b.c.d.evil.net', 'https://paypal.com@a.b.c.d.evil.net/login')
    expect(markers.map(marker => marker.id)).toEqual(['url-userinfo', 'deep-subdomains'])
  })

  it('works without a URL', () => {
    expect(findDomainMarkers('www.example.com')).toEqual([])
  })
})
