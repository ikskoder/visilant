/**
 * Fetching and parsing of remote shortener lists.
 *
 * Deliberately separate from `url-shorteners.ts`: that module carries the
 * built-in list as a ~100 kB inline string, and anything importing it inherits
 * the whole thing. The settings page only needs to fetch and store lists, so it
 * imports this instead and stays light.
 */

import { fetchTextBounded } from './bounded-fetch'

/** storage.local key holding the merged remote list, shared by all contexts. */
export const STORAGE_KEY_REMOTE_SHORTENERS = 'remoteShortenerDomains'

/** One domain per line, `#` for comments – the same format as the built-in list. */
export function parseShortenerDomains(raw: string): string[] {
  return raw.split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line.length > 0 && !line.startsWith('#') && line.includes('.'))
}

/**
 * Ceiling on the merged list. The built-in list is ~2.5 thousand domains, and
 * every one of them is checked against on every link, so a source answering with
 * a million lines would be paid for on every hover rather than once.
 */
export const MAX_REMOTE_SHORTENERS = 100_000

/** Fetch one list. Throws on network or HTTP errors. */
export async function fetchRemoteShortenerList(url: string): Promise<string[]> {
  return parseShortenerDomains(await fetchTextBounded(url)).slice(0, MAX_REMOTE_SHORTENERS)
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

  return { domains: [...merged].slice(0, MAX_REMOTE_SHORTENERS), ok, failed }
}
