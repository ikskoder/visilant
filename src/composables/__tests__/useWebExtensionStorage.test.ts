import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import browser from 'webextension-polyfill'
import { createWebExtensionStorage } from '../useWebExtensionStorage'

/** Let the pre-flush watcher run and its queued write finish. */
async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

interface Prefs { threshold: number, label?: string }

const defaults: Prefs = { threshold: 10, label: 'default' }

describe('createWebExtensionStorage', () => {
  let store: Record<string, unknown>

  beforeEach(() => {
    store = {}
    vi.mocked(browser.storage.sync.get).mockReset()
    vi.mocked(browser.storage.sync.set).mockReset()
    vi.mocked(browser.storage.sync.get).mockImplementation(async (keys: any) => {
      const wanted = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(wanted.filter((k: string) => k in store).map((k: string) => [k, store[k]]))
    })
    vi.mocked(browser.storage.sync.set).mockImplementation(async (items: any) => {
      Object.assign(store, items)
    })
  })

  it('holds the stored value once ready resolves', async () => {
    store.prefs = JSON.stringify({ threshold: 25 })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready

    expect(handle.data.value.threshold).toBe(25)
  })

  // The whole point of the race: a reader that answers before this resolves is
  // answering with the shipped defaults, and one write later they are the
  // settings. Nothing may read the ref without awaiting it first.
  it('still holds the defaults before ready resolves', () => {
    store.prefs = JSON.stringify({ threshold: 25 })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })

    expect(handle.data.value.threshold).toBe(10)
  })

  it('does not write the merged defaults back on every read', async () => {
    // A profile stored before `label` existed. The merge fills it in for this
    // reader, which is not an edit and used to be saved by every document.
    store.prefs = JSON.stringify({ threshold: 25 })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready
    await settle()

    expect(handle.data.value.label).toBe('default')
    expect(browser.storage.sync.set).not.toHaveBeenCalled()
    expect(store.prefs).toBe(JSON.stringify({ threshold: 25 }))
  })

  it('saves an edit made after hydration', async () => {
    store.prefs = JSON.stringify({ threshold: 25 })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready
    handle.data.value = { ...handle.data.value, threshold: 30 }
    await settle()

    expect(JSON.parse(store.prefs as string).threshold).toBe(30)
  })

  it('never writes from a read-only context', async () => {
    store.prefs = JSON.stringify({ threshold: 25 })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    handle.setWritable(false)
    await handle.ready

    handle.data.value = { ...handle.data.value, threshold: 1 }
    await settle()

    expect(browser.storage.sync.set).not.toHaveBeenCalled()
    expect(JSON.parse(store.prefs as string).threshold).toBe(25)
  })

  // What a content script does with the answer to `get-settings`
  it('takes an external snapshot without saving it back', async () => {
    store.prefs = JSON.stringify({ threshold: 25 })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready
    handle.applyExternal({ threshold: 40, label: 'from background' })
    await settle()

    expect(handle.data.value.threshold).toBe(40)
    expect(browser.storage.sync.set).not.toHaveBeenCalled()
  })

  it('writes one edit at a time, in order', async () => {
    store.prefs = JSON.stringify({ threshold: 1 })
    let inFlight = 0
    let overlapped = false
    vi.mocked(browser.storage.sync.set).mockImplementation(async (items: any) => {
      overlapped ||= inFlight > 0
      inFlight++
      await new Promise(resolve => setTimeout(resolve, 1))
      Object.assign(store, items)
      inFlight--
    })

    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready

    handle.data.value = { ...handle.data.value, threshold: 2 }
    await nextTick()
    handle.data.value = { ...handle.data.value, threshold: 3 }
    await nextTick()
    handle.data.value = { ...handle.data.value, threshold: 4 }
    await settle()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(overlapped).toBe(false)
    expect(JSON.parse(store.prefs as string).threshold).toBe(4)
  })

  it('reports a failed save instead of only logging it', async () => {
    store.prefs = JSON.stringify({ threshold: 1 })
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, {
      mergeDefaults: true,
      onError: () => {},
    })
    await handle.ready

    vi.mocked(browser.storage.sync.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))
    handle.data.value = { ...handle.data.value, threshold: 2 }
    await settle()

    expect(handle.writeError.value).toBeInstanceOf(Error)
  })

  // A failed write leaves storage holding something unknown, so the retry must
  // not be skipped as "nothing changed" on the strength of the write that failed
  it('retries the same value after a failed save', async () => {
    store.prefs = JSON.stringify({ threshold: 1 })
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, {
      mergeDefaults: true,
      onError: () => {},
    })
    await handle.ready

    vi.mocked(browser.storage.sync.set).mockRejectedValueOnce(new Error('transient'))
    handle.data.value = { ...handle.data.value, threshold: 2 }
    await settle()
    expect(JSON.parse(store.prefs as string).threshold).toBe(1)

    handle.data.value = { ...handle.data.value, label: 'again' }
    await settle()
    expect(JSON.parse(store.prefs as string).threshold).toBe(2)
    expect(handle.writeError.value).toBeNull()
  })
})

describe('the defaults object', () => {
  // The ref is reactive and everything bound to it writes through, so handing it
  // the caller's own defaults means a nested edit edits the shipped defaults -
  // and every "is this at its defaults" comparison then answers yes to whatever
  // the user just typed.
  it('is never the object the ref holds, before hydration', () => {
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })

    expect(handle.data.value).not.toBe(defaults)
    handle.data.value.threshold = 99
    expect(defaults.threshold).toBe(10)
  })

  it('is never the object the ref holds, on a profile with nothing stored', async () => {
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready

    handle.data.value.threshold = 77
    expect(defaults.threshold).toBe(10)
  })

  it('is not shared through the merge either', async () => {
    vi.mocked(browser.storage.sync.get).mockResolvedValueOnce({ prefs: JSON.stringify({ threshold: 25 }) })
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready

    handle.data.value.label = 'edited'
    expect(defaults.label).toBe('default')
  })
})

describe('saving through somebody else', () => {
  let store: Record<string, unknown>

  beforeEach(() => {
    store = {}
    vi.mocked(browser.storage.sync.get).mockReset()
    vi.mocked(browser.storage.sync.set).mockReset()
    vi.mocked(browser.storage.sync.get).mockImplementation(async (keys: any) => {
      const wanted = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(wanted.filter((k: string) => k in store).map((k: string) => [k, store[k]]))
    })
    vi.mocked(browser.storage.sync.set).mockImplementation(async (items: any) => {
      Object.assign(store, items)
    })
  })

  it('hands the edit to the installed writer and stores nothing itself', async () => {
    store.prefs = JSON.stringify({ threshold: 25, label: 'stored' })
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready
    vi.mocked(browser.storage.sync.set).mockClear()

    const seen: { next: Prefs, stored: Prefs | null }[] = []
    handle.setCommit(async (next, stored) => {
      seen.push({ next, stored })
    })

    handle.data.value.threshold = 40
    await settle()

    expect(seen).toHaveLength(1)
    expect(seen[0].next.threshold).toBe(40)
    // The value as storage had it, so the writer can see which keys changed
    expect(seen[0].stored?.threshold).toBe(25)
    expect(browser.storage.sync.set).not.toHaveBeenCalled()
  })

  // The value comes back through the change event, and until it does nothing may
  // be recorded as stored - the writer elsewhere decides what it becomes
  it('sends the next edit even when the first has not come back yet', async () => {
    store.prefs = JSON.stringify({ threshold: 25 })
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    await handle.ready

    const sent: Prefs[] = []
    handle.setCommit(async (next) => {
      sent.push({ ...next })
    })

    handle.data.value.threshold = 40
    await settle()
    handle.data.value.threshold = 41
    await settle()

    expect(sent.map(value => value.threshold)).toEqual([40, 41])
  })

  it('does not seed the defaults on a profile where nothing is stored', async () => {
    const handle = createWebExtensionStorage<Prefs>('prefs', defaults, { mergeDefaults: true })
    handle.setCommit(async () => {})
    await handle.ready
    await settle()

    expect(browser.storage.sync.set).not.toHaveBeenCalled()
  })
})
