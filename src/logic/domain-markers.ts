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
export type DomainMarkerId =
  | 'url-userinfo'
  | 'ip-host'
  | 'embedded-public-suffix'
  | 'deep-subdomains'
  | 'mixed-scripts'

export interface DomainMarker {
  id: DomainMarkerId
  /** The concrete evidence, shown to the user next to the marker text */
  detail: string
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
  try {
    return punycode.toUnicode(hostname)
  }
  catch {
    return hostname
  }
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
 */
export function findEmbeddedPublicSuffix(hostname: string): string | null {
  return getSubdomainLabels(hostname).find(label => DOMAIN_ENDING_LABELS.has(label)) ?? null
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
    markers.push({ id: 'embedded-public-suffix', detail: embedded })

  const depth = getSubdomainDepth(hostname)
  if (depth > MAX_SUBDOMAIN_DEPTH)
    markers.push({ id: 'deep-subdomains', detail: String(depth) })

  const mixed = findMixedScriptLabel(hostname)
  if (mixed)
    markers.push({ id: 'mixed-scripts', detail: mixed })

  return markers
}

/** All structural markers for a destination. `url` may be omitted for bare hostnames. */
export function findDomainMarkers(hostname: string, url?: string | null): DomainMarker[] {
  return [
    ...(url ? findUrlMarkers(url) : []),
    ...findHostnameMarkers(hostname),
  ]
}
