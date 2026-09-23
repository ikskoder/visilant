import type { SiteVisitData } from '../storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser from 'webextension-polyfill'
import { HISTORY_IMPORT_STATE_KEY } from '../history-import'
import { updateVisitRecord } from '../visit-store'
import { foldWwwRecords, mergeVisitRecords, planWwwFold, WWW_FOLD_KEY } from '../www-fold'

function fakeStorage() {
  const data: Record<string, unknown> = {}
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys: any) => {
    if (keys === null || keys === undefined)
      return { ...data }
    const wanted = typeof keys === 'string' ? [keys] : keys
    return Object.fromEntries(wanted.filter((k: string) => k in data).map((k: string) => [k, data[k]]))
  })
  vi.mocked(browser.storage.local.set).mockImplementation(async (items: any) => {
    Object.assign(data, items)
  })
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys: any) => {
    for (const key of typeof keys === 'string' ? [keys] : keys)
      delete data[key]
  })
  return data
}

function record(over: Partial<SiteVisitData> = {}): SiteVisitData {
  return { count: 1, lastSeen: 1, ignored: false, ...over }
}

describe('mergeVisitRecords', () => {
  // The same fold a family verdict takes, so no family total moves
  it('adds the visits and keeps the widest span of dates', () => {
    const merged = mergeVisitRecords(
      record({ count: 30, lastSeen: 500, firstSeen: 100, activeDays: 12 }),
      record({ count: 12, lastSeen: 900, firstSeen: 50, activeDays: 20 }),
    )
    expect(merged).toEqual({ count: 42, lastSeen: 900, firstSeen: 50, activeDays: 20, ignored: false })
  })

  it('keeps a date only one side knows', () => {
    const merged = mergeVisitRecords(record({ firstSeen: 70 }), record())
    expect(merged.firstSeen).toBe(70)
    expect(merged.activeDays).toBeUndefined()
  })

  // A false is what lifting a silence writes back, indistinguishable from never
  // having silenced, so the true is the only one known to be somebody's choice
  it('stays silenced if either name was', () => {
    expect(mergeVisitRecords(record({ ignored: true }), record()).ignored).toBe(true)
    expect(mergeVisitRecords(record(), record({ ignored: true })).ignored).toBe(true)
    expect(mergeVisitRecords(record(), record()).ignored).toBe(false)
  })
})

describe('planWwwFold', () => {
  it('moves www.X into X and marks www.X for deletion', () => {
    const plan = planWwwFold({
      'example.com': record({ count: 3 }),
      'www.example.com': record({ count: 4 }),
      'www.other.org': record({ count: 5 }),
    })
    expect(plan.stale.sort()).toEqual(['www.example.com', 'www.other.org'])
    expect(plan.merged['example.com'].count).toBe(7)
    expect(plan.merged['other.org'].count).toBe(5)
  })

  it('leaves a www name alone when it is a name of its own', () => {
    const plan = planWwwFold({
      'www.com': record(),
      'www.co.uk': record(),
      'www.github.io': record(),
    })
    expect(plan.stale).toEqual([])
    expect(plan.merged).toEqual({})
  })

  it('touches nothing that is not a visit record', () => {
    const plan = planWwwFold({ 'www.example.com': ['a list'], '__visilantThing': true })
    expect(plan.stale).toEqual([])
  })
})

describe('foldWwwRecords', () => {
  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockReset()
    vi.mocked(browser.storage.local.set).mockReset()
    vi.mocked(browser.storage.local.remove).mockReset()
  })

  it('merges, deletes the www records and marks itself done', async () => {
    const data = fakeStorage()
    data['example.com'] = record({ count: 3 })
    data['www.example.com'] = record({ count: 4 })

    expect(await foldWwwRecords()).toBe(true)
    expect(data['example.com']).toMatchObject({ count: 7 })
    expect('www.example.com' in data).toBe(false)
    expect(data[WWW_FOLD_KEY]).toBe(true)
  })

  it('runs once', async () => {
    const data = fakeStorage()
    data['www.example.com'] = record({ count: 4 })
    await foldWwwRecords()

    // Something written under www afterwards is not this run's business
    data['www.example.com'] = record({ count: 1 })
    expect(await foldWwwRecords()).toBe(false)
    expect(data['example.com']).toMatchObject({ count: 4 })
  })

  // The worker can be stopped between writing X and deleting www.X. Run again
  // from scratch, the next start would add the same visits to X a second time.
  it('finishes a run that was cut off half-way without counting twice', async () => {
    const data = fakeStorage()
    data['example.com'] = record({ count: 3 })
    data['www.example.com'] = record({ count: 4 })

    vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error('worker stopped'))
    await expect(foldWwwRecords()).rejects.toThrow('worker stopped')
    expect(data[WWW_FOLD_KEY]).toBe('merged')
    expect(data['example.com']).toMatchObject({ count: 7 })

    // The next start
    await foldWwwRecords()
    expect(data['example.com']).toMatchObject({ count: 7 })
    expect('www.example.com' in data).toBe(false)
    expect(data[WWW_FOLD_KEY]).toBe(true)
  })

  it('sends an unfinished full import back to the start', async () => {
    const data = fakeStorage()
    data['www.example.com'] = record()
    data[HISTORY_IMPORT_STATE_KEY] = { stage: 'full-running', cursor: 'www.foo.com', runId: 'r' }

    await foldWwwRecords()
    expect(data[HISTORY_IMPORT_STATE_KEY]).toEqual({ stage: 'full-running', cursor: '', runId: 'r' })
  })

  it('marks an empty profile done without writing a record', async () => {
    const data = fakeStorage()
    expect(await foldWwwRecords()).toBe(false)
    expect(data).toEqual({ [WWW_FOLD_KEY]: true })
  })
})

// Queued first at worker load. What that protects is the import: it writes
// counts that already include the www visits, folded in with max. Merged after
// it, the fold would add the same visits a second time.
describe('foldWwwRecords and the writes behind it', () => {
  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockReset()
    vi.mocked(browser.storage.local.set).mockReset()
    vi.mocked(browser.storage.local.remove).mockReset()
  })

  it('finishes before an import write queued after it reads the record', async () => {
    const data = fakeStorage()
    data['example.com'] = record({ count: 3 })
    data['www.example.com'] = record({ count: 4 })

    // History knows seven visits across both names, and an import takes the max
    const fold = foldWwwRecords()
    const imported = updateVisitRecord('example.com', existing => ({ ...existing!, count: Math.max(existing!.count, 7) }))
    await Promise.all([fold, imported])

    expect(data['example.com']).toMatchObject({ count: 7 })
    expect('www.example.com' in data).toBe(false)
  })
})
