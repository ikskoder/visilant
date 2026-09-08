import { describe, expect, it } from 'vitest'
import { FAMILIAR_INDEX_KEY } from '../familiar-index'
import { HISTORY_AUTO_IMPORT_KEY, HISTORY_IMPORT_STATE_KEY } from '../history-import'
import { planSilenceChanges, silencedHosts, visitKeysToRemove } from '../visit-reset'

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

/**
 * What the settings page shows so a silence cannot stay invisible.
 *
 * The switch lives in the popup, which only ever describes the site being
 * looked at, so a host silenced months ago is a hole in the guard that nothing
 * on screen mentions. Missing an entry here is the failure that matters, which
 * is why the shape test is the wipe's generous one rather than a stricter guess.
 */
describe('silencedHosts', () => {
  it('names the silenced hosts and no others', () => {
    expect(silencedHosts({
      'loud.test': visit(3),
      'quiet.test': { ...visit(3), ignored: true },
      'alsoquiet.test': { ...visit(90), ignored: true },
    })).toEqual(['alsoquiet.test', 'quiet.test'])
  })

  it('is empty when nothing was silenced', () => {
    expect(silencedHosts({ 'example.com': visit(4) })).toEqual([])
  })

  // The flag is what is being reported, so anything short of a true has to read
  // as "not silenced" rather than as a value worth listing
  it('takes only a real flag for an answer', () => {
    expect(silencedHosts({
      'a.test': { ...visit(1), ignored: undefined as any },
      'b.test': { ...visit(1), ignored: 'yes' as any },
      'c.test': { ...visit(1), ignored: 1 as any },
    })).toEqual([])
  })

  it('does not mistake a list or a cache for a silenced site', () => {
    expect(silencedHosts({
      customShorteners: ['short.test'],
      remoteMailSites: { domains: [], ignored: true },
      [FAMILIAR_INDEX_KEY]: { domains: [], ignored: true },
    })).toEqual([])
  })

  // A hostname without a dot is still a site somebody silenced. It is not
  // counted from now on, but the record exists and hiding it would leave a
  // silence that cannot be found at all.
  it('lists a dotless host that carries a record', () => {
    expect(silencedHosts({ intranet: { ...visit(2), ignored: true } })).toEqual(['intranet'])
  })
})

/**
 * Editing the silenced list as a block of text.
 *
 * Each line is a flag on a visit record rather than an entry in one array, so a
 * wrong answer here does not overwrite a list, it writes records that outlive
 * the page.
 */
describe('planSilenceChanges', () => {
  it('silences what was added and lifts what was deleted', () => {
    const plan = planSilenceChanges(['gone.test', 'kept.test'], 'kept.test\nnew.test')

    expect(plan.silence).toEqual(['new.test'])
    expect(plan.unsilence).toEqual(['gone.test'])
    expect(plan.rejected).toEqual([])
  })

  it('does nothing when the text says what is already stored', () => {
    const plan = planSilenceChanges(['a.test', 'b.test'], 'a.test\nb.test')

    expect(plan.silence).toEqual([])
    expect(plan.unsilence).toEqual([])
  })

  it('lifts every one of them when the box is emptied', () => {
    expect(planSilenceChanges(['a.test', 'b.test'], '').unsilence).toEqual(['a.test', 'b.test'])
  })

  it('reads past blank lines and stray spacing', () => {
    const plan = planSilenceChanges([], '  a.test  \n\n\n b.test\n')

    expect(plan.silence).toEqual(['a.test', 'b.test'])
    expect(plan.rejected).toEqual([])
  })

  /**
   * A record stored under a name with a capital in it. Comparing lowercase to
   * lowercase would say the line is new, silence it a second time under its own
   * key, and leave the site listed twice with only one of the two liftable.
   */
  it('matches a stored name case-insensitively rather than duplicating it', () => {
    const plan = planSilenceChanges(['Example.COM'], 'example.com')

    expect(plan.silence).toEqual([])
    expect(plan.unsilence).toEqual([])
  })

  it('names a line that could never be a stored key instead of writing it', () => {
    const plan = planSilenceChanges([], 'good.test\nhello there\n__visilantPageZoom')

    expect(plan.silence).toEqual(['good.test'])
    expect(plan.rejected).toEqual(['hello there', '__visilantPageZoom'])
  })

  // A rejected line must not read as a deletion either, or a typo would lift
  // the silence on the site the line was meant to name
  it('does not let a rejected line lift anything', () => {
    expect(planSilenceChanges(['kept.test'], 'kept.test\nnot a host').unsilence).toEqual([])
  })

  it('stores what it silences in lower case', () => {
    expect(planSilenceChanges([], 'Shop.Example.COM').silence).toEqual(['shop.example.com'])
  })
})
