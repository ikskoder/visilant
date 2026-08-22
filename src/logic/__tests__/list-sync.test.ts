import { beforeEach, describe, expect, it } from 'vitest'
import { classifyEmailDomain, loadCustomEmailLists, updatePublicList } from '../email-providers'
import { applyListChanges } from '../list-sync'
import { loadCustomMailSites, resolveMailSites, updateRemoteMailSites } from '../mail-sites'
import { STORAGE_KEY_REMOTE_SHORTENERS } from '../shortener-lists'
import { isShortenedUrl, loadCustomShorteners, updateShortenerList } from '../url-shorteners'

// The runtime layers are module state shared by every test in the process
beforeEach(() => {
  loadCustomShorteners([])
  updateShortenerList([])
  loadCustomEmailLists([], [])
  updatePublicList([])
  loadCustomMailSites([])
  updateRemoteMailSites([])
})

describe('applyListChanges', () => {
  it('applies a custom shortener list written elsewhere', () => {
    expect(isShortenedUrl('go.test')).toBe(false)
    applyListChanges({ customShorteners: { newValue: ['go.test'] } })
    expect(isShortenedUrl('go.test')).toBe(true)
  })

  it('applies a remote list out of its cache wrapper', () => {
    applyListChanges({ [STORAGE_KEY_REMOTE_SHORTENERS]: { newValue: { domains: ['r.test'], updatedAt: 1, urls: [] } } })
    expect(isShortenedUrl('r.test')).toBe(true)
  })

  // The case a truthiness check drops, and the reason a cleared list used to go
  // on classifying links in every tab that was already open
  it('applies an emptied list, so clearing one really clears it', () => {
    applyListChanges({ customShorteners: { newValue: ['go.test'] } })
    applyListChanges({ customShorteners: { newValue: [] } })
    expect(isShortenedUrl('go.test')).toBe(false)
  })

  it('applies a removal, where the new value is gone entirely', () => {
    applyListChanges({ [STORAGE_KEY_REMOTE_SHORTENERS]: { newValue: { domains: ['r.test'] } } })
    applyListChanges({ [STORAGE_KEY_REMOTE_SHORTENERS]: {} })
    expect(isShortenedUrl('r.test')).toBe(false)
  })

  it('applies the email lists', () => {
    applyListChanges({ customDisposableEmailDomains: { newValue: ['temp.test'] } })
    expect(classifyEmailDomain('temp.test')).toBe('disposable')

    applyListChanges({ remotePublicEmailProviders: { newValue: { domains: ['post.test'] } } })
    expect(classifyEmailDomain('post.test')).toBe('public')
  })

  it('applies the mail-site mapping', () => {
    applyListChanges({ customMailSites: { newValue: ['brand.test = webmail.brand.test'] } })
    expect(resolveMailSites('brand.test')).toEqual(['webmail.brand.test'])
  })

  it('ignores keys that are not lists', () => {
    expect(() => applyListChanges({
      'settings': { newValue: '{}' },
      'example.com': { newValue: { count: 3, lastSeen: 1 } },
    })).not.toThrow()
  })

  it('survives a stored value of the wrong shape', () => {
    applyListChanges({ customShorteners: { newValue: 'go.test' } })
    expect(isShortenedUrl('go.test')).toBe(false)
    applyListChanges({ customShorteners: { newValue: ['ok.test', 42, null] } })
    expect(isShortenedUrl('ok.test')).toBe(true)
  })
})
