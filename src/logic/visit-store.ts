import type { SiteVisitData } from './storage'

/**
 * The one writer of the visit records.
 *
 * Four different pieces of code used to read a hostname's record, change one
 * field and write the whole object back: the visit counter on every navigation,
 * the ignore command, the history import in batches, and the reset. None of them
 * knew about the others, so two of them overlapping meant the second write put
 * the first one's field back to what it had been. An ignore could be undone by a
 * navigation that had read the record a moment earlier, and a record deleted by
 * a reset could be written back by an import that was still in flight.
 *
 * So every write goes through here and they happen one at a time. It costs
 * nothing worth measuring – a navigation writes one key – and it means the
 * read and the write of a read-modify-write cannot be separated by anybody else's.
 */

/**
 * Bumped whenever the records are thrown away wholesale.
 *
 * A write that was decided on before a reset must not land after it. Ordering
 * alone cannot say that: the reset and the write are both queued, and a write
 * queued first can still be about a record the user has just asked to be gone.
 * Every write carries the generation it was decided under and is dropped if that
 * has moved on.
 */
let generation = 0

/** The generation a caller should quote when it comes back to write. */
export function visitGeneration(): number {
  return generation
}

/** Say that everything decided before now is about records that no longer exist. */
export function bumpVisitGeneration(): number {
  generation += 1
  return generation
}

/**
 * Writes, in order, one at a time.
 *
 * A single chain rather than one per hostname: the batches an import writes
 * cover hundreds of hostnames at once, so per-host chains would have to be
 * joined for every batch anyway, and a chain of one is easier to reason about
 * than a graph of many.
 */
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work)
  // The chain itself must never reject, or every write behind a failed one is
  // cancelled with it
  chain = next.then(() => undefined, () => undefined)
  return next
}

/** What an updater may say about a record. `undefined` leaves it alone. */
export type VisitUpdate = (existing: SiteVisitData | undefined) => SiteVisitData | undefined

/**
 * Change one hostname's record.
 *
 * The updater is called with the record as it stands at the moment of the write,
 * not as it stood when the caller decided to write – which is the whole point.
 */
export async function updateVisitRecord(
  hostname: string,
  update: VisitUpdate,
  options: { generation?: number } = {},
): Promise<SiteVisitData | undefined> {
  const decidedAt = options.generation ?? generation

  return enqueue(async () => {
    if (decidedAt !== generation)
      return undefined

    const stored = await browser.storage.local.get(hostname)
    const existing = stored[hostname] as SiteVisitData | undefined
    const next = update(existing)
    if (!next)
      return existing

    await browser.storage.local.set({ [hostname]: next })
    return next
  })
}

/**
 * Change a batch of records, reading and writing them as one step.
 *
 * Used by the history import, which has thousands of hostnames to fold in and
 * would spend the whole import waiting if each one were its own storage round
 * trip. Still one step as far as everybody else is concerned.
 */
export async function updateVisitRecords(
  hostnames: string[],
  update: (hostname: string, existing: SiteVisitData | undefined) => SiteVisitData | undefined,
  options: { generation?: number } = {},
): Promise<number> {
  const decidedAt = options.generation ?? generation
  if (!hostnames.length)
    return 0

  return enqueue(async () => {
    if (decidedAt !== generation)
      return 0

    const stored = await browser.storage.local.get(hostnames)
    const payload: Record<string, SiteVisitData> = {}
    for (const hostname of hostnames) {
      const next = update(hostname, stored[hostname] as SiteVisitData | undefined)
      if (next)
        payload[hostname] = next
    }

    const keys = Object.keys(payload)
    if (keys.length)
      await browser.storage.local.set(payload)
    return keys.length
  })
}

/**
 * Delete records, and declare everything decided before now void.
 *
 * Which keys go is decided here, inside the queued step, rather than by the
 * caller beforehand: a batch of import writes still in the queue lands between a
 * caller's scan and its delete, and every record it wrote would have survived a
 * wipe that had already decided what to remove.
 *
 * The generation moves in the same step, so anything still waiting behind this
 * finds a generation it does not recognise and drops itself.
 */
export async function removeVisitRecords(
  selectKeys: (records: Record<string, unknown>) => string[],
): Promise<number> {
  return enqueue(async () => {
    bumpVisitGeneration()

    const records = await browser.storage.local.get(null)
    const keys = selectKeys(records)
    if (keys.length)
      await browser.storage.local.remove(keys)
    return keys.length
  })
}

/** Wait for every write decided so far to have landed. */
export async function visitWritesSettled(): Promise<void> {
  await enqueue(async () => undefined)
}
