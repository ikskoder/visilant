import { getPunycodeInfo } from './link-safety'

export interface EmailPartInfo {
  hasUnicode: boolean
  suspiciousChars: string[]
}

export interface EmailAnalysis {
  raw: string
  localPart: string
  domain: string
  local: EmailPartInfo
  domainInfo: EmailPartInfo & { punycode: string | null }
  suspiciousPattern: { type: 'embedded-tld', label: string } | null
}

const MAX_EMAIL_LENGTH = 320

// TLDs that phishers embed mid-domain to fake a trusted address (paypal.com.evil.ru)
const EMBEDDED_TLDS = ['com', 'net', 'org', 'edu', 'gov', 'mil', 'info', 'io', 'co']

function analyzePart(part: string, allowedExtra: string): EmailPartInfo {
  const suspicious = new Set<string>()
  let hasUnicode = false
  for (const char of part) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0x7F)
      hasUnicode = true
    const isPlain = /[a-z0-9]/i.test(char) || allowedExtra.includes(char)
    if (!isPlain)
      suspicious.add(char)
  }
  return { hasUnicode, suspiciousChars: Array.from(suspicious) }
}

function findEmbeddedTld(domain: string): { type: 'embedded-tld', label: string } | null {
  const labels = domain.split('.')
  for (let i = 0; i < labels.length; i++) {
    // A known TLD followed by 2+ more labels means the "real-looking" domain
    // ends mid-hostname: paypal.com.evil.ru. Legit ccTLD combos (bbc.co.uk)
    // have only one label after, so they are not flagged.
    if (EMBEDDED_TLDS.includes(labels[i]) && labels.length - 1 - i >= 2)
      return { type: 'embedded-tld', label: labels[i] }
  }
  return null
}

/**
 * Analyze an email address for spoofing signals. Parsing is deliberately
 * permissive (no RFC regex) so homoglyph/unicode addresses still analyze.
 */
export function analyzeEmailAddress(raw: string): EmailAnalysis | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || /\s/.test(trimmed))
    return null

  const parts = trimmed.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return null

  const localPart = parts[0]
  const domain = parts[1].toLowerCase()
  if (!domain.includes('.'))
    return null

  const punycodeInfo = getPunycodeInfo(domain)

  return {
    raw: trimmed,
    localPart,
    domain,
    local: analyzePart(localPart, '._+-'),
    domainInfo: {
      ...analyzePart(domain, '.-'),
      punycode: punycodeInfo.hasUnicode && punycodeInfo.ascii ? punycodeInfo.ascii : null,
    },
    suspiciousPattern: findEmbeddedTld(domain),
  }
}

/**
 * Parse a mailto: URL manually. `new URL('mailto:...')` behaves inconsistently
 * across engines (empty hostname, quirky pathname), so only the query part
 * goes through URLSearchParams.
 */
export function parseMailtoUrl(href: string): { addresses: string[], params: { key: string, value: string }[] } | null {
  if (!/^mailto:/i.test(href.trim()))
    return null

  const rest = href.trim().slice('mailto:'.length)
  const queryIndex = rest.indexOf('?')
  const addressPart = queryIndex === -1 ? rest : rest.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : rest.slice(queryIndex + 1)

  let decodedAddresses = addressPart
  try {
    decodedAddresses = decodeURIComponent(addressPart)
  }
  catch {
    // keep raw on malformed percent-encoding
  }

  const addresses = decodedAddresses
    .split(',')
    .map(a => a.trim())
    .filter(a => a.length > 0)

  const params: { key: string, value: string }[] = []
  if (queryPart) {
    for (const [key, value] of new URLSearchParams(queryPart))
      params.push({ key, value })
  }

  return { addresses, params }
}

const EMAIL_IN_TEXT_PATTERN = /[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+\.\p{L}{2,}/u

/**
 * Find the first email-looking substring in free-form text.
 * Only the first 500 chars are searched to bound regex work.
 */
export function extractEmailFromText(text: string): string | null {
  const trimmed = text.trim().slice(0, 500)
  if (!trimmed)
    return null
  const match = trimmed.match(EMAIL_IN_TEXT_PATTERN)
  return match ? match[0] : null
}
