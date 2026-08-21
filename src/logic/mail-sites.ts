import type { FamiliaritySettings, FamiliarityStats } from './familiarity'
import type { SiteVisitData } from './storage'
import { aggregateFamiliarityStats, isFamiliar } from './familiarity'

/**
 * Where the mail of an address domain is actually read.
 *
 * Nobody ever opens `gmail.com` – Gmail is read on `mail.google.com` – so the
 * visit count of an address domain is a zero that can never move, and every panel
 * reads it as a site the user has never been to. This maps the address domain to
 * the page the mail is read on, so the numbers come from where the visits are.
 *
 * The right-hand side names the mailbox as exactly as it can, `mail.google.com`
 * rather than `google.com`: searching all day says nothing about whether the user
 * knows that mailbox. Where the whole brand is the mail service – `icloud.com`,
 * `mail.ru`, `gmx.net` – the family is the honest answer and is used as it is.
 *
 * The table is deliberately short: it holds the brands whose mail is read
 * somewhere other than the address domain, and nothing else. `yandex.ru` and
 * `qq.com` keep their webmail inside their own family, so their visits already
 * count and they do not belong here.
 *
 * There is no public list of this shape to fetch. Thunderbird's autoconfig
 * database (`autoconfig.thunderbird.net`) is the closest thing, and it answers
 * with IMAP and SMTP hostnames rather than the site a person visits – it names
 * `imap.gmail.com`, never `mail.google.com`. So the table is written out here,
 * and the user can extend it.
 *
 * Nothing here is a safety marker: it moves visits the user already made from one
 * name to another, so a phisher learns nothing from reading it.
 */
const BUILTIN_MAIL_SITES = `
gmail.com = mail.google.com
googlemail.com = mail.google.com
hotmail.com = outlook.live.com
live.com = outlook.live.com
msn.com = outlook.live.com
windowslive.com = outlook.live.com
outlook.com = outlook.live.com, outlook.office.com
me.com = icloud.com
mac.com = icloud.com
ymail.com = mail.yahoo.com
rocketmail.com = mail.yahoo.com
protonmail.com = mail.proton.me
pm.me = mail.proton.me
tutanota.com = app.tuta.com
tutamail.com = app.tuta.com
tuta.io = app.tuta.com
zohomail.com = mail.zoho.com
ya.ru = mail.yandex.ru
bk.ru = mail.ru
inbox.ru = mail.ru
list.ru = mail.ru
internet.ru = mail.ru
foxmail.com = mail.qq.com
yeah.net = mail.163.com
hanmail.net = mail.daum.net
gmx.de = gmx.net
gmx.com = gmx.net
`

export type MailSiteMap = Map<string, string[]>

/**
 * Read a mapping list: one `address-domain = site, site` line at a time.
 *
 * Blank lines and `#` comments are skipped, as in every other list on the
 * settings page. A line without a site, or with a name that carries no dot, is
 * dropped rather than half-applied.
 */
export function parseMailSiteMap(raw: string): MailSiteMap {
  const map: MailSiteMap = new Map()

  for (const line of raw.split(/[\n\r]+/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue

    // `a.com = b.com`, `a.com -> b.com` and a plain `a.com b.com` all read the
    // same way, so a line typed from memory still lands
    const [rawKey, ...rest] = trimmed.split(/\s*(?:=|->)\s*/)
    const [fallbackKey, ...fallbackSites] = trimmed.split(/\s+/)
    const key = (rest.length ? rawKey : fallbackKey).trim().toLowerCase().replace(/^@/, '')
    const rawSites = rest.length ? rest.join(' ') : fallbackSites.join(' ')
    if (!key.includes('.') || !rawSites)
      continue

    const sites = rawSites
      .split(/[\s,;]+/)
      .map(site => site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(site => site.includes('.'))
    if (!sites.length)
      continue

    const existing = map.get(key)
    if (existing) {
      for (const site of sites) {
        if (!existing.includes(site))
          existing.push(site)
      }
    }
    else {
      map.set(key, sites)
    }
  }

  return map
}

/** Turn a mapping back into the text form the settings page edits. */
export function formatMailSiteMap(map: MailSiteMap): string {
  return [...map.entries()].map(([domain, sites]) => `${domain} = ${sites.join(', ')}`).join('\n')
}

// Runtime layers – built-in, then remote, then the user's own. They add up
// rather than replace: a line the user writes widens what a brand is read on.
let customLines: string[] = []
let remoteLines: string[] = []
let mailSites: MailSiteMap = parseMailSiteMap(BUILTIN_MAIL_SITES)

function rebuildMap() {
  mailSites = parseMailSiteMap([BUILTIN_MAIL_SITES, remoteLines.join('\n'), customLines.join('\n')].join('\n'))
}

export function loadCustomMailSites(lines: string[]): void {
  customLines = lines
  rebuildMap()
}

export function updateRemoteMailSites(lines: string[]): void {
  remoteLines = lines
  rebuildMap()
}

/**
 * The sites an address domain's mail is read on, or an empty list when the
 * address domain is a site in its own right.
 *
 * A site that is the address domain itself is dropped: the panel already shows
 * that family, and repeating it under another heading would count it twice.
 */
export function resolveMailSites(domain: string): string[] {
  const lower = domain.trim().toLowerCase()
  const sites = mailSites.get(lower)
  if (!sites)
    return []
  return sites.filter(site => site !== lower && !lower.endsWith(`.${site}`))
}

export interface MailSiteFamily {
  /** The site the mail is read on */
  site: string
  /** Visits to that site and everything under it */
  total: number
  stats: FamiliarityStats
  /** Whether that site passes the familiarity rules, when they were supplied */
  familiar?: boolean
}

function isVisitRecord(value: unknown): value is SiteVisitData {
  return typeof value === 'object' && value !== null && typeof (value as SiteVisitData).count === 'number'
}

/**
 * Roll up the visits an address domain's mail sites have, from raw storage.
 *
 * Sites with no visits at all are kept: "you have never opened that mailbox
 * either" is an answer, and dropping the row would leave the panel silent about
 * a mapping it just used.
 */
export function collectMailSiteFamilies(
  records: Record<string, unknown>,
  domain: string,
  rules?: FamiliaritySettings,
  now: number = Date.now(),
): MailSiteFamily[] {
  const sites = resolveMailSites(domain)
  if (!sites.length)
    return []

  return sites.map((site) => {
    const group: SiteVisitData[] = []
    for (const [key, value] of Object.entries(records)) {
      if (key !== site && !key.endsWith(`.${site}`))
        continue
      if (isVisitRecord(value))
        group.push(value)
    }

    const stats = aggregateFamiliarityStats(group)
    return {
      site,
      total: stats.count,
      stats,
      familiar: rules ? isFamiliar(stats, rules, now) : undefined,
    }
  })
}

const MAX_REMOTE_LINES = 20_000

/** Fetch one mapping list. Throws on network and HTTP errors. */
async function fetchRemoteMailSiteList(url: string): Promise<string[]> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to fetch list: ${response.status}`)
  const text = await response.text()
  return formatMailSiteMap(parseMailSiteMap(text)).split('\n').filter(Boolean).slice(0, MAX_REMOTE_LINES)
}

/**
 * Fetch several mapping lists and merge them.
 *
 * Shaped like the domain-list fetcher so the settings page can drive both with
 * the same code: `domains` here holds one mapping line each.
 */
export async function fetchRemoteMailSiteLists(urls: string[]): Promise<{ domains: string[], ok: number, failed: number }> {
  const merged = new Set<string>()
  let ok = 0
  let failed = 0

  const results = await Promise.allSettled(urls.map(url => fetchRemoteMailSiteList(url)))
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      failed++
      continue
    }
    ok++
    for (const line of result.value)
      merged.add(line)
  }

  return { domains: [...merged].slice(0, MAX_REMOTE_LINES), ok, failed }
}

// storage.local keys shared by all contexts
export const STORAGE_KEY_CUSTOM_MAIL_SITES = 'customMailSites'
export const STORAGE_KEY_REMOTE_MAIL_SITES = 'remoteMailSites'

/**
 * Load both editable layers out of a storage snapshot already in hand.
 *
 * The background reads all of `storage.local` to build a domain family anyway,
 * so it fills the table from that read instead of paying for another one – and
 * gets whatever the settings page saved a moment ago rather than a cached copy.
 */
export function loadMailSitesFromRecords(records: Record<string, unknown>): void {
  const remote = records[STORAGE_KEY_REMOTE_MAIL_SITES] as { domains?: string[] } | undefined
  customLines = (records[STORAGE_KEY_CUSTOM_MAIL_SITES] as string[]) || []
  remoteLines = remote?.domains || []
  rebuildMap()
}
