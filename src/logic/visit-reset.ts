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
function isPossibleHostKey(key: string): boolean {
  return !key.startsWith('__') && /^[\w.:\-[\]]+$/.test(key)
}

function isVisitRecord(value: unknown): value is SiteVisitData {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const record = value as Partial<SiteVisitData>
  return typeof record.count === 'number' && typeof record.lastSeen === 'number'
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
