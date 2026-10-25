/**
 * The settings: their shape, their defaults and how a stored value is read.
 *
 * Kept apart from storage.ts, which builds the reactive store the moment it is
 * imported. The frame guard runs in every frame of every page, and importing
 * a reader from there used to build that store, read `storage.sync` and keep a
 * listener in each one, adverts included. Nothing here runs on import.
 */
import type { BadgeContent } from './badge'
import type { DomainMetric } from './domain-metric'
import type { FamiliaritySettings } from './familiarity'
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

  // Turn a site's warnings back on once it is familiar – see auto-unsilence.ts
  autoUnsilenceFamiliar: boolean

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
  /**
   * Every label of an address in a frame of its own, the owner's labels in
   * heavier ones. Most readers do not know a dot is a boundary, and a frame is
   * hard to miss. Off, the frames go and the owner's labels turn bold, and the
   * marks on unexpected characters stay either way.
   */
  addressFrames: boolean
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

/**
 * What shows the link check without stopping anything, on a desktop: resting
 * the pointer on a link, or the item in its right-click menu.
 *
 * There used to be a third value, `click-left`, which stopped every click on a
 * link to an unfamiliar site. Stopping a click is a decision of its own now
 * (`intercept`), and a profile that still stores it is read by
 * `normalizeLinkSafety`.
 */
export type TooltipTrigger = 'hover' | 'click-right'

/**
 * When a click on a link is held and the dialog asks first.
 *
 * Friction only where there is a reason for it: a red flag is a reason on its
 * own, a short link hides where it goes, and an unfamiliar site without either
 * is the everyday case of a new site, which the typing warning still covers.
 */
export interface InterceptSettings {
  unfamiliar: boolean
  shortLinks: boolean
  /**
   * Whether a service's own short links are stopped on its own site: t.co on
   * X, youtu.be on YouTube. Every outside link on X is a t.co link, so with
   * this on every one of them is held. See `isOwnServiceShortLink`.
   */
  shortLinksOnOwnSite: boolean
  redFlags: boolean
  /** How many red flags a link needs before it is stopped, 1 to `MAX_RED_FLAG_THRESHOLD`. */
  minRedFlags: number
}

export const MAX_RED_FLAG_THRESHOLD = 5

export const defaultInterceptSettings: InterceptSettings = {
  unfamiliar: false,
  shortLinks: true,
  shortLinksOnOwnSite: true,
  redFlags: true,
  minRedFlags: 1,
}

export interface LinkSafetySettings {
  enabled: boolean
  tooltipTrigger: TooltipTrigger
  intercept: InterceptSettings
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

  // Off by default: a silence is the user's choice, and lifting one is not ours
  autoUnsilenceFamiliar: false,

  // Language settings
  selectedLanguage: 'en',

  // The related-domain list: visits are the count it has always drawn, largest first
  listMetric: 'visits',
  sortByName: false,
  sortOrder: 'desc',

  // Display settings
  domainCase: 'lower',
  accountNameCase: 'as-typed',
  addressFrames: true,
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
    intercept: { ...defaultInterceptSettings },

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

/**
 * The link settings complete and in the current shape, whatever is stored.
 *
 * Defaults are merged one level deep, so a profile stored before `intercept`
 * existed comes back with `linkSafety` whole and no `intercept` in it. And a
 * content script can read the settings before the one-off migration has
 * written them. So every reader goes through this rather than trusting the
 * stored object, the way `normalizeFamiliarity` is read.
 *
 * A stored `click-left` stopped every click on a link to an unfamiliar site.
 * Read here as exactly that: the right-click menu to show the check, and the
 * "unfamiliar site" box ticked, unless the profile already has the boxes, in
 * which case they are the user's choice and win.
 */
export function normalizeLinkSafety(value: unknown): LinkSafetySettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Omit<LinkSafetySettings, 'tooltipTrigger' | 'intercept'>> & { tooltipTrigger?: unknown, intercept?: Partial<InterceptSettings> }
  const legacyClickLeft = raw.tooltipTrigger === 'click-left'
  const tooltipTrigger: TooltipTrigger = raw.tooltipTrigger === 'hover' || raw.tooltipTrigger === 'click-right'
    ? raw.tooltipTrigger
    : defaultSettings.linkSafety.tooltipTrigger
  const stored = raw.intercept && typeof raw.intercept === 'object' ? raw.intercept : undefined
  const flag = (key: 'unfamiliar' | 'shortLinks' | 'shortLinksOnOwnSite' | 'redFlags', fallback: boolean) =>
    typeof stored?.[key] === 'boolean' ? stored[key] : fallback
  const minimum = Math.floor(Number(stored?.minRedFlags))
  return {
    ...defaultSettings.linkSafety,
    ...raw,
    tooltipTrigger,
    intercept: {
      unfamiliar: flag('unfamiliar', stored ? defaultInterceptSettings.unfamiliar : legacyClickLeft),
      shortLinks: flag('shortLinks', defaultInterceptSettings.shortLinks),
      shortLinksOnOwnSite: flag('shortLinksOnOwnSite', defaultInterceptSettings.shortLinksOnOwnSite),
      redFlags: flag('redFlags', defaultInterceptSettings.redFlags),
      minRedFlags: Number.isFinite(minimum) && minimum >= 1
        ? Math.min(minimum, MAX_RED_FLAG_THRESHOLD)
        : defaultInterceptSettings.minRedFlags,
    },
  }
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
