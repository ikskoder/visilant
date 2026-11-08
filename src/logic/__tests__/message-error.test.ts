import { describe, expect, it } from 'vitest'
import { isMessageError } from '../message-error'

describe('isMessageError', () => {
  it('reads the answer of a failed handler as a failure', () => {
    expect(isMessageError({ error: 'Error: storage is gone' })).toBe(true)
  })

  it('reads a result that reports its own error as an answer', () => {
    // Taken for a failed handler, a short link refused at the local network lost
    // its reason on the way to the page and showed the generic failure instead
    expect(isMessageError({ status: 'error', error: 'refused', chain: [], finalUrl: '', finalHostname: '' })).toBe(false)
    expect(isMessageError({ count: 3 })).toBe(false)
    expect(isMessageError(null)).toBe(false)
  })
})
