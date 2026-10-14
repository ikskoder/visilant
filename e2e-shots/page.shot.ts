/**
 * What the extension draws over a web page: the warning, the link check, the
 * two dialogs and the check panel.
 */
import { FAMILIAR, fromMenu, openSite, patchSettings, seed, sitePage, test, waitForUi } from './fixtures'
import { checkSelection, linkPage, MAIL, rightClick, SITE, tooltipFor, workerFetch } from './helpers'
import { t } from './messages'

// Mounts every view below, so any shot of the in-page UI is a shot of it
const APP = 'src/contentScripts/views/App.vue'
const WARNING = 'src/contentScripts/views/InputWarning.vue'
const TOOLTIP = 'src/contentScripts/views/LinkTooltip.vue'
const INTERCEPT = 'src/contentScripts/views/LinkInterceptDialog.vue'
const PASTE = 'src/contentScripts/views/PasteInterceptDialog.vue'
const PANEL = 'src/contentScripts/views/CheckPanel.vue'
const MISMATCH = 'src/contentScripts/views/MismatchTable.vue'

// ==========================================
// The warning in the corner
// ==========================================

test('typing warning', async ({ page, shot }) => {
  await openSite(page, SITE, sitePage('Unknown Shop', `
    <p>Sign in to continue</p><input id="f" placeholder="Email"><input type="password" placeholder="Password">`))
  await page.locator('#f').click()
  await page.keyboard.type('me')
  await waitForUi(page, t('inputWarningMessage'))
  await shot(page, { name: 'warning-typing', title: 'Typing on an unfamiliar site', covers: [APP, WARNING] })
})

test('copy warning', async ({ page, shot }) => {
  await openSite(page, SITE, sitePage('Verify you are human', `
    <p>Press the button, then paste into Run.</p>
    <button id="b" style="font-size:16px;padding:8px 14px">I'm not a robot</button>
    <script>document.getElementById('b').onclick = () => navigator.clipboard.writeText('powershell -c iwr x').catch(() => {})</script>`))
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SITE).origin })
  await page.locator('#b').click()
  await waitForUi(page, t('copyWarningMessage'))
  await shot(page, { name: 'warning-copy', title: 'A site wrote to the clipboard', covers: [WARNING] })
})

// ==========================================
// The link check
// ==========================================

test('link tooltip, unfamiliar', async ({ page, shot }) => {
  await tooltipFor(page, '<a id="l" href="https://never-seen-before.test/offer">Claim your offer</a>', [t('linkTooltipDestination'), t('linkTooltipVisits')])
  await shot(page, { name: 'tooltip-unfamiliar', title: 'Link to a site never visited', covers: [TOOLTIP] })
})

test('link tooltip, familiar', async ({ page, context, shot }) => {
  await seed(context, { 'my-bank.test': FAMILIAR })
  await tooltipFor(page, '<a id="l" href="https://my-bank.test/login">My bank</a>', [t('linkTooltipDestination'), t('linkTooltipVisits')])
  await shot(page, { name: 'tooltip-familiar', title: 'Link to a familiar site', covers: [TOOLTIP] })
})

test('link tooltip, unfamiliar with the bars shown', async ({ page, context, shot }) => {
  await seed(context, { 'half-known.test': { visits: 4, activeDays: 2, ageDays: 3 } })
  await patchSettings(context, { showFamiliarityThresholds: true })
  await tooltipFor(page, '<a id="l" href="https://half-known.test/">Half known</a>', [t('linkTooltipDestination'), t('linkTooltipVisits')])
  await shot(page, { name: 'tooltip-thresholds', title: 'Seen a few times, with each check next to its bar', covers: [TOOLTIP] })
})

test('link tooltip, text names another site', async ({ page, context, shot }) => {
  await seed(context, { 'yourbank.test': FAMILIAR })
  await tooltipFor(page, '<a id="l" href="https://yourbank-secure-login.test/verify">https://www.yourbank.test/signin</a>', [t('linkTooltipMismatchWarning'), t('linkTooltipLeadsTo')])
  await shot(page, { name: 'tooltip-mismatch', title: 'Link text names one site, the link goes to another', covers: [TOOLTIP, MISMATCH] })
})

test('link tooltip, punycode lookalike', async ({ page, context, shot }) => {
  await seed(context, { 'apple.test': FAMILIAR })
  // Cyrillic а in place of the Latin a
  await tooltipFor(page, '<a id="l" href="https://аpple.test/id">Apple ID</a>', [t('linkTooltipPunycode')])
  await shot(page, { name: 'tooltip-punycode', title: 'Lookalike written with a letter from another alphabet', covers: [TOOLTIP] })
})

test('link tooltip, shortener waiting to be followed', async ({ page, shot }) => {
  await tooltipFor(page, '<a id="l" href="https://bit.ly/3xYz9Q">bit.ly/3xYz9Q</a>', [t('linkTooltipShortUrlWarning')])
  await shot(page, { name: 'tooltip-shortener', title: 'Shortened link, destination not looked up yet', covers: [TOOLTIP] })
})

test('link tooltip, shortener followed', async ({ page, context, shot }) => {
  await workerFetch(context, {
    'https://bit.ly/': { to: 'https://tinyurl.com/4kq7zv', body: '<meta http-equiv="refresh" content="0; url=https://prize-winner.test/claim?id=8812">' },
    'https://prize-winner.test/': {},
  })
  await patchSettings(context, { linkSafety: { shortUrlMode: 'auto', shortUrlShowFullUrl: true, shortUrlTraceChain: true } })
  await tooltipFor(page, '<a id="l" href="https://bit.ly/3xYz9Q">bit.ly/3xYz9Q</a>', [t('linkTooltipShortenedUrl'), t('linkTooltipRedirectChain')])
  await shot(page, { name: 'tooltip-shortener-resolved', title: 'Shortened link followed to where it ends, with the chain', covers: [TOOLTIP] })
})

test('link tooltip, email to a public provider', async ({ page, shot }) => {
  await tooltipFor(page, '<a id="l" href="mailto:support.team@gmail.com">Write to support</a>', [t('emailTooltipTitle'), t('emailPublicProvider')])
  await shot(page, { name: 'tooltip-email-public', title: 'Email link to a free mail provider', covers: [TOOLTIP] })
})

test('link tooltip, email to a disposable address', async ({ page, shot }) => {
  await tooltipFor(page, '<a id="l" href="mailto:refunds@mailinator.com">refunds@mailinator.com</a>', [t('emailTooltipTitle'), t('emailDisposableDomain')])
  await shot(page, { name: 'tooltip-email-disposable', title: 'Email link to a throwaway mail service', covers: [TOOLTIP] })
})

test('link tooltip, email text names another address', async ({ page, shot }) => {
  await tooltipFor(page, '<a id="l" href="mailto:billing@yourbank-help.test?subject=Invoice&body=Hello">billing@yourbank.test</a>', [t('emailTooltipMismatchWarning')])
  await shot(page, { name: 'tooltip-email-mismatch', title: 'Email link text shows one address, sends to another', covers: [TOOLTIP] })
})

test('link tooltip, email with several recipients', async ({ page, context, shot }) => {
  await seed(context, { 'my-company.test': FAMILIAR })
  await tooltipFor(page, '<a id="l" href="mailto:boss@my-company.test,payroll@my-c0mpany.test?cc=hr@my-company.test">Email the boss</a>', [t('emailTooltipTitle'), t('emailTooltipParams')])
  await shot(page, { name: 'tooltip-email-recipients', title: 'One mailto, several recipients, one of them a lookalike', covers: [TOOLTIP] })
})

test('link tooltip, QR code with no link in it', async ({ page, context, shot }) => {
  await openSite(page, SITE, linkPage('<span id="l">a QR code was here</span>'))
  await fromMenu(context, SITE, { type: 'show-qr-result', data: { payload: 'WIFI:T:WPA;S:CoffeeShop-Guest;P:espresso123;;' } })
  await waitForUi(page, t('qrTypeWifi'))
  await shot(page, { name: 'tooltip-qr-wifi', title: 'QR code that holds Wi-Fi details', covers: [TOOLTIP] })
})

// ==========================================
// The link dialog
// ==========================================

test('link dialog on click', async ({ page, context, shot }) => {
  await patchSettings(context, { linkSafety: { tooltipTrigger: 'click-left' } })
  await openSite(page, SITE, linkPage('<a id="l" href="https://never-seen-before.test/offer">Claim your offer</a>'))
  await page.locator('#l').click()
  await waitForUi(page, t('linkInterceptTitle'))
  await shot(page, { name: 'dialog-link', title: 'Clicked a link to a site never visited', covers: [INTERCEPT] })
})

test('link dialog from the menu, text names another site', async ({ page, context, shot }) => {
  await seed(context, { 'yourbank.test': FAMILIAR })
  await openSite(page, MAIL, linkPage('<a id="l" href="https://yourbank-secure-login.test/verify">https://www.yourbank.test/signin</a>', 'Inbox'))
  await rightClick(page, '#l')
  await fromMenu(context, MAIL, { type: 'show-link-intercept', data: { url: 'https://yourbank-secure-login.test/verify', frameId: 0 } })
  await waitForUi(page, t('linkTooltipLeadsTo'))
  await shot(page, { name: 'dialog-link-mismatch', title: '"Check link safety" on a link whose text names another site', covers: [INTERCEPT, MISMATCH] })
})

test('link dialog for a familiar site', async ({ page, context, shot }) => {
  await seed(context, { 'my-bank.test': FAMILIAR })
  await openSite(page, SITE, linkPage('<a id="l" href="https://my-bank.test/login">My bank</a>'))
  await fromMenu(context, SITE, { type: 'show-link-intercept', data: { url: 'https://my-bank.test/login', frameId: 0 } })
  await waitForUi(page, t('linkInterceptTitleFamiliar'))
  await shot(page, { name: 'dialog-link-familiar', title: '"Check link safety" on a familiar site', covers: [INTERCEPT] })
})

test('link dialog for a shortened link', async ({ page, context, shot }) => {
  await openSite(page, SITE, linkPage('<a id="l" href="https://bit.ly/3xYz9Q">bit.ly/3xYz9Q</a>'))
  await fromMenu(context, SITE, { type: 'show-link-intercept', data: { url: 'https://bit.ly/3xYz9Q', frameId: 0 } })
  await waitForUi(page, t('linkInterceptTitleHidden'))
  await shot(page, { name: 'dialog-link-shortener', title: '"Check link safety" on a shortened link', covers: [INTERCEPT] })
})

// ==========================================
// The paste dialog
// ==========================================

test('paste dialog', async ({ page, context, shot }) => {
  await patchSettings(context, { blockPasteOnUnfamiliar: true })
  // Copied on a site the user knows. A write on the unfamiliar one would raise
  // the copy warning over the field, which is not this picture.
  const source = 'https://password-manager.test/'
  await seed(context, { 'password-manager.test': FAMILIAR })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(source).origin })
  await openSite(page, source, sitePage('Password manager', ''))
  await page.evaluate(() => navigator.clipboard.writeText('4111 1111 1111 1111'))
  await openSite(page, SITE, sitePage('Unknown Shop', '<p>Card details</p><input id="f" placeholder="Card number">'))
  await page.locator('#f').click()
  await page.keyboard.press('ControlOrMeta+V')
  await waitForUi(page, t('pasteInterceptTitle'))
  await shot(page, { name: 'dialog-paste', title: 'Paste held back on an unfamiliar site', covers: [PASTE] })
})

// ==========================================
// The check panel ("Check selection" in the menu)
// ==========================================

test('check panel, a domain', async ({ page, context, shot }) => {
  await seed(context, {
    'paypal.test': FAMILIAR,
    'checkout.paypal.test': { visits: 4, activeDays: 2, ageDays: 20 },
  })
  await checkSelection(page, 'checkout.paypal.test', [t('checkPanelTitle')])
  await shot(page, { name: 'panel-domain', title: 'Checked a selected domain: its family of sites', covers: [PANEL] })
})

test('check panel, an email address', async ({ page, context, shot }) => {
  await seed(context, { 'gmail.com': FAMILIAR, 'mail.google.com': FAMILIAR })
  await checkSelection(page, 'security-team@gmial.com', [t('checkPanelTitle')])
  await shot(page, { name: 'panel-email', title: 'Checked a selected address one letter off gmail.com', covers: [PANEL] })
})
