import type { DomainMarker } from '../domain-markers'
import type { LookalikeMatch } from '../domain-similarity'
import { describe, expect, it } from 'vitest'
import { addressShape } from '../domain-boundary'
import { dropExplainedMarkers, findDomainMarkers } from '../domain-markers'
import { buildFamiliarIndex, findLookalikes } from '../domain-similarity'
import { pieceTones } from '../piece-tones'

interface Extra { lookalikes?: LookalikeMatch[], markers?: DomainMarker[], platform?: boolean, service?: boolean, shape?: false }

/** The tones of an address as a letter per label: `r` red, `o` orange, `-` none. */
function tones(hostname: string, extra: Extra = {}) {
  const found = pieceTones(hostname, {
    markers: extra.markers ?? findDomainMarkers(hostname),
    lookalikes: extra.lookalikes ?? [],
    shape: extra.shape === false ? undefined : addressShape(hostname),
    platform: extra.platform,
    service: extra.service,
  })
  const labels = hostname.split(/[.。．｡]/)
  if (labels.at(-1) === '')
    labels.pop()
  return labels.map((_, index) => ({ danger: 'r', caution: 'o', none: '-' })[found.get(index) ?? 'none']).join('')
}

// What a person who visits paypal.com has to compare an address with, and
// the matches the real detector finds against it, as the lines draw them
const index = buildFamiliarIndex([{ domain: 'paypal.com', label: 'paypal', visits: 40 }])
function withLookalikes(hostname: string, shape?: false) {
  const lookalikes = findLookalikes(hostname, index)
  return tones(hostname, { lookalikes, markers: dropExplainedMarkers(findDomainMarkers(hostname), lookalikes), shape })
}

// One function for every surface, so a finding said in a line is never left
// unmarked in the address above it
describe('which labels a finding colours', () => {
  it('colours nothing in an address nothing was found about', () => {
    expect(tones('mail.google.com')).toBe('---')
    expect(pieceTones('', { markers: [], lookalikes: [] }).size).toBe(0)
  })

  it('colours a domain parked in front red, and every one of them', () => {
    expect(tones('paypal.com.secure.verify.test')).toBe('rr---')
    expect(tones('paypal.com.google.com.evil.test')).toBe('rrrr--')
    // The country code is part of the domain the eye stops at
    expect(tones('paypal.com.au.evil.test')).toBe('rrr--')
    // Whatever the case, and with the dot at the very end, which is no label
    expect(tones('PayPal.COM.evil.test.')).toBe('rr--')
  })

  it('colours the name in another alphabet red, in either spelling of the address', () => {
    expect(tones('пример.com')).toBe('r-')
    expect(tones('xn--e1afmkfd.com')).toBe('r-')
    // One part in two alphabets
    expect(tones('pаypal.com')).toBe('r-')
  })

  // The line names one part. A second part in another alphabet has no line
  // of its own, so it has no colour of its own either
  it('colours only the part the line names', () => {
    const markers = findDomainMarkers('пример.почта.com')
    const named = markers.find(marker => marker.id === 'non-latin-name')!
    expect('detail' in named && named.detail).toBe('пример')
    expect(tones('пример.почта.com')).toBe('r--')
  })

  it('colours every level in front of the site orange when there are too many', () => {
    expect(tones('a.b.c.d.evil.test')).toBe('oooo--')
    // Before the shape is known, by the count the finding itself gives
    expect(tones('a.b.c.d.evil.test', { shape: false })).toBe('oooo--')
  })

  it('lets red win where a red flag and an orange line meet', () => {
    expect(tones('paypal.com.a.b.c.evil.test')).toBe('rrooo--')
  })

  // The line is drawn for both, in red for one and orange for the other
  it('colours a numeric address as its line is coloured', () => {
    expect(tones('203.0.113.7')).toBe('rrrr')
    expect(tones('192.168.1.1')).toBe('oooo')
  })

  // The decoy is not part of the address drawn, and its line strikes it through
  it('has nothing to colour for a decoy name before the @ of a link', () => {
    const markers = findDomainMarkers('evil.test', 'https://paypal.com@evil.test/')
    expect(markers.map(marker => marker.id)).toEqual(['url-userinfo'])
    expect(tones('evil.test', { markers })).toBe('--')
  })

  it('colours a well-known ending in the middle of an address domain orange', () => {
    expect(tones('pay.io.evil.test', { markers: [{ id: 'mid-ending', detail: 'io', at: 1 }] })).toBe('-o--')
    // Where the check found it, not the first label that reads the same
    expect(tones('io.pay.io.evil.io', { markers: [{ id: 'mid-ending', detail: 'io', at: 2 }] })).toBe('--o--')
  })

  describe('a lookalike', () => {
    it('colours the label the near miss is in, wherever it stands', () => {
      // The site's own name
      expect(withLookalikes('paypol.com')).toMatch(/^[ro]-$/)
      // A label in front of the site: the colour used to go to `evil` here
      expect(withLookalikes('paypol.evil.com')).toMatch(/^[ro]--$/)
      expect(withLookalikes('paypol.login.evil.co.uk')).toMatch(/^[ro]----$/)
      expect(withLookalikes('secure-paypal.evil.com')).toMatch(/^[ro]--$/)
    })

    it('colours the same label before and after the shape of the address is known', () => {
      for (const hostname of ['paypol.evil.com', 'secure-paypal.login.evil.co.uk', 'paypol.com'])
        expect(withLookalikes(hostname, false)).toBe(withLookalikes(hostname))
    })

    it('colours the ending where the name is the familiar one and only the ending differs', () => {
      const lookalikes = findLookalikes('paypal.co', index)
      expect(lookalikes.map(match => match.reason)).toEqual(['same-name'])
      expect(tones('paypal.co', { lookalikes })).toBe('-o')
      // Nothing until the site is known, so the colour does not start on the
      // name and jump to the ending
      expect(tones('paypal.co', { lookalikes, shape: false })).toBe('--')
    })

    it('colours the familiar domain parked in front, every copy of it', () => {
      expect(withLookalikes('paypal.com.evil.test')).toBe('rr--')
      expect(withLookalikes('paypal.com.paypal.com.evil.test')).toBe('rrrr--')
    })

    it('never colours the ending, which the check does not compare', () => {
      const devIndex = buildFamiliarIndex([{ domain: 'dev.to', label: 'dev', visits: 40 }])
      const lookalikes = findLookalikes('dev.example.dev', devIndex, 'example.dev')
      expect(lookalikes.map(match => match.evidence)).toEqual(['dev'])
      expect(tones('dev.example.dev', { lookalikes, markers: [] })).toBe('o--')
      // Nor before the shape of the address is known, so the colour does not jump
      expect(tones('dev.example.dev', { lookalikes, markers: [], shape: false })).toBe('o--')
    })

    it('colours every name a line gives', () => {
      const lookalikes = [{ domain: 'paypal.com', visits: 1, reason: 'familiar-as-subdomain' as const, evidence: 'paypal.com', severity: 'high' as const, also: [{ domain: 'google.com', evidence: 'google.com', visits: 1 }] }]
      expect(tones('paypal.com.google.com.verify.test', { lookalikes, markers: [] })).toBe('rrrr--')
    })

    it('colours a known domain spelled into a private ending whole', () => {
      const ruIndex = buildFamiliarIndex([{ domain: 'mail.ru', label: 'mail', visits: 40 }])
      const lookalikes = findLookalikes('mail.ru.com', ruIndex, 'mail.ru.com', 'ru.com')
      expect(lookalikes.map(match => match.evidence)).toEqual(['mail.ru'])
      expect(tones('mail.ru.com', { lookalikes, markers: [] })).toBe('rr-')
    })
  })

  it('colours a platform orange only while its line is on screen, and only at the end of the address', () => {
    expect(tones('someone.github.io', { platform: true })).toBe('-oo')
    expect(tones('someone.github.io', { platform: false })).toBe('---')
    expect(tones('github.com', { platform: true })).toBe('--')
    // The platform's name in front is somebody's label
    expect(tones('github.io.attacker.github.io', { platform: true, markers: [] })).toBe('---oo')
  })

  it('colours the whole site of a service the screen calls out, and not what is in front of it', () => {
    expect(tones('mailinator.com', { service: true })).toBe('oo')
    expect(tones('mx.mailinator.com', { service: true })).toBe('-oo')
    // Not until it is known where the site starts
    expect(tones('mx.mailinator.com', { service: true, shape: false })).toBe('---')
  })

  // The painter splits on the three other dots a browser reads as one
  it('counts labels as the painter does, over every kind of dot', () => {
    const markers = findDomainMarkers('paypal.com.evil.test')
    expect(tones('paypal。com.evil.test', { markers })).toBe('rr--')
    expect(tones('bit。ly', { service: true, markers: [] })).toBe(tones('bit.ly', { service: true }))
  })
})
