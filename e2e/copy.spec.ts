/**
 * The copy button beside an address.
 *
 * The one inside a web page is the one that matters: it runs in the content
 * script's world, under a page that may be watching the clipboard. It must put
 * the address there without the page's own clipboard code seeing the call, and
 * without a `copy` event the page could rewrite on the way.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { blankPage, inWorker, serveSite } from './helpers'

// Evaluated inside the extension's service worker
declare const chrome: any

const SITE_URL = 'https://copy-site.test/'
const TARGET = 'https://some-unknown-copy-target.test/path'

const PAGE = blankPage('copy', `
  <a id="link" href="${TARGET}"
     style="position:fixed;top:50px;left:50px;font-size:20px">Somewhere</a>
  <script>
    // Everything a page could do to see or change what gets copied
    window.__seen = { writes: 0, copies: 0 }
    const original = Clipboard.prototype.writeText
    Clipboard.prototype.writeText = function (text) {
      window.__seen.writes++
      return original.call(this, 'swapped by the page')
    }
    document.addEventListener('copy', (event) => {
      window.__seen.copies++
      event.clipboardData.setData('text/plain', 'swapped by the page')
      event.preventDefault()
    }, true)
  </script>
`)

/**
 * The in-page UI is in a closed shadow root, which no locator reaches. The
 * DevTools protocol does, so the button is found the way the inspector finds
 * it and pressed with a real mouse click at its place on the screen.
 */
async function copyButton(page: Page): Promise<{ x: number, y: number, state: string } | null> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    let found: any
    const walk = (node: any) => {
      if (found)
        return
      const attrs: string[] = node.attributes ?? []
      // Attributes come as one flat list of names and values
      const at = attrs.indexOf('data-action')
      if (at >= 0 && attrs[at + 1] === 'copy')
        found = node
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
        walk(child)
    }
    walk(root)
    if (!found)
      return null
    // The address is drawn again once its owner's labels are known, so the
    // button found may already be gone. Asked again by the caller.
    const box = await cdp.send('DOM.getBoxModel', { nodeId: found.nodeId }).catch(() => null)
    if (!box)
      return null
    const { model } = box
    const [x1, y1, , , x3, y3] = model.border
    const attrs: string[] = found.attributes
    return { x: (x1 + x3) / 2, y: (y1 + y3) / 2, state: attrs[attrs.indexOf('data-copy-state') + 1] }
  }
  finally {
    await cdp.detach()
  }
}

test('the copy button in a link dialog copies the address past a page watching the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_URL })
  await serveSite(page, SITE_URL, PAGE)
  await page.waitForTimeout(1500)

  // What the browser's menu item sends: no automation can open the menu itself
  await inWorker(context, async ({ host, target }: any) => {
    const [tab] = await chrome.tabs.query({ url: `*://${host}/*` })
    await chrome.tabs.sendMessage(tab.id, { type: 'show-link-intercept', data: { url: target, frameId: 0 } }, { frameId: 0 }).catch(() => {})
  }, { host: new URL(SITE_URL).host, target: TARGET })

  await expect.poll(() => copyButton(page), { timeout: 15000 }).not.toBeNull()
  // Let the address settle into its final drawing before aiming at it
  await page.waitForTimeout(500)
  const button = (await copyButton(page))!
  expect(button.state).toBe('idle')
  await page.mouse.click(button.x, button.y)

  await expect.poll(async () => (await copyButton(page))?.state, { timeout: 5000 }).toBe('copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('some-unknown-copy-target.test')
  // The page's clipboard code never ran, and there was no event to rewrite
  expect(await page.evaluate(() => (window as any).__seen)).toEqual({ writes: 0, copies: 0 })

  // CONTROL: the trap works. A write made from the page itself is seen and swapped.
  await page.evaluate(() => navigator.clipboard.writeText('from the page'))
  expect(await page.evaluate(() => (window as any).__seen.writes)).toBe(1)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('swapped by the page')
})

test('the copy button on the check page copies the checked address', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?check=1`)
  await page.waitForTimeout(1500)
  await page.locator('textarea[placeholder="Paste a link, domain or email address"]').fill('https://pаypal-login.test/x')
  await page.locator('button', { hasText: 'Check' }).first().click()

  const copy = page.locator('[data-domain-panel] [data-action="copy"]').first()
  await copy.click()
  await expect(copy).toHaveAttribute('data-copy-state', 'copied')
  // As the name is, letter from another alphabet and all, not as it is drawn.
  // Read back from an ordinary page, since an extension page cannot be granted
  // the permission to read.
  await context.grantPermissions(['clipboard-read'], { origin: SITE_URL })
  const reader = await context.newPage()
  await serveSite(reader, SITE_URL)
  expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe('pаypal-login.test')
})
