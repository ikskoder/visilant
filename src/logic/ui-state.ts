import type { EmailProviderKind } from './email-providers'
import type { EmailAnalysis } from './email-safety'
import type { FamiliarityStats } from './familiarity'
import type { MailSiteFamily } from './mail-sites'
import type { PastePayloadInfo } from './paste-guard'
import { ref } from 'vue'

export const showWarning = ref(false)
export const warningType = ref<'input' | 'copy'>('input')
export const safetyLevel = ref<boolean | null>(null)
export const isIgnored = ref(false)
export const hasNotifiedOnThisPage = ref(false)

// Shortened URL resolution info
export interface ShortUrlInfo {
  originalUrl: string
  resolvedUrl: string
  resolvedDomain: string
  resolvedCount: number
  resolvedIsSafe: boolean
  chain: string[] // full redirect chain
  status: 'idle' | 'loading' | 'resolved' | 'error'
  error?: string
  isKnownShortener: boolean // true if domain is in the shortener list
}

// Tooltip content variants: absent kind = 'link' (backward compatible)
export type TooltipKind = 'link' | 'email' | 'text'

export interface EmailTooltipInfo {
  analysis: EmailAnalysis
  params: { key: string, value: string }[]
  mismatch: { textAddress: string } | null
  providerKind: EmailProviderKind
}

export interface RawPayloadInfo {
  payload: string
  payloadKind: 'tel' | 'wifi' | 'sms' | 'geo' | 'text'
}

// Link safety tooltip state
export interface LinkTooltipData {
  kind?: TooltipKind
  domain: string // email mode: the address's domain; text mode: ''
  count: number
  isSafe: boolean
  mismatch: { textDomain: string, textDomainCount: number, textDomainIsSafe: boolean } | null
  punycode: string | null
  shortUrl?: ShortUrlInfo | null
  anchorRect: { top: number, bottom: number, left: number, right: number }
  href: string // email mode: full mailto: URL; text mode: raw payload
  email?: EmailTooltipInfo | null
  rawText?: RawPayloadInfo | null
}

export const linkTooltipVisible = ref(false)
export const linkTooltipData = ref<LinkTooltipData | null>(null)

// In-page check panel (context menu "check selection"): full domain-family
// dashboard like the extension popup, rendered on the current page
export interface DomainFamilyInfo {
  baseDomain: string
  entries: { hostname: string, count: number, activeDays?: number, firstSeen?: number }[]
  total: number
  /** The family's facts rolled together, for a verdict on the family as a whole */
  stats?: FamiliarityStats
  /** For an address domain, the sites its mail is actually read on */
  mailSites?: MailSiteFamily[]
}

export interface CheckPanelData {
  kind: 'domain' | 'email'
  hostname: string
  punycode: string | null
  email: { analysis: EmailAnalysis, providerKind: EmailProviderKind } | null
  family: DomainFamilyInfo
}

export const checkPanelVisible = ref(false)
export const checkPanelData = ref<CheckPanelData | null>(null)

// Link safety intercept dialog state
export interface LinkInterceptData {
  domain: string
  url: string
  target: string
  count: number
  isSafe: boolean
  mismatch: { textDomain: string, textDomainCount: number, textDomainIsSafe: boolean } | null
  punycode: string | null
  shortUrl?: ShortUrlInfo | null
}

export const linkInterceptVisible = ref(false)
export const linkInterceptData = ref<LinkInterceptData | null>(null)
export const linkInterceptResolve = ref<((proceed: boolean) => void) | null>(null)

// Paste intercept dialog state. Same await-the-user shape as the link intercept:
// the paste event is already cancelled by the time this is shown, and answering
// yes only lifts the block, leaving the user to paste again themselves.
export interface PasteInterceptData {
  domain: string
  count: number
  punycode: string | null
  payload: PastePayloadInfo
}

export const pasteInterceptVisible = ref(false)
export const pasteInterceptData = ref<PasteInterceptData | null>(null)
export const pasteInterceptResolve = ref<((proceed: boolean) => void) | null>(null)

/**
 * Set once the user has confirmed a paste here, and reset by the next page load.
 *
 * Silences the paste block and the warnings together: they have just looked at
 * the address and said yes, and telling them about the same address again is the
 * interruption the confirmation was supposed to buy off.
 */
export const pasteAllowedOnThisPage = ref(false)

// Callback to cancel tooltip grace timer (set by content script, called by tooltip component)
const _onTooltipHoverEnter = { fn: null as (() => void) | null }
export const onTooltipHoverEnter = _onTooltipHoverEnter
export function setOnTooltipHoverEnter(fn: () => void) {
  _onTooltipHoverEnter.fn = fn
}

// Callback to start grace timer on tooltip mouseleave (set by content script, called by App.vue)
const _onTooltipHoverLeave = { fn: null as (() => void) | null }
export const onTooltipHoverLeave = _onTooltipHoverLeave
export function setOnTooltipHoverLeave(fn: () => void) {
  _onTooltipHoverLeave.fn = fn
}
