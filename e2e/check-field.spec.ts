/**
 * The check field, which is the one part of the popup the user types into.
 *
 * It only renders on the standalone page (the popup proper shows a button that
 * opens it), so every test here opens the popup document as an ordinary tab.
 */
import { expect, test } from './fixtures'
import { patchSettings, seedVisits } from './helpers'

// Evaluated inside the extension's service worker, where the MV3 API lives
declare const chrome: any

async function openCheckPage(context: any, extensionId: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?check=1`)
  await page.waitForTimeout(1500)
  return page
}

const CHECK_INPUT = 'input[placeholder="Paste a link, domain or email address"]'

/**
 * The check field itself.
 *
 * Everything it reports also has a twin in the dashboard underneath – the same
 * base domain, the same visit count – so an unscoped assertion would pass on
 * the wrong half of the page.
 */
function field(page: any) {
  return page.locator(`div:has(> div > ${CHECK_INPUT})`)
}

async function check(page: any, text: string) {
  await page.locator(CHECK_INPUT).fill(text)
  await page.locator('button', { hasText: 'Check' }).first().click()
  await page.waitForTimeout(800)
}

test('the check field is on the standalone page and not in the popup', async ({ context, extensionId }) => {
  const standalone = await openCheckPage(context, extensionId)
  await expect(standalone.locator('text=Check a link, email address or QR code')).toBeVisible({ timeout: 5000 })
  await standalone.close()

  // The popup proper is too small for it and offers the button that opens the
  // page above instead
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await popup.waitForTimeout(1500)
  await expect(popup.locator('text=Check a link, email address or QR code')).toHaveCount(0)
})

test('checking a URL reports its base domain and visit count', async ({ context, extensionId }) => {
  await seedVisits(context, 'shop.example.org', 4)
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://shop.example.org/cart?id=1')

  await expect(field(page).locator('text=Base domain')).toContainText('example.org', { timeout: 5000 })
  // Visits are counted across the whole domain family, not per exact hostname
  await expect(field(page).locator('.font-mono.font-bold').first()).toHaveText('4')
})

test('a bare domain is understood without a scheme', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'example.net')

  await expect(field(page).locator('.secure-domain-display').first()).toHaveText('example.net', { timeout: 5000 })
  await expect(field(page).locator('.font-mono.font-bold').first()).toHaveText('0')
  // Nothing sits in front of the base domain, so there is no base domain to add
  await expect(field(page).locator('text=Base domain')).toHaveCount(0)
})

test('a known shortener is flagged and offers to be expanded', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://bit.ly/3xAmPl3')

  await expect(field(page).locator('text=shortener')).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('button', { hasText: 'Expand' })).toBeVisible()
})

test('an email address one letter off a familiar provider is flagged', async ({ context, extensionId }) => {
  // The reference set is the user's own history, so the provider has to be
  // something this profile actually knows – which the shipped rules read as all
  // three of visits, separate days and a first visit well behind us
  await seedVisits(context, 'gmail.com', 50, { activeDays: 30 })

  const page = await openCheckPage(context, extensionId)
  // Same call the options page makes after an import, and the only way to reach
  // the handler: a service worker cannot send a runtime message to itself
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))

  await check(page, 'jsdojif@gmal.com')

  await expect(field(page).locator('text=Resembles a site you know')).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('text=gmail.com').first()).toBeVisible()
})

test('lowering the familiarity threshold brings a domain into the comparison', async ({ context, extensionId }) => {
  // Five visits is under the default threshold of ten, so this domain is not
  // yet one the user is taken to know
  await seedVisits(context, 'gmail.com', 5)

  const page = await openCheckPage(context, extensionId)
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))
  await check(page, 'jsdojif@gmal.com')
  await expect(field(page).locator('text=Resembles a site you know')).toHaveCount(0)

  // The rules decide what goes in the index, so changing them has to reach
  // the running worker – not wait for it to be restarted
  await patchSettings(context, {
    familiarity: {
      visits: { enabled: true, min: 3 },
      activeDays: { enabled: false, min: 5 },
      age: { enabled: false, min: 10 },
      mode: 'all',
      atLeast: 2,
    },
  })
  // Reloaded because the notice memoises its answer per address
  await page.reload()
  await page.waitForTimeout(1500)
  await check(page, 'jsdojif@gmal.com')

  await expect(field(page).locator('text=Resembles a site you know')).toBeVisible({ timeout: 5000 })
})

test('a check the record cannot answer takes a domain back out of the comparison', async ({ context, extensionId }) => {
  // Fifty visits, but on a single active day – plenty for the visit check and
  // nowhere near a week of them
  await seedVisits(context, 'gmail.com', 50)
  await patchSettings(context, {
    familiarity: {
      visits: { enabled: true, min: 10 },
      activeDays: { enabled: true, min: 5 },
      age: { enabled: false, min: 10 },
      mode: 'all',
      atLeast: 2,
    },
  })

  const page = await openCheckPage(context, extensionId)
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))
  await check(page, 'jsdojif@gmal.com')

  await expect(field(page).locator('text=Resembles a site you know')).toHaveCount(0)
})

test('an email address is read as an email, not as a link', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'billing@some-supplier.com')

  await expect(field(page).locator('text="Email address"')).toBeVisible({ timeout: 5000 })
  // Read as an address rather than as a link to its domain
  await expect(field(page).locator('text=Base domain')).toHaveCount(0)
})

test('a unicode lookalike is reported under its real ascii name', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  // Cyrillic "а" in what otherwise reads as apple.com
  await check(page, 'https://аpple.com')

  // The field names the host the browser would actually go to
  await expect(field(page).locator('.secure-domain-display').first()).toHaveText('xn--pple-43d.com', { timeout: 5000 })
  // ...and the dashboard underneath spells it out both ways, which is the whole
  // point of checking an address that reads as a familiar one
  await expect(page.locator('text=Original (Unicode)')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Punycode (ASCII)')).toBeVisible()
})

test('nothing checkable says so rather than reporting on nothing', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'just some words')

  await expect(field(page).locator('text=Nothing to check')).toBeVisible({ timeout: 5000 })
})

test('checking a domain switches the dashboard below to it', async ({ context, extensionId }) => {
  await seedVisits(context, 'dashboard-target.com', 3)
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://dashboard-target.com/page')

  await expect(page.locator('text=Checked domain')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.secure-domain-display').first()).toContainText('dashboard-target.com')
})

test('an email address is compared against the mail providers, not just history', async ({ context, extensionId }) => {
  // Nothing seeded: Gmail redirects to mail.google.com, so no amount of real use
  // would put gmail.com in a profile's history either
  const page = await openCheckPage(context, extensionId)
  await check(page, 'dpfk@gmal.com')

  await expect(field(page).locator('text=Resembles a well-known mail provider')).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('text=gmail.com')).toBeVisible()
  // Never opened, so there is no visit count to report about it
  await expect(field(page).locator('text=Resembles a site you know')).toHaveCount(0)
})

test('the provider list stays out of the plain link check', async ({ context, extensionId }) => {
  // The exception is for email addresses. Ordinary browsing keeps comparing
  // against the user's own history and nothing else.
  const page = await openCheckPage(context, extensionId)
  await check(page, 'https://gmal.com')

  await expect(field(page).locator('.secure-domain-display').first()).toHaveText('gmal.com', { timeout: 5000 })
  await expect(field(page).locator('text=Resembles')).toHaveCount(0)
})

test('a gmail address points at google.com, where the visits actually are', async ({ context, extensionId }) => {
  // Nobody ever opens gmail.com, so its own count is a zero that says nothing.
  // Gmail is read on mail.google.com, and that is the history worth showing.
  await seedVisits(context, 'mail.google.com', 340, { activeDays: 40 })
  const page = await openCheckPage(context, extensionId)

  await check(page, 'someone@gmail.com')

  await expect(field(page).locator('text=Mail read on')).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('text=Mail read on')).toContainText('google.com')
  await expect(field(page).locator('text=Mail read on').locator('.font-mono')).toHaveText('340')
})

test('a domain that is a site of its own is not sent anywhere else', async ({ context, extensionId }) => {
  await seedVisits(context, 'example.org', 6)
  const page = await openCheckPage(context, extensionId)

  await check(page, 'someone@example.org')

  await expect(field(page).getByText('Email address', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('text=Mail read on')).toHaveCount(0)
})
