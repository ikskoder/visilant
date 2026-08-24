import { alternateSpelling } from './link-safety'

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

  return {
    raw: trimmed,
    localPart,
    domain,
    local: analyzePart(localPart, '._+-'),
    domainInfo: {
      ...analyzePart(domain, '.-'),
      // The other spelling of whatever is on screen – see `alternateSpelling`
      punycode: alternateSpelling(domain),
    },
    suspiciousPattern: findEmbeddedTld(domain),
  }
}

/** Percent-decoding that keeps the raw text when the escaping is malformed. */
function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

/**
 * Parse a mailto: URL manually. `new URL('mailto:...')` behaves inconsistently
 * across engines (empty hostname, quirky pathname), and the query is taken
 * apart by hand as well.
 *
 * `URLSearchParams` reads a query as an HTML form, where `+` means a space. A
 * mailto: query is not a form – RFC 6068 says percent-encoding and nothing
 * else, so the `+` in `?bcc=finance+invoices@example.com` is a plus. Handed to
 * `URLSearchParams` it came back as a space, which is not a valid address, and
 * the recipient was dropped without even being counted as unread.
 */
export function parseMailtoUrl(href: string): { addresses: string[], params: { key: string, value: string }[] } | null {
  if (!/^mailto:/i.test(href.trim()))
    return null

  const rest = href.trim().slice('mailto:'.length)
  const queryIndex = rest.indexOf('?')
  const addressPart = queryIndex === -1 ? rest : rest.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : rest.slice(queryIndex + 1)

  const decodedAddresses = decodePart(addressPart)

  const addresses = decodedAddresses
    .split(',')
    .map(a => a.trim())
    .filter(a => a.length > 0)

  const params: { key: string, value: string }[] = []
  for (const pair of queryPart ? queryPart.split('&') : []) {
    if (!pair)
      continue
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    params.push({ key: decodePart(key), value: decodePart(value) })
  }

  return { addresses, params }
}

/** Which box of the message an address sits in. */
export type MailtoField = 'to' | 'cc' | 'bcc'

export interface MailtoRecipient {
  field: MailtoField
  address: string
}

/**
 * How many addresses are worth analysing.
 *
 * A page writes the `mailto:`, so the list is as long as it likes. Every entry
 * costs an analysis and a visit lookup, and a check nobody can read is not a
 * check – so the rest are counted and named as not looked at, never dropped
 * silently.
 */
export const MAX_MAILTO_RECIPIENTS = 25

/**
 * Every address the mail client would actually put in the message.
 *
 * The `to` list is only the first box. `cc` and `bcc` are ordinary query
 * parameters of a `mailto:`, they reach real people just the same, and reading
 * the first address of the first box was enough to make
 * `mailto:known@example.com,attacker@evil.example` look checked.
 */
export function collectMailtoRecipients(parsed: { addresses: string[], params: { key: string, value: string }[] } | null): MailtoRecipient[] {
  if (!parsed)
    return []

  const split = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean)

  const collected: MailtoRecipient[] = parsed.addresses.map(address => ({ field: 'to' as const, address }))
  for (const { key, value } of parsed.params) {
    const field = key.trim().toLowerCase()
    // `to` belongs here as much as the other two: RFC 6068 allows the whole
    // recipient list to live in the query, and a `mailto:?to=...` with nothing
    // before the question mark is a perfectly ordinary link
    if (field === 'to' || field === 'cc' || field === 'bcc')
      collected.push(...split(value).map(address => ({ field: field as MailtoField, address })))
  }

  // One person named twice is one recipient. Compared case-insensitively on the
  // whole address, which is the same string the analysis is keyed on.
  const seen = new Set<string>()
  return collected.filter(({ address }) => {
    const key = address.toLowerCase()
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

// The final label allows the `xn--` form as well as letters. An international
// domain written in ASCII has digits and hyphens in its last label, so an
// address at one used to match nothing here and was never read as an address.
const EMAIL_IN_TEXT_PATTERN = /[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+\.(?:xn--[a-z0-9-]{2,}|\p{L}{2,})(?![\w-])/iu

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
