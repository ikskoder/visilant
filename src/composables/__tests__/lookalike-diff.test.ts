import type { LookalikeAnswer } from '../useLookalikes'
import { describe, expect, it } from 'vitest'
import { lookalikeDiff } from '../useLookalikes'

function answer(...marks: (number[] | undefined)[]): LookalikeAnswer {
  return {
    status: 'answered',
    matches: marks.map(m => ({ domain: 'paypal.com', visits: 1, reason: 'confusable', evidence: '', severity: 'high', marks: m })),
  }
}

describe('lookalikeDiff', () => {
  it('marks the address the answer was about', () => {
    expect(lookalikeDiff(answer([5]), 'paypa1.com', 'paypa1.com')).toEqual([5])
    expect(lookalikeDiff(answer([5]), 'paypa1.com', 'PAYPA1.com.')).toEqual([5])
  })

  it('puts the marks on the Unicode spelling and never on the xn-- one', () => {
    const ascii = 'xn--pypal-4ve.com'
    expect(lookalikeDiff(answer([1]), ascii, 'pаypal.com')).toEqual([1])
    expect(lookalikeDiff(answer([1]), ascii, ascii)).toBeUndefined()
  })

  it('moves the marks past the account name of an email address', () => {
    expect(lookalikeDiff(answer([5]), 'paypa1.com', 'bill@paypa1.com')).toEqual([10])
  })

  it('leaves text with another kind of dot unmarked rather than guess', () => {
    expect(lookalikeDiff(answer([5]), 'paypa1.com', 'paypa1\u3002com')).toBeUndefined()
  })

  it('takes the top match only', () => {
    expect(lookalikeDiff(answer(undefined, [5]), 'paypa1.com', 'paypa1.com')).toBeUndefined()
  })

  it('says nothing about another address, or without an answer', () => {
    expect(lookalikeDiff(answer([5]), 'paypa1.com', 'paypa1.net')).toBeUndefined()
    expect(lookalikeDiff({ status: 'pending' }, 'paypa1.com', 'paypa1.com')).toBeUndefined()
    expect(lookalikeDiff(null, 'paypa1.com', 'paypa1.com')).toBeUndefined()
  })
})
