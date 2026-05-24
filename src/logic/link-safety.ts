import type { LinkSafetySettings } from './storage'

// Cache visit counts per domain for the current page session
const visitCountCache = new Map<string, { count: number, isSafe: boolean, ignored: boolean, timestamp: number }>()
const CACHE_TTL_MS = 30_000 // 30 seconds

export function getCachedVisitCount(hostname: string) {
  const cached = visitCountCache.get(hostname)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS)
    return cached
  return null
}

export function setCachedVisitCount(hostname: string, data: { count: number, isSafe: boolean, ignored: boolean }) {
  visitCountCache.set(hostname, { ...data, timestamp: Date.now() })
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
 * Extract a domain from text that looks like a URL.
 * Handles: "google.com", "https://google.com/path", "www.google.com"
 */
export function extractDomainFromText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 500)
    return null

  // Must look like it contains a domain (at least one dot with valid TLD-like suffix)
  const urlPattern = /^(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF-]+(?:\.[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF-]+)*\.[a-zA-Z]{2,})(?:[/:?#].*)?$/
  const match = trimmed.match(urlPattern)
  return match ? match[1].toLowerCase() : null
}

/**
 * Check if the visible link text shows a different domain than the actual href.
 * This is the #1 phishing trick: <a href="evil.com">paypal.com</a>
 */
export function checkDomainMismatch(linkText: string, hrefHostname: string): { mismatch: boolean, textDomain?: string } {
  const textDomain = extractDomainFromText(linkText)
  if (!textDomain)
    return { mismatch: false }

  // Normalize: strip www. from both for comparison
  const normalizedText = textDomain.replace(/^www\./, '')
  const normalizedHref = hrefHostname.replace(/^www\./, '')

  if (normalizedText !== normalizedHref)
    return { mismatch: true, textDomain }

  return { mismatch: false }
}

/**
 * Detect Unicode (IDN) characters in a hostname and return punycode info.
 * Browsers auto-convert Unicode hostnames to punycode in URL parsing.
 */
export function getPunycodeInfo(hostname: string): { hasUnicode: boolean, ascii?: string } {
  // Check if hostname has non-ASCII characters
  const hasUnicode = Array.from(hostname).some(char => (char.codePointAt(0) ?? 0) > 0x7F)
  if (!hasUnicode)
    return { hasUnicode: false }

  try {
    // Browser's URL parser converts Unicode to punycode automatically
    const ascii = new URL(`http://${hostname}`).hostname
    if (ascii !== hostname)
      return { hasUnicode: true, ascii }
  }
  catch {
    // ignore
  }

  return { hasUnicode: true }
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
 * Parse a comma/newline separated domain list into an array of normalized domains.
 */
function parseDomainList(raw: string): string[] {
  return raw
    .split(/[,\n\r]+/)
    .map(d => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(d => d.length > 0 && d.includes('.'))
}

/**
 * Find the closest <a> element from an event target.
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
