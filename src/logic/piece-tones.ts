import type { AddressShape } from './domain-boundary'
import type { DomainMarker } from './domain-markers'
import type { LookalikeMatch } from './domain-similarity'
import { ADDRESS_DOTS, decodeHostname, imitatedDomains } from './domain-markers'
import { isRedFlagLookalike, isRedFlagMarker } from './red-flags'

/**
 * Which labels of an address a finding is about, and in which colour.
 *
 * Every finding is said in a line under the address, and the line used to be
 * the only place it was said: "Made to look like paypal.com" stood under an
 * address in which `paypal` and `com` looked like every other label, and the
 * reader was left to find them. Each line now has its piece of the address
 * drawn in the line's own colour, red for a red flag and orange for what is
 * only worth a look, on every surface that draws an address, from this one
 * function. A surface that coloured its own pieces would drift from the rest
 * the way the wording of the lines once did.
 *
 * What each finding is about:
 *
 * - a domain parked in front of another site: the labels that spell it,
 * - a name in another alphabet, or in two at once: the label the line names,
 * - a numeric address: the whole of it, red or orange as the line is,
 * - many subdomain levels: every label in front of the site,
 * - a well-known ending in the middle of an address domain: that label,
 * - a lookalike: the label the match was found in, wherever it stands, and
 *   the ending where the name is the familiar one letter for letter and only
 *   the ending differs,
 * - a shared platform: the platform's labels, at the end of the address,
 * - a kind of service the screen calls out, a throwaway mail service or a
 *   short-link service: the site, name and ending.
 *
 * One finding has no label to colour: a decoy name before the @ of a link is
 * not part of the address drawn, and its line strikes it through itself.
 *
 * A label two findings are about takes red. Nothing here decides whether a
 * finding is drawn: it is handed what the lines draw. A new kind of marker
 * does not compile until it is given its piece, or its reason for none, below.
 */
export type PieceTone = 'danger' | 'caution'

export interface PieceFindings {
  /** The markers as the lines under the address draw them */
  markers: readonly DomainMarker[]
  /** The lookalike matches as the lines draw them */
  lookalikes: readonly LookalikeMatch[]
  /** Whose the labels are. Absent until it is known, and then nothing that needs it is coloured */
  shape?: AddressShape
  /** The line about a shared platform is on screen, which it is not for a familiar site */
  platform?: boolean
  /** The site is a throwaway mail service or a short-link service, and the screen says so */
  service?: boolean
}

/** The labels of an address, as the painter counts them. */
function split(hostname: string): string[] {
  const labels = hostname.toLowerCase().split(ADDRESS_DOTS)
  // A dot at the very end is drawn after the last label, not as a label
  if (labels.length > 1 && labels.at(-1) === '')
    labels.pop()
  return labels
}

export function pieceTones(hostname: string, findings: PieceFindings): Map<number, PieceTone> {
  const tones = new Map<number, PieceTone>()
  if (!hostname)
    return tones

  // As written and as read: a finding quotes the readable spelling, and the
  // address may be drawn in either. The two have the same labels in the same
  // places, and where they somehow do not, only the written one is trusted
  const written = split(hostname)
  const decoded = split(decodeHostname(hostname))
  const read = decoded.length === written.length ? decoded : written
  const count = written.length
  const owner = Math.min(findings.shape?.ownerLabels ?? 0, count)
  const suffix = Math.min(findings.shape?.suffixLabels ?? 0, owner)

  const paint = (from: number, to: number, tone: PieceTone) => {
    for (let index = Math.max(0, from); index < Math.min(to, count); index++) {
      if (tones.get(index) !== 'danger')
        tones.set(index, tone)
    }
  }
  /** Every place a run of labels stands in the address, at or after `from`, none overlapping. */
  const places = (piece: string, from = 0): [start: number, end: number][] => {
    const wanted = split(piece)
    const found: [number, number][] = []
    for (let start = from; start + wanted.length <= count; start++) {
      if ([written, read].some(labels => wanted.every((label, offset) => labels[start + offset] === label))) {
        found.push([start, start + wanted.length])
        start += wanted.length - 1
      }
    }
    return found
  }

  for (const marker of findings.markers) {
    const tone: PieceTone = isRedFlagMarker(marker) ? 'danger' : 'caution'
    switch (marker.id) {
      case 'embedded-public-suffix': {
        // In the order the line names them, each after the one before
        let from = 0
        for (const domain of imitatedDomains(marker)) {
          const [at] = places(domain, from)
          if (at) {
            paint(at[0], at[1], tone)
            from = at[1]
          }
        }
        break
      }
      // The label the line names. Another part in another alphabet has no
      // line of its own, so it gets no colour of its own either
      case 'non-latin-name':
      case 'mixed-scripts':
        for (const [start, end] of places(marker.detail))
          paint(start, end, tone)
        break
      case 'mid-ending':
        // Where the check found it, not the first label that reads the same
        paint(marker.at, marker.at + 1, tone)
        break
      case 'ip-host':
        paint(0, count, tone)
        break
      case 'deep-subdomains':
        // The labels in front of the site, by the same guess that counted
        // them while the shape is not known yet
        paint(0, owner ? count - owner : Number(marker.detail) || 0, tone)
        break
      case 'url-userinfo':
        // About the part of the link before the @, which is not in the address
        break
      default: {
        const unhandled: never = marker
        void unhandled
      }
    }
  }

  for (const match of findings.lookalikes) {
    const tone: PieceTone = isRedFlagLookalike(match) ? 'danger' : 'caution'
    // Every name the line gives, when it gives several
    const found = [match.evidence, ...(match.also ?? []).map(item => item.evidence)].flatMap(evidence => places(evidence))
    // The site's own name, and it is the familiar name letter for letter:
    // what is off is the ending. Not said until the site is known, so the
    // colour does not start on the name and jump to the ending
    if (match.reason === 'same-name') {
      if (owner && found.some(([start, end]) => start === count - owner && end === count - suffix))
        paint(count - suffix, count, tone)
      else if (owner)
        found.forEach(([start, end]) => paint(start, end, tone))
      continue
    }
    // Wherever the match was found: a near miss of a known name is as often a
    // label in front of the site as the site's own. Never starting in the
    // ending, which the check does not compare: `dev.example.dev` with `dev`
    // matched in front. Before the shape is known the last label is taken for
    // the ending, which it always is at least, so the colour does not jump.
    // A known domain spelled into a private ending, `mail.ru.com`, starts in
    // front of it and is coloured whole
    found
      .filter(([start]) => start < count - Math.max(suffix, 1))
      .forEach(([start, end]) => paint(start, end, tone))
  }

  // The platform is the end of the address. Its name further in front is
  // somebody's label, `github.io.attacker.github.io`
  if (findings.platform && findings.shape?.platform) {
    const platform = split(findings.shape.platform)
    if (platform.every((label, offset) => written[count - platform.length + offset] === label))
      paint(count - platform.length, count, 'caution')
  }

  if (findings.service && owner)
    paint(count - owner, count, 'caution')

  return tones
}
