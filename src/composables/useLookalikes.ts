import type { ComputedRef } from 'vue'
import type { LookalikeMatch } from '~/logic/domain-similarity'
import { computed, shallowReactive, watch } from 'vue'

/**
 * Does this address resemble one the user already knows?
 *
 * The comparison needs the familiar-domain index, which only the background
 * holds, so this asks rather than computes. Two components under one address
 * want the answer – the lookalike notice draws it, and the structural markers
 * drop the line it already explains – so the answer is kept here, once per
 * address, and both read the same entry. A second component asking while the
 * first question is in flight sends nothing.
 */
export type LookalikeAnswer
  = | { status: 'pending' }
    | { status: 'answered', matches: LookalikeMatch[] }
  /** The background could not be asked, which is not the same as it finding nothing */
    | { status: 'failed' }

type Context = 'email' | undefined

const CACHE_TTL_MS = 5 * 60_000
const CACHE_LIMIT = 200
/**
 * How long the markers wait for an answer before they stop waiting. The embedded
 * ending is held back while the question is open, and a worker that is slow to
 * wake must not hide it for ever. Only the waiting ends: the question stays
 * open, and an answer that arrives later still takes its place.
 */
const PATIENCE_MS = 2000

const entries = shallowReactive(new Map<string, { answer: LookalikeAnswer, at: number }>())
const inFlight = new Set<string>()
// Moved on by a reset, so an answer to a question asked before it lands nowhere
let generation = 0

// Keyed by context too: the same address is compared against a wider set when
// it came out of an email, so one answer must not be served for the other
function cacheKey(hostname: string, context: Context): string {
  return `${context ?? 'page'}:${hostname}`
}

function store(key: string, answer: LookalikeAnswer) {
  // A plain FIFO trim: this only guards against unbounded growth on a page
  // with thousands of distinct links, not against a hot-set eviction problem
  if (!entries.has(key) && entries.size >= CACHE_LIMIT)
    entries.delete(entries.keys().next().value!)
  entries.set(key, { answer, at: Date.now() })
}

async function ask(hostname: string, context: Context): Promise<LookalikeAnswer> {
  try {
    const result = await browser.runtime.sendMessage({ type: 'find-lookalikes', data: { hostname, context } })
    // Anything but a list is a background that was not there to answer – a
    // torn-down worker resolves to undefined rather than throwing
    return Array.isArray(result) ? { status: 'answered', matches: result as LookalikeMatch[] } : { status: 'failed' }
  }
  catch {
    return { status: 'failed' }
  }
}

function request(hostname: string, context: Context) {
  const key = cacheKey(hostname, context)
  const entry = entries.get(key)
  if (inFlight.has(key) || (entry?.answer.status === 'answered' && Date.now() - entry.at < CACHE_TTL_MS))
    return

  // An answer already on screen stays there while it is asked again, stale or
  // failed, so a retry does not blank a line only to draw it back
  if (!entry)
    store(key, { status: 'pending' })

  const asked = generation
  inFlight.add(key)
  const patience = setTimeout(() => {
    if (entries.get(key)?.answer.status === 'pending')
      store(key, { status: 'failed' })
  }, PATIENCE_MS)

  ask(hostname, context).then((answer) => {
    clearTimeout(patience)
    if (asked !== generation)
      return
    inFlight.delete(key)
    store(key, answer)
  })
}

/**
 * The answer for an address, `null` while there is nothing to ask about.
 * `enabled` lets a caller that only sometimes needs the answer skip the question.
 */
export function useLookalikes(
  hostname: () => string,
  context: () => Context,
  enabled: () => boolean = () => true,
): ComputedRef<LookalikeAnswer | null> {
  watch([hostname, context, enabled], ([host, ctx, on]) => {
    if (host && on)
      request(host, ctx)
  }, { immediate: true })

  return computed(() => {
    const host = hostname()
    if (!host || !enabled())
      return null
    // The watch above always leaves an entry, so a missing one was pushed out of
    // the cache while on screen. Nothing is being asked for it any more, and
    // waiting on it would hold the marker back for good.
    return entries.get(cacheKey(host, context()))?.answer ?? { status: 'failed' }
  })
}

/** Forget every answer. For tests, which would otherwise share them. */
export function resetLookalikeCache() {
  generation++
  entries.clear()
  inFlight.clear()
}
