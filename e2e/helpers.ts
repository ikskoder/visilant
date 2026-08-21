/**
 * Shared plumbing for the e2e specs.
 *
 * Two things every spec ends up needing: a way into the service worker, where
 * the MV3 storage and tabs APIs live, and a page to run the content script on
 * that does not depend on some real site still being up and still looking the
 * way it did when the test was written.
 */

// Evaluated inside the extension's service worker
declare const chrome: any

export async function sw(context: any) {
  let [worker] = context.serviceWorkers()
  if (!worker)
    worker = await context.waitForEvent('serviceworker', { timeout: 10000 })
  return worker
}

/**
 * Run something inside the service worker, surviving its teardown.
 *
 * An MV3 worker is stopped whenever the browser decides it is idle, which can
 * happen between taking a handle to it and calling into it. The handle is then
 * dead and the call throws, so the worker is fetched again per attempt – a
 * restarted worker is a new object, and only a fresh lookup finds it.
 */
export async function inWorker<T>(context: any, fn: any, arg?: any): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const worker = await sw(context)
      return await worker.evaluate(fn, arg)
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

/**
 * Give a hostname a visit history without browsing to it.
 *
 * Faster than a real navigation and, more to the point, exact: a test that needs
 * a domain to be familiar says how familiar, instead of hoping the threshold
 * happens to fall on the right side of however many times it was loaded.
 */
export async function seedVisits(
  context: any,
  hostname: string,
  count: number,
  /** The other two facts a record carries, for a test that turns those checks on. */
  extra: { activeDays?: number, firstSeen?: number } = {},
) {
  await inWorker(context, async ({ host, visits, rest }: any) => {
    await chrome.storage.local.set({
      [host]: { count: visits, firstSeen: 1, lastSeen: 1, activeDays: 1, ignored: false, ...rest },
    })
  }, { host: hostname, visits: count, rest: extra })
}

/**
 * Change settings the way the options page would, without opening it.
 *
 * The settings live under one key as a serialized string, not as an object, so
 * they have to be parsed before being merged into.
 */
export async function patchSettings(context: any, patch: Record<string, unknown>) {
  await inWorker(context, async (values: Record<string, unknown>) => {
    const stored = await chrome.storage.sync.get('settings')
    const current = stored.settings ? JSON.parse(stored.settings) : {}
    await chrome.storage.sync.set({ settings: JSON.stringify({ ...current, ...values }) })
  }, patch)
}

/** A page with nothing on it but what the test puts there. */
export function blankPage(title = 'test page', body = '') {
  return `<!doctype html>
<html><head><title>${title}</title></head>
<body style="margin:0">${body}</body></html>`
}

/**
 * Serve a made-up domain to the page and go there.
 *
 * Nothing reaches the network, which keeps the suite off other people's uptime,
 * and the hostname is one nobody has ever visited – so "unfamiliar" is a fact
 * about the fixture rather than an accident of the profile being fresh.
 */
export async function serveSite(page: any, url: string, html = blankPage()) {
  await page.route(`${url}**`, (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }))
  await page.goto(url)
  await page.waitForLoadState('load')
}
