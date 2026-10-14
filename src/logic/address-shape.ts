import type { InjectionKey, Ref } from 'vue'
import type { AddressShape } from './domain-boundary'
import { shallowReactive } from 'vue'

/**
 * Where the address painter gets the shape of a hostname from.
 *
 * The shape needs the public suffix list. The extension's own pages load it
 * anyway and provide `addressShape` under this key, so their answer is there
 * on the first frame. The content script must not load it, it would put the
 * whole list into every page, so there the painter falls back to asking the
 * background, a batch of hosts at a time, and draws thin frames until the
 * answer is in. No answer is not the same as "no owner": nothing is said about
 * an address while its shape is still being asked for.
 */
export type { AddressShape }
export type ShapeLookup = (hostname: string) => AddressShape | undefined

export const ADDRESS_SHAPE_KEY: InjectionKey<ShapeLookup> = Symbol('address-shape')

/**
 * A view that lets the reader switch frames for itself alone, the in-page check
 * panel, provides its choice here. Every address drawn inside it follows, the
 * ones in its notices too, and the setting elsewhere stays as it was.
 */
export const ADDRESS_FRAMES_KEY: InjectionKey<Ref<boolean>> = Symbol('address-frames')

const CACHE_LIMIT = 500
/** The background answers at most this many per question, see `addressShapesLogic`. */
const BATCH_LIMIT = 200
const shapes = shallowReactive(new Map<string, AddressShape>())
const queued = new Set<string>()
const asked = new Set<string>()
let flushing = false

async function flush() {
  flushing = false
  const all = [...queued]
  queued.clear()
  for (let start = 0; start < all.length; start += BATCH_LIMIT)
    await ask(all.slice(start, start + BATCH_LIMIT))
}

async function ask(hosts: string[]) {
  try {
    const answer = await browser.runtime.sendMessage({ type: 'address-shapes', data: { hosts } }) as Record<string, AddressShape> | undefined
    if (!answer || typeof answer !== 'object')
      return
    for (const host of hosts) {
      const shape = answer[host]
      if (shape && Number.isInteger(shape.ownerLabels) && Number.isInteger(shape.suffixLabels)) {
        if (shapes.size >= CACHE_LIMIT) {
          // Forgotten both ways, so the next draw of it asks again rather than
          // being left with thin frames for good
          const oldest = shapes.keys().next().value!
          shapes.delete(oldest)
          asked.delete(oldest)
        }
        shapes.set(host, shape)
      }
    }
  }
  catch {
    // A background that is not there leaves the frames thin, which is the
    // drawing for "nothing known about the owner", not a wrong owner
  }
  finally {
    // Asked again on the next draw rather than never: a worker waking up late
    // is the usual reason for no answer
    for (const host of hosts) {
      if (!shapes.has(host))
        asked.delete(host)
    }
  }
}

export function askBackgroundShape(hostname: string): AddressShape | undefined {
  const host = hostname.toLowerCase()
  const known = shapes.get(host)
  if (known || asked.has(host))
    return known
  asked.add(host)
  queued.add(host)
  if (!flushing) {
    flushing = true
    queueMicrotask(flush)
  }
  return undefined
}
