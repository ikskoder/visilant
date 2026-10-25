/**
 * Why a settings write was refused, in words the settings page can act on.
 *
 * The page used to say "most likely the synced settings are full" whatever the
 * reason was. The settings are one small item, far under the limit, and the
 * refusals that actually come are others: the browser's cap on writes a minute,
 * or a background that did not answer at all, which no shortening of a list
 * cures. Each is told apart by the text the browser puts in the error, which is
 * the only thing it gives.
 *
 * - `full`: the synced area or its one item is over its size limit. Chrome
 *   documents `QUOTA_BYTES_PER_ITEM` and Chrome 151 says
 *   `Resource::kQuotaBytesPerItem quota exceeded`, so the names are matched with
 *   or without the underscores. Firefox says `QuotaExceededError`.
 * - `too-often`: Chrome's limit on writes a minute or an hour
 *   (`MAX_WRITE_OPERATIONS_PER_MINUTE`, the same with or without underscores).
 * - `no-answer`: the settings go through the background, and it was not there
 *   to take them, it stopped before answering (Chrome: "the message channel
 *   closed before a response was received", Firefox: "Promised response …
 *   went out of scope"), or this page belongs to a copy of the extension that
 *   has since been reloaded.
 * - `unexplained`: the background answered that it did not save, and gave no
 *   reason, so there are no browser's words to show.
 * - `other`: anything else, shown with the browser's own words.
 */
export type StorageErrorKind = 'full' | 'too-often' | 'no-answer' | 'unexplained' | 'other'

/** What `editSettingsThroughBackground` throws when the answer carried no reason. */
export const SETTINGS_NOT_SAVED = 'the settings were not saved'

export function storageErrorKind(error: unknown): StorageErrorKind {
  const text = storageErrorText(error)
  if (/MAX_?WRITE_?OPERATIONS/i.test(text))
    return 'too-often'
  if (/QUOTA_?BYTES|QuotaExceeded|quota exceeded|exceeded its quota/i.test(text))
    return 'full'
  if (/Receiving end does not exist|Could not establish connection|Extension context invalidated|message port closed|message channel closed|went out of scope|dead object/i.test(text))
    return 'no-answer'
  if (text === SETTINGS_NOT_SAVED)
    return 'unexplained'
  return 'other'
}

/** The browser's own words, for the case nothing else fits. */
export function storageErrorText(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  if (error && typeof error === 'object' && 'message' in error)
    return String((error as { message: unknown }).message)
  return String(error ?? '')
}
