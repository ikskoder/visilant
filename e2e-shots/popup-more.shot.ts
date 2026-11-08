/**
 * The toolbar popup and the site details page in detail: how the address is
 * drawn, every shape a family of sites takes, every number the list can show,
 * the familiarity rules, names that are never counted, numeric addresses,
 * hosting platforms, and the warnings about an address itself.
 */
import type { Page } from '@playwright/test'
import type { Seed } from './fixtures'
import { FAMILIAR, patchSettings, seed, test } from './fixtures'
import { DAY, openPage, openPopup, seedRaw, setLocal } from './helpers'
import { t } from './messages'

const POPUP = 'src/popup/Popup.vue'

const FAMILY: Record<string, Seed> = {
  'paypal.test': FAMILIAR,
  'checkout.paypal.test': { visits: 14, activeDays: 6, ageDays: 90 },
  'developer.paypal.test': { visits: 2, activeDays: 1, ageDays: 5 },
  'help.paypal.test': { visits: 31, activeDays: 12, ageDays: 210 },
}
const LOW: Seed = { visits: 3, activeDays: 2, ageDays: 3 }

interface Case {
  name: string
  title: string
  note: string
  /** The site the popup is opened over. `null` for a browser page. */
  url?: string | null
  /** Open the details page for this name instead of the popup */
  details?: string
  tabView?: boolean
  seed?: Record<string, Seed>
  raw?: (now: number) => Record<string, unknown>
  settings?: Record<string, unknown>
  local?: Record<string, unknown>
  act?: (page: Page) => Promise<void>
}

const many = (base: string, n: number) => Object.fromEntries([[base, FAMILIAR], ...Array.from({ length: n }, (_, i) => [`s${String(i + 1).padStart(2, '0')}.${base}`, { visits: (i * 7) % 50 + 1, activeDays: (i % 9) + 1, ageDays: (i * 13) % 400 + 1 }])])

const CASES: Case[] = [
  // ==========================================
  // How the address is drawn
  // ==========================================
  { name: 'pp-font-80', title: 'Popup at the smallest text size', note: '80%: the "A-" button is greyed out.', settings: { popupFontSize: 80 }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-font-150', title: 'Popup at the largest text size', note: '150%: "A+" greyed out, rows and the sort bar wrap.', settings: { popupFontSize: 150 }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-upper', title: 'Popup with names in capitals', note: 'The case toggle reads "AA".', settings: { domainCase: 'upper' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-highlight', title: 'Popup, addresses with digits', note: 'Digits bold in their own colour, in the heading and the list. Three display toggles: case, frames, script.', seed: { 'bank24.test': FAMILIAR, 'login-2fa.bank24.test': { visits: 9 }, 'my-acct.bank24.test': { visits: 4 } }, url: 'https://login-2fa.bank24.test/' },
  { name: 'pp-idn-list-unicode', title: 'Popup: a relative named in another alphabet', note: 'bücher.idn.test in the list, in its own letters. The punycode toggle reads "O".', seed: { 'idn.test': FAMILIAR, 'xn--bcher-kva.idn.test': { visits: 6 } }, url: 'https://shop.idn.test/' },
  { name: 'pp-idn-list-ascii', title: 'Popup: the same relative in its xn-- spelling', note: 'Setting "punycode list: ascii". The toggle reads "P".', settings: { punycodeListMode: 'ascii' }, seed: { 'idn.test': FAMILIAR, 'xn--bcher-kva.idn.test': { visits: 6 } }, url: 'https://shop.idn.test/' },
  { name: 'pp-name-30', title: 'Popup: a 30-character name', note: 'The heading steps down a size.', url: 'https://secure-account-login.example.test/' },
  { name: 'pp-name-45', title: 'Popup: a 45-character name', note: 'One more step down.', url: 'https://customer-verification-portal.my-bank-online.test/' },
  { name: 'pp-name-huge', title: 'Popup: a 120-character name', note: 'The smallest size, wrapped over several lines with a ↩ at each break.', url: 'https://a-very-long-label-that-goes-on-and-on-and-on-for-testing.another-very-long-label-that-also-goes-on-and-on.example.test/' },
  { name: 'pp-idn-tld', title: 'Popup: a site entirely in Cyrillic', note: 'пример.рф. "Original" and "Punycode" spellings, a "?" button. No red flag: the ending is in the same alphabet.', url: 'https://пример.рф/' },
  {
    name: 'pp-punycode-help',
    title: 'Popup: what Punycode is, explained',
    note: 'The "?" next to the Punycode spelling pressed.',
    url: 'https://пример.рф/',
    act: async (page) => {
      await page.locator(`button[aria-label="${t('punycodeHelpTitle')}"]`).first().click()
      await page.waitForTimeout(400)
    },
  },

  // ==========================================
  // Families of sites
  // ==========================================
  { name: 'pp-solo-root', title: 'Popup: a site with no relatives', note: 'Just the site card. No base-domain card, no list.', seed: { 'solo.test': FAMILIAR }, url: 'https://solo.test/' },
  { name: 'pp-solo-sub', title: 'Popup: a subdomain, nothing else recorded under its base', note: 'The base-domain card says nothing else is recorded.', seed: { 'blog.solo2.test': FAMILIAR }, url: 'https://blog.solo2.test/' },
  { name: 'pp-new-sub-new-base', title: 'Popup: a new subdomain of a new site', note: 'Base-domain card with its lookups, then "No visits recorded on this site yet".', url: 'https://shop.brand-new.test/' },
  { name: 'pp-root-family', title: 'Popup: the main site of a family', note: 'Open on paypal.test itself. The base card has no name of its own, only the family totals.', seed: FAMILY, url: 'https://paypal.test/' },
  { name: 'pp-new-member', title: 'Popup: a new page in a known family', note: 'new.paypal.test was never visited before. Opening it counted the first visit, so it reads 1 visit, 1 day, 0 days known, and it joins the family list as the current row.', seed: FAMILY, url: 'https://new.paypal.test/' },
  { name: 'pp-www', title: 'Popup on the www. name', note: 'www.paypal.test is kept as paypal.test, so that row is the current one.', seed: FAMILY, url: 'https://www.paypal.test/' },
  { name: 'pp-family-40', title: 'Popup: a family of forty sites', note: 'The list stops at a fixed height and scrolls.', seed: many('bigcorp.test', 40), url: 'https://s07.bigcorp.test/' },
  { name: 'pp-family-long-names', title: 'Popup: relatives with very long names', note: 'Long names wrap inside their rows.', seed: { ...FAMILY, 'this-is-an-extremely-long-subdomain-name-for-testing-the-layout.paypal.test': { visits: 7 } }, url: 'https://checkout.paypal.test/' },
  { name: 'pp-details-solo-sub', title: 'Site details: nothing else recorded under the base', note: 'The details page words this differently from the popup.', seed: { 'blog.solo2.test': FAMILIAR }, details: 'blog.solo2.test' },
  { name: 'pp-details-family-40', title: 'Site details: a family of forty', note: 'No height limit here: the page itself scrolls.', seed: many('bigcorp.test', 40), details: 's07.bigcorp.test' },

  // ==========================================
  // The number in the list, and the order
  // ==========================================
  { name: 'pp-metric-days', title: 'Popup list showing active days', note: 'The dropdown on "Active days".', settings: { listMetric: 'activeDays' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-metric-age', title: 'Popup list showing days known', note: 'The dropdown on "Days known".', settings: { listMetric: 'age' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-metric-checks', title: 'Popup list showing passed checks', note: 'Values like "1 / 2", passed out of needed, each followed by a pass or fail mark.', settings: { listMetric: 'checks' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-metric-uncoloured', title: 'Popup list showing a check that is switched off', note: 'Days known, with that check off: plain numbers, no colour, since they decide nothing.', settings: { listMetric: 'age', familiarity: { age: { enabled: false, min: 10 } } }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-sort-name-asc', title: 'Popup list sorted by name, A to Z', note: '"Name" and an up arrow.', settings: { sortByName: true, sortOrder: 'asc' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-sort-name-desc', title: 'Popup list sorted by name, Z to A', note: '"Name" and a down arrow.', settings: { sortByName: true, sortOrder: 'desc' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-sort-number-asc', title: 'Popup list, smallest number first', note: '"Number" and an up arrow.', settings: { sortOrder: 'asc' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-legacy', title: 'Popup: records from before dates were kept', note: 'Active days and days known read "not recorded" with a failed mark. In a list showing active days, those rows read "not recorded" and sink to the bottom.', settings: { listMetric: 'activeDays' }, raw: now => ({ 'legacy.test': { count: 80, lastSeen: now - 2 * DAY, ignored: false }, 'www2.legacy.test': { count: 5, lastSeen: now - 2 * DAY, ignored: false }, 'new.legacy.test': { count: 4, lastSeen: now - DAY, ignored: false, activeDays: 2, firstSeen: now - 10 * DAY } }), url: 'https://legacy.test/' },

  // ==========================================
  // Familiarity rules
  // ==========================================
  { name: 'pp-rule-any', title: 'Popup under the rule "any one check"', note: 'A fourth cell "Passed checks 1 / 1" with a pass mark next to failed facts.', settings: { familiarity: { mode: 'any' } }, seed: { 'half.test': { visits: 40, activeDays: 2, ageDays: 3 } }, url: 'https://half.test/' },
  { name: 'pp-rule-2of3', title: 'Popup under "at least 2 of 3"', note: '"Passed checks 1 / 2" in red, and the warnings row.', settings: { familiarity: { mode: 'atLeast', atLeast: 2 } }, seed: { 'half.test': { visits: 40, activeDays: 2, ageDays: 3 } }, url: 'https://half.test/' },
  { name: 'pp-rule-visits-only', title: 'Popup with only the visits check on', note: 'A single cell.', settings: { familiarity: { activeDays: { enabled: false, min: 5 }, age: { enabled: false, min: 10 } } }, seed: { 'half.test': { visits: 40, activeDays: 2, ageDays: 3 } }, url: 'https://half.test/' },
  { name: 'pp-rule-two', title: 'Popup with two checks on', note: 'Two cells.', settings: { familiarity: { visits: { enabled: false, min: 10 } } }, seed: { 'half.test': { visits: 40, activeDays: 2, ageDays: 3 } }, url: 'https://half.test/' },
  { name: 'pp-rule-any-bars', title: 'Popup under "any", bars shown, a family', note: 'Cells like "14 / 10", and the family totals add "Passed checks · max".', settings: { familiarity: { mode: 'any' }, showFamiliarityThresholds: true }, seed: FAMILY, url: 'https://checkout.paypal.test/' },

  // ==========================================
  // Warnings and anti-tampering
  // ==========================================
  { name: 'pp-warnings-on', title: 'Popup: warnings on for an unfamiliar site', note: '"Warnings are on for this site" in plain text, a "Turn off" button.', seed: { 'few.test': LOW }, url: 'https://few.test/' },
  { name: 'pp-silenced-familiar', title: 'Popup: a familiar site whose warnings were turned off', note: 'Still says warnings are off, with "Turn back on".', seed: { 'trusted.test': { ...FAMILIAR, ignored: true } }, url: 'https://trusted.test/' },
  { name: 'pp-tamper-off', title: 'Popup: anti-tampering off for this site', note: 'The row reads "Not watching whether this site hides Visilant’s warnings", with a "Turn on" button.', settings: { antiTamperingExcludedDomains: 'shop.test' }, url: 'https://shop.test/' },
  { name: 'pp-tamper-parent', title: 'Popup: anti-tampering off by a rule for the parent site', note: 'The same row as off for this site alone: the badge and "Turn on" on one line. The parent rule is named in the button tooltip only.', settings: { antiTamperingExcludedDomains: 'paypal.test' }, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-details-both-off', title: 'Site details: warnings and anti-tampering both off', note: 'Two grey badges together.', settings: { antiTamperingExcludedDomains: 'x-off.test' }, seed: { 'x-off.test': { visits: 2, ignored: true } }, details: 'x-off.test' },

  // ==========================================
  // Names that are not counted, and numbers
  // ==========================================
  { name: 'pp-localhost', title: 'Popup on localhost', note: 'A grey notice: visits here are not counted. No facts, no warnings row.', url: 'http://localhost:3000/' },
  { name: 'pp-dotted-local', title: 'Popup on a local network name with a dot', note: 'nas.local. Not counted either. Note the box still says the name has no dot in it.', url: 'http://nas.local/' },
  { name: 'pp-private-ip', title: 'Popup on a home router address', note: '192.168.1.1: not counted, and marked as a numeric address.', url: 'http://192.168.1.1/' },
  { name: 'pp-public-ipv4', title: 'Popup on a public IP address', note: '8.8.8.8 is counted. Marked as a numeric address, never visited.', url: 'http://8.8.8.8/' },
  { name: 'pp-public-ipv6', title: 'Popup on an IPv6 address', note: 'Counted, numeric-address marker, no "check elsewhere" since there is no dot.', url: 'http://[2606:4700:4700::1111]/' },
  { name: 'pp-details-intranet', title: 'Site details for a name with no dot', note: '"intranet": the not-counted box under a "Checked address" heading.', details: 'intranet' },
  { name: 'pp-details-garbage', title: 'Site details opened with nonsense', note: '?domain=not a host!! – what the page makes of text that is no name at all.', details: 'not%20a%20host!!' },

  // ==========================================
  // Hosting platforms
  // ==========================================
  { name: 'pp-tenant', title: 'Popup on a site hosted on a shared platform', note: 'alice.github.io is a site of its own: bob.github.io is not counted as a relative.', seed: { 'alice.github.io': FAMILIAR, 'docs.alice.github.io': { visits: 5 }, 'bob.github.io': { visits: 9 } }, url: 'https://docs.alice.github.io/' },
  { name: 'pp-platform-root', title: 'Popup on the platform itself', note: 'github.io. Every tenant is listed as a relative here. Worth a look whether that reads right.', seed: { 'alice.github.io': FAMILIAR, 'docs.alice.github.io': { visits: 5 }, 'bob.github.io': { visits: 9 } }, url: 'https://github.io/' },

  // ==========================================
  // What the address gives away
  // ==========================================
  { name: 'pp-hosted-on', title: 'Popup on a site on a shared hosting platform', note: 'shop.vercel.app, never visited. A red line says anyone can make a site on vercel.app and that vercel.app does not run this one.', url: 'https://shop.vercel.app/' },
  { name: 'pp-mark-deep', title: 'Popup: too many subdomain levels', note: 'a.b.c.d.e.example.test.', url: 'https://a.b.c.d.e.example.test/' },
  { name: 'pp-mark-embedded', title: 'Popup: a well-known name parked in front', note: 'paypal.com.secure-login.test, with paypal.com unknown to the user. A red notice names the real site.', url: 'https://paypal.com.secure-login.test/' },
  { name: 'pp-mark-embedded-known', title: 'Popup: the same, when paypal.com is familiar', note: 'Replaced by a red lookalike line.', seed: { 'paypal.com': FAMILIAR }, url: 'https://paypal.com.secure-login.test/' },
  { name: 'pp-mixed-script', title: 'Popup: mixed alphabets, nothing known to compare with', note: 'аpple.test with a Cyrillic а and nothing in history: the mixed-alphabet marker only.', url: 'https://аpple.test/' },
  { name: 'pp-latin-twins', title: 'Popup: a name of Cyrillic twins of Latin letters', note: 'аррӏе.test, all Cyrillic, nothing mixed, but every letter looks Latin. The red flag line names Cyrillic, and the shield has 1 red flag beside it.', url: 'https://аррӏе.test/' },
  { name: 'pp-custom-shortener', title: 'Popup on a short-link site the user listed', note: 'go.corp.test, from the user\'s own shortener list: the shortener note appears.', local: { customShorteners: ['go.corp.test'] }, url: 'https://go.corp.test/x' },

  // ==========================================
  // Lookalikes of paypal.test
  // ==========================================
  { name: 'pp-look-extra', title: 'Popup lookalike: extra text', note: 'paypal-secure.test. Red.', seed: { 'paypal.test': FAMILIAR }, url: 'https://paypal-secure.test/' },
  { name: 'pp-look-contains', title: 'Popup lookalike: the name inside a longer one', note: 'mypaypalhelp.test. Red notice.', seed: { 'paypal.test': FAMILIAR }, url: 'https://mypaypalhelp.test/' },
  { name: 'pp-look-two-edits', title: 'Popup lookalike: two letters different', note: 'paypqx.test. Red notice.', seed: { 'paypal.test': FAMILIAR }, url: 'https://paypqx.test/' },
  { name: 'pp-look-ending', title: 'Popup lookalike: different ending', note: 'paypal.example. Red notice.', seed: { 'paypal.test': FAMILIAR }, url: 'https://paypal.example/' },
  { name: 'pp-look-label-sub', title: 'Popup lookalike: the name used as a subdomain', note: 'paypal.evil-host.test. Red, with the real site in a red block.', seed: { 'paypal.test': FAMILIAR }, url: 'https://paypal.evil-host.test/' },
  { name: 'pp-look-domain-sub', title: 'Popup lookalike: the whole known domain as a subdomain', note: 'paypal.test.evil-host.example. Red.', seed: { 'paypal.test': FAMILIAR }, url: 'https://paypal.test.evil-host.example/' },
  { name: 'pp-look-three', title: 'Popup lookalike of three known sites', note: 'paypal-apple-amazon.test. Three lines, the most there can be.', seed: { 'paypal.test': FAMILIAR, 'apple.test': FAMILIAR, 'amazon.test': FAMILIAR }, url: 'https://paypal-apple-amazon.test/' },

  // ==========================================
  // Layout
  // ==========================================
  { name: 'pp-tab-view', title: 'Popup opened as a tab', note: 'Full width instead of a 600 px card, and the list has no height limit. Firefox for Android shows the popup this way.', tabView: true, seed: FAMILY, url: 'https://checkout.paypal.test/' },
  { name: 'pp-tab-view-empty', title: 'Popup opened as a tab over a browser page', note: 'The globe and "Open a site to see what Visilant knows about it", full width.', tabView: true, url: null },
]

for (const c of CASES) {
  test(c.title, async ({ context, extensionId, shot }) => {
    if (c.seed)
      await seed(context, c.seed)
    if (c.raw)
      await seedRaw(context, c.raw)
    if (c.local)
      await setLocal(context, c.local)
    if (c.settings)
      await patchSettings(context, c.settings)
    const page = c.details
      ? await openPage(context, extensionId, `domain=${c.details}`)
      : await openPopup(context, extensionId, c.url ?? null, { tabView: c.tabView })
    await c.act?.(page)
    const asPopup = !c.details && !c.tabView
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [POPUP] }, asPopup ? { clip: 'main' } : { fullPage: true })
  })
}
