import { describe, expect, it } from 'vitest'
import { belongsToSite, hostingPlatform, isPlatformTenant, siteDomain, siteDomainOrSelf, visitKey } from '../domain-boundary'

describe('siteDomain', () => {
  it('keeps two tenants of one platform apart', () => {
    // The whole point: with the default list both of these come back as
    // `github.io`, so one tenant's visits vouch for the other's
    expect(siteDomain('alice.github.io')).toBe('alice.github.io')
    expect(siteDomain('evil.github.io')).toBe('evil.github.io')
    expect(siteDomain('alice.github.io')).not.toBe(siteDomain('evil.github.io'))
  })

  it('folds a tenant subdomain into its tenant', () => {
    expect(siteDomain('blog.alice.github.io')).toBe('alice.github.io')
  })

  it.each([
    ['my.vercel.app', 'my.vercel.app'],
    ['someone.pages.dev', 'someone.pages.dev'],
    ['someone.blogspot.com', 'someone.blogspot.com'],
    ['app.netlify.app', 'app.netlify.app'],
    ['thing.workers.dev', 'thing.workers.dev'],
  ])('separates tenants on %s', (hostname, expected) => {
    expect(siteDomain(hostname)).toBe(expected)
  })

  it('leaves an ordinary registrable domain alone', () => {
    expect(siteDomain('a.b.example.com')).toBe('example.com')
    expect(siteDomain('shop.example.co.uk')).toBe('example.co.uk')
  })

  it('has no answer for an address that is not a site', () => {
    expect(siteDomain('1.2.3.4')).toBeNull()
    expect(siteDomain('2606:4700::1111')).toBeNull()
    expect(siteDomain('localhost')).toBeNull()
    // A platform suffix on its own is not a tenant of anything
    expect(siteDomain('github.io')).toBeNull()
  })

  it('falls back to the name itself, so those do not all share one bucket', () => {
    expect(siteDomainOrSelf('1.2.3.4')).toBe('1.2.3.4')
    expect(siteDomainOrSelf('10.0.0.5')).toBe('10.0.0.5')
    expect(siteDomainOrSelf('github.io')).toBe('github.io')
  })
})

describe('hostingPlatform', () => {
  it('names the landlord of a tenant', () => {
    expect(hostingPlatform('alice.github.io')).toBe('github.io')
    expect(hostingPlatform('x.s3.amazonaws.com')).toBe('s3.amazonaws.com')
  })

  it('has nothing to name for a name registered directly', () => {
    expect(hostingPlatform('example.com')).toBeNull()
    expect(hostingPlatform('example.co.uk')).toBeNull()
    expect(hostingPlatform('1.2.3.4')).toBeNull()
  })

  it('answers the same question as isPlatformTenant', () => {
    expect(isPlatformTenant('alice.github.io')).toBe(true)
    expect(isPlatformTenant('example.com')).toBe(false)
  })
})

describe('belongsToSite', () => {
  it('accepts the site and its subdomains', () => {
    expect(belongsToSite('example.com', 'example.com')).toBe(true)
    expect(belongsToSite('mail.example.com', 'example.com')).toBe(true)
  })

  it('rejects a name that only ends in the same letters', () => {
    expect(belongsToSite('notexample.com', 'example.com')).toBe(false)
    expect(belongsToSite('evil.github.io', 'alice.github.io')).toBe(false)
  })
})

describe('visitKey', () => {
  it('counts www. and the bare name as one site', () => {
    expect(visitKey('www.example.com')).toBe('example.com')
    expect(visitKey('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(visitKey('www.alice.github.io')).toBe('alice.github.io')
    expect(visitKey('example.com')).toBe('example.com')
  })

  it('leaves a name alone when cutting the prefix would leave no site behind', () => {
    // A registered name of its own, a country suffix, a platform suffix
    expect(visitKey('www.com')).toBe('www.com')
    expect(visitKey('www.co.uk')).toBe('www.co.uk')
    expect(visitKey('www.github.io')).toBe('www.github.io')
    expect(visitKey('www.blogspot.com')).toBe('www.blogspot.com')
    // An address, and a name with no dot left
    expect(visitKey('www.1.2.3.4')).toBe('www.1.2.3.4')
    expect(visitKey('www.localhost')).toBe('www.localhost')
    expect(visitKey('www')).toBe('www')
  })

  it('cuts only the www label itself', () => {
    expect(visitKey('www2.example.com')).toBe('www2.example.com')
    expect(visitKey('wwww.example.com')).toBe('wwww.example.com')
    expect(visitKey('mail.example.com')).toBe('mail.example.com')
    expect(visitKey('mail.www.example.com')).toBe('mail.www.example.com')
  })

  // A key travels between contexts and is folded again on the way, so folding
  // twice has to change nothing
  it('gives the same answer however many times it is asked', () => {
    for (const name of ['www.www.example.com', 'www.example.com', 'www.com', 'WWW.Example.COM', 'www.example.com.', 'www.example.com:8080']) {
      const once = visitKey(name)
      expect(visitKey(once)).toBe(once)
    }
    expect(visitKey('www.www.example.com')).toBe('example.com')
  })

  it('folds case, since the stored keys are lower case', () => {
    expect(visitKey('WWW.Example.COM')).toBe('example.com')
  })
})
