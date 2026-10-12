// End-to-end tests against Visilant in desktop Firefox.
//
//   just fe              – build for Firefox, then run these
//   pnpm test:firefox    – run these against whatever is in extension/ now
//
// FIREFOX names the browser binary. Pass a test's name, or part of it, to run
// only the tests that match.
//
// Why not Playwright: it cannot load an extension into Firefox. This drives a
// stock Firefox over WebDriver BiDi instead (see bidi.ts), with a fresh profile
// and a fresh temporary install for every test. The pages come from a local
// server, under made-up names that the profile resolves to it and treats as
// secure, which the Clipboard API requires.
//
// The cases are the Firefox half of e2e/clipboard-api.spec.ts, on the same page.
/* eslint-disable no-console -- this file is the test runner, and its report is
   what it exists to print */
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { clickFixPage } from '../e2e/clipboard-page'
import { Firefox, firefoxBinary, sleep } from './bidi'

const EXTENSION_ID = 'visilant@xcoder.non-existant-domain.com'
/** Fixed, so the extension's own pages are at an address known in advance. */
const EXTENSION_UUID = '6f0c5c4e-3c1b-4a8e-9d2a-7b1f0e5a9c31'

const UNFAMILIAR = 'clickfix-api.test'
const FAMILIAR = 'clickfix-known.test'
const SILENCED = 'clickfix-quiet.test'
const HOSTS = [UNFAMILIAR, FAMILIAR, SILENCED]
const DAY = 24 * 60 * 60 * 1000

const SHOTS = process.env.SHOTS

interface Case { name: string, run: (t: Harness) => Promise<void> }

const cases: Case[] = []
function test(name: string, run: Case['run']) {
  cases.push({ name, run })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(message)
}

async function poll<T>(read: () => Promise<T>, want: T, timeout: number, what: string) {
  const deadline = Date.now() + timeout
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (last === want)
      return
    await sleep(250)
  }
  throw new Error(`${what}: still ${JSON.stringify(last)} after ${timeout} ms, wanted ${JSON.stringify(want)}`)
}

// ==========================================
// Harness
// ==========================================

class Harness {
  constructor(readonly firefox: Firefox, readonly page: string, readonly extensionPage: string, readonly port: number, readonly name: string) {}

  url(host: string) {
    return `http://${host}:${this.port}/`
  }

  async open(host: string) {
    await this.firefox.send('browsingContext.navigate', { context: this.page, url: this.url(host), wait: 'complete' })
    // Judged first, as a real page would be by the time somebody reads it and clicks
    await sleep(2500)
  }

  evaluate<T>(expression: string) {
    return this.firefox.evaluate<T>(this.page, expression)
  }

  /** Click an element, in the page or in one of its same-origin frames. */
  async click(selector: string, frame?: string) {
    const point = await this.evaluate<{ x: number, y: number } | null>(`(() => {
      let offsetX = 0, offsetY = 0, doc = document
      ${frame
        ? `const frame = document.querySelector(${JSON.stringify(frame)})
      const outer = frame.getBoundingClientRect()
      offsetX = outer.left + frame.clientLeft
      offsetY = outer.top + frame.clientTop
      doc = frame.contentDocument`
        : ''}
      const el = doc && doc.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const box = el.getBoundingClientRect()
      return { x: offsetX + box.left + box.width / 2, y: offsetY + box.top + box.height / 2 }
    })()`)
    assert(point, `nothing on the page matches ${selector}${frame ? ` in ${frame}` : ''}`)
    await this.firefox.clickAt(this.page, point.x, point.y)
  }

  /** Same hit test as the Playwright suite: the warning holds the top right corner. */
  warningShowing() {
    return this.evaluate<boolean>(`(() => {
      const el = document.elementFromPoint(window.innerWidth - 30, 30)
      return Boolean(el && el.style && el.style.getPropertyValue('z-index') === '2147483647')
    })()`)
  }

  async expectWarning() {
    await poll(() => this.warningShowing(), true, 10000, 'the warning')
    if (SHOTS) {
      // The panel slides in, and a capture taken at once catches it half way
      await sleep(1500)
      await this.firefox.screenshot(this.page, path.join(SHOTS, `firefox-${this.firefox.version}-${this.name.replace(/\W+/g, '-')}.png`))
    }
  }

  /** Silence, after proving the wrapper was there and the write went through. */
  /** The cross in the warning's corner, found by where the panel draws it. */
  async closeWarning() {
    // The panel slides in, and a click during that lands beside the button
    await sleep(1000)
    const width = await this.evaluate<number>('window.innerWidth')
    await this.firefox.clickAt(this.page, width - 55, 48)
  }

  async expectNoWarning() {
    assert(await this.evaluate('window.wrapperInstalled()'), 'the clipboard wrapper is not in the page')
    await poll(() => this.evaluate('window.__lastWrite'), 'ok', 5000, 'the page\'s write')
    await sleep(2500)
    assert(!(await this.warningShowing()), 'a warning is showing')
  }

  async storage(expression: string) {
    return this.firefox.evaluate(this.extensionPage, expression)
  }

  async seed(host: string, record: Record<string, unknown>) {
    await this.storage(`browser.storage.local.set({ ${JSON.stringify(host)}: ${JSON.stringify(record)} })`)
  }

  async patchSettings(patch: Record<string, unknown>) {
    await this.storage(`browser.storage.sync.get('settings').then(stored => {
      const current = stored.settings ? JSON.parse(stored.settings) : {}
      return browser.storage.sync.set({ settings: JSON.stringify({ ...current, ...${JSON.stringify(patch)} }) })
    })`)
  }

  /**
   * Wait out the import the extension starts on install. It writes the same
   * records the tests seed, so a seed laid before it settles is overwritten.
   */
  async waitForAutoImport() {
    let previous = ''
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const current = await this.storage(`browser.storage.local.get('__visilantHistoryImport').then(r => {
        const s = r.__visilantHistoryImport
        return s ? s.status + ':' + s.updatedAt + ':' + s.finishedAt : 'none'
      })`) as string
      if (current !== 'none' && !current.startsWith('running') && current === previous)
        return
      previous = current
      await sleep(500)
    }
    throw new Error(`the install-time import never settled, last state: ${previous}`)
  }
}

// ==========================================
// Writes to the clipboard on an unfamiliar site
// ==========================================

test('writeText on an unfamiliar site raises the copy warning', async (t) => {
  await t.open(UNFAMILIAR)
  assert(!(await t.warningShowing()), 'a warning was up before anything happened')
  await t.click('#write-text')
  await t.expectWarning()
  // Warned about, never blocked
  await poll(() => t.evaluate('window.__lastWrite'), 'ok', 5000, 'the page\'s write')
})

test('write with a ClipboardItem raises the copy warning', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#write-item')
  await t.expectWarning()
  await poll(() => t.evaluate('window.__lastWrite'), 'ok', 5000, 'the page\'s write')
})

test('execCommand copy still raises the copy warning', async (t) => {
  await t.open(UNFAMILIAR)
  assert(await t.evaluate('window.wrapperInstalled()'), 'the clipboard wrapper is not in the page')
  await t.click('#exec-copy')
  await t.expectWarning()
})

test('the page\'s first script already finds the wrapper in place', async (t) => {
  await t.open(UNFAMILIAR)
  assert(await t.evaluate('window.__wrappedAtFirstScript'), 'the page ran before the wrapper went in')
})

test('a page that listens for the signal cannot swallow it', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#swallow')
  await t.expectWarning()
})

test('document.open() does not take the signal away', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#reopen')
  await sleep(500)
  await t.click('#after-reopen')
  await t.expectWarning()
})

test('a write from inside a frame raises the warning about the page', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#frame-write', '#inner')
  await t.expectWarning()
})

test('a write from inside a blob frame raises the warning about the page', async (t) => {
  // Firefox gave a blob frame no extension script at all until the frame guard
  // and the wrapper both asked for match_origin_as_fallback
  await t.open(UNFAMILIAR)
  await t.click('#blob-write', '#blob')
  await t.expectWarning()
})

test('typing into a blob frame is warned about', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#blob-input', '#blob')
  await t.firefox.type(t.page, 'hunter2')
  await t.expectWarning()
})

test('a page that steals the channel node cannot swallow the signal on it', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#steal-channel')
  await t.expectWarning()
  assert(!(await t.evaluate('window.__stoleNode || false')), 'the page got hold of the channel node')
})

test('a frame\'s wrapper borrowed by the page, frame removed after the write, still warns', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#borrow-then-remove')
  await poll(() => t.evaluate('window.__lastWrite'), 'ok', 5000, 'the page\'s write')
  await t.expectWarning()
})

test('a frame\'s wrapper borrowed by the page, frame removed at once, still warns', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#borrow-remove-now')
  // The write outlives its frame, which is what makes this worth warning about
  await poll(() => t.evaluate('window.__lastWrite'), 'ok', 5000, 'the page\'s write')
  await t.expectWarning()
})

test('KNOWN LIMITATION: a clean writeText taken from a frame made this instant goes unwarned', async (t) => {
  // See the Playwright twin of this test. In Firefox 140 even an empty frame
  // lends a clean method, in later versions a srcdoc, blob or sandboxed one.
  // Pinned as it is today, so it fails both when the setup breaks and when a
  // browser closes the gap, which is the signal to update the README.
  await t.open(UNFAMILIAR)
  assert(await t.evaluate('window.wrapperInstalled()'), 'the clipboard wrapper is not in the page')
  await t.click('#fresh-frame')
  await poll(() => t.evaluate('window.__lastWrite'), 'ok', 5000, 'the page\'s write')
  await sleep(2500)
  assert(!(await t.warningShowing()), 'a warning is showing: the limitation may be gone, update this test and the README')
})

test('made-up events spend no warning, and the real ones still get theirs', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#synthetic')
  assert(await t.evaluate('window.__syntheticFired'), 'the page did not fire its events')
  await sleep(2000)
  assert(!(await t.warningShowing()), 'a made-up event raised a warning')
  await t.click('#field')
  await t.firefox.type(t.page, 'hunter2')
  await t.expectWarning()
})

test('a copy warning does not use up the typing warning', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#write-text')
  await t.expectWarning()
  await t.closeWarning()
  await poll(() => t.warningShowing(), false, 5000, 'the closed warning')
  await t.click('#field')
  await t.firefox.type(t.page, 'hunter2')
  await t.expectWarning()
})

test('after document.open() typing is still warned about', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#reopen')
  await sleep(500)
  await t.click('#after-field')
  await t.firefox.type(t.page, 'hunter2')
  await t.expectWarning()
})

test('after document.open() a copy is still warned about', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#reopen')
  await sleep(500)
  await t.click('#after-copy')
  await t.expectWarning()
})

test('a warning on screen through document.open() still closes', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#write-text')
  await t.expectWarning()
  // The page reopens itself, as a script would, while the warning is up
  await t.evaluate('document.getElementById(\'reopen\').click()')
  await sleep(1000)
  await t.expectWarning()
  await t.closeWarning()
  await poll(() => t.warningShowing(), false, 5000, 'the closed warning')
})

test('typing into a blank frame the page rewrote is warned about', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#frame-reopen')
  await sleep(500)
  await t.click('#opened-field', '#opened')
  await t.firefox.type(t.page, 'hunter2')
  await t.expectWarning()
})

test('a made-up copy spends no copy warning', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#synthetic')
  await sleep(1500)
  assert(!(await t.warningShowing()), 'a made-up event raised a warning')
  await t.click('#exec-copy')
  await t.expectWarning()
})

test('a page that keeps swapping its root still gets its UI back', async (t) => {
  await t.open(UNFAMILIAR)
  await t.evaluate('document.getElementById(\'swap-root\').click()')
  await poll(() => t.evaluate('window.__swapsDone === true'), true, 10000, 'the swaps')
  await sleep(1500)
  await t.click('#write-text')
  await t.expectWarning()
  await t.closeWarning()
  await poll(() => t.warningShowing(), false, 5000, 'the closed warning')
})

test('typing in a frame turned away under a copy warning is warned about once it closes', async (t) => {
  await t.open(UNFAMILIAR)
  await t.click('#write-text')
  await t.expectWarning()
  await t.click('#blob-input', '#blob')
  await t.firefox.type(t.page, 'hun')
  await sleep(1000)
  await t.closeWarning()
  await poll(() => t.warningShowing(), false, 5000, 'the closed warning')
  await t.click('#blob-input', '#blob')
  await t.firefox.type(t.page, 'ter2')
  await t.expectWarning()
})

// ==========================================
// Nothing to warn about
// ==========================================

test('a familiar site writing to the clipboard raises no warning', async (t) => {
  await t.waitForAutoImport()
  await t.seed(FAMILIAR, { count: 42, activeDays: 12, firstSeen: Date.now() - 30 * DAY, lastSeen: 1, ignored: false })
  await t.open(FAMILIAR)
  await t.click('#write-text')
  await t.expectNoWarning()
})

test('a site whose warnings were silenced raises no warning', async (t) => {
  await t.waitForAutoImport()
  await t.seed(SILENCED, { count: 1, activeDays: 1, firstSeen: Date.now(), lastSeen: 1, ignored: true })
  await t.open(SILENCED)
  await t.click('#write-text')
  await t.expectNoWarning()
})

test('with the copy warning switched off, a write raises nothing', async (t) => {
  await t.patchSettings({ showCopyWarning: false })
  await t.open(UNFAMILIAR)
  await t.click('#write-text')
  await t.expectNoWarning()
})

// ==========================================
// Runner
// ==========================================

/** A copy of the build, so a rebuild for Chrome halfway through cannot change it. */
function snapshotExtension(): string {
  const source = path.resolve(__dirname, '../extension')
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'))
  if (!manifest.background?.scripts)
    throw new Error('extension/ holds a Chrome build. Run `pnpm build-firefox` first, or use `just fe`.')
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'visilant-extension-'))
  fs.cpSync(source, copy, { recursive: true })
  return copy
}

async function start(binary: string, extension: string, port: number, name: string): Promise<Harness> {
  const firefox = await Firefox.launch(binary, {
    'network.dns.localDomains': HOSTS.join(','),
    'dom.securecontext.allowlist': HOSTS.join(','),
    'extensions.webextensions.uuids': JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID }),
  })
  try {
    await firefox.send('webExtension.install', { extensionData: { type: 'path', path: extension } })

    // The welcome tab the extension opens on install is an extension page with
    // the storage API in it, which is all the tests need from that side
    let extensionPage: string | undefined
    for (let attempt = 0; attempt < 40 && !extensionPage; attempt++) {
      extensionPage = (await firefox.contexts()).find(c => c.url.startsWith(`moz-extension://${EXTENSION_UUID}/`))?.context
      if (!extensionPage)
        await sleep(250)
    }
    assert(extensionPage, 'the extension opened no page of its own after installing')

    // The newest tab, in front: a background tab is sent no animation frames
    const { context: page } = await firefox.send('browsingContext.create', { type: 'tab' })
    await firefox.send('browsingContext.activate', { context: page })
    return new Harness(firefox, page, extensionPage, port, name)
  }
  catch (error) {
    await firefox.close()
    throw error
  }
}

async function main() {
  const binary = firefoxBinary()
  const extension = snapshotExtension()
  if (SHOTS)
    fs.mkdirSync(SHOTS, { recursive: true })

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(clickFixPage())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  const only = process.argv[2]
  const chosen = only ? cases.filter(c => c.name.includes(only)) : cases
  if (!chosen.length) {
    console.error(`no test matches ${JSON.stringify(only)}`)
    process.exit(1)
  }

  let failed = 0
  let version = ''
  for (const [index, testCase] of chosen.entries()) {
    const started = Date.now()
    let error: unknown
    try {
      const harness = await start(binary, extension, port, testCase.name)
      version = harness.firefox.version
      try {
        await testCase.run(harness)
      }
      finally {
        await harness.firefox.close()
      }
    }
    catch (caught) {
      error = caught
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    if (error) {
      failed++
      console.log(`not ok ${index + 1} – ${testCase.name}`)
      console.log(`    ${error instanceof Error ? error.message : String(error)}`.replace(/\n/g, '\n    '))
    }
    else {
      console.log(`ok ${index + 1} – ${testCase.name} (${seconds}s)`)
    }
  }

  server.close()
  fs.rmSync(extension, { recursive: true, force: true })
  console.log(`\nFirefox ${version}`)
  console.log(`1..${chosen.length}  ${chosen.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
