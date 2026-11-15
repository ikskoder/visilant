import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { allText, blankPage, clickInDialog, inWorker, patchSettings, serveSite } from './helpers'

// Evaluated inside the extension's service worker
declare const chrome: any

/**
 * "Check this link" from the context menu.
 *
 * No automation tool can open the browser's own menu, so each test does the two
 * halves separately: a real right-click on the link, which is what the page and
 * the content script see, and then the message the menu item sends, with the
 * address the browser would have put in it.
 */

const SITE_HOST = 'mail.visilant-menu.test'
const SITE_URL = `https://${SITE_HOST}/`

const PAGE = blankPage('Inbox', `
  <p><a id="fake" href="https://yourbank-secure-login.test/verify">https://www.yourbank.test/signin</a></p>
  <p><a id="plain" href="https://elsewhere.test/">Read more</a></p>
  <p><a id="shifty" href="https://yourbank-secure-login.test/verify">https://www.yourbank.test/signin</a></p>
  <p><a id="mail" href="mailto:billing@yourmial.test">Write to billing</a></p>
  <p><a id="inside" href="/settings">Settings</a></p>
  <script>
    // A page that tidies the text up the moment the link is pressed, before the
    // menu event is even sent – too late for a snapshot taken on the press
    document.getElementById('shifty').addEventListener('pointerdown', (event) => {
      event.currentTarget.textContent = 'yourbank-secure-login.test'
    })
  </script>
`)

async function rightClick(page: Page, selector: string) {
  await page.locator(selector).click({ button: 'right' })
  // Headless draws no menu, and a headed run has one to put away
  await page.keyboard.press('Escape')
}

/** What the menu item sends, as the background sends it. */
async function checkFromMenu(context: any, url: string, frameId = 0) {
  await inWorker(context, async ({ host, target, frame }: any) => {
    const [tab] = await chrome.tabs.query({ url: `*://${host}/*` })
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'show-link-intercept', data: { url: target, frameId: frame } }, { frameId: 0 })
    }
    catch {
      // The content script does not answer this one
    }
  }, { host: SITE_HOST, target: url, frame: frameId })
}

/**
 * The dialog is up – waited on first, so that "no table" is never read off a page with no dialog on it.
 *
 * Asked for from the menu, so it is a check and reads as one: nobody clicked
 * the link, and it used to speak of a site "ahead" and of continuing "anyway".
 */
async function dialogText(page: Page): Promise<string> {
  await expect.poll(() => allText(page), { timeout: 15000, intervals: [300] }).toContain('Link check')
  const text = await allText(page)
  expect(text).toContain('Open in new tab')
  expect(text).not.toContain('Unfamiliar site ahead')
  expect(text).not.toContain('Open anyway')
  expect(text).not.toContain('Don\'t open')
  return text
}

async function open(page: Page) {
  await serveSite(page, SITE_URL, PAGE)
  // The content script mounts at document_start but settles after load
  await page.waitForTimeout(1500)
}

test('the menu check shows what the link text claimed', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#fake').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#fake')
  await checkFromMenu(context, href)

  const text = await dialogText(page)
  expect(text).toContain('Leads to')
  expect(text).toContain('yourbank.test')
})

// The right-click is on the link whose text names a different site, and the
// check is for another link. Borrowing the first link's words would draw a table
// claiming the second one says yourbank.test.
test('a menu opened on one link never borrows the words of another', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#plain').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#fake')
  await checkFromMenu(context, href)

  const text = await dialogText(page)
  expect(text).not.toContain('Leads to')
})

test('the words are the ones the link wore when it was pressed', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#shifty').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#shifty')
  // The page's handler has run by now and the link reads harmlessly
  await expect(page.locator('#shifty')).toHaveText('yourbank-secure-login.test')
  await checkFromMenu(context, href)

  const text = await dialogText(page)
  expect(text).toContain('Leads to')
})

// A link in a frame was right-clicked where the top document heard nothing,
// so whatever it remembers is about some earlier click
test('a link in a frame gets no words from the top document', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#fake').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#fake')
  await checkFromMenu(context, href, 3)

  const text = await dialogText(page)
  expect(text).not.toContain('Leads to')
})

// A link to a page and a link that writes a mail have an item each, offered
// by where the link points. An item whose pattern the browser refused is not
// created at all, and `update` on an id that is not there reports an error,
// which is the one way to ask whether an item exists.
test('the menu has an item for page links and one for mail links', async ({ context }) => {
  const exists = (id: string) => inWorker<boolean>(context, (item: string) => new Promise<boolean>((resolve) => {
    chrome.contextMenus.update(item, {}, () => resolve(!chrome.runtime.lastError))
  }), id)

  // Each waited for: the menu is rebuilt whenever the settings change, and
  // for a moment in the middle of that an item made earlier is not there
  const there = (id: string) => expect.poll(() => exists(id), { timeout: 15000, intervals: [300] }).toBe(true)
  await there('visilant-check-mail-link')
  await there('visilant-check-link-safety')
  await there('visilant-check-domain')
  // The details of a mail link are its own item, named for an address
  await there('visilant-mail-details')
  // CONTROL: the question does tell an item from none
  expect(await exists('visilant-no-such-item')).toBe(false)
})

// Both used to leave the menu item doing nothing at all: a mailto link has no
// host for the dialog, and a link on the same site was dropped as not external
test('the menu check on a mailto link checks the address', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#mail').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#mail')
  await checkFromMenu(context, href)

  await expect.poll(() => allText(page), { timeout: 15000, intervals: [300] }).toContain('Email address')
})

// The page about a domain alone had no address on it. The details of an email
// address are the check page with the link in it, handed over out of sight:
// the tab's address stays in the browser's history, and names nobody
test('the details of an email address open the check page with the address in it', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#mail').evaluate((a: HTMLAnchorElement) => a.href)
  await checkFromMenu(context, href)
  await expect.poll(() => allText(page), { timeout: 15000, intervals: [300] }).toContain('Address details')

  const opened = context.waitForEvent('page')
  await clickInDialog(page, 'details')
  const details = await opened
  await details.waitForLoadState()

  expect(details.url()).toContain('check=1')
  expect(details.url()).not.toContain('billing')
  expect(details.url()).not.toContain('yourmial')
  await expect(details.locator('[data-check-field]')).toContainText('Email address', { timeout: 10000 })
  await expect(details.locator('[data-domain-panel] .popup-address .vz-addr__acct')).toContainText('billing')
  await expect(details.locator('[data-domain-panel] .popup-address')).toContainText('yourmial')
  // A reload keeps what was handed over
  await details.reload()
  await expect(details.locator('[data-domain-panel] .popup-address')).toContainText('yourmial', { timeout: 10000 })
})

// Somebody asked, so something answers: a mail link with no address in it
// used to end with nothing on the screen at all
test('the menu check on a mail link with no address shows what the link holds', async ({ page, context }) => {
  await open(page)
  await checkFromMenu(context, 'mailto:?subject=Hello')

  await expect.poll(() => allText(page), { timeout: 15000, intervals: [300] }).toContain('mailto:?subject=Hello')
})

// The click trigger cancelled the click and then dropped the answer, because
// the tooltip waited for a hover that this trigger never has. On a touchscreen
// that is the only trigger, so a tapped mailto did nothing at all.
test('a click on a mailto link with the click trigger shows the address', async ({ page, context }) => {
  await patchSettings(context, {
    linkSafety: { enabled: true, tooltipTrigger: 'click-right', intercept: { unfamiliar: true, shortLinks: true, redFlags: true, minRedFlags: 1 }, hoverDelay: 1500, showVisitCount: 'always', shortUrlMode: 'off', shortUrlShowFullUrl: false, shortUrlTraceChain: false, shortUrlResolveAny: false, shortUrlListUpdateUrl: '', scopeMode: 'everywhere', scopeDomains: '' },
  })
  await open(page)

  await page.locator('#mail').click()

  await expect.poll(() => allText(page), { timeout: 15000, intervals: [300] }).toContain('Email address')
})

test('the menu check on a link within the site still answers', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#inside').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#inside')
  await checkFromMenu(context, href)

  const text = await dialogText(page)
  expect(text).not.toContain('Leads to')
})

// The dialog measures where a long address broke its lines, and marks them.
// Done inside the size observer's own callback, the mark's room changed the
// size being observed, which a browser reports as an error on the window: in
// a web page that is the page's window, its error tracker and all.
test('a long address in the dialog raises no error on the page', async ({ page, context }) => {
  await open(page)
  await page.evaluate(() => {
    ;(window as any).__errors = []
    window.addEventListener('error', event => (window as any).__errors.push(String(event.message)))
  })
  const long = `https://this-is-a-very-long-label-that-goes-on.another-long-label-that-goes-on-and-on.and-one-more-label-to-fill-the-line.evil.test/`
  await checkFromMenu(context, long)
  const text = await dialogText(page)
  // Longer than a line of the dialog, so it has to break
  expect(text).toContain('another-long-label-that-goes-on-and-on')
  await page.setViewportSize({ width: 700, height: 800 })
  await page.waitForTimeout(500)
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as any).__errors)).toEqual([])
})
