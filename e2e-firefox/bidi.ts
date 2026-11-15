/**
 * Just enough WebDriver BiDi to drive desktop Firefox with the extension in it.
 *
 * Playwright cannot load an extension into Firefox, and the Android harness
 * talks to a phone. Firefox speaks BiDi itself once it is started with
 * `--remote-debugging-port`, and BiDi can install a temporary add-on
 * (`webExtension.install`), click with a real pointer, which is what the
 * Clipboard API wants before it will write, and take screenshots. No driver
 * binary and no new dependency: Node has a WebSocket client of its own.
 */
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface Pending { resolve: (value: any) => void, reject: (error: Error) => void }

export class Firefox {
  private next = 0
  private pending = new Map<number, Pending>()

  private constructor(
    private process: ChildProcess,
    private socket: WebSocket,
    private profile: string,
    readonly version: string,
  ) {}

  /** Start a headless Firefox on a fresh profile with these preferences. */
  static async launch(binary: string, prefs: Record<string, string | number | boolean>): Promise<Firefox> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'visilant-firefox-'))
    fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs)
      .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join('\n'))

    // Port 0 has Firefox pick a free one and say which, so two runs never collide.
    // System access is what lets BiDi evaluate in the extension's own pages,
    // where the tests seed storage. Firefox before 141 or so needs no flag for
    // that and ignores one it does not know.
    const child = spawn(binary, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port=0', '--remote-allow-system-access'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Firefox did not open its BiDi port within 30 s\n${output}`)), 30000)
      const read = (chunk: Buffer) => {
        output += chunk
        const match = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(output)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout!.on('data', read)
      child.stderr!.on('data', read)
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Firefox exited with ${code} before it was ready\n${output}`))
      })
    })

    const socket = new WebSocket(`${url}/session`)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = () => reject(new Error(`could not connect to ${url}`))
    })

    const firefox = new Firefox(child, socket, profile, '')
    socket.onmessage = event => firefox.receive(String(event.data))
    const session = await firefox.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } })
    ;(firefox as { version: string }).version = session.capabilities.browserVersion
    return firefox
  }

  private receive(data: string) {
    const message = JSON.parse(data)
    const waiting = message.id !== undefined ? this.pending.get(message.id) : undefined
    if (!waiting)
      return
    this.pending.delete(message.id)
    if (message.type === 'error')
      waiting.reject(new Error(`${message.error}: ${message.message}`))
    else
      waiting.resolve(message.result)
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Run an expression in a page and hand back its value, passed through JSON. */
  async evaluate<T>(context: string, expression: string): Promise<T> {
    const result = await this.send('script.evaluate', {
      expression: `(async () => JSON.stringify(await (${expression})))()`,
      target: { context },
      awaitPromise: true,
    })
    if (result.type === 'exception')
      throw new Error(`evaluation failed: ${result.exceptionDetails.text}\n  in: ${expression}`)
    const value = result.result.value
    return (value === undefined ? undefined : JSON.parse(value)) as T
  }

  async contexts(): Promise<{ context: string, url: string }[]> {
    return (await this.send('browsingContext.getTree', {})).contexts
  }

  /** A real click at a point in the viewport, which counts as the user's. 1 is the middle button. */
  async clickAt(context: string, x: number, y: number, button = 0) {
    await this.send('input.performActions', {
      context,
      actions: [{
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport' },
          { type: 'pointerDown', button },
          { type: 'pointerUp', button },
        ],
      }],
    })
    await this.send('input.releaseActions', { context })
  }

  /** Press keys one after another, by WebDriver key value (Tab is \uE004, Enter \uE007). */
  async press(context: string, keys: string[]) {
    await this.send('input.performActions', {
      context,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: keys.flatMap(key => [{ type: 'keyDown', value: key }, { type: 'keyUp', value: key }]),
      }],
    })
  }

  /** The same with Shift held down throughout (\uE008). */
  async pressShifted(context: string, keys: string[]) {
    await this.send('input.performActions', {
      context,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: '\uE008' },
          ...keys.flatMap(key => [{ type: 'keyDown', value: key }, { type: 'keyUp', value: key }]),
          { type: 'keyUp', value: '\uE008' },
        ],
      }],
    })
  }

  async type(context: string, text: string) {
    await this.send('input.performActions', {
      context,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: [...text].flatMap(key => [{ type: 'keyDown', value: key }, { type: 'keyUp', value: key }]),
      }],
    })
  }

  async screenshot(context: string, file: string) {
    const { data } = await this.send('browsingContext.captureScreenshot', { context })
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
  }

  async close() {
    try {
      await Promise.race([this.send('browser.close'), sleep(5000)])
    }
    catch {
      // Gone already, which is what was wanted
    }
    this.socket.close()
    if (this.process.exitCode === null)
      this.process.kill()
    fs.rmSync(this.profile, { recursive: true, force: true })
  }
}

/** Where the browser is, or a message saying how to get one. */
export function firefoxBinary(): string {
  const binary = process.env.FIREFOX
  if (!binary) {
    throw new Error('Set FIREFOX to a Firefox binary, e.g. FIREFOX=$(command -v firefox). '
      + 'Firefox 140 or later, the oldest this extension supports. Playwright\'s own Firefox cannot load extensions.')
  }
  try {
    fs.accessSync(binary, fs.constants.X_OK)
  }
  catch {
    throw new Error(`FIREFOX=${binary} is not an executable file`)
  }
  return binary
}
