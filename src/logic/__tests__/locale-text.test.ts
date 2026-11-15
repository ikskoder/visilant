import { describe, expect, it } from 'vitest'
import messages from '../../../extension/_locales/en/messages.json'

/**
 * How much a single interface string may say.
 *
 * A line under a setting used to grow a sentence at a time, each one true, until
 * the settings page read as an essay and nobody could find the setting in it.
 * A string over the limit is two things said in one place, or the reason for
 * something said next to the thing itself. Cut it, or name it here with what
 * makes it one thing that cannot be said shorter.
 */
const LIMIT = 210

const LONGER: Record<string, string> = {
  linkInterceptRedFlagsDesc: 'the one place that lists what a red flag is',
  addressSpellingHelp: 'help opened on request: what the two forms of an address are, why that matters and when it is normal',
  welcomeWhyBodyNoImport: 'the only explanation a browser without history gets for weeks of warnings',
  tamperingMessage: 'a warning that has to say what happened, how likely it is to matter and what to do',
  linkResolveHelp: 'help opened on request: what following a link costs and why it may find nothing, in words for a reader who has never heard of a cookie',
  linkResolveWhyNotCertain: 'help opened on request: the two reasons a followed link may end somewhere else for the reader, each in plain words',
}

const entries = Object.entries(messages as Record<string, { message: string }>)

describe('interface text', () => {
  it('keeps every string to one thing', () => {
    const tooLong = entries
      .filter(([key, { message }]) => message.length > LIMIT && !(key in LONGER))
      .map(([key, { message }]) => `${key} (${message.length})`)
    expect(tooLong).toEqual([])
  })

  it('lists no exception that is not one any more', () => {
    const stale = Object.keys(LONGER).filter((key) => {
      const entry = (messages as Record<string, { message: string } | undefined>)[key]
      return !entry || entry.message.length <= LIMIT
    })
    expect(stale).toEqual([])
  })

  // The writing rules of the project, which nothing checked for the strings
  it('uses no em dash and no semicolon', () => {
    const bad = entries.filter(([, { message }]) => /[—;]/.test(message)).map(([key]) => key)
    expect(bad).toEqual([])
  })

  // A comma or a full stop straight after an address reads as one more dot of
  // it: nobody tells the two apart at a glance. These are the placeholders
  // the lines of findings draw as addresses or as pieces of one. A sentence
  // that goes on after one is worded so that a word follows it.
  it('puts no punctuation straight after a piece of an address', () => {
    const drawnAsAddress = /\{(?:domain|site|real|platform|ending|name|reads|plain)\}[,.;:!?]/
    const beside = entries
      .filter(([key]) => /^(?:domainMarker|lookalikeReason|emailLocal)/.test(key))
      .filter(([, { message }]) => drawnAsAddress.test(message))
      .map(([key]) => key)
    expect(beside).toEqual([])
  })

  it('checks that rule against the lines that have such pieces', () => {
    const withPieces = entries.filter(([key, { message }]) => /^(?:domainMarker|lookalikeReason)/.test(key) && /\{(?:domain|site|real|platform|ending|name)\}/.test(message))
    expect(withPieces.length).toBeGreaterThan(8)
  })
})

/**
 * The same thing keeps the same words, and the surest way to that is one key.
 *
 * Two keys with one text are two places to change, and the second is the one
 * that gets forgotten: "Details" and "Site details" were one button, and so
 * were "Show where it leads" and "Try to find where it leads". A text is
 * under one key, or the pair is named here with why it is two, and then the
 * two are held to the same words.
 */
describe('one text, one key', () => {
  const SAME_ON_PURPOSE: [string[], string][] = [
    [['securityWarning', 'linkTooltipUnfamiliar'], 'the title of the warning and the verdict it is raised for'],
    [['familiarityVisits', 'badgeContentVisits'], 'the counter is named after the check it shows, and its key is built from the setting\'s value'],
    [['familiarityActiveDays', 'badgeContentActiveDays'], 'as above'],
    [['familiarityAge', 'badgeContentAge'], 'as above'],
    [['qrTypeText', 'pasteInterceptKindText'], 'a kind of content, in keys built from the kind'],
    [['emailTooltipTitle', 'pasteInterceptKindEmail'], 'as above'],
    [['linkSafetySettings', 'linkInterceptTitleFamiliar'], 'the feature in the settings and the title of its dialog'],
    [['linkTooltipShortener', 'linkInterceptTitleHidden'], 'the badge of a short link and the title of the dialog that stopped one'],
    [['antiTamperingDisableForSite', 'ignoredSiteSilence'], 'two switches in the popup, each told apart in tests by its key'],
    [['antiTamperingEnableForSite', 'ignoredSiteResume'], 'as above'],
  ]
  // The same letters and not the same word: a heading and a button
  const SAME_BY_CHANCE = [['familiarityFactCheck', 'checkFieldButton']]

  const text = (key: string) => (messages as Record<string, { message: string }>)[key]?.message

  it('has no text under two keys', () => {
    const named = new Set([...SAME_ON_PURPOSE.map(([keys]) => keys), ...SAME_BY_CHANCE].map(keys => [...keys].sort().join(' = ')))
    const byText = new Map<string, string[]>()
    for (const [key, { message }] of entries)
      byText.set(message.trim(), [...(byText.get(message.trim()) ?? []), key])
    const twice = [...byText.values()]
      .filter(keys => keys.length > 1)
      .map(keys => [...keys].sort().join(' = '))
      .filter(group => !named.has(group))
    expect(twice).toEqual([])
  })

  it('keeps the pairs that are two on purpose to the same words', () => {
    const apart = SAME_ON_PURPOSE.filter(([keys]) => new Set(keys.map(text)).size !== 1 || keys.some(key => text(key) === undefined)).map(([keys]) => keys.join(' / '))
    expect(apart).toEqual([])
  })
})
