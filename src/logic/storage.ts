import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'
import { DEFAULT_LOOKUP_SERVICES, serializeLookupServices } from './lookup-services'

export interface Settings {
  // Threshold settings
  safety: number

  // Display settings
  showBadge: boolean
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

  // Link safety settings
  linkSafety: LinkSafetySettings

  // Anti-tampering exclusions
  antiTamperingExcludedDomains: string

  // Remote sources for the email lists, one URL per line
  disposableEmailListUrl: string
  publicEmailListUrl: string

  // Third-party lookup links, one `Name | https://…/{domain}` per line. Seeded
  // with the shipped list as plain text so any entry can be removed. Empty means
  // no links at all. These are links the user may follow, never requests the
  // extension makes.
  lookupServices: string
}

export interface LinkSafetySettings {
  enabled: boolean
  tooltipTrigger: 'hover' | 'click-left' | 'click-right'
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
export const DEFAULT_DISPOSABLE_LIST_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'
export const DEFAULT_PUBLIC_LIST_URL = 'https://raw.githubusercontent.com/willwhite/freemail/master/data/free.txt'

export const defaultSettings: Settings = {
  // Threshold settings
  safety: 10,

  // Display settings
  showBadge: true,
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

  // Anti-tampering exclusions
  antiTamperingExcludedDomains: '',

  // Seeded with a maintained source each. Nothing is fetched until the user
  // presses Update, and clearing a field turns that source off
  disposableEmailListUrl: DEFAULT_DISPOSABLE_LIST_URL,
  publicEmailListUrl: DEFAULT_PUBLIC_LIST_URL,

  // Seeded with the shipped links, which the user may edit or clear
  lookupServices: serializeLookupServices(DEFAULT_LOOKUP_SERVICES),

  // Link safety settings
  linkSafety: {
    enabled: true,
    tooltipTrigger: 'hover',
    // Long enough that crossing a link on the way somewhere else shows nothing,
    // short enough that stopping on one feels immediate
    hoverDelay: 300,
    showVisitCount: 'always',
    shortUrlMode: 'button',
    shortUrlShowFullUrl: false,
    shortUrlTraceChain: false,
    shortUrlResolveAny: false,
    shortUrlListUpdateUrl: '',
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

  await browser.storage.local.set({ [TEXT_DEFAULTS_SEEDED_KEY]: true })

  const stored = (await browser.storage.sync.get('settings')).settings
  // Nothing stored yet: the defaults already carry these values
  if (typeof stored !== 'string')
    return

  try {
    const parsed = JSON.parse(stored) as Partial<Settings>
    if (!parsed)
      return

    let changed = false
    for (const field of SEEDED_TEXT_FIELDS) {
      if (!parsed[field]) {
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
