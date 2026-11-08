/**
 * Ways to bring each surface up, shared by the scenario files.
 *
 * `fixtures.ts` owns the browser and the profile. This file owns the gestures:
 * resting on a link, the context-menu items, opening the popup as the toolbar
 * would, and the made-up network the service worker sees when it follows a
 * short link.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { expect, fromMenu, inWorker, openSite, patchSettings, patchWorker, rebuildLookalikeIndex, shadowText, sitePage, test, waitForUi } from './fixtures'

// Evaluated inside the extension's service worker
declare const chrome: any

export const DAY = 24 * 60 * 60 * 1000

/** The page the in-page cases are drawn over. Nobody has been there before. */
export const SITE = 'https://unknown-shop.test/'
/** A second one, for cases that read better over a mailbox. */
export const MAIL = 'https://mail.example-webmail.test/'

/** One link, big and away from the edges, so the tooltip has room to open below it. */
export function linkPage(link: string, title = 'Unknown Shop') {
  return sitePage(title, `
    <p>Some page the user has never been to before, with a link on it.</p>
    <p style="font-size:20px">${link}</p>
    <p style="height:900px">More text further down.</p>`)
}

/** A link with id `l`, for the helpers below. */
export const a = (href: string, text: string) => `<a id="l" href="${href.replace(/"/g, '&quot;')}">${text}</a>`

export async function setLocal(context: BrowserContext, values: Record<string, unknown>) {
  await inWorker(context, async (v: any) => chrome.storage.local.set(v), values)
}

/**
 * Write visit records exactly as given, then rebuild the lookalike index.
 *
 * `seed` in fixtures always fills in every field. This one does not, for the
 * records written before first-visit dates and active days were kept.
 */
export async function seedRaw(context: BrowserContext, records: (now: number) => Record<string, unknown>) {
  await setLocal(context, records(Date.now()))
  await rebuildLookalikeIndex(context)
}

/** Is there a mouse to rest on things with? The phone run has none. */
export async function canHover(page: Page) {
  return page.evaluate(() => matchMedia('(hover: hover)').matches)
}

/**
 * A tap on a mail link, on a touchscreen, where there is no other way to the
 * tooltip. A tap is held only when there is a reason to stop it, so the
 * "unfamiliar site" box is ticked for the run, and an address that still gives
 * no reason (a familiar company, a public or a throwaway service) opens the
 * mail app and has nothing to draw: skipped, the desktop columns draw it.
 */
export async function tapMailLink(page: Page, needles: string[]) {
  await page.locator('#l').click()
  for (let waited = 0; waited < 3000 && !(await shadowText(page)).trim(); waited += 250)
    await page.waitForTimeout(250)
  test.skip(!(await shadowText(page)).trim(), 'a tap on this address is not held, so the mail app opens and there is nothing to draw')
  await waitForUi(page, ...needles)
}

/**
 * The tooltip, raised by resting the pointer on the link. The shipped trigger is
 * the browser's own menu, which no automation can open, and the tooltip it leads
 * to is the same one. A touchscreen gets the tooltip only for an address, by
 * tapping it, see `tapMailLink`: a tap on any other link that is held opens the
 * dialog, which has cases of its own, so those are skipped there.
 */
export async function tooltipFor(page: Page, link: string, needles: string[], url = SITE) {
  const hover = await canHover(page)
  await patchSettings(page.context(), { linkSafety: { tooltipTrigger: 'hover', hoverDelay: 200, ...(hover ? {} : { intercept: { unfamiliar: true } }) } })
  await openSite(page, url, linkPage(link))
  if (hover) {
    await page.locator('#l').hover()
    await waitForUi(page, ...needles)
    return
  }
  test.skip(!link.includes('href="mailto:'), 'no hover on a touchscreen, a tap opens the link dialog instead')
  await tapMailLink(page, needles)
}

/** A right-click the page sees, with the browser's own menu put away again. */
export async function rightClick(page: Page, selector: string) {
  await page.locator(selector).click({ button: 'right' })
  await page.keyboard.press('Escape')
}

/**
 * "Check this link" from the context menu: a real right-click on the link,
 * which is what the content script remembers the link's words from, then the
 * message the menu item sends.
 */
export async function menuCheck(page: Page, link: string, href: string, needles: string[], url = SITE) {
  await openSite(page, url, linkPage(link))
  await rightClick(page, '#l')
  await fromMenu(page.context(), url, { type: 'show-link-intercept', data: { url: href, frameId: 0 } })
  await waitForUi(page, ...needles)
}

/** A QR code scanned from the menu, as the background hands it to the page. */
export async function qrResult(page: Page, payload: string, needles: string[]) {
  await openSite(page, SITE, linkPage('<span id="l">A QR code was here.</span>'))
  await fromMenu(page.context(), SITE, { type: 'show-qr-result', data: { payload } })
  await waitForUi(page, ...needles)
}

/** "Check selection" from the menu, on text selected in a message. */
export async function checkSelection(page: Page, text: string, needles: string[]) {
  await openSite(page, MAIL, sitePage('Inbox', `<p>Your account will be closed. Reply to <b id="s">${text}</b> today.</p>`))
  await page.locator('#s').selectText()
  await fromMenu(page.context(), MAIL, { type: 'check-selection', data: { selectionText: text } })
  await waitForUi(page, ...needles)
}

/**
 * What the service worker's `fetch` answers while it follows a short link.
 *
 * `context.route` does not see an extension worker's requests, so its `fetch` is
 * wrapped instead, for this scenario only. Each address prefix gets an answer:
 * where the request ended up after redirects (`to`), the page found there
 * (`body`, a meta refresh in it makes one more hop), a network failure, or no
 * answer at all.
 */
export type FetchAnswer = { to?: string, body?: string } | { fail: true } | { hang: true }

export async function workerFetch(context: BrowserContext, answers: Record<string, FetchAnswer>) {
  await patchWorker(context, (table: Record<string, any>) => {
    const g = globalThis as any
    const original = g.fetch
    g.fetch = async (input: any, init?: any) => {
      const url = String(input?.url ?? input)
      const prefix = Object.keys(table).find(p => url.startsWith(p))
      if (!prefix)
        return original.call(g, input, init)
      const answer = table[prefix]
      if (answer.hang)
        return new Promise(() => {})
      if (answer.fail)
        throw new TypeError('Failed to fetch')
      const response = new Response(answer.body ?? '<title>page</title>', { status: 200, headers: { 'content-type': 'text/html' } })
      Object.defineProperty(response, 'url', { value: answer.to ?? url })
      return response
    }
    return () => {
      g.fetch = original
    }
  }, answers)
}

/**
 * Open the popup document the way the toolbar button does, for the site at `url`.
 *
 * No automation tool can press the toolbar button, and the same document opened
 * in a tab lays itself out as a page: it tells the two apart by whether
 * `tabs.getCurrent()` answers. So the page is told it is not in a tab, and that
 * the active tab is the site's. Both are patched on the API object itself, which
 * the polyfill reads at call time, and answer through the callback as well as a
 * promise, because the polyfill waits for the callback. `tabView` keeps it a
 * tab, which is also how Firefox for Android shows it.
 */
export async function openPopup(context: BrowserContext, extensionId: string, url: string | null, options: { tabView?: boolean } = {}) {
  if (url) {
    const site = await context.newPage()
    await openSite(site, url, sitePage(new URL(url).hostname, '<p>A page.</p>'))
  }

  const popup = await context.newPage()
  await popup.addInitScript(({ activeUrl, tabView }: { activeUrl: string, tabView: boolean }) => {
    const answer = (value: unknown) => function (...args: unknown[]) {
      const callback = typeof args.at(-1) === 'function' ? args.pop() as (v: unknown) => void : null
      if (callback) {
        setTimeout(() => callback(value))
        return undefined
      }
      return Promise.resolve(value)
    }
    for (const api of [(globalThis as any).chrome?.tabs, (globalThis as any).browser?.tabs]) {
      if (!api)
        continue
      api.getCurrent = answer(tabView ? { id: 9, index: 1, active: true, windowId: 1 } : undefined)
      api.query = answer([{ id: 1, index: 0, active: true, url: activeUrl, windowId: 1 }])
    }
  }, { activeUrl: url ?? 'chrome://newtab/', tabView: options.tabView ?? false })
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  // The popup layout, or the patch above did not take and this is the tab
  // layout under the popup's name
  if (!options.tabView)
    await expect(popup.locator('main.w-\\[600px\\]')).toBeVisible({ timeout: 10000 })
  else
    await expect(popup.locator('main')).toBeVisible({ timeout: 10000 })
  await popup.waitForTimeout(800)
  return popup
}

/** The popup document opened by address: `domain=` for site details, `check=1` for the check page. */
export async function openPage(context: BrowserContext, extensionId: string, query: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?${query}`)
  await expect(page.locator('main')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)
  return page
}

export const CHECK_INPUT = 'textarea[placeholder="Paste a link, domain or email address"]'

/** Check `text` on the check page, and wait for the card about `card` unless there is nothing to check. */
export async function check(page: Page, text: string, card?: string) {
  await page.locator(CHECK_INPUT).fill(text)
  await page.locator('button', { hasText: 'Check' }).first().click()
  if (card)
    await expect(page.locator('[data-domain-panel]')).toContainText(card, { timeout: 10000 })
  await page.waitForTimeout(1000)
}

/**
 * A background that answers the visit lookup with an error, for this scenario.
 *
 * Stands in for the case that matters in real use: a tab left open across an
 * extension update, whose content script can no longer be answered. The extra
 * listener replies first, so the real handler's answer never arrives.
 */
export async function workerRefusesVisits(context: BrowserContext) {
  await patchWorker(context, () => {
    const runtime = (globalThis as any).chrome.runtime
    const refuse = (message: any, _sender: unknown, reply: (answer: unknown) => void) => {
      if (message?.type === 'get-visit-count')
        reply({ error: 'unavailable' })
    }
    runtime.onMessage.addListener(refuse)
    return () => runtime.onMessage.removeListener(refuse)
  })
}
