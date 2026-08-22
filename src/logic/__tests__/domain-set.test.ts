import { describe, expect, it } from 'vitest'
import { matchesDomainSet } from '../domain-set'

const set = new Set(['bit.ly', 'example.co.uk', 'mail.google.com'])

describe('matchesDomainSet', () => {
  it('matches the domain itself', () => {
    expect(matchesDomainSet('bit.ly', set)).toBe(true)
    expect(matchesDomainSet('mail.google.com', set)).toBe(true)
  })

  it('matches a subdomain of an entry, however deep', () => {
    expect(matchesDomainSet('custom.bit.ly', set)).toBe(true)
    expect(matchesDomainSet('a.b.c.example.co.uk', set)).toBe(true)
  })

  it('does not match a parent of an entry', () => {
    expect(matchesDomainSet('google.com', set)).toBe(false)
    expect(matchesDomainSet('ly', set)).toBe(false)
  })

  // The trap in matching by `endsWith` on the whole string rather than by label
  it('does not match a name that merely ends in the same letters', () => {
    expect(matchesDomainSet('notbit.ly', set)).toBe(false)
    expect(matchesDomainSet('evil-bit.ly.attacker.test', set)).toBe(false)
  })

  it('handles a name with no dots and an empty set', () => {
    expect(matchesDomainSet('localhost', set)).toBe(false)
    expect(matchesDomainSet('bit.ly', new Set())).toBe(false)
  })
})
