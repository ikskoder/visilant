import type { Settings, SiteVisitData } from '../storage'
import { describe, expect, it } from 'vitest'
import { defaultSettings, parseStoredSettings } from '../storage'

describe('defaultSettings', () => {
  it('has correct safety threshold', () => {
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
    expect(defaultSettings.sortOption).toBe('visits')
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

    it('uses hover tooltip trigger', () => {
      expect(ls.tooltipTrigger).toBe('hover')
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

    it('has empty short URL list update URL', () => {
      expect(ls.shortUrlListUpdateUrl).toBe('')
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
      'showBadge',
      'changeIcon',
      'showWarningNotification',
      'notificationStyle',
      'showInputWarning',
      'showCopyWarning',
      'selectedLanguage',
      'sortOption',
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
