import type { BrowserContext } from '@playwright/test'
import { chromium } from '@playwright/test'
import { BADGE_COLORS } from '../src/logic/badge'
import { expect, extensionPath, test } from './fixtures'
import { blankPage, inWorker, serveSite, waitForAutoImport } from './helpers'

// Evaluated inside the extension's own worker, where the namespace exists
declare const chrome: any

const FLAG = '__visilantWwwFolded'

/**
 * One browser profile, started as often as a test needs.
 *
 * The fold runs the first time a worker loads, which on a fresh profile is long
 * before a test can seed anything, and `runtime.reload()` takes an extension
 * loaded from the command line away for good rather than restarting it. So the
 * test does what a user does: closes the browser on records an older version
 * left behind, and opens it again on the same profile.
 */
function launch(profile: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-features=SystemNotifications',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
}

async function reopenOnOldRecords(profile: string, records: Record<string, unknown>): Promise<BrowserContext> {
  const first = await launch(profile)
  await waitForAutoImport(first)
  await inWorker(first, async ({ records, flag }: any) => {
    await chrome.storage.local.set(records)
    await chrome.storage.local.remove(flag)
  }, { records, flag: FLAG })
  await first.close()

  const context = await launch(profile)
  await expect.poll(
    () => inWorker<unknown>(context, async (flag: string) => (await chrome.storage.local.get(flag))[flag], FLAG),
    { timeout: 15000 },
  ).toBe(true)
  return context
}

// The first argument has to be a pattern, and this test asks for no fixture
// eslint-disable-next-line no-empty-pattern
test('an update moves the www records into the bare name, visits added up', async ({}, testInfo) => {
  const context = await reopenOnOldRecords(testInfo.outputPath('profile'), {
    'fold-site.test': { count: 3, lastSeen: 2000, firstSeen: 500, activeDays: 2, ignored: false },
    'www.fold-site.test': { count: 9, lastSeen: 1000, firstSeen: 100, activeDays: 6, ignored: true },
  })

  const stored = await inWorker<Record<string, any>>(context, async () =>
    chrome.storage.local.get(['fold-site.test', 'www.fold-site.test']))
  await context.close()

  expect(stored['www.fold-site.test']).toBeUndefined()
  expect(stored['fold-site.test']).toEqual({ count: 12, lastSeen: 2000, firstSeen: 100, activeDays: 6, ignored: true })
})

// The point of it all: a site used every day under www. is not a stranger when
// a link leaves the prefix off. Read off the badge, which is drawn from the same
// record every other verdict is.
// eslint-disable-next-line no-empty-pattern
test('a page on the bare name is judged by what was recorded under www.', async ({}, testInfo) => {
  const DAY = 24 * 60 * 60 * 1000
  const context = await reopenOnOldRecords(testInfo.outputPath('profile'), {
    'www.daily-site.test': { count: 400, lastSeen: Date.now(), firstSeen: Date.now() - 400 * DAY, activeDays: 200, ignored: false },
  })

  const page = await context.newPage()
  await serveSite(page, 'https://daily-site.test/', blankPage('daily'))
  await page.bringToFront()

  const badgeColor = () => inWorker(context, async () => {
    const [tab] = await chrome.tabs.query({ url: '*://daily-site.test/*' })
    if (!tab)
      return 'no tab'
    const rgba = await chrome.action.getBadgeBackgroundColor({ tabId: tab.id })
    return rgba.slice(0, 3).join(',')
  })
  const rgb = (hex: string) => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16)).join(',')

  try {
    await expect.poll(badgeColor, { timeout: 15000, intervals: [300] }).toBe(rgb(BADGE_COLORS.familiar))
  }
  finally {
    await context.close()
  }
})
