import punycode from 'punycode'
import { getRegistrableDomain } from './domain-markers'

/**
 * Does this address look like one the user already knows?
 *
 * The reference set is the user's own visit history, never a shipped list of
 * brands. That has two consequences worth keeping in mind while reading this
 * file: the comparison is different for every user, so an attacker cannot test
 * their domain against it in advance, and nothing here needs maintaining after
 * release.
 *
 * Nothing in here is a verdict. A match means "this resembles something you
 * know" – the user still decides.
 */

/**
 * Where a reference domain came from.
 *
 * `history` is the rule: the user's own visits, different for every profile.
 * `provider` is the one deliberate exception, and only for email addresses –
 * see `PROVIDER_REFERENCE_NOTE` below.
 */
export type FamiliarSource = 'history' | 'provider'

/** One registrable domain worth imitating, and therefore worth comparing to. */
export interface FamiliarDomain {
  /** Registrable domain, e.g. `paypal.com` */
  domain: string
  /** Its leading label, e.g. `paypal` */
  label: string
  /** Total visits across the whole domain family. Zero for a provider. */
  visits: number
  /** Absent means `history`, which is what everything stored has always been. */
  source?: FamiliarSource
}

/**
 * Why a shipped list is allowed here, against the rule stated above.
 *
 * A brand is only in the history when the user loads its own domain, and the
 * biggest mail providers redirect away from theirs – somebody who lives in Gmail
 * has `mail.google.com` on record and never `gmail.com`, so the one name most
 * worth protecting is the one name the history cannot supply. No mapping from
 * the visited host back to the brand exists to be derived, either.
 *
 * The property given up is that an attacker cannot test a domain against the
 * reference set in advance. For the world's largest mail providers that property
 * was never real: nobody needs to probe anything to know Gmail is the target.
 * It is given up nowhere else – ordinary browsing warnings stay history-only.
 */
export const PROVIDER_REFERENCE_NOTE = 'email addresses only'

export type LookalikeReason =
  /** Identical once visually confusable characters are folded together */
  | 'confusable'
  /** One or two edits away from a familiar name */
  | 'edit-distance'
  /** A familiar name is one token of a longer label, or embedded in it */
  | 'contains-familiar'
  /** A familiar name, or a whole familiar domain, used as a subdomain */
  | 'familiar-as-subdomain'
  /** The same name under a different domain – `paypal.co` next to `paypal.com` */
  | 'same-name'

export interface LookalikeMatch {
  /** The familiar domain being imitated */
  domain: string
  visits: number
  reason: LookalikeReason
  /** The part of the checked address that produced the match */
  evidence: string
  severity: 'high' | 'medium'
  /**
   * Absent means `history`. The UI needs this: a visit count and the words "a
   * site you know" are both untrue of a provider the user has never opened.
   */
  source?: FamiliarSource
}

/**
 * Below this length, a typo is indistinguishable from a different word.
 *
 * Measured against the longer of the two names being compared, not the address
 * being checked. Dropping a letter from a five-letter name leaves four, and
 * judging that four-letter result on its own length would dismiss the most
 * ordinary typosquat there is – `gmal` for `gmail`.
 */
const MIN_EDIT_DISTANCE_LENGTH = 5
/**
 * A short name is only ever matched at one edit, and only when it starts the
 * same way.
 *
 * Two edits between short words happen constantly between unrelated ones, and
 * folding confusables together makes four-letter words collide more still –
 * `mall` and `gmail` come out one edit apart once `i` and `l` are the same
 * character. The first letter is the one nobody mistypes and no squatter drops,
 * so it separates a typo from a different word cheaply.
 */
const SHORT_LABEL_MAX_DISTANCE = 1
/** Below this length, a familiar name matches inside unrelated words by chance. */
const MIN_CONTAINMENT_LENGTH = 5
/**
 * Shortest familiar name still worth recognising as a separated-out token.
 *
 * Hunting for `moz` inside a longer word finds `mozilla`, but `moz` standing
 * alone in `moz-login` is the name and nothing else. Two characters is where
 * even that stops meaning anything.
 */
const MIN_TOKEN_LENGTH = 3
const MAX_EDIT_DISTANCE = 2
/** How many matches to report; more than this is noise, not information. */
const MAX_MATCHES = 3

/**
 * Characters that render close enough to a Latin letter to be read as one.
 *
 * This is a property of the glyphs rather than a judgement about anyone, so it
 * does not go out of date. It is deliberately small: the handful of Cyrillic and
 * Greek letters that actually appear in homograph attacks, plus the digits that
 * stand in for letters.
 */
const CONFUSABLE_FOLD: Record<string, string> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  г: 'r',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'l',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  ζ: 'z',
  η: 'n',
  ι: 'l',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  // Digits standing in for letters
  0: 'o',
  1: 'l',
  3: 'e',
  4: 'a',
  5: 's',
  6: 'b',
  7: 't',
  8: 'b',
  9: 'g',
  // Letters standing in for each other
  i: 'l',
}

/**
 * Fold an address down to what the eye actually sees.
 *
 * `paypa1`, `pаypal` (Cyrillic а) and `paypai` all collapse to the same string,
 * which is the whole point – an attacker picks whichever spelling is still
 * available to register.
 */
export function skeleton(value: string): string {
  let folded = ''
  for (const char of value.normalize('NFKC').toLowerCase())
    folded += CONFUSABLE_FOLD[char] ?? char

  // Digraphs read as a single letter at a glance
  return folded.replace(/rn/g, 'm').replace(/vv/g, 'w')
}

/**
 * Damerau-Levenshtein distance, abandoned as soon as it exceeds `max`.
 *
 * Bailing out early is what makes this affordable to run against every candidate:
 * a name more than `max` edits away stops costing anything after `max + 1` rows.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (a === b)
    return 0
  if (Math.abs(a.length - b.length) > max)
    return max + 1
  if (!a.length || !b.length)
    return Math.max(a.length, b.length)

  let twoRowsBack: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current: number[] = []

  for (let i = 1; i <= a.length; i++) {
    current = [i]
    let rowMin = i

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        current[j - 1] + 1, // insertion
        previous[j] + 1, // deletion
        previous[j - 1] + cost, // substitution
      )

      // Transposition: `payapl` is one edit from `paypal`, not two
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, twoRowsBack[j - 2] + 1)

      current[j] = value
      rowMin = Math.min(rowMin, value)
    }

    // Every remaining row can only grow, so nothing here will come back under max
    if (rowMin > max)
      return max + 1

    twoRowsBack = previous
    previous = current
  }

  return previous[b.length]
}

interface IndexedDomain extends FamiliarDomain {
  labelSkeleton: string
}

export interface FamiliarIndex {
  entries: IndexedDomain[]
  /** Registrable domain → entry, for the subdomain matcher */
  byDomain: Map<string, IndexedDomain>
  /** Exact skeleton → entries, for the confusable matcher */
  bySkeleton: Map<string, IndexedDomain[]>
  /** Skeleton length → entries, the bucket the edit-distance matcher draws from */
  byLength: Map<number, IndexedDomain[]>
  /** Leading trigram → entries, so containment scans the address, not the index */
  byTrigram: Map<string, IndexedDomain[]>
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const bucket = map.get(key)
  if (bucket)
    bucket.push(value)
  else
    map.set(key, [value])
}

/**
 * Precompute the lookup structures once per index load.
 *
 * Building costs one pass over the familiar names, which keeps every later query
 * proportional to the length of the address being checked rather than to the size
 * of the user's history.
 */
export function buildFamiliarIndex(domains: FamiliarDomain[]): FamiliarIndex {
  const index: FamiliarIndex = {
    entries: [],
    byDomain: new Map(),
    bySkeleton: new Map(),
    byLength: new Map(),
    byTrigram: new Map(),
  }

  for (const domain of domains) {
    if (!domain.domain || !domain.label)
      continue

    // First entry for a domain wins, so a caller that puts the history in front
    // keeps the real visit count for anything that is also on the provider list
    if (index.byDomain.has(domain.domain.toLowerCase()))
      continue

    const entry: IndexedDomain = { ...domain, labelSkeleton: skeleton(domain.label) }
    index.entries.push(entry)
    index.byDomain.set(domain.domain.toLowerCase(), entry)
    push(index.bySkeleton, entry.labelSkeleton, entry)
    push(index.byLength, entry.labelSkeleton.length, entry)

    if (entry.labelSkeleton.length >= MIN_CONTAINMENT_LENGTH)
      push(index.byTrigram, entry.labelSkeleton.slice(0, 3), entry)
  }

  return index
}

/** True when the address already belongs to the familiar domain's own family. */
function isSameFamily(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function betterThan(candidate: LookalikeMatch, existing: LookalikeMatch): boolean {
  if (candidate.severity !== existing.severity)
    return candidate.severity === 'high'
  return candidate.visits > existing.visits
}

/**
 * Every familiar name that the given address resembles, most convincing first.
 *
 * Recall is favoured over precision here on purpose: a match is presented as
 * context rather than as an accusation, and only `high` severity is meant to
 * interrupt anyone. Missing a real impersonation costs more than showing a
 * resemblance that turns out to be innocent.
 */
export function findLookalikes(
  hostname: string,
  index: FamiliarIndex,
  /**
   * The registrable domain, when the caller can determine it properly. The
   * background can, because it already carries the public suffix list. The
   * fallback derives it from the shape of the name instead.
   */
  registrableDomain?: string,
): LookalikeMatch[] {
  const address = decodeHostname(hostname).toLowerCase().replace(/\.$/, '')
  if (!address || !index.entries.length)
    return []

  const labels = address.split('.').filter(Boolean)
  if (labels.length < 2)
    return []

  // A domain the user already knows is never an imitation of another one.
  // Without this, someone who uses both google.com and google.de would be told
  // about the resemblance on every single visit.
  const registrable = registrableDomain?.toLowerCase() || getRegistrableDomain(address)
  if (index.byDomain.has(registrable))
    return []

  const registrableLabel = registrable.split('.')[0]
  const best = new Map<string, LookalikeMatch>()

  const offer = (match: LookalikeMatch) => {
    if (isSameFamily(address, match.domain))
      return
    const existing = best.get(match.domain)
    if (!existing || betterThan(match, existing))
      best.set(match.domain, match)
  }

  matchFamiliarAsSubdomain(labels, index, offer)

  for (const label of labels) {
    const labelSkeleton = skeleton(label)
    matchSameSkeleton(label, labelSkeleton, label === registrableLabel, index, offer)
    matchEditDistance(label, labelSkeleton, index, offer)
    matchContainment(label, labelSkeleton, index, offer)
  }

  return [...best.values()]
    .sort((a, b) => {
      if (a.severity !== b.severity)
        return a.severity === 'high' ? -1 : 1
      return b.visits - a.visits
    })
    .slice(0, MAX_MATCHES)
}

/** Unicode rendering of a hostname; returns the input unchanged if it is not IDN. */
function decodeHostname(hostname: string): string {
  try {
    return punycode.toUnicode(hostname)
  }
  catch {
    return hostname
  }
}

/**
 * `paypal.com.evil.net` – a complete familiar domain parked in the subdomain,
 * so the address reads as PayPal up to the point where anyone stops reading.
 */
function matchFamiliarAsSubdomain(
  labels: string[],
  index: FamiliarIndex,
  offer: (match: LookalikeMatch) => void,
) {
  // The final label pair is the address's own domain, not an imitation of one
  for (let start = 0; start < labels.length - 1; start++) {
    for (let end = start + 1; end < labels.length - 1; end++) {
      const entry = index.byDomain.get(labels.slice(start, end + 1).join('.'))
      if (!entry)
        continue

      offer({
        domain: entry.domain,
        visits: entry.visits,
        source: entry.source,
        reason: 'familiar-as-subdomain',
        evidence: entry.domain,
        severity: 'high',
      })
    }
  }
}

/**
 * A label that reads as a familiar name. What that means depends on where it sits
 * and how it is spelled:
 *
 * - `pаypal.com` (Cyrillic а) or `paypa1.com` – a different spelling of the name
 *   in the position of the real one. Deliberate, so it is loud.
 * - `paypal.evil.net` – the exact name, but as a subdomain of something else.
 *   Also deliberate.
 * - `paypal.co` – the exact name under a different domain. Indistinguishable in
 *   structure from a brand's own country site, so it is reported as context and
 *   never allowed to interrupt.
 */
function matchSameSkeleton(
  label: string,
  labelSkeleton: string,
  isRegistrableLabel: boolean,
  index: FamiliarIndex,
  offer: (match: LookalikeMatch) => void,
) {
  for (const entry of index.bySkeleton.get(labelSkeleton) ?? []) {
    const isSameSpelling = entry.label === label

    if (!isRegistrableLabel) {
      offer({
        domain: entry.domain,
        visits: entry.visits,
        source: entry.source,
        reason: 'familiar-as-subdomain',
        evidence: label,
        severity: 'high',
      })
      continue
    }

    offer(isSameSpelling
      ? { domain: entry.domain, visits: entry.visits, reason: 'same-name', evidence: label, severity: 'medium' }
      : { domain: entry.domain, visits: entry.visits, reason: 'confusable', evidence: label, severity: 'high' })
  }
}

/** `payapl`, `gogle`, `paypall` – a typo's distance from a name already known. */
function matchEditDistance(
  label: string,
  labelSkeleton: string,
  index: FamiliarIndex,
  offer: (match: LookalikeMatch) => void,
) {
  // No `return` on a short address: the familiar name it imitates may be long
  // enough even when what is left after the typo is not
  if (labelSkeleton.length + MAX_EDIT_DISTANCE < MIN_EDIT_DISTANCE_LENGTH)
    return

  for (let length = labelSkeleton.length - MAX_EDIT_DISTANCE; length <= labelSkeleton.length + MAX_EDIT_DISTANCE; length++) {
    for (const entry of index.byLength.get(length) ?? []) {
      if (entry.labelSkeleton === labelSkeleton)
        continue // already reported by the confusable matcher

      const distance = boundedEditDistance(labelSkeleton, entry.labelSkeleton, MAX_EDIT_DISTANCE)
      if (distance > MAX_EDIT_DISTANCE)
        continue

      // Once the address itself is short, only the deliberate-looking case
      // counts, or unrelated four-letter words start matching each other
      const addressIsShort = labelSkeleton.length < MIN_EDIT_DISTANCE_LENGTH
      if (addressIsShort && (distance > SHORT_LABEL_MAX_DISTANCE || labelSkeleton[0] !== entry.labelSkeleton[0]))
        continue

      // Neither name has enough substance for a swapped letter to mean anything:
      // `moz` and `mon` differ by one and name two different ministries. Only
      // the shapes a slip of the hand actually takes are taken as one.
      const bothShort = Math.max(labelSkeleton.length, entry.labelSkeleton.length) < MIN_EDIT_DISTANCE_LENGTH
      if (bothShort && !isTypoShape(labelSkeleton, entry.labelSkeleton))
        continue

      // One edit off a name you already use is hard to arrive at by accident.
      // Two edits happen between unrelated words often enough to stay quiet.
      // Between two short names even one edit is only ever worth mentioning.
      offer({
        domain: entry.domain,
        visits: entry.visits,
        source: entry.source,
        reason: 'edit-distance',
        evidence: label,
        severity: distance === 1 && !bothShort ? 'high' : 'medium',
      })
    }
  }
}

/**
 * `googlesupport`, `paypal-secure`, `secure-sberbank` – the familiar name kept
 * intact and padded out. The padding is whatever the attacker likes, so this
 * matches on the structure rather than on any list of words.
 */
/**
 * Is a single edit between these two the shape a typo takes?
 *
 * A change of length is a character inserted or dropped, and a swap of two
 * neighbours is a transposition – both are slips of the hand. A same-length
 * change that is neither means one letter was deliberately put where another
 * was, which between two short names is as easily a different word as a mistake.
 */
function isTypoShape(a: string, b: string): boolean {
  if (a.length !== b.length)
    return true

  const differing: number[] = []
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      differing.push(i)
  }

  return differing.length === 2
    && differing[1] === differing[0] + 1
    && a[differing[0]] === b[differing[1]]
    && a[differing[1]] === b[differing[0]]
}

function matchContainment(
  label: string,
  labelSkeleton: string,
  index: FamiliarIndex,
  offer: (match: LookalikeMatch) => void,
) {
  const tokens = new Set(labelSkeleton.split(/[-_]+/).filter(Boolean))

  // A short familiar name is too small to go hunting for inside a longer word,
  // but standing alone between separators there is nothing accidental about it –
  // which is the only way `moz-login` or `work-login` can be caught at all
  for (const token of tokens) {
    if (token === labelSkeleton || token.length < MIN_TOKEN_LENGTH)
      continue
    for (const entry of index.bySkeleton.get(token) ?? []) {
      offer({
        domain: entry.domain,
        visits: entry.visits,
        source: entry.source,
        reason: 'contains-familiar',
        evidence: label,
        severity: 'high',
      })
    }
  }

  if (labelSkeleton.length < MIN_CONTAINMENT_LENGTH)
    return

  for (let position = 0; position + 3 <= labelSkeleton.length; position++) {
    for (const entry of index.byTrigram.get(labelSkeleton.slice(position, position + 3)) ?? []) {
      if (entry.labelSkeleton === labelSkeleton)
        continue // an exact name, handled by the confusable matcher
      if (!labelSkeleton.startsWith(entry.labelSkeleton, position))
        continue

      // A familiar name standing alone between separators is deliberate,
      // while one buried inside a longer run of characters may be coincidence
      const isWholeToken = tokens.has(entry.labelSkeleton)
      offer({
        domain: entry.domain,
        visits: entry.visits,
        source: entry.source,
        reason: 'contains-familiar',
        evidence: label,
        severity: isWholeToken ? 'high' : 'medium',
      })
    }
  }
}
