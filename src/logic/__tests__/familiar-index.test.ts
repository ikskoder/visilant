import { describe, expect, it } from 'vitest'
import { applyVisitToFamiliar, collectFamiliarDomains, FAMILIAR_INDEX_LIMIT } from '../familiar-index'

/** Stands in for tldts in the background; enough for the shapes used here. */
function toRegistrable(hostname: string): string | null {
  const labels = hostname.split('.')
  if (labels.length < 2)
    return null
  if (labels.length > 2 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3)
    return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

function record(count: number) {
  return { count, lastSeen: 0, ignored: false }
}

const options = { threshold: 10, toRegistrable }

describe('collectFamiliarDomains', () => {
  it('counts a domain family together, not each hostname separately', () => {
    // Someone who only ever opens mail.google.com still knows what google.com is
    const familiar = collectFamiliarDomains({
      'mail.google.com': record(6),
      'accounts.google.com': record(5),
    }, options)

    expect(familiar).toEqual([{ domain: 'google.com', label: 'google', visits: 11 }])
  })

  it('drops families below the threshold', () => {
    const familiar = collectFamiliarDomains({
      'example.com': record(9),
      'paypal.com': record(10),
    }, options)

    expect(familiar.map(entry => entry.domain)).toEqual(['paypal.com'])
  })

  it('ignores storage keys that are not visit records', () => {
    const familiar = collectFamiliarDomains({
      'settings': '{"safety":10}',
      'customShorteners': ['bit.ly'],
      '__visilantFamiliar': { domains: [], threshold: 10, builtAt: 0 },
      'localhost': record(500),
      'paypal.com': record(50),
    }, options)

    expect(familiar.map(entry => entry.domain)).toEqual(['paypal.com'])
  })

  it('handles multi-part suffixes', () => {
    const familiar = collectFamiliarDomains({ 'www.bbc.co.uk': record(40) }, options)
    expect(familiar).toEqual([{ domain: 'bbc.co.uk', label: 'bbc', visits: 40 }])
  })

  it('orders by how well the user knows each domain', () => {
    const familiar = collectFamiliarDomains({
      'a.com': record(20),
      'b.com': record(90),
      'c.com': record(50),
    }, options)

    expect(familiar.map(entry => entry.domain)).toEqual(['b.com', 'c.com', 'a.com'])
  })

  it('keeps the best-known domains when the history is larger than the cap', () => {
    const records: Record<string, unknown> = {}
    for (let i = 0; i < 50; i++)
      records[`site-${i}.com`] = record(i + 10)

    const familiar = collectFamiliarDomains(records, { ...options, limit: 5 })

    expect(familiar).toHaveLength(5)
    expect(familiar[0].domain).toBe('site-49.com')
  })

  it('has a cap in place by default', () => {
    expect(FAMILIAR_INDEX_LIMIT).toBeGreaterThan(0)
  })

  it('returns nothing for empty storage', () => {
    expect(collectFamiliarDomains({}, options)).toEqual([])
  })
})

describe('applyVisitToFamiliar', () => {
  it('counts one more visit for a domain already in the list', () => {
    const familiar = [{ domain: 'paypal.com', label: 'paypal', visits: 20 }]
    const added = applyVisitToFamiliar(familiar, 'paypal.com', 8, 10)

    // The family total stays ahead of the single hostname's count
    expect(familiar[0].visits).toBe(21)
    expect(added).toBe(false)
  })

  it('adds a domain once the visited hostname alone crosses the threshold', () => {
    const familiar = [{ domain: 'paypal.com', label: 'paypal', visits: 20 }]
    const added = applyVisitToFamiliar(familiar, 'example.com', 10, 10)

    expect(familiar.map(entry => entry.domain)).toEqual(['paypal.com', 'example.com'])
    expect(added).toBe(true)
  })

  it('leaves a domain out while it is still below the threshold', () => {
    const familiar = [{ domain: 'paypal.com', label: 'paypal', visits: 20 }]
    const added = applyVisitToFamiliar(familiar, 'example.com', 9, 10)

    expect(familiar).toHaveLength(1)
    expect(added).toBe(false)
  })
})
