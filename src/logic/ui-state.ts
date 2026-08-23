import type { EmailProviderKind } from './email-providers'
import type { EmailAnalysis, MailtoField } from './email-safety'
import type { FamiliarityStats } from './familiarity'
import type { MailSiteFamily } from './mail-sites'
import type { PastePayloadInfo } from './paste-guard'
import { ref } from 'vue'

export const showWarning = ref(false)
export const warningType = ref<'input' | 'copy'>('input')

/**
 * The frame the warning is about, when it did not come from this document.
 *
 * A form served in an iframe belongs to a different site from the page around
 * it, and that is the whole reason the warning is worth reading: the address bar
 * says one thing and the box the user is typing into belongs to another.
 */
export const warningFrameHost = ref<string | null>(null)
export const safetyLevel = ref<boolean | null>(null)
export const isIgnored = ref(false)
export const hasNotifiedOnThisPage = ref(false)

// Shortened URL resolution info
export interface ShortUrlInfo {
  originalUrl: string
  resolvedUrl: string
  resolvedDomain: string
  /** The destination's own facts, for the same evidence line the link gets */
  resolvedStats: FamiliarityStats
  resolvedIsSafe: boolean
  /**
   * The destination's other spelling, when it has one.
   *
   * The whole point of resolving a short link is that the address the user could
   * see said nothing. Handing back a visit count for the destination and nothing
   * else means a link to a punycode lookalike arrives with none of the markers
   * the same address would have got if it had been written out.
   */
  resolvedPunycode?: string | null
  chain: string[] // full redirect chain
  status: 'idle' | 'loading' | 'resolved' | 'error'
  error?: string
  isKnownShortener: boolean // true if domain is in the shortener list
}

// Tooltip content variants: absent kind = 'link' (backward compatible)
export type TooltipKind = 'link' | 'email' | 'text'

/**
 * One address the message would actually go to, checked in its own right.
 *
 * A `mailto:` carries a list, and `cc` and `bcc` are part of it. Reading only
 * the first meant `mailto:known@example.com,attacker@evil.example` showed as
 * checked on the strength of the name the user recognised.
 */
export interface EmailRecipientInfo {
  field: MailtoField
  analysis: EmailAnalysis
  providerKind: EmailProviderKind
  stats: FamiliarityStats
  isSafe: boolean
}

export interface EmailTooltipInfo {
  analysis: EmailAnalysis
  params: { key: string, value: string }[]
  mismatch: { textAddress: string } | null
  providerKind: EmailProviderKind
  /** Every recipient, the one above included. Empty for a bare address. */
  recipients?: EmailRecipientInfo[]
  /** How many were left unchecked because the list was longer than the cap. */
  recipientsNotChecked?: number
}

export interface RawPayloadInfo {
  payload: string
  payloadKind: 'tel' | 'wifi' | 'sms' | 'geo' | 'text'
}

// Link safety tooltip state
export interface LinkTooltipData {
  kind?: TooltipKind
  domain: string // email mode: the address's domain; text mode: ''
  stats: FamiliarityStats
  isSafe: boolean
  mismatch: { textDomain: string, textDomainStats: FamiliarityStats, textDomainIsSafe: boolean } | null
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
  /** See the note on `linkInterceptVisible`. Absent means yes. */
  ownNavigation?: boolean
  domain: string
  url: string
  target: string
  stats: FamiliarityStats
  isSafe: boolean
  mismatch: { textDomain: string, textDomainStats: FamiliarityStats, textDomainIsSafe: boolean } | null
  punycode: string | null
  shortUrl?: ShortUrlInfo | null
}

/**
 * Whether the dialog is the one that navigates when the user says go.
 *
 * True for a dialog raised about a bare URL – the long-press menu, a QR code –
 * where there is no element to click. False when a real link was intercepted:
 * the content script puts that click back on the anchor itself, so the target,
 * `download`, `rel` and the page's own handler all still apply. Navigating from
 * here in that case would throw all of it away.
 */
export const linkInterceptVisible = ref(false)
export const linkInterceptData = ref<LinkInterceptData | null>(null)
export const linkInterceptResolve = ref<((proceed: boolean) => void) | null>(null)

// Paste intercept dialog state. Same await-the-user shape as the link intercept:
// the paste event is already cancelled by the time this is shown, and answering
// yes only lifts the block, leaving the user to paste again themselves.
/**
 * Why the paste is being held.
 *
 * `unfamiliar` is the case the feature was built for. The other three exist
 * because a paste is cancelled before anything can be known about the page, and
 * a cancelled paste that shows nothing is the worst of both: the text does not
 * arrive and nobody is told why.
 *
 * `checking` – the verdict is still on its way.
 * `safe` – it arrived and the site is one the user knows.
 * `error` – it never arrived, so nothing can be said about this site.
 */
export type PasteInterceptStatus = 'unfamiliar' | 'checking' | 'safe' | 'error'

export interface PasteInterceptData {
  domain: string
  stats: FamiliarityStats
  punycode: string | null
  payload: PastePayloadInfo
  /** Absent means `unfamiliar`, which is what this dialog used to be only for. */
  status?: PasteInterceptStatus
  /**
   * Set when the paste happened inside an iframe rather than in this document.
   *
   * The domain above is then the frame's, not the page's, and the difference is
   * the point: the address bar says one site and the box says another.
   */
  inFrame?: boolean
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
