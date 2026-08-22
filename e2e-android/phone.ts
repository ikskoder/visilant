// Driving the extension on a USB-connected phone.
//
// Firefox for Android gives almost nothing back: no about:debugging, and Gecko
// console output never reaches logcat. The remote debugging socket is the one
// channel there is, and everything below is built on it.
//
// Three quirks decide the shape of this file, all of them found the hard way:
//
// - The background is an event page. It sleeps, and it cannot be started from
//   the outside – opening a page runs the content script, the content script
//   messages the background, and that is what wakes it. So `withBackground`
//   navigates first and catches it while awake.
// - Extension pages – the background and the settings page – are handed out by
//   the add-on's watcher, not the tab's. Tab targets do not materialise on
//   Fenix at all, so a page under test is reached by messaging its content
//   script rather than by evaluating in it.
// - `evaluateJSAsync` resolves promises but has no top-level await, so every
//   expression here is written with `.then`.
import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { Rdp } from './rdp'

const run = promisify(execFile)

export const FIREFOX_PACKAGE = process.env.VISILANT_ANDROID_PACKAGE || 'org.mozilla.fenix'
export const ADDON_ID_PREFIX = 'visilant@'
const DEBUG_PORT = Number(process.env.VISILANT_ANDROID_PORT || 6001)

export async function adb(args: string[]): Promise<string> {
  const { stdout } = await run('adb', args, { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

export async function firstDevice(): Promise<string> {
  const listed = await adb(['devices'])
  const device = listed.split('\n').slice(1).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === 'device')?.[0]
  if (!device)
    throw new Error('adb sees no ready device. Check the cable, USB debugging, and the prompt on the phone.')
  return device
}

/** Our own forward, so the tests do not depend on a `web-ext run` staying alive. */
export async function forwardDebugger(): Promise<number> {
  await adb(['forward', `tcp:${DEBUG_PORT}`, `localabstract:${FIREFOX_PACKAGE}/firefox-debugger-socket`])
  return DEBUG_PORT
}

export async function openUrl(url: string): Promise<void> {
  // A plain re-open restores the tab from cache, so callers vary the query
  await adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, FIREFOX_PACKAGE])
}

export interface TargetForm { url?: string, consoleActor?: string, targetType?: string }

export class Session {
  constructor(private rdp: Rdp) {}

  static async open(port: number): Promise<Session> {
    const rdp = await Rdp.connect(port)
    await rdp.next() // the root actor's greeting
    return new Session(rdp)
  }

  close() {
    this.rdp.close()
  }

  /** The add-on's own targets: the background page, and any extension page open. */
  async addonTargets(): Promise<{ descriptor: Record<string, unknown>, targets: TargetForm[] }> {
    const listed = await this.rdp.request({ to: 'root', type: 'listAddons' })
    const addons = (listed.addons || []) as Record<string, unknown>[]
    const descriptor = addons.find(a => String(a.id || '').startsWith(ADDON_ID_PREFIX))
    if (!descriptor)
      throw new Error('Visilant is not installed on this phone. Run `just ar` first.')

    const watcher = await this.rdp.request({ to: String(descriptor.actor), type: 'getWatcher' })
    this.rdp.send({ to: String(watcher.actor), type: 'watchTargets', targetType: 'frame' })
    const packets = await this.rdp.drain(2500)
    const targets = packets
      .filter(p => p.type === 'target-available-form')
      .map(p => p.target as TargetForm)
    return { descriptor, targets }
  }

  /** Run an expression and hand back what it evaluated to. */
  async evaluate(consoleActor: string, expression: string): Promise<unknown> {
    const started = await this.rdp.request({
      to: consoleActor,
      type: 'evaluateJSAsync',
      text: expression,
      // Without this the reply is the Promise itself rather than what it
      // settled to, and every expression here ends in a promise
      mapped: { await: true },
    })
    const id = started.resultID
    while (true) {
      const packet = await this.rdp.next()
      if (packet.type !== 'evaluationResult' || packet.resultID !== id)
        continue
      if (packet.exception !== undefined && packet.exception !== null)
        throw new Error(String(packet.exceptionMessage || JSON.stringify(packet.exception)))
      return packet.result
    }
  }

  /** Same, for an expression written to return JSON. */
  async json<T = unknown>(consoleActor: string, expression: string): Promise<T> {
    const raw = await this.evaluate(consoleActor, expression)
    if (typeof raw !== 'string')
      throw new TypeError(`expected a JSON string, got ${JSON.stringify(raw)?.slice(0, 120)}`)
    return JSON.parse(raw) as T
  }
}

async function findTarget(session: Session, match: (url: string) => boolean): Promise<string | null> {
  const { targets } = await session.addonTargets()
  return targets.find(t => match(t.url || ''))?.consoleActor || null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Wake the event page and run something against it.
 *
 * Retried rather than waited on: the only lever is a page load, and how long
 * the worker stays up afterwards is not ours to decide.
 */
export async function withBackground<T>(
  port: number,
  body: (session: Session, background: string) => Promise<T>,
  attempts = 6,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await openUrl(`https://example.com/?visilant-e2e=${Date.now()}-${attempt}`)
    await sleep(3000)
    const session = await Session.open(port)
    try {
      const background = await findTarget(session, url => url.includes('_generated_background_page'))
      // Only a missing target is worth another go. Anything the body throws is
      // the test's own answer and must not be retried into "never woke up".
      if (background)
        return await body(session, background)
    }
    finally {
      session.close()
    }
  }
  throw new Error('the background page never woke up')
}

/**
 * Open the settings page and run something against it.
 *
 * It is not only a page under test: it is the only context that can drive the
 * background's message handlers, since a background sending to itself is not
 * delivered to its own listener.
 */
export async function withOptionsPage<T>(
  port: number,
  body: (session: Session, options: string) => Promise<T>,
): Promise<T> {
  await withBackground(port, async (session, background) => {
    await session.json(background, `
      browser.tabs.query({}).then(ts => {
        const open = ts.filter(t => t.url.includes("dist/options/index.html"));
        if (open.length) return JSON.stringify(open[0].id);
        return browser.tabs.create({url: browser.runtime.getURL("dist/options/index.html")})
          .then(t => JSON.stringify(t.id));
      })`)
  })
  await sleep(3000)

  const session = await Session.open(port)
  try {
    const options = await findTarget(session, url => url.includes('dist/options'))
    if (!options)
      throw new Error('the settings page did not open')
    return await body(session, options)
  }
  finally {
    session.close()
  }
}

/**
 * Open an extension page and run something against it.
 *
 * The settings page is the common case and has its own helper. This is the same
 * move for the rest of them, the welcome page in particular, which only ever
 * appears at install and so has to be summoned to be looked at.
 */
export async function withExtensionPage<T>(
  port: number,
  path: string,
  body: (session: Session, page: string) => Promise<T>,
): Promise<T> {
  await withBackground(port, async (session, background) => {
    await session.json(background, `
      browser.tabs.query({}).then(ts => {
        const open = ts.filter(t => t.url.includes(${JSON.stringify(path)}));
        if (open.length) return JSON.stringify(open[0].id);
        return browser.tabs.create({url: browser.runtime.getURL(${JSON.stringify(path)})})
          .then(t => JSON.stringify(t.id));
      })`)
  })
  await sleep(3000)

  const session = await Session.open(port)
  try {
    const page = await findTarget(session, url => url.includes(path))
    if (!page)
      throw new Error(`${path} did not open`)
    return await body(session, page)
  }
  finally {
    session.close()
  }
}

export { sleep }
