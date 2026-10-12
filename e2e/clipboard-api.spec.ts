/**
 * Writes to the clipboard that fire no `copy` event.
 *
 * `navigator.clipboard.writeText()` and `.write()` are how a ClickFix page puts
 * its command in the clipboard, and the copy warning used to hear only the
 * `copy` event. The wrapper in the page's world reports them now. The Firefox
 * half of this suite is e2e-firefox/run.ts, on the same page.
 *
 * Every test that expects silence first checks that the wrapper is in this page
 * at all. Without that a broken build passes every one of them.
 */
import { CLICKFIX_COMMAND, clickFixPage } from './clipboard-page'
import { expect, test } from './fixtures'
import { inWorker, patchSettings, seedVisits, serveSite, waitForAutoImport } from './helpers'

// Evaluated inside the extension's service worker
declare const chrome: any

const SITE_URL = 'https://clickfix-api.test/'
const SITE_HOST = 'clickfix-api.test'
const DAY = 24 * 60 * 60 * 1000

/** Same as basic.spec.ts: the warning takes the top right corner and the hit test. */
function warningShowing(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth - 30, 30) as HTMLElement | null
    return Boolean(el?.style && el.style.getPropertyValue('z-index') === '2147483647')
  })
}

async function openClickFix(page: any, context: any) {
  // Read back what landed, so a test can tell a write that happened from one
  // that was refused before the wrapper's part in it mattered
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_URL.slice(0, -1) })
  await serveSite(page, SITE_URL, clickFixPage())
  // Judged first, as a real page would be by the time somebody reads it and clicks
  await page.waitForTimeout(2500)
}

async function expectWarning(page: any) {
  await expect.poll(() => warningShowing(page), { timeout: 10000, intervals: [250] }).toBe(true)
}

/** Silence, after proving the wrapper was there to report something. */
async function expectNoWarning(page: any) {
  expect(await page.evaluate(() => (window as any).wrapperInstalled())).toBe(true)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(CLICKFIX_COMMAND)
  await page.waitForTimeout(2500)
  expect(await warningShowing(page)).toBe(false)
}

test('writeText on an unfamiliar site raises the copy warning', async ({ page, context }) => {
  await openClickFix(page, context)
  expect(await warningShowing(page)).toBe(false)

  await page.click('#write-text')
  await expectWarning(page)
  // The page's call went through: warned about, never blocked
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CLICKFIX_COMMAND)
})

test('write with a ClipboardItem raises the copy warning', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#write-item')
  await expectWarning(page)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(CLICKFIX_COMMAND)
})

test('execCommand copy still raises the copy warning', async ({ page, context }) => {
  // The path that worked before the wrapper, and must go on working with it.
  // The wrapper being in place is checked too, so this is not a test of an
  // extension that has none.
  await openClickFix(page, context)
  expect(await page.evaluate(() => (window as any).wrapperInstalled())).toBe(true)
  await page.click('#exec-copy')
  await expectWarning(page)
})

test('the page\'s first script already finds the wrapper in place', async ({ page, context }) => {
  // A page that saved the original before the wrapper went in would hold an
  // unwrapped copy for good. The wrapper is injected at document start in the
  // page's world, and this checks that nothing of the page's runs ahead of it.
  await openClickFix(page, context)
  expect(await page.evaluate(() => (window as any).__wrappedAtFirstScript)).toBe(true)
})

test('a page that listens for the signal cannot swallow it', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#swallow')
  await expectWarning(page)
})

test('document.open() does not take the signal away', async ({ page, context }) => {
  // document.open() erases every listener on the window and the document, the
  // content script's own included, after which a page listener would be first
  await openClickFix(page, context)
  await page.click('#reopen')
  await page.waitForTimeout(500)
  await page.click('#after-reopen')
  await expectWarning(page)
})

test('a write from inside a frame raises the warning about the page', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.frameLocator('#inner').locator('#frame-write').click()
  await expectWarning(page)
})

test('KNOWN LIMITATION: a clean writeText taken from a frame made this instant goes unwarned', async ({ page, context }) => {
  // The page makes a frame and calls its Clipboard method before the browser has
  // run any extension script in it. No extension can wrap a realm it has not been
  // let into yet, and the ways to reach one - window[0], frames[0], window.open -
  // go round any getter it could wrap. The README says so under Limitations.
  //
  // Pinned as it is today: the write lands and nothing is said. If a browser
  // starts injecting in time, the warning appears and this fails, which is the
  // signal to update the README. If the setup breaks, the first checks fail.
  await openClickFix(page, context)
  expect(await page.evaluate(() => (window as any).wrapperInstalled())).toBe(true)
  await page.click('#fresh-frame')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(CLICKFIX_COMMAND)
  await page.waitForTimeout(2500)
  expect(await warningShowing(page)).toBe(false)
})

test('a familiar site writing to the clipboard raises no warning', async ({ page, context }) => {
  await waitForAutoImport(context)
  await seedVisits(context, SITE_HOST, 42, { activeDays: 12, firstSeen: Date.now() - 30 * DAY })
  await openClickFix(page, context)
  await page.click('#write-text')
  await expectNoWarning(page)
})

test('a site whose warnings were silenced raises no warning', async ({ page, context }) => {
  await waitForAutoImport(context)
  await inWorker(context, async (host: string) => {
    await chrome.storage.local.set({ [host]: { count: 1, firstSeen: Date.now(), lastSeen: 1, activeDays: 1, ignored: true } })
  }, SITE_HOST)
  await openClickFix(page, context)
  await page.click('#write-text')
  await expectNoWarning(page)
})

test('with the copy warning switched off, a write raises nothing', async ({ page, context }) => {
  await patchSettings(context, { showCopyWarning: false })
  await openClickFix(page, context)
  await page.click('#write-text')
  await expectNoWarning(page)
})

test('a page that steals the channel node cannot swallow the signal on it', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#steal-channel')
  await expectWarning(page)
  // And it never got the node: the wrapper stops answering once the content
  // script has it, so a page cannot fake a write on it to spend the warning
  expect(await page.evaluate(() => (window as any).__stoleNode ?? false)).toBe(false)
})

test('a frame\'s wrapper borrowed by the page, frame removed after the write, still warns', async ({ page, context }) => {
  // Only the frame hears this write, and the page takes the frame away as soon
  // as the write is done. Nobody touched the frame, so it has no verdict yet.
  await openClickFix(page, context)
  await page.click('#borrow-then-remove')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(CLICKFIX_COMMAND)
  await expectWarning(page)
})

test('a frame\'s wrapper borrowed by the page, frame removed at once, still warns', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#borrow-remove-now')
  // The write outlives its frame, which is what makes this worth warning about
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(CLICKFIX_COMMAND)
  await expectWarning(page)
})

test('a write from inside a blob frame raises the warning about the page', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.frameLocator('#blob').locator('#blob-write').click()
  await expectWarning(page)
})

/** The cross in the warning's corner. The panel lives in a closed shadow root, so it is found by where it is drawn. */
async function closeWarning(page: any) {
  // The panel slides in, and a click during that lands beside the button
  await page.waitForTimeout(1000)
  const { width } = page.viewportSize()
  await page.mouse.click(width - 55, 48)
}

test('made-up events spend no warning, and the real ones still get theirs', async ({ page, context }) => {
  // A page can dispatch keydown, beforeinput, paste, copy and cut of its own.
  // None of them types or copies anything, and each used to use up the one
  // warning the page had, before the password was typed.
  await openClickFix(page, context)
  await page.click('#synthetic')
  expect(await page.evaluate(() => (window as any).__syntheticFired)).toBe(true)
  await page.waitForTimeout(2000)
  expect(await warningShowing(page)).toBe(false)

  await page.click('#field')
  await page.keyboard.type('hunter2')
  await expectWarning(page)
})

test('a copy warning does not use up the typing warning', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#write-text')
  await expectWarning(page)
  await closeWarning(page)
  await expect.poll(() => warningShowing(page), { timeout: 5000 }).toBe(false)

  await page.click('#field')
  await page.keyboard.type('hunter2')
  await expectWarning(page)
})

test('after document.open() typing is still warned about', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#reopen')
  await page.waitForTimeout(500)
  await page.click('#after-field')
  await page.keyboard.type('hunter2')
  await expectWarning(page)
})

test('after document.open() a copy is still warned about', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#reopen')
  await page.waitForTimeout(500)
  await page.click('#after-copy')
  await expectWarning(page)
})

test('a warning on screen through document.open() still closes', async ({ page, context }) => {
  // Everything in the document loses its listeners, our panel's buttons too,
  // so the panel is built again rather than put back
  await openClickFix(page, context)
  await page.click('#write-text')
  await expectWarning(page)
  // The page reopens itself, as a script would, while the warning is up
  await page.evaluate(() => document.getElementById('reopen')!.click())
  await page.waitForTimeout(1000)
  await expectWarning(page)
  await closeWarning(page)
  await expect.poll(() => warningShowing(page), { timeout: 5000 }).toBe(false)
})

test('typing into a blank frame the page rewrote is warned about', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#frame-reopen')
  await page.waitForTimeout(500)
  await page.frameLocator('#opened').locator('#opened-field').click()
  await page.keyboard.type('hunter2')
  await expectWarning(page)
})

test('a made-up copy spends no copy warning', async ({ page, context }) => {
  await openClickFix(page, context)
  await page.click('#synthetic')
  await page.waitForTimeout(1500)
  expect(await warningShowing(page)).toBe(false)
  await page.click('#exec-copy')
  await expectWarning(page)
})

test('a page that keeps swapping its root still gets its UI back', async ({ page, context }) => {
  // Each swap takes the UI down and builds it again, and a swap that lands while
  // the last rebuild is still loading its stylesheet used to leave no UI at all
  await openClickFix(page, context)
  await page.evaluate(() => document.getElementById('swap-root')!.click())
  await expect.poll(() => page.evaluate(() => (window as any).__swapsDone === true), { timeout: 10000 }).toBe(true)
  await page.waitForTimeout(1500)
  await page.click('#write-text')
  await expectWarning(page)
  await closeWarning(page)
  await expect.poll(() => warningShowing(page), { timeout: 5000 }).toBe(false)
})

test('typing in a frame turned away under a copy warning is warned about once it closes', async ({ page, context }) => {
  // The top document keeps a copy warning on screen rather than rewrite it, and
  // tells the frame to ask again. The frame used to take the first refusal as
  // final, and the password typed after the copy warning closed went unwarned.
  await openClickFix(page, context)
  await page.click('#write-text')
  await expectWarning(page)
  const input = page.frameLocator('#blob').locator('#blob-input')
  await input.click()
  await page.keyboard.type('hun')
  await page.waitForTimeout(1000)
  await closeWarning(page)
  await expect.poll(() => warningShowing(page), { timeout: 5000 }).toBe(false)
  await input.click()
  await page.keyboard.type('ter2')
  await expectWarning(page)
})
