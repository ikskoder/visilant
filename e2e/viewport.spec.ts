// The warnings are drawn over what is on the screen, not over the layout
// viewport. On a phone the two differ: a page with no mobile viewport is laid
// out 980px wide and drawn zoomed out, and a field taking the focus zooms the
// screen in on a slice of it. A warning pinned to a corner of the 980px used to
// sit off the edge of that slice, unseen, at the moment it was raised. Found on
// Firefox for Android, reproduced here with Chromium's mobile emulation, which
// reports the same numbers.
import { expect, test } from './fixtures'
import { blankPage, serveSite } from './helpers'

const SITE_URL = 'https://zoomed-form.test/'

// Wider than any phone, and no viewport meta: laid out like a desktop page
const SITE_HTML = blankPage('zoomed form', `
  <input id="field" style="position:absolute;left:8px;top:8px;width:160px">
  <div style="width:900px;height:1600px"></div>
`)

/** The rect of the visible warning card, read through the closed shadow root. */
async function warningCard(page: any) {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    let found: number | null = null
    const walk = (node: any) => {
      const attributes: string[] = node.attributes ?? []
      for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] === 'data-verdict' && attributes[i + 1] === 'unfamiliar' && attributes.includes('alert'))
          found = node.backendNodeId
      }
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
        walk(child)
    }
    walk(root)
    if (found === null)
      return null
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: found })
    const { result } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function () {
        const r = this.getBoundingClientRect()
        const v = window.visualViewport
        return JSON.stringify({
          left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width,
          vLeft: v.offsetLeft, vTop: v.offsetTop, vWidth: v.width, vHeight: v.height, scale: v.scale,
        })
      }`,
      returnByValue: true,
    })
    return JSON.parse(result.value)
  }
  finally {
    await cdp.detach()
  }
}

test('the typing warning lands on the screen of a phone zoomed in on the field', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  // A phone: 412px wide at the device's own scale
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 800, deviceScaleFactor: 2.6, mobile: true })

  await serveSite(page, SITE_URL, SITE_HTML)
  await page.waitForTimeout(1500)

  // What the browser does to a focused field on such a page: the screen shows
  // a slice of it, here the top left corner, at twice the zoomed out size
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
  await page.waitForTimeout(300)

  await page.locator('#field').click()
  await page.keyboard.type('abc')
  await page.waitForTimeout(1500)

  const card = await warningCard(page)
  expect(card, 'the typing warning was not raised at all').not.toBeNull()

  // The CONTROL for the rest: the slice really is a fraction of the page
  expect(card.vWidth).toBeLessThan(300)

  // Inside the slice the user is looking at
  expect(card.left).toBeGreaterThanOrEqual(card.vLeft - 1)
  expect(card.right).toBeLessThanOrEqual(card.vLeft + card.vWidth + 1)
  expect(card.top).toBeGreaterThanOrEqual(card.vTop - 1)
  expect(card.bottom).toBeLessThanOrEqual(card.vTop + card.vHeight + 1)

  // And drawn at the phone's own size, not shrunk into the slice: 380 of the
  // 412 screen pixels, as on a page made for a phone
  expect(card.width * card.scale).toBeGreaterThan(300)
  await cdp.detach()
})
