/**
 * A click on a link inside a frame is held on the same rules as one in the page.
 *
 * Events do not leave a frame, so a phishing link in a mail body served in an
 * iframe used to go past every check. The frame guard sends the link up, the
 * top document judges it and draws the dialog, and the frame follows it.
 */
import { expect, test } from './fixtures'
import { allText, blankPage, inWorker, patchSettings, serveSite } from './helpers'

declare const chrome: any

const SITE_URL = 'https://mail-page.test/'
const FLAGGED = 'https://paypal.com@plain-new-site.test/landed'

/** Everything but the page itself answers, so a navigation shows. */
async function landEverywhere(page: any) {
  await page.context().route(/^https:\/\/(?!mail-page\.test|widget\.test).*/, (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('landed') }))
}

function framePage(frame: string) {
  return blankPage('mail', `<div style="position:fixed;top:40px;left:40px">${frame}</div>`)
}

const LINK_STYLE = 'display:block;font-size:20px;padding:10px'

/** A mail body as webmail draws it: a sandboxed frame on the page's own origin. */
function mailBody(link: string) {
  return `<iframe id="f" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" style="width:500px;height:120px" srcdoc="${link.replace(/"/g, '&quot;')}"></iframe>`
}

async function openWithWidget(page: any, widget: string) {
  await landEverywhere(page)
  await page.context().route(/^https:\/\/widget\.test\//, (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('widget', widget) }))
  await serveSite(page, SITE_URL, framePage('<iframe id="f" src="https://widget.test/" style="width:500px;height:120px"></iframe>'))
  await page.waitForTimeout(2000)
}

async function tabsTo(context: any, host: string) {
  const tabs = await inWorker<{ url: string, pendingUrl?: string }[]>(context, async () =>
    (await chrome.tabs.query({})).map((tab: any) => ({ url: tab.url, pendingUrl: tab.pendingUrl })))
  return tabs.filter(tab => (tab.pendingUrl || tab.url).includes(host)).length
}

function frameUrl(page: any) {
  return page.frames().find((frame: any) => frame !== page.mainFrame())?.url() ?? ''
}

test('a flagged link in a mail body opens its tab after "Continue anyway"', async ({ page, context }) => {
  await landEverywhere(page)
  await serveSite(page, SITE_URL, framePage(mailBody(`<a id="l" href="${FLAGGED}" target="_blank" style="${LINK_STYLE}">Log in</a>`)))
  await page.waitForTimeout(2000)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 8000, intervals: [300] }).toContain('Red flags in this link')
  expect(await tabsTo(context, 'plain-new-site.test')).toBe(0)

  await page.waitForTimeout(700)
  await clickInDialog(page, 'continue')
  await expect.poll(() => tabsTo(context, 'plain-new-site.test'), { timeout: 5000 }).toBe(1)
  expect(page.url()).toBe(SITE_URL)
})

test('"Go back" leaves a flagged link in a frame unopened', async ({ page, context }) => {
  await landEverywhere(page)
  await serveSite(page, SITE_URL, framePage(mailBody(`<a id="l" href="${FLAGGED}" target="_blank" style="${LINK_STYLE}">Log in</a>`)))
  await page.waitForTimeout(2000)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 8000, intervals: [300] }).toContain('Red flags in this link')
  await clickInDialog(page, 'back')
  await page.waitForTimeout(1500)
  expect(await tabsTo(context, 'plain-new-site.test')).toBe(0)
  expect(page.url()).toBe(SITE_URL)
})

test('a link with no red flag in a frame opens untouched', async ({ page, context }) => {
  await landEverywhere(page)
  await serveSite(page, SITE_URL, framePage(mailBody(`<a id="l" href="https://plain-new-site.test/landed" target="_blank" style="${LINK_STYLE}">A new site</a>`)))
  await page.waitForTimeout(2000)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => tabsTo(context, 'plain-new-site.test'), { timeout: 5000 }).toBe(1)
})

// The frame can navigate itself without a press of its own. Flagged by a
// well-known name inside the address: Chrome refuses to load an address with a
// name before @ in a frame at all.
test('a flagged link in a frame from another site that opens in the frame is followed there', async ({ page }) => {
  await openWithWidget(page, `<a id="l" href="https://paypal.com.plain-new-site.test/landed" style="${LINK_STYLE}">Log in</a>`)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 8000, intervals: [300] }).toContain('Red flags in this link')
  await page.waitForTimeout(700)
  await clickInDialog(page, 'continue')
  await expect.poll(() => frameUrl(page), { timeout: 5000 }).toContain('plain-new-site.test')
  expect(page.url()).toBe(SITE_URL)
})

// A frame from another site has no press left after the dialog, and Visilant
// does not open the window in its place: its sandbox may forbid that
test('a flagged link in a frame from another site that opens the page is let through for one more click', async ({ page }) => {
  await openWithWidget(page, `<a id="l" href="${FLAGGED}" target="_top" style="${LINK_STYLE}">Log in</a>`)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 8000, intervals: [300] }).toContain('click the link again')
  await page.waitForTimeout(700)
  await clickInDialog(page, 'continue')
  await page.waitForTimeout(500)
  expect(page.url()).toBe(SITE_URL)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => page.url(), { timeout: 5000 }).toContain('plain-new-site.test')
})

// A widget's own pages are never familiar, since visits are counted for whole
// pages, so holding them would stop every click in every embedded map
test('a link inside a widget to the widget\'s own site is not held, with "unfamiliar" ticked', async ({ page, context }) => {
  await patchSettings(context, { linkSafety: { enabled: true, intercept: { unfamiliar: true, shortLinks: true, shortLinksOnOwnSite: true, redFlags: true, minRedFlags: 1 } } })
  await openWithWidget(page, `<a id="l" href="https://widget.test/page-2" style="${LINK_STYLE}">Next page</a>`)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => frameUrl(page), { timeout: 5000 }).toContain('widget.test/page-2')
})

// A link to the webmail itself says nothing about the page as a whole, and
// used to switch the hold off for every link in the frame after it
test('reaching for a link to the page\'s own site does not stop the hold on the next link', async ({ page }) => {
  await landEverywhere(page)
  const small = 'display:inline-block;font-size:20px;padding:4px'
  await serveSite(page, SITE_URL, framePage(mailBody(`<a id="own" href="https://mail-page.test/inbox" style="${small}">Inbox</a> <a id="l" href="${FLAGGED}" target="_blank" style="${small}">Log in</a>`)))
  await page.waitForTimeout(2000)

  // A press on the frame's empty part, then Tab onto the link: it is asked about
  // on focus without being followed. A press dragged off a link would start
  // dragging it instead.
  // The frame sits at 40,40 and is 500 by 120
  await page.mouse.click(490, 140)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(1000)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 8000, intervals: [300] }).toContain('Red flags in this link')
})

// A mail body that opens every link in a new window says so once, in <base>
test('a frame from another site that opens links through <base target> asks for a second click', async ({ page }) => {
  await openWithWidget(page, `<base target="_blank"><a id="l" href="https://paypal.com.plain-new-site.test/landed" style="${LINK_STYLE}">Log in</a>`)

  await page.frameLocator('#f').locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 8000, intervals: [300] }).toContain('click the link again')
})

/** Press a dialog button by its `data-action`, through the closed shadow root. */
async function clickInDialog(page: any, action: string) {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    let found: number | null = null
    const walk = (node: any) => {
      const attributes: string[] = node.attributes ?? []
      for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] === 'data-action' && attributes[i + 1] === action)
          found = node.backendNodeId
      }
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
        walk(child)
    }
    walk(root)
    if (found === null)
      throw new Error(`no button with data-action="${action}"`)
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: found })
    const [x1, y1, , , x3, y3] = model.content
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2)
  }
  finally {
    await cdp.detach()
  }
}
