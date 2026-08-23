import type { SiteVisitData } from './storage'

/**
 * Two visits closer together than this are treated as one, so that reloads and
 * SPA navigations don't inflate the counter.
 */
export const VISIT_DEBOUNCE_MS = 60_000

/**
 * Local-time day key (YYYY-MM-DD). Active days are counted in the user's own
 * timezone – "I was there on 3 different days" is a human statement, not a UTC one.
 */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * What kind of address this is.
 *
 * `hostname.includes('.')` used to answer for all of this, and it is wrong at
 * both ends. A public IPv6 address has no dot in it, so it was filed with
 * `localhost` as an internal name - which on the current page meant forced safe,
 * warned about nothing, and no way for the user to say otherwise. And every
 * address on the home network has dots, so `192.168.1.1` was counted as an
 * ordinary site and warned about until it had been opened ten times.
 */
export type HostKind
  = | 'dns'
  /** A name that resolves inside one network: `localhost`, `nas`, `printer.lan`. */
    | 'local'
    | 'ipv4'
    | 'ipv6'
  /** An address on a private or link-local range, v4 or v6. */
    | 'private-ip'
    | 'unknown'

/** Suffixes reserved for names that only mean something inside one network. */
const LOCAL_SUFFIXES = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.home']

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))
    return true // not a real address, so certainly not one worth counting

  const [a, b] = parts
  return a === 10
    || a === 127
    || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    // Carrier-grade NAT, which is somebody else's network rather than the internet
    || (a === 100 && b >= 64 && b <= 127)
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  return lower === '::1'
    || lower === '::'
    || lower.startsWith('fe80:')
    // fc00::/7, the unique local range
    || /^f[cd][0-9a-f]{2}:/.test(lower)
}

export function classifyHost(hostname: string): HostKind {
  const name = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!name)
    return 'unknown'

  // A URL keeps an IPv6 address in brackets, and everything else drops them
  const bare = name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name

  if (IPV4.test(bare))
    return isPrivateIpv4(bare) ? 'private-ip' : 'ipv4'

  if (bare.includes(':'))
    return isPrivateIpv6(bare) ? 'private-ip' : 'ipv6'

  if (!name.includes('.'))
    return 'local'

  if (LOCAL_SUFFIXES.some(suffix => name.endsWith(suffix)))
    return 'local'

  return 'dns'
}

/**
 * Is this an address worth keeping a visit count for?
 *
 * No for anything that only means something inside one network. Its count could
 * never say anything about the wider internet, and reading a permanent zero as
 * "unfamiliar" would warn about the router's own page forever with no way for
 * the user to teach it otherwise.
 */
export function isTrackableHostname(hostname: string): boolean {
  const kind = classifyHost(hostname)
  return kind === 'dns' || kind === 'ipv4' || kind === 'ipv6'
}

/**
 * Fold a new visit into the stored record.
 *
 * `firstSeen` and `activeDays` stay `undefined` on records created before those
 * fields existed: we cannot know when the user first visited a site, and stamping
 * "today" would present a guess as a fact. Only a history import can fill them in.
 */
export function applyVisit(existing: SiteVisitData | undefined, now: number): SiteVisitData {
  if (!existing)
    return { count: 1, firstSeen: now, lastSeen: now, activeDays: 1, ignored: false }

  const lastSeen = existing.lastSeen || 0
  const count = existing.count || 0
  const isNewVisit = !lastSeen || (now - lastSeen) > VISIT_DEBOUNCE_MS
  const isNewDay = !lastSeen || dayKey(lastSeen) !== dayKey(now)

  return {
    count: isNewVisit ? count + 1 : count,
    firstSeen: existing.firstSeen,
    lastSeen: now,
    activeDays: existing.activeDays === undefined
      ? undefined
      : existing.activeDays + (isNewDay ? 1 : 0),
    ignored: existing.ignored || false,
  }
}
