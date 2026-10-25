import type { LookalikeMatch } from './domain-similarity'
import punycode from 'punycode'

/**
 * Structural deception markers.
 *
 * Every marker here rests on the mechanics of URLs and DNS rather than on a list
 * of known-bad strings: an attacker cannot drop the marker without giving up the
 * trick it enables, and nothing in this file goes stale between releases.
 *
 * None of them is a verdict on its own – they are shown as facts about the
 * address, next to the visit history.
 */
export type DomainMarkerId
  = | 'url-userinfo'
    | 'ip-host'
    | 'embedded-public-suffix'
    | 'deep-subdomains'
    | 'mixed-scripts'
    | 'non-latin-name'

export type DomainMarker
  = | {
    id: Exclude<DomainMarkerId, 'embedded-public-suffix' | 'non-latin-name'>
    /** The concrete evidence, shown to the user next to the marker text */
    detail: string
  }
  | ({ id: 'embedded-public-suffix' } & EmbeddedDomain)
  | ({
    id: 'non-latin-name'
    detail: string
    /** The other parts that qualify, in case a lookalike explains this one. */
    more: NonLatinName[]
  } & Omit<NonLatinName, 'label'>)

export type LookalikeScript = 'cyrillic' | 'greek' | 'armenian'

/**
 * The letters of each script that look like Latin ones, as Chromium's IDN spoof
 * checker lists them (`idn_spoof_checker.cc`, the whole-script confusable
 * data, read 2026-10-20). A name made only of these reads as a Latin name it is
 * not: `аррӏе` in Cyrillic is drawn as "apple". A name with a single letter
 * outside the set, `пример` with its `и`, reads as what it is.
 */
const LATIN_LOOKALIKES: { script: LookalikeScript, all: RegExp, alike: RegExp }[] = [
  { script: 'cyrillic', all: /\p{Script=Cyrillic}/u, alike: /^[аысԁеԍһіюкјӏморԗԛѕтԝхуъьҽпгѵѡ]$/u },
  { script: 'greek', all: /\p{Script=Greek}/u, alike: /^[αικνρυωηοτ]$/u },
  { script: 'armenian', all: /\p{Script=Armenian}/u, alike: /^[ագզէլհյոսւօՙ]$/u },
]

/**
 * A whole domain in the middle of an address, and where the address really goes.
 *
 * The ending alone explained nothing: "Domain ending used as a subdomain: com"
 * read as though `com` were the subdomain, when the whole point is that the eye
 * stops at `yourbank.com` and never reaches the site that follows it. So both
 * are named: the domain the eye stops at, and the site after it.
 */
export interface EmbeddedDomain {
  /** The domain the address reads as, `yourbank.com` */
  imitated: string
  /** Everything after it, `pay-verify.top` – the site the address belongs to */
  site: string
}

/** Subdomain levels above this are called out. `a.b.c.example.com` sits exactly on it. */
export const MAX_SUBDOMAIN_DEPTH = 3

/** A hostname label written in more than one of these groups is mixing writing systems. */
const SCRIPT_GROUPS: { name: string, pattern: RegExp }[] = [
  { name: 'latin', pattern: /\p{Script=Latin}/u },
  { name: 'cyrillic', pattern: /\p{Script=Cyrillic}/u },
  { name: 'greek', pattern: /\p{Script=Greek}/u },
  { name: 'armenian', pattern: /\p{Script=Armenian}/u },
  { name: 'georgian', pattern: /\p{Script=Georgian}/u },
  { name: 'hebrew', pattern: /\p{Script=Hebrew}/u },
  { name: 'arabic', pattern: /\p{Script=Arabic}/u },
  { name: 'devanagari', pattern: /\p{Script=Devanagari}/u },
  { name: 'bengali', pattern: /\p{Script=Bengali}/u },
  { name: 'thai', pattern: /\p{Script=Thai}/u },
  // Japanese, Korean and Chinese legitimately combine several scripts in one
  // word, so they count as a single group rather than as a mixture
  { name: 'cjk', pattern: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u },
]

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Unicode rendering of a hostname; returns the input unchanged if it is not IDN. */
export function decodeHostname(hostname: string): string {
  // Label by label, so one that does not decode leaves the rest readable
  return hostname.split('.').map((label) => {
    // The decoder only knows a lower-case `xn--`, and an address typed into a
    // mail or a page may be in capitals, which left `XN--80AK6AA92E.COM`
    // looking like plain Latin to every check that reads the decoded name
    if (!/^xn--/i.test(label))
      return label
    try {
      return punycode.toUnicode(label.toLowerCase())
    }
    catch {
      return label
    }
  }).join('.')
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

/**
 * Credentials in the authority: `https://paypal.com@evil.net` reads as PayPal but
 * loads evil.net. The password is never echoed back – only the fact that one exists.
 */
export function getUrlUserinfo(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null
    if (!parsed.username && !parsed.password)
      return null

    const username = safeDecode(parsed.username)
    return parsed.password ? `${username}:…` : username
  }
  catch {
    return null
  }
}

/**
 * A bare address instead of a name. The URL parser normalises the decimal, octal
 * and hex spellings to dotted-quad, but raw strings reaching us from page text
 * will not have been through it, so those forms are recognised too.
 */
export function isIpHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host)
    return false

  // IPv6 always arrives bracketed from the URL parser, but may not from page text
  if (host.startsWith('[') || host.includes(':'))
    return true

  const octets = IPV4_PATTERN.exec(host)
  if (octets)
    return octets.slice(1).every(octet => Number(octet) <= 255)

  return /^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)
}

/**
 * The seven original generic top-level domains – the strings a reader treats as
 * "the domain ends here". Frozen since the 1980s, so this is a fact about DNS
 * rather than a reputation list that needs maintaining.
 *
 * Testing every public suffix instead does not work: the gTLD expansion turned
 * thousands of ordinary words and brand names into valid suffixes, so `.shop`,
 * `.app` and even `.hsbc` would flag legitimate hostnames like
 * `shop.example.com.br` and `www.bbc.co.uk`. Two-letter country codes are left
 * out for the same reason – `de.wikipedia.org` is a language subdomain, not a
 * deception. Country-code variants of this trick are caught in the lookalike
 * pass instead, where the label has to match a domain the user actually knows.
 */
const DOMAIN_ENDING_LABELS = new Set(['com', 'net', 'org', 'edu', 'gov', 'mil', 'int'])

/**
 * How many trailing labels make up the suffix.
 *
 * Compound country-code suffixes (`co.uk`, `com.br`, `ac.jp`) take two labels,
 * everything else one. Recognising them by shape – a two-letter final label after
 * a short one – rather than by consulting the public suffix list keeps this module
 * free of the 100 kB list, which matters because it runs inside a content script
 * injected on every page. The approximation errs towards a shorter subdomain, so
 * it can only ever under-report depth, never invent it.
 */
function suffixLabelCount(labels: string[]): number {
  if (labels.length < 3)
    return 1

  const last = labels[labels.length - 1]
  const beforeLast = labels[labels.length - 2]
  return last.length === 2 && beforeLast.length <= 3 ? 2 : 1
}

/** Labels above the registrable domain, i.e. the subdomain part. */
function getSubdomainLabels(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.')
  // Everything except the suffix and the registrable label itself
  return labels.slice(0, Math.max(0, labels.length - suffixLabelCount(labels) - 1))
}

/** The registrable part of a hostname – `example.com` out of `a.b.example.com`. */
export function getRegistrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (labels.length < 2)
    return labels.join('.')

  return labels.slice(Math.max(0, labels.length - suffixLabelCount(labels) - 1)).join('.')
}

/**
 * A domain ending used as an ordinary label: `paypal.com.evil.net` puts a whole
 * domain where a subdomain belongs, so the eye stops reading at `paypal.com`.
 *
 * The imitated domain is the label in front of the ending plus the ending, and
 * a two-letter country code after it when there is one, since `paypal.com.au`
 * reads as one domain. Deeper labels in front are left out – `login.paypal.com`
 * imitates `paypal.com`. An ending with no label in front, `com.evil.net`,
 * spells no domain for the eye to stop at, and is not reported.
 *
 * The site named is everything after the imitated domain rather than the registrable
 * domain. This module has no public suffix list, and its shape-based guess
 * gets hosting platforms wrong in the one direction that matters here:
 * `paypal.com.evil.github.io` would name `github.io`, which reads as
 * reassurance. What follows the ending always contains the real site, and at
 * worst names a level of it too many – `x.evil.net` rather than `evil.net`.
 */
export function findEmbeddedPublicSuffix(hostname: string): EmbeddedDomain | null {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.')
  // The subdomain labels are the head of this same list, so the index carries over
  const subdomain = getSubdomainLabels(hostname)
  const at = subdomain.findIndex((label, index) => index > 0 && DOMAIN_ENDING_LABELS.has(label))
  if (at < 0)
    return null

  const end = /^[a-z]{2}$/.test(subdomain[at + 1] ?? '') ? at + 2 : at + 1
  return { imitated: labels.slice(at - 1, end).join('.'), site: labels.slice(end).join('.') }
}

/**
 * Markers that something else on the same screen already explains.
 *
 * A domain in the middle of the address is the mechanism of the
 * `familiar-as-subdomain` lookalike when the familiar domain is the one parked
 * there – `yourbank.com.pay-verify.top` with `yourbank.com` known. The
 * lookalike line says the same thing and says the domain is familiar, and the
 * two in a row read as two different warnings. A match on the bare name,
 * `yourbank` for a known `yourbank.org`, names a different domain from the one
 * in the address and leaves the marker in.
 *
 * `null` means the lookalike check gave no answer, which is not the same as it
 * finding nothing – the markers stay as they are either way.
 */
/** The markers `dropExplainedMarkers` can take out, which a view waits for the lookalike answer on. */
export function isExplainableMarker(marker: DomainMarker): boolean {
  return marker.id === 'embedded-public-suffix' || marker.id === 'non-latin-name'
}

export function dropExplainedMarkers(
  markers: DomainMarker[],
  lookalikes: readonly LookalikeMatch[] | null,
): DomainMarker[] {
  if (!lookalikes?.length)
    return markers

  const explained = (label: string) => lookalikes.some(match =>
    (match.reason === 'confusable' || match.reason === 'familiar-as-subdomain' || match.severity === 'high')
    && decodeHostname(match.evidence).toLowerCase() === label)

  return markers.flatMap((marker): DomainMarker[] => {
    if (marker.id === 'embedded-public-suffix') {
      return lookalikes.some(match => match.reason === 'familiar-as-subdomain'
        && match.evidence.toLowerCase() === marker.imitated)
        ? []
        : [marker]
    }
    // A name in another alphabet is the mechanism of a match on the same name, which
    // says which familiar site it copies: `confusable` for the site's own name,
    // `familiar-as-subdomain` for one put in front of another site. One trick,
    // one flag.
    // A name of twins one letter off a familiar one, or holding one, is the
    // same single trick, so any match that counts as a red flag explains it.
    // Another part in another alphabet is a finding of its own, and takes the
    // place of the one explained.
    if (marker.id === 'non-latin-name') {
      if (!explained(marker.detail))
        return [marker]
      const left = marker.more.filter(name => !explained(name.label))
      return left.length ? [nonLatinMarker(left)] : []
    }
    return [marker]
  })
}

/** How many labels sit above the registrable domain. */
export function getSubdomainDepth(hostname: string): number {
  return getSubdomainLabels(hostname).length
}

/**
 * A single label written in two writing systems at once – `pаypal` with a
 * Cyrillic а. Legitimate internationalised domains stay within one system.
 */
export function findMixedScriptLabel(hostname: string): string | null {
  for (const label of decodeHostname(hostname).split('.')) {
    const groups = new Set<string>()
    for (const group of SCRIPT_GROUPS) {
      if (group.pattern.test(label))
        groups.add(group.name)
    }

    if (groups.size > 1)
      return label
  }

  return null
}

/**
 * Real words made only of Latin twins, which Chromium lets through
 * (`kAllowedWholeScriptConfusableWords`, read 2026-10-20). Still flagged here,
 * but not said to imitate a Latin name.
 */
const ALLOWED_WORDS = new Set(['секс', 'как', 'коса', 'курс', 'парк', 'такий', 'укроп', 'сахарок', 'покраска', 'театр', 'астро', 'пхукет'])

export interface NonLatinName {
  label: string
  /** The alphabet it is written in, a `SCRIPT_GROUPS` name, or `other`. */
  script: string
  /** Every letter has a Latin twin, so the name reads as a Latin one: `аррӏе`. */
  twins: boolean
  tld: string
  /** The ending's alphabet, `latin` for an ending in ASCII. */
  tldScript: string
}

/**
 * Alphabets with an ending of their own that `SCRIPT_GROUPS` does not name.
 * Told apart only so that a name in one under an ending in another is not
 * taken for the same alphabet. Shown to the user as just another alphabet.
 */
const OTHER_SCRIPTS = ['Tamil', 'Sinhala', 'Telugu', 'Kannada', 'Malayalam', 'Gujarati', 'Gurmukhi', 'Oriya', 'Lao', 'Khmer', 'Myanmar', 'Ethiopic', 'Tibetan', 'Mongolian', 'Thaana']
  .map(name => ({ name: `other-${name.toLowerCase()}`, pattern: new RegExp(`\\p{Script=${name}}`, 'u') }))

function scriptOf(letters: string[]): string {
  return [...SCRIPT_GROUPS, ...OTHER_SCRIPTS].find(group => letters.some(char => group.pattern.test(char)))?.name ?? 'other'
}

/**
 * A part of the address written in another alphabet, under a Latin ending:
 * `аррӏе.com`, `пример.ru`, `пример.io`.
 *
 * An address ending in Latin letters is read as a Latin address, so every part
 * of it is expected in Latin letters too. A name in another alphabet belongs
 * under an ending in that alphabet, `.рф`, `.укр` and the other national
 * endings, and under those nothing is flagged. Two-letter Latin country codes
 * get no pass: `аррӏе.io` and `пример.ru` are flagged like `.com`. Decided by
 * the user, 2026-10-25, against Chromium's narrower rule, which flags only names
 * made wholly of Latin twins and lets each script through under its own
 * country codes.
 *
 * An ending in an alphabet of its own lets through only names in that
 * alphabet: `аррӏе.中国` and a Greek name under `.рф` are flagged. A Latin
 * name is never flagged here.
 *
 * Mixing alphabets in one part is `mixed-scripts` and is not counted again.
 * Latin letters with accents (`münchen`) are Latin. Where several parts
 * qualify, one of Latin twins is the one named, since it gets the sharper line.
 */
export function findNonLatinName(hostname: string): NonLatinName | null {
  return findNonLatinNames(hostname)[0] ?? null
}

/** Every part `findNonLatinName` would flag, the one it names first. */
export function findNonLatinNames(hostname: string): NonLatinName[] {
  const labels = decodeHostname(hostname).toLowerCase().replace(/\.$/, '').split('.')
  const tld = labels[labels.length - 1] ?? ''
  if (labels.length < 2 || !tld)
    return []
  const tldLetters = [...tld].filter(char => /\p{L}/u.test(char))
  const tldScript = /^[a-z0-9-]+$/.test(tld) ? 'latin' : scriptOf(tldLetters)
  const found: NonLatinName[] = []
  for (const label of labels.slice(0, -1)) {
    const letters = [...label].filter(char => /\p{L}/u.test(char))
    if (!letters.length || letters.some(char => /\p{Script=Latin}/u.test(char)))
      continue
    // Two alphabets in one part is `mixed-scripts`
    if (SCRIPT_GROUPS.filter(group => letters.some(char => group.pattern.test(char))).length > 1)
      continue
    const script = scriptOf(letters)
    if (script === tldScript)
      continue
    const lookalikes = LATIN_LOOKALIKES.find(entry => entry.script === script)
    const twins = Boolean(lookalikes) && !ALLOWED_WORDS.has(label)
      && letters.every(char => lookalikes!.all.test(char) && lookalikes!.alike.test(char))
    found.push({ label, script, twins, tld, tldScript })
  }
  // Stable, so the parts keep their order otherwise
  return found.sort((a, b) => Number(b.twins) - Number(a.twins))
}

function nonLatinMarker(names: NonLatinName[]): DomainMarker {
  const [{ label, ...first }, ...more] = names
  return { id: 'non-latin-name', detail: label, ...first, more }
}

/** Markers that can only be read off a full URL rather than a hostname. */
export function findUrlMarkers(url: string): DomainMarker[] {
  const userinfo = getUrlUserinfo(url)
  return userinfo === null ? [] : [{ id: 'url-userinfo', detail: userinfo }]
}

export function findHostnameMarkers(hostname: string): DomainMarker[] {
  const markers: DomainMarker[] = []

  if (isIpHost(hostname)) {
    // The remaining checks all assume a name, not an address
    markers.push({ id: 'ip-host', detail: hostname })
    return markers
  }

  const embedded = findEmbeddedPublicSuffix(hostname)
  if (embedded)
    markers.push({ id: 'embedded-public-suffix', ...embedded })

  const depth = getSubdomainDepth(hostname)
  if (depth > MAX_SUBDOMAIN_DEPTH)
    markers.push({ id: 'deep-subdomains', detail: String(depth) })

  const mixed = findMixedScriptLabel(hostname)
  if (mixed)
    markers.push({ id: 'mixed-scripts', detail: mixed })

  const nonLatin = findNonLatinNames(hostname)
  if (nonLatin.length)
    markers.push(nonLatinMarker(nonLatin))

  return markers
}

/** All structural markers for a destination. `url` may be omitted for bare hostnames. */
export function findDomainMarkers(hostname: string, url?: string | null): DomainMarker[] {
  return [
    ...(url ? findUrlMarkers(url) : []),
    ...findHostnameMarkers(hostname),
  ]
}
