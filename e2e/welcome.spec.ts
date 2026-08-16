/**
 * The page shown after install, driven through the state the import publishes.
 *
 * The page is a viewer, not the owner of that state, so every case it has to
 * render can be produced by writing the state key – which is also the only way
 * to reach the failure and the halfway cases without a browser history to feed
 * a real import.
 */
import { expect, test } from './fixtures'
import { sw } from './helpers'

// Evaluated inside the extension's service worker, where the MV3 API lives
declare const chrome: any

const STATE_KEY = '__visilantHistoryImport'

const BASE_STATE = {
  status: 'running',
  mode: 'quick',
  phase: 'reading',
  current: 0,
  total: 0,
  domains: 0,
  visits: 0,
  finishedAt: 0,
  auto: true,
  updatedAt: 0,
  attempts: 0,
  fullDoneAt: 0,
}

/** Publish an import state the way the background would while it runs. */
async function publishState(context: any, patch: Record<string, unknown>) {
  const worker = await sw(context)
  await worker.evaluate(async ({ key, state }: any) => {
    await chrome.storage.local.set({ [key]: state })
  }, { key: STATE_KEY, state: { ...BASE_STATE, ...patch } })
}

/**
 * Wait out the import the extension starts by itself on install.
 *
 * It publishes to the very key these tests write, so a state seeded before it
 * settles is simply overwritten – on a fresh profile with no history to read,
 * with a finished import of nothing.
 */
async function waitForAutoImport(context: any) {
  const worker = await sw(context)
  const read = () => worker.evaluate(async (key: string) => {
    const stored = await chrome.storage.local.get(key)
    const state = stored[key]
    return state ? `${state.status}:${state.updatedAt}:${state.finishedAt}` : 'none'
  }, STATE_KEY)

  // Two passes run one after the other, so a single `done` is not the end of it.
  // Only a state that stops changing is.
  let previous = ''
  await expect.poll(async () => {
    const current = await read()
    const settled = current !== 'none' && !current.startsWith('running') && current === previous
    previous = current
    return settled
  }, { timeout: 20000, intervals: [500] }).toBe(true)
}

async function openWelcome(context: any, extensionId: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/welcome/index.html`)
  await page.waitForTimeout(1500)
  return page
}

/** The two figures the page ends on, sites first. */
function stats(page: any) {
  return page.locator('.text-2xl.font-bold')
}

test('installing the extension opens the welcome page by itself', async ({ context }) => {
  await expect
    .poll(() => context.pages().map((p: any) => p.url()).join(' '), { timeout: 20000 })
    .toContain('/dist/welcome/index.html')
})

test('welcome page explains itself and what was stored', async ({ context, extensionId }) => {
  const page = await openWelcome(context, extensionId)

  await expect(page.locator('text=Visilant is ready')).toBeVisible({ timeout: 5000 })
  // The reason for an import nobody asked for, and the list of what it took
  await expect(page.locator('text=What was saved')).toBeVisible()
  await expect(page.locator('button', { hasText: 'Open settings' })).toBeVisible()
})

test('a finished import shows the figures it ended on', async ({ context, extensionId }) => {
  await waitForAutoImport(context)
  await publishState(context, { status: 'done', domains: 1234, visits: 56789, finishedAt: 1 })
  const page = await openWelcome(context, extensionId)

  // Grouped and localised rather than printed raw
  await expect(stats(page)).toHaveText(['1,234', '56,789'], { timeout: 5000 })
  await expect(page.locator('text=These sites are now familiar')).toBeVisible()
  // Nothing is still going, so there is nothing to retry
  await expect(page.locator('button', { hasText: 'Import again' })).toHaveCount(0)
})

test('an import that lands while the page is open updates it in place', async ({ context, extensionId }) => {
  await waitForAutoImport(context)
  await publishState(context, { status: 'running' })
  const page = await openWelcome(context, extensionId)
  await expect(page.locator('text=Import again')).toHaveCount(0)

  await publishState(context, { status: 'done', domains: 42, visits: 99, finishedAt: 1 })

  await expect(stats(page)).toHaveText(['42', '99'], { timeout: 5000 })
})

test('a failed import says so and offers to run again', async ({ context, extensionId }) => {
  await waitForAutoImport(context)
  await publishState(context, { status: 'failed', finishedAt: 1 })
  const page = await openWelcome(context, extensionId)

  await expect(page.locator('text=The import did not finish')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('button', { hasText: 'Import again' })).toBeVisible()
})

test('a counted but undetailed import keeps its figures and still offers a retry', async ({ context, extensionId }) => {
  // The quick pass finished and the detail pass gave up. Worth saying, but the
  // numbers already earned must not be blanked over it.
  await waitForAutoImport(context)
  await publishState(context, { status: 'done', mode: 'quick', domains: 7, visits: 8, finishedAt: 1 })
  const page = await openWelcome(context, extensionId)
  await expect(stats(page)).toHaveText(['7', '8'], { timeout: 5000 })

  await publishState(context, { status: 'failed', mode: 'full', domains: 0, visits: 0, finishedAt: 2 })

  await expect(page.locator('button', { hasText: 'Import again' })).toBeVisible({ timeout: 5000 })
  await expect(stats(page)).toHaveText(['7', '8'])
})

test('the settings button opens the options page', async ({ context, extensionId }) => {
  const page = await openWelcome(context, extensionId)

  const opened = context.waitForEvent('page', { timeout: 10000 })
  await page.locator('button', { hasText: 'Open settings' }).click()
  const options = await opened

  await expect.poll(() => options.url(), { timeout: 5000 }).toContain('/dist/options/index.html')
  await options.close()
})

test('zoom on the welcome page stays on the welcome page', async ({ context, extensionId }) => {
  // Same origin as the action popup, which is what the isolation is there for
  const page = await openWelcome(context, extensionId)
  const worker = await sw(context)

  const scope = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return (await chrome.tabs.getZoomSettings(tabs[0].id)).scope
  })

  expect(scope).toBe('per-tab')
  await page.close()
})
