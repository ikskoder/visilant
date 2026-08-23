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
  await expect(field(page).locator('[data-criterion="visits"]').first()).toHaveText('4')
})

const DAY = 24 * 60 * 60 * 1000

test('a check reports every fact its verdict was drawn from', async ({ context, extensionId }) => {
  await seedVisits(context, 'evidence.example.org', 4, { activeDays: 3, firstSeen: Date.now() - 7 * DAY })
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://evidence.example.org/')

  // Not the visit count on its own: a site can be called unfamiliar over a date
  // while the only number on screen says it has been visited plenty
  await expect(field(page).locator('[data-criterion="visits"]').first()).toHaveText('4', { timeout: 5000 })
  await expect(field(page).locator('[data-criterion="activeDays"]').first()).toHaveText('3')
  await expect(field(page).locator('[data-criterion="age"]').first()).toContainText('7')
})

test('the facts become a headed table once the bar is asked for', async ({ context, extensionId }) => {
  await patchSettings(context, { showFamiliarityThresholds: true })
  await seedVisits(context, 'threshold.example.org', 4, { activeDays: 3, firstSeen: Date.now() - 7 * DAY })
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://threshold.example.org/')

  // Headings, because a bare "4 / 10" is a pair of numbers whose meaning is gone
  // a moment later. The shipped bar for visits is 10.
  await expect(field(page).locator('table').first()).toContainText('Needed', { timeout: 5000 })
  await expect(field(page).locator('[data-criterion="visits"]').first()).toHaveText('4')
  await expect(field(page).locator('[data-required="visits"]').first()).toHaveText('10')
  // Four visits against a bar of ten, so the row is marked as not cleared
  await expect(field(page).locator('[data-passed="visits"]').first()).toHaveText('✗')
})

// The check page is the one surface with no site behind it: the reader is on the
// extension's own page and the name on screen is one they typed. "Anti-tampering:
// active" there is a claim about nothing.
test('the checked domain carries no anti-tampering claim', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://tamper-claim.example.org/')

  await expect(page.locator('text=Checked domain')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Anti-tampering')).toHaveCount(0)
})

test('a bare domain is understood without a scheme', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'example.net')

  await expect(field(page).locator('.secure-domain-display').first()).toHaveText('example.net', { timeout: 5000 })
  await expect(field(page).locator('[data-criterion="visits"]').first()).toHaveText('0')
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

  const mail = field(page).locator('.mail-sites')
  await expect(mail).toBeVisible({ timeout: 5000 })
  await expect(mail).toContainText('google.com')
  // The whole verdict for that site, not just its count – it is the one the
  // answer about the address actually rests on
  await expect(mail.locator('[data-criterion="visits"]')).toHaveText('340')
  await expect(mail.locator('[data-criterion="activeDays"]')).toHaveText('40')
})

// A domain the user has written to for years says nothing about whether today's
// sender is the same person. Only an earlier address does, and holding two of
// them up to the light is the task eyes are worst at.
test('two addresses can be held against each other, character by character', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'anna@exarnple.org')

  const toggle = page.locator('text=Compare with an address you already trust')
  await expect(toggle).toBeVisible({ timeout: 5000 })
  await toggle.click()

  const field = page.locator('input[placeholder="Address from an earlier message"]')
  await field.fill('anna@example.org')
  await expect(page.locator('text=Not the same address')).toBeVisible({ timeout: 3000 })

  // "rn" against "m" – three columns out of the alignment, and nothing else
  await expect(page.locator('text=3 characters do not line up')).toBeVisible()

  // The same address, and the answer flips
  await field.fill('anna@exarnple.org')
  await expect(page.locator('text=The same address, character for character')).toBeVisible({ timeout: 3000 })
})

// The check reads an address and stops there – it never learns which server sent
// anything. Somebody who takes a clean result for a verdict is worse off than
// somebody who never ran it, so the limits sit next to the answer.
test('an email check says what it cannot tell you', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'someone@example.org')

  const caveat = page.locator('text=Got a message that worried you')
  await expect(caveat).toBeVisible({ timeout: 5000 })

  // Folded away until asked for: four paragraphs on every check would be noise
  await expect(page.locator('text=This check only ever saw the address')).toHaveCount(0)
  await caveat.click()
  await expect(page.locator('text=This check only ever saw the address')).toBeVisible()

  // A link and a file are two different pages at VirusTotal, and sending
  // somebody to the wrong one in the middle of advice about not opening things
  // would be a small cruelty
  const targets = await page.locator('a', { hasText: /VirusTotal|urlscan/ }).evaluateAll(
    (anchors: Element[]) => anchors.map(anchor => anchor.getAttribute('href')),
  )
  expect(targets).toEqual([
    'https://www.virustotal.com/gui/home/url',
    'https://urlscan.io/',
    'https://www.virustotal.com/gui/home/upload',
  ])
})

test('a domain that is a site of its own is not sent anywhere else', async ({ context, extensionId }) => {
  await seedVisits(context, 'example.org', 6)
  const page = await openCheckPage(context, extensionId)

  await check(page, 'someone@example.org')

  await expect(field(page).getByText('Email address', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('.mail-sites')).toHaveCount(0)
})

test('two tenants of one hosting platform are two different sites', async ({ context, extensionId }) => {
  // A platform that hands out a subdomain per customer. Under the default
  // public suffix list both of these fold into `github.io`, so one tenant's
  // fifty visits used to vouch for a tenant the user has never opened.
  await seedVisits(context, 'alice.github.io', 50, { activeDays: 30 })

  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://evil.github.io/login')

  // The stranger is its own site, with its own count of nothing
  await expect(field(page).locator('[data-criterion="visits"]').first()).toContainText('0')
  await expect(field(page).locator('text=evil.github.io').first()).toBeVisible()
})

test('a tenant keeps its own subdomains', async ({ context, extensionId }) => {
  await seedVisits(context, 'alice.github.io', 30, { activeDays: 20 })

  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://blog.alice.github.io/post')

  await expect(field(page).locator('[data-criterion="visits"]').first()).toContainText('30')
})

test('every recipient of a mailto is checked, not just the first', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'mailto:trusted@known.example,attacker@evil.example?cc=copied@third.example')

  const recipients = field(page).locator('.mail-recipients')
  await expect(recipients).toBeVisible({ timeout: 5000 })
  await expect(recipients).toContainText('Recipients (3)')
  await expect(recipients).toContainText('attacker')
  await expect(recipients).toContainText('evil.example')
  // A copied recipient reaches a real person and is named as one
  await expect(recipients).toContainText('Cc')
  await expect(recipients).toContainText('third.example')
})

test('a single-recipient address keeps the shape it always had', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'billing@some-supplier.com')

  await expect(field(page).locator('.mail-recipients')).toHaveCount(0)
})
