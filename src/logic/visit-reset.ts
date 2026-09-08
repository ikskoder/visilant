import type { SiteVisitData } from './storage'
import { FAMILIAR_INDEX_KEY } from './familiar-index'
import { HISTORY_IMPORT_STATE_KEY } from './history-import'

/**
 * Which of the `storage.local` keys "delete my visits" is allowed to touch.
 *
 * `storage.local` is not the visit table with a few extras in it – it also holds
 * every list the user typed by hand, every list fetched from a source they
 * chose, and the flags that say a one-off migration has already run. Wiping the
 * lot was the old behaviour and it took all of that with it, under a checkbox
 * that names visit information and nothing else.
 *
 * So the choice is made by shape rather than by exclusion: a visit record is an
 * object with a numeric `count` and `lastSeen`, stored under a hostname. A list
 * is an array, a remote cache is an object with `domains`, a seed flag is a
 * boolean, and none of them are under a key with a dot in it. Anything new that
 * gets stored later is kept for the same reason, without having to be named here.
 */

/** Caches derived from the visit records, and meaningless once those are gone. */
const VISIT_DERIVED_KEYS: readonly string[] = [
  FAMILIAR_INDEX_KEY,
  HISTORY_IMPORT_STATE_KEY,
]

/**
 * Could this key be a hostname at all?
 *
 * Deliberately not `isTrackableHostname`: that is a policy about what is worth
 * counting from now on, and it moves. A record written under a rule that has
 * since changed is still the user's visit data, and a wipe that quietly left it
 * behind would be the worst kind of bug in a button that promises to remove it.
 */
export function isPossibleHostKey(key: string): boolean {
  return !key.startsWith('__') && /^[\w.:\-[\]]+$/.test(key)
}

function isVisitRecord(value: unknown): value is SiteVisitData {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const record = value as Partial<SiteVisitData>
  return typeof record.count === 'number' && typeof record.lastSeen === 'number'
}

/**
 * Every visit record in a `storage.local` snapshot, by hostname.
 *
 * Exported because the wipe is not the only thing that has to pick the records
 * out of everything else in the area, and the shape question above is the one
 * answer worth having. Anything that reads the table gets the same reading.
 */
export function visitRecordEntries(records: Record<string, unknown>): [string, SiteVisitData][] {
  return Object.entries(records)
    .filter(([key, value]) => isPossibleHostKey(key) && isVisitRecord(value))
    .map(([key, value]) => [key, value as SiteVisitData])
}

/**
 * The hosts whose warnings the user has turned off.
 *
 * Sorted, because this is read as a list to check rather than as data: a name
 * that moves about between openings is one nobody can scan.
 */
export function silencedHosts(records: Record<string, unknown>): string[] {
  return visitRecordEntries(records)
    .filter(([, record]) => record.ignored === true)
    .map(([key]) => key)
    .sort()
}

/** What editing the silenced list as text comes to, once it is worked out. */
export interface SilenceChanges {
  /** Hosts to silence, lowercased, in the order they were typed. */
  silence: string[]
  /** Hosts to stop silencing, named as they are stored. */
  unsilence: string[]
  /** Lines that are not hostnames, kept verbatim so they can be shown back. */
  rejected: string[]
}

/**
 * What to change, given what is silenced now and what the box says.
 *
 * Every line is matched case-insensitively against the keys as they are stored,
 * rather than against a lowercased copy of the table. A record written under a
 * name carrying a capital would otherwise be missed here and silenced a second
 * time under a key of its own, leaving the site listed twice and only one of
 * them liftable.
 *
 * A line that could never be a storage key is rejected rather than written.
 * Writing it would put a record where nothing can read it back – `silencedHosts`
 * asks the same question – so the site would look silenced for as long as the
 * box was open and be neither silenced nor listed afterwards.
 */
export function planSilenceChanges(current: readonly string[], text: string): SilenceChanges {
  const typed = text.split(/\n/).map(line => line.trim()).filter(Boolean)
  const rejected = typed.filter(line => !isPossibleHostKey(line))

  const have = new Map(current.map(host => [host.toLowerCase(), host]))
  const want = new Map(
    typed.filter(isPossibleHostKey).map(line => [line.toLowerCase(), line.toLowerCase()]),
  )

  return {
    silence: [...want].filter(([lower]) => !have.has(lower)).map(([, host]) => host),
    unsilence: [...have].filter(([lower]) => !want.has(lower)).map(([, host]) => host),
    rejected,
  }
}

/**
 * The keys to remove for a visit wipe, given everything `storage.local` holds.
 *
 * The auto-import flag is deliberately not among them: wiping the visits is a
 * deliberate choice, and without the flag the next extension update would see an
 * empty profile and quietly import the history back.
 */
export function visitKeysToRemove(records: Record<string, unknown>): string[] {
  return Object.keys(records).filter(key =>
    VISIT_DERIVED_KEYS.includes(key)
    || (isPossibleHostKey(key) && isVisitRecord(records[key])),
  )
}
