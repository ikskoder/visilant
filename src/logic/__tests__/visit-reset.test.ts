import { describe, expect, it } from 'vitest'
import { FAMILIAR_INDEX_KEY } from '../familiar-index'
import { HISTORY_AUTO_IMPORT_KEY, HISTORY_IMPORT_STATE_KEY } from '../history-import'
import { visitKeysToRemove } from '../visit-reset'

function visit(count: number) {
  return { count, lastSeen: 1_700_000_000_000, ignored: false }
}

describe('visitKeysToRemove', () => {
  it('removes the visit records', () => {
    const keys = visitKeysToRemove({
      'example.com': visit(4),
      'mail.google.com': visit(120),
    })
    expect(keys.sort()).toEqual(['example.com', 'mail.google.com'])
  })

  it('removes the caches derived from the visit records', () => {
    const keys = visitKeysToRemove({
      [FAMILIAR_INDEX_KEY]: { domains: [], rules: 'v1', builtAt: 1 },
      [HISTORY_IMPORT_STATE_KEY]: { finishedAt: 1, domains: 12 },
    })
    expect(keys.sort()).toEqual([FAMILIAR_INDEX_KEY, HISTORY_IMPORT_STATE_KEY].sort())
  })

  // The one flag that has to survive: without it the next update sees an empty
  // profile and imports the history the user has just chosen to throw away
  it('keeps the auto-import flag', () => {
    expect(visitKeysToRemove({ [HISTORY_AUTO_IMPORT_KEY]: true })).toEqual([])
  })

  it('keeps every list the user typed or fetched', () => {
    const untouched = {
      settings: '{"theme":"dark"}',
      customShorteners: ['short.test'],
      customPublicEmailProviders: ['mail.test'],
      customDisposableEmailDomains: ['temp.test'],
      customMailSites: ['gmail.com = mail.google.com'],
      remoteShortenerDomains: { domains: ['a.test'], updatedAt: 1, urls: [] },
      remotePublicEmailProviders: { domains: ['b.test'], updatedAt: 1, urls: [] },
      remoteDisposableEmailDomains: { domains: ['c.test'], updatedAt: 1, urls: [] },
      remoteMailSites: { domains: ['d.test = e.test'], updatedAt: 1, urls: [] },
      textDefaultsSeeded: true,
      shortenerSourceSeeded: true,
      familiarityMigrated: true,
      __visilantPageZoom: 1.2,
    }
    expect(visitKeysToRemove(untouched)).toEqual([])
  })

  it('leaves a wipe of everything at once with only the visit side gone', () => {
    const keys = visitKeysToRemove({
      'example.com': visit(3),
      [FAMILIAR_INDEX_KEY]: { domains: [] },
      'customShorteners': ['short.test'],
      'remoteMailSites': { domains: [] },
      [HISTORY_AUTO_IMPORT_KEY]: true,
    })
    expect(keys.sort()).toEqual(['example.com', FAMILIAR_INDEX_KEY].sort())
  })

  // A hostname is the only shape a visit record is stored under, and a list that
  // happened to be keyed by one would still not look like a record
  it('ignores a dotted key that does not hold a visit record', () => {
    expect(visitKeysToRemove({ 'list.test': ['a', 'b'] })).toEqual([])
    expect(visitKeysToRemove({ 'partial.test': { count: 2 } })).toEqual([])
  })
})
