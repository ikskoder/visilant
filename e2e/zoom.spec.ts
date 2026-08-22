import { expect, test } from './fixtures'
import { inWorker } from './helpers'

declare const chrome: any

test('zoom on the options page is not written to the origin the popup reads', async ({ context, extensionId }) => {
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await options.waitForTimeout(1500)

  const tabId = await inWorker<number>(context, async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return tabs[0].id
  })

  // The user zooms the settings page
  await inWorker(context, async (id: number) => chrome.tabs.setZoom(id, 1.3), tabId)
  await options.waitForTimeout(600)

  const scope = await inWorker<string>(context, async (id: number) => (await chrome.tabs.getZoomSettings(id)).scope, tabId)
  expect(scope).toBe('per-tab')

  // What the action popup inherits is the origin's own factor. Probed with a
  // plain file from the extension, which shares the origin but runs none of our
  // code, so reading it neither triggers the isolation nor rewrites the origin
  // the way flipping a live tab's scope back would.
  const probe = await context.newPage()
  await probe.goto(`chrome-extension://${extensionId}/dist/contentScripts/style.css`)
  await probe.waitForTimeout(500)
  const originZoom = await inWorker<number>(context, async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return chrome.tabs.getZoom(tabs[0].id)
  })
  expect(originZoom).toBeCloseTo(1, 2)
  await probe.close()

  // And the page gets its own zoom back when reopened, which per-tab scope
  // would otherwise drop on every navigation
  await options.reload()
  await options.waitForTimeout(1800)
  const restored = await inWorker<number>(context, async (id: number) => chrome.tabs.getZoom(id), tabId)
  expect(restored).toBeCloseTo(1.3, 2)
})
