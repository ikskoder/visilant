/**
 * The link check in detail: every shape the tooltip takes, for links, for
 * email addresses and for QR codes that hold neither.
 *
 * Most of these never come up in ordinary browsing – a link one letter off a
 * bank the user knows, a short link that leads nowhere, a mailto with thirty
 * recipients – which is exactly why they are drawn here.
 */
import type { Page } from '@playwright/test'
import type { Seed } from './fixtures'
import type { FetchAnswer } from './helpers'
import { clickUi, FAMILIAR, fromMenu, openSite, patchSettings, seed, sitePage, test, waitForUi } from './fixtures'
import { a, canHover, checkSelection, DAY, linkPage, qrResult, seedRaw, setLocal, SITE, tapMailLink, workerFetch, workerRefusesVisits } from './helpers'
import { t } from './messages'

const TOOLTIP = 'src/contentScripts/views/LinkTooltip.vue'
const MISMATCH = 'src/contentScripts/views/MismatchTable.vue'
const EMAIL_MISMATCH = 'src/contentScripts/views/EmailMismatchTable.vue'

/** Sites the user knows, which most lookalikes below are lookalikes of. */
const KNOWN: Record<string, Seed> = {
  'northbank.test': FAMILIAR,
  'bank.test': FAMILIAR,
  'corp.test': FAMILIAR,
}
const LOW: Seed = { visits: 3, activeDays: 2, ageDays: 3 }

interface Case {
  name: string
  title: string
  note: string
  /** What brings it up: resting on the link, a QR code, a selection, or the menu item on a mail link */
  how: 'hover' | 'qr' | 'select' | 'mail-menu'
  /** The link, with id `l`, for `hover` */
  link?: string
  /** The whole page, when where the link sits matters */
  html?: string
  /** The QR code's text, or the text selected */
  text?: string
  seed?: Record<string, Seed>
  raw?: (now: number) => Record<string, unknown>
  settings?: Record<string, unknown>
  local?: Record<string, unknown>
  fetch?: Record<string, FetchAnswer>
  /** The background answers the visit lookup with an error, see `workerRefusesVisits` */
  unreachable?: boolean
  /** What the tooltip must say before the picture, so a half-built one is not taken */
  needles: () => string[]
  /** A button pressed in the tooltip before the picture, by its text */
  press?: () => string
  /** What it must say after that press */
  after?: () => string[]
  extra?: string[]
}

// The heading at the top and the button at the foot. Not a fact in between: a
// site never visited has none to show
const dest = () => [t('linkTooltipDestination'), t('linkInterceptDomainInfo')]
const email = () => [t('emailTooltipTitle')]
// Several recipients: a link, with each of them a row of the table
const mailLink = () => [t('mailLinkHeading'), t('emailRecipientsAddressColumn')]
const raw = () => [t('qrPayloadType')]

const CASES: Case[] = [
  // ==========================================
  // Verdicts and the facts behind them
  // ==========================================
  { name: 'tt-unchecked', how: 'hover', title: 'A site that could not be looked up', note: 'The background answered with an error, as in a tab left open across an extension update. A grey "Not checked" badge and a line saying a reload usually fixes it, and no visit facts at all, never "Never visited".', unreachable: true, link: a('https://somewhere-new.test/', 'Somewhere'), needles: () => [t('verdictUnchecked')] },
  { name: 'tt-some-visits', how: 'hover', title: 'Link to a site seen a few times', note: 'Three visits, not enough to be familiar. The red badge should read "Unfamiliar site", not "Never visited".', seed: { 'low.test': LOW }, link: a('https://low.test/', 'A site seen three times'), needles: dest },
  { name: 'tt-count-hidden', how: 'hover', title: 'Link with visit counts switched off', note: 'Setting "show visit count: never". Only the verdict badge and the name, no facts.', settings: { linkSafety: { showVisitCount: 'never' } }, link: a('https://low.test/', 'A site seen three times'), seed: { 'low.test': LOW }, needles: () => [t('linkTooltipDestination')] },
  { name: 'tt-rule-any', how: 'hover', title: 'Familiar under "any one check", most checks failing', note: 'Rule "any one check is enough": twelve visits pass, the other two fail. A green shield verdict over red crosses, with a "Passed checks 1 / 1" line, in bold explaining it.', settings: { familiarity: { mode: 'any' } }, seed: { 'x-visits.test': { visits: 12, activeDays: 1, ageDays: 1 } }, link: a('https://x-visits.test/', 'Busy but new'), needles: dest },
  { name: 'tt-rule-atleast', how: 'hover', title: 'Unfamiliar under "at least 2 of 3"', note: 'Only one check passes, two are needed. Red "Unfamiliar site" badge and "Passed checks 1 / 2" in bold.', settings: { familiarity: { mode: 'atLeast', atLeast: 2 } }, seed: { 'x-visits.test': { visits: 12, activeDays: 1, ageDays: 1 } }, link: a('https://x-visits.test/', 'Busy but new'), needles: dest },
  { name: 'tt-thresholds-any', how: 'hover', title: 'The facts as a table, with the "any" summary row', note: 'Bars shown and rule "any": a small table of check, value and bar, with a bold Checks row.', settings: { showFamiliarityThresholds: true, familiarity: { mode: 'any' } }, seed: { 'x-visits.test': { visits: 12, activeDays: 1, ageDays: 1 } }, link: a('https://x-visits.test/', 'Busy but new'), needles: dest },
  { name: 'tt-unknown-facts', how: 'hover', title: 'A site recorded before dates were kept', note: 'The record has visits but no first-visit date or active days. Those two read "not recorded" in grey with a red failed mark, and count as failed.', raw: now => ({ 'legacy.test': { count: 15, lastSeen: now - DAY, ignored: false } }), link: a('https://legacy.test/', 'An old favourite'), needles: dest },
  { name: 'tt-single-check', how: 'hover', title: 'Only the visits check switched on', note: 'One fact line, no others.', settings: { familiarity: { activeDays: { enabled: false, min: 5 }, age: { enabled: false, min: 10 } } }, seed: { 'low.test': LOW }, link: a('https://low.test/', 'A site seen three times'), needles: dest },
  { name: 'tt-subdomain-of-familiar', how: 'hover', title: 'A new page on a site the user knows', note: 'login.bank.test was never visited but bank.test is familiar. The tooltip judges the exact name, so it reads "never visited", and no lookalike line appears.', seed: KNOWN, link: a('https://login.bank.test/', 'Sign in'), needles: dest },
  { name: 'tt-hosted-on', how: 'hover', title: 'Link to a site on a shared hosting platform', note: 'someone.github.io, never visited. An orange line says anyone can make a site on github.io and that github.io does not run this one.', link: a('https://someone.github.io/', 'My page'), needles: dest },
  { name: 'tt-hosted-on-familiar', how: 'hover', title: 'The same, when the site is familiar', note: 'myblog.github.io with plenty of visits: no platform line, the user already knows the site.', seed: { 'myblog.github.io': FAMILIAR }, link: a('https://myblog.github.io/', 'My blog'), needles: dest },
  { name: 'tt-font-150', how: 'hover', title: 'Link check at 150% text size', note: 'The popup text size applies here too.', settings: { popupFontSize: 150 }, seed: { 'low.test': LOW }, link: a('https://low.test/', 'A site seen three times'), needles: dest },

  // ==========================================
  // Lookalikes of a site the user knows (northbank.test)
  // ==========================================
  { name: 'tt-look-confusable', how: 'hover', title: 'Lookalike: a letter swapped for a similar one', note: 'n0rthbank.test with a zero for the o. A red line names northbank.test.', seed: KNOWN, link: a('https://n0rthbank.test/', 'Your bank'), needles: dest },
  { name: 'tt-look-one-edit', how: 'hover', title: 'Lookalike: one letter different', note: 'northbamk.test. A red line.', seed: KNOWN, link: a('https://northbamk.test/', 'Your bank'), needles: dest },
  { name: 'tt-look-two-edits', how: 'hover', title: 'Lookalike: two letters different', note: 'northbqnx.test, two letters changed. Less sure, and the words say so. Orange with the shield and its exclamation mark, not a red flag.', seed: KNOWN, link: a('https://northbqnx.test/', 'Your bank'), needles: dest },
  { name: 'tt-look-extra-text', how: 'hover', title: 'Lookalike: the known name with text added', note: 'northbank-secure.test. Red "with extra text added".', seed: KNOWN, link: a('https://northbank-secure.test/', 'Your bank'), needles: dest },
  { name: 'tt-look-as-subdomain', how: 'hover', title: 'Lookalike: the known site used as a subdomain', note: 'northbank.test.evil.test. The line shows the known name in grey and the real site in red.', seed: KNOWN, link: a('https://northbank.test.evil.test/', 'Your bank'), needles: dest },
  { name: 'tt-look-other-ending', how: 'hover', title: 'Lookalike: same name, different ending', note: 'northbank.example. Red "different ending" notice.', seed: KNOWN, link: a('https://northbank.example/', 'Your bank'), needles: dest },
  { name: 'tt-look-several', how: 'hover', title: 'Lookalike of several known sites at once', note: 'northbank-bank.test looks like both northbank.test and bank.test. Up to three lines.', seed: KNOWN, link: a('https://northbank-bank.test/', 'Your bank'), needles: dest },

  // ==========================================
  // What the address itself gives away
  // ==========================================
  { name: 'tt-mark-userinfo', how: 'hover', title: 'A decoy name before @ in the link', note: 'https://bank.test@evil.test/ goes to evil.test. A red flag line says to ignore the part before @, which is struck through.', seed: KNOWN, link: a('https://bank.test@evil.test/login', 'Log in'), needles: dest },
  { name: 'tt-mark-ip', how: 'hover', title: 'A link to a bare IP address', note: 'A red flag line: numeric address, not a domain name. The address is one frame, in red.', link: a('http://203.0.113.5/login', 'Log in'), needles: dest },
  { name: 'tt-mark-embedded', how: 'hover', title: 'A well-known name parked in front of another site', note: 'paypal.com.verify.test, with paypal.com not known to the user. No line about the parked name and no red flag: it imitates nothing the user trusts, and the verdict already says the site is unknown. paypal and com are dashed and uncoloured.', link: a('https://paypal.com.verify.test/', 'PayPal'), needles: dest },
  { name: 'tt-plain-subdomain', how: 'hover', title: 'An address with a level in front of the site, nothing found', note: 'docs.new-place.test. The site, new-place and test, in solid frames on a tint. The level in front of it, docs, in a dashed frame: free text, which the site\'s owner writes as they like. No colour anywhere: no finding.', link: a('https://docs.new-place.test/', 'Read the docs'), needles: dest },
  { name: 'tt-frames-off-flagged', how: 'hover', title: 'Findings in an address with the frames switched off', note: 'paypal.com.a.b.c.verify.test with the frames off in the settings. No label is broken in two. The borrowed name keeps a red tint and the levels after it an orange one, the site is bold.', settings: { addressFrames: false }, link: a('https://paypal.com.a.b.c.verify.test/', 'Sign in'), needles: dest },
  { name: 'tt-mark-embedded-two', how: 'hover', title: 'Two well-known names parked in front of another site', note: 'paypal.com.google.com.login.verify.test, both familiar. One red lookalike line naming both, "paypal.com or google.com", and verify.test as the real site once.', seed: { 'paypal.com': FAMILIAR, 'google.com': FAMILIAR }, link: a('https://paypal.com.google.com.login.verify.test/', 'Sign in'), needles: dest },
  { name: 'tt-mark-embedded-three', how: 'hover', title: 'Three well-known names parked in front of another site', note: 'paypal.com.google.com.apple.com.verify.test, all three familiar. One red line naming all three, with "or" between each two and never a comma, and every parked label red.', seed: { 'paypal.com': FAMILIAR, 'google.com': FAMILIAR, 'apple.com': FAMILIAR }, link: a('https://paypal.com.google.com.apple.com.verify.test/', 'Sign in'), needles: dest },
  { name: 'tt-mark-embedded-known', how: 'hover', title: 'The same, when the parked name is a site the user knows', note: 'paypal.com is familiar now, so the embedded-ending sentence is replaced by the lookalike line.', seed: { 'paypal.com': FAMILIAR }, link: a('https://paypal.com.verify.test/', 'PayPal'), needles: dest },
  { name: 'tt-mark-deep', how: 'hover', title: 'Too many subdomain levels', note: 'a.b.c.d.evil.test.', link: a('https://a.b.c.d.evil.test/', 'Somewhere'), needles: dest },
  { name: 'tt-mark-mixed-script', how: 'hover', title: 'Latin and Cyrillic letters mixed in one name', note: 'pаypal.test with a Cyrillic а. The name is also shown in its xn-- spelling, and a marker names the mixed part.', link: a('https://pаypal.test/', 'PayPal'), needles: dest },
  { name: 'tt-idn-one-script', how: 'hover', title: 'A name entirely in another alphabet', note: 'пример.test. The xn-- spelling is shown, and a red flag says Cyrillic letters sit before the Latin ending .test, with no claim that it imitates a Latin name.', link: a('https://пример.test/', 'Пример'), needles: dest },
  { name: 'tt-mark-latin-twins', how: 'hover', title: 'A name of Cyrillic letters that all look Latin', note: 'аррӏе.test, every letter Cyrillic and drawn like a Latin one, so it reads as apple. A red flag line names the alphabet, and the count beside the verdict says 1 red flag.', link: a('https://аррӏе.test/', 'Apple'), needles: dest },
  { name: 'tt-long-name', how: 'hover', title: 'A very long host name', note: 'Four long labels. The name should wrap at dots inside the tooltip, not overflow it.', link: a('https://this-is-a-very-long-label-that-goes-on-and-on.another-long-label-that-also-goes-on-and-on.yet-another-very-long-label-for-testing.evil.test/', 'Somewhere'), needles: dest },
  { name: 'tt-above-link', how: 'hover', title: 'Link at the bottom of the window', note: 'No room below, so the tooltip opens above the link.', html: sitePage('Unknown Shop', `<p>A link at the very bottom.</p><a id="l" href="https://low.test/" style="position:fixed;bottom:6px;left:40px;font-size:20px">A site seen three times</a>`), seed: { 'low.test': LOW }, needles: dest },
  { name: 'tt-right-edge', how: 'hover', title: 'Link at the right edge of the window', note: 'The tooltip is pushed back inside the window rather than cut off.', html: sitePage('Unknown Shop', `<p>A link at the right edge.</p><a id="l" href="https://low.test/" style="position:fixed;top:120px;right:4px;font-size:20px">Here</a>`), seed: { 'low.test': LOW }, needles: dest },

  // ==========================================
  // Link text naming another site
  // ==========================================
  { name: 'tt-mm-count-mixed', how: 'hover', title: 'Text names a site, link goes elsewhere, counts only for unfamiliar', note: 'Setting "show count for unfamiliar sites only". The familiar column says the count is hidden by settings.', settings: { linkSafety: { showVisitCount: 'unfamiliar' } }, seed: KNOWN, link: a('https://new-place.test/', 'bank.test'), needles: () => [t('linkTooltipMismatchWarning')] },
  { name: 'tt-mm-count-never', how: 'hover', title: 'Text names a site, link goes elsewhere, counts never shown', note: 'The table keeps only the domain, status and details rows.', settings: { linkSafety: { showVisitCount: 'never' } }, seed: KNOWN, link: a('https://new-place.test/', 'bank.test'), needles: () => [t('linkTooltipMismatchWarning')] },
  { name: 'tt-mm-summary', how: 'hover', title: 'Text names a site, link goes elsewhere, rule "any", bars on', note: 'An extra Checks row, and value / bar in each cell.', settings: { showFamiliarityThresholds: true, familiarity: { mode: 'any' } }, seed: KNOWN, link: a('https://new-place.test/', 'bank.test'), needles: () => [t('linkTooltipMismatchWarning')] },
  { name: 'tt-mm-lookalike', how: 'hover', title: 'Text names the known site, link goes to its lookalike', note: 'The table, then the lookalike line underneath.', seed: KNOWN, link: a('https://n0rthbank.test/', 'northbank.test'), needles: () => [t('linkTooltipMismatchWarning')] },
  { name: 'tt-mm-shortener', how: 'hover', title: 'Text names a site, link is a short link', note: 'The mismatch wins: no short-link controls.', seed: KNOWN, link: a('https://bit.ly/3abcde', 'bank.test'), needles: () => [t('linkTooltipMismatchWarning')] },
  { name: 'tt-mm-aria', how: 'hover', title: 'The site named in an accessibility label, not in the text', note: 'The link says "Click", its aria-label says bank.test. The table should still appear.', seed: KNOWN, link: '<a id="l" href="https://new-place.test/" aria-label="bank.test">Click</a>', needles: () => [t('linkTooltipMismatchWarning')] },

  // ==========================================
  // Short links
  // ==========================================
  { name: 'tt-short-any-idle', how: 'hover', title: 'Any link may be followed, not only short ones', note: 'Setting "resolve any URL". An ordinary link gets a "Try to find where it leads" button but no short-link warning.', settings: { linkSafety: { shortUrlResolveAny: true } }, seed: { 'low.test': LOW }, link: a('https://low.test/go', 'Go'), needles: () => [...dest(), t('linkResolveTry')] },
  { name: 'tt-short-loading', how: 'hover', title: 'Short link being followed', note: 'The short-link service does not answer. "Following the link…". The pending sign sits beside the text.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { hang: true } }, link: a('https://bit.ly/3loadin', 'bit.ly/3loadin'), needles: () => [t('linkTooltipResolvingUrl')] },
  { name: 'tt-short-error', how: 'hover', title: 'Short link that could not be followed', note: 'The network failed. "Couldn\'t find where this link leads" and a Retry button.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { fail: true } }, link: a('https://bit.ly/3errorx', 'bit.ly/3errorx'), needles: () => [t('linkTooltipResolveError')] },
  { name: 'tt-short-same-host', how: 'hover', title: 'Short link that stays on the short-link site', note: 'Following it ended on bit.ly itself. A message says it may be broken, with no Retry.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://bit.ly/landing' } }, link: a('https://bit.ly/3samehx', 'bit.ly/3samehx'), needles: () => [t('linkTooltipResolveSameDomainShortener')] },
  { name: 'tt-short-to-familiar', how: 'hover', title: 'Short link that leads to a site the user knows', note: 'The real destination gets the green "Familiar site" badge.', seed: KNOWN, settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://bank.test/statement' } }, link: a('https://bit.ly/3tofami', 'bit.ly/3tofami'), needles: () => [t('linkTooltipShortenedUrl')] },
  { name: 'tt-short-to-mixed-script', how: 'hover', title: 'Short link that leads to a Cyrillic lookalike', note: 'The destination block shows the xn-- spelling and the mixed-alphabet marker.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://xn--pypal-4ve.test/login' } }, link: a('https://bit.ly/3topuny', 'bit.ly/3topuny'), needles: () => [t('linkTooltipShortenedUrl')] },
  { name: 'tt-short-to-lookalike', how: 'hover', title: 'Short link that leads to a lookalike of a known site', note: 'A lookalike line inside the destination block.', seed: KNOWN, settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://n0rthbank.test/login' } }, link: a('https://bit.ly/3tolook', 'bit.ly/3tolook'), needles: () => [t('linkTooltipShortenedUrl')] },
  { name: 'tt-short-long-url', how: 'hover', title: 'Short link with a very long destination, full address shown', note: 'The full address should break across lines, not widen the tooltip past the window.', settings: { linkSafety: { shortUrlMode: 'auto', shortUrlShowFullUrl: true } }, fetch: { 'https://bit.ly/': { to: `https://prize-winner.test/claim?${Array.from({ length: 20 }, (_, i) => `param${i}=value-${i}-with-some-length`).join('&')}` } }, link: a('https://bit.ly/3longur', 'bit.ly/3longur'), needles: () => [t('linkTooltipShortenedUrl')] },
  { name: 'tt-parts', how: 'hover', title: 'The card that reads an address part by part', note: 'The question mark after secure.login.verify-acc.test pressed: a card under it with the levels in front of the site (dashed), the own name of the site (solid on a tint) and the ending (a grey pill), each with what it means. The ending in the address is a grey pill too.', link: a('https://secure.login.verify-acc.test/', 'Sign in'), needles: dest, press: () => t('addressPartsAsk'), after: () => [t('addressPartNameTitle')] },
  { name: 'tt-parts-platform', how: 'hover', title: 'The card for a site on a platform', note: 'alice.github.io: the name line, then the platform line saying alice is one of its users, not the platform.', link: a('https://alice.github.io/', 'Portfolio'), needles: dest, press: () => t('addressPartsAsk'), after: () => [t('addressPartNameTitle')] },
  { name: 'em-parts', how: 'hover', title: 'The card for an email address', note: 'billing@mail.corp.test: a username line first, then the level, the name and the ending.', seed: KNOWN, link: a('mailto:billing@mail.corp.test', 'Write to billing'), needles: email, press: () => t('addressPartsAsk'), after: () => [t('addressPartNameTitle')] },
  { name: 'tt-private-ip', how: 'hover', title: 'A link to a home router address', note: 'http://192.168.1.1/. A grey verdict saying visits to such an address are not counted, as on the check panel, never a red "Never visited".', link: a('http://192.168.1.1/', 'Router settings'), needles: () => [t('linkTooltipDestination')] },
  { name: 'tt-public-ip', how: 'hover', title: 'A link to a bare public IP address', note: 'http://8.8.8.8/. Counted like any site, so a red "Never visited", and the red flag for a bare public IP address.', link: a('http://8.8.8.8/', 'Open'), needles: () => [t('linkTooltipDestination')] },
  { name: 'tt-short-local', how: 'hover', title: 'Short link whose page sends it into the local network', note: 'The short-link page redirects to 192.168.1.1. Visilant stops there and says why, with no Retry, and the router is never asked.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { body: '<meta http-equiv="refresh" content="0; url=http://192.168.1.1/apply?reboot=1">' } }, link: a('https://bit.ly/3router', 'bit.ly/3router'), needles: () => [t('linkTooltipResolveRefused')] },
  { name: 'tt-short-mode-off', how: 'hover', title: 'Short links not followed at all', note: 'Setting off: bit.ly looks like any other site, no short-link badge, no buttons.', settings: { linkSafety: { shortUrlMode: 'off' } }, link: a('https://bit.ly/3offmod', 'bit.ly/3offmod'), needles: dest },
  {
    name: 'tt-short-pressed-loading',
    how: 'hover',
    title: 'Short link, "Try to find where it leads" pressed, still waiting',
    note: 'The default mode follows only when asked. After pressing the button it looks the same as following straight away: "Following the link…". The pending sign sits beside the text.',
    fetch: { 'https://bit.ly/': { hang: true } },
    link: a('https://bit.ly/3presse', 'bit.ly/3presse'),
    needles: () => [t('linkResolveTry')],
    press: () => t('linkResolveTry'),
    after: () => [t('linkTooltipResolvingUrl')],
  },
  {
    name: 'tt-once-resolved',
    how: 'hover',
    title: 'An ordinary link checked for where it really leads',
    note: '"Try to find where it leads" pressed on a link that is not a known shortener, and it redirected elsewhere. The destination block and a "Mark as a short-link service" button.',
    seed: { 'low.test': LOW },
    fetch: { 'https://low.test/': { to: 'https://somewhere-else.test/landing' } },
    link: a('https://low.test/out', 'Out'),
    needles: () => [t('linkResolveTry')],
    press: () => t('linkResolveTry'),
    after: () => [t('linkTooltipShortenedUrl')],
  },
  {
    name: 'tt-once-same-site',
    how: 'hover',
    title: 'An ordinary link checked, and it stays put',
    note: '"Try to find where it leads" pressed, no redirect. A line says it stayed on the same site.',
    seed: { 'low.test': LOW },
    fetch: { 'https://low.test/': { to: 'https://low.test/out' } },
    link: a('https://low.test/out', 'Out'),
    needles: () => [t('linkResolveTry')],
    press: () => t('linkResolveTry'),
    after: () => [t('linkTooltipResolveSameDomain')],
  },

  // ==========================================
  // Email links (a tap on a phone)
  // ==========================================
  { name: 'em-familiar', how: 'hover', title: 'Email to a company the user knows', note: 'The address domain is a familiar site: green badge and its facts.', seed: KNOWN, link: a('mailto:ann@corp.test', 'Write to Ann'), needles: email },
  { name: 'em-unfamiliar', how: 'hover', title: 'Email to a domain seen a few times', note: 'Red "Unfamiliar site" badge.', seed: { 'low.test': LOW }, link: a('mailto:sales@low.test', 'Write to sales'), needles: email },
  { name: 'em-count-hidden', how: 'hover', title: 'Email with visit counts switched off', note: 'No "Site" block.', settings: { linkSafety: { showVisitCount: 'never' } }, seed: KNOWN, link: a('mailto:ann@corp.test', 'Write to Ann'), needles: email },
  { name: 'em-params', how: 'hover', title: 'Email with a long pre-filled message', note: 'Subject, a 500-character body cut with "…", and more fields. The list scrolls.', seed: KNOWN, link: a(`mailto:ann@corp.test?subject=Invoice%20overdue&body=${'Please%20pay%20now.%20'.repeat(25)}&x1=one&x2=two&x3=three&x4=four&x5=five`, 'Pay the invoice'), needles: email },
  { name: 'em-cc-bcc', how: 'hover', title: 'Email with copies and hidden copies', note: 'Rows with To, Cc and Bcc tags, sorted by domain. The row at the throwaway service opened: one orange block headed "Temporary email service", with the copy button on the open row, since a tooltip has no card to copy from.', seed: KNOWN, link: a('mailto:ann@corp.test?cc=bob@new-place.test&bcc=eve@mailinator.com', 'Write to Ann'), needles: mailLink, press: () => 'eve', after: () => [t('emailDisposableHint')] },
  { name: 'em-same-domain', how: 'hover', title: 'Email to several people, two of them at one domain', note: 'One row each, closed: the one at c0rp.test, a letter off, sorts right above the two at corp.test, with its red flag counted beside its verdict sign. The line under the heading says what the violet frame means, since corp.test repeats.', seed: KNOWN, link: a('mailto:ann@corp.test,bob@corp.test?cc=eve@c0rp.test&bcc=pay@new-place.test', 'Write to the team'), needles: mailLink },
  { name: 'em-bcc-only', how: 'hover', title: 'Email whose only recipient is a hidden copy', note: 'mailto:?bcc=... The hidden recipient heads the tooltip.', link: a('mailto:?bcc=evil@new-place.test', 'Contact us'), needles: email },
  { name: 'em-recipient-notes', how: 'hover', title: 'Email to six recipients, each suspicious in its own way', note: 'A familiar one, a throwaway service, a forwarding service, a foreign alphabet, a familiar name parked in front of another site, and an unknown one. Closed rows say each in signs: the verdict, the flag with a count, the orange shield with a count. The parked name opened: its red lookalike line under it, and its labels red in the address.', seed: { ...KNOWN, 'paypal.com': FAMILIAR }, link: a('mailto:a@corp.test,b@mailinator.com,f@mozmail.com,c@пример.test,d@paypal.com.evil.test,e@new-place.test', 'Reply all'), needles: mailLink, press: () => 'd', after: () => ['but the real site is'] },
  { name: 'em-recipient-forwarding', how: 'hover', title: 'Email to two recipients, one at a forwarding service, opened', note: 'The forwarding row opened: one orange block headed "Email forwarding service", with its question mark.', seed: KNOWN, link: a('mailto:a@corp.test,f@mozmail.com', 'Reply all'), needles: mailLink, press: () => 'f', after: () => [t('emailForwardingHint')] },
  { name: 'em-thirty', how: 'hover', title: 'Email to thirty recipients and two entries that are not addresses', note: 'All 30 rows checked, however many there are. The two entries that do not read as an address are counted under the table as not checked.', seed: KNOWN, link: a(`mailto:${Array.from({ length: 30 }, (_, i) => `person${i}@corp.test`).join(',')},not-an-address,also%20not`, 'Reply all'), needles: mailLink },
  { name: 'em-local-unicode', how: 'hover', title: 'A Cyrillic letter in the name before @', note: 'jоhn@corp.test. One red flag line: 1 letter looks like a Latin one but is Cyrillic, it reads as john (framed) but is a different address.', seed: KNOWN, link: a('mailto:jоhn@corp.test', 'Write to John'), needles: email },
  { name: 'em-local-marks', how: 'hover', title: 'Letters with marks in the name before @', note: 'josé@corp.test. One orange line: letters with marks, and without them jose (framed) is a different address.', seed: KNOWN, link: a('mailto:josé@corp.test', 'Write to José'), needles: email },
  { name: 'em-local-script', how: 'hover', title: 'A name before @ in Cyrillic letters', note: 'иван@corp.test. One orange line: the username is in Cyrillic letters, and some mail services cannot send to it. Nothing about imitation, since и reads as no Latin letter.', seed: KNOWN, link: a('mailto:иван@corp.test', 'Write to Ivan'), needles: email },
  { name: 'em-local-invisible', how: 'hover', title: 'An invisible character in the name before @', note: 'jo, an invisible U+200B, hn at corp.test. One orange line: an invisible character, and an address that looks the same without it is a different one. The address marks where it is.', seed: KNOWN, link: a('mailto:jo\u200Bhn@corp.test', 'Write to John'), needles: email },
  { name: 'em-embedded-ending', how: 'hover', title: 'A well-known ending in the middle of the address domain', note: 'x@paypal.com.evil.test with paypal.com familiar. One red lookalike line naming the real site. The email block does not say the same thing again in its own words.', seed: { 'paypal.com': FAMILIAR }, link: a('mailto:x@paypal.com.evil.test', 'PayPal support'), needles: email },
  { name: 'em-idn', how: 'hover', title: 'An address domain in another alphabet', note: 'x@пример.test. The xn-- spelling is shown.', link: a('mailto:x@пример.test', 'Write'), needles: email },
  { name: 'em-provider-lookalike', how: 'hover', title: 'An address one letter off gmail.com', note: 'gmai1.com, with nothing in history. The line names the well-known email service instead.', link: a('mailto:support@gmai1.com', 'Support'), needles: email },
  { name: 'em-text-is-domain', how: 'hover', title: 'Email link whose text is a domain', note: 'The link reads corp.test, the address is at new-place.test. The table: "Not in the link text" for the username shown, x on the other side, the two domains side by side with their verdicts and visits.', seed: KNOWN, link: a('mailto:x@new-place.test', 'corp.test'), needles: () => [t('emailMismatchHowTo')] },
  { name: 'em-mm-same-domain', how: 'hover', title: 'Email link text shows another username at the same domain', note: 'billing@corp.test shown, b1lling@corp.test the target. The usernames side by side, the one it goes to in a red frame. The domain and its one verdict once across both columns, no visit rows.', seed: KNOWN, link: a('mailto:b1lling@corp.test', 'billing@corp.test'), needles: () => [t('emailMismatchHowTo')] },
  { name: 'em-mm-public', how: 'hover', title: 'Email link text shows a familiar site, the mail goes to a public provider', note: 'billing@corp.test shown, corp.billing@gmail.com the target. The target side has "Public email service" and one cell down the visit rows: not judged by visits.', seed: KNOWN, link: a('mailto:corp.billing@gmail.com', 'billing@corp.test'), needles: () => [t('emailMismatchHowTo')] },
  { name: 'em-mm-disposable', how: 'hover', title: 'Email link text shows a familiar site, the mail goes to a throwaway service', note: 'billing@corp.test shown, billing@mailinator.com the target. The username once across both columns, the domains apart, the orange badge and no visits on the target side.', seed: KNOWN, link: a('mailto:billing@mailinator.com', 'billing@corp.test'), needles: () => [t('emailMismatchHowTo')] },
  { name: 'em-mm-two-public', how: 'hover', title: 'Email link text shows one public provider, the mail goes to another', note: 'ann.smith@gmail.com shown, ann.smith@outlook.com the target. No visit rows at all: neither side is judged by visits.', link: a('mailto:ann.smith@outlook.com', 'ann.smith@gmail.com'), needles: () => [t('emailMismatchHowTo')] },
  { name: 'em-mm-several', how: 'hover', title: 'Email link text names none of its two recipients', note: 'billing@corp.test shown, the mail goes to billing@c0rp.test and pay@new-place.test. One table per recipient, headed "Goes to (#1 of 2)" and "Goes to (#2 of 2)".', seed: KNOWN, link: a('mailto:billing@c0rp.test,pay@new-place.test', 'billing@corp.test'), needles: () => [t('emailMismatchHowTo')] },
  { name: 'em-long', how: 'hover', title: 'A very long address', note: 'A 64-character name at a long domain. It breaks anywhere rather than overflow.', link: a(`mailto:${'a'.repeat(30)}.${'b'.repeat(33)}@a-really-long-company-name-for-billing-purposes.example-mail.test`, 'Write'), needles: email },
  { name: 'em-upper', how: 'hover', title: 'Address with names shown in capitals', note: 'Settings: domains and account names in capitals.', settings: { domainCase: 'upper' }, seed: KNOWN, link: a('mailto:John.Doe@corp.test', 'Write to John'), needles: email },

  // ==========================================
  // QR codes and selections with no site in them
  // ==========================================
  { name: 'qr-tel', how: 'qr', title: 'QR code with a phone number', note: 'Payload type "Phone number", digits highlighted.', text: 'tel:+1-555-0100', needles: raw },
  { name: 'qr-sms', how: 'qr', title: 'QR code with a text message', note: 'Payload type "SMS".', text: 'SMSTO:+15550100:Hello there', needles: raw },
  { name: 'qr-geo', how: 'qr', title: 'QR code with a location', note: 'Payload type "Location".', text: 'geo:52.5200,13.4050', needles: raw },
  { name: 'qr-text', how: 'qr', title: 'QR code with plain words', note: 'Payload type "Text".', text: 'Meet at the north entrance', needles: raw },
  { name: 'qr-long', how: 'qr', title: 'QR code with 1500 characters of text', note: 'The box scrolls instead of growing past the window.', text: 'Lorem ipsum dolor sit amet, '.repeat(55), needles: raw },
  { name: 'qr-invisible', how: 'qr', title: 'QR code hiding invisible characters', note: 'A right-to-left override and a zero-width space are drawn as red tokens.', text: 'invoice‮fdp.exe paypa​l', needles: raw },
  { name: 'qr-url', how: 'qr', title: 'QR code with a link', note: 'The usual link tooltip, at the top of the window, with a close button in its corner and "Open in new tab", outlined in red for a site never visited.', text: 'https://new-place.test/login', needles: () => [t('linkTooltipDestination')] },
  { name: 'qr-domain', how: 'qr', title: 'QR code with a bare domain', note: 'Read as https://bank.test, a familiar site.', seed: KNOWN, text: 'bank.test', needles: () => [t('linkTooltipDestination')] },
  { name: 'qr-mailto', how: 'qr', title: 'QR code with a mailto and its extras', note: 'Only the address is kept: no subject, no copies.', seed: KNOWN, text: 'mailto:a@corp.test?subject=Hi&cc=b@x.test', needles: email },
  { name: 'qr-short', how: 'qr', title: 'QR code with a short link, followed', note: 'Followed straight away, to a never-visited site.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://prize-winner.test/claim' } }, text: 'https://bit.ly/3qrcode', needles: () => [t('linkTooltipShortenedUrl')] },
  { name: 'mail-menu-no-address', how: 'mail-menu', title: '"Check this email link" on a mail link with no address', note: 'mailto:?subject=Hello. Headed "Email link", a line says there is no address in it to check, then what the link holds. No "Content type: Text".', text: 'mailto:?subject=Hello', needles: () => [t('mailLinkNoAddress')] },
  { name: 'sel-nothing', how: 'select', title: 'Selected text with nothing to check in it', note: '"Check selection" on ordinary words. The tooltip shows the text as plain text.', text: 'hello world nothing here', needles: raw },
]

async function bringUp(page: Page, c: Case) {
  if (c.how === 'qr')
    return qrResult(page, c.text!, c.needles())
  if (c.how === 'select')
    return checkSelection(page, c.text!, c.needles())
  if (c.how === 'mail-menu') {
    await openSite(page, SITE, linkPage(a(c.text!, 'Write to us')))
    // What the menu item sends, since no tool can open the browser's own menu
    await fromMenu(page.context(), SITE, { type: 'show-link-intercept', data: { url: c.text!, frameId: 0 } })
    return waitForUi(page, ...c.needles())
  }
  const hover = await canHover(page)
  await patchSettings(page.context(), { linkSafety: { tooltipTrigger: 'hover', hoverDelay: 200, ...(hover ? {} : { intercept: { unfamiliar: true } }) } })
  await openSite(page, SITE, c.html ?? linkPage(c.link!))
  if (hover) {
    await page.locator('#l').hover()
    await waitForUi(page, ...c.needles())
    return
  }
  test.skip(!c.link?.includes('href="mailto:'), 'no hover on a touchscreen, a tap opens the link dialog instead')
  await tapMailLink(page, c.needles())
}

for (const c of CASES) {
  test(c.title, async ({ page, context, shot }) => {
    if (c.seed)
      await seed(context, c.seed)
    if (c.raw)
      await seedRaw(context, c.raw)
    if (c.local)
      await setLocal(context, c.local)
    if (c.settings)
      await patchSettings(context, c.settings)
    if (c.fetch)
      await workerFetch(context, c.fetch)
    if (c.unreachable)
      await workerRefusesVisits(context)
    await bringUp(page, c)
    if (c.press) {
      await clickUi(page, c.press())
      await waitForUi(page, ...(c.after?.() ?? []))
    }
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [TOOLTIP, ...(c.name.startsWith('tt-mm') ? [MISMATCH] : []), ...(c.name.startsWith('em-mm') || c.name === 'em-text-is-domain' ? [EMAIL_MISMATCH] : [])] })
  })
}
