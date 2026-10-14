/**
 * The settings page and the page shown after install.
 */
import type { BrowserContext } from '@playwright/test'
import { expect, inWorker, patchSettings, SETTLED_IMPORT, test } from './fixtures'

// Evaluated inside the extension's service worker
declare const chrome: any

const OPTIONS = 'src/options/Options.vue'
const NAV = 'src/options/SectionNav.vue'
const RESET = 'src/options/SectionReset.vue'
const WELCOME = 'src/welcome/Welcome.vue'

const SECTIONS = ['general', 'familiarity', 'display', 'notifications', 'tampering', 'link-safety', 'lookups', 'email-lists', 'data']

async function openOptions(context: BrowserContext, extensionId: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.locator('#section-general')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)
  return page
}

test('settings page, whole', async ({ context, extensionId, shot }) => {
  const page = await openOptions(context, extensionId)
  await shot(page, { name: 'options-full', title: 'Settings page, top to bottom', covers: [OPTIONS, NAV, RESET] }, { fullPage: true })
})

test('settings page, compact', async ({ context, extensionId, shot }) => {
  await patchSettings(context, { verboseOptions: false })
  const page = await openOptions(context, extensionId)
  await shot(page, { name: 'options-compact', title: 'Settings page with the explanations turned off', covers: [OPTIONS] }, { fullPage: true })
})

test('settings page, one section at a time', async ({ context, extensionId, shot }) => {
  // A link check that clicks, a paste guard and every list shown, so the
  // sections open everything they can
  await patchSettings(context, {
    blockPasteOnUnfamiliar: true,
    showFamiliarityThresholds: true,
    linkSafety: { tooltipTrigger: 'hover', shortUrlMode: 'auto', scopeMode: 'whitelist', scopeDomains: 'mail.example.test\nwebmail.test' },
  })
  const page = await openOptions(context, extensionId)
  for (const id of SECTIONS) {
    await shot(page, { name: `options-${id}`, title: `Settings: the ${id.replace('-', ' ')} section, with its options switched on`, covers: [OPTIONS, RESET] }, { clip: `#section-${id}` })
  }
})

// ==========================================
// Welcome
// ==========================================

async function publishImport(context: BrowserContext, patch: Record<string, unknown>) {
  await inWorker(context, async (state: any) => chrome.storage.local.set({ __visilantHistoryImport: state }), { ...SETTLED_IMPORT, ...patch })
}

/**
 * What the import has published, step by step. Most states are one step. The
 * page keeps the figures of a pass it saw finish, so the case where the detail
 * pass fails after the quick one has to be shown to it in that order.
 * Functions, so a "running" import is stamped with the moment it is shown: an
 * older stamp reads as an import that died, and the page says something else.
 */
const WELCOME_STATES: { name: string, title: string, steps: () => Record<string, unknown>[] }[] = [
  {
    name: 'welcome-running',
    title: 'Welcome page while the history import reads',
    steps: () => [{ status: 'running', phase: 'reading', current: 1200, total: 4800, domains: 0, visits: 0, finishedAt: 0, updatedAt: Date.now() }],
  },
  { name: 'welcome-done', title: 'Welcome page after the import finished', steps: () => [{}] },
  { name: 'welcome-failed', title: 'Welcome page after the import failed', steps: () => [{ status: 'failed', domains: 0, visits: 0 }] },
  {
    name: 'welcome-partial',
    title: 'Welcome page: counted, but the detail pass failed',
    steps: () => [
      { status: 'done', mode: 'quick', domains: 412, visits: 9817, fullDoneAt: 0 },
      { status: 'failed', mode: 'full', domains: 0, visits: 0, fullDoneAt: 0, finishedAt: Date.UTC(2026, 0, 15, 13) },
    ],
  },
  { name: 'welcome-unsupported', title: 'Welcome page in a browser with no history access', steps: () => [{ status: 'unsupported', domains: 0, visits: 0 }] },
]

for (const w of WELCOME_STATES) {
  test(w.title, async ({ context, extensionId, shot }) => {
    const [first, ...rest] = w.steps()
    await publishImport(context, first)
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/dist/welcome/index.html`)
    await expect(page.locator('text=Visilant is ready')).toBeVisible({ timeout: 10000 })
    for (const step of rest) {
      await page.waitForTimeout(500)
      await publishImport(context, step)
    }
    await page.waitForTimeout(800)
    try {
      await shot(page, { name: w.name, title: w.title, covers: [WELCOME] }, { fullPage: true })
    }
    finally {
      // Never leave a made-up running import behind for the worker to resume
      await publishImport(context, {})
    }
  })
}
