import { describe, expect, it } from 'vitest'
import { applyVisitToFamiliar, collectFamiliarDomains, FAMILIAR_INDEX_LIMIT } from '../familiar-index'
import { defaultFamiliaritySettings } from '../familiarity'

/** Stands in for tldts in the background; enough for the shapes used here. */
function toRegistrable(hostname: string): string | null {
  const labels = hostname.split('.')
  if (labels.length < 2)
    return null
  if (labels.length > 2 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3)
    return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

function record(count: number, extra: { activeDays?: number, firstSeen?: number } = {}) {
  return { count, lastSeen: 0, ignored: false, ...extra }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

/**
 * Visits only, at 10. The shipped rules ask all three checks, which these cases
 * cannot answer – their records carry a visit count and nothing else, and that
 * is exactly the shape this index has to handle.
 */
const rules = {
  ...defaultFamiliaritySettings,
  activeDays: { ...defaultFamiliaritySettings.activeDays, enabled: false },
  age: { ...defaultFamiliaritySettings.age, enabled: false },
}
const options = { rules, toRegistrable, now: NOW }

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

  it('judges a family by every rule the user turned on', () => {
    // Visits pass on both, but only paypal.com has been known long enough
    const strict = {
      ...options,
      rules: {
        ...rules,
        age: { enabled: true, min: 30 },
      },
    }

    const familiar = collectFamiliarDomains({
      'paypal.com': record(40, { firstSeen: NOW - 60 * DAY }),
      'example.com': record(40, { firstSeen: NOW - 3 * DAY }),
    }, strict)

    expect(familiar.map(entry => entry.domain)).toEqual(['paypal.com'])
  })

  it('takes the family’s earliest first visit and its busiest member’s days', () => {
    const strict = {
      ...options,
      rules: {
        ...rules,
        visits: { enabled: true, min: 10 },
        activeDays: { enabled: true, min: 12 },
        age: { enabled: true, min: 30 },
      },
    }

    const familiar = collectFamiliarDomains({
      // Neither hostname clears the active-day bar on the count it holds, but the
      // family is judged on its largest, and on the older of the two dates
      'mail.google.com': record(6, { activeDays: 12, firstSeen: NOW - 10 * DAY }),
      'accounts.google.com': record(5, { activeDays: 4, firstSeen: NOW - 200 * DAY }),
    }, strict)

    expect(familiar).toEqual([{ domain: 'google.com', label: 'google', visits: 11 }])
  })

  it('fails a criterion the records cannot answer', () => {
    // An old record with no active-day count is not waived through
    const strict = { ...options, rules: { ...rules, activeDays: { enabled: true, min: 3 } } }

    expect(collectFamiliarDomains({ 'paypal.com': record(500) }, strict)).toEqual([])
  })
})

describe('applyVisitToFamiliar', () => {
  it('counts one more visit for a domain already in the list', () => {
    const familiar = [{ domain: 'paypal.com', label: 'paypal', visits: 20 }]
    const added = applyVisitToFamiliar(familiar, 'paypal.com', { count: 8 }, rules, NOW)

    // The family total stays ahead of the single hostname's count
    expect(familiar[0].visits).toBe(21)
    expect(added).toBe(false)
  })

  it('adds a domain once the visited hostname alone clears the rules', () => {
    const familiar = [{ domain: 'paypal.com', label: 'paypal', visits: 20 }]
    const added = applyVisitToFamiliar(familiar, 'example.com', { count: 10 }, rules, NOW)

    expect(familiar.map(entry => entry.domain)).toEqual(['paypal.com', 'example.com'])
    expect(added).toBe(true)
  })

  it('leaves a domain out while it is still below the threshold', () => {
    const familiar = [{ domain: 'paypal.com', label: 'paypal', visits: 20 }]
    const added = applyVisitToFamiliar(familiar, 'example.com', { count: 9 }, rules, NOW)

    expect(familiar).toHaveLength(1)
    expect(added).toBe(false)
  })

  it('holds a domain back until every enabled rule is met', () => {
    const strict = { ...rules, activeDays: { enabled: true, min: 5 } }
    const familiar: { domain: string, label: string, visits: number }[] = []

    expect(applyVisitToFamiliar(familiar, 'example.com', { count: 40, activeDays: 2 }, strict, NOW)).toBe(false)
    expect(applyVisitToFamiliar(familiar, 'example.com', { count: 40, activeDays: 5 }, strict, NOW)).toBe(true)
  })
})

describe('applyVisitToFamiliar and the debounce', () => {
  it('does not raise the ranking for a reload that was not counted as a visit', () => {
    const familiar = [{ domain: 'example.com', label: 'example', visits: 40 }]

    // Three page loads inside the debounce window: the stored record stands
    // still at 40, and so must the entry that ranks it
    for (let i = 0; i < 3; i++)
      applyVisitToFamiliar(familiar, 'example.com', record(40), rules, NOW, false)

    expect(familiar[0].visits).toBe(40)
  })

  it('raises it for a visit that was counted', () => {
    const familiar = [{ domain: 'example.com', label: 'example', visits: 40 }]
    applyVisitToFamiliar(familiar, 'example.com', record(41), rules, NOW, true)
    expect(familiar[0].visits).toBe(41)
  })

  // The family is a sum over its hostnames, so one hostname own count is a
  // floor rather than the answer
  it('never drops below the count that hostname already has', () => {
    const familiar = [{ domain: 'example.com', label: 'example', visits: 5 }]
    applyVisitToFamiliar(familiar, 'example.com', record(80), rules, NOW, false)
    expect(familiar[0].visits).toBe(80)
  })
})
