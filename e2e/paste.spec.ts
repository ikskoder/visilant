/**
 * The paste guard, driven through the real clipboard.
 *
 * A production build puts the dialog inside a closed shadow root, so nothing
 * here reaches into it. Two things are observable from the page and they happen
 * to be the two that matter: whether the payload arrived in the field, and
 * whether something of ours is covering the page.
 */
import { expect, test } from './fixtures'
import { blankPage, inWorker, patchSettings, serveSite } from './helpers'

// Evaluated inside the extension's service worker, where the MV3 API lives
declare const chrome: any

const SITE_URL = 'https://paste-poc.test/'
const SITE_ORIGIN = 'https://paste-poc.test'
const SITE_HOST = 'paste-poc.test'
const SECRET = 'correct-horse-battery-staple'

// Fields sit well away from the top-left corner, which is where the overlay is
// probed for. Anything of the page's own up there would read as our dialog.
const SITE_HTML = blankPage('paste poc', `
  <div style="height:300px"></div>
  <input id="victim" type="text" style="width:320px">
  <input id="locked" type="text" readonly style="width:320px">
`)

/** Pre-seed the visit record so the site arrives already marked as ignored. */
async function markIgnored(context: any, hostname: string) {
  await inWorker(context, async (host: string) => {
    await chrome.storage.local.set({ [host]: { count: 1, firstSeen: 0, lastSeen: 0, activeDays: 1, ignored: true } })
  }, hostname)
}

async function openSite(context: any) {
  const page = await context.newPage()
  await serveSite(page, SITE_URL, SITE_HTML)
  // The content script mounts after fetching its stylesheet, and the guard only
  // answers once the safety check has come back from the background
  await page.waitForTimeout(2500)
  await page.evaluate((text: string) => navigator.clipboard.writeText(text), SECRET)
  return page
}

async function pasteInto(page: any, selector: string) {
  await page.focus(selector)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForTimeout(1200)
}

/**
 * Is something of ours on screen over the page?
 *
 * Hit testing retargets to the shadow host, so the answer is the container's
 * own inline max z-index. The host itself takes no pointer events, which means
 * only a dialog that spans the viewport ever answers here – the input warning
 * sits in the top right corner and is not in the way.
 */
/**
 * The same question, waited on.
 *
 * The dialog goes up only once the background has answered whether the site is
 * familiar, so a single read a fixed pause after the keypress is a race that a
 * loaded machine loses. Absence is still read once, because there a fixed pause
 * followed by one look is exactly the assertion being made.
 */
async function expectOverlay(page: any) {
  await expect.poll(() => overlayShowing(page), { timeout: 15000, intervals: [200] }).toBe(true)
}

/**
 * Waited on too, because this asks whether a dialog that was up has gone.
 *
 * Not the same question as the control test's, which asks whether one ever
 * appeared – that one is a fixed pause and a single look on purpose, and
 * polling it would answer yes the instant it started.
 */
async function expectOverlayGone(page: any) {
  await expect.poll(() => overlayShowing(page), { timeout: 5000, intervals: [200] }).toBe(false)
}

function overlayShowing(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.elementFromPoint(8, 8) as HTMLElement | null
    return Boolean(el?.style && el.style.getPropertyValue('z-index') === '2147483647')
  })
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN })
})

test('CONTROL: with the guard off, a paste lands in the field', async ({ context }) => {
  // Off is the default. If the payload does not arrive here the probe is broken
  // and every held paste below proves nothing.
  const page = await openSite(context)
  await pasteInto(page, '#victim')

  await expect(page.locator('#victim')).toHaveValue(SECRET)
  expect(await overlayShowing(page)).toBe(false)
})

test('a paste on an unfamiliar site is held back', async ({ context }) => {
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  const page = await openSite(context)
  await pasteInto(page, '#victim')

  await expect(page.locator('#victim')).toHaveValue('')
  await expectOverlay(page)
})

test('refusing the paste does not let the next one through', async ({ context }) => {
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  const page = await openSite(context)
  await pasteInto(page, '#victim')
  await expectOverlay(page)

  // Refused by clicking away from the card, which is centred and at most 420px
  // wide, so the corner is always backdrop
  await page.mouse.click(8, 8)
  await expectOverlayGone(page)
  await expect(page.locator('#victim')).toHaveValue('')

  // Saying no is about this paste, not about the site
  await pasteInto(page, '#victim')
  await expect(page.locator('#victim')).toHaveValue('')
  await expectOverlay(page)
})

test('a paste into a read-only field is not held', async ({ context }) => {
  // Nothing can be typed there, so there is nothing to protect and no reason to
  // interrupt
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  const page = await openSite(context)
  await pasteInto(page, '#locked')

  expect(await overlayShowing(page)).toBe(false)
})

test('a paste on a site the user has ignored is not held', async ({ context }) => {
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  await markIgnored(context, SITE_HOST)
  const page = await openSite(context)
  await pasteInto(page, '#victim')

  await expect(page.locator('#victim')).toHaveValue(SECRET)
  expect(await overlayShowing(page)).toBe(false)
})

test('the guard can be turned on from the options page', async ({ context, extensionId }) => {
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await options.waitForTimeout(1500)

  // The label and the switch are siblings, so the row is what ties them together
  const toggle = options.locator('div.flex.items-start.justify-between')
    .filter({ hasText: 'Hold pastes on unfamiliar sites' })
    .locator('input[type="checkbox"]')
    .first()
  await expect(toggle).not.toBeChecked()
  await toggle.check({ force: true })
  await options.waitForTimeout(700)

  const page = await openSite(context)
  await pasteInto(page, '#victim')
  await expect(page.locator('#victim')).toHaveValue('')
})

test('a second paste while the dialog is up does not slip through', async ({ context }) => {
  // The dialog owns one resolver. A second paste used to overwrite it, which
  // both stranded the first paste and, for the moment in between, was a paste
  // the guard was no longer watching.
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  const page = await openSite(context)
  await pasteInto(page, '#victim')
  await expectOverlay(page)

  // Straight into the field behind the dialog
  await page.evaluate(() => (document.querySelector('#victim') as HTMLInputElement).focus())
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForTimeout(800)

  await expect(page.locator('#victim')).toHaveValue('')
  await expectOverlay(page)
})

test('a paste made before the verdict lands is held and then explained', async ({ context }) => {
  // No wait after the navigation: the page is there, the verdict is not. This
  // used to be the hole in the guard – a strict `false` was asked for, `null`
  // was found, and the paste went in.
  await patchSettings(context, { blockPasteOnUnfamiliar: true })

  const page = await context.newPage()
  await page.route(`${SITE_URL}**`, (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: SITE_HTML }))
  // Loaded and pasted into without ever giving the check time to come back
  await page.goto(SITE_URL)
  await page.evaluate((text: string) => navigator.clipboard.writeText(text), SECRET)
  await page.focus('#victim')
  await page.keyboard.press('ControlOrMeta+V')

  // Whatever the verdict turns out to be, nothing was inserted behind the user's
  // back and the dialog is there to say so
  await expectOverlay(page)
  await expect(page.locator('#victim')).toHaveValue('')
})
