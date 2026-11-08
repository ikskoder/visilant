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

/**
 * The IPv4 address carried inside an IPv6 one, if any: `::ffff:192.168.1.1`,
 * which the URL parser rewrites to `::ffff:c0a8:101`, and the NAT64 prefix
 * `64:ff9b::`. Without this a private v4 address passed for a public v6 one.
 */
function embeddedIpv4(lower: string): string | null {
  const match = /^(?:::ffff:|64:ff9b::)(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(lower)
  if (!match)
    return null
  if (match[1])
    return match[1]
  const high = Number.parseInt(match[2], 16)
  const low = Number.parseInt(match[3], 16)
  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  const v4 = embeddedIpv4(lower)
  if (v4)
    return isPrivateIpv4(v4)
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
 * Why an address that is never counted is not counted, for the words shown in
 * its place: a private IP address has no name at all, a local name has one
 * that only means something inside one network.
 */
export function untrackedReason(hostname: string): 'ip' | 'local' {
  return classifyHost(hostname) === 'private-ip' ? 'ip' : 'local'
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

  // A record with no visit in it yet: written when somebody silenced a site
  // before ever using it. This visit is the first one, and it is known to be,
  // so the dates start here. Taken for a record from before the dates were
  // kept, it never got them, and under the checks that need them the site
  // could never become familiar however often it was used.
  if (!existing.count && !existing.lastSeen) {
    return {
      count: 1,
      firstSeen: now,
      lastSeen: now,
      activeDays: 1,
      ignored: existing.ignored || false,
      ...(existing.ignored && existing.silencedWhileFamiliar && { silencedWhileFamiliar: true }),
    }
  }

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
    // Part of the silence, and carried with it – see canAutoLift
    ...(existing.ignored && existing.silencedWhileFamiliar && { silencedWhileFamiliar: true }),
  }
}

/**
 * Fold one report of somebody using a page into the record.
 *
 * A reload is a visit only when it is the first thing this site saw today.
 * Somebody who keeps a mail tab open for a week and presses F5 every morning is
 * there every day, and the active days have to say so. Twenty reloads in one
 * afternoon are not twenty visits, and counting them would let a page that a
 * person touches now and then climb to familiar on its own refresh button.
 *
 * Returns the record unchanged, the same object, when the report does not count.
 */
export function applyReport(existing: SiteVisitData | undefined, now: number, reload: boolean): SiteVisitData | undefined {
  if (reload && existing?.lastSeen && dayKey(existing.lastSeen) === dayKey(now))
    return existing
  return applyVisit(existing, now)
}

/** One entry out of the browser's history, as much of it as the count needs. */
export interface HistoryVisit {
  time: number
  reload: boolean
}

/**
 * A hostname's history as the live counter would have counted it.
 *
 * The browser keeps every load, reloads and visits a second apart included, so
 * adding them up made a page that reloaded itself in a background tab look like
 * a site visited hundreds of times. Folded through the same rule a live report
 * goes through, in order of time: one visit per minute, a reload only as the
 * first visit of its day.
 */
export function summarizeVisits(visits: HistoryVisit[]): { count: number, firstSeen: number, lastSeen: number, activeDays: number } | undefined {
  const valid = visits
    .filter(visit => typeof visit.time === 'number' && Number.isFinite(visit.time) && visit.time > 0)
    .sort((a, b) => a.time - b.time)
  if (!valid.length)
    return undefined

  let record: SiteVisitData | undefined
  for (const visit of valid)
    record = applyReport(record, visit.time, visit.reload)

  return {
    count: record!.count,
    firstSeen: valid[0].time,
    lastSeen: valid[valid.length - 1].time,
    activeDays: record!.activeDays ?? 1,
  }
}
