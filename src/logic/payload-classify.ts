import { extractEmailFromText } from './email-safety'
import { extractDomainFromText } from './link-safety'

export type PayloadKind = 'url' | 'email' | 'tel' | 'wifi' | 'sms' | 'geo' | 'text'

const MAX_INPUT_LENGTH = 2000

const UNICODE_DOMAIN_PATTERN = /^(?:https?:\/\/)?(?:www\.)?([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,})(?:[/:?#].*)?$/u

/**
 * Scheme-first classification of an exact payload (QR content, typed input).
 * For `email` the value is the first address (mailto params stay in the raw
 * payload for the caller to parse via parseMailtoUrl).
 */
export function classifyPayload(payload: string): { kind: PayloadKind, value: string } {
  const trimmed = payload.trim()

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      // Validate so garbage like "http://" falls through to text
      void new URL(trimmed)
      return { kind: 'url', value: trimmed }
    }
    catch {
      return { kind: 'text', value: trimmed }
    }
  }

  if (/^mailto:/i.test(trimmed)) {
    const address = trimmed.slice('mailto:'.length).split('?')[0].split(',')[0].trim()
    return { kind: 'email', value: address }
  }

  if (/^tel:/i.test(trimmed))
    return { kind: 'tel', value: trimmed.slice('tel:'.length) }

  if (/^wifi:/i.test(trimmed))
    return { kind: 'wifi', value: trimmed }

  if (/^(?:smsto|sms):/i.test(trimmed))
    return { kind: 'sms', value: trimmed }

  if (/^geo:/i.test(trimmed))
    return { kind: 'geo', value: trimmed }

  const email = extractEmailFromText(trimmed)
  if (email === trimmed)
    return { kind: 'email', value: email }

  return { kind: 'text', value: trimmed }
}

/**
 * What a QR payload turns out to be, wherever it was decoded.
 *
 * One answer for both doors. The long-press menu decoded an image and stopped at
 * `classifyPayload`, while the check page ran the same payload through
 * `extractCheckTarget` as well - so a bare `example.com` in a QR code was raw
 * text through one door and a domain through the other, with two different
 * screens to show for it.
 *
 * A scheme wins where there is one, because that is what the payload says it is.
 * Everything else falls through to the fuzzy reading, which is what turns a bare
 * name into a domain.
 */
export function classifyQrPayload(payload: string): { kind: PayloadKind, value: string } {
  const classified = classifyPayload(payload)
  if (classified.kind !== 'text')
    return classified

  const target = extractCheckTarget(payload)
  if (!target)
    return classified

  return target.kind === 'domain'
    ? { kind: 'url', value: `https://${target.value}` }
    : { kind: target.kind, value: target.value }
}

/**
 * Fuzzy extraction of a checkable target from free-form text (context-menu
 * selection, popup input). Priority: email > URL > bare domain.
 */
export function extractCheckTarget(text: string): { kind: 'email' | 'url' | 'domain', value: string } | null {
  const trimmed = text.trim().slice(0, MAX_INPUT_LENGTH)
  if (!trimmed)
    return null

  const email = extractEmailFromText(trimmed)
  if (email)
    return { kind: 'email', value: email }

  const urlMatch = trimmed.match(/https?:\/\/\S+/i)
  if (urlMatch) {
    try {
      void new URL(urlMatch[0])
      return { kind: 'url', value: urlMatch[0] }
    }
    catch {
      // fall through to domain extraction
    }
  }

  const domain = extractDomainFromText(trimmed)
  if (domain)
    return { kind: 'domain', value: domain }

  // extractDomainFromText requires an ASCII TLD, so catch fully-unicode domains
  // (почта.рф) separately since those are prime spoofing material.
  const unicodeMatch = trimmed.match(UNICODE_DOMAIN_PATTERN)
  if (unicodeMatch)
    return { kind: 'domain', value: unicodeMatch[1].toLowerCase() }

  return null
}
