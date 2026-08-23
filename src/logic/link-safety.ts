import type { FamiliarityStats } from './familiarity'
import type { LinkSafetySettings } from './storage'
import punycode from 'punycode'

/**
 * What is known about one hostname, cached for the current page session.
 *
 * Holds the whole set of facts rather than the visit count alone: every check
 * surface shows the evidence its verdict rests on, and a cache that kept only
 * the count would send the others back to the background link by link.
 */
export interface VisitFacts {
  stats: FamiliarityStats
  isSafe: boolean
  ignored: boolean
}

const visitCountCache = new Map<string, VisitFacts & { timestamp: number }>()
const CACHE_TTL_MS = 30_000 // 30 seconds

export function getCachedVisitCount(hostname: string): VisitFacts | null {
  const cached = visitCountCache.get(hostname)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS)
    return cached
  return null
}

export function setCachedVisitCount(hostname: string, data: VisitFacts) {
  visitCountCache.set(hostname, { ...data, timestamp: Date.now() })
}

/**
 * Throw the cached verdicts away.
 *
 * Every entry here is a verdict, not a fact: it was reached under the rules and
 * the visit records as they stood. A reset, an import or a change to the rules
 * makes all of them wrong at once, and a tab that stays open would go on showing
 * them for the rest of its life.
 */
export function clearVisitCache() {
  visitCountCache.clear()
}

/**
 * Check if a link points to a different domain than the current page
 */
export function isExternalLink(href: string, currentHostname: string): boolean {
  try {
    const url = new URL(href)
    // Skip non-http(s) protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return false
    return url.hostname !== currentHostname
  }
  catch {
    return false
  }
}

/**
 * Check if an href is a mailto: link.
 */
export function isMailtoHref(href: string): boolean {
  try {
    return new URL(href).protocol === 'mailto:'
  }
  catch {
    return false
  }
}

/**
 * Characters that take up no space and can be dropped without changing what a
 * person reads. A name with one hidden inside it is still that name to the eye,
 * so the comparison has to see it the same way - otherwise `paypa<ZWSP>l.com`
 * simply fails to match the pattern and no mismatch is reported at all.
 */
const IGNORABLE = /[\u00AD\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g

/**
 * Extract a domain from text that looks like a URL.
 * Handles: "google.com", "https://google.com/path", "www.google.com"
 */
export function extractDomainFromText(text: string): string | null {
  const trimmed = text.replace(IGNORABLE, '').trim()
  if (!trimmed || trimmed.length > 500)
    return null

  // Must look like it contains a domain (at least one dot with a TLD-like
  // suffix). The last label allows the `xn--` form as well as plain letters: an
  // international TLD written in ASCII has digits and hyphens in it, so
  // `почта.xn--p1ai` used to match nothing at all and go unchecked - which is
  // exactly the shape of name worth checking.
  const urlPattern = /^(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF-]+(?:\.[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF-]+)*\.(?:[a-zA-Z]{2,}|xn--[a-z0-9-]{2,}))(?:[/:?#].*)?$/
  const match = trimmed.match(urlPattern)
  return match ? match[1].toLowerCase() : null
}

/**
 * One spelling of a hostname, so two of them can be held against each other.
 *
 * The two sides of this comparison arrive in different alphabets. `URL.hostname`
 * has already been put through IDNA by the browser and comes back as punycode,
 * while the text on the page is whatever the author typed - usually Unicode. So
 * `<a href="https://münich.example">münich.example</a>`, which goes exactly
 * where it says, came out as a red mismatch: `münich.example` against
 * `xn--mnich-kva.example`.
 *
 * Both sides go through the same conversion before anything is compared, and
 * ASCII is the side to land on because that is the name the browser will
 * actually resolve.
 */
function canonicalHost(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  if (!trimmed)
    return ''

  try {
    // The URL parser is the IDNA implementation the browser itself uses, so this
    // is the same answer it would reach on the way to the network
    const parsed = new URL(`http://${trimmed}`).hostname
    return parsed.replace(/^www\./, '')
  }
  catch {
    return trimmed
  }
}

/**
 * Is one of these names the other one, or somewhere inside it?
 *
 * Written out here rather than taken from `domain-boundary`, which reaches for
 * the public suffix list: this module is in the content script, injected into
 * every page, and the list is a hundred kilobytes. The plain suffix test answers
 * the question this check actually asks and costs nothing.
 */
function sameSiteOrBelow(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/**
 * The `.${b}` test above is deliberately symmetric and deliberately blunt: this
 * module is in the content script and cannot carry the public suffix list, so it
 * cannot tell `github.io` from `example.com`. Text reading `github.io` on a link
 * to `evil.github.io` therefore passes here. That is a name nobody writes as a
 * link label, and the lookalike check and the structural markers - both of which
 * do know where the boundary is - still read the destination.
 */

/**
 * Check if the visible link text shows a different domain than the actual href.
 * This is the #1 phishing trick: <a href="evil.com">paypal.com</a>
 *
 * Compared as sites rather than as exact hostnames. A link on a site's own page
 * reading `example.com` and pointing at `login.example.com` was flagged in red,
 * which is a false alarm on a pattern half the web uses - and a false alarm on a
 * marker this loud costs more than the marker is worth. What the trick actually
 * looks like still trips it: `paypal.com.evil.net` is not inside `paypal.com`
 * and never was, and two tenants of one hosting platform are two sites.
 */
export function checkDomainMismatch(linkText: string, hrefHostname: string): { mismatch: boolean, textDomain?: string } {
  const textDomain = extractDomainFromText(linkText)
  if (!textDomain)
    return { mismatch: false }

  if (!sameSiteOrBelow(canonicalHost(textDomain), canonicalHost(hrefHostname)))
    return { mismatch: true, textDomain }

  return { mismatch: false }
}

/**
 * Detect an internationalised (IDN) hostname and return both of its renderings.
 *
 * A hostname can reach us either way round: `new URL(href).hostname` has already
 * been converted to punycode by the browser, while text typed or pasted by the
 * user still holds the Unicode form. Checking only for non-ASCII characters would
 * therefore miss every link on a page, which is why the `xn--` form is tested too.
 */
/**
 * The other way this name can be written, or null when there is only one.
 *
 * A hostname with an international name in it has two spellings: the Unicode one
 * a person reads, and the ASCII `xn--` one the browser resolves. Showing both is
 * the point - a name that looks like `paypal` in one and like a string of
 * gibberish in the other is exactly what the check is for.
 *
 * Which of the two to show depends on which one is already on screen, and that
 * is what this answers. The callers used to keep the ASCII form regardless, and
 * every one of them displays the ASCII form as the name - so the alternate was
 * identical to the name above it, and every surface hid it as a duplicate. The
 * pair was claimed and never shown.
 */
export function alternateSpelling(displayed: string): string | null {
  const info = getPunycodeInfo(displayed)
  if (!info.hasUnicode)
    return null

  const other = displayed.toLowerCase() === info.ascii?.toLowerCase() ? info.unicode : info.ascii
  return other && other.toLowerCase() !== displayed.toLowerCase() ? other : null
}

export function getPunycodeInfo(hostname: string): { hasUnicode: boolean, ascii?: string, unicode?: string } {
  const hasNonAscii = Array.from(hostname).some(char => (char.codePointAt(0) ?? 0) > 0x7F)
  const hasPunycodeLabel = hostname.toLowerCase().split('.').some(label => label.startsWith('xn--'))

  if (!hasNonAscii && !hasPunycodeLabel)
    return { hasUnicode: false }

  try {
    // The URL parser converts Unicode to punycode, and the decoder goes the other way
    const ascii = hasNonAscii ? new URL(`http://${hostname}`).hostname : hostname
    const unicode = hasNonAscii ? hostname : punycode.toUnicode(hostname)
    return { hasUnicode: true, ascii, unicode }
  }
  catch {
    return { hasUnicode: true }
  }
}

/**
 * Check if the current domain is within the configured scope for link safety.
 */
export function isDomainInScope(currentDomain: string, linkSafety: LinkSafetySettings): boolean {
  if (linkSafety.scopeMode === 'everywhere')
    return true

  const domains = parseDomainList(linkSafety.scopeDomains)
  if (domains.length === 0) {
    // Empty list: whitelist = nowhere, blacklist = everywhere
    return linkSafety.scopeMode === 'blacklist'
  }

  const isInList = domains.some(d => currentDomain === d || currentDomain.endsWith(`.${d}`))

  return linkSafety.scopeMode === 'whitelist' ? isInList : !isInList
}

/**
 * Parse a newline-separated domain list into an array of normalized domains.
 */
function parseDomainList(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map(d => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(d => d.length > 0 && d.includes('.'))
}

/**
 * Find the closest `<a>` element behind an event.
 *
 * Takes the event rather than its target on purpose. A link inside a custom
 * element's shadow root retargets: `event.target` is the element that owns the
 * shadow root, not the anchor inside it, and `closest('a')` from there finds
 * nothing at all. `composedPath()` is the list of nodes the event actually
 * travelled through, shadow boundaries included, so the anchor is in it.
 *
 * A closed shadow root does not appear in the path, and there is nothing to be
 * done about that from a content script. It is a limitation, not an oversight.
 */
export function findAnchorFromEvent(event: Event): HTMLAnchorElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (node instanceof Element && node.matches?.('a[href]'))
      return node as HTMLAnchorElement
  }

  return findAnchorElement(event.target)
}

/**
 * Find the closest `<a>` element from an event target.
 *
 * The fallback for a caller with no event to hand. Prefer `findAnchorFromEvent`,
 * which also sees through an open shadow root.
 */
export function findAnchorElement(target: EventTarget | null): HTMLAnchorElement | null {
  if (!target || !(target instanceof Element))
    return null
  return target.closest('a[href]') as HTMLAnchorElement | null
}

/**
 * Get hostname from an href string.
 */
export function getHostnameFromHref(href: string): string | null {
  try {
    return new URL(href).hostname
  }
  catch {
    return null
  }
}
