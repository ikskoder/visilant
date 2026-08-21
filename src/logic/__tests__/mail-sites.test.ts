import { afterEach, describe, expect, it } from 'vitest'
import { defaultFamiliaritySettings } from '../familiarity'
import {
  collectMailSiteFamilies,
  formatMailSiteMap,
  loadCustomMailSites,
  parseMailSiteMap,
  resolveMailSites,
  updateRemoteMailSites,
} from '../mail-sites'

function record(count: number, extra: { activeDays?: number, firstSeen?: number } = {}) {
  return { count, lastSeen: 0, ignored: false, ...extra }
}

/** Visits only – the fixtures below carry a count and nothing else. */
const VISITS_ONLY = {
  ...defaultFamiliaritySettings,
  visits: { ...defaultFamiliaritySettings.visits, enabled: true, min: 5 },
  activeDays: { ...defaultFamiliaritySettings.activeDays, enabled: false },
  age: { ...defaultFamiliaritySettings.age, enabled: false },
}

afterEach(() => {
  loadCustomMailSites([])
  updateRemoteMailSites([])
})

describe('parseMailSiteMap', () => {
  it('reads every separator a line might be written with', () => {
    const map = parseMailSiteMap([
      'a.com = one.example',
      'b.com -> two.example',
      'c.com three.example',
      '@d.com = four.example, five.example',
    ].join('\n'))

    expect(map.get('a.com')).toEqual(['one.example'])
    expect(map.get('b.com')).toEqual(['two.example'])
    expect(map.get('c.com')).toEqual(['three.example'])
    expect(map.get('d.com')).toEqual(['four.example', 'five.example'])
  })

  it('skips comments, blanks and half-written lines', () => {
    const map = parseMailSiteMap([
      '# a comment',
      '',
      'nodot = one.example',
      'a.com =',
      'a.com = nodot',
      'good.com = site.example',
    ].join('\n'))

    expect([...map.keys()]).toEqual(['good.com'])
  })

  it('strips a protocol and path from a site written as a URL', () => {
    const map = parseMailSiteMap('a.com = https://mail.example.org/inbox')
    expect(map.get('a.com')).toEqual(['mail.example.org'])
  })

  it('merges repeated keys instead of dropping the earlier line', () => {
    const map = parseMailSiteMap('a.com = one.example\na.com = two.example, one.example')
    expect(map.get('a.com')).toEqual(['one.example', 'two.example'])
  })

  it('round-trips through the text form', () => {
    const text = formatMailSiteMap(parseMailSiteMap('a.com = one.example, two.example'))
    expect(text).toBe('a.com = one.example, two.example')
  })
})

describe('resolveMailSites', () => {
  it('knows the brands whose mail lives under another name', () => {
    // The mailbox, not the brand: knowing google.com says nothing about Gmail
    expect(resolveMailSites('gmail.com')).toEqual(['mail.google.com'])
    expect(resolveMailSites('GMAIL.COM')).toEqual(['mail.google.com'])
    expect(resolveMailSites('pm.me')).toEqual(['mail.proton.me'])
  })

  it('drops a site that is the address domain itself', () => {
    // me.com maps to icloud.com, which is a site of its own – but icloud.com as
    // an address domain is already the family the panel shows
    expect(resolveMailSites('me.com')).toEqual(['icloud.com'])
    expect(resolveMailSites('icloud.com')).toEqual([])
  })

  it('says nothing about a domain that is a site in its own right', () => {
    expect(resolveMailSites('example.com')).toEqual([])
    expect(resolveMailSites('qq.com')).toEqual([])
  })

  it('adds the user\'s own lines to the built-in table', () => {
    loadCustomMailSites(['work.example = portal.example.org', 'gmail.com = inbox.google.com'])

    expect(resolveMailSites('work.example')).toEqual(['portal.example.org'])
    expect(resolveMailSites('gmail.com')).toEqual(['mail.google.com', 'inbox.google.com'])
  })

  it('adds fetched lines the same way', () => {
    updateRemoteMailSites(['fetched.example = site.example'])
    expect(resolveMailSites('fetched.example')).toEqual(['site.example'])
  })
})

describe('collectMailSiteFamilies', () => {
  const records = {
    'google.com': record(12),
    'mail.google.com': record(340),
    'mail.google.com.evil.example': record(7),
    'settings': { theme: 'dark' },
  }

  it('counts the mailbox and what sits under it, and nothing wider', () => {
    const [family] = collectMailSiteFamilies(records, 'gmail.com', VISITS_ONLY)

    expect(family.site).toBe('mail.google.com')
    // Searches on google.com are not visits to the mailbox, and a lookalike
    // hostname that merely starts the same is not one either
    expect(family.total).toBe(340)
    expect(family.familiar).toBe(true)
  })

  it('keeps a site with no visits rather than staying silent about it', () => {
    const [family] = collectMailSiteFamilies({}, 'gmail.com', VISITS_ONLY)

    expect(family.site).toBe('mail.google.com')
    expect(family.total).toBe(0)
    expect(family.familiar).toBe(false)
  })

  it('returns nothing for a domain with no mapping', () => {
    expect(collectMailSiteFamilies(records, 'example.com', VISITS_ONLY)).toEqual([])
  })

  it('leaves the verdict out when no rules are given', () => {
    const [family] = collectMailSiteFamilies(records, 'gmail.com')
    expect(family.familiar).toBeUndefined()
  })
})
