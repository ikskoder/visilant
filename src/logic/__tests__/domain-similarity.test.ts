import type { FamiliarDomain } from '../domain-similarity'
import punycode from 'punycode'
import { describe, expect, it } from 'vitest'
import { hostingPlatform, siteDomain } from '../domain-boundary'
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

  // The way the background actually asks: the address as the browser hands it
  // over, in its xn-- form, with the registrable domain worked out the same way.
  // Asked in Unicode with no registrable domain, the case below never saw the
  // two spellings meet, and a swapped letter was explained as a subdomain.
  it('explains a Cyrillic homoglyph as a swapped letter when asked in the browser\'s own spelling', () => {
    const [match] = findLookalikes('xn--pypal-4ve.com', index, 'xn--pypal-4ve.com')
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

  it('names the site a subdomain lookalike really belongs to', () => {
    expect(check('paypal.com.security-check.example.net')[0].site).toBe('example.net')
    // The background passes the boundary from the suffix list, which knows a
    // hosting platform's tenant is a site of its own
    expect(findLookalikes('paypal.com.evil.github.io', index, 'evil.github.io')[0].site).toBe('evil.github.io')
  })

  it('names no site on any other kind of match', () => {
    expect(check('paypa1.com')[0].site).toBeUndefined()
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
    // Worth a look, not a red flag: `dev-portal` is as ordinary as this is not
    expect(match.severity).toBe('medium')
    expect(shortCheck('nszu-login.gov.ua')[0]?.domain).toBe('nszu.gov.ua')
  })

  it('does not go hunting for a short name inside a longer word', () => {
    // `moz` is in `mozilla`, and that means nothing at all
    expect(shortCheck('mozilla.org')).toEqual([])
    expect(shortCheck('workspace.ua')).toEqual([])
  })
})

describe('only the labels the owner chose', () => {
  const known = buildFamiliarIndex([
    { domain: 'dev.to', label: 'dev', visits: 30 },
    { domain: 'online.ua', label: 'online', visits: 30 },
    { domain: 'onliner.by', label: 'onliner', visits: 30 },
    { domain: 'github.com', label: 'github', visits: 30 },
    { domain: 'paypal.com', label: 'paypal', visits: 30 },
    { domain: 'mail.ru', label: 'mail', visits: 30 },
  ])
  // The boundary as the background passes it, from the suffix list
  const at = (hostname: string, site: string) => findLookalikes(hostname, known, site)

  it('never compares the ending', () => {
    expect(at('material.slint.dev', 'slint.dev')).toEqual([])
    expect(at('shop.online', 'shop.online')).toEqual([])
    // A platform's name is the platform's, and the shared-platform line says so
    expect(at('someone.github.io', 'someone.github.io')).toEqual([])
  })

  it('still compares the site\'s own name and the levels in front', () => {
    expect(at('paypal.github.io', 'paypal.github.io')[0]?.domain).toBe('paypal.com')
    expect(at('paypal.slint.dev', 'slint.dev')[0]?.severity).toBe('high')
    expect(at('onlinr.dev', 'onlinr.dev')[0]?.domain).toBe('online.ua')
  })

  it('finds a parked domain only where the owner wrote it', () => {
    expect(at('x.dev.to.evil.com', 'evil.com')[0]).toMatchObject({ domain: 'dev.to', severity: 'high', evidence: 'dev.to' })
    // The tenant's name ends the parked domain, which is the owner's to write
    expect(at('paypal.com.github.io', 'com.github.io')[0]).toMatchObject({ domain: 'paypal.com', reason: 'familiar-as-subdomain' })
    // A country site of the same name, not a domain parked in front of `.au`
    expect(at('login.paypal.com.au', 'paypal.com.au')[0]).toMatchObject({ domain: 'paypal.com', reason: 'same-name', severity: 'medium' })
  })

  // A line each named the real site once per name
  it('names every familiar domain parked in front of one site in one match', () => {
    const two = buildFamiliarIndex([
      { domain: 'paypal.com', label: 'paypal', visits: 10 },
      { domain: 'google.com', label: 'google', visits: 90 },
      { domain: 'dev.to', label: 'dev', visits: 30 },
    ])
    const found = findLookalikes('paypal.com.google.com.login.verify.test', two, 'verify.test')
    expect(found).toHaveLength(1)
    // In the order the address has them, not by visits
    expect(found[0]).toMatchObject({ domain: 'paypal.com', evidence: 'paypal.com', reason: 'familiar-as-subdomain', severity: 'high', site: 'verify.test' })
    expect(found[0].also).toEqual([{ domain: 'google.com', evidence: 'google.com', visits: 90 }])
    // A red flag and a name only worth a look stay two lines
    const mixed = findLookalikes('dev.paypal.verify.test', two, 'verify.test')
    expect(mixed.map(match => [match.domain, match.severity, match.also])).toEqual([['paypal.com', 'high', undefined], ['dev.to', 'medium', undefined]])
  })

  it('names a name once, by the longest spelling the address has of it', () => {
    const near = buildFamiliarIndex([
      { domain: 'paypal.com', label: 'paypal', visits: 10 },
      { domain: 'paypal.de', label: 'paypal', visits: 50 },
      { domain: 'google.com', label: 'google', visits: 90 },
    ])
    // `paypal` alone, for the known paypal.de, is inside the parked paypal.com
    const [line] = findLookalikes('paypal.com.google.com.verify.test', near, 'verify.test')
    expect([line.domain, ...(line.also ?? []).map(item => item.domain)]).toEqual(['paypal.com', 'google.com'])
    // Two known sites found in the same label: the better known speaks for both
    const [alone] = findLookalikes('paypal.verify.test', near, 'verify.test')
    expect(alone.domain).toBe('paypal.de')
    expect(alone.also).toBeUndefined()
    // A name that also stands on its own somewhere keeps its place in the line
    const twice = findLookalikes('paypal.com.paypal.evil.test', near, 'evil.test')
    expect([twice[0].domain, ...(twice[0].also ?? []).map(item => item.domain)]).toEqual(['paypal.com', 'paypal.de'])
    // Two dots in a row, kept by the browser, lose nobody
    const gap = findLookalikes('google.paypal..com.evil.test', near, 'evil.test')
    expect([gap[0].domain, ...(gap[0].also ?? []).map(item => item.domain)]).toEqual(['google.com', 'paypal.com'])
  })

  it('finds a known domain spelled into an ending sold name by name', () => {
    // The boundary and the platform as the background passes them
    const sold = (hostname: string) => findLookalikes(hostname, known, siteDomain(hostname) ?? undefined, hostingPlatform(hostname) ?? undefined)
    expect(hostingPlatform('mail.ru.com')).toBe('ru.com')
    expect(sold('mail.ru.com')[0]).toMatchObject({ domain: 'mail.ru', reason: 'familiar-as-subdomain', severity: 'high', evidence: 'mail.ru' })
    expect(sold('paypal.com.de')[0]).toMatchObject({ domain: 'paypal.com', severity: 'high' })
    // A tenant of a platform is still only compared where the tenant wrote
    expect(sold('someone.github.io')).toEqual([])
  })

  it('calls a short familiar name in front of a site worth a look, not a red flag', () => {
    expect(at('dev.mycompany.com', 'mycompany.com')[0]).toMatchObject({ domain: 'dev.to', reason: 'familiar-as-subdomain', severity: 'medium' })
    expect(at('mail.example.org', 'example.org')[0]?.severity).toBe('medium')
    expect(at('dev-portal.example.com', 'example.com')[0]).toMatchObject({ domain: 'dev.to', severity: 'medium', marks: undefined })
    // A long name is no ordinary level name, counted as written: `learn`
    // reads as the four letters `leam`
    expect(at('paypal.evil.net', 'evil.net')[0]?.severity).toBe('high')
    const learn = buildFamiliarIndex([{ domain: 'learn.com', label: 'learn', visits: 30 }])
    expect(findLookalikes('learn.example.com', learn, 'example.com')[0]?.severity).toBe('high')
  })

  // The history keeps a name as the browser hands it over, in its `xn--` form
  it('compares a known name in another alphabet as it reads', () => {
    const coded = punycode.toASCII('пример.рф')
    const idn = buildFamiliarIndex([{ domain: coded, label: coded.split('.')[0], visits: 30 }])
    expect(findLookalikes('пример.evil.com', idn, 'evil.com')[0]).toMatchObject({ domain: 'пример.рф', reason: 'familiar-as-subdomain', severity: 'high' })
    expect(findLookalikes(punycode.toASCII('пример.рф.evil.com'), idn, 'evil.com')[0]).toMatchObject({ evidence: 'пример.рф', severity: 'high' })
    // The site itself, its boundary passed coded as the background passes it
    expect(findLookalikes(coded, idn, coded)).toEqual([])
    expect(findLookalikes(`login.${coded}`, idn, coded)).toEqual([])
  })

  it('keeps a short name spelled with a swapped-in letter red', () => {
    expect(at('dеv.evil.net', 'evil.net')[0]?.severity).toBe('high')
    expect(at('d3v-portal.evil.net', 'evil.net')[0]?.severity).toBe('high')
    // Beside a plain `dev`, which on its own would be ordinary
    expect(at('d3v-dev.evil.net', 'evil.net')[0]?.severity).toBe('high')
  })
})

describe('marks on the characters that make the difference', () => {
  /** The marked characters, read off the decoded address. */
  function marked(hostname: string, domain?: string) {
    const match = domain ? check(hostname).find(m => m.domain === domain) : check(hostname)[0]
    const chars = Array.from(punycode.toUnicode(hostname).toLowerCase())
    return match?.marks?.map(at => `${at}:${chars[at]}`)
  }

  it('a digit standing in for a letter', () => {
    expect(marked('paypa1.com')).toEqual(['5:1'])
  })

  it('a letter from another alphabet, as typed and in punycode', () => {
    expect(marked('pаypal.com')).toEqual(['1:а'])
    expect(marked(punycode.toASCII('pаypal.com'))).toEqual(['1:а'])
  })

  it('two letters read as one', () => {
    expect(marked('rnicrosoft.com')).toEqual(['0:r', '1:n'])
  })

  it('a letter swapped with its neighbour', () => {
    expect(marked('paypla.com')).toEqual(['4:l', '5:a'])
  })

  it('a letter typed twice marks the last of the run', () => {
    expect(marked('paypall.com')).toEqual(['6:l'])
    expect(marked('gooogle.com')).toEqual(['3:o'])
  })

  it('a disguised letter keeps its mark next to the letter it imitates', () => {
    expect(marked('paypa1l.com')).toEqual(['5:1'])
    expect(marked('paypa11.com')).toEqual(['6:1'])
  })

  it('counts a character outside the basic plane as one position', () => {
    // U+1D429, mathematical bold p, folds to p under NFKC
    expect(marked('\u{1D429}aypa1.com')).toEqual(['0:\u{1D429}', '5:1'])
  })

  it('a letter in the wrong place', () => {
    expect(marked('paypbl.com')).toEqual(['4:b'])
  })

  it('nothing to mark when a letter is missing', () => {
    expect(check('gogle.com')[0]).toMatchObject({ domain: 'google.com', reason: 'edit-distance' })
    expect(marked('gogle.com')).toBeUndefined()
  })

  it('positions count from the start of the whole address', () => {
    expect(marked('login.paypa1.com')).toEqual(['11:1'])
    expect(marked('paypa1.evil.net')).toEqual(['5:1'])
  })

  it('a familiar name inside a longer label, misspelled', () => {
    expect(marked('paypa1-secure.com')).toEqual(['5:1'])
  })

  it('a familiar name inside a longer label, spelled right, marks nothing', () => {
    expect(check('paypal-secure.com')[0]?.reason).toBe('contains-familiar')
    expect(marked('paypal-secure.com')).toBeUndefined()
  })

  it('the same name twice marks neither copy', () => {
    expect(marked('paypal-paypa1.com', 'paypal.com')).toBeUndefined()
  })

  it('no marks on a match that is not sure of itself', () => {
    for (const match of [...check('paypal.co'), ...check('gooqel.com')])
      expect(match.marks).toBeUndefined()
  })

  it('no marks on a familiar domain parked in front', () => {
    expect(check('paypal.com.evil.net')[0]?.marks).toBeUndefined()
  })

  it('a letter whose lower case is two code points gives up marking', () => {
    expect(check('İpaypa1.com').every(match => !match.marks)).toBe(true)
  })

  it('an empty label still counts its dot', () => {
    expect(marked('a..paypa1.com')).toEqual(['8:1'])
  })
})
