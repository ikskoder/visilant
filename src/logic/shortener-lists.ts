/**
 * Fetching and parsing of remote shortener lists.
 *
 * Deliberately separate from `url-shorteners.ts`: that module carries the
 * built-in list as a ~100 kB inline string, and anything importing it inherits
 * the whole thing. The settings page only needs to fetch and store lists, so it
 * imports this instead and stays light.
 */

/** storage.local key holding the merged remote list, shared by all contexts. */
export const STORAGE_KEY_REMOTE_SHORTENERS = 'remoteShortenerDomains'

/** One domain per line, `#` for comments – the same format as the built-in list. */
export function parseShortenerDomains(raw: string): string[] {
  return raw.split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line.length > 0 && !line.startsWith('#') && line.includes('.'))
}

/** Fetch one list. Throws on network or HTTP errors. */
export async function fetchRemoteShortenerList(url: string): Promise<string[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok)
    throw new Error(`HTTP ${response.status}`)

  return parseShortenerDomains(await response.text())
}

export interface RemoteShortenerResult {
  domains: string[]
  /** Sources that answered, and sources that did not */
  ok: number
  failed: number
}

/**
 * Fetch several lists and merge them into one deduplicated set.
 *
 * A source that fails is counted and skipped rather than failing the whole
 * update: one dead URL should not throw away the lists that did answer.
 */
export async function fetchRemoteShortenerLists(urls: string[]): Promise<RemoteShortenerResult> {
  const merged = new Set<string>()
  let ok = 0
  let failed = 0

  const results = await Promise.allSettled(urls.map(url => fetchRemoteShortenerList(url)))

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      failed++
      continue
    }

    ok++
    for (const domain of result.value)
      merged.add(domain)
  }

  return { domains: [...merged], ok, failed }
}
