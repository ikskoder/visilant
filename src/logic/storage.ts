import type { BadgeContent } from './badge'
import type { FamiliaritySettings } from './familiarity'
import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'
import { defaultFamiliaritySettings } from './familiarity'
import { DEFAULT_LOOKUP_SERVICES, serializeLookupServices } from './lookup-services'

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
   * familiarity verdict either way.
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

  // Sorting settings
  sortOption: 'name' | 'visits'
  sortOrder: 'asc' | 'desc'

  // Display settings
  domainCase: 'lower' | 'upper'
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

  // Sorting settings
  sortOption: 'visits',
  sortOrder: 'desc',

  // Display settings
  domainCase: 'lower',
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

export const settings = useWebExtensionStorage<Settings>(
  'settings',
  defaultSettings,
  {
    mergeDefaults: true,
  },
)

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

/**
 * Record a one-off pass as done – after it has actually been done.
 *
 * These all used to set their flag first and do the work second, which is one
 * torn-down service worker away from a migration that is marked complete and
 * never ran. Marked at the end, the worst case is running twice, and every one
 * of them is written to be a no-op the second time.
 */
async function markDone(key: string): Promise<void> {
  await browser.storage.local.set({ [key]: true })
}

/** Marks that the shipped text defaults have been put into the settings once. */
const TEXT_DEFAULTS_SEEDED_KEY = 'textDefaultsSeeded'

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
export async function seedTextDefaultsOnce(): Promise<void> {
  const flag = await browser.storage.local.get(TEXT_DEFAULTS_SEEDED_KEY)
  if (flag[TEXT_DEFAULTS_SEEDED_KEY])
    return

  const stored = (await browser.storage.sync.get('settings')).settings
  // Nothing stored yet: the defaults already carry these values
  if (typeof stored === 'string') {
    try {
      const parsed = JSON.parse(stored) as Partial<Settings>

      let changed = false
      for (const field of SEEDED_TEXT_FIELDS) {
        if (parsed && !parsed[field]) {
          parsed[field] = defaultSettings[field]
          changed = true
        }
      }

      if (changed)
        await browser.storage.sync.set({ settings: JSON.stringify(parsed) })
    }
    catch {
      // Unreadable settings blob – leave it alone, the storage layer will reset it
    }
  }

  await markDone(TEXT_DEFAULTS_SEEDED_KEY)
}

/** Marks that the shortener source has been offered to an existing profile once. */
const SHORTENER_SOURCE_SEEDED_KEY = 'shortenerSourceSeeded'

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
export async function seedShortenerSourceOnce(): Promise<void> {
  const flag = await browser.storage.local.get(SHORTENER_SOURCE_SEEDED_KEY)
  if (flag[SHORTENER_SOURCE_SEEDED_KEY])
    return

  const stored = (await browser.storage.sync.get('settings')).settings
  // Nothing stored yet: a new profile starts on the defaults anyway
  if (typeof stored === 'string') {
    try {
      const parsed = JSON.parse(stored) as Partial<Settings>
      if (parsed?.linkSafety && !parsed.linkSafety.shortUrlListUpdateUrl) {
        parsed.linkSafety = {
          ...parsed.linkSafety,
          shortUrlListUpdateUrl: DEFAULT_SHORTENER_LIST_URL,
        }
        await browser.storage.sync.set({ settings: JSON.stringify(parsed) })
      }
    }
    catch {
      // Unreadable settings blob – leave it alone, the storage layer will reset it
    }
  }

  await markDone(SHORTENER_SOURCE_SEEDED_KEY)
}

/** Marks that the old single-threshold setting has been carried over. */
const FAMILIARITY_MIGRATED_KEY = 'familiarityMigrated'

/**
 * Carry a hand-set visit threshold into the new familiarity rules, once.
 *
 * Defaults are merged one level deep, so a profile stored before `familiarity`
 * existed comes back with the shipped rules – threshold 10 – and the 25 the user
 * had typed in is quietly gone. It cannot be read as a fallback either, since by
 * then the merged object is a complete, valid rule set with nothing missing to
 * fall back from. So it is copied across explicitly, before anything reads it,
 * and the flag makes sure a later edit down to 10 is not undone next startup.
 */
export async function migrateFamiliarityOnce(): Promise<void> {
  const flag = await browser.storage.local.get(FAMILIARITY_MIGRATED_KEY)
  if (flag[FAMILIARITY_MIGRATED_KEY])
    return

  const stored = (await browser.storage.sync.get('settings')).settings
  // Nothing stored yet: a new profile starts on the defaults anyway
  if (typeof stored !== 'string') {
    await markDone(FAMILIARITY_MIGRATED_KEY)
    return
  }

  try {
    const parsed = JSON.parse(stored) as Partial<Settings>
    // Already on the new rules, or nothing worth carrying over
    if (!parsed || parsed.familiarity) {
      await markDone(FAMILIARITY_MIGRATED_KEY)
      return
    }

    const legacy = Math.floor(Number(parsed.safety))
    parsed.familiarity = {
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
    await browser.storage.sync.set({ settings: JSON.stringify(parsed) })
    await markDone(FAMILIARITY_MIGRATED_KEY)
  }
  catch {
    // Unreadable settings blob – leave it alone, the storage layer will reset it.
    // The flag stays unset: nothing was carried over, so there is nothing to
    // record as done, and a readable blob later still gets its migration.
  }
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
