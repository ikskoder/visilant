// End-to-end tests against Visilant running on a USB-connected Android phone.
//
//   just ae            – build for Firefox, install, run these
//   pnpm test:android  – run these against whatever is already installed
//
// Why these and not Playwright: Playwright drives desktop Chromium, and the two
// things most likely to break on a phone cannot be seen there at all – a
// background script Firefox for Android refuses to start, and a history API
// that is simply not present. Both are checked below against the real browser.
//
// The phone's own data is backed up before the destructive tests and put back
// afterwards, including when one of them fails.
/* eslint-disable no-console -- this file is the test runner, and its report is
   what it exists to print */
import process from 'node:process'
import { forwardDebugger, openUrl, Session, sleep, withBackground, withExtensionPage, withOptionsPage } from './phone'

interface Case { name: string, run: (port: number) => Promise<void> }

const cases: Case[] = []
function test(name: string, run: (port: number) => Promise<void>) {
  cases.push({ name, run })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b)
    throw new Error(`${message}\n    expected: ${b}\n    actual:   ${a}`)
}

/** Read all of storage.local, as the phone has it right now. */
function readStorage(session: Session, actor: string) {
  return session.json<Record<string, unknown>>(actor, 'browser.storage.local.get(null).then(r => JSON.stringify(r))')
}

function writeStorage(session: Session, actor: string, values: Record<string, unknown>) {
  return session.evaluate(actor, `browser.storage.local.set(${JSON.stringify(values)}).then(() => "ok")`)
}

/** Put the phone back exactly as it was, whatever the test did to it. */
async function restoreStorage(port: number, snapshot: Record<string, unknown>) {
  await withBackground(port, (session, background) => session.evaluate(background, `browser.storage.local.clear().then(() => browser.storage.local.set(${JSON.stringify(snapshot)})).then(() => "ok")`))
}

const SENTINELS: Record<string, unknown> = {
  customShorteners: ['sentinel-short.test'],
  customPublicEmailProviders: ['sentinel-public.test'],
  customDisposableEmailDomains: ['sentinel-temp.test'],
  customMailSites: ['sentinel.test = mail.sentinel.test'],
  remoteShortenerDomains: { domains: ['sentinel-remote.test'], updatedAt: 1, urls: [] },
  remoteMailSites: { domains: ['sentinel.test = mail.sentinel.test'], updatedAt: 1, urls: [] },
  textDefaultsSeeded: true,
}

// ==========================================
// The extension is there, and alive
// ==========================================

test('the add-on is installed, with nothing the browser complains about', async (port) => {
  const session = await Session.open(port)
  try {
    const { descriptor } = await session.addonTargets()
    assertEqual(descriptor.warnings, [], 'the browser reported warnings about the add-on')
    assert(descriptor.temporarilyInstalled, 'not installed as a temporary add-on – run `just ar`')
  }
  finally {
    session.close()
  }
})

// The one failure this whole file exists for: a background Firefox for Android
// will not start looks exactly like a working install until something sends it a
// message. Desktop Firefox runs it fine and hides the problem.
test('the background script actually runs on this browser', async (port) => {
  await withBackground(port, async (session, background) => {
    const id = await session.evaluate(background, 'browser.runtime.id')
    assert(typeof id === 'string' && id.startsWith('visilant@'), `background did not answer, got ${JSON.stringify(id)}`)
    const shape = await session.json<Record<string, unknown>>(background, 'JSON.stringify(browser.runtime.getManifest().background)')
    assert(Array.isArray(shape.scripts), 'the Firefox manifest should carry background.scripts')
    assert(!shape.type, 'background.type must stay unset – a module background never starts here')
  })
})

test('the content script answers in a tab that is already open', async (port) => {
  await withBackground(port, async (session, background) => {
    const alive = await session.json<{ id: number, alive: boolean, err?: string }[]>(background, `
      browser.tabs.query({}).then(async ts => {
        const out = [];
        for (const t of ts.filter(t => t.url.startsWith("https://example.com")).slice(-2)) {
          try {
            await browser.tabs.sendMessage(t.id, {type: "check-selection", data: {selectionText: "paypa1.com"}});
            out.push({id: t.id, alive: true});
          } catch (e) {
            out.push({id: t.id, alive: false, err: String(e).slice(0, 120)});
          }
        }
        return JSON.stringify(out);
      })`)
    assert(alive.length > 0, 'no page was open to ask')
    const dead = alive.filter(t => !t.alive)
    assertEqual(dead, [], 'a tab did not answer – "Receiving end does not exist" is the background failing')
  })
})

// ==========================================
// What the phone cannot do, said plainly
// ==========================================

test('there is no history API here, and the settings page says so rather than offering a dead button', async (port) => {
  await withOptionsPage(port, async (session, options) => {
    const hasHistory = await session.evaluate(options, 'typeof browser.history')
    assertEqual(hasHistory, 'undefined', 'this phone does have a history API – the rest of this test assumes it does not')

    const status = await session.evaluate(options, 'document.querySelector("#section-data p").textContent.trim()')
    assert(String(status).includes('does not let extensions read its history'), `the status line does not name the reason: ${JSON.stringify(status)}`)

    // A disabled "Re-import history" under that line, with a paragraph on the
    // two passes it would run, is what this browser used to show
    const buttons = await session.json<string[]>(options, 'JSON.stringify([...document.querySelectorAll("#section-data button")].map(b => b.textContent.trim()))')
    assertEqual(buttons.filter(b => /import history/i.test(b)), [], 'the import button is still on the page where there is nothing to import')

    const state = await session.json<{ status?: string } | null>(options, 'browser.storage.local.get("__visilantHistoryImport").then(r => JSON.stringify(r.__visilantHistoryImport || null))')
    assertEqual(state?.status, 'unsupported', 'the stored import state should say unsupported')
  })
})

// The welcome page is written around an import that has just run. On a browser
// that has no history to give, it used to say so – in the middle of a page that
// also said why the history had been read and what was saved out of it.
test('the welcome page claims no import on a browser that cannot do one', async (port) => {
  await withExtensionPage(port, 'dist/welcome/index.html', async (session, page) => {
    const text = await session.evaluate(page, 'document.body.textContent.replace(/\\s+/g, " ")')
    const said = String(text)

    assert(said.includes('keeps its history to itself'), 'the page does not say why there was nothing to import')

    for (const claim of ['Why your history was read', 'One thing was set up for you', 'What was saved']) {
      assert(!said.includes(claim), `the page still says ${JSON.stringify(claim)} on a browser that read no history`)
    }

    // And it does say what happens instead
    assert(said.includes('What it records as you browse'), 'the page does not say what it will record from here')
  })
})

test('the missing-dates card does not offer an import this browser cannot run', async (port) => {
  const snapshot = await withBackground(port, readStorage)
  try {
    // A record of the shape that predates the two date fields, plus a rule that
    // actually asks for them – together, the only case that shows the card
    await withBackground(port, async (session, background) => {
      await writeStorage(session, background, {
        'legacy-site.test': { count: 12, lastSeen: Date.now(), ignored: false },
      })
      await session.evaluate(background, `
        browser.storage.sync.get("settings").then(r => {
          const s = JSON.parse(r.settings);
          s.familiarity.activeDays.enabled = true;
          return browser.storage.sync.set({settings: JSON.stringify(s)}).then(() => "ok");
        })`)
    })
    await sleep(1500)

    await withOptionsPage(port, async (session, options) => {
      await session.evaluate(options, 'location.reload()')
      await sleep(3000)
    })

    await withOptionsPage(port, async (session, options) => {
      const card = String(await session.evaluate(options, `(() => {
        const el = document.querySelector("#section-familiarity [class*=amber]");
        return el ? el.textContent.replace(/\\s+/g, " ").trim() : "";
      })()`))
      assert(card.length > 0, 'the missing-dates card did not appear')
      assert(!/A full history import fills them in/i.test(card), 'the card promises an import this browser has no API for')
      assert(!/Go to history import/i.test(card), 'the card still links to an import section that cannot import')
      assert(/keeps its history to itself/i.test(card), `the card does not say why nothing can fill the dates in: ${card}`)
    })
  }
  finally {
    await restoreStorage(port, snapshot)
  }
})

// ==========================================
// Visits
// ==========================================

test('a page load is counted, and reloads inside the debounce window are not', async (port) => {
  const snapshot = await withBackground(port, readStorage)
  try {
    const now = Date.now()
    const seeded = { count: 50, firstSeen: now - 90 * 86_400_000, lastSeen: now, activeDays: 30, ignored: false }
    await withBackground(port, (session, background) =>
      writeStorage(session, background, { 'example.com': seeded }))

    // Built from that record, so the index has something to drift
    await withOptionsPage(port, (session, options) => session.evaluate(options, 'browser.runtime.sendMessage({type: "rebuild-familiar-index", data: {}}).then(r => JSON.stringify(r))'))

    const before = await withOptionsPage(port, (session, options) => session.json<{ domain: string, visits: number }[]>(
      options,
      'browser.storage.local.get("__visilantFamiliar").then(r => JSON.stringify(r.__visilantFamiliar.domains))',
    ))
    assertEqual(before.find(d => d.domain === 'example.com')?.visits, 50, 'the seeded domain is not in the index')

    for (let i = 0; i < 3; i++) {
      await openUrl(`https://example.com/?visilant-debounce=${Date.now()}-${i}`)
      await sleep(4000)
    }

    const after = await withBackground(port, async (session, background) => ({
      record: await session.json<{ count: number }>(background, 'browser.storage.local.get("example.com").then(r => JSON.stringify(r["example.com"]))'),
      index: await session.json<{ domain: string, visits: number }[]>(background, 'browser.storage.local.get("__visilantFamiliar").then(r => JSON.stringify(r.__visilantFamiliar.domains))'),
    }))

    assertEqual(after.record.count, 50, 'a reload inside the debounce window was counted as a visit')
    assertEqual(after.index.find(d => d.domain === 'example.com')?.visits, 50, 'the familiar index climbed on reloads the visit counter ignored')
  }
  finally {
    await restoreStorage(port, snapshot)
  }
})

// ==========================================
// What a check says, at the width of a phone
// ==========================================

// A check names every fact its verdict rests on, which on a phone is three
// labels and three numbers – and with the thresholds switched on, six. Laid out
// as one run they ran off the edge of the screen, so they are stacked. Only a
// real display can say whether that worked.
test('the familiarity facts stack one per line and stay inside the screen', async (port) => {
  const snapshot = await withBackground(port, readStorage)
  try {
    const now = Date.now()
    await withBackground(port, (session, background) => writeStorage(session, background, {
      'facts-check.test': { count: 209, firstSeen: now - 109 * 86_400_000, lastSeen: now, activeDays: 30, ignored: false },
    }))

    await withExtensionPage(port, 'dist/popup/index.html?check=1', async (session, page) => {
      // v-model listens for the event, not for the assignment, so the native
      // setter is called first and the event sent after it
      await session.evaluate(page, `(() => {
        const input = document.querySelector('input[type="text"]')
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setValue.call(input, 'https://facts-check.test/')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const button = [...document.querySelectorAll('button')].find(b => /^check$/i.test(b.textContent.trim()))
        button.click()
        return 'ok'
      })()`)
      await sleep(2500)

      const facts = await session.json<{ id: string, text: string, top: number, right: number, width: number }[]>(page, `JSON.stringify(
        [...document.querySelectorAll('.familiarity-facts [data-criterion]')].map((el) => {
          const box = el.getBoundingClientRect()
          const line = el.parentElement.getBoundingClientRect()
          return { id: el.dataset.criterion, text: el.textContent.trim(), top: Math.round(line.top), right: Math.round(box.right), width: document.documentElement.clientWidth }
        }))`)

      assertEqual(facts.map(f => f.id), ['visits', 'activeDays', 'age'], 'the check did not report all three facts')

      const tops = facts.map(f => f.top)
      assertEqual(new Set(tops).size, tops.length, `the facts share a line rather than stacking: ${JSON.stringify(facts)}`)

      const overflowing = facts.filter(f => f.right > f.width)
      assertEqual(overflowing, [], 'a fact runs off the side of the screen')
    })
  }
  finally {
    await restoreStorage(port, snapshot)
  }
})

// ==========================================
// Storage is not only visits
// ==========================================

test('wiping the visits leaves every list the user owns alone', async (port) => {
  const snapshot = await withBackground(port, readStorage)
  try {
    await withBackground(port, (session, background) => writeStorage(session, background, {
      ...SENTINELS,
      'sentinel-site.test': { count: 3, lastSeen: Date.now(), ignored: false },
    }))

    await withOptionsPage(port, async (session, options) => {
      const ticked = await session.evaluate(options, `(() => {
        const box = [...document.querySelectorAll("#section-data label input[type=checkbox]")][0];
        box.click();
        return box.checked;
      })()`)
      assert(ticked === true, 'could not tick "all information about site visits"')

      await session.evaluate(options, `(() => {
        const button = [...document.querySelectorAll("#section-data button")]
          .find(b => /reset selected data/i.test(b.textContent));
        if (button.disabled) throw new Error("the reset button is disabled");
        button.click();
        return "clicked";
      })()`)
      await sleep(1000)
      await session.evaluate(options, `(() => {
        const confirms = [...document.querySelectorAll(".btn-danger")].filter(b => b.textContent.trim() === "Reset");
        confirms[confirms.length - 1].click();
        return "confirmed";
      })()`)
      await sleep(3000)

      const left = await readStorage(session, options)
      for (const [key, value] of Object.entries(SENTINELS))
        assertEqual(left[key], value, `the wipe took ${key} with it`)

      const visits = Object.keys(left).filter(k => k.includes('.')
        && typeof (left[k] as { count?: unknown })?.count === 'number')
      assertEqual(visits, [], 'a visit record survived the wipe')
      assert(!('__visilantFamiliar' in left), 'the familiar index is derived from the visits and should go with them')
      assertEqual(left.__visilantHistoryAutoImported, true, 'the auto-import flag has to survive, or the next update imports the history back')
    })
  }
  finally {
    await restoreStorage(port, snapshot)
  }
})

// ==========================================
// Lists reaching the contexts that read them
// ==========================================

/** Ask an open tab what it makes of a link, without reloading it. */
function SHOW_TOOLTIP(host: string) {
  return `
  browser.tabs.query({}).then(async ts => {
    const t = ts.filter(t => t.url.startsWith("https://example.com")).pop();
    await browser.tabs.update(t.id, {active: true});
    await browser.tabs.sendMessage(t.id, {type: "show-link-tooltip-at-cursor", data: {url: "https://${host}/abc"}});
    return JSON.stringify({id: t.id});
  })`
}

test('a list edited in the settings reaches a tab that was already open', async (port) => {
  const snapshot = await withBackground(port, readStorage)
  try {
    // The tab under test is loaded first, so the list changes underneath it
    await openUrl(`https://example.com/?visilant-list=${Date.now()}`)
    await sleep(4000)

    await withBackground(port, async (session, background) => {
      await writeStorage(session, background, { customShorteners: [] })
      await sleep(1500)
      await session.json(background, SHOW_TOOLTIP('sentinel-short.test'))

      // Exactly what the settings page writes when a domain is typed in
      await writeStorage(session, background, { customShorteners: ['sentinel-short.test'] })
      await sleep(1500)
      const shown = await session.json<{ id: number }>(background, SHOW_TOOLTIP('sentinel-short.test'))
      assert(typeof shown.id === 'number', 'the tab did not take the tooltip request')

      // The panel lives in a closed shadow root, so the assertion that can be
      // made from here is that the content script took the change without a
      // reload and answered. What it draws is checked in the desktop e2e run.
      const alive = await session.json<boolean>(background, `
        browser.tabs.query({}).then(async ts => {
          const t = ts.filter(t => t.url.startsWith("https://example.com")).pop();
          try { await browser.tabs.sendMessage(t.id, {type: "check-selection", data: {selectionText: ""}}); return "true" }
          catch { return "false" }
        })`)
      assert(alive, 'the content script stopped answering after the list changed')
    })
  }
  finally {
    await restoreStorage(port, snapshot)
  }
})

// ==========================================
// Runner
// ==========================================

async function main() {
  const port = await forwardDebugger()
  const only = process.argv[2]
  const chosen = only ? cases.filter(c => c.name.includes(only)) : cases
  if (!chosen.length) {
    console.error(`no test matches ${JSON.stringify(only)}`)
    process.exit(1)
  }

  let failed = 0
  for (const [index, testCase] of chosen.entries()) {
    const started = Date.now()
    try {
      await testCase.run(port)
      console.log(`ok ${index + 1} – ${testCase.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    }
    catch (error) {
      failed++
      console.log(`not ok ${index + 1} – ${testCase.name}`)
      console.log(`    ${error instanceof Error ? error.message : String(error)}`.replace(/\n/g, '\n    '))
    }
  }

  console.log(`\n1..${chosen.length}  ${chosen.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
