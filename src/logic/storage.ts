import type { BadgeContent } from './badge'
import type { DomainMetric } from './domain-metric'
import type { FamiliaritySettings } from './familiarity'
import { createWebExtensionStorage } from '~/composables/useWebExtensionStorage'
import { defaultFamiliaritySettings } from './familiarity'
import { DEFAULT_LOOKUP_SERVICES, serializeLookupServices } from './lookup-services'
import { isMessageError } from './message-error'

export interface Settings {
  /**
   * The visit threshold as it was stored before familiarity had more than one
   * criterion. Read once, by the migration below, and kept only so that a user
   * who had set it to 25 does not silently go back to 10 on update.
   */
  safety: number

  // What counts as a familiar site – see logic/familiarity.ts
  familiarity: FamiliaritySettings

  /**
   * Whether every fact behind a verdict is shown next to the bar it has to clear.
   *
   * Off, a check reads `Visits: 3`, and the bar is one hover away in the title.
   * On, it reads `Visits: 3 / 10`, which answers "how far off is this" without
   * asking, at the cost of a longer line in a tooltip that is already narrow.
   * The facts themselves are shown either way – this is only about the bar.
   */
  showFamiliarityThresholds: boolean

  // Display settings
  showBadge: boolean

  /**
   * Which number the badge draws – see logic/badge.ts. The colour is the whole
   * familiarity verdict either way, drawn in grey rather than red on a site
   * whose warnings the user switched off.
   */
  badgeContent: BadgeContent
  changeIcon: boolean
  showWarningNotification: boolean
  notificationStyle: 'browser' | 'in-page' | 'both'

  // Warning types
  showInputWarning: boolean
  showCopyWarning: boolean

  // Hold a paste on an unfamiliar site until the user confirms it
  blockPasteOnUnfamiliar: boolean

  // Language settings
  selectedLanguage: string

  /**
   * Which number the related-domain list draws beside each host – see
   * logic/domain-metric.ts.
   *
   * Kept apart from the order below, because the two used to be one setting and
   * one of its values was `name`: picking alphabetical order therefore had to
   * choose a number as well, and the only honest answer was to throw the
   * reader's choice away and go back to visits. What is shown and what it is
   * sorted by are two questions, so they are two settings.
   */
  listMetric: DomainMetric
  /** Order by the hostname rather than by the number on show. */
  sortByName: boolean
  sortOrder: 'asc' | 'desc'

  // Display settings
  domainCase: 'lower' | 'upper'

  /**
   * The half of an email address before the @, which gets its own control.
   *
   * Upper and lower mean the same thing to a domain, so that one only has two
   * settings. An account name is a name somebody chose, and the capitals in it
   * are part of how it was written down, so this one keeps a third position
   * that leaves it exactly as it arrived. That is the default: the check panel
   * echoing the address back unchanged is what a reader compares against the
   * message in front of them.
   */
  accountNameCase: 'as-typed' | 'lower' | 'upper'
  domainHighlighting: boolean
  punycodeListMode: 'unicode' | 'ascii'

  // Font size (percentage, 100 = default)
  popupFontSize: number

  // Theme
  theme: 'system' | 'light' | 'dark'

  /**
   * Whether the settings page explains itself.
   *
   * On, every setting carries the line that says what it does. Off, those lines
   * go and the page is a short list of controls. Nothing outside the settings
   * page reads this – warnings, tooltips and the popup say what they say.
   */
  verboseOptions: boolean

  // Link safety settings
  linkSafety: LinkSafetySettings

  // Anti-tampering exclusions
  antiTamperingExcludedDomains: string

  // Remote sources for the email lists, one URL per line
  disposableEmailListUrl: string
  publicEmailListUrl: string

  // Remote sources for the mail-site mapping, one URL per line. Empty by
  // default – there is no public list in this shape to point at.
  mailSiteListUrl: string

  // Third-party lookup links, one `Name | https://…/{domain}` per line. Seeded
  // with the shipped list as plain text so any entry can be removed. Empty means
  // no links at all. These are links the user may follow, never requests the
  // extension makes.
  lookupServices: string
}

/** What makes the link check show itself. */
export type TooltipTrigger = 'hover' | 'click-left' | 'click-right'

export interface LinkSafetySettings {
  enabled: boolean
  tooltipTrigger: TooltipTrigger
  // How long the pointer has to rest on a link before the tooltip appears, in
  // milliseconds. Only the hover trigger uses it.
  hoverDelay: number
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  // Shortened URL settings
  shortUrlMode: 'off' | 'button' | 'auto' // off=disabled, button=resolve on click, auto=resolve automatically
  shortUrlShowFullUrl: boolean // show full resolved URL or just domain
  shortUrlTraceChain: boolean // show full redirect chain trace
  shortUrlResolveAny: boolean // allow resolving ANY url, not just known shorteners
  shortUrlListUpdateUrl: string // remote URL to fetch updated shortener list
  scopeMode: 'everywhere' | 'whitelist' | 'blacklist'
  scopeDomains: string
}

/**
 * Default sources for the two email lists.
 *
 * Both are plain text, one domain per line, which is what the parser expects –
 * a JSON list would come through as quoted junk. Picked for being maintained
 * and modest in size: the disposable blocklist is the widely used curated one
 * (~8k domains) rather than the 88k-domain aggregate, which would cost far more
 * memory in every tab for a long tail nobody types.
 *
 * Nothing is fetched on its own – these only fill the field, and the user
 * presses Update. Either can be replaced or cleared.
 */
/**
 * Where the shortener list is topped up from.
 *
 * The same collection the built-in list was taken from, so an update refreshes
 * what shipped rather than mixing in a second opinion. Maintained, plain text,
 * one domain per line with `#` comments – the format the parser already expects.
 *
 * Knowing that a link is shortened is not a verdict about anybody, which is why
 * a list is allowed here at all: it says the destination is hidden, and the
 * extension then offers to resolve it.
 */
export const DEFAULT_SHORTENER_LIST_URL = 'https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/master/list'

export const DEFAULT_DISPOSABLE_LIST_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'
export const DEFAULT_PUBLIC_LIST_URL = 'https://raw.githubusercontent.com/willwhite/freemail/master/data/free.txt'

export const defaultSettings: Settings = {
  // Legacy visit threshold, superseded by `familiarity` below
  safety: 10,

  familiarity: defaultFamiliaritySettings,

  // The numbers alone, with the bar behind them left to the title. A tooltip on
  // a link is the narrowest surface in the extension and the one shown most
  // often, so it starts at the shorter of the two lines
  showFamiliarityThresholds: false,

  // Display settings
  showBadge: true,

  // Visits are the count this extension has always shown, and the one criterion
  // every record can answer
  badgeContent: 'visits',
  changeIcon: false,
  showWarningNotification: true,
  notificationStyle: 'in-page',

  // Warning types - both enabled by default
  showInputWarning: true,
  showCopyWarning: true,

  // Off by default: it interrupts a real action, so it has to be asked for
  blockPasteOnUnfamiliar: false,

  // Language settings
  selectedLanguage: 'en',

  // The related-domain list: visits are the count it has always drawn, largest first
  listMetric: 'visits',
  sortByName: false,
  sortOrder: 'desc',

  // Display settings
  domainCase: 'lower',
  accountNameCase: 'as-typed',
  domainHighlighting: false,
  punycodeListMode: 'unicode',

  // Font size (percentage, 100 = default)
  popupFontSize: 100,

  // Theme
  theme: 'system',

  // The settings page explains itself until somebody says they know it by heart
  verboseOptions: true,

  // Anti-tampering exclusions
  antiTamperingExcludedDomains: '',

  // Seeded with a maintained source each. Nothing is fetched until the user
  // presses Update, and clearing a field turns that source off
  disposableEmailListUrl: DEFAULT_DISPOSABLE_LIST_URL,
  publicEmailListUrl: DEFAULT_PUBLIC_LIST_URL,

  // Nothing to seed: the mapping of a mail domain to the site it is read on is
  // not published anywhere, so this stays empty until somebody has a source
  mailSiteListUrl: '',

  // Seeded with the shipped links, which the user may edit or clear
  lookupServices: serializeLookupServices(DEFAULT_LOOKUP_SERVICES),

  // Link safety settings
  linkSafety: {
    enabled: true,

    // Asked for rather than volunteered: the check appears on the link the user
    // right-clicked, and never while they are only passing over one. A pointer
    // crossing a page would otherwise open the tooltip again and again for links
    // nobody meant to ask about. Hovering is still there for whoever wants it.
    tooltipTrigger: 'click-right',

    // Only the hover trigger reads this. Deliberately long: hovering is the one
    // trigger nobody asks for on purpose, so a pointer resting on a link has to
    // look like a question rather than like crossing the page.
    hoverDelay: 1500,
    showVisitCount: 'always',
    shortUrlMode: 'button',
    shortUrlShowFullUrl: false,
    shortUrlTraceChain: false,
    shortUrlResolveAny: false,
    shortUrlListUpdateUrl: DEFAULT_SHORTENER_LIST_URL,
    scopeMode: 'everywhere',
    scopeDomains: '',
  },
}

const settingsStorage = createWebExtensionStorage<Settings>(
  'settings',
  defaultSettings,
  {
    mergeDefaults: true,
  },
)

export const settings = settingsStorage.data

/** The last save that did not happen, so the settings page can say so. */
export const settingsWriteError = settingsStorage.writeError

/**
 * Take a settings object handed over by another context.
 *
 * Assigning to `settings.value` would look identical and would also save the
 * value straight back – which is how a context holding a stale copy used to
 * overwrite the real one. This puts it in the ref and stops there.
 */
export function applySettingsSnapshot(value: Settings): void {
  settingsStorage.applyExternal(value)
}

/**
 * Give up the right to write settings.
 *
 * Called by every context that only shows what the settings say. One writer for
 * one blob – see the note on `setWritable`.
 */
export function makeSettingsReadOnly(): void {
  settingsStorage.setWritable(false)
}

/**
 * The settings keys where two objects disagree, as a patch of the first.
 *
 * Built out of the serialized form on purpose. The value handed in is the
 * reactive one every control is bound to, and a message is structured-cloned on
 * its way to the background: a reactive proxy cannot be cloned, so a patch
 * carrying one would fail to send at all and no setting would ever save.
 */
export function settingsPatch(next: Settings, stored: Settings | null): Partial<Settings> {
  const plain = JSON.parse(JSON.stringify(next)) as Settings
  const patch: Partial<Settings> = {}
  for (const key of Object.keys(plain) as (keyof Settings)[]) {
    const before = stored ? stored[key] : undefined
    if (stored === null || JSON.stringify(before) !== JSON.stringify(plain[key]))
      (patch as Record<string, unknown>)[key] = plain[key]
  }
  return patch
}

/**
 * Edit the settings by asking the background to, rather than by writing them.
 *
 * Called by every page that edits them: the settings page and the popup, both of
 * which can be open at the same moment. They used to save the whole blob each,
 * having each read it separately - so two edits made seconds apart, to two
 * unrelated settings, ended with whichever page wrote last deciding the value of
 * both. Losing a sort order that way is a nuisance. Losing the paste guard,
 * because the popup still held the copy it read before the guard was switched
 * on, is the same mechanism taking a protection off.
 *
 * Only the keys this page changed travel, and the background merges them into
 * what is stored now. The value comes back the ordinary way, through the change
 * event every context already listens to.
 */
export function editSettingsThroughBackground(): void {
  settingsStorage.setCommit(async (next, stored) => {
    const patch = settingsPatch(next, stored)
    if (!Object.keys(patch).length)
      return

    const answer = await browser.runtime.sendMessage({ type: 'patch-settings', data: { patch } })
    if (isMessageError(answer))
      throw new Error(answer.error)
    if (!(answer as { success?: boolean })?.success)
      throw new Error('the settings were not saved')
  })
}

/**
 * Settings as they are actually stored, migrations included.
 *
 * Whoever answers questions about the settings – the background above all – has
 * to await this before answering the first one. Until it resolves the ref still
 * holds the shipped defaults, and a default handed out as the user's choice is
 * both a wrong answer and, one write later, a wrong setting.
 */
let settingsReadyPromise: Promise<void> | null = null

export function settingsReady(options: { migrate?: boolean } = {}): Promise<void> {
  settingsReadyPromise ??= (async () => {
    await settingsStorage.ready
    if (options.migrate) {
      await runSettingsMigrations()
      // The migration wrote the stored blob behind the ref's back, on purpose:
      // it works on the raw value, before defaults are merged over it
      await settingsStorage.hydrate()
    }
  })().catch((error) => {
    // A failure is not an answer, so it is not kept as one. Remembering the
    // rejected promise meant one storage error at startup - the kind that comes
    // of a disk being busy for a moment - left every later question about the
    // settings failing too, for as long as the worker lived. Forgetting it here
    // is what lets the next caller try again.
    settingsReadyPromise = null
    throw error
  })
  return settingsReadyPromise
}

/**
 * Read a settings value the way it actually sits in storage.
 *
 * `useWebExtensionStorage` serializes, so the `settings` key holds a JSON string
 * and not an object. Anywhere the raw value is read – a `storage.onChanged`
 * listener above all, where the ref is not what arrives – reaching straight for
 * a field silently yields `undefined` on every one of them, and every comparison
 * between two of those quietly succeeds.
 */
export function parseStoredSettings(value: unknown): Settings | undefined {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Settings
    }
    catch {
      return undefined
    }
  }
  // An object is accepted as-is: nothing writes one today, but a reader that
  // breaks the day something does is worse than a type check
  return typeof value === 'object' && value !== null ? value as Settings : undefined
}

/** Marks that the shipped text defaults have been put into the settings once. */
const TEXT_DEFAULTS_SEEDED_KEY = 'textDefaultsSeeded'

/** Marks that the shortener source has been offered to an existing profile once. */
const SHORTENER_SOURCE_SEEDED_KEY = 'shortenerSourceSeeded'

/** Marks that the old single-threshold setting has been carried over. */
const FAMILIARITY_MIGRATED_KEY = 'familiarityMigrated'

/** Every one-off pass over the stored settings, in the order they are applied. */
const MIGRATION_KEYS = [
  TEXT_DEFAULTS_SEEDED_KEY,
  SHORTENER_SOURCE_SEEDED_KEY,
  FAMILIARITY_MIGRATED_KEY,
] as const

/** Fields whose default is content the user is meant to see and may delete. */
const SEEDED_TEXT_FIELDS = [
  'lookupServices',
  'disposableEmailListUrl',
  'publicEmailListUrl',
] as const

/**
 * Put the shipped text defaults into the settings, once per profile.
 *
 * Defaults are merged shallowly, so a stored empty string wins over the seeded
 * default and the field stays empty forever. That is exactly what an empty
 * field is supposed to mean here – no lookup links, no remote source – so the
 * value cannot simply be treated as missing. The flag draws the line instead:
 * seed once, then never touch these fields again, so a later clear stays clear.
 */
function seedTextDefaults(draft: Partial<Settings>): boolean {
  let changed = false
  for (const field of SEEDED_TEXT_FIELDS) {
    if (!draft[field]) {
      draft[field] = defaultSettings[field]
      changed = true
    }
  }
  return changed
}

/**
 * Give an existing profile the shortener source it never shipped with.
 *
 * Needed as its own pass rather than as another entry in `SEEDED_TEXT_FIELDS`:
 * that flag was set long ago on any profile old enough to be missing this, and
 * the field sits inside `linkSafety`, which the shallow default merge hands back
 * whole – a key added to it later never reaches a profile that already stored
 * one. Empty stays empty after this runs, the same as for the other sources: it
 * is a deliberate "no remote list", not a value that went missing.
 */
function seedShortenerSource(draft: Partial<Settings>): boolean {
  if (!draft.linkSafety || draft.linkSafety.shortUrlListUpdateUrl)
    return false

  draft.linkSafety = {
    ...draft.linkSafety,
    shortUrlListUpdateUrl: DEFAULT_SHORTENER_LIST_URL,
  }
  return true
}

/**
 * Carry a hand-set visit threshold into the new familiarity rules, once.
 *
 * Defaults are merged one level deep, so a profile stored before `familiarity`
 * existed comes back with the shipped rules – threshold 10 – and the 25 the user
 * had typed in is quietly gone. It cannot be read as a fallback either, since by
 * then the merged object is a complete, valid rule set with nothing missing to
 * fall back from. So it is copied across explicitly, before anything reads it,
 * and the flag makes sure a later edit down to 10 is not undone next startup.
 *
 * Reads the raw stored blob, never the hydrated ref: the ref has the defaults
 * merged into it, so `familiarity` is always present there and this would decide
 * there was nothing to carry over every single time.
 */
function migrateFamiliarity(draft: Partial<Settings>): boolean {
  // Already on the new rules, so there is nothing to carry over
  if (draft.familiarity)
    return false

  const legacy = Math.floor(Number(draft.safety))
  draft.familiarity = {
    ...defaultFamiliaritySettings,
    visits: {
      enabled: true,
      min: Number.isFinite(legacy) && legacy > 0 ? legacy : defaultFamiliaritySettings.visits.min,
    },
    // Off for a profile that is only arriving here now, whatever a new profile
    // starts with. Its records were written before active days and first-visit
    // dates existed, and a criterion whose fact was never recorded fails – so
    // switching these on during an update would declare every site the user
    // has ever known unfamiliar, all at once.
    activeDays: { ...defaultFamiliaritySettings.activeDays, enabled: false },
    age: { ...defaultFamiliaritySettings.age, enabled: false },
  }
  return true
}

/**
 * Every one-off pass over the stored settings, as one read and one write.
 *
 * They used to run as three independent fire-and-forget passes, each doing its
 * own read-modify-write of the same JSON blob while the settings ref was
 * hydrating alongside them. Whichever write landed last was the whole value, so
 * one pass could undo another – and each had already recorded itself as done, so
 * nothing ever ran again to put it right. One snapshot, one commit, and the
 * flags go up only once storage has been read back and agrees.
 *
 * Safe to run twice: every pass above is a no-op the second time.
 */
export async function runSettingsMigrations(): Promise<void> {
  const flags = await browser.storage.local.get(MIGRATION_KEYS as unknown as string[])
  const pending = MIGRATION_KEYS.filter(migrationKey => !flags[migrationKey])
  if (!pending.length)
    return

  const markDone = async () => {
    await browser.storage.local.set(Object.fromEntries(pending.map(migrationKey => [migrationKey, true])))
  }

  const stored = (await browser.storage.sync.get('settings')).settings
  // Nothing stored yet: a new profile starts on the defaults, which already
  // carry everything these passes would have added
  if (stored === undefined) {
    await markDone()
    return
  }

  const parsed = parseStoredSettings(stored)
  if (!parsed) {
    // Unreadable settings blob – leave it alone, the storage layer will reset
    // it. No flag goes up: nothing was carried over, and a readable blob later
    // still gets its migration.
    return
  }

  const draft: Partial<Settings> = { ...parsed }
  let changed = false
  if (pending.includes(TEXT_DEFAULTS_SEEDED_KEY))
    changed = seedTextDefaults(draft) || changed
  if (pending.includes(SHORTENER_SOURCE_SEEDED_KEY))
    changed = seedShortenerSource(draft) || changed
  if (pending.includes(FAMILIARITY_MIGRATED_KEY))
    changed = migrateFamiliarity(draft) || changed

  if (!changed) {
    await markDone()
    return
  }

  const written = JSON.stringify(draft)
  try {
    await browser.storage.sync.set({ settings: written })
  }
  catch {
    // Quota or a transient failure. The flag stays down so the next startup
    // tries again rather than recording a migration that never landed.
    return
  }

  // Read back before believing it. A write that resolved but stored something
  // else – or was overwritten before this line – must not be recorded as done:
  // the flag would forbid the retry that would put it right. Not marking it
  // costs one repeat of a pass that is a no-op the second time.
  if ((await browser.storage.sync.get('settings')).settings !== written)
    return

  await markDone()
}

// Define the site visit data structure
export interface SiteVisitData {
  count: number
  lastSeen: number // Unix timestamp of last visit
  ignored: boolean // Whether notifications are ignored for this site
  // Both fields are optional on purpose: records written before they existed have
  // no honest value for them, and only a browser-history import can supply one.
  firstSeen?: number // Unix timestamp of the earliest known visit
  activeDays?: number // Number of distinct local days the site was visited on
}
