import type { LookalikeMatch } from '../domain-similarity'
import { describe, expect, it } from 'vitest'
import { hasKnownSuffix } from '../domain-boundary'
import { dropExplainedMarkers, findDomainMarkers, findNonLatinNames, NATIONAL_ENDINGS } from '../domain-markers'
import { addressRedFlagCount, isRedFlagLookalike, isRedFlagMarker } from '../red-flags'

function flags(hostname: string, url?: string) {
  return findDomainMarkers(hostname, url).filter(isRedFlagMarker).map(marker => marker.id)
}

describe('red flags', () => {
  it('counts the findings built to be misread', () => {
    expect(flags('paypal.com.evil.test')).toContain('embedded-public-suffix')
    expect(flags('evil.test', 'https://paypal.com@evil.test/')).toEqual(['url-userinfo'])
    expect(flags('xn--pypal-4ve.test')).toEqual(['mixed-scripts'])
    expect(flags('203.0.113.7')).toEqual(['ip-host'])
  })

  // Long names are common on real sites, and a router has no name to read
  it('leaves out deep subdomains and private addresses', () => {
    expect(findDomainMarkers('a.b.c.d.e.example.test').map(marker => marker.id)).toContain('deep-subdomains')
    expect(flags('a.b.c.d.e.example.test')).toEqual([])
    expect(flags('192.168.1.1')).toEqual([])
  })

  it('takes a sure lookalike as a flag and a near miss as a warning', () => {
    const match = (severity: 'high' | 'medium') => ({ domain: 'paypal.com', visits: 9, reason: 'edit-distance', evidence: 'x', severity }) as LookalikeMatch
    expect(isRedFlagLookalike(match('high'))).toBe(true)
    expect(isRedFlagLookalike(match('medium'))).toBe(false)
  })
})

describe('addressRedFlagCount', () => {
  const subdomain = { domain: 'yourbank.com', visits: 40, reason: 'familiar-as-subdomain', evidence: 'yourbank.com', severity: 'high' } as LookalikeMatch

  // The same count the lines draw: the embedded ending the lookalike line
  // explains is one flag, not two
  it('counts an explained embedded ending once', () => {
    expect(addressRedFlagCount('yourbank.com.evil.net', null, null)).toBe(1)
    expect(addressRedFlagCount('yourbank.com.evil.net', null, [subdomain])).toBe(1)
    expect(addressRedFlagCount('yourbank.com.evil.net', 'https://x@yourbank.com.evil.net/', [subdomain])).toBe(2)
  })
})

describe('a name in another alphabet under a Latin ending', () => {
  const nonLatin = (hostname: string) => findDomainMarkers(hostname).find(marker => marker.id === 'non-latin-name')

  // Every letter here is Cyrillic, and every one is drawn like a Latin letter
  it('flags аррӏе.com, which reads as apple.com, as Latin twins', () => {
    expect(nonLatin('аррӏе.com')).toMatchObject({ detail: 'аррӏе', script: 'cyrillic', twins: true, tld: 'com' })
    expect(nonLatin('xn--80ak6aa92e.com')).toMatchObject({ script: 'cyrillic', twins: true })
    expect(flags('аррӏе.com')).toEqual(['non-latin-name'])
  })

  it('flags Greek and Armenian twins the same way', () => {
    expect(nonLatin('ριοτ.com')).toMatchObject({ script: 'greek', twins: true })
    expect(nonLatin('օս.online')).toMatchObject({ script: 'armenian', twins: true })
  })

  // An address ending in Latin is expected in Latin all through
  it('flags any name in another alphabet under a Latin ending, two-letter ones included', () => {
    expect(nonLatin('пример.com')).toMatchObject({ script: 'cyrillic', twins: false })
    expect(nonLatin('пример.ru')).toMatchObject({ twins: false, tld: 'ru' })
    expect(nonLatin('аррӏе.io')).toMatchObject({ twins: true, tld: 'io' })
    expect(nonLatin('例子.com')).toMatchObject({ script: 'cjk', twins: false })
    // A real word Chromium lets through is still not in Latin, but is not said to imitate one
    expect(nonLatin('курс.com')).toMatchObject({ twins: false })
  })

  it('leaves names under an ending in another alphabet alone', () => {
    expect(nonLatin('пример.рф')).toBeUndefined()
    expect(nonLatin('xn--e1afmkfd.xn--p1ai')).toBeUndefined()
    expect(nonLatin('пример.укр')).toBeUndefined()
  })

  // Mixing is a flag of its own, and Latin names, accents included, are none of this
  it('is not raised for a mixed or a Latin name', () => {
    expect(nonLatin('pаypal.com')).toBeUndefined()
    expect(nonLatin('apple.com')).toBeUndefined()
    expect(nonLatin('münchen.de')).toBeUndefined()
    expect(nonLatin('123.example.com')).toBeUndefined()
  })

  it('looks at subdomains too', () => {
    expect(nonLatin('пример.example.com')).toMatchObject({ detail: 'пример' })
  })

  // The sharper line goes to the part made of twins, wherever it stands
  it('names the part of Latin twins where there are several', () => {
    expect(nonLatin('пример.аррӏе.com')).toMatchObject({ detail: 'аррӏе', twins: true })
  })

  // Only the ending's own alphabet gets a pass
  it('flags a name under a non-Latin ending in another alphabet', () => {
    expect(nonLatin('аррӏе.中国')).toMatchObject({ twins: true, tldScript: 'cjk' })
    expect(nonLatin('ριοτ.рф')).toMatchObject({ script: 'greek', tldScript: 'cyrillic' })
    expect(nonLatin('例子.中国')).toBeUndefined()
  })

  // Two alphabets in one part is mixed-scripts, one flag for one part
  it('is not raised next to mixed-scripts for the same part', () => {
    expect(flags('аρр.com')).toEqual(['mixed-scripts'])
  })

  // A mail address or a page's text can be in capitals
  it('reads a punycode name written in capitals', () => {
    expect(nonLatin('XN--80AK6AA92E.COM')).toMatchObject({ detail: 'аррӏе', twins: true })
  })

  // The lookalike line names the copied site and is the same trick
  it('counts once when a lookalike of a familiar site explains it', () => {
    const confusable = { domain: 'apple.com', visits: 40, reason: 'confusable', evidence: 'аррӏе', severity: 'high' } as LookalikeMatch
    expect(addressRedFlagCount('аррӏе.com', null, null)).toBe(1)
    expect(addressRedFlagCount('аррӏе.com', null, [confusable])).toBe(1)
    const asSubdomain = { ...confusable, reason: 'familiar-as-subdomain' } as LookalikeMatch
    expect(addressRedFlagCount('аррӏе.evil.com', null, [asSubdomain])).toBe(1)
    // One letter off a familiar name, or holding one, is the same trick
    const oneOff = { ...confusable, reason: 'edit-distance', evidence: 'аррӏее' } as LookalikeMatch
    expect(addressRedFlagCount('аррӏее.com', null, [oneOff])).toBe(1)
    const holding = { ...confusable, reason: 'contains-familiar', evidence: 'аррӏе-вход' } as LookalikeMatch
    expect(addressRedFlagCount('аррӏе-вход.com', null, [holding])).toBe(1)
  })

  // The other part is a finding of its own
  it('falls back to another part when the one it named is explained', () => {
    const confusable = { domain: 'apple.com', visits: 40, reason: 'confusable', evidence: 'аррӏе', severity: 'high' } as LookalikeMatch
    const markers = dropExplainedMarkers(findDomainMarkers('аррӏе.пример.com'), [confusable])
    expect(markers.find(marker => marker.id === 'non-latin-name')).toMatchObject({ detail: 'пример' })
    expect(addressRedFlagCount('аррӏе.пример.com', null, [confusable])).toBe(2)
  })

  // Tamil and Sinhala are both outside the named alphabets, and still two
  it('tells apart two alphabets it has no name for', () => {
    expect(nonLatin('தமிழ்.ලංකා')).toMatchObject({ script: 'other-tamil', tldScript: 'other-sinhala' })
    expect(nonLatin('தமிழ்.இந்தியா')).toBeUndefined()
  })

  // Text from a page can carry a label that does not decode at all
  it('reads the other labels when one does not decode', () => {
    expect(nonLatin('xn--80ak6aa92e.xn--zz.com')).toMatchObject({ detail: 'аррӏе' })
  })
})

// Shown to the reader as where a name in each alphabet belongs
describe('the example endings of each alphabet', () => {
  it('are real endings, each in the alphabet it stands for', () => {
    for (const [script, endings] of Object.entries(NATIONAL_ENDINGS)) {
      expect(endings.length).toBeGreaterThan(0)
      for (const ending of endings) {
        expect(hasKnownSuffix(`example.${ending}`), `.${ending} is on the suffix list`).toBe(true)
        // The ending's own letters as a name: read as this alphabet under a
        // Latin ending, and let through under the ending itself
        expect(findNonLatinNames(`${ending}.com`)[0]?.script, `.${ending} is ${script}`).toBe(script)
        expect(findNonLatinNames(`${ending}.${ending}`), `a name in ${script} under .${ending}`).toEqual([])
      }
    }
  })
})
