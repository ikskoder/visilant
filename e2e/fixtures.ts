import type { BrowserContext } from '@playwright/test'
import type { Manifest } from 'webextension-polyfill'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test as base, chromium } from '@playwright/test'
import fs from 'fs-extra'

export { name } from '../package.json'

export const extensionPath = path.join(__dirname, '../extension')

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
}>({
  context: async ({ headless }, use) => {
    // workaround for the Vite server has started but contentScript is not yet.
    await sleep(1000)
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      slowMo: headless ? 0 : 1000,
      args: [
        ...(headless ? ['--headless=new'] : []),
        '--no-sandbox',
        // The extension raises real browser notifications, and on this desktop
        // Chromium hands those to the system notification server: a full run put
        // a dozen popups on the screen of whoever was running it. This turns off
        // the delivery, not the notification - the extension still creates it,
        // the code under test is the same code, and the timings are unchanged.
        // Nothing in the suite reads a desktop notification.
        '--disable-features=SystemNotifications',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    // For manifest v3 the id comes off the service worker's own URL. Waiting for
    // the registration event is not enough on its own: the worker is torn down
    // whenever it looks idle, and a restart does not always arrive as a fresh
    // event – so the list is polled alongside it.
    let [background] = context.serviceWorkers()
    if (!background) {
      background = await Promise.race([
        context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => undefined),
        (async () => {
          for (let attempt = 0; attempt < 80; attempt++) {
            const [worker] = context.serviceWorkers()
            if (worker)
              return worker
            await sleep(250)
          }
          return undefined
        })(),
      ]) as typeof background
    }

    if (!background)
      throw new Error('the extension service worker never turned up')

    const extensionId = background.url().split('/')[2]
    await use(extensionId)
  },
})

export const expect = test.expect

export function isDevArtifact() {
  const manifest: Manifest.WebExtensionManifest = fs.readJsonSync(path.resolve(extensionPath, 'manifest.json'))
  return Boolean(
    typeof manifest.content_security_policy === 'object'
    && manifest.content_security_policy.extension_pages?.includes('localhost'),
  )
}
