import type { FamiliaritySettings } from '../familiarity'
import { describe, expect, it } from 'vitest'
import { ACTION_ICONS, BADGE_COLORS, badgeText, toolbarLook } from '../badge'
import { defaultFamiliaritySettings } from '../familiarity'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function rules(patch: Partial<FamiliaritySettings> = {}): FamiliaritySettings {
  return { ...defaultFamiliaritySettings, ...patch }
}

/** A site the shipped rules would call familiar. */
const known = { count: 42, activeDays: 12, firstSeen: NOW - 30 * DAY }

describe('badgeText', () => {
  it('draws the number the user picked', () => {
    expect(badgeText(known, rules(), 'visits', NOW)).toBe('42')
    expect(badgeText(known, rules(), 'activeDays', NOW)).toBe('12')
    expect(badgeText(known, rules(), 'age', NOW)).toBe('30')
  })

  it('counts the checks that pass against the checks that are on', () => {
    expect(badgeText(known, rules(), 'checks', NOW)).toBe('3/3')
    // Plenty of visits, but only two days and one week of knowing it
    expect(badgeText({ count: 90, activeDays: 2, firstSeen: NOW - 7 * DAY }, rules(), 'checks', NOW)).toBe('1/3')
  })

  it('counts only the checks that are switched on', () => {
    const twoOn = rules({ age: { enabled: false, min: 10 } })
    expect(badgeText(known, twoOn, 'checks', NOW)).toBe('2/2')
  })

  it('gives way to the single check when there is only one', () => {
    const visitsOnly = rules({
      activeDays: { enabled: false, min: 5 },
      age: { enabled: false, min: 10 },
    })
    // "1/1" would only repeat what the badge colour already says
    expect(badgeText(known, visitsOnly, 'checks', NOW)).toBe('42')

    const daysOnly = rules({
      visits: { enabled: false, min: 10 },
      age: { enabled: false, min: 10 },
    })
    expect(badgeText(known, daysOnly, 'checks', NOW)).toBe('12')
  })

  it('drops a number the user has stopped judging sites by', () => {
    const noAge = rules({ age: { enabled: false, min: 10 } })
    // 'age' was picked while that check was on. With it off, the badge counts
    // the checks that are left rather than drawing a number that was dismissed
    expect(badgeText(known, noAge, 'age', NOW)).toBe('2/2')

    const visitsOnly = rules({
      activeDays: { enabled: false, min: 5 },
      age: { enabled: false, min: 10 },
    })
    expect(badgeText(known, visitsOnly, 'activeDays', NOW)).toBe('42')
  })

  it('says so rather than guessing when the record never had the fact', () => {
    const old = { count: 500 }
    expect(badgeText(old, rules(), 'activeDays', NOW)).toBe('?')
    expect(badgeText(old, rules(), 'age', NOW)).toBe('?')
    expect(badgeText(old, rules(), 'visits', NOW)).toBe('500')
  })

  it('keeps a big number inside the badge', () => {
    expect(badgeText({ count: 999 }, rules(), 'visits', NOW)).toBe('999')
    expect(badgeText({ count: 1000 }, rules(), 'visits', NOW)).toBe('>1K')
    expect(badgeText({ count: 0, firstSeen: 1 }, rules(), 'age', NOW)).toBe('>1K')
  })
})

describe('toolbarLook', () => {
  it('draws an unfamiliar site in red', () => {
    expect(toolbarLook(false, false)).toBe('unfamiliar')
    expect(BADGE_COLORS.unfamiliar).toBe('#ff4444')
    expect(ACTION_ICONS.unfamiliar).toBe('site-danger')
  })

  it('drops an unfamiliar site to grey once the user silenced it', () => {
    // Red over a page that will warn about nothing promises a guard that is not
    // on duty. The verdict is still shown, only not as an alarm
    expect(toolbarLook(false, true)).toBe('silenced')
    expect(BADGE_COLORS.silenced).toBe('#808080')
    expect(ACTION_ICONS.silenced).toBe('site-muted')
  })

  it('leaves a familiar site green whatever the site was told to do', () => {
    // Silencing warnings does not make a site less known, and there was no
    // warning here to silence
    expect(toolbarLook(true, false)).toBe('familiar')
    expect(toolbarLook(true, true)).toBe('familiar')
    expect(BADGE_COLORS.familiar).toBe('#00C851')
  })
})
