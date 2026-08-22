import {
  loadCustomDisposableList,
  loadCustomPublicList,
  STORAGE_KEY_CUSTOM_DISPOSABLE,
  STORAGE_KEY_CUSTOM_PUBLIC,
  STORAGE_KEY_REMOTE_DISPOSABLE,
  STORAGE_KEY_REMOTE_PUBLIC,
  updateDisposableList,
  updatePublicList,
} from './email-providers'
import {
  loadCustomMailSites,
  STORAGE_KEY_CUSTOM_MAIL_SITES,
  STORAGE_KEY_REMOTE_MAIL_SITES,
  updateRemoteMailSites,
} from './mail-sites'
import { STORAGE_KEY_REMOTE_SHORTENERS } from './shortener-lists'
import { loadCustomShorteners, updateShortenerList } from './url-shorteners'

/**
 * Keep the runtime list layers in step with what is stored.
 *
 * Every context that classifies a link or an address builds its sets once, at
 * startup, out of `storage.local`. That was the whole story until the settings
 * page could change those lists: a tab opened before the edit went on using the
 * old list until it was reloaded, and the service worker until it was next torn
 * down – so the same link could be called a shortener in one tab and not in the
 * next, with nothing on screen to explain it.
 *
 * Only the list keys are watched, and each new value is applied straight from
 * the change rather than re-read, so an edit costs nothing beyond the write the
 * settings page was making anyway.
 *
 * Not for the settings page: it is the writer, it holds its own copies, and it
 * deliberately does not import the shortener module this one pulls in.
 */

function asDomains(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** A remote cache is `{ domains, updatedAt, urls }`, and is gone entirely once reset. */
function asRemoteDomains(value: unknown): string[] {
  return asDomains((value as { domains?: unknown } | undefined)?.domains)
}

// Always called, including with an empty list: a list the user cleared has to
// leave the runtime set, which is exactly the case a truthiness check drops.
const APPLIERS: Record<string, (value: unknown) => void> = {
  customShorteners: value => loadCustomShorteners(asDomains(value)),
  [STORAGE_KEY_REMOTE_SHORTENERS]: value => updateShortenerList(asRemoteDomains(value)),
  [STORAGE_KEY_CUSTOM_PUBLIC]: value => loadCustomPublicList(asDomains(value)),
  [STORAGE_KEY_CUSTOM_DISPOSABLE]: value => loadCustomDisposableList(asDomains(value)),
  [STORAGE_KEY_REMOTE_PUBLIC]: value => updatePublicList(asRemoteDomains(value)),
  [STORAGE_KEY_REMOTE_DISPOSABLE]: value => updateDisposableList(asRemoteDomains(value)),
  [STORAGE_KEY_CUSTOM_MAIL_SITES]: value => loadCustomMailSites(asDomains(value)),
  [STORAGE_KEY_REMOTE_MAIL_SITES]: value => updateRemoteMailSites(asRemoteDomains(value)),
}

/** Apply whatever of a `storage.onChanged` batch names a list. */
export function applyListChanges(changes: Record<string, { newValue?: unknown }>): void {
  for (const [key, change] of Object.entries(changes))
    APPLIERS[key]?.(change.newValue)
}

/** Register the watcher. Call once per context, next to the startup load. */
export function watchListStorage(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local')
      return
    applyListChanges(changes as Record<string, { newValue?: unknown }>)
  })
}
