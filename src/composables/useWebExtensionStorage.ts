import type {
  StorageLikeAsync,
  UseStorageAsyncOptions,
} from '@vueuse/core'
import type { MaybeRefOrGetter, RemovableRef } from '@vueuse/shared'
import type { Ref } from 'vue-demi'
import type { Storage } from 'webextension-polyfill'

import { StorageSerializers } from '@vueuse/core'
import { tryOnScopeDispose, watchWithFilter } from '@vueuse/shared'
import { toValue } from 'vue'
import { ref, shallowRef } from 'vue-demi'
import { storage } from 'webextension-polyfill'

export type WebExtensionStorageOptions<T> = UseStorageAsyncOptions<T>

// https://github.com/vueuse/vueuse/blob/658444bf9f8b96118dbd06eba411bb6639e24e88/packages/core/useStorage/guess.ts
export function guessSerializerType(rawInit: unknown) {
  return rawInit == null
    ? 'any'
    : rawInit instanceof Set
      ? 'set'
      : rawInit instanceof Map
        ? 'map'
        : rawInit instanceof Date
          ? 'date'
          : typeof rawInit === 'boolean'
            ? 'boolean'
            : typeof rawInit === 'string'
              ? 'string'
              : typeof rawInit === 'object'
                ? 'object'
                : Number.isNaN(rawInit)
                  ? 'any'
                  : 'number'
}

const storageInterface: StorageLikeAsync = {
  removeItem(key: string) {
    return storage.sync.remove(key)
  },

  setItem(key: string, value: string) {
    return storage.sync.set({ [key]: value })
  },

  async getItem(key: string) {
    const storedData = await storage.sync.get(key)

    return storedData[key] as string
  },
}

/**
 * Everything a context needs to hold a stored value without fighting over it.
 *
 * The ref alone is not enough. A stored blob is read asynchronously, so there is
 * a window where the ref still holds the shipped defaults, and anything that
 * answers a question or writes during that window is answering with, or saving,
 * values the user never chose. `ready` closes that window, and the rest decides
 * who is allowed to write at all.
 */
export interface WebExtensionStorageHandle<T> {
  /** The value, reactive, same as the ref this used to return. */
  data: RemovableRef<T>
  /** Resolves once the stored value has actually been read into the ref. */
  ready: Promise<void>
  /** Read storage again, without the watcher writing the result back. */
  hydrate: () => Promise<void>
  /** Put a value into the ref as if it came from storage – no write follows. */
  applyExternal: (value: T) => void
  /**
   * Whether this context may write at all.
   *
   * A content script is a consumer: it is handed the settings and shows what
   * they say. Letting one write means every open document is a writer of the
   * same blob, and one of them holding a stale copy is enough to undo an edit.
   */
  setWritable: (writable: boolean) => void
  /**
   * Save through something other than storage.
   *
   * Storage has no compare-and-set: a read, an edit and a write from two
   * documents at once end with whichever wrote last holding the whole value,
   * and the other document's unrelated change gone. A context that hands its
   * saving to a single writer elsewhere installs it here - the value still
   * comes back the ordinary way, through the change event.
   */
  setCommit: (commit: ((next: T, stored: T | null) => Promise<void>) | null) => void
  /** The last write that failed, so a page can say the save did not happen. */
  writeError: Ref<unknown>
}

/**
 * https://github.com/vueuse/vueuse/blob/658444bf9f8b96118dbd06eba411bb6639e24e88/packages/core/useStorageAsync/index.ts
 *
 * @param key
 * @param initialValue
 * @param options
 */
export function createWebExtensionStorage<T>(
  key: string,
  initialValue: MaybeRefOrGetter<T>,
  options: WebExtensionStorageOptions<T> = {},
): WebExtensionStorageHandle<T> {
  const {
    flush = 'pre',
    deep = true,
    listenToStorageChanges = true,
    writeDefaults = true,
    mergeDefaults = false,
    shallow,
    eventFilter,
    onError = (e) => {
      console.error(e)
    },
  } = options

  const rawInit: T = toValue(initialValue)
  const type = guessSerializerType(rawInit)

  const data = (shallow ? shallowRef : ref)(
    typeof rawInit === 'object' && rawInit !== null ? structuredClone(rawInit) : initialValue,
  ) as Ref<T>
  const serializer = options.serializer ?? StorageSerializers[type]
  const writeError = ref<unknown>(null)

  /**
   * The value as storage last agreed it to be.
   *
   * This, rather than a paused watcher, is what stops a read from echoing
   * straight back as a write. `flush: 'pre'` means the watcher runs a tick after
   * the assignment, by which time any pause put around that assignment has long
   * been lifted – so the guard has to be about the value, not about timing.
   */
  let settled: string | null = null
  let writable = true
  /** Set when saving belongs to somebody else – see `setCommit`. */
  let commitVia: ((next: T, stored: T | null) => Promise<void>) | null = null

  /**
   * A copy of the defaults, never the defaults themselves.
   *
   * The ref is reactive and everything bound to it writes through. Handing it
   * the caller's own object means a nested `v-model` edits the shipped defaults,
   * and every "is this at its defaults" comparison then answers yes to whatever
   * the user just typed.
   */
  function cloneInit(): T {
    return typeof rawInit === 'object' && rawInit !== null ? structuredClone(rawInit) : rawInit
  }

  /**
   * The keys this context has sent through `commitVia` and not yet seen come
   * back, each with the value sent. `resolved` once the writer has answered,
   * which means it has stored the value, so any change event read after that
   * already reflects it.
   */
  const sent = new Map<string, { value: string, resolved: boolean }>()

  /**
   * A stored value that arrived while this context had edits not yet saved,
   * with those edits laid back over it.
   *
   * A save is a round trip, and the change event of one save can arrive before
   * the next has left, carrying the value as it was when the first one did. Put
   * in the ref whole, it took back every edit made meanwhile, and since the ref
   * then matched storage the queued save found nothing to do: a setting typed
   * in while the one next to it was saving was gone from the page and from
   * storage. Kept per top-level key of an object, so a change another context
   * made to a different key still comes through. A key is this context's own
   * while it differs from the value last agreed with storage, or while a value
   * sent for it is still on its way, which also covers an edit put back to
   * what storage held before.
   */
  async function keepUnsaved(incoming: T): Promise<T> {
    const local = data.value
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
    if (!isRecord(incoming) || !isRecord(local)) {
      sent.clear()
      if (settled === null || await serializer.write(local) === settled)
        return incoming
      return local
    }

    const own = new Set<string>()
    for (const [name, entry] of sent) {
      // Edited again since it was sent, which no stored value can answer for
      if (JSON.stringify(local[name]) !== entry.value)
        own.add(name)
      if (entry.resolved || JSON.stringify(incoming[name]) === entry.value)
        sent.delete(name)
      else own.add(name)
    }
    if (settled !== null) {
      const base = await serializer.read(settled) as unknown
      if (isRecord(base)) {
        for (const name of Object.keys(local)) {
          if (JSON.stringify(local[name]) !== JSON.stringify(base[name]))
            own.add(name)
        }
      }
    }
    if (!own.size)
      return incoming
    const merged: Record<string, unknown> = { ...incoming }
    for (const name of own)
      merged[name] = local[name]
    return merged as T
  }

  async function read(event?: { key: string, newValue: string | null }) {
    if (event && event.key !== key)
      return

    try {
      const rawValue = event ? event.newValue : await storageInterface.getItem(key)
      if (rawValue == null) {
        // Cloned, never the object itself. `rawInit` is the caller's defaults
        // object, and putting it straight in the ref makes every later edit an
        // edit of the shipped defaults - which is what "is this at its
        // defaults" and "put it back to its defaults" are both measured against.
        data.value = cloneInit()
        settled = null
        // Only a context that owns the value seeds it. Nothing is lost if none
        // does: every reader merges the defaults in memory anyway.
        // Not where the saving belongs to somebody else: seeding the defaults
        // is a write like any other, and this context does not do those.
        if (writeDefaults && writable && !commitVia && rawInit !== null) {
          const serialized = await serializer.write(rawInit)
          await storageInterface.setItem(key, serialized)
          // Recorded only once it is actually stored: claiming it beforehand
          // meant a failed write left the next identical commit skipped as a
          // no-op, and nothing was ever saved
          settled = serialized
        }
      }
      else if (mergeDefaults) {
        const value = await serializer.read(rawValue) as T
        let incoming: T
        if (typeof mergeDefaults === 'function')
          incoming = mergeDefaults(value, rawInit)
        else if (type === 'object' && !Array.isArray(value))
          incoming = { ...(cloneInit() as Record<keyof unknown, unknown>), ...(value as Record<keyof unknown, unknown>) } as T
        else incoming = value
        // The merged object, not the raw string: a merge that only filled in
        // keys the profile never stored is not an edit, and used to be written
        // back by every document that opened.
        const incomingText = await serializer.write(incoming)
        data.value = event ? await keepUnsaved(incoming) : incoming
        settled = incomingText
      }
      else {
        const incoming = await serializer.read(rawValue) as T
        data.value = event ? await keepUnsaved(incoming) : incoming
        settled = rawValue
      }
    }
    catch (error) {
      onError(error)
    }
  }

  /**
   * Writes, one at a time and in order.
   *
   * Two overlapping read-modify-writes of one blob is how an edit disappears:
   * both serialize their own copy, and whichever lands second is the whole
   * value, not the newer half of it.
   */
  let writeChain: Promise<void> = Promise.resolve()

  // The read that fills the ref. It is async, so its assignment lands well after
  // the watcher below is armed – what stops it coming back round as a write is
  // `settled`, not the order of these two lines.
  const ready = read()

  async function commit() {
    try {
      if (data.value == null) {
        settled = null
        await storageInterface.removeItem(key)
        writeError.value = null
        return
      }

      const serialized = await serializer.write(data.value)
      // Nothing changed – most often this is a hydration coming back round
      if (serialized === settled && !sent.size)
        return

      if (commitVia) {
        // The writer elsewhere decides what the stored value becomes, so
        // nothing is recorded as settled here: the change event brings back
        // what was actually stored, this context's edit merged into it.
        // Compared with what was last sent rather than what was last stored,
        // so a key put back while its first save is on its way is sent again.
        let stored = settled === null ? null : await serializer.read(settled) as T
        if (stored !== null && typeof stored === 'object' && sent.size) {
          stored = { ...stored }
          for (const [name, entry] of sent)
            (stored as Record<string, unknown>)[name] = JSON.parse(entry.value)
        }
        const next = data.value
        const entries: { value: string, resolved: boolean }[] = []
        if (next !== null && typeof next === 'object' && !Array.isArray(next)) {
          for (const [name, value] of Object.entries(next)) {
            const text = JSON.stringify(value)
            if (stored === null || text !== JSON.stringify((stored as Record<string, unknown>)[name])) {
              const entry = { value: text, resolved: false }
              sent.set(name, entry)
              entries.push(entry)
            }
          }
        }
        try {
          await commitVia(next, stored)
        }
        catch (error) {
          // Nothing of it was stored, so nothing of it is on its way. And
          // `settled` stays: storage is as it was, and forgetting it made the
          // next save send every key, putting this page's stale copy of a
          // setting another page had just changed over that change.
          for (const [name, entry] of sent) {
            if (entries.includes(entry))
              sent.delete(name)
          }
          writeError.value = error
          onError(error)
          return
        }
        for (const entry of entries)
          entry.resolved = true
        writeError.value = null
        return
      }

      settled = serialized
      await storageInterface.setItem(key, serialized)
      writeError.value = null
    }
    catch (error) {
      // The value in storage is now unknown, so the next write must not be
      // skipped as a no-op on the strength of what this one meant to store
      settled = null
      writeError.value = error
      onError(error)
    }
  }

  /** Whether a commit is already queued and has not yet looked at the value. */
  let queued = false

  function write() {
    if (!writable)
      return writeChain
    // One queued commit is enough: it reads the ref when its turn comes, so it
    // saves whatever the value is by then. Several edits in the same tick – and
    // the hydration that starts them all – become one write, not four.
    if (queued)
      return writeChain
    queued = true

    const run = () => {
      queued = false
      return commit()
    }

    // Queued behind the first read rather than dropped: an edit made while the
    // stored value was still on its way is rare, but losing it silently is not
    // an improvement on writing it too early
    writeChain = writeChain.then(() => ready).then(run, run)
    return writeChain
  }

  watchWithFilter(data, write, { flush, deep, eventFilter })

  async function hydrate() {
    await read()
  }

  function applyExternal(value: T) {
    // Recorded as settled before the assignment, so the watcher this triggers
    // finds nothing to save. A value that came from storage is not an edit.
    const serialized = serializer.write(value)
    if (typeof serialized === 'string') {
      settled = serialized
    }
    else {
      void Promise.resolve(serialized).then((text) => {
        settled = text
      })
    }
    data.value = value
  }

  if (listenToStorageChanges) {
    const listener = async (changes: Record<string, Storage.StorageChange>) => {
      for (const [changedKey, change] of Object.entries(changes)) {
        await read({
          key: changedKey,
          newValue: change.newValue as string | null,
        })
      }
    }

    storage.onChanged.addListener(listener)

    tryOnScopeDispose(() => {
      storage.onChanged.removeListener(listener)
    })
  }

  return {
    data: data as RemovableRef<T>,
    ready,
    hydrate,
    applyExternal,
    setWritable: (next: boolean) => {
      writable = next
    },
    setCommit: (commit) => {
      commitVia = commit
    },
    writeError,
  }
}

/** The bare ref, for a caller that has no stake in when it filled up. */
export function useWebExtensionStorage<T>(
  key: string,
  initialValue: MaybeRefOrGetter<T>,
  options: WebExtensionStorageOptions<T> = {},
): RemovableRef<T> {
  return createWebExtensionStorage(key, initialValue, options).data
}
