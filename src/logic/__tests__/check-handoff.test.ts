import { afterEach, describe, expect, it, vi } from 'vitest'
import { putCheckHandoff, readCheckHandoff } from '../check-handoff'

// The check page's address stays in the browser's history, so what it is
// opened with is handed over in the session store and the address names a key

function sessionStore() {
  const held: Record<string, unknown> = {}
  const session = {
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(held, items) }),
    get: vi.fn(async (key: string) => (key in held ? { [key]: held[key] } : {})),
    remove: vi.fn(async (keys: string[]) => { keys.forEach(key => delete held[key]) }),
  }
  ;(browser.storage as any).session = session
  return { held, session }
}

afterEach(() => {
  delete (browser.storage as any).session
})

describe('what the check page is opened with', () => {
  it('is kept out of the page\'s address', async () => {
    const { held } = sessionStore()
    const query = await putCheckHandoff('mailto:ann@corp.test?subject=Private')
    expect(query).toMatch(/^check=1&handoff=[\w-]+$/)
    expect(query).not.toContain('ann')
    expect(Object.values(held)).toContain('mailto:ann@corp.test?subject=Private')
  })

  // The store is shared with the tampering alarm and is not endless
  it('keeps the last twenty and lets the older ones go', async () => {
    const { held } = sessionStore()
    const first = new URLSearchParams(await putCheckHandoff('first@corp.test'))
    for (let n = 0; n < 20; n++)
      await putCheckHandoff(`n${n}@corp.test`)
    expect(Object.keys(held).filter(key => key.startsWith('checkHandoff:'))).toHaveLength(20)
    expect(await readCheckHandoff(first)).toBe('')
  })

  it('hands the value over even when the old ones will not go', async () => {
    const { session } = sessionStore()
    for (let n = 0; n < 20; n++)
      await putCheckHandoff(`n${n}@corp.test`)
    session.remove.mockRejectedValueOnce(new Error('no'))
    const params = new URLSearchParams(await putCheckHandoff('last@corp.test'))
    expect(params.get('handoff')).toBeTruthy()
    expect(await readCheckHandoff(params)).toBe('last@corp.test')
  })

  // Cut through the middle of a character, the value could not be encoded
  it('cuts an overlong value at a whole character', async () => {
    const query = await putCheckHandoff(`${'a'.repeat(64 * 1024 - 1)}😀tail`)
    expect(query).toBe(`check=1&value=${'a'.repeat(64 * 1024 - 1)}`)
  })

  // A check somebody asked for still has to open
  it('falls back to the address when the store refuses the write', async () => {
    const { session } = sessionStore()
    session.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))
    expect(await putCheckHandoff('ann@corp.test')).toBe('check=1&value=ann%40corp.test')
  })

  it('is read back by the page, and again when the page is reloaded', async () => {
    sessionStore()
    const params = new URLSearchParams(await putCheckHandoff('ann@corp.test'))
    expect(await readCheckHandoff(params)).toBe('ann@corp.test')
    expect(await readCheckHandoff(params)).toBe('ann@corp.test')
  })

  it('reads nothing for a key that names nothing, a tab restored in a later session', async () => {
    sessionStore()
    expect(await readCheckHandoff(new URLSearchParams('check=1&handoff=gone'))).toBe('')
    expect(await readCheckHandoff(new URLSearchParams('check=1'))).toBe('')
  })

  it('still takes a value from the address, as a page opened by hand gives it', async () => {
    sessionStore()
    expect(await readCheckHandoff(new URLSearchParams('check=1&value=example.com'))).toBe('example.com')
  })

  it('falls back to the address where there is no session store', async () => {
    const query = await putCheckHandoff('ann@corp.test')
    expect(query).toBe('check=1&value=ann%40corp.test')
    expect(await readCheckHandoff(new URLSearchParams(query))).toBe('ann@corp.test')
  })

  it('answers with nothing when the store fails, and does not throw', async () => {
    const { session } = sessionStore()
    session.get.mockRejectedValueOnce(new Error('no access'))
    expect(await readCheckHandoff(new URLSearchParams('check=1&handoff=x'))).toBe('')
  })
})
