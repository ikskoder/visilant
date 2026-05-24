import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

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

  // Link safety settings
  linkSafety: LinkSafetySettings
}

export interface LinkSafetySettings {
  enabled: boolean
  tooltipTrigger: 'hover' | 'click-left'
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  interceptEnabled: boolean
  // Shortened URL settings
  shortUrlMode: 'off' | 'button' | 'auto' // off=disabled, button=resolve on click, auto=resolve automatically
  shortUrlShowFullUrl: boolean // show full resolved URL or just domain
  shortUrlTraceChain: boolean // show full redirect chain trace
  shortUrlResolveAny: boolean // allow resolving ANY url, not just known shorteners
  shortUrlListUpdateUrl: string // remote URL to fetch updated shortener list
  scopeMode: 'everywhere' | 'whitelist' | 'blacklist'
  scopeDomains: string
}

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

  // Link safety settings
  linkSafety: {
    enabled: true,
    tooltipTrigger: 'hover',
    showVisitCount: 'always',
    interceptEnabled: false,
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

// Define the site visit data structure
export interface SiteVisitData {
  count: number
  lastSeen: number // Unix timestamp of last visit
  ignored: boolean // Whether notifications are ignored for this site
}
