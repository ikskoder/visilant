/**
 * The paste guard, driven through the real clipboard.
 *
 * A production build puts the dialog inside a closed shadow root, so nothing
 * here reaches into it. Two things are observable from the page and they happen
 * to be the two that matter: whether the payload arrived in the field, and
 * whether something of ours is covering the page.
 */
import { expect, test } from './fixtures'
import { blankPage, patchSettings, serveSite, sw } from './helpers'

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
  const worker = await sw(context)
  await worker.evaluate(async (host: string) => {
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
  expect(await overlayShowing(page)).toBe(true)
})

test('refusing the paste does not let the next one through', async ({ context }) => {
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  const page = await openSite(context)
  await pasteInto(page, '#victim')
  expect(await overlayShowing(page)).toBe(true)

  // Refused by clicking away from the card, which is centred and at most 420px
  // wide, so the corner is always backdrop
  await page.mouse.click(8, 8)
  await page.waitForTimeout(700)
  expect(await overlayShowing(page)).toBe(false)
  await expect(page.locator('#victim')).toHaveValue('')

  // Saying no is about this paste, not about the site
  await pasteInto(page, '#victim')
  await expect(page.locator('#victim')).toHaveValue('')
  expect(await overlayShowing(page)).toBe(true)
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
