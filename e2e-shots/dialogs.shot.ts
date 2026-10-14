/**
 * The dialogs and the check panel in detail: the link dialog in every verdict
 * and every state a short link can be in, the paste dialog for each kind of
 * payload and for a paste made inside a frame, and the panel "Check selection"
 * opens for each kind of name.
 */
import type { Page } from '@playwright/test'
import type { Seed } from './fixtures'
import type { FetchAnswer } from './helpers'
import { clickUi, FAMILIAR, fromMenu, openSite, patchSettings, seed, sitePage, test, waitForUi } from './fixtures'
import { a, checkSelection, DAY, linkPage, menuCheck, seedRaw, setLocal, SITE, workerFetch } from './helpers'
import { t } from './messages'

const INTERCEPT = 'src/contentScripts/views/LinkInterceptDialog.vue'
const MISMATCH = 'src/contentScripts/views/MismatchTable.vue'
const PASTE = 'src/contentScripts/views/PasteInterceptDialog.vue'
const PANEL = 'src/contentScripts/views/CheckPanel.vue'

const KNOWN: Record<string, Seed> = {
  'northbank.test': FAMILIAR,
  'bank.test': FAMILIAR,
  'corp.test': FAMILIAR,
}
const LOW: Seed = { visits: 3, activeDays: 2, ageDays: 3 }

interface Base {
  name: string
  title: string
  note: string
  seed?: Record<string, Seed>
  raw?: (now: number) => Record<string, unknown>
  settings?: Record<string, unknown>
  local?: Record<string, unknown>
  fetch?: Record<string, FetchAnswer>
  needles: () => string[]
  press?: () => string
  after?: () => string[]
}

async function prepare(page: Page, c: Base) {
  const context = page.context()
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
}

async function finish(page: Page, c: Base) {
  if (c.press) {
    await clickUi(page, c.press())
    await waitForUi(page, ...(c.after?.() ?? []))
  }
}

// ==========================================
// The link dialog
// ==========================================

interface DialogCase extends Base {
  /** `click`: the click trigger, on the link. `menu`: "Check link safety" from the context menu. */
  how: 'click' | 'menu'
  link: string
  href: string
}

const unfamiliar = () => [t('linkInterceptTitle')]
const hidden = () => [t('linkInterceptTitleHidden')]

const DIALOGS: DialogCase[] = [
  { name: 'dlg-some-visits', how: 'click', title: 'Link dialog for a site seen a few times', note: 'Clicked a link to a site visited three times. The badge reads "Unfamiliar site", not "Never visited". Both are red, the words tell them apart.', seed: { 'low.test': LOW }, link: a('https://low.test/', 'A site seen three times'), href: 'https://low.test/', needles: unfamiliar },
  { name: 'dlg-count-hidden', how: 'click', title: 'Link dialog with visit counts switched off', note: 'Status only, no facts.', settings: { linkSafety: { showVisitCount: 'never' } }, link: a('https://new-place.test/', 'New place'), href: 'https://new-place.test/', needles: unfamiliar },
  { name: 'dlg-unknown-facts', how: 'click', title: 'Link dialog for a site recorded before dates were kept', note: 'Active days and days known read "not recorded", each with a failed mark.', raw: now => ({ 'legacy.test': { count: 15, lastSeen: now - DAY, ignored: false } }), link: a('https://legacy.test/', 'An old favourite'), href: 'https://legacy.test/', needles: unfamiliar },
  { name: 'dlg-thresholds', how: 'click', title: 'Link dialog with the bars shown, rule "at least 2 of 3"', note: 'The facts as a table with a Checks row.', settings: { showFamiliarityThresholds: true, familiarity: { mode: 'atLeast', atLeast: 2 } }, seed: { 'x-visits.test': { visits: 12, activeDays: 1, ageDays: 1 } }, link: a('https://x-visits.test/', 'Busy but new'), href: 'https://x-visits.test/', needles: unfamiliar },
  { name: 'dlg-lookalike', how: 'click', title: 'Link dialog for a lookalike of a known site', note: 'northbank-secure.test. The lookalike line inside the dialog.', seed: KNOWN, link: a('https://northbank-secure.test/', 'Your bank'), href: 'https://northbank-secure.test/', needles: unfamiliar },
  { name: 'dlg-markers', how: 'click', title: 'Link dialog with several warnings about the address', note: 'A deep address with a well-known name in it: the markers are listed in the dialog.', link: a('https://paypal.com.a.b.c.verify.test/', 'PayPal'), href: 'https://paypal.com.a.b.c.verify.test/', needles: unfamiliar },
  { name: 'dlg-idn', how: 'click', title: 'Link dialog for a name in another alphabet', note: 'пример.test, with its xn-- spelling.', link: a('https://пример.test/', 'Пример'), href: 'https://пример.test/', needles: unfamiliar },
  { name: 'dlg-long', how: 'click', title: 'Link dialog for a very long name', note: 'The name wraps at dots inside the dialog.', link: a('https://this-is-a-very-long-label-that-goes-on-and-on.another-long-label-that-also-goes-on.evil.test/', 'Somewhere'), href: 'https://this-is-a-very-long-label-that-goes-on-and-on.another-long-label-that-also-goes-on.evil.test/', needles: unfamiliar },
  { name: 'dlg-familiar-mismatch', how: 'menu', title: 'Link dialog: familiar destination, but the text names another site', note: 'The link goes to bank.test, which the user knows, but reads corp.test. Red triangle, title "Link check", the comparison table, "Go back" as the main button and "Continue anyway" outlined in red.', seed: KNOWN, link: a('https://bank.test/', 'corp.test'), href: 'https://bank.test/', needles: () => [t('linkTooltipLeadsTo')] },
  { name: 'dlg-mismatch-lookalike', how: 'menu', title: 'Link dialog: text names the known site, link goes to its lookalike', note: 'The table, then the lookalike line.', seed: KNOWN, link: a('https://n0rthbank.test/', 'northbank.test'), href: 'https://n0rthbank.test/', needles: () => [t('linkTooltipLeadsTo')] },
  { name: 'dlg-mismatch-shortener', how: 'menu', title: 'Link dialog: text names a site, link is a short link', note: 'Title "Shortened link", the table, no short-link buttons.', seed: KNOWN, link: a('https://bit.ly/3mmshort', 'bank.test'), href: 'https://bit.ly/3mmshort', needles: () => [t('linkTooltipLeadsTo')] },
  { name: 'dlg-familiar-shortener', how: 'menu', title: 'Link dialog for a short-link service the user uses a lot', note: 'Even a familiar shortener says "Shortened link": knowing bit.ly says nothing about where its links go.', seed: { 'bit.ly': FAMILIAR }, link: a('https://bit.ly/3famshr', 'bit.ly/3famshr'), href: 'https://bit.ly/3famshr', needles: hidden },
  { name: 'dlg-mode-off', how: 'menu', title: 'Link dialog with short links not followed', note: 'No "Check where it leads" row.', settings: { linkSafety: { shortUrlMode: 'off' } }, link: a('https://new-place.test/', 'New place'), href: 'https://new-place.test/', needles: unfamiliar },
  { name: 'dlg-any-idle', how: 'menu', title: 'Link dialog when any link may be followed', note: 'An ordinary link gets "Show real destination" without the short-link warning.', settings: { linkSafety: { shortUrlResolveAny: true } }, link: a('https://new-place.test/', 'New place'), href: 'https://new-place.test/', needles: () => [t('linkTooltipResolveButton')] },
  { name: 'dlg-short-resolved', how: 'menu', title: 'Link dialog: short link followed to a site never visited', note: 'Title "Unfamiliar site ahead", the shortener with its red "Short link" badge, then the real destination with its own badge.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://prize-winner.test/claim' } }, link: a('https://bit.ly/3dresol', 'bit.ly/3dresol'), href: 'https://bit.ly/3dresol', needles: () => [t('linkInterceptRealDestination')] },
  { name: 'dlg-short-to-familiar', how: 'menu', title: 'Link dialog: short link followed to a familiar site', note: 'Calm: info sign, "Link check", "Go to link" as the main button and no "Go back".', seed: KNOWN, settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://bank.test/statement' } }, link: a('https://bit.ly/3dfamil', 'bit.ly/3dfamil'), href: 'https://bit.ly/3dfamil', needles: () => [t('linkInterceptRealDestination')] },
  { name: 'dlg-short-chain', how: 'menu', title: 'Link dialog: short link with the full address and chain shown', note: 'Three hops, the full address, and the dialog at its widest.', settings: { linkSafety: { shortUrlMode: 'auto', shortUrlShowFullUrl: true, shortUrlTraceChain: true } }, fetch: { 'https://bit.ly/': { to: 'https://tinyurl.com/4kq7zv', body: '<meta http-equiv="refresh" content="0; url=https://prize-winner.test/claim?id=8812&ref=newsletter">' }, 'https://prize-winner.test/': {} }, link: a('https://bit.ly/3dchain', 'bit.ly/3dchain'), href: 'https://bit.ly/3dchain', needles: () => [t('linkInterceptRealDestination')] },
  { name: 'dlg-short-to-lookalike', how: 'menu', title: 'Link dialog: short link followed to a lookalike', note: 'The lookalike line and the mixed-alphabet marker inside "Real destination".', seed: { 'paypal.test': FAMILIAR }, settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://xn--pypal-4ve.test/login' } }, link: a('https://bit.ly/3dlooka', 'bit.ly/3dlooka'), href: 'https://bit.ly/3dlooka', needles: () => [t('linkInterceptRealDestination')] },
  { name: 'dlg-short-error', how: 'menu', title: 'Link dialog: short link that could not be followed', note: '"Couldn\'t find out where this link leads" and Retry. The title stays "Shortened link".', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { fail: true } }, link: a('https://bit.ly/3derror', 'bit.ly/3derror'), href: 'https://bit.ly/3derror', needles: () => [t('linkTooltipResolveError')] },
  { name: 'dlg-short-same-host', how: 'menu', title: 'Link dialog: short link that stays on the short-link site', note: 'A message that it may be broken, no Retry.', settings: { linkSafety: { shortUrlMode: 'auto' } }, fetch: { 'https://bit.ly/': { to: 'https://bit.ly/landing' } }, link: a('https://bit.ly/3dsameh', 'bit.ly/3dsameh'), href: 'https://bit.ly/3dsameh', needles: () => [t('linkTooltipResolveSameDomainShortener')] },
  {
    name: 'dlg-short-pressed-loading',
    how: 'menu',
    title: 'Link dialog: "Show real destination" pressed, still waiting',
    note: 'The default mode follows only when asked. "Following the link..." inside the button. The pending sign sits beside the text.',
    fetch: { 'https://bit.ly/': { hang: true } },
    link: a('https://bit.ly/3dpress', 'bit.ly/3dpress'),
    href: 'https://bit.ly/3dpress',
    needles: () => [t('linkTooltipResolveButton')],
    press: () => t('linkTooltipResolveButton'),
    after: () => [t('linkTooltipResolvingUrl')],
  },
  {
    name: 'dlg-once-resolved',
    how: 'menu',
    title: 'Link dialog: ordinary link checked for where it leads',
    note: '"Check where it leads" pressed, and it redirected. The destination and a "Mark as shortener" button.',
    fetch: { 'https://new-place.test/': { to: 'https://somewhere-else.test/landing' } },
    link: a('https://new-place.test/out', 'Out'),
    href: 'https://new-place.test/out',
    needles: () => [t('linkTooltipResolveOnce')],
    press: () => t('linkTooltipResolveOnce'),
    after: () => [t('linkInterceptRealDestination')],
  },
]

for (const c of DIALOGS) {
  test(c.title, async ({ page, shot }) => {
    await prepare(page, c)
    if (c.how === 'click') {
      await patchSettings(page.context(), { linkSafety: { tooltipTrigger: 'click-left' } })
      await openSite(page, SITE, linkPage(c.link))
      await page.locator('#l').click()
      await waitForUi(page, ...c.needles())
    }
    else {
      await menuCheck(page, c.link, c.href, c.needles())
    }
    await finish(page, c)
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [INTERCEPT, ...(c.name.includes('mismatch') ? [MISMATCH] : [])] })
  })
}

// ==========================================
// The paste dialog
// ==========================================

interface PasteCase extends Base {
  /** What is in the clipboard */
  clip: string
  /** The page pasted into, if not the usual unknown shop */
  site?: string
  reveal?: boolean
}

const PASTES: PasteCase[] = [
  { name: 'paste-url', title: 'Paste held: a web address', note: 'The kind of payload is named, "Web address", with its length.', clip: 'https://new-place.test/a/b?c=d', needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-email', title: 'Paste held: an email address', note: '"Email address".', clip: 'someone@example.test', needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-text', title: 'Paste held: ordinary text', note: '"Text".', clip: 'hello there, see you at five', needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-revealed', title: 'Paste held, contents shown', note: '"Show contents" pressed: the payload in a monospace box.', clip: 'correct-horse-battery-staple', reveal: true, needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-revealed-long', title: 'Paste held, 2000 characters shown', note: 'About 2000 characters over 54 lines. The preview stops at 300 characters and scrolls, and the length shown counts all of them.', clip: 'This is a long pasted document line.\n'.repeat(54), reveal: true, needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-some-visits', title: 'Paste held on a site seen a few times', note: 'Red "Unfamiliar site" badge rather than "Never visited".', site: 'https://low.test/', seed: { 'low.test': LOW }, clip: 'hello', needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-lookalike-site', title: 'Paste held on a lookalike of a known site', note: 'The page itself is northbank-secure.test. The lookalike line sits under its name.', site: 'https://northbank-secure.test/', seed: KNOWN, clip: 'my-password', needles: () => [t('pasteInterceptTitle')] },
  { name: 'paste-idn-site', title: 'Paste held on a site named in another alphabet', note: 'The page is пример.test. Its xn-- spelling is shown.', site: 'https://xn--e1afmkfd.test/', clip: 'my-password', needles: () => [t('pasteInterceptTitle')] },
]

for (const c of PASTES) {
  test(c.title, async ({ page, context, shot }) => {
    await prepare(page, c)
    await patchSettings(context, { blockPasteOnUnfamiliar: true })
    // Copied on a site the user knows. A write on the unfamiliar one would raise
    // the copy warning over the field.
    const source = 'https://password-manager.test/'
    await seed(context, { 'password-manager.test': FAMILIAR })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(source).origin })
    await openSite(page, source, sitePage('Password manager', ''))
    await page.evaluate(text => navigator.clipboard.writeText(text), c.clip)
    await openSite(page, c.site ?? SITE, sitePage('A form', '<p>Paste it here</p><textarea id="f" rows="3"></textarea>'))
    await page.locator('#f').click()
    await page.keyboard.press('ControlOrMeta+V')
    await waitForUi(page, ...c.needles())
    if (c.reveal)
      await clickUi(page, t('pasteInterceptReveal'))
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [PASTE] })
  })
}

const FRAME_PASTES: { name: string, title: string, note: string, status: 'unfamiliar' | 'settled' | 'error', needle: () => string }[] = [
  { name: 'paste-frame-unfamiliar', title: 'Paste held inside a frame from another site', note: 'A payment box loaded from pay.widget.test. A bold note says the box belongs to another site. No payload: it stays in the frame.', status: 'unfamiliar', needle: () => t('pasteInterceptInFrame') },
  { name: 'paste-frame-safe', title: 'Paste inside a frame, the page turned out familiar', note: 'Green check, "Familiar site", and a single "Got it".', status: 'settled', needle: () => t('pasteInterceptSafeTitle') },
  { name: 'paste-frame-error', title: 'Paste inside a frame, the page could not be checked', note: 'Grey dashed ring, "This site couldn\'t be checked", grey dot, no facts.', status: 'error', needle: () => t('pasteInterceptErrorTitle') },
]

for (const c of FRAME_PASTES) {
  test(c.title, async ({ page, context, shot }) => {
    await patchSettings(context, { blockPasteOnUnfamiliar: true })
    await openSite(page, SITE, sitePage('Checkout', '<p>Pay with the card form below.</p><div style="border:1px solid #ccc;height:120px;width:340px;padding:8px">a payment frame</div>'))
    await fromMenu(context, SITE, { type: 'frame-paste-intercept', data: { hostname: 'pay.widget.test', status: c.status } })
    await waitForUi(page, c.needle())
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [PASTE] })
  })
}

// ==========================================
// The check panel ("Check selection")
// ==========================================

interface PanelCase extends Base { text: string }

const panel = () => [t('checkPanelTitle')]

const PANELS: PanelCase[] = [
  { name: 'cp-never', title: 'Check panel: a domain never visited', note: 'Red "never visited", and a line that nothing is recorded.', text: 'new-place.test', needles: panel },
  { name: 'cp-some-visits', title: 'Check panel: a domain seen a few times', note: 'Red "Unfamiliar site" badge.', seed: { 'low.test': LOW }, text: 'low.test', needles: panel },
  { name: 'cp-untracked', title: 'Check panel: a name that is never counted', note: 'http://intranet/login has no dot. Grey "not counted" badge and a grey notice saying visits here are not counted.', text: 'http://intranet/login', needles: panel },
  { name: 'cp-mixed-script', title: 'Check panel: Cyrillic letter in a known name', note: 'bаnk.test with a Cyrillic а. The xn-- spelling, the mixed-alphabet marker and the lookalike line.', seed: KNOWN, text: 'bаnk.test', needles: panel },
  { name: 'cp-ascii-list', title: 'Check panel with names listed in their xn-- spelling', note: 'Setting "punycode list: ascii". Names shown as xn--, and the third toggle reads "P".', seed: { 'idn.test': FAMILIAR, 'xn--bcher-kva.idn.test': { visits: 6 } }, settings: { punycodeListMode: 'ascii' }, text: 'shop.idn.test', needles: panel },
  { name: 'cp-www', title: 'Check panel: the www. name of a known site', note: 'www.bank.test is kept as bank.test, so that row is highlighted.', seed: { 'bank.test': FAMILIAR, 'login.bank.test': { visits: 9 } }, text: 'www.bank.test', needles: panel },
  { name: 'cp-long-family', title: 'Check panel: a family of fifteen long names', note: 'The list scrolls and long names break.', seed: Object.fromEntries([['bank.test', FAMILIAR], ...Array.from({ length: 15 }, (_, i) => [`department-number-${i}-with-a-long-name.bank.test`, { visits: 30 - i }])]), text: 'bank.test', needles: panel },
  { name: 'cp-ip', title: 'Check panel: a bare IP address', note: 'The address itself as the base, with the numeric-address marker.', text: 'http://203.0.113.5/', needles: panel },
  { name: 'cp-markers', title: 'Check panel: an address full of warnings', note: 'A known name parked in front, four subdomain levels.', text: 'paypal.com.a.b.c.verify.test', needles: panel },
  { name: 'cp-email-gmail', title: 'Check panel: a gmail address', note: 'Grey "Public mail provider" badge with the mail sign, and where its mail is read, mail.google.com, with facts.', seed: { 'mail.google.com': FAMILIAR }, text: 'john.smith@gmail.com', needles: panel },
  { name: 'cp-email-disposable', title: 'Check panel: a throwaway address', note: 'Red badge and red notice.', text: 'refunds@mailinator.com', needles: panel },
  { name: 'cp-email-mailsite', title: 'Check panel: a company address whose mail is read elsewhere', note: 'Own mapping corp.test = webmail.corpmail.test. "Mail read on" rows for that site.', seed: { 'webmail.corpmail.test': FAMILIAR }, local: { customMailSites: ['corp.test = webmail.corpmail.test, mail.corp.test'] }, text: 'ann@corp.test', needles: panel },
  { name: 'cp-email-suspicious', title: 'Check panel: a well-known ending inside an address domain', note: 'x@paypal.com.evil.test. Red suspicious-domain line.', text: 'x@paypal.com.evil.test', needles: panel },
  { name: 'cp-email-local-unicode', title: 'Check panel: a Cyrillic letter before @', note: 'A red notice about unusual characters.', seed: KNOWN, text: 'jоhn@corp.test', needles: panel },
  { name: 'cp-highlight', title: 'Check panel, an address with digits', note: 'Digits are always bold in their own colour, readable on every ground they sit on. There is no button for it any more.', text: 'b4nk-01.test', needles: panel },
  { name: 'cp-upper', title: 'Check panel with names in capitals', note: 'Domain and account name both in capitals.', settings: { domainCase: 'upper', accountNameCase: 'upper' }, seed: KNOWN, text: 'John.Doe@corp.test', needles: panel },
  { name: 'cp-rule-any', title: 'Check panel under the rule "any one check"', note: 'Summary line in the family facts.', settings: { familiarity: { mode: 'any' } }, seed: { 'x-visits.test': { visits: 12, activeDays: 1, ageDays: 1 } }, text: 'x-visits.test', needles: panel },
  { name: 'cp-font-150', title: 'Check panel at 150% text', note: 'The panel scales with the popup text size.', settings: { popupFontSize: 150 }, seed: KNOWN, text: 'bank.test', needles: panel },
  {
    name: 'cp-email-caveat',
    title: 'Check panel: "what this check cannot tell you", unfolded',
    note: 'Any address check carries this folded note. Unfolded, it lists five paragraphs with links to VirusTotal and urlscan.',
    seed: KNOWN,
    text: 'ann@corp.test',
    needles: panel,
    press: () => t('emailCaveatTitle'),
  },
]

for (const c of PANELS) {
  test(c.title, async ({ page, shot }) => {
    await prepare(page, c)
    await checkSelection(page, c.text, c.needles())
    await finish(page, c)
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [PANEL] })
  })
}
