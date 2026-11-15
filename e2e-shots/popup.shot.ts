/**
 * The window behind the toolbar button, and the two pages the same document
 * serves when it is opened by address: the details of one site, and the check
 * page.
 */
import type { Page } from '@playwright/test'
import { FAMILIAR, patchSettings, seed, test } from './fixtures'
import { check, openPage, openPopup } from './helpers'

const POPUP = 'src/popup/Popup.vue'
const CHECK = 'src/popup/CheckField.vue'

const FAMILY = {
  'paypal.test': FAMILIAR,
  'checkout.paypal.test': { visits: 14, activeDays: 6, ageDays: 90 },
  'developer.paypal.test': { visits: 2, activeDays: 1, ageDays: 5 },
}

// ==========================================
// The toolbar popup
// ==========================================

test('popup, no site', async ({ context, extensionId, shot }) => {
  const popup = await openPopup(context, extensionId, null)
  await shot(popup, { name: 'popup-no-site', title: 'Popup over a browser page, nothing to report', covers: [POPUP] }, { clip: 'main' })
})

test('popup, unfamiliar site', async ({ context, extensionId, shot }) => {
  const popup = await openPopup(context, extensionId, 'https://unknown-shop.test/')
  await shot(popup, { name: 'popup-unfamiliar', title: 'Popup on a site visited for the first time', covers: [POPUP] }, { clip: 'main' })
})

test('popup, familiar site with relatives', async ({ context, extensionId, shot }) => {
  await seed(context, FAMILY)
  const popup = await openPopup(context, extensionId, 'https://checkout.paypal.test/')
  await shot(popup, { name: 'popup-family', title: 'Popup on a subdomain of a familiar site, with its relatives', covers: [POPUP] }, { clip: 'main' })
})

test('popup, bars shown', async ({ context, extensionId, shot }) => {
  await seed(context, FAMILY)
  await patchSettings(context, { showFamiliarityThresholds: true })
  const popup = await openPopup(context, extensionId, 'https://developer.paypal.test/')
  await shot(popup, { name: 'popup-thresholds', title: 'Popup with each check next to its bar', covers: [POPUP] }, { clip: 'main' })
})

test('popup, silenced site', async ({ context, extensionId, shot }) => {
  await seed(context, { 'noisy-forum.test': { visits: 3, ignored: true } })
  const popup = await openPopup(context, extensionId, 'https://noisy-forum.test/')
  await shot(popup, { name: 'popup-silenced', title: 'Popup on a site whose warnings were turned off', covers: [POPUP] }, { clip: 'main' })
})

test('popup, lookalike', async ({ context, extensionId, shot }) => {
  await seed(context, { 'apple.test': FAMILIAR })
  const popup = await openPopup(context, extensionId, 'https://аpple.test/')
  await shot(popup, { name: 'popup-punycode', title: 'Popup on a lookalike written with a Cyrillic letter', covers: [POPUP] }, { clip: 'main' })
})

test('popup, shortener', async ({ context, extensionId, shot }) => {
  const popup = await openPopup(context, extensionId, 'https://bit.ly/3xYz9Q')
  await shot(popup, { name: 'popup-shortener', title: 'Popup on a link shortener', covers: [POPUP] }, { clip: 'main' })
})

test('popup, larger text', async ({ context, extensionId, shot }) => {
  await seed(context, FAMILY)
  await patchSettings(context, { popupFontSize: 140 })
  const popup = await openPopup(context, extensionId, 'https://checkout.paypal.test/')
  await shot(popup, { name: 'popup-large-text', title: 'Popup at 140% text', covers: [POPUP] }, { clip: 'main' })
})

// ==========================================
// The details page (popup document in a tab)
// ==========================================

test('details page', async ({ context, extensionId, shot }) => {
  await seed(context, FAMILY)
  const page = await openPage(context, extensionId, 'domain=checkout.paypal.test')
  await shot(page, { name: 'details-page', title: 'Details of a site, opened from a tooltip', covers: [POPUP] }, { fullPage: true })
})

// ==========================================
// The check page
// ==========================================

test('check page, empty', async ({ context, extensionId, shot }) => {
  const page = await openPage(context, extensionId, 'check=1')
  await shot(page, { name: 'check-empty', title: 'Check page before anything is typed', covers: [CHECK] }, { fullPage: true })
})

test('check page, larger text', async ({ context, extensionId, shot }) => {
  await patchSettings(context, { popupFontSize: 140 })
  const page = await openPage(context, extensionId, 'check=1')
  await shot(page, { name: 'check-empty-large', title: 'Check page at 140% text, nothing typed', note: 'The hint in the field stays on one line and ends in an ellipsis, it never wraps under the field\'s foot.', covers: [CHECK] }, { fullPage: true })
})

const CHECKS: { name: string, title: string, input: string, card?: string, then?: (page: Page) => Promise<void> }[] = [
  { name: 'check-url', title: 'Check page: a link on a familiar family', input: 'https://checkout.paypal.test/pay?id=1', card: 'checkout.paypal.test' },
  { name: 'check-unknown', title: 'Check page: a domain never visited', input: 'totally-new-site.test', card: 'totally-new-site.test' },
  { name: 'check-lookalike', title: 'Check page: one letter off a familiar site', input: 'https://paypa1.test/login', card: 'paypa1.test' },
  { name: 'check-punycode', title: 'Check page: a Cyrillic lookalike', input: 'https://аpple.test/', card: 'pple.test' },
  { name: 'check-shortener', title: 'Check page: a short link', input: 'https://bit.ly/3xYz9Q', card: 'bit.ly' },
  { name: 'check-email', title: 'Check page: an address one letter off gmail.com', input: 'security-team@gmial.com', card: 'gmial.com' },
  { name: 'check-email-gmail', title: 'Check page: a gmail address', input: 'john.smith@gmail.com', card: 'gmail.com' },
  { name: 'check-email-disposable', title: 'Check page: a throwaway address', input: 'refunds@mailinator.com', card: 'mailinator.com' },
  { name: 'check-email-forwarding', title: 'Check page: an address at a mail forwarding service', input: 'dev@mozmail.com', card: 'mozmail.com' },
  {
    name: 'check-compare',
    card: 'paypa1.test',
    title: 'Check page: an address held against the one the user trusts',
    input: 'billing@paypa1.test',
    then: async (page) => {
      await page.locator('text=Compare with an address you already trust').click()
      await page.locator('input[placeholder="Address from an earlier message"]').fill('billing@paypal.test')
      await page.waitForTimeout(500)
    },
  },
  {
    name: 'check-email-caveat',
    card: 'example.org',
    title: 'Check page: what an email check cannot tell, unfolded',
    input: 'someone@example.org',
    then: async (page) => {
      await page.locator('text=Checking this because an email looked suspicious').click()
      await page.waitForTimeout(300)
    },
  },
  { name: 'check-mailto', title: 'Check page: a mailto with several recipients', input: 'mailto:boss@paypal.test,payroll@paypa1.test?cc=hr@paypal.test' },
  { name: 'check-nothing', title: 'Check page: text with nothing to check in it', input: 'hello there, how are you' },
]

for (const c of CHECKS) {
  test(c.title, async ({ context, extensionId, shot }) => {
    await seed(context, { ...FAMILY, 'apple.test': FAMILIAR, 'gmail.com': FAMILIAR, 'mail.google.com': FAMILIAR })
    const page = await openPage(context, extensionId, 'check=1')
    await check(page, c.input, c.card)
    await c.then?.(page)
    await shot(page, { name: c.name, title: c.title, covers: [CHECK] }, { fullPage: true })
  })
}
