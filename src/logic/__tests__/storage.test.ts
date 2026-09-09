import type { Settings, SiteVisitData } from '../storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import browser from 'webextension-polyfill'
import { DEFAULT_SHORTENER_LIST_URL, defaultSettings, parseStoredSettings, runSettingsMigrations, settingsPatch } from '../storage'

describe('defaultSettings', () => {
  it('ships all three checks on, visits at ten', () => {
    expect(defaultSettings.familiarity.visits).toEqual({ enabled: true, min: 10 })
    expect(defaultSettings.familiarity.activeDays.enabled).toBe(true)
    expect(defaultSettings.familiarity.age.enabled).toBe(true)
    // Kept only so a hand-set threshold survives the update that added the rest
    expect(defaultSettings.safety).toBe(10)
  })

  it('has badge enabled by default', () => {
    expect(defaultSettings.showBadge).toBe(true)
  })

  it('has icon color change disabled by default', () => {
    expect(defaultSettings.changeIcon).toBe(false)
  })

  it('has warning notification enabled by default', () => {
    expect(defaultSettings.showWarningNotification).toBe(true)
    expect(defaultSettings.notificationStyle).toBe('in-page')
  })

  it('has both input and copy warnings enabled', () => {
    expect(defaultSettings.showInputWarning).toBe(true)
    expect(defaultSettings.showCopyWarning).toBe(true)
  })

  it('defaults to English language', () => {
    expect(defaultSettings.selectedLanguage).toBe('en')
  })

  it('has correct sort defaults', () => {
    expect(defaultSettings.listMetric).toBe('visits')
    expect(defaultSettings.sortByName).toBe(false)
    expect(defaultSettings.sortOrder).toBe('desc')
  })

  it('has correct display defaults', () => {
    expect(defaultSettings.domainCase).toBe('lower')
    expect(defaultSettings.domainHighlighting).toBe(false)
    expect(defaultSettings.punycodeListMode).toBe('unicode')
    expect(defaultSettings.popupFontSize).toBe(100)
  })

  it('has empty anti-tampering exclusions by default', () => {
    expect(defaultSettings.antiTamperingExcludedDomains).toBe('')
  })

  describe('linkSafety defaults', () => {
    const ls = defaultSettings.linkSafety

    it('is enabled by default', () => {
      expect(ls.enabled).toBe(true)
    })

    it('waits to be asked, on a right-click', () => {
      expect(ls.tooltipTrigger).toBe('click-right')
    })

    it('shows visit count always', () => {
      expect(ls.showVisitCount).toBe('always')
    })

    it('has short URL mode set to button', () => {
      expect(ls.shortUrlMode).toBe('button')
    })

    it('has short URL display options disabled', () => {
      expect(ls.shortUrlShowFullUrl).toBe(false)
      expect(ls.shortUrlTraceChain).toBe(false)
      expect(ls.shortUrlResolveAny).toBe(false)
    })

    it('ships the source the built-in shortener list came from', () => {
      expect(ls.shortUrlListUpdateUrl).toBe(DEFAULT_SHORTENER_LIST_URL)
    })

    it('defaults to everywhere scope', () => {
      expect(ls.scopeMode).toBe('everywhere')
      expect(ls.scopeDomains).toBe('')
    })
  })

  it('matches Settings interface shape', () => {
    // Type check: defaultSettings should satisfy the Settings interface
    const s: Settings = defaultSettings
    expect(s).toBeDefined()

    // Verify all top-level keys exist
    const expectedKeys: (keyof Settings)[] = [
      'safety',
      'familiarity',
      'showBadge',
      'changeIcon',
      'showWarningNotification',
      'notificationStyle',
      'showInputWarning',
      'showCopyWarning',
      'selectedLanguage',
      'listMetric',
      'sortByName',
      'sortOrder',
      'domainCase',
      'domainHighlighting',
      'punycodeListMode',
      'popupFontSize',
      'linkSafety',
      'antiTamperingExcludedDomains',
    ]
    for (const key of expectedKeys) {
      expect(s).toHaveProperty(key)
    }
  })
})

describe('siteVisitData type', () => {
  it('can represent a site visit record', () => {
    const data: SiteVisitData = {
      count: 42,
      lastSeen: Date.now(),
      ignored: false,
    }
    expect(data.count).toBe(42)
    expect(data.ignored).toBe(false)
    expect(data.lastSeen).toBeGreaterThan(0)
  })
})

describe('parseStoredSettings', () => {
  it('reads the serialized string storage actually holds', () => {
    const parsed = parseStoredSettings(JSON.stringify({ ...defaultSettings, safety: 42 }))
    expect(parsed?.safety).toBe(42)
  })

  // Reaching for a field on the raw string yields `undefined` for every one of
  // them, so two different settings objects compare equal and a boolean check
  // reads as false – both silently, which is what makes this worth a test
  it('tells two thresholds apart where a bare cast cannot', () => {
    const before = parseStoredSettings(JSON.stringify({ ...defaultSettings, safety: 10 }))
    const after = parseStoredSettings(JSON.stringify({ ...defaultSettings, safety: 25 }))
    expect(before?.safety).not.toBe(after?.safety)
  })

  it('keeps a false setting false rather than losing it to undefined', () => {
    const parsed = parseStoredSettings(JSON.stringify({ ...defaultSettings, changeIcon: false }))
    expect(parsed?.changeIcon).toBe(false)
  })

  it('accepts an object unchanged', () => {
    expect(parseStoredSettings({ ...defaultSettings, safety: 7 })?.safety).toBe(7)
  })

  it('gives up quietly on anything unreadable', () => {
    expect(parseStoredSettings('not json')).toBeUndefined()
    expect(parseStoredSettings(undefined)).toBeUndefined()
    expect(parseStoredSettings(null)).toBeUndefined()
  })
})

describe('runSettingsMigrations', () => {
  // A fake that actually holds what was written, because the pipeline reads its
  // own write back before it will record a migration as done
  let sync: Record<string, unknown>
  let local: Record<string, unknown>

  beforeEach(async () => {
    // The module-level settings ref reads storage when this file is imported and
    // seeds the defaults if it finds nothing. Let that finish before counting.
    await new Promise(resolve => setTimeout(resolve, 0))

    sync = {}
    local = {}
    vi.mocked(browser.storage.sync.get).mockReset()
    vi.mocked(browser.storage.sync.set).mockReset()
    vi.mocked(browser.storage.local.get).mockReset()
    vi.mocked(browser.storage.local.set).mockReset()
    vi.mocked(browser.storage.sync.get).mockImplementation(async (keys: any) => {
      const wanted = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(wanted.filter((k: string) => k in sync).map((k: string) => [k, sync[k]]))
    })
    vi.mocked(browser.storage.sync.set).mockImplementation(async (items: any) => {
      Object.assign(sync, items)
    })
    vi.mocked(browser.storage.local.get).mockImplementation(async (keys: any) => {
      const wanted = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(wanted.filter((k: string) => k in local).map((k: string) => [k, local[k]]))
    })
    vi.mocked(browser.storage.local.set).mockImplementation(async (items: any) => {
      Object.assign(local, items)
    })
  })

  const stored = () => JSON.parse(sync.settings as string) as Settings

  it('carries a hand-set threshold over and leaves the two newer checks off', async () => {
    sync.settings = JSON.stringify({ safety: 25, linkSafety: { enabled: true, shortUrlListUpdateUrl: 'x' }, lookupServices: 'a', disposableEmailListUrl: 'b', publicEmailListUrl: 'c' })

    await runSettingsMigrations()

    expect(stored().familiarity.visits).toEqual({ enabled: true, min: 25 })
    // The records this profile already has cannot answer either of them, and an
    // unanswered check fails – so an update must not switch them on
    expect(stored().familiarity.activeDays.enabled).toBe(false)
    expect(stored().familiarity.age.enabled).toBe(false)
    expect(local.familiarityMigrated).toBe(true)
  })

  it('reads the raw blob, so a merged default cannot pass for the user choice', async () => {
    // What the hydrated ref would look like: the shipped rules merged in over a
    // profile that never stored any. Reading that, the migration would decide
    // there was nothing to carry over and mark itself done on threshold 10.
    sync.settings = JSON.stringify({ safety: 25 })

    await runSettingsMigrations()

    expect(stored().familiarity.visits.min).toBe(25)
  })

  it('applies every pending pass in one write', async () => {
    sync.settings = JSON.stringify({ safety: 25, linkSafety: { enabled: true } })

    await runSettingsMigrations()

    // One commit, not three racing read-modify-writes of the same blob
    expect(vi.mocked(browser.storage.sync.set)).toHaveBeenCalledTimes(1)
    expect(stored().familiarity.visits.min).toBe(25)
    expect(stored().linkSafety.shortUrlListUpdateUrl).toBe(DEFAULT_SHORTENER_LIST_URL)
    expect(stored().lookupServices).toBe(defaultSettings.lookupServices)
  })

  it('does not run twice, so a cleared field stays cleared', async () => {
    local.textDefaultsSeeded = true
    local.shortenerSourceSeeded = true
    local.familiarityMigrated = true
    sync.settings = JSON.stringify({ linkSafety: { shortUrlListUpdateUrl: '' }, lookupServices: '' })

    await runSettingsMigrations()

    expect(browser.storage.sync.set).not.toHaveBeenCalled()
  })

  it('leaves a source the user has already set', async () => {
    local.textDefaultsSeeded = true
    local.familiarityMigrated = true
    sync.settings = JSON.stringify({ linkSafety: { shortUrlListUpdateUrl: 'https://example.com/mine.txt' } })

    await runSettingsMigrations()

    expect(browser.storage.sync.set).not.toHaveBeenCalled()
    expect(local.shortenerSourceSeeded).toBe(true)
  })

  it('keeps the flag down when the write fails, so the next start retries', async () => {
    sync.settings = JSON.stringify({ safety: 25 })
    vi.mocked(browser.storage.sync.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))

    await runSettingsMigrations()

    expect(local.familiarityMigrated).toBeUndefined()

    // ...and the retry lands
    await runSettingsMigrations()
    expect(stored().familiarity.visits.min).toBe(25)
    expect(local.familiarityMigrated).toBe(true)
  })

  it('keeps the flag down when something else overwrote the blob first', async () => {
    sync.settings = JSON.stringify({ safety: 25 })
    vi.mocked(browser.storage.sync.set).mockImplementationOnce(async () => {
      sync.settings = JSON.stringify({ safety: 10 })
    })

    await runSettingsMigrations()

    expect(local.familiarityMigrated).toBeUndefined()
  })

  it('marks a fresh profile done without writing anything', async () => {
    await runSettingsMigrations()

    expect(browser.storage.sync.set).not.toHaveBeenCalled()
    expect(local.familiarityMigrated).toBe(true)
    expect(local.textDefaultsSeeded).toBe(true)
    expect(local.shortenerSourceSeeded).toBe(true)
  })

  it('leaves an unreadable blob alone and records nothing', async () => {
    sync.settings = 'not json'

    await runSettingsMigrations()

    expect(browser.storage.sync.set).not.toHaveBeenCalled()
    expect(local.familiarityMigrated).toBeUndefined()
  })
})

describe('settingsPatch', () => {
  it('holds only what changed', () => {
    const stored = { ...defaultSettings }
    const next = { ...defaultSettings, blockPasteOnUnfamiliar: true }

    expect(settingsPatch(next, stored)).toEqual({ blockPasteOnUnfamiliar: true })
  })

  it('holds everything when there is nothing stored to compare with', () => {
    const patch = settingsPatch({ ...defaultSettings }, null)

    expect(Object.keys(patch).length).toBe(Object.keys(defaultSettings).length)
  })

  it('sees a change inside a nested setting', () => {
    const stored = { ...defaultSettings }
    const next = JSON.parse(JSON.stringify(defaultSettings)) as Settings
    next.familiarity.visits.min = 25

    expect(settingsPatch(next, stored)).toEqual({ familiarity: next.familiarity })
  })

  // A message is structured-cloned on its way to the background, and a reactive
  // proxy cannot be cloned: a patch carrying one would never arrive, so nothing
  // would ever save
  it('hands back something a message can carry', () => {
    const next = reactive(JSON.parse(JSON.stringify(defaultSettings)) as Settings)
    next.familiarity.visits.min = 25

    const patch = settingsPatch(next, { ...defaultSettings })
    expect(() => structuredClone(patch)).not.toThrow()
  })
})
