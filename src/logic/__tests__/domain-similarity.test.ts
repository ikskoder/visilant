import type { FamiliarDomain } from '../domain-similarity'
import { describe, expect, it } from 'vitest'
import { boundedEditDistance, buildFamiliarIndex, findLookalikes, skeleton } from '../domain-similarity'

/** A plausible set of domains someone visits often, used by every case below. */
const FAMILIAR: FamiliarDomain[] = [
  { domain: 'paypal.com', label: 'paypal', visits: 184 },
  { domain: 'google.com', label: 'google', visits: 530 },
  { domain: 'sberbank.ru', label: 'sberbank', visits: 92 },
  { domain: 'github.com', label: 'github', visits: 410 },
  { domain: 'wikipedia.org', label: 'wikipedia', visits: 77 },
  { domain: 'amazon.com', label: 'amazon', visits: 65 },
  { domain: 'microsoft.com', label: 'microsoft', visits: 40 },
  { domain: 'vk.com', label: 'vk', visits: 300 },
  { domain: 'mail.ru', label: 'mail', visits: 120 },
]

const index = buildFamiliarIndex(FAMILIAR)

function check(hostname: string) {
  return findLookalikes(hostname, index)
}

function domainsMatched(hostname: string) {
  return check(hostname).map(match => match.domain)
}

describe('skeleton', () => {
  it('folds digits that stand in for letters', () => {
    expect(skeleton('paypa1')).toBe(skeleton('paypal'))
    expect(skeleton('g00gle')).toBe(skeleton('google'))
    expect(skeleton('amaz0n')).toBe(skeleton('amazon'))
  })

  it('folds Cyrillic homoglyphs onto their Latin twins', () => {
    expect(skeleton('pаypal')).toBe(skeleton('paypal'))
    expect(skeleton('gооgle')).toBe(skeleton('google'))
  })

  it('folds digraphs that read as one letter', () => {
    expect(skeleton('rnicrosoft')).toBe(skeleton('microsoft'))
  })

  it('leaves unrelated names apart', () => {
    expect(skeleton('paypal')).not.toBe(skeleton('google'))
  })
})

describe('boundedEditDistance', () => {
  it('counts a transposition as one edit', () => {
    expect(boundedEditDistance('payapl', 'paypal', 2)).toBe(1)
  })

  it('counts insertions, deletions and substitutions', () => {
    expect(boundedEditDistance('paypall', 'paypal', 2)).toBe(1)
    expect(boundedEditDistance('papal', 'paypal', 2)).toBe(1)
    expect(boundedEditDistance('paypol', 'paypal', 2)).toBe(1)
  })

  it('gives up once the budget is exceeded', () => {
    expect(boundedEditDistance('completely', 'different', 2)).toBe(3)
  })

  it('short-circuits on a length gap larger than the budget', () => {
    expect(boundedEditDistance('a', 'abcdefgh', 2)).toBe(3)
  })

  it('handles identical and empty input', () => {
    expect(boundedEditDistance('paypal', 'paypal', 2)).toBe(0)
    expect(boundedEditDistance('', '', 2)).toBe(0)
    expect(boundedEditDistance('ab', '', 2)).toBe(2)
  })
})

describe('findLookalikes — attack shapes that must be caught', () => {
  it('catches digit substitution', () => {
    const [match] = check('paypa1.com')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('confusable')
    expect(match.severity).toBe('high')
  })

  it('catches a Cyrillic homoglyph', () => {
    const [match] = check('pаypal.com')
    expect(match.domain).toBe('paypal.com')
    expect(match.severity).toBe('high')
  })

  it('catches a transposition', () => {
    const [match] = check('payapl.com')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('edit-distance')
    expect(match.severity).toBe('high')
  })

  it('catches a dropped letter', () => {
    expect(domainsMatched('gogle.com')).toContain('google.com')
  })

  it('catches a doubled letter', () => {
    expect(domainsMatched('githubb.com')).toContain('github.com')
  })

  it('catches the familiar name padded with a separator', () => {
    const [match] = check('paypal-secure.com')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('contains-familiar')
    expect(match.severity).toBe('high')
  })

  it('catches the familiar name padded without a separator', () => {
    const [match] = check('googlesupport.com')
    expect(match.domain).toBe('google.com')
    expect(match.reason).toBe('contains-familiar')
  })

  it('catches a familiar name in front of the real domain', () => {
    expect(domainsMatched('sberbank-login.example.net')).toContain('sberbank.ru')
  })

  it('catches a whole familiar domain used as a subdomain', () => {
    const [match] = check('paypal.com.security-check.example.net')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('familiar-as-subdomain')
    expect(match.severity).toBe('high')
  })

  it('catches a familiar name hidden deep in the subdomains', () => {
    expect(domainsMatched('login.microsoft-account.example.net')).toContain('microsoft.com')
  })

  it('catches a punycode-encoded homoglyph, since that is how links arrive', () => {
    // xn--pypal-4ve.com renders as pаypal.com with a Cyrillic а
    expect(domainsMatched('xn--pypal-4ve.com')).toContain('paypal.com')
  })

  it('catches the exact familiar name used as a subdomain of something else', () => {
    const [match] = check('paypal.evil-example.net')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('familiar-as-subdomain')
    expect(match.severity).toBe('high')
  })
})

describe('findLookalikes — the same name under a different domain', () => {
  it('reports a TLD squat', () => {
    const [match] = check('paypal.co')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('same-name')
  })

  it('never lets it interrupt, because a brand country site looks identical', () => {
    // Nothing local can separate paypal.co from google.de. Both are shown as
    // context; neither is allowed to raise a high-severity warning.
    expect(check('paypal.co')[0].severity).toBe('medium')
    expect(check('google.de')[0].severity).toBe('medium')
  })

  it('goes quiet once the user knows that domain too', () => {
    const withBoth = buildFamiliarIndex([...FAMILIAR, { domain: 'google.de', label: 'google', visits: 45 }])
    expect(findLookalikes('google.de', withBoth)).toEqual([])
  })
})

describe('findLookalikes — things that must stay quiet', () => {
  it('says nothing about a familiar domain itself', () => {
    expect(check('paypal.com')).toEqual([])
    expect(check('google.com')).toEqual([])
  })

  it('says nothing about a subdomain of a familiar domain', () => {
    expect(check('accounts.google.com')).toEqual([])
    expect(check('www.paypal.com')).toEqual([])
  })

  it('says nothing about unrelated domains', () => {
    expect(check('example.com')).toEqual([])
    expect(check('news.ycombinator.com')).toEqual([])
    expect(check('stackoverflow.com')).toEqual([])
  })

  it('does not match short familiar names inside unrelated words', () => {
    // `vk` and `mail` are familiar, but must not fire on every word containing them
    expect(domainsMatched('bokforing.se')).not.toContain('vk.com')
    expect(domainsMatched('mailchimp.com')).not.toContain('mail.ru')
  })

  it('keeps genuinely similar but unrelated names quiet rather than silent', () => {
    // gitlab.com really is two edits from github.com, and amazonas.gov.br really
    // does contain "amazon". Both are reported — recall was chosen over precision
    // — but neither is allowed to interrupt anyone.
    expect(check('gitlab.com').every(match => match.severity === 'medium')).toBe(true)
    expect(check('amazonas.gov.br').every(match => match.severity === 'medium')).toBe(true)
  })

  it('ignores addresses that cannot resemble a domain', () => {
    expect(check('localhost')).toEqual([])
    expect(check('')).toEqual([])
  })

  it('reports nothing when the user has no familiar domains yet', () => {
    expect(findLookalikes('paypa1.com', buildFamiliarIndex([]))).toEqual([])
  })
})

describe('findLookalikes — ranking and shape of the result', () => {
  it('puts the strongest match first', () => {
    const matches = check('paypal.com.google-secure.example.net')
    expect(matches[0].severity).toBe('high')
  })

  it('breaks ties by how well the user knows the domain', () => {
    const matches = findLookalikes('xxxxx-paypal-google.example.net', index)
    const [first, second] = matches
    if (first && second && first.severity === second.severity)
      expect(first.visits).toBeGreaterThanOrEqual(second.visits)
  })

  it('reports each familiar domain at most once', () => {
    const matches = check('paypal.paypal-login.example.net')
    const domains = matches.map(match => match.domain)
    expect(new Set(domains).size).toBe(domains.length)
  })

  it('caps the number of matches', () => {
    const matches = check('paypal-google-github-amazon-microsoft.example.net')
    expect(matches.length).toBeLessThanOrEqual(3)
  })

  it('carries the part of the address that produced the match', () => {
    const [match] = check('paypal-secure.com')
    expect(match.evidence).toBe('paypal-secure')
  })
})

describe('findLookalikes — cost', () => {
  it('stays fast against a large index', () => {
    const many: FamiliarDomain[] = Array.from({ length: 2000 }, (_, i) => ({
      domain: `familiar-site-${i}.com`,
      label: `familiar-site-${i}`,
      visits: i,
    }))
    const bigIndex = buildFamiliarIndex([...many, ...FAMILIAR])

    const started = performance.now()
    for (let i = 0; i < 200; i++)
      findLookalikes('login.paypa1-secure.example.net', bigIndex)
    const perCall = (performance.now() - started) / 200

    // Budget is generous next to the sub-millisecond target, so the test fails on
    // an algorithmic regression rather than on a slow CI machine
    expect(perCall).toBeLessThan(5)
  })
})
