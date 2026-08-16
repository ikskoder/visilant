import type { FamiliarDomain } from '../domain-similarity'
import { describe, expect, it } from 'vitest'
import { boundedEditDistance, buildFamiliarIndex, findLookalikes, skeleton } from '../domain-similarity'
import { getProviderReferenceDomains } from '../email-providers'

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

describe('findLookalikes – attack shapes that must be caught', () => {
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

  // A letter dropped from a five-letter name leaves four, and the length guard
  // used to be applied to that result rather than to the name being imitated –
  // which dismissed the most ordinary typosquat there is
  describe('a letter dropped from an already short name', () => {
    const providers = buildFamiliarIndex([
      { domain: 'gmail.com', label: 'gmail', visits: 500 },
      { domain: 'mail.ru', label: 'mail', visits: 120 },
    ])

    it('catches the address the dropped letter leaves behind', () => {
      const [match] = findLookalikes('gmal.com', providers)
      expect(match.domain).toBe('gmail.com')
      expect(match.reason).toBe('edit-distance')
      expect(match.severity).toBe('high')
    })

    it('catches a letter dropped off the end just the same', () => {
      expect(findLookalikes('gmai.com', providers)[0]?.domain).toBe('gmail.com')
    })

    it('stays quiet about a short address two edits away', () => {
      // `gnal` reaches `gmail` only by substituting and then deleting, which is
      // as easily two unrelated words as it is a typo
      expect(findLookalikes('gnal.com', providers)).toEqual([])
    })

    it('stays quiet about a short word that merely ends the same way', () => {
      // `mall` and `gmail` come out one edit apart once `i` and `l` fold
      // together, so the shared first letter is what has to carry it
      expect(findLookalikes('mall.com', providers).map(m => m.reason)).not.toContain('edit-distance')
    })

    it('still says nothing about two unrelated short names', () => {
      expect(findLookalikes('yolo.com', providers)).toEqual([])
    })
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

describe('findLookalikes – the same name under a different domain', () => {
  it('reports a TLD squat', () => {
    const [match] = check('paypal.co')
    expect(match.domain).toBe('paypal.com')
    expect(match.reason).toBe('same-name')
  })

  it('never lets it interrupt, because a brand country site looks identical', () => {
    // Nothing local can separate paypal.co from google.de. Both are shown as
    // context, and neither is allowed to raise a high-severity warning.
    expect(check('paypal.co')[0].severity).toBe('medium')
    expect(check('google.de')[0].severity).toBe('medium')
  })

  it('goes quiet once the user knows that domain too', () => {
    const withBoth = buildFamiliarIndex([...FAMILIAR, { domain: 'google.de', label: 'google', visits: 45 }])
    expect(findLookalikes('google.de', withBoth)).toEqual([])
  })
})

describe('findLookalikes – things that must stay quiet', () => {
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
    // does contain "amazon". Both are reported – recall was chosen over precision
    // – but neither is allowed to interrupt anyone.
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

describe('findLookalikes – ranking and shape of the result', () => {
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

describe('findLookalikes – cost', () => {
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

describe('mail providers as a second reference set', () => {
  const providers = getProviderReferenceDomains()

  it('keeps the distinctive provider names', () => {
    const domains = providers.map(entry => entry.domain)
    expect(domains).toContain('gmail.com')
    expect(domains).toContain('outlook.com')
    expect(domains).toContain('yandex.ru')
  })

  it('drops the ones named after an ordinary word', () => {
    // `mail.com`, `free.fr` and the like would flag unrelated domains constantly
    const domains = providers.map(entry => entry.domain)
    expect(domains).not.toContain('mail.com')
    expect(domains).not.toContain('web.de')
    expect(domains).not.toContain('hey.com')
  })

  // The case the whole exception exists for: Gmail redirects to
  // `mail.google.com`, so no amount of use ever puts `gmail.com` in the history
  const livesInGmail = buildFamiliarIndex([
    { domain: 'google.com', label: 'google', visits: 2206 },
    ...providers.map(entry => ({ ...entry, visits: 0, source: 'provider' as const })),
  ])

  it('catches a typo of a provider the history cannot know about', () => {
    const [match] = findLookalikes('gmal.com', livesInGmail)
    expect(match.domain).toBe('gmail.com')
    expect(match.source).toBe('provider')
  })

  it('catches a digit standing in for a letter just the same', () => {
    const [match] = findLookalikes('gma1l.com', livesInGmail)
    expect(match.domain).toBe('gmail.com')
    expect(match.reason).toBe('confusable')
  })

  it('leaves history matches marked as history', () => {
    const [match] = findLookalikes('gogle.com', livesInGmail)
    expect(match.domain).toBe('google.com')
    expect(match.source).toBeUndefined()
  })

  it('says nothing about the provider itself', () => {
    expect(findLookalikes('gmail.com', livesInGmail)).toEqual([])
  })

  it('keeps the real visit count for a provider the user does visit', () => {
    // History first, so the entry that carries a count is the one that survives
    const alsoVisitsIt = buildFamiliarIndex([
      { domain: 'yandex.ru', label: 'yandex', visits: 88 },
      ...providers.map(entry => ({ ...entry, visits: 0, source: 'provider' as const })),
    ])
    const [match] = findLookalikes('yadnex.ru', alsoVisitsIt)
    expect(match.domain).toBe('yandex.ru')
    expect(match.visits).toBe(88)
    expect(match.source).toBeUndefined()
  })
})

// Two short names carry too little to judge by length alone, and padding them
// with their shared suffix only looks like more evidence – `moz.gov.ua` and
// `mon.gov.ua` differ by one character over ten and are two different ministries
describe('two short names against each other', () => {
  const shortNames = buildFamiliarIndex([
    { domain: 'nszu.gov.ua', label: 'nszu', visits: 40 },
    { domain: 'moz.gov.ua', label: 'moz', visits: 30 },
    { domain: 'cutt.ly', label: 'cutt', visits: 20 },
    { domain: 'work.ua', label: 'work', visits: 50 },
    { domain: 'fex.net', label: 'fex', visits: 25 },
  ])

  function shortCheck(hostname: string) {
    return findLookalikes(hostname, shortNames)
  }

  it('catches a dropped character', () => {
    expect(shortCheck('nsz.gov.ua')[0]?.domain).toBe('nszu.gov.ua')
    expect(shortCheck('cut.ly')[0]?.domain).toBe('cutt.ly')
    expect(shortCheck('wor.ua')[0]?.domain).toBe('work.ua')
  })

  it('catches a doubled character', () => {
    expect(shortCheck('mozz.gov.ua')[0]?.domain).toBe('moz.gov.ua')
    expect(shortCheck('fexx.net')[0]?.domain).toBe('fex.net')
  })

  it('catches a transposition', () => {
    expect(shortCheck('nzsu.gov.ua')[0]?.domain).toBe('nszu.gov.ua')
    expect(shortCheck('wrok.ua')[0]?.domain).toBe('work.ua')
  })

  it('never raises these above a mention', () => {
    // A short name has no room to be sure with, so the colour must not say it is
    expect(shortCheck('nsz.gov.ua')[0]?.severity).toBe('medium')
    expect(shortCheck('cut.ly')[0]?.severity).toBe('medium')
  })

  it('stays silent when one letter simply stands where another did', () => {
    // Real neighbours of moz.gov.ua, each a ministry of its own
    expect(shortCheck('mon.gov.ua')).toEqual([])
    expect(shortCheck('mvs.gov.ua')).toEqual([])
    expect(shortCheck('word.ua')).toEqual([])
    expect(shortCheck('fox.net')).toEqual([])
  })

  it('recognises a short name standing alone as a token', () => {
    const [match] = shortCheck('moz-login.gov.ua')
    expect(match.domain).toBe('moz.gov.ua')
    expect(match.reason).toBe('contains-familiar')
    expect(match.severity).toBe('high')
    expect(shortCheck('nszu-login.gov.ua')[0]?.domain).toBe('nszu.gov.ua')
  })

  it('does not go hunting for a short name inside a longer word', () => {
    // `moz` is in `mozilla`, and that means nothing at all
    expect(shortCheck('mozilla.org')).toEqual([])
    expect(shortCheck('workspace.ua')).toEqual([])
  })
})
