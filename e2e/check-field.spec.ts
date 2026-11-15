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

const CHECK_INPUT = 'textarea[placeholder="Paste a link, domain or email address"]'

/**
 * The check field itself.
 *
 * Everything it reports also has a twin in the dashboard underneath – the same
 * base domain, the same visit count – so an unscoped assertion would pass on
 * the wrong half of the page.
 */
function field(page: any) {
  return page.locator('[data-check-field]')
}

/**
 * The checked-domain card under the field. The markers and the lookalike line
 * for the checked name are drawn there and nowhere else, so a positive
 * assertion about them looks here, and a negative one looks at the whole page.
 */
function panel(page: any) {
  return page.locator('[data-domain-panel]')
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
  await expect(popup.locator('[data-check-field]')).toHaveCount(0)
  await expect(popup.locator(CHECK_INPUT)).toHaveCount(0)
  // The button that opens the page is named as the page's field is
  await expect(popup.locator('button', { hasText: 'Check a link, email address or QR code' })).toBeVisible()
})

// The check answers the way the extension then acts. A link to a new subdomain
// of a familiar site shows red and a form on it warns, so the check field used
// to say "Familiar site" for an address the rest of Visilant would stop.
test('a new subdomain of a familiar site is judged by its own visits', async ({ context, extensionId }) => {
  await seedVisits(context, 'familiar-family.test', 50, { activeDays: 30 })
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://login.familiar-family.test/')

  await expect(panel(page).locator('[data-popup-verdict]')).toHaveAttribute('data-verdict', 'never', { timeout: 5000 })
  // The site's own figures are still there, under its name
  await expect(page.locator('[data-base-domain]')).toContainText('familiar-family.test')

  await check(page, 'https://familiar-family.test/')
  await expect(panel(page).locator('[data-popup-verdict]')).toHaveAttribute('data-verdict', 'familiar', { timeout: 5000 })
})

test('checking a URL reports its base domain and visit count', async ({ context, extensionId }) => {
  await seedVisits(context, 'shop.example.org', 4)
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://shop.example.org/cart?id=1')

  // The base domain is named once, in a card of its own – the check field used
  // to print it as well, a line above
  await expect(page.locator('[data-base-domain]')).toContainText('example.org', { timeout: 5000 })
  // And the checked-domain card answers for the exact hostname that was checked
  await expect(page.locator('[data-criterion="visits"]').first()).toHaveText('4')
  // Nothing else is recorded under that base domain, so the family's own row
  // would be this same number a second time and is left out
  await expect(page.locator('[data-family-stats]')).toHaveCount(0)
  // In their place the card says why, so it does not read as figures forgotten
  await expect(page.locator('[data-base-domain] [data-family-only-host]'))
    .toHaveText('Nothing else is recorded on this site.')
  // With no family list under it, the base domain card still keeps its distance
  // from the card above – the gap used to be kept only for the family list
  const panel = await page.locator('[data-domain-panel]').boundingBox()
  const base = await page.locator('[data-base-domain]').boundingBox()
  expect(base.y - (panel.y + panel.height)).toBeGreaterThan(8)
})

/**
 * The change this whole layout exists for: one name, one set of numbers.
 *
 * The check field folded the family and printed the result under the subdomain's
 * name, a few pixels above the card printing that host's own record – so a
 * profile like this one put `Visits 10` and `Visits 4` on screen together, both
 * apparently about `shop.example.org`.
 */
test('the family is drawn under the base domain, never under the subdomain', async ({ context, extensionId }) => {
  await seedVisits(context, 'shop.example.org', 4)
  await seedVisits(context, 'mail.example.org', 6)
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://shop.example.org/cart?id=1')

  // The host answers for itself
  await expect(page.locator('[data-criterion="visits"]').first()).toHaveText('4', { timeout: 5000 })
  // The family answers for the family, under the family's name
  const family = page.locator('[data-family-stats]')
  await expect(family.locator('[data-criterion="visits"]')).toHaveText('10')
  // There is something to add up here, so the line saying there is not stays away
  await expect(page.locator('[data-family-only-host]')).toHaveCount(0)
  // And the field above carries neither
  await expect(field(page).locator('[data-criterion="visits"]')).toHaveCount(0)
})

const DAY = 24 * 60 * 60 * 1000

test('a check reports every fact its verdict was drawn from', async ({ context, extensionId }) => {
  await seedVisits(context, 'evidence.example.org', 4, { activeDays: 3, firstSeen: Date.now() - 7 * DAY })
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://evidence.example.org/')

  // Not the visit count on its own: a site can be called unfamiliar over a date
  // while the only number on screen says it has been visited plenty. The facts
  // are drawn once, in the checked-domain card – the check field above used to
  // carry a second copy of them, folded over the family instead of this host.
  await expect(page.locator('[data-criterion="visits"]').first()).toHaveText('4', { timeout: 5000 })
  await expect(page.locator('[data-criterion="activeDays"]').first()).toHaveText('3')
  await expect(page.locator('[data-criterion="age"]').first()).toContainText('7')
  await expect(field(page).locator('[data-criterion="visits"]')).toHaveCount(0)
})

/**
 * The card names each fact above the number, so it takes the bar into the cell
 * rather than growing a column for it – the shape `MismatchTable` and this grid
 * have always used. The headed table is what the surfaces that do not name their
 * rows switch to, and `FamiliarityFacts` is unit-tested for both shapes.
 */
test('the bar rides along inside the cell once it is asked for', async ({ context, extensionId }) => {
  await patchSettings(context, { showFamiliarityThresholds: true })
  await seedVisits(context, 'threshold.example.org', 4, { activeDays: 3, firstSeen: Date.now() - 7 * DAY })
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://threshold.example.org/')

  // Four visits against the shipped bar of ten
  await expect(page.locator('[data-criterion="visits"]').first()).toHaveText('4 / 10', { timeout: 5000 })
})

// The check page is the one surface with no site behind it: the reader is on the
// extension's own page and the name on screen is one they typed. A line saying
// whether this site hides the warnings is there a claim about nothing.
test('the checked domain carries no anti-tampering claim', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://tamper-claim.example.org/')

  await expect(page.locator('text=Checked address')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=hides Visilant')).toHaveCount(0)
})

test('a bare domain is understood without a scheme', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'example.net')

  await expect(panel(page).locator('.secure-domain-display').first()).toHaveText('example.net', { timeout: 5000 })
  // Never visited, said once by the verdict and not again as a row of zeros
  await expect(panel(page).locator('[data-popup-verdict]')).toHaveAttribute('data-verdict', 'never')
  await expect(page.locator('[data-criterion]')).toHaveCount(0)
  // Nothing sits in front of the base domain, so there is no base domain to add
  await expect(page.locator('[data-base-domain]')).toHaveCount(0)
})

test('a known shortener is flagged and offers to be expanded', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://bit.ly/3xAmPl3')

  // Said once, in the card, in words. The field only offers the way through it.
  await expect(panel(page).locator('[data-marker-note="shortener"]')).toBeVisible({ timeout: 5000 })
  await expect(field(page).locator('text=shortener')).toHaveCount(0)
  await expect(field(page).locator('button', { hasText: 'Try to find where it leads' })).toBeVisible()
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

  // One sentence, naming the site it is about. The reason used to sit on a line
  // of its own and say "that name", which told a first-time reader nothing.
  const notice = panel(page).locator('[data-lookalike-source="history"]')
  await expect(notice).toHaveText(/May be made to look like the familiar\s*gmail\.com\s*with a letter or two changed/, { timeout: 5000 })
  await expect(notice.locator('[data-lookalike-site]')).toHaveText('gmail.com')
})

test('a familiar domain parked in front of an ending is explained once, by the lookalike line', async ({ context, extensionId }) => {
  await seedVisits(context, 'yourbank.com', 50, { activeDays: 30 })
  const page = await openCheckPage(context, extensionId)
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))

  await check(page, 'https://yourbank.com.pay-verify.top/8842')

  // Waited for first: the marker is held back until this answer is in, so
  // checking for its absence any earlier would pass on a pending answer
  const notice = panel(page).locator('[data-lookalike-reason="familiar-as-subdomain"]')
  await expect(notice).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-marker="embedded-public-suffix"]')).toHaveCount(0)
  // Once on the page. The field above the card used to print it as well, word
  // for word.
  await expect(page.locator('[data-lookalike-reason="familiar-as-subdomain"]')).toHaveCount(1)
  // The marker it replaces named the real site, so this line has to as well
  await expect(notice).toHaveText(/May be made to look like the familiar\s*yourbank\.com\s*but the real site is\s*pay-verify\.top/)
  await expect(notice.locator('[data-lookalike-real]')).toHaveText('pay-verify.top')

  // Two domains parked in front, one of them never visited. That one imitates
  // nothing the user trusts, so the familiar one is the only line, and nothing
  // is said of the other. Waited for the line first, for the same reason
  await check(page, 'https://something.com.yourbank.com.evil.net/login')
  const only = panel(page).locator('[data-lookalike-reason="familiar-as-subdomain"]')
  await expect(only).toHaveText(/yourbank\.com\s*but the real site is\s*evil\.net/, { timeout: 5000 })
  await expect(page.locator('[data-lookalike]')).toHaveCount(1)
  await expect(page.locator('[data-marker="embedded-public-suffix"]')).toHaveCount(0)
})

test('every marker is drawn once, in the card, the one about the link included', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://paypal.com@a.b.c.d.evil.net/login')

  // The name before the @ is part of the link rather than the host, and the
  // card is handed the link so that it can say so
  await expect(panel(page).locator('[data-marker="url-userinfo"]')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-marker="url-userinfo"]')).toHaveCount(1)
  await expect(panel(page).locator('[data-marker="deep-subdomains"]')).toBeVisible()
  await expect(page.locator('[data-marker="deep-subdomains"]')).toHaveCount(1)
})

test('lowering the familiarity threshold brings a domain into the comparison', async ({ context, extensionId }) => {
  // Five visits is under the default threshold of ten, so this domain is not
  // yet one the user is taken to know
  await seedVisits(context, 'gmail.com', 5)

  const page = await openCheckPage(context, extensionId)
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))
  await check(page, 'jsdojif@gmal.com')
  // The provider line is always there for this address, so once it is up the
  // answer is in, and counting the history lines before then would pass on a
  // question still in flight
  await expect(panel(page).locator('[data-lookalike-source="provider"]')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-lookalike-source="history"]')).toHaveCount(0)

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

  await expect(panel(page).locator('[data-lookalike-source="history"]')).toBeVisible({ timeout: 5000 })
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
  // The provider line is always there for this address, so once it is up the
  // answer is in, and counting the history lines before then would pass on a
  // question still in flight
  await expect(panel(page).locator('[data-lookalike-source="provider"]')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-lookalike-source="history"]')).toHaveCount(0)
})

test('an email address is read as an email, not as a link', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'billing@some-supplier.com')

  await expect(field(page).locator('text="Email address"')).toBeVisible({ timeout: 5000 })
  // Read as an address rather than as a link to its domain
  await expect(field(page).locator('text="Site"')).toHaveCount(0)
})

test('a unicode lookalike is reported under its real ascii name', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  // Cyrillic "а" in what otherwise reads as apple.com
  await check(page, 'https://аpple.com')

  // The card spells it out both ways, the host the browser would actually go
  // to among them, which is the whole point of checking an address that reads
  // as a familiar one. The field under the input used to print it again.
  await expect(panel(page)).toContainText('xn--pple-43d.com', { timeout: 5000 })
  await expect(field(page).locator('[data-field-hostname]')).toHaveCount(0)
  await expect(field(page).locator('[data-other-spelling]')).toHaveCount(0)
  await expect(page.locator('text=Readable form')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Coded form (punycode)')).toBeVisible()
})

test('the letter a lookalike changed is underlined in the address', async ({ context, extensionId }) => {
  await seedVisits(context, 'apple.com', 40, { activeDays: 20 })
  const page = await openCheckPage(context, extensionId)
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))

  // Cyrillic "а" in front
  await check(page, 'https://аpple.com')
  await expect(panel(page).locator('[data-lookalike-reason="confusable"]')).toBeVisible({ timeout: 5000 })
  // On the Unicode spelling, where the letter is. The xn-- spelling has no
  // such letter to point at, and gets no underline.
  await expect(page.locator('[data-diff]')).toHaveCount(1)
  await expect(page.locator('[data-diff]')).toHaveText('а')

  // A letter typed twice: the last of the run
  await check(page, 'https://applee.com')
  await expect(panel(page).locator('[data-lookalike-reason="edit-distance"]')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-diff]')).toHaveCount(1)

  // A letter left out has nothing to underline
  await check(page, 'https://aple.com')
  await expect(panel(page).locator('[data-lookalike]')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-diff]')).toHaveCount(0)
})

test('a site on a shared platform says the platform does not run it, until it is familiar', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://someone.github.io/login')
  const line = panel(page).locator('[data-marker="hosted-on"]')
  await expect(line).toBeVisible({ timeout: 5000 })
  await expect(line.locator('[data-marker-platform]')).toHaveText('github.io')
  await expect(page.locator('[data-marker="hosted-on"]')).toHaveCount(1)

  // A name of its own has no platform to speak of
  await check(page, 'https://some-shop.com')
  await expect(page.locator('text=Checked address')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-marker="hosted-on"]')).toHaveCount(0)

  await seedVisits(context, 'myblog.github.io', 40, { activeDays: 20 })
  await page.reload()
  await page.waitForTimeout(1500)
  await check(page, 'https://myblog.github.io/')
  await expect(panel(page).locator('[data-criterion="visits"]')).toContainText('40', { timeout: 5000 })
  await expect(page.locator('[data-marker="hosted-on"]')).toHaveCount(0)
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

  await expect(page.locator('text=Checked address')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.secure-domain-display').first()).toContainText('dashboard-target.com')
})

test('an email address is compared against the mail providers, not just history', async ({ context, extensionId }) => {
  // Nothing seeded: Gmail redirects to mail.google.com, so no amount of real use
  // would put gmail.com in a profile's history either
  const page = await openCheckPage(context, extensionId)
  await check(page, 'dpfk@gmal.com')

  await expect(panel(page).locator('[data-lookalike-source="provider"]')).toBeVisible({ timeout: 5000 })
  await expect(panel(page).locator('[data-lookalike-site]')).toHaveText('gmail.com')
  await expect(page.locator('[data-lookalike]')).toHaveCount(1)
  // Never opened, so there is no visit count to report about it
  await expect(page.locator('[data-lookalike-source="history"]')).toHaveCount(0)
})

test('the provider list stays out of the plain link check', async ({ context, extensionId }) => {
  // The exception is for email addresses. Ordinary browsing keeps comparing
  // against the user's own history and nothing else.
  const page = await openCheckPage(context, extensionId)
  await check(page, 'https://gmal.com')

  await expect(panel(page).locator('.secure-domain-display').first()).toHaveText('gmal.com', { timeout: 5000 })
  await expect(page.locator('[data-lookalike]')).toHaveCount(0)
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
  await expect(page.locator('text=The addresses differ')).toBeVisible({ timeout: 3000 })

  // "rn" against "m": one letter swapped and one added, and nothing else
  await expect(page.locator('text=2 characters aren\'t the same')).toBeVisible()

  // The same address, and the answer flips
  await field.fill('anna@exarnple.org')
  await expect(page.locator('text=The addresses are identical')).toBeVisible({ timeout: 3000 })
})

// The check reads an address and stops there – it never learns which server sent
// anything. Somebody who takes a clean result for a verdict is worse off than
// somebody who never ran it, so the limits sit next to the answer.
test('an email check says what it cannot tell you', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'someone@example.org')

  const caveat = page.locator('text=Checking this because an email looked suspicious')
  await expect(caveat).toBeVisible({ timeout: 5000 })

  // Folded away until asked for: five lines on every check would be noise
  await expect(page.locator('text=This check saw only the address')).toHaveCount(0)
  await caveat.click()
  await expect(page.locator('text=This check saw only the address')).toBeVisible()

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

  // The stranger is its own site, with nothing of its own and nothing borrowed
  await expect(panel(page).locator('text=evil.github.io').first()).toBeVisible({ timeout: 5000 })
  await expect(panel(page).locator('[data-popup-verdict]')).toHaveAttribute('data-verdict', 'never')
  await expect(page.locator('[data-criterion]')).toHaveCount(0)
})

test('a tenant keeps its own subdomains', async ({ context, extensionId }) => {
  await seedVisits(context, 'alice.github.io', 30, { activeDays: 20 })

  const page = await openCheckPage(context, extensionId)

  await check(page, 'https://blog.alice.github.io/post')

  // The tenant's thirty visits belong to the tenant, so they are drawn under the
  // tenant's own name. `blog.` has none of its own, and its card says so rather
  // than borrowing them – which is what put two different `Visits` rows on one
  // screen before.
  await expect(page.locator('[data-family-stats]').locator('[data-criterion="visits"]')).toContainText('30', { timeout: 5000 })
  await expect(panel(page).locator('[data-popup-verdict]')).toHaveAttribute('data-verdict', 'never')
  await expect(panel(page).locator('[data-criterion]')).toHaveCount(0)
})

test('every recipient of a mailto is checked, not just the first', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'mailto:trusted@known.example,attacker@evil.example?cc=copied@third.example')

  const recipients = field(page).locator('.mail-recipients')
  await expect(recipients).toBeVisible({ timeout: 5000 })
  await expect(recipients).toContainText('3 recipients · 3 domains')
  await expect(recipients).toContainText('attacker')
  await expect(recipients).toContainText('evil.example')
  // A copied recipient reaches a real person and is named as one
  await expect(recipients).toContainText('Cc')
  await expect(recipients).toContainText('third.example')
})

// The card under the field shows one recipient at a time, the one opened in
// the list, and the comparison is with that one
test('a recipient opened in the list is the one the card shows and the comparison takes', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)
  await check(page, 'mailto:trusted@known.example,attacker@evil.example?cc=copied@third.example')

  const recipients = field(page).locator('.mail-recipients')
  await expect(recipients.locator('[data-recipient]')).toHaveText([/attacker@evil\.example/, /trusted@known\.example/, /copied@third\.example/], { timeout: 5000 })
  // Nothing chosen yet: no card, no comparison, and a line that says what to do
  await expect(recipients.locator('[data-status="choose-recipient"]')).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('text=Compare with an address you already trust')).toHaveCount(0)

  await recipients.locator('[data-recipient="attacker@evil.example"] .recipient-address').click()
  await expect(recipients.locator('[data-recipient-more]')).toHaveCount(1)
  await expect(panel(page)).toContainText('To · #1 of 3 recipients', { timeout: 5000 })
  await expect(panel(page).locator('.popup-address .vz-addr__acct')).toHaveText('attacker')
  // Its lines are in the open row, so the card leaves them out
  await expect(panel(page).locator('[data-red-flag], .domain-markers')).toHaveCount(0)

  await page.locator('text=Compare with an address you already trust').click()
  const pasted = page.locator('input[placeholder="Address from an earlier message"]')
  await pasted.fill('attacker@evil.example')
  await expect(field(page)).toContainText('The addresses are identical')
  // Another recipient, the same trusted address held against it
  await recipients.locator('[data-recipient="copied@third.example"] .recipient-address').click()
  await expect(panel(page)).toContainText('Cc · #3 of 3 recipients', { timeout: 5000 })
  await expect(pasted).toHaveValue('attacker@evil.example')
  await expect(field(page)).toContainText('The addresses differ')
})

test('a single-recipient address keeps the shape it always had', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)

  await check(page, 'billing@some-supplier.com')

  await expect(field(page).locator('.mail-recipients')).toHaveCount(0)
})

// A label and the dot after it are held together by room that is given and
// taken back in the stylesheet. Taken back by more than the dot is wide, which
// it was with the frames off, every label broke its last letter onto a second
// line: "paypa / l". Nothing drew an address with the frames off, so nothing saw it.
for (const frames of [true, false]) {
  test(`every label of an address is one line high with the frames ${frames ? 'on' : 'off'}`, async ({ context, extensionId }) => {
    await patchSettings(context, { addressFrames: frames })
    // Familiar, so the name parked in front is a red flag to mark
    await seedVisits(context, 'paypal.com', 50, { activeDays: 30 })
    const page = await openCheckPage(context, extensionId)
    await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))
    // With a dot at the very end, which is bold and a little wider
    await check(page, 'https://paypal.com.secure.evil.net./login')
    // The card under the field draws the address checked, the field leaves it to the card
    const address = panel(page).locator('.popup-address .vz-addr').first()
    const labels = address.locator('.vz-lbl')
    await expect(labels).toHaveCount(5, { timeout: 5000 })
    const lines: { rects: number, height: number }[] = await labels.evaluateAll((all: HTMLElement[]) => all.map(label => ({ rects: label.getClientRects().length, height: Math.round(label.getBoundingClientRect().height) })))
    expect(lines.map(line => line.rects)).toEqual([1, 1, 1, 1, 1])
    // One line each: a label broken in two is twice as high as its neighbours.
    // Not the same height to the pixel, a red frame is a pixel heavier
    const heights = lines.map(line => line.height)
    expect(Math.max(...heights)).toBeLessThan(Math.min(...heights) * 1.5)
    // And the finding under it is marked in it: the borrowed name in red
    const red = address.locator('.vz-lbl[data-tone="danger"]')
    await expect(red).toHaveText(['paypal', 'com'])
    // As drawn, not as named: with the frames off the mark is the tint alone,
    // and a rule that cleared the label's ground once took it away
    const drawn = await red.first().evaluate((label: HTMLElement) => {
      const style = getComputedStyle(label)
      return { frame: style.borderTopWidth, under: style.boxShadow, ground: style.backgroundColor }
    })
    expect(drawn.ground).not.toBe('rgba(0, 0, 0, 0)')
    if (frames)
      expect(drawn.frame).toBe('2px')
    else
      expect(drawn.under).toBe('none')
  })
}

// What kind of mail service a domain is, is a line about the domain. It stood
// in the field's block under the name before the @, and the card that shows
// the domain and calls it "Temporary email service" said nothing about what that is
for (const service of [
  { kind: 'disposable', address: 'refunds@mailinator.com', badge: 'Temporary email service', line: 'Anyone can make an address here in seconds' },
  { kind: 'forwarding', address: 'dev@mozmail.com', badge: 'Email forwarding service', line: 'Mail sent to this address is passed on to another mailbox' },
]) {
  test(`a ${service.kind} mail service is explained in the card, under the domain it is about`, async ({ context, extensionId }) => {
    const page = await openCheckPage(context, extensionId)
    await check(page, service.address)

    const card = panel(page)
    await expect(card.locator('[data-popup-verdict]')).toHaveAttribute('data-verdict', service.kind)
    await expect(card.locator('[data-popup-verdict]')).toContainText(service.badge)
    // Never a verdict on visits nobody makes to such a domain
    await expect(card).not.toContainText('Never visited')
    await expect(card.locator('[data-criterion]')).toHaveCount(0)

    const line = card.locator(`[data-status="${service.kind}"]`)
    await expect(line).toHaveAttribute('data-tone', 'caution')
    await expect(line).toContainText(service.line)
    // Said once on the page, and not under the account name
    await expect(page.locator(`[data-status="${service.kind}"]`)).toHaveCount(1)
    await expect(field(page)).not.toContainText(service.line)

    // The site in the address is in the line's orange
    await expect(card.locator('.popup-address .vz-lbl[data-tone="caution"]')).toHaveCount(2)

    // What writing to such an address means is behind the question mark
    // The card's verdict names the kind, so the line does not say it again
    await expect(line.locator('[data-service-name]')).toHaveCount(0)
    await expect(line).not.toContainText('who will read your message')
    await line.locator('[data-action="help"]').click()
    await expect(line.locator('[data-help-text]')).toContainText('who will read your message')
  })

  // One explanation, wherever the address came from
  test(`a mail link to a ${service.kind} mail service is explained in the same words`, async ({ context, extensionId }) => {
    const page = await openCheckPage(context, extensionId)
    await check(page, `mailto:${service.address}`)

    const line = panel(page).locator(`[data-status="${service.kind}"]`)
    await expect(line).toContainText(service.line)
    await expect(line.locator('[data-action="help"]')).toHaveCount(1)
  })
}

// The page about a domain alone has no address on it. The details of a mail
// link are the check page with the link in it
test('the check page opened with a mail link shows the address and its domain', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?check=1&value=${encodeURIComponent('mailto:ann@some-supplier.test')}`)

  await expect(field(page)).toContainText('Email address', { timeout: 10000 })
  await expect(page.locator(CHECK_INPUT)).toHaveValue('mailto:ann@some-supplier.test')
  await expect(panel(page).locator('.popup-address .vz-addr__acct')).toContainText('ann')
  await expect(panel(page).locator('.popup-address')).toContainText('some-supplier')
})

// An entry that does not read as an address is somebody a mail program may
// still write to. It used to drop out of the count without a word
test('a recipient that does not read as an address is counted as not checked', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)
  await check(page, 'mailto:ann@known.example?cc=not-an-address')

  const recipients = field(page).locator('.mail-recipients')
  await expect(recipients).toBeVisible({ timeout: 5000 })
  await expect(recipients).toContainText('+1 more that don\'t read as an email address, so not checked')
})

// Past 25 the rest used to be counted as not checked, on the one page that is
// there to look at all of them
test('every recipient is checked, however many the link names', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)
  await check(page, `mailto:${Array.from({ length: 40 }, (_, i) => `p${i}@known.example`).join(',')}`)

  const recipients = field(page).locator('.mail-recipients')
  await expect(recipients).toContainText('40 recipients · 1 domain', { timeout: 5000 })
  await expect(recipients.locator('[data-recipient]')).toHaveCount(40)
  await expect(recipients).not.toContainText('not checked')
})

test('a list separated by semicolons is read as a mail program reads it', async ({ context, extensionId }) => {
  const page = await openCheckPage(context, extensionId)
  await check(page, 'mailto:pay@known.example;Boss <ceo@evil.example>')

  const recipients = field(page).locator('.mail-recipients')
  await expect(recipients).toContainText('2 recipients · 2 domains', { timeout: 5000 })
  await expect(recipients).toContainText('evil.example')
})
