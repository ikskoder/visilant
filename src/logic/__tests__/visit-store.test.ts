import type { SiteVisitData } from '../storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser from 'webextension-polyfill'
import { removeVisitRecords, updateVisitRecord, updateVisitRecords, visitGeneration, visitWritesSettled } from '../visit-store'

/**
 * A store that takes its time.
 *
 * The bug these tests are about only exists because a read and a write are two
 * separate awaits: a delay between them is exactly what lets a second writer in.
 */
function fakeStorage(delayMs = 0) {
  const data: Record<string, unknown> = {}

  vi.mocked(browser.storage.local.get).mockImplementation(async (keys: any) => {
    if (delayMs)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    if (keys === null || keys === undefined)
      return { ...data }
    const wanted = typeof keys === 'string' ? [keys] : keys
    return Object.fromEntries(wanted.filter((k: string) => k in data).map((k: string) => [k, data[k]]))
  })
  vi.mocked(browser.storage.local.set).mockImplementation(async (items: any) => {
    if (delayMs)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    Object.assign(data, items)
  })
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys: any) => {
    const list = typeof keys === 'string' ? [keys] : keys
    for (const key of list)
      delete data[key]
  })

  return data
}

function record(over: Partial<SiteVisitData> = {}): SiteVisitData {
  return { count: 1, lastSeen: 1, ignored: false, ...over }
}

describe('updateVisitRecord', () => {
  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockReset()
    vi.mocked(browser.storage.local.set).mockReset()
    vi.mocked(browser.storage.local.remove).mockReset()
  })

  it('sees the record as it stands, not as it stood when it was asked for', async () => {
    const data = fakeStorage(5)
    data['example.com'] = record({ count: 3 })

    // Two writers touching different fields of the same record at the same time.
    // Read separately, the second one's read would predate the first one's write
    // and put `count` back to 3.
    await Promise.all([
      updateVisitRecord('example.com', existing => ({ ...record(), ...existing, count: (existing?.count ?? 0) + 1 })),
      updateVisitRecord('example.com', existing => ({ ...record(), ...existing, ignored: true })),
    ])

    expect(data['example.com']).toMatchObject({ count: 4, ignored: true })
  })

  it('keeps an ignore that a navigation would otherwise have undone', async () => {
    const data = fakeStorage(5)
    data['example.com'] = record({ count: 3 })

    const ignoring = updateVisitRecord('example.com', existing => ({ ...record(), ...existing, ignored: true }))
    const visiting = updateVisitRecord('example.com', existing => ({ ...record(), ...existing, count: (existing?.count ?? 0) + 1, lastSeen: 99 }))
    await Promise.all([ignoring, visiting])

    expect((data['example.com'] as SiteVisitData).ignored).toBe(true)
    expect((data['example.com'] as SiteVisitData).count).toBe(4)
  })

  it('creates a record where there was none', async () => {
    const data = fakeStorage()

    await updateVisitRecord('new.example', () => record({ count: 1 }))

    expect(data['new.example']).toMatchObject({ count: 1 })
  })

  it('writes nothing when the updater has nothing to say', async () => {
    fakeStorage()

    await updateVisitRecord('example.com', () => undefined)

    expect(browser.storage.local.set).not.toHaveBeenCalled()
  })
})

describe('generations', () => {
  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockReset()
    vi.mocked(browser.storage.local.set).mockReset()
    vi.mocked(browser.storage.local.remove).mockReset()
  })

  // The one that mattered: an import batch decided on before the user wiped
  // their visits used to land afterwards and put thousands of records back
  it('drops a write that was decided before the records were wiped', async () => {
    const data = fakeStorage(5)
    data['example.com'] = record({ count: 3 })
    const before = visitGeneration()

    const queued = updateVisitRecords(
      ['example.com', 'other.example'],
      (_hostname, existing) => ({ ...record(), ...existing, count: 500 }),
      { generation: before },
    )
    const wiping = removeVisitRecords(records => Object.keys(records))

    await Promise.all([queued, wiping])
    await visitWritesSettled()

    expect(data['example.com']).toBeUndefined()
    expect(data['other.example']).toBeUndefined()
  })

  it('lets a write decided after the wipe through', async () => {
    const data = fakeStorage()
    data['example.com'] = record({ count: 3 })

    await removeVisitRecords(records => Object.keys(records))
    await updateVisitRecord('example.com', () => record({ count: 1 }))

    expect(data['example.com']).toMatchObject({ count: 1 })
  })

  it('moves the generation on when records are wiped', async () => {
    fakeStorage()
    const before = visitGeneration()

    await removeVisitRecords(records => Object.keys(records))

    expect(visitGeneration()).not.toBe(before)
  })
})
