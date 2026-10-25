/**
 * Which clicks on a link are held, on the shipped settings and on others.
 *
 * Friction only where there is a reason: a red flag in the link, a short link,
 * or, when the user ticks it, an unfamiliar site. A link with none of these is
 * not even cancelled, so it behaves exactly like a link.
 */
import { expect, test } from './fixtures'
import { allText, blankPage, inWorker, patchSettings, seedVisits, serveSite } from './helpers'

declare const chrome: any

const SITE_URL = 'https://link-page.test/'

/** A page of links, each pinned where a click can reach it. */
function linksPage(links: string) {
  return blankPage('links', `<div style="position:fixed;top:40px;left:40px;display:grid;gap:24px;font-size:20px;z-index:9999">${links}</div>`)
}

/** Every link on these pages goes somewhere that answers, so a navigation shows. */
async function landEverywhere(page: any) {
  await page.context().route(/^https:\/\/(?!link-page\.test).*/, (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('landed') }))
}

async function open(page: any, links: string) {
  await landEverywhere(page)
  await serveSite(page, SITE_URL, linksPage(links))
  await page.waitForTimeout(2000)
}

test('an unfamiliar link with no red flag opens at once on the shipped settings', async ({ page }) => {
  await open(page, '<a id="l" href="https://plain-new-site.test/landed">A new site</a>')

  await page.locator('#l').click()

  await expect.poll(() => page.url(), { timeout: 5000 }).toContain('plain-new-site.test')
})

// A flag is a trick in the link, and a site the user knows does not play it
test('a link with a decoy name before @ is stopped even to a familiar site', async ({ page, context }) => {
  await seedVisits(context, 'known-bank.test', 60, { activeDays: 30 })
  await open(page, '<a id="l" href="https://paypal.com@known-bank.test/login">Log in</a>')

  await page.locator('#l').click()

  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Red flags in this link')
  expect(await allText(page)).toContain('1 red flag')
  expect(page.url()).toBe(SITE_URL)
})

test('a short link is stopped', async ({ page }) => {
  await open(page, '<a id="l" href="https://bit.ly/3xYz9Q">bit.ly/3xYz9Q</a>')

  await page.locator('#l').click()

  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Shortened link')
  expect(page.url()).toBe(SITE_URL)
})

test('with "unfamiliar site" ticked, an unfamiliar link is stopped and a familiar one is not', async ({ page, context }) => {
  await patchSettings(context, { linkSafety: { enabled: true, intercept: { unfamiliar: true, shortLinks: true, redFlags: true, minRedFlags: 1 } } })
  await seedVisits(context, 'well-known.test', 60, { activeDays: 30 })
  await open(page, `
    <a id="new" href="https://plain-new-site.test/landed">A new site</a>
    <a id="known" href="https://well-known.test/landed">A site I use</a>
  `)

  await page.locator('#new').click()
  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Unfamiliar site ahead')
  expect(page.url()).toBe(SITE_URL)
  await page.keyboard.press('Escape')

  await page.locator('#known').click()
  await expect.poll(() => page.url(), { timeout: 5000 }).toContain('well-known.test')
})

test('with every box cleared no link is stopped, a red flag included', async ({ page, context }) => {
  await patchSettings(context, { linkSafety: { enabled: true, intercept: { unfamiliar: false, shortLinks: false, redFlags: false, minRedFlags: 1 } } })
  await open(page, '<a id="l" href="https://paypal.com@plain-new-site.test/landed">Log in</a>')

  await page.locator('#l').click()

  await expect.poll(() => page.url(), { timeout: 5000 }).toContain('plain-new-site.test')
})

// The click is put back after the dialog, and a new tab must still open as one
test('a held link that opens a new tab still opens one after "Continue anyway"', async ({ page, context }) => {
  await open(page, '<a id="l" href="https://paypal.com@plain-new-site.test/landed" target="_blank">Log in</a>')

  await page.locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Red flags in this link')

  // The risk button ignores a press for its first half second
  await page.waitForTimeout(700)
  const opened = context.waitForEvent('page', { timeout: 5000 })
  await clickInDialog(page, 'continue')
  const tab = await opened
  await expect.poll(() => tab.url(), { timeout: 5000 }).toContain('plain-new-site.test')
  expect(page.url()).toBe(SITE_URL)
})

// A middle click is `auxclick`, and cancelling that is what keeps the tab from opening
test('a middle click on a flagged link is held, and opens its tab after "Continue anyway"', async ({ page, context }) => {
  await open(page, '<a id="l" href="https://paypal.com@plain-new-site.test/landed">Log in</a>')
  const before = context.pages().length

  await page.locator('#l').click({ button: 'middle' })
  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Red flags in this link')
  expect(context.pages().length).toBe(before)

  await page.waitForTimeout(700)
  await clickInDialog(page, 'continue')
  // Behind the page, as the browser opens a middle click
  await expect.poll(() => tabsTo(context, 'plain-new-site.test'), { timeout: 5000 }).toEqual([{ active: false }])
  expect(page.url()).toBe(SITE_URL)
})

test('a middle click on a link with no red flag opens its tab at once', async ({ page, context }) => {
  await open(page, '<a id="l" href="https://plain-new-site.test/landed">A new site</a>')

  await page.locator('#l').click({ button: 'middle' })

  await expect.poll(() => tabsTo(context, 'plain-new-site.test'), { timeout: 5000 }).toEqual([{ active: false }])
  // Once: the browser's tab, and no second one put back by the extension
  await page.waitForTimeout(1500)
  expect(await tabsTo(context, 'plain-new-site.test')).toEqual([{ active: false }])
})

// A page can set ctrl on a click of its own, and a tab opened from the
// background passes no popup blocker. Followed as the click it is, in place.
test('a ctrl click the page makes up opens no tab', async ({ page, context }) => {
  await open(page, '<a id="l" href="https://plain-new-site.test/landed">A new site</a>')

  await page.evaluate(() => document.getElementById('l')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 })))

  await expect.poll(() => page.url(), { timeout: 5000 }).toContain('plain-new-site.test')
  await page.waitForTimeout(1000)
  expect(await tabsTo(context, 'plain-new-site.test')).toEqual([{ active: true }])
})

// The listeners are on the window, and come back after the page rewrites itself
test('after document.open() a flagged link is still stopped', async ({ page }) => {
  await open(page, '')
  await page.evaluate(() => {
    document.open()
    document.write('<!doctype html><body><a id="l" href="https://paypal.com@plain-new-site.test/landed" style="position:fixed;top:40px;left:40px;font-size:20px">Log in</a></body>')
    document.close()
  })
  await page.waitForTimeout(1500)

  await page.locator('#l').click()

  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Red flags in this link')
  expect(page.url()).toBe(SITE_URL)
})

// Every outside link on X goes through t.co, so whether those are stopped on X
// is a setting of its own. Stopped by default, as any short link is.
test('a t.co link on X is stopped by default, and opens with "own site" cleared', async ({ page, context }) => {
  const xPage = 'https://x.com/home'
  await page.context().route(/^https:\/\/t\.co\//, (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('landed') }))
  await serveSite(page, xPage, linksPage('<a id="l" href="https://t.co/abc123">example.com/article</a>'))
  await page.waitForTimeout(2000)
  await page.locator('#l').click()
  await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Shortened link')
  expect(page.url()).toBe(xPage)

  await patchSettings(context, { linkSafety: { enabled: true, intercept: { unfamiliar: true, shortLinks: true, shortLinksOnOwnSite: false, redFlags: true, minRedFlags: 1 } } })
  await serveSite(page, xPage, linksPage('<a id="l" href="https://t.co/abc123">example.com/article</a>'))
  await page.waitForTimeout(2000)
  // Not held as unfamiliar either, with that box ticked: nobody ever visits t.co
  await page.locator('#l').click()
  await expect.poll(() => page.url(), { timeout: 5000 }).toContain('t.co/abc123')
})

/**
 * The tabs open on a host, asked of the browser. The context's routing does not
 * reach a tab opened behind the page in this suite, so the tab shows the error
 * page rather than the made-up site. The browser still says where it was sent.
 */
async function tabsTo(context: any, host: string) {
  const tabs = await inWorker<{ url: string, pendingUrl?: string, active: boolean }[]>(context, async () =>
    (await chrome.tabs.query({})).map((tab: any) => ({ url: tab.url, pendingUrl: tab.pendingUrl, active: tab.active })))
  return tabs.filter(tab => (tab.pendingUrl || tab.url).includes(host)).map(tab => ({ active: tab.active }))
}

// A region of an image map and an SVG link navigate too, and used to go unseen
for (const [kind, markup] of [
  ['a region of an image map', '<map name="m"><area shape="rect" coords="0,0,200,40" href="https://paypal.com@plain-new-site.test/landed" alt="Log in"></map><img id="l" usemap="#m" width="200" height="40" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27200%27 height=%2740%27%3E%3Crect width=%27200%27 height=%2740%27 fill=%27blue%27/%3E%3C/svg%3E">'],
  ['an SVG link', '<svg width="200" height="40"><a href="https://paypal.com@plain-new-site.test/landed"><rect id="l" width="200" height="40" fill="red"/></a></svg>'],
] as const) {
  test(`a flagged link on ${kind} is stopped, and followed after "Continue anyway"`, async ({ page }) => {
    await open(page, markup)

    await page.locator('#l').click({ position: { x: 50, y: 20 } })

    await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Red flags in this link')
    expect(page.url()).toBe(SITE_URL)

    // Put back as a click on the region or the SVG link itself
    await page.waitForTimeout(700)
    await clickInDialog(page, 'continue')
    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('plain-new-site.test')
  })
}

test.describe('on a touchscreen', () => {
  test.use({ hasTouch: true })

  test('a tap on a flagged link is stopped', async ({ page }) => {
    await open(page, '<a id="l" href="https://paypal.com@plain-new-site.test/landed">Log in</a>')

    await page.locator('#l').tap()

    await expect.poll(() => allText(page), { timeout: 5000, intervals: [300] }).toContain('Red flags in this link')
    expect(page.url()).toBe(SITE_URL)
  })
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
