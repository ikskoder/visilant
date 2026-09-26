import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { blankPage, inWorker, serveSite } from './helpers'

// Evaluated inside the extension's service worker
declare const chrome: any

/**
 * "Check link safety" from the context menu.
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

/**
 * Every piece of text on the page, closed shadow roots included.
 *
 * The in-page interface lives in a closed shadow root in a production build,
 * which is what the suite runs against, and no locator reaches into one. The
 * DevTools protocol does, so the dialog is read the way the inspector reads it.
 */
async function allText(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const parts: string[] = []
    const walk = (node: any) => {
      if (node.nodeType === 3 && node.nodeValue)
        parts.push(node.nodeValue)
      for (const child of node.children ?? [])
        walk(child)
      for (const child of node.shadowRoots ?? [])
        walk(child)
    }
    walk(root)
    return parts.join(' ')
  }
  finally {
    await cdp.detach()
  }
}

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

/** The dialog is up – waited on first, so that "no table" is never read off a page with no dialog on it. */
async function dialogText(page: Page): Promise<string> {
  await expect.poll(() => allText(page), { timeout: 15000, intervals: [300] }).toContain('Unfamiliar site ahead')
  return allText(page)
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

// Both used to leave the menu item doing nothing at all: a mailto link has no
// host for the dialog, and a link on the same site was dropped as not external
test('the menu check on a mailto link checks the address', async ({ page, context }) => {
  await open(page)
  const href = await page.locator('#mail').evaluate((a: HTMLAnchorElement) => a.href)

  await rightClick(page, '#mail')
  await checkFromMenu(context, href)

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
