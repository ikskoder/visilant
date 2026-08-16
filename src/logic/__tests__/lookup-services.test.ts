import { describe, expect, it } from 'vitest'
import { buildLookupUrl, DEFAULT_LOOKUP_SERVICES, getLookupServices, parseLookupServices, serializeLookupServices } from '../lookup-services'

describe('dEFAULT_LOOKUP_SERVICES', () => {
  it('every shipped entry is an https link with a placeholder', () => {
    for (const service of DEFAULT_LOOKUP_SERVICES) {
      expect(service.name).toBeTruthy()
      expect(service.url.startsWith('https://')).toBe(true)
      expect(service.url).toContain('{domain}')
    }
  })

  it('names are unique, since they are what the buttons say', () => {
    const names = DEFAULT_LOOKUP_SERVICES.map(service => service.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('parseLookupServices', () => {
  it('reads name and url off each line', () => {
    const parsed = parseLookupServices('Example | https://example.com/check/{domain}')
    expect(parsed).toEqual([{ name: 'Example', url: 'https://example.com/check/{domain}' }])
  })

  it('ignores blank lines and comments', () => {
    const parsed = parseLookupServices('\n# a note\nExample | https://example.com/{domain}\n\n')
    expect(parsed).toHaveLength(1)
  })

  it('refuses a line without the placeholder, which would ignore the domain', () => {
    expect(parseLookupServices('Example | https://example.com/')).toEqual([])
  })

  it('refuses anything that is not https', () => {
    expect(parseLookupServices('Example | http://example.com/{domain}')).toEqual([])
    expect(parseLookupServices('Example | javascript:alert(1){domain}')).toEqual([])
    expect(parseLookupServices('Example | data:text/html,{domain}')).toEqual([])
  })

  it('refuses a line with no name or no url', () => {
    expect(parseLookupServices('| https://example.com/{domain}')).toEqual([])
    expect(parseLookupServices('Example |')).toEqual([])
    expect(parseLookupServices('no separator here')).toEqual([])
  })

  it('keeps a url containing its own pipe-free query string', () => {
    const parsed = parseLookupServices('Example | https://example.com/s?q={domain}&mode=full')
    expect(parsed[0].url).toBe('https://example.com/s?q={domain}&mode=full')
  })
})

describe('serializeLookupServices', () => {
  it('round-trips through the editable text form', () => {
    expect(parseLookupServices(serializeLookupServices(DEFAULT_LOOKUP_SERVICES)))
      .toEqual(DEFAULT_LOOKUP_SERVICES)
  })
})

describe('getLookupServices', () => {
  it('reads whatever the user has configured', () => {
    expect(getLookupServices('Mine | https://mine.example/{domain}'))
      .toEqual([{ name: 'Mine', url: 'https://mine.example/{domain}' }])
  })

  it('shows nothing when the field is empty, rather than restoring the defaults', () => {
    // The field is seeded with the shipped list as plain text, so an empty field
    // means the user deleted every line – quietly bringing them back would make
    // that impossible
    expect(getLookupServices('')).toEqual([])
    expect(getLookupServices(undefined)).toEqual([])
    expect(getLookupServices('   \n  ')).toEqual([])
  })

  it('keeps the lines that parse when others do not', () => {
    const services = getLookupServices('garbage\nMine | https://mine.example/{domain}')
    expect(services).toHaveLength(1)
  })
})

describe('buildLookupUrl', () => {
  const service = { name: 'Example', url: 'https://example.com/check/{domain}' }

  it('substitutes the domain', () => {
    expect(buildLookupUrl(service, 'paypal.com')).toBe('https://example.com/check/paypal.com')
  })

  it('normalises case and a trailing dot', () => {
    expect(buildLookupUrl(service, 'PayPal.COM.')).toBe('https://example.com/check/paypal.com')
  })

  it('encodes the domain so a hostile name cannot reshape the url', () => {
    // Dots survive encoding and are harmless on their own. What matters is that
    // the separators do not, so nothing can escape the position it was put in
    const built = buildLookupUrl(service, 'evil.com/../../admin?x=1&y=2#z')

    expect(built).toBe('https://example.com/check/evil.com%2F..%2F..%2Fadmin%3Fx%3D1%26y%3D2%23z')
    expect(new URL(built!).pathname).toBe('/check/evil.com%2F..%2F..%2Fadmin%3Fx%3D1%26y%3D2%23z')
    expect(new URL(built!).search).toBe('')
  })

  it('substitutes every occurrence', () => {
    const twice = { name: 'Twice', url: 'https://example.com/{domain}?also={domain}' }
    expect(buildLookupUrl(twice, 'a.com')).toBe('https://example.com/a.com?also=a.com')
  })

  it('returns null for anything that is not a domain', () => {
    expect(buildLookupUrl(service, 'localhost')).toBeNull()
    expect(buildLookupUrl(service, '')).toBeNull()
    expect(buildLookupUrl(service, '   ')).toBeNull()
  })
})
