import type { BrowserContext } from '@playwright/test'
import { chromium } from '@playwright/test'
import { BADGE_COLORS } from '../src/logic/badge'
import { expect, extensionPath, test } from './fixtures'
import { blankPage, inWorker, patchSettings, serveSite, waitForAutoImport } from './helpers'

// Evaluated inside the extension's own worker, where the namespace exists
declare const chrome: any

const FLAG = '__visilantWwwFolded'

/** Link checking on, stopping a click on a link to somewhere unfamiliar. */
const CLICK_LEFT = {
  linkSafety: { enabled: true, tooltipTrigger: 'click-left', hoverDelay: 1500, showVisitCount: 'always', shortUrlMode: 'off', shortUrlShowFullUrl: false, shortUrlTraceChain: false, shortUrlResolveAny: false, shortUrlListUpdateUrl: '', scopeMode: 'everywhere', scopeDomains: '' },
}

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

// A link from www.X to X stays on the site. It used to be checked like a link
// to somewhere new, and with the click trigger it stopped behind a dialog.
test('a link between www. and the bare name is followed without a check', async ({ context, page }) => {
  await waitForAutoImport(context)
  await patchSettings(context, CLICK_LEFT)
  await page.route('https://link-site.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('bare') }))
  await serveSite(page, 'https://www.link-site.test/', blankPage('www', `
    <a id="bare" href="https://link-site.test/next" style="position:fixed;top:300px;left:300px;font-size:20px">onwards</a>
  `))
  await page.waitForTimeout(2000)

  await page.locator('#bare').click()
  await expect.poll(() => page.url(), { timeout: 5000 }).toBe('https://link-site.test/next')
})

// The control: the same click to another site does stop, so the test above is
// not passing because the click trigger was never on
test('CONTROL: a link to another site is still stopped', async ({ context, page }) => {
  await waitForAutoImport(context)
  await patchSettings(context, CLICK_LEFT)
  await page.route('https://other-site.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('other') }))
  await serveSite(page, 'https://www.link-site.test/', blankPage('www', `
    <a id="other" href="https://other-site.test/next" style="position:fixed;top:300px;left:300px;font-size:20px">elsewhere</a>
  `))
  await page.waitForTimeout(2000)

  await page.locator('#other').click()
  await page.waitForTimeout(1500)
  expect(page.url()).toBe('https://www.link-site.test/')
})
