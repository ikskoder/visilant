/**
 * Tamper detection, driven the way a hostile page would drive it.
 *
 * The page finds the container the same way an attacker would, by its inline
 * max z-index, and then tries to get rid of the panel. The first test is the
 * control: if removal does not raise the alarm, the probe below is broken and
 * the rest of the file proves nothing.
 */
import { expect, test } from './fixtures'
import { blankPage, inWorker, serveSite } from './helpers'

// Evaluated inside the extension's service worker, where the MV3 API lives
declare const chrome: any

const HOSTILE_URL = 'https://tamper-poc.test/'

const HOSTILE_HTML = blankPage('PoC', '<h1>hostile page</h1><input id="victim" type="text">')

/** The extension marks its container with the maximum z-index, inline. */
const FIND_CONTAINER = `
  Array.from(document.body.children).find(
    el => el.style && el.style.getPropertyValue('z-index') === '2147483647',
  )`

async function openHostilePage(context: any) {
  const page = await context.newPage()
  await serveSite(page, HOSTILE_URL, HOSTILE_HTML)
  // The content script mounts after fetching its stylesheet
  await page.waitForFunction(`Boolean(${FIND_CONTAINER})`, null, { timeout: 10000 })
  return page
}

/**
 * handleTampering() in the background paints the badge with !!!
 *
 * The tab is found by its address rather than by being the active one. A whole
 * suite run leaves other pages open, and the badge of whichever tab happened to
 * have focus says nothing about this one – which is how this file used to fail
 * once in a full run and pass on its own.
 */
async function alarmRaised(context: any) {
  return inWorker(context, async (url: string) => {
    const tabs = await chrome.tabs.query({ url })
    if (!tabs[0]?.id)
      return 'no-tab'
    return chrome.action.getBadgeText({ tabId: tabs[0].id })
  }, `${HOSTILE_URL}*`)
}

async function attack(page: any, script: string, settleFirst = 1500) {
  // The Vue app finishes mounting a moment after the container appears
  await page.waitForTimeout(settleFirst)
  await page.evaluate(`(() => { const el = ${FIND_CONTAINER}; ${script} })()`)
}

/**
 * Is a panel of ours actually on screen?
 *
 * The shadow root is closed in a production build, so hit testing is what there
 * is: it retargets to the host, which is the only element on the page carrying
 * the maximum z-index inline. The input warning sits in the top right corner.
 */
function panelShowing(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth - 24, 24) as HTMLElement | null
    return Boolean(el?.style && el.style.getPropertyValue('z-index') === '2147483647')
  })
}

/** Has the background finished with this tab? Its badge is the visible sign. */
async function badgeSettled(context: any) {
  return (await alarmRaised(context)) !== ''
}

test('CONTROL: removing the container raises the alarm', async ({ context }) => {
  const page = await openHostilePage(context)
  await attack(page, 'el.remove()')

  await expect.poll(() => alarmRaised(context), { timeout: 5000 }).toBe('!!!')
})

test('removing the container the instant it appears raises the alarm', async ({ context }) => {
  const page = await openHostilePage(context)
  // No settling time: the watch used to keep quiet until the Vue app had
  // finished mounting, which handed a fast page a window to strip it silently
  await attack(page, 'el.remove()', 0)

  await expect.poll(() => alarmRaised(context), { timeout: 5000 }).toBe('!!!')
})

test('hiding the container through its style attribute raises the alarm', async ({ context }) => {
  const page = await openHostilePage(context)
  // Inline !important beats any author stylesheet, so a page that wants the
  // panel gone edits the attribute itself and removes nothing
  await attack(page, `el.setAttribute('style', 'display: none !important')`)

  await expect.poll(() => alarmRaised(context), { timeout: 5000 }).toBe('!!!')
})

test('stripping the container style attribute raises the alarm', async ({ context }) => {
  const page = await openHostilePage(context)
  await attack(page, `el.removeAttribute('style')`)

  await expect.poll(() => alarmRaised(context), { timeout: 5000 }).toBe('!!!')
})

test('replacing document.body raises the alarm', async ({ context }) => {
  const page = await openHostilePage(context)
  // The container leaves the screen inside the old body, so no removal is ever
  // recorded on the node the watch is attached to
  await attack(page, 'document.documentElement.replaceChild(document.createElement(\'body\'), document.body)')

  await expect.poll(() => alarmRaised(context), { timeout: 5000 }).toBe('!!!')
})

test('covering the panel with an overlay raises the alarm', async ({ context }) => {
  const page = await openHostilePage(context)

  // Typing is only answered once the background has said how familiar the site
  // is, and the badge is the visible end of that same round trip
  await expect.poll(() => badgeSettled(context), { timeout: 15000 }).toBe(true)

  // The cover only matters while something of ours is on screen, so bring the
  // warning up first the way a user would, by typing on an unfamiliar site
  await page.click('#victim')
  await page.keyboard.type('hunter2')

  // Waited for rather than assumed: on a loaded machine the panel can take
  // seconds, and covering nothing proves nothing
  await expect.poll(() => panelShowing(page), { timeout: 15000 }).toBe(true)

  // Our z-index is already the maximum, so a later sibling holding the same
  // value paints above us
  await attack(page, `
    const cover = document.createElement('div')
    cover.setAttribute('style', 'position: fixed; inset: 0; z-index: 2147483647; background: #fff')
    document.body.appendChild(cover)
  `, 0)

  await expect.poll(() => alarmRaised(context), { timeout: 8000 }).toBe('!!!')
})
