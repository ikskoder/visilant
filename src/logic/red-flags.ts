import type { DomainMarker } from './domain-markers'
import type { LookalikeMatch } from './domain-similarity'
import { dropExplainedMarkers, findDomainMarkers } from './domain-markers'
import { classifyHost } from './visit-stats'

/**
 * Which findings about an address are red flags.
 *
 * A red flag is a finding that is a reason to stop on its own, whatever the
 * visit count says: the address is built to be misread. It is drawn as a flag,
 * and counted beside the verdict, in red. Everything else the checks say
 * about an address is worth a look and no more, drawn in orange with the
 * shield and its exclamation mark, and is not one of these:
 *
 * - many subdomain levels: long names are common on real sites,
 * - a tenant of a shared platform: says who runs it, not that it lies,
 * - a disposable or public mail service, a short link: a kind of service,
 *   not a disguise,
 * - a lookalike of medium severity: a near miss the reader should look at,
 *   which on its own is as often an honest neighbour as a copy,
 * - a numeric address on a private range: a router or a printer.
 *
 * The line and the count are decided here, together, so a flag drawn on screen
 * and the number beside the verdict can never disagree.
 */
export function isRedFlagMarker(marker: DomainMarker): boolean {
  switch (marker.id) {
    case 'url-userinfo':
    case 'embedded-public-suffix':
    case 'mixed-scripts':
    case 'non-latin-name':
      return true
    case 'ip-host':
      return classifyHost(marker.detail) !== 'private-ip'
    default:
      return false
  }
}

export function isRedFlagLookalike(match: LookalikeMatch): boolean {
  return match.severity === 'high'
}

/**
 * The red flags of one address, counted the way the lines under it draw them:
 * the same markers, the embedded ending dropped once the lookalikes are known,
 * and every sure lookalike. For a decision taken outside a view, where the
 * count beside the verdict is `useRedFlagCount`. `matches` is null when the
 * lookalike question has no answer, which counts none of them.
 */
export function addressRedFlagCount(hostname: string, url: string | null | undefined, matches: LookalikeMatch[] | null): number {
  const markers = dropExplainedMarkers(findDomainMarkers(hostname, url), matches)
  return markers.filter(isRedFlagMarker).length + (matches ?? []).filter(isRedFlagLookalike).length
}
