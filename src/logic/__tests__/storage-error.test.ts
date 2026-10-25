import { describe, expect, it } from 'vitest'
import { storageErrorKind, storageErrorText } from '../storage-error'

describe('storageErrorKind', () => {
  // The texts the browsers actually put in the error
  it.each([
    ['QUOTA_BYTES quota exceeded', 'full'],
    ['QUOTA_BYTES_PER_ITEM quota exceeded', 'full'],
    // What Chrome 151 actually says, seen on the settings page
    ['Resource::kQuotaBytesPerItem quota exceeded', 'full'],
    // Not seen yet, and taken to follow the same pattern
    ['Resource::kMaxWriteOperationsPerMinute quota exceeded', 'too-often'],
    ['QuotaExceededError: storage.sync API call exceeded its quota limitations.', 'full'],
    ['This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.', 'too-often'],
    ['This request exceeds the MAX_WRITE_OPERATIONS_PER_HOUR quota.', 'too-often'],
    ['Could not establish connection. Receiving end does not exist.', 'no-answer'],
    ['Extension context invalidated.', 'no-answer'],
    ['A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received', 'no-answer'],
    ['Promised response from onMessage listener went out of scope', 'no-answer'],
    ['the settings were not saved', 'unexplained'],
    ['Something nobody has seen', 'other'],
  ] as const)('reads %j as %s', (message, kind) => {
    expect(storageErrorKind(new Error(message))).toBe(kind)
  })

  it('reads an error that is not an Error', () => {
    expect(storageErrorKind({ message: 'QUOTA_BYTES quota exceeded' })).toBe('full')
    expect(storageErrorText('plain words')).toBe('plain words')
    expect(storageErrorText(undefined)).toBe('')
  })
})
