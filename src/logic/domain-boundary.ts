import { getDomain, getPublicSuffix } from 'tldts'

/**
 * Where one owner's site stops and the next one's begins.
 *
 * Everything in this extension that folds hostnames together – the domain
 * family in the popup, the familiar index the lookalike check compares against,
 * the aggregate a verdict is taken from – has to agree on that line, and it has
 * to be the line that matches who actually controls the name.
 *
 * The default public suffix list does not draw it there. It stops at `github.io`,
 * so `alice.github.io` and `evil.github.io` come back as one domain: their visits
 * are added together, and a lookalike check that finds the family already
 * familiar stops before it has compared anything. The same goes for `pages.dev`,
 * `blogspot.com`, `vercel.app`, `netlify.app`, `workers.dev` and every other
 * platform that hands out a subdomain per customer.
 *
 * The private section of the list is exactly the record of which suffixes those
 * are, so every boundary question in the extension goes through here with it
 * switched on. Two tenants of one platform are two sites, which is what they are.
 */
const BOUNDARY = { allowPrivateDomains: true } as const

/**
 * The site a hostname belongs to, or null when there is no site to speak of.
 *
 * Null covers an IP address, a dotless intranet name, and a platform suffix
 * typed on its own – `github.io` is not a tenant of anything.
 */
export function siteDomain(hostname: string): string | null {
  return getDomain(hostname, BOUNDARY)
}

/**
 * The same, with the hostname itself as the answer when there is no site.
 *
 * What most callers want: an IP address or an intranet name is its own family
 * of one, and grouping it under an empty string would put every one of them in
 * the same bucket.
 */
export function siteDomainOrSelf(hostname: string): string {
  return siteDomain(hostname) || hostname
}

/**
 * The platform a tenant sits on, when the boundary came from a private suffix.
 *
 * `alice.github.io` gives `github.io`, `example.com` gives null. Null is the
 * ordinary case: most names are registered directly under a public suffix and
 * have no landlord worth naming.
 */
export function hostingPlatform(hostname: string): string | null {
  const withPrivate = getPublicSuffix(hostname, BOUNDARY)
  if (!withPrivate)
    return null

  // A private suffix is one the public list does not know about. Comparing the
  // two answers is what tells them apart, without keeping a second list here.
  const publicOnly = getPublicSuffix(hostname)
  return withPrivate !== publicOnly ? withPrivate : null
}

/** Is this name handed out by a platform that hands out one per customer? */
export function isPlatformTenant(hostname: string): boolean {
  return hostingPlatform(hostname) !== null
}

/**
 * Does this hostname belong to that site?
 *
 * The one place the "or a subdomain of it" test is written, so a scan over
 * stored records cannot quietly use a different rule from the one that decided
 * what the site was.
 */
export function belongsToSite(hostname: string, site: string): boolean {
  return hostname === site || hostname.endsWith(`.${site}`)
}
