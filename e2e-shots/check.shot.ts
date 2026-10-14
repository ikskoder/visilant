/**
 * The check page in detail: what it makes of things that are not a plain
 * link, following a link to where it ends, where an address's mail is read,
 * every warning about an email address, the address comparison, and the
 * lookup links.
 */
import type { Page } from '@playwright/test'
import type { Seed } from './fixtures'
import type { FetchAnswer } from './helpers'
import path from 'node:path'
import { expect, EXTENSION_PATH, FAMILIAR, patchSettings, seed, test } from './fixtures'
import { check, CHECK_INPUT, openPage, setLocal, workerFetch } from './helpers'
import { t } from './messages'

const CHECK = 'src/popup/CheckField.vue'

const FAMILY: Record<string, Seed> = {
  'paypal.test': FAMILIAR,
  'checkout.paypal.test': { visits: 14, activeDays: 6, ageDays: 90 },
}

interface Case {
  name: string
  title: string
  note: string
  /** Typed into the field and checked */
  input?: string
  /** The card about this name is waited for. Leave out when there is no card. */
  card?: string
  /** Opened with `&value=`, as the long-press menu opens it */
  prefill?: string
  seed?: Record<string, Seed>
  settings?: Record<string, unknown>
  local?: Record<string, unknown>
  fetch?: Record<string, FetchAnswer>
  then?: (page: Page) => Promise<void>
}

async function expand(page: Page, expectText?: string) {
  await page.locator('button', { hasText: t('checkFieldExpand') }).first().click()
  if (expectText)
    await expect(page.locator('main')).toContainText(expectText, { timeout: 10000 })
  await page.waitForTimeout(800)
}

async function compareWith(page: Page, other: string) {
  await page.locator(`text=${t('addressCompareTitle')}`).click()
  await page.locator(`input[placeholder="${t('addressComparePlaceholder')}"]`).fill(other)
  await page.waitForTimeout(500)
}

const CASES: Case[] = [
  // ==========================================
  // Things that are not a plain link
  // ==========================================
  { name: 'ck-prefilled', title: 'Check page opened with a mailto already in it', note: 'As the long-press menu on a mailto with several recipients opens it: filled in and checked straight away.', seed: FAMILY, prefill: 'mailto:a@paypal.test,b@paypa1.test', card: 'paypal.test' },
  { name: 'ck-tel', title: 'Check page: a phone number', note: '"Content type: Phone number", digits highlighted, no card.', input: 'tel:+1 555 0199' },
  { name: 'ck-wifi', title: 'Check page: Wi-Fi details', note: '"Wi-Fi network".', input: 'WIFI:T:WPA;S:Cafe-Guest;P:esp123;;' },
  { name: 'ck-sms', title: 'Check page: a text message', note: '"SMS".', input: 'sms:+15550199?body=hi' },
  { name: 'ck-geo', title: 'Check page: a location', note: '"Location".', input: 'geo:52.52,13.40' },
  { name: 'ck-invisible', title: 'Check page: a hidden character in a number', note: 'A right-to-left override inside a phone number, drawn as a red token.', input: 'tel:+1555‮0199' },
  {
    name: 'ck-stale-card',
    title: 'Check page: nothing to check, after a real check',
    note: 'paypal.test checked first, then plain words. The "nothing to check" line appears above the old card, which stays. Worth deciding whether it should.',
    seed: FAMILY,
    input: 'paypal.test',
    card: 'paypal.test',
    then: async page => check(page, 'hello there'),
  },
  {
    name: 'ck-qr-not-found',
    title: 'Check page: an image with no QR code in it',
    note: 'A picture without a code chosen with the QR button. A red "No QR code found in this image".',
    then: async (page) => {
      await page.locator('input[type="file"]').setInputFiles(path.join(EXTENSION_PATH, 'assets/icon-default-128.png'))
      await expect(page.locator('main')).toContainText(t('qrNotFound'), { timeout: 10000 })
    },
  },
  { name: 'ck-text-with-link', title: 'Check page: a sentence with a link in it', note: 'The link is picked out of the sentence and checked.', seed: { 'paypal.test': FAMILIAR }, input: 'Please click https://paypal-secure.test/verify now', card: 'paypal-secure.test' },

  // ==========================================
  // Following a link
  // ==========================================
  { name: 'ck-expand-loading', title: 'Check page: following a short link, still waiting', note: '"Expand link" pressed, no answer yet. A spinner.', fetch: { 'https://bit.ly/': { hang: true } }, input: 'https://bit.ly/ck-load', card: 'bit.ly', then: async page => expand(page, t('linkTooltipResolvingUrl')) },
  { name: 'ck-expand-error', title: 'Check page: a short link that could not be followed', note: 'The button stays, with "Couldn\'t find out where this link leads".', fetch: { 'https://bit.ly/': { fail: true } }, input: 'https://bit.ly/ck-err', card: 'bit.ly', then: async page => expand(page, t('linkTooltipResolveError')) },
  { name: 'ck-expand-chain', title: 'Check page: a short link followed through three hops', note: 'The field keeps bit.ly with its shortener chip, then the final address and the numbered chain. The card below switches to the destination.', settings: { linkSafety: { shortUrlTraceChain: true, shortUrlShowFullUrl: true } }, fetch: { 'https://bit.ly/': { to: 'https://tinyurl.com/4kq7zv', body: '<meta http-equiv="refresh" content="0; url=https://prize-winner.test/claim?id=8812">' }, 'https://prize-winner.test/': {} }, input: 'https://bit.ly/ck-chain', card: 'bit.ly', then: async page => expand(page, 'prize-winner.test') },
  { name: 'ck-expand-familiar', title: 'Check page: an ordinary link followed to a familiar site', note: 'out.paypal.test redirects to checkout.paypal.test. The chip in the field reads "familiar site" in green.', seed: FAMILY, fetch: { 'https://out.paypal.test/': { to: 'https://checkout.paypal.test/' } }, input: 'https://out.paypal.test/r', card: 'out.paypal.test', then: async page => expand(page) },
  { name: 'ck-expand-same', title: 'Check page: a link that goes nowhere else', note: 'Followed, and it stayed. Only the resolved address line, the card unchanged.', fetch: { 'https://same.test/': { to: 'https://same.test/r' } }, input: 'https://same.test/r', card: 'same.test', then: async page => expand(page) },

  // ==========================================
  // Where an address's mail is read
  // ==========================================
  { name: 'ck-mailsite-domain', title: 'Check page: the domain gmail.com on its own', note: 'Checked as a site, but still shows "Mail read on mail.google.com" with its facts.', seed: { 'mail.google.com': FAMILIAR }, input: 'gmail.com', card: 'gmail.com' },
  { name: 'ck-mailsite-custom', title: 'Check page: a company address with its own mail site', note: 'Own mapping corp.test = webmail.corp-portal.test.', seed: { 'webmail.corp-portal.test': FAMILIAR }, local: { customMailSites: ['corp.test = webmail.corp-portal.test'] }, input: 'ceo@corp.test', card: 'corp.test' },
  { name: 'ck-mailsite-unvisited', title: 'Check page: an outlook.com address, never used', note: 'Two mail sites, both never visited, all red.', input: 'x@outlook.com', card: 'outlook.com' },
  { name: 'ck-mailsite-bars', title: 'Check page: mail sites with bars and the "any" rule', note: 'The mail-site facts become a small table.', settings: { showFamiliarityThresholds: true, familiarity: { mode: 'any' } }, seed: { 'mail.google.com': FAMILIAR }, input: 'john@gmail.com', card: 'gmail.com' },

  // ==========================================
  // Email addresses
  // ==========================================
  { name: 'ck-account-lower', title: 'Check page: account name in lower case', note: 'The case button next to "ACCOUNT NAME" set to "aa".', settings: { accountNameCase: 'lower' }, input: 'John.Smith@Example.test', card: 'example.test' },
  { name: 'ck-account-upper', title: 'Check page: account name in capitals', note: '"AA".', settings: { accountNameCase: 'upper' }, input: 'John.Smith@Example.test', card: 'example.test' },
  { name: 'ck-local-unicode', title: 'Check page: a Cyrillic letter before @', note: 'jоhn@example.test. "Unusual characters in the address name part".', input: 'jоhn@example.test', card: 'example.test' },
  { name: 'ck-embedded-io', title: 'Check page: a known ending inside the address domain', note: 'support@paypal.io.secure-mail.test. "a well-known ending appears in the middle (.io)".', input: 'support@paypal.io.secure-mail.test', card: 'secure-mail.test' },
  { name: 'ck-email-idn', title: 'Check page: an address at a name in another alphabet', note: 'info@bücher.test. The card shows both spellings, danger highlighting on.', input: 'info@bücher.test', card: 'test' },
  { name: 'ck-custom-public', title: 'Check page: an address at a mail service the user listed', note: 'Own list of public services: corpmail.test.', local: { customPublicEmailProviders: ['corpmail.test'] }, input: 'anyone@corpmail.test', card: 'corpmail.test' },
  { name: 'ck-custom-disposable', title: 'Check page: an address at a throwaway service the user listed', note: 'Own list of disposable domains: burner.test.', local: { customDisposableEmailDomains: ['burner.test'] }, input: 'anyone@burner.test', card: 'burner.test' },
  { name: 'ck-mailto-params', title: 'Check page: a mailto with a long pre-filled message', note: 'Subject and a body cut at 200 characters.', seed: FAMILY, input: `mailto:a@paypal.test?subject=Invoice%20overdue&body=${'x'.repeat(300)}`, card: 'paypal.test' },
  { name: 'ck-mailto-30', title: 'Check page: a mailto with thirty recipients', note: '25 rows, then "+5 more recipients, not checked".', seed: FAMILY, input: `mailto:${Array.from({ length: 30 }, (_, i) => `p${i}@paypal.test`).join(',')}`, card: 'paypal.test' },
  { name: 'ck-mailto-notes', title: 'Check page: a mailto where every recipient has a different problem', note: 'Throwaway, foreign alphabet, known name parked in front, never visited.', seed: FAMILY, input: 'mailto:a@paypal.test,b@mailinator.com,c@пример.test,d@paypal.com.evil.test,e@new-place.test', card: 'paypal.test' },
  { name: 'ck-provider-lookalike', title: 'Check page: an address one letter off gmail.com, nothing in history', note: 'The lookalike line names the well-known mail provider.', input: 'refunds@gmial.com', card: 'gmial.com' },

  // ==========================================
  // Comparing two addresses
  // ==========================================
  { name: 'ck-compare-same', title: 'Comparing an address with itself', note: 'Green "The same address, character for character".', input: 'billing@paypal.test', card: 'paypal.test', then: async page => compareWith(page, 'billing@paypal.test') },
  { name: 'ck-compare-case', title: 'Comparing the same address typed in another case', note: 'Green, "typed in a different case".', input: 'billing@paypal.test', card: 'paypal.test', then: async page => compareWith(page, 'Billing@PayPal.test') },
  { name: 'ck-compare-nothing', title: 'Comparing with text that is not an address', note: '"No email address found in that text".', input: 'billing@paypal.test', card: 'paypal.test', then: async page => compareWith(page, 'hello') },
  { name: 'ck-compare-length', title: 'Comparing addresses of different lengths', note: 'Filler cells where one is longer. At phone width the rows are wider than the screen: check they can be scrolled rather than cut off.', input: 'billing@paypal.test', card: 'paypal.test', then: async page => compareWith(page, 'billing.department@paypal.test') },

  // ==========================================
  // What the address gives away
  // ==========================================
  { name: 'ck-userinfo', title: 'Check page: a decoy name before @ in a link', note: 'https://paypal.com@evil-site.test/login. "Decoy name before @, ignore it". Only the check page sees full links, so only it shows this.', input: 'https://paypal.com@evil-site.test/login', card: 'evil-site.test' },
  { name: 'ck-markers-all', title: 'Check page: every address warning at once', note: 'A decoy name, a known name parked in front, deep subdomains and a Cyrillic letter, all in one link.', input: 'https://admin@paypal.com.a.b.c.verify-аccount.test/', card: 'test' },

  // ==========================================
  // Check this domain elsewhere
  // ==========================================
  { name: 'ck-lookups-open', title: 'Check page: "Check this domain elsewhere" unfolded', note: 'Three links to outside services.', seed: FAMILY, input: 'paypal.test', card: 'paypal.test', then: async (page) => {
    await page.locator('[data-domain-panel] >> text=Check this domain elsewhere').first().click()
    await page.waitForTimeout(300)
  } },
  { name: 'ck-lookups-many', title: 'Check page: eight lookup links', note: 'Own list of eight services. The links wrap.', settings: { lookupServices: Array.from({ length: 8 }, (_, i) => `Service number ${i + 1} | https://lookup-${i + 1}.example/{domain}`).join('\n') }, seed: FAMILY, input: 'paypal.test', card: 'paypal.test', then: async (page) => {
    await page.locator('[data-domain-panel] >> text=Check this domain elsewhere').first().click()
    await page.waitForTimeout(300)
  } },
  { name: 'ck-lookups-none', title: 'Check page with the lookup links removed', note: 'No "Check this domain elsewhere" anywhere.', settings: { lookupServices: '' }, seed: FAMILY, input: 'paypal.test', card: 'paypal.test' },
]

for (const c of CASES) {
  test(c.title, async ({ context, extensionId, shot }) => {
    if (c.seed)
      await seed(context, c.seed)
    if (c.local)
      await setLocal(context, c.local)
    if (c.settings)
      await patchSettings(context, c.settings)
    if (c.fetch)
      await workerFetch(context, c.fetch)
    const page = await openPage(context, extensionId, c.prefill ? `check=1&value=${encodeURIComponent(c.prefill)}` : 'check=1')
    await expect(page.locator(CHECK_INPUT)).toBeVisible({ timeout: 10000 })
    if (c.prefill && c.card)
      await expect(page.locator('[data-domain-panel]')).toContainText(c.card, { timeout: 10000 })
    if (c.input)
      await check(page, c.input, c.card)
    await c.then?.(page)
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [CHECK] }, { fullPage: true })
  })
}
