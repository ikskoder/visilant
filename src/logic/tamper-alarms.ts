/**
 * Which tabs are showing a tampering alarm.
 *
 * Held in `storage.session` rather than in a `Set` in the service worker.
 * An MV3 worker is stopped whenever the browser decides it is idle, which on a
 * page the user is reading happens within seconds – and the alarm went with it.
 * The next badge refresh, from switching tabs and back or from the page finishing
 * loading, then found nothing to protect and painted the ordinary visit count
 * over the `!!!`. A page could simply wait for that.
 *
 * `storage.session` is cleared when the browser closes, which is exactly the
 * lifetime an alarm about a page should have. Where it is missing the alarms live
 * in `storage.local` under the same key and are cleared on startup instead.
 */

/** The record kept per alarmed tab, so a new navigation can be told apart. */
export interface TamperAlarm {
  /** The URL the alarm was raised on. A different one is a different page. */
  url: string
  at: number
}

const ALARM_KEY = '__visilantTamperedTabs'

type AlarmMap = Record<string, TamperAlarm>

function area() {
  // `session` is MV3 Chrome 102+ and Firefox 115+. Where it is not there, the
  // local area is the same shape and the startup clear below stands in for the
  // lifetime it would have had.
  return browser.storage.session ?? browser.storage.local
}

/**
 * A copy in memory, so the badge path does not wait on storage for the common
 * answer of "no alarm". Storage stays the source of truth: this is filled from
 * it on first use and written through on every change.
 */
let cache: AlarmMap | null = null

async function read(): Promise<AlarmMap> {
  if (cache)
    return cache

  const stored = await area().get(ALARM_KEY)
  cache = (stored[ALARM_KEY] as AlarmMap | undefined) ?? {}
  return cache
}

/**
 * Writes, one at a time.
 *
 * Two tabs raising an alarm in the same tick are two read-modify-writes of one
 * key, and one of them loses - which for an alarm means a page that was caught
 * hiding the panel goes unmarked.
 */
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work)
  chain = next.then(() => undefined, () => undefined)
  return next
}

async function write(alarms: AlarmMap): Promise<void> {
  cache = alarms
  await area().set({ [ALARM_KEY]: alarms })
}

/** Mark a tab as having caught its page hiding the extension's UI. */
export async function raiseTamperAlarm(tabId: number, url: string): Promise<void> {
  await enqueue(async () => {
    const alarms = { ...(await read()) }
    alarms[String(tabId)] = { url, at: Date.now() }
    await write(alarms)
  })
}

/** Is this tab under an alarm right now? */
export async function hasTamperAlarm(tabId: number): Promise<boolean> {
  return Boolean((await read())[String(tabId)])
}

/**
 * Drop the alarm for a tab.
 *
 * Called when the tab starts loading something else and when it closes. A new
 * document has done nothing yet, and a closed tab's id gets handed out again.
 */
export async function clearTamperAlarm(tabId: number): Promise<void> {
  await enqueue(async () => {
    const alarms = await read()
    if (!alarms[String(tabId)])
      return

    const next = { ...alarms }
    delete next[String(tabId)]
    await write(next)
  })
}

/** Everything the browser has been carrying since it was last closed. */
export async function clearAllTamperAlarms(): Promise<void> {
  await enqueue(() => write({}))
}
