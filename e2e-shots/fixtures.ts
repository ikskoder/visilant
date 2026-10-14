/**
 * Plumbing for the screenshot run.
 *
 * Not a test suite: nothing here asserts how the interface should look. Every
 * scenario sets up one state, waits for it to be drawn and saves a picture of it,
 * so that after a change somebody can look through all of them in one place.
 *
 * One browser per worker, reused across scenarios, because a fresh profile costs
 * an install, a welcome tab and a history import every time. What the scenarios
 * could leak to each other is wiped before each one (`resetProfile`).
 */
import type { BrowserContext, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { test as base, chromium } from '@playwright/test'

// Evaluated inside the extension's service worker
declare const chrome: any

export const ROOT = path.resolve(__dirname, '..')
export const EXTENSION_PATH = path.join(ROOT, '.tmp/shots/build-src/extension')
export const OUT_DIR = path.join(ROOT, '.tmp/shots/run')

export type Theme = 'light' | 'dark'

/** The import state the profile is put back to before every scenario. */
const IMPORT_STATE_KEY = '__visilantHistoryImport'
export const SETTLED_IMPORT = {
  status: 'done',
  mode: 'full',
  phase: 'saving',
  current: 0,
  total: 0,
  domains: 412,
  visits: 9817,
  // A fixed day, so the settings page does not print a new date every run
  finishedAt: Date.UTC(2026, 0, 15, 12),
  auto: true,
  updatedAt: Date.UTC(2026, 0, 15, 12),
  attempts: 1,
  fullDoneAt: Date.UTC(2026, 0, 15, 12),
}

const DAY = 24 * 60 * 60 * 1000

export interface ShotInfo {
  /** File name, and how the gallery lines up the three columns of one screen. */
  name: string
  /** What the picture is meant to show, in a few words. */
  title: string
  /**
   * What to look at in it, for a reader who has never seen this case happen:
   * how it comes about and what the screen should say about it.
   */
  note?: string
  /** Which source files this picture is evidence for, for the coverage check. */
  covers: string[]
}

interface WorkerFixtures {
  theme: Theme
  /** A mouse, or a touchscreen with nothing to hover with, as on a phone. */
  pointer: 'mouse' | 'touch'
  shotViewport: { width: number, height: number }
  browserContext: BrowserContext
  extensionId: string
}

interface TestFixtures {
  context: BrowserContext
  page: Page
  shot: (target: Page, info: ShotInfo, options?: { fullPage?: boolean, clip?: string }) => Promise<void>
}

// How many shots each scenario has taken so far, to keep them in order
const shotCounter = new Map<string, number>()
// The settings a fresh profile starts with, per browser
const defaults = new WeakMap<BrowserContext, Record<string, unknown>>()

export const test = base.extend<TestFixtures, WorkerFixtures>({
  theme: ['light', { scope: 'worker', option: true }],
  pointer: ['mouse', { scope: 'worker', option: true }],
  shotViewport: [{ width: 1280, height: 800 }, { scope: 'worker', option: true }],

  browserContext: [async ({ shotViewport, pointer }, use) => {
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json')))
      throw new Error('No build to load. Run `just shots`, which builds into .tmp/shots/build-src first.')

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      // Set here rather than through `use`: options of a context this fixture
      // launches itself are not filled in from the project
      viewport: shotViewport,
      locale: 'en-US',
      timezoneId: 'UTC',
      args: [
        '--headless=new',
        '--no-sandbox',
        // Headless Chromium reports no hover and no fine pointer, which the
        // extension reads as a touchscreen and swaps the link check over to
        // clicks. A desktop run says it has a mouse. The phone run keeps the
        // touchscreen answer, which is what a phone gives.
        ...(pointer === 'mouse' ? ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] : []),
        // Keeps the extension's real notifications off the desktop of whoever
        // runs this, as in e2e/fixtures.ts
        '--disable-features=SystemNotifications',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    })
    // The install opens the welcome tab and starts a history import, and both
    // write the keys the scenarios write. Let them finish first.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (context.pages().some(p => p.url().includes('welcome')))
        break
      await sleep(100)
    }
    await waitForImportToSettle(context)
    // A fresh profile is at its defaults, and the background hands them out
    // whole. Kept, because every reset writes them back in full: a partial
    // `linkSafety` would turn the link check off rather than fill itself in.
    defaults.set(context, await fromExtensionPage(context, () => (globalThis as any).chrome.runtime.sendMessage({ type: 'get-settings', data: {} })))
    await use(context)
    await context.close()
  }, { scope: 'worker' }],

  extensionId: [async ({ browserContext }, use) => {
    const worker = await sw(browserContext)
    await use(worker.url().split('/')[2])
  }, { scope: 'worker' }],

  context: async ({ browserContext, theme }, use) => {
    // Whatever the last scenario left open goes, so tabs do not pile up
    const keeper = browserContext.pages()[0] ?? await browserContext.newPage()
    for (const p of browserContext.pages()) {
      if (p !== keeper)
        await p.close()
    }
    await keeper.goto('about:blank')
    await resetProfile(browserContext, theme)
    await use(browserContext)
  },

  page: async ({ context }, use) => {
    const page = await context.newPage()
    await page.bringToFront()
    await use(page)
  },

  shot: async ({ theme }, use, testInfo) => {
    await use(async (target, info, options = {}) => {
      const dir = path.join(OUT_DIR, testInfo.project.name)
      fs.mkdirSync(dir, { recursive: true })
      // Lets the slide-in transitions finish: `animations: 'disabled'` stops
      // CSS animations but a Vue transition still has its classes on for a moment
      await target.waitForTimeout(400)
      // A web font that lands after the picture moves every line in it, which
      // the next run then reports as a change
      await target.evaluate(() => document.fonts.ready.then(() => undefined))
      const take = async () => {
        const common = { animations: 'disabled', caret: 'hide' } as const
        if (!options.clip)
          return target.screenshot({ ...common, fullPage: options.fullPage ?? false })
        // Cut out of a picture of the whole page rather than taken from the
        // element: that scrolls the element into view first, and where the
        // scroll lands moves every glyph by a fraction of a pixel from run to run
        const box = await target.locator(options.clip).first().evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
        })
        const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) }
        return target.screenshot({ ...common, fullPage: true, clip })
      }
      // Taken until two pictures in a row agree, so a page still settling – a
      // button waiting on a storage read, a list still filling in – is not caught
      // halfway. One that never settles is saved as it last was.
      await freezeShadowAnimations(target)
      let picture = await take()
      let settled = false
      for (let attempt = 0; attempt < 6 && !settled; attempt++) {
        await target.waitForTimeout(300)
        const again = await take()
        settled = again.equals(picture)
        picture = again
      }
      fs.writeFileSync(path.join(dir, `${info.name}.png`), picture)
      fs.writeFileSync(path.join(dir, `${info.name}.json`), JSON.stringify({
        ...info,
        // Relative to this folder, the way Playwright's report names it
        file: path.relative(__dirname, testInfo.file),
        order: testInfo.line * 100 + (shotCounter.get(testInfo.testId) ?? 0),
        project: testInfo.project.name,
        test: testInfo.title,
        theme,
      }, null, 2))
      shotCounter.set(testInfo.testId, (shotCounter.get(testInfo.testId) ?? 0) + 1)
    })
  },
})

export const expect = test.expect

// ==========================================
// The profile
// ==========================================

export async function sw(context: BrowserContext) {
  let [worker] = context.serviceWorkers()
  if (!worker)
    worker = await context.waitForEvent('serviceworker', { timeout: 20000 })
  return worker
}

/** Run something in the service worker, surviving its teardown between calls. */
export async function inWorker<T>(context: BrowserContext, fn: any, arg?: any): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const worker = await sw(context)
      return await worker.evaluate(fn, arg)
    }
    catch (error) {
      lastError = error
      await sleep(500)
    }
  }
  throw lastError
}

async function waitForImportToSettle(context: BrowserContext) {
  let previous = ''
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const current = await inWorker<string>(context, async (key: string) => {
      const state = (await chrome.storage.local.get(key))[key]
      return state ? `${state.status}:${state.updatedAt}:${state.finishedAt}` : 'none'
    }, IMPORT_STATE_KEY)
    if (current !== 'none' && !current.startsWith('running') && current === previous)
      return
    previous = current
    await sleep(500)
  }
  throw new Error(`the install-time import never settled, last state: ${previous}`)
}

/**
 * Put the profile back to a known state: no visits, no lists, no silences, the
 * import finished on a fixed date, and default settings in the project's theme.
 *
 * A throwaway profile, so the whole area is cleared rather than picked through
 * the way `visit-reset.ts` does it for a real one. The lookalike index is built
 * from the visits and kept in memory, so it is rebuilt after.
 *
 * Anything a scenario patched into the worker (see `patchWorker`) is put back.
 * What the background caches in memory on its own – a followed short link for
 * five minutes, a family check for ten – is not reachable from here and stays,
 * so a scenario that depends on one of those should use a hostname of its own.
 */
/**
 * `SHOTS_SCALE=150 just shots …` draws every case at that popup text size (the
 * A- / A+ setting, 80 to 150), to look for what a larger or smaller size breaks.
 * A case that sets the size itself still wins.
 */
const SCALE = process.env.SHOTS_SCALE ? { popupFontSize: Number(process.env.SHOTS_SCALE) } : {}

async function resetProfile(context: BrowserContext, theme: Theme) {
  await inWorker(context, async ({ key, state, settings }: any) => {
    const g = globalThis as any
    // Taken off the list first, so an undo that throws is not tried again on
    // every reset after it, and run newest first, so two patches of the same
    // thing unwind to the original
    const undos: (() => void)[] = g.__shotsUndo ?? []
    g.__shotsUndo = []
    for (const undo of undos.reverse()) {
      try {
        undo()
      }
      catch (error) {
        console.error('a worker patch could not be undone', error)
      }
    }
    await chrome.storage.local.clear()
    await chrome.storage.local.set({ [key]: state })
    await chrome.storage.sync.clear()
    await chrome.storage.sync.set({ settings: JSON.stringify(settings) })
  }, { key: IMPORT_STATE_KEY, state: SETTLED_IMPORT, settings: { ...defaults.get(context), theme, ...SCALE } })
  await rebuildLookalikeIndex(context)
}

/**
 * The call the options page makes after an import. A service worker cannot send
 * a runtime message to itself, so it goes from an extension page.
 */
export async function rebuildLookalikeIndex(context: BrowserContext) {
  await fromExtensionPage(context, () => (globalThis as any).chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))
}

/** Run something on an extension page, for the messages the worker cannot send itself. */
async function fromExtensionPage<T>(context: BrowserContext, fn: () => Promise<T>): Promise<T> {
  const id = (await sw(context)).url().split('/')[2]
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${id}/dist/welcome/index.html`)
    return await page.evaluate(fn)
  }
  finally {
    await page.close()
  }
}

export interface Seed {
  visits: number
  /** Separate days the site was used on. Defaults to a third of the visits. */
  activeDays?: number
  /** Days since the first visit. Defaults to a year. */
  ageDays?: number
  ignored?: boolean
}

/**
 * Give hostnames a visit history. Dates are relative to now, so "days since the
 * first visit" reads the same every day the run is made.
 */
export async function seed(context: BrowserContext, records: Record<string, Seed>) {
  const now = Date.now()
  const entries = Object.fromEntries(Object.entries(records).map(([host, s]) => [host, {
    count: s.visits,
    activeDays: s.activeDays ?? Math.max(1, Math.round(s.visits / 3)),
    firstSeen: now - (s.ageDays ?? 365) * DAY,
    lastSeen: now - 2 * DAY,
    ignored: s.ignored ?? false,
  }]))
  await inWorker(context, async (values: any) => chrome.storage.local.set(values), entries)
  await rebuildLookalikeIndex(context)
}

/** Familiar under the shipped rules: plenty of visits, days and age. */
export const FAMILIAR: Seed = { visits: 120, activeDays: 60, ageDays: 400 }

export async function patchSettings(context: BrowserContext, patch: Record<string, unknown>) {
  await inWorker(context, async (values: Record<string, any>) => {
    const stored = await chrome.storage.sync.get('settings')
    const current = stored.settings ? JSON.parse(stored.settings) : {}
    for (const [key, value] of Object.entries(values)) {
      // One level of merging, for linkSafety and familiarity
      current[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(current[key] ?? {}), ...value }
        : value
    }
    await chrome.storage.sync.set({ settings: JSON.stringify(current) })
  }, patch)
}

// ==========================================
// Pages
// ==========================================

/** A page that looks like a site, so the extension's UI is seen over something. */
export function sitePage(title: string, body: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>
  body { margin: 0; font: 16px/1.5 sans-serif; color: #222; background: #f4f4f0 }
  header { background: #2d4a6b; color: white; padding: 14px 32px; font-size: 20px; font-weight: bold }
  main { padding: 24px 32px; max-width: 720px }
  a { color: #1a5fb4 }
  input, textarea { font-size: 16px; padding: 6px 8px; width: 320px; display: block; margin: 8px 0 }
</style></head>
<body><header>${title}</header><main>${body}</main></body></html>`
}

/** Serve a made-up site to the page and go there. Nothing reaches the network. */
export async function openSite(page: Page, url: string, html: string) {
  await page.route(`${new URL(url).origin}/**`, route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto(url)
  await page.waitForLoadState('load')
  // The content script mounts after fetching its stylesheet, and the verdict
  // comes back from the background after that
  await page.waitForTimeout(1500)
}

/**
 * Stop the endless animations inside the extension's shadow root, the pulsing
 * border of the warning above all.
 *
 * `animations: 'disabled'` reaches what `document.getAnimations()` lists, and
 * that does not take in a closed shadow root, so the warning was photographed
 * at a different point of its pulse every time. The DevTools protocol can write
 * into a closed root, so every element there that runs a keyframe animation
 * gets it switched off in its inline style.
 */
async function freezeShadowAnimations(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const roots: number[] = []
    const walk = (node: any) => {
      for (const shadow of node.shadowRoots ?? [])
        roots.push(shadow.nodeId)
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
        walk(child)
    }
    walk(root)
    for (const nodeId of roots) {
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId, selector: '[class*="animate-"]' })
      for (const id of nodeIds) {
        // Added to whatever inline style the element already has, not put in its place
        const { attributes } = await cdp.send('DOM.getAttributes', { nodeId: id })
        const at = attributes.indexOf('style')
        const style = at >= 0 ? attributes[at + 1] : ''
        await cdp.send('DOM.setAttributeValue', { nodeId: id, name: 'style', value: `${style};animation:none!important` })
      }
    }
  }
  finally {
    await cdp.detach()
  }
}

/**
 * Every piece of text inside a shadow root on the page.
 *
 * The in-page UI lives in a closed shadow root in a production build and no
 * locator reaches into one. The DevTools protocol does.
 */
export async function shadowText(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const parts: string[] = []
    const walk = (node: any, inShadow: boolean) => {
      if (inShadow && node.nodeType === 3 && node.nodeValue)
        parts.push(node.nodeValue)
      // The stylesheet is text too, and would match half the needles
      if (node.nodeName === 'STYLE')
        return
      for (const child of node.children ?? [])
        walk(child, inShadow)
      for (const child of node.shadowRoots ?? [])
        walk(child, true)
    }
    walk(root, false)
    return parts.join(' ').replace(/\s+/g, ' ')
  }
  finally {
    await cdp.detach()
  }
}

/**
 * Wait until the extension's in-page UI says every one of `needles`.
 *
 * Give it something that only the state being shot would say – the hostname as
 * well as the heading – so that a tooltip still loading, or one about the wrong
 * link, does not pass for it.
 */
export async function waitForUi(page: Page, ...needles: string[]) {
  const deadline = Date.now() + 15000
  let text = ''
  let missing = needles
  while (Date.now() < deadline) {
    text = await shadowText(page)
    missing = needles.filter(needle => !text.includes(needle))
    if (missing.length === 0)
      return
    await page.waitForTimeout(250)
  }
  // Said in full, because this is the line the gallery shows for the failure
  throw new Error(`The extension's in-page UI never showed "${missing.join('", "')}". ${text ? `What it did show: "${text.trim().slice(0, 240)}"` : 'Nothing of it was on the page at all.'}`)
}

/**
 * Swap something in the service worker for the length of one scenario.
 *
 * `install` runs in the worker, makes its change and returns a function that
 * undoes it, which `resetProfile` calls before the next scenario. Sent as source
 * text, so it can use nothing from this file: anything it needs comes in as
 * `arg`, which has to survive JSON. A worker that restarts drops the
 * patch on its own, so a patch has to be made right before it is needed.
 */
export async function patchWorker<A = undefined>(context: BrowserContext, install: (arg: A) => () => void, arg?: A) {
  await inWorker(context, `(() => {
    const g = globalThis
    g.__shotsUndo ??= []
    g.__shotsUndo.push((${install.toString()})(${JSON.stringify(arg ?? null)}))
  })()`)
}

/** Send what a context-menu item, or a frame on the page, would send to the tab showing `url`. */
export async function fromMenu(context: BrowserContext, url: string, message: Record<string, unknown>) {
  await inWorker(context, async ({ pattern, msg }: any) => {
    const [tab] = await chrome.tabs.query({ url: pattern })
    // Not waited on: most of these are never answered, and the frame's paste
    // is answered only once somebody presses a button in the dialog
    chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }).catch(() => {})
  }, { pattern: `${new URL(url).origin}/*`, msg: message })
}

/**
 * Press a button in the extension's in-page UI, found by its text.
 *
 * The UI is in a closed shadow root, so no locator finds the button. The
 * DevTools protocol finds the text node and where it is drawn, and a real
 * mouse click lands there, which is what a person would do.
 */
export async function clickUi(page: Page, text: string) {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    let target: number | undefined
    const walk = (node: any, parentId: number | undefined, inShadow: boolean) => {
      if (target)
        return
      if (inShadow && node.nodeType === 3 && node.nodeValue?.trim().startsWith(text))
        target = parentId
      for (const child of node.children ?? [])
        walk(child, node.nodeId, inShadow)
      for (const child of node.shadowRoots ?? [])
        walk(child, node.nodeId, true)
    }
    walk(root, undefined, false)
    if (!target)
      throw new Error(`No button saying "${text}" in the extension's in-page UI`)
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: target })
    const [x1, y1, , , x3, y3] = model.border
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2)
  }
  finally {
    await cdp.detach()
  }
}
