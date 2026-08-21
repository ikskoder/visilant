/**
 * Links to third-party services that can say something about a domain.
 *
 * Deliberately links rather than API calls. An integration would mean API keys
 * the extension cannot hold safely, rate limits shared across every user, and
 * response formats to keep parsing as they change. A link has none of that: the
 * extension makes no request at all, and the user decides whether to go.
 *
 * The trade is honest either way – following a link hands that service the
 * domain, the user's IP and whatever their browser sends, which is more than a
 * background fetch would have. The difference is that it happens because the
 * user chose it, in their own tab, where they can see what they are visiting.
 *
 * A stale entry here fails visibly – a link that 404s – rather than silently
 * misleading, which is why a small shipped list is acceptable where a shipped
 * list of detection rules would not be. The list is editable all the same.
 */

export interface LookupService {
  name: string
  /** URL with `{domain}` where the domain goes */
  url: string
}

/**
 * Every one of these was checked to answer for a plain domain query. They cover
 * different questions on purpose: reputation aggregate, live scan history, and
 * the browser's own blocklist. Kept short deliberately – anything else the user
 * finds useful they can add themselves.
 */
export const DEFAULT_LOOKUP_SERVICES: LookupService[] = [
  { name: 'VirusTotal', url: 'https://www.virustotal.com/gui/domain/{domain}' },
  { name: 'urlscan.io', url: 'https://urlscan.io/domain/{domain}' },
  { name: 'Google Safe Browsing', url: 'https://transparencyreport.google.com/safe-browsing/search?url={domain}' },
]

export const LOOKUP_DOMAIN_PLACEHOLDER = '{domain}'

/**
 * Read a user-supplied list of `Name = https://example.com/{domain}` lines.
 *
 * The older `|` is still read, so a list written before the separator changed
 * keeps working, and the split is on the first separator only – every one of
 * these URLs carries a `=` of its own in a query string.
 *
 * Anything that is not an https URL containing the placeholder is dropped: the
 * whole point is that pressing one of these buttons goes where the label says.
 */
export function parseLookupServices(raw: string): LookupService[] {
  const services: LookupService[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue

    const candidates = [trimmed.indexOf('='), trimmed.indexOf('|')].filter(index => index > 0)
    if (!candidates.length)
      continue

    const separator = Math.min(...candidates)

    const name = trimmed.slice(0, separator).trim()
    const url = trimmed.slice(separator + 1).trim()

    if (!name || !url.startsWith('https://') || !url.includes(LOOKUP_DOMAIN_PLACEHOLDER))
      continue

    services.push({ name, url })
  }

  return services
}

/** Render a list back into the editable text form. */
export function serializeLookupServices(services: LookupService[]): string {
  return services.map(service => `${service.name} = ${service.url}`).join('\n')
}

/**
 * The services to offer, read from the user's text.
 *
 * There is deliberately no fallback to the shipped list: the settings field is
 * seeded with it as ordinary text, so deleting a line means the user does not
 * want that service, and emptying the field means they want none. Quietly
 * restoring the defaults would make those edits impossible.
 */
export function getLookupServices(configured: string | undefined): LookupService[] {
  return parseLookupServices(configured || '')
}

/**
 * Fill in the domain, encoded so a hostile hostname cannot reshape the URL.
 *
 * Returns null for anything that is not a domain, so the buttons stay absent
 * rather than pointing somewhere useless.
 */
export function buildLookupUrl(service: LookupService, domain: string): string | null {
  const clean = domain.trim().toLowerCase().replace(/\.$/, '')
  if (!clean || !clean.includes('.'))
    return null

  return service.url.replaceAll(LOOKUP_DOMAIN_PLACEHOLDER, encodeURIComponent(clean))
}
