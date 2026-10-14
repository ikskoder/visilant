/**
 * The settings page, one section at a time, in the states that are hard to
 * reach by hand: every familiarity mode, the lists in each state a download can
 * leave them in, the import in each state it can be found in, the notes a
 * phone or a browser without menus gets, and the confirmation before a reset.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { expect, inWorker, patchSettings, SETTLED_IMPORT, test } from './fixtures'

// Evaluated inside the extension's service worker
declare const chrome: any

const OPTIONS = 'src/options/Options.vue'
const RESET = 'src/options/SectionReset.vue'
const NAV = 'src/options/SectionNav.vue'

const DAY = 24 * 60 * 60 * 1000
const SHORTENER_LIST = 'https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/master/list'
const PUBLIC_LIST = 'https://raw.githubusercontent.com/willwhite/freemail/master/data/free.txt'
const DISPOSABLE_LIST = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'

type Section = 'general' | 'familiarity' | 'display' | 'notifications' | 'tampering' | 'link-safety' | 'lookups' | 'email-lists' | 'data'

interface Case {
  name: string
  title: string
  note: string
  section: Section
  settings?: Record<string, unknown>
  /** Written into storage.local, after the reset */
  local?: (now: number) => Record<string, unknown>
  /** Changes to the finished import the profile starts with. `null` removes it. */
  importState?: Record<string, unknown> | null
  /** Runs on the page before anything of the extension's does */
  init?: () => void
  /** Done on the open page before the picture */
  act?: (page: Page) => Promise<void>
}

async function setLocal(context: BrowserContext, values: Record<string, unknown>) {
  await inWorker(context, async (v: any) => chrome.storage.local.set(v), values)
}

/** A record written before first-visit dates and active days were kept. */
const undated = (now: number, count: number) => ({ count, lastSeen: now - DAY, ignored: false })
const dated = (now: number, count: number, extra: Record<string, unknown> = {}) => ({ count, lastSeen: now - DAY, ignored: false, activeDays: Math.max(1, Math.round(count / 3)), firstSeen: now - 300 * DAY, ...extra })

function undatedRecords(now: number) {
  return {
    'old-forum.example.com': undated(now, 30),
    'old-shop.example.org': undated(now, 12),
    'old-news.example.net': undated(now, 54),
    'new-site.example.com': dated(now, 7, { activeDays: 3, firstSeen: now - 40 * DAY }),
  }
}

/** Hide a browser API from the page, before its scripts look for it. */
function hide(api: 'contextMenus' | 'history') {
  return () => {
    for (const ns of [(globalThis as any).chrome, (globalThis as any).browser]) {
      if (ns)
        Object.defineProperty(ns, api, { value: undefined, configurable: true })
    }
  }
}

const CASES: Case[] = [
  // ==========================================
  // Familiarity
  // ==========================================
  { name: 'opt-fam-any', section: 'familiarity', title: 'Familiarity: any one check is enough', note: 'The sentence under the mode explains that one passing check makes a site familiar.', settings: { familiarity: { mode: 'any' } } },
  { name: 'opt-fam-2of3', section: 'familiarity', title: 'Familiarity: at least 2 of 3 checks', note: 'A second row asks how many checks must pass, "2 / 3".', settings: { familiarity: { mode: 'atLeast', atLeast: 2 } } },
  { name: 'opt-fam-clamped', section: 'familiarity', title: 'Familiarity: "at least 5" stored with only two checks on', note: 'A stored number larger than the checks left on. The page should show 2 / 2, not 5.', settings: { familiarity: { mode: 'atLeast', atLeast: 5, age: { enabled: false, min: 10 } } } },
  { name: 'opt-fam-one-off', section: 'familiarity', title: 'Familiarity: one check switched off', note: 'The active-days card is greyed out and its number box disabled.', settings: { familiarity: { activeDays: { enabled: false, min: 5 } } } },
  { name: 'opt-fam-last-locked', section: 'familiarity', title: 'Familiarity: only visits left on', note: 'The last check cannot be switched off: its tick box is disabled, with a tooltip saying at least one check has to stay on.', settings: { familiarity: { activeDays: { enabled: false, min: 5 }, age: { enabled: false, min: 10 } } } },
  { name: 'opt-fam-compact-one-off', section: 'familiarity', title: 'Familiarity, compact page, one check off', note: 'With explanations turned off the checks become short sentences like "At least 10 visits".', settings: { verboseOptions: false, familiarity: { activeDays: { enabled: false, min: 5 } } } },
  { name: 'opt-fam-huge-thresholds', section: 'familiarity', title: 'Familiarity: extreme thresholds', note: '999999 visits and 100000 days in narrow number boxes. Look for numbers cut off or spilling out.', settings: { familiarity: { visits: { enabled: true, min: 999999 }, activeDays: { enabled: true, min: 1 }, age: { enabled: true, min: 100000 } } } },
  { name: 'opt-fam-coverage-import', section: 'familiarity', title: 'Familiarity: some sites have no dates, import can fix it', note: 'Records from before dates were kept, and the full import has not run. An amber box counts them and links to the history import.', local: undatedRecords, importState: { mode: 'quick', fullDoneAt: 0 } },
  { name: 'opt-fam-coverage-permanent', section: 'familiarity', title: 'Familiarity: some sites are older than the browser remembers', note: 'The same records after a complete import: the box explains that nothing more can be done, with no link.', local: undatedRecords },
  { name: 'opt-fam-coverage-never', section: 'familiarity', title: 'Familiarity: sites without dates, nothing ever imported', note: 'No import has ever run. The box offers the import.', local: undatedRecords, importState: null },

  // ==========================================
  // Display
  // ==========================================
  { name: 'opt-display-badge-off', section: 'display', title: 'Display: badge switched off', note: 'The choice of what the badge counts disappears.', settings: { showBadge: false } },
  { name: 'opt-display-one-check', section: 'display', title: 'Display: only one familiarity check on', note: 'With a single check there is nothing to choose between, so the badge choice is hidden.', settings: { familiarity: { activeDays: { enabled: false, min: 5 }, age: { enabled: false, min: 10 } } } },
  { name: 'opt-display-stale-badge', section: 'display', title: 'Display: badge set to a check that was switched off', note: 'Badge set to "days known" while that check is off. The box should fall back to "checks", not show empty.', settings: { badgeContent: 'age', familiarity: { age: { enabled: false, min: 10 } } } },
  {
    name: 'opt-display-android',
    section: 'display',
    title: 'Display: on Firefox for Android',
    note: 'The hint says the extension icon lives in the browser menu there, not on a toolbar.',
    init: () => {
      const answer = { os: 'android', arch: 'arm' }
      for (const ns of [(globalThis as any).chrome, (globalThis as any).browser]) {
        if (ns?.runtime) {
          ns.runtime.getPlatformInfo = (cb?: (v: unknown) => void) => {
            if (cb)
              return void setTimeout(() => cb(answer))
            return Promise.resolve(answer)
          }
        }
      }
    },
  },

  // ==========================================
  // Notifications
  // ==========================================
  { name: 'opt-notif-off', section: 'notifications', title: 'Notifications: warnings switched off', note: 'Everything about when and how to warn is gone. The silenced sites list stays.', settings: { showWarningNotification: false } },
  { name: 'opt-notif-input-only', section: 'notifications', title: 'Notifications: only typing warns', note: 'The paste guard toggle is shown, since it belongs to typing.', settings: { showInputWarning: true, showCopyWarning: false } },
  { name: 'opt-notif-copy-only', section: 'notifications', title: 'Notifications: only copying warns', note: 'The paste guard toggle is hidden.', settings: { showInputWarning: false, showCopyWarning: true } },
  { name: 'opt-notif-none', section: 'notifications', title: 'Notifications: neither typing nor copying (storage edited by hand)', note: 'No radio is selected. Only reachable by editing storage, here to see that the page does not break.', settings: { showInputWarning: false, showCopyWarning: false } },
  { name: 'opt-notif-both-styles', section: 'notifications', title: 'Notifications: browser and in-page both', note: '"Both" is selected.', settings: { notificationStyle: 'both', autoUnsilenceFamiliar: true } },
  {
    name: 'opt-notif-silenced',
    section: 'notifications',
    title: 'Notifications: silenced sites, one of them familiar by now',
    note: 'The list of sites whose warnings were turned off, and under it a note that one of them is familiar now, with a button to take it off the list.',
    local: now => ({
      'bank-lookalike.test': dated(now, 2, { ignored: true, firstSeen: now - 3 * DAY, activeDays: 1 }),
      'shop.example.org': dated(now, 4, { ignored: true, firstSeen: now - 9 * DAY, activeDays: 2 }),
      'mail.example.com': dated(now, 50, { ignored: true, activeDays: 20, firstSeen: now - 200 * DAY }),
    }),
  },
  {
    name: 'opt-notif-silenced-many',
    section: 'notifications',
    title: 'Notifications: 200 silenced sites',
    note: 'The list should stay a fixed height and scroll.',
    local: now => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`silenced-site-${String(i).padStart(3, '0')}.example.com`, dated(now, 2, { ignored: true, firstSeen: now - 3 * DAY, activeDays: 1 })])),
  },
  {
    name: 'opt-notif-silenced-rejected',
    section: 'notifications',
    title: 'Notifications: names typed into the silenced list that are not sites',
    note: 'After typing "not a host!" and a URL into the list, an amber line says they were not saved.',
    local: now => ({ 'shop.example.org': dated(now, 4, { ignored: true, firstSeen: now - 9 * DAY, activeDays: 2 }) }),
    act: async (page) => {
      const box = page.locator('#section-notifications textarea').first()
      await box.click()
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.type('\nnot a host!\nhttp://x/y')
      await page.locator('#section-notifications h2, #section-notifications h3').first().click()
    },
  },

  // ==========================================
  // Anti-tampering
  // ==========================================
  { name: 'opt-tamper-list', section: 'tampering', title: 'Anti-tampering: sites excluded, one with a very long name', note: 'The long line should scroll sideways inside the box, not stretch the page.', settings: { antiTamperingExcludedDomains: 'example.com\nbank.example.org\nvery-long-subdomain.of.some-really-long-domain-name.example.co.uk' } },

  // ==========================================
  // Link safety
  // ==========================================
  { name: 'opt-ls-off', section: 'link-safety', title: 'Link check switched off', note: 'Only the main switch is left.', settings: { linkSafety: { enabled: false } } },
  { name: 'opt-ls-blacklist', section: 'link-safety', title: 'Link check: everywhere except listed sites', note: 'The list of sites where links are not checked.', settings: { linkSafety: { scopeMode: 'blacklist', scopeDomains: 'ads.example\ntracker.test' } } },
  { name: 'opt-ls-whitelist-empty', section: 'link-safety', title: 'Link check: only on listed sites, list empty', note: 'Nothing is listed yet, so the box shows its placeholder.', settings: { linkSafety: { scopeMode: 'whitelist', scopeDomains: '' } } },
  { name: 'opt-ls-click-left', section: 'link-safety', title: 'Link check on click', note: 'The hover delay slider is gone, since only hovering uses it.', settings: { linkSafety: { tooltipTrigger: 'click-left' } } },
  { name: 'opt-ls-hover-instant', section: 'link-safety', title: 'Link check on hover, no delay', note: 'The delay reads "instantly".', settings: { linkSafety: { tooltipTrigger: 'hover', hoverDelay: 0 } } },
  { name: 'opt-ls-hover-odd', section: 'link-safety', title: 'Link check on hover, delay off the slider steps', note: 'A delay of 1234 ms, which no slider step lands on: the label should still read sensibly.', settings: { linkSafety: { tooltipTrigger: 'hover', hoverDelay: 1234 } } },
  { name: 'opt-ls-no-menus', section: 'link-safety', title: 'Link check in a browser without context menus', note: 'As in Firefox for Android: right-click is dimmed with a reason, and a note explains the long-press menu cannot be used.', settings: { linkSafety: { tooltipTrigger: 'click-right' } }, init: hide('contextMenus') },
  { name: 'opt-ls-count-never', section: 'link-safety', title: 'Link check: never show visit counts', note: 'The "never" choice for showing the count is selected.', settings: { linkSafety: { showVisitCount: 'never' } } },
  { name: 'opt-ls-short-off', section: 'link-safety', title: 'Short links: not followed at all', note: 'Every short-link option underneath disappears.', settings: { linkSafety: { shortUrlMode: 'off' } } },
  { name: 'opt-ls-short-all', section: 'link-safety', title: 'Short links: every option on, own list filled', note: 'Follow any link, show the full address and the chain, plus a custom shortener list.', settings: { linkSafety: { shortUrlMode: 'auto', shortUrlResolveAny: true, shortUrlShowFullUrl: true, shortUrlTraceChain: true } }, local: () => ({ customShorteners: ['short.test', 'go.example.com'] }) },
  { name: 'opt-ls-short-no-url', section: 'link-safety', title: 'Short links: list address removed', note: 'With no source address the "Update now" button is disabled.', settings: { linkSafety: { shortUrlListUpdateUrl: '' } } },
  { name: 'opt-ls-list-cached', section: 'link-safety', title: 'Short links: a list downloaded earlier', note: 'A grey line says how many domains were loaded and when.', local: () => ({ remoteShortenerDomains: { domains: ['a.test', 'b.test', 'c.test'], updatedAt: Date.UTC(2026, 0, 10), urls: [SHORTENER_LIST] } }) },
  {
    name: 'opt-ls-list-success',
    section: 'link-safety',
    title: 'Short links: list just updated',
    note: 'After pressing "Update now": a green line with the count.',
    act: async (page) => {
      await page.route(SHORTENER_LIST, route => route.fulfill({ status: 200, body: 'a.test\nb.test\nc.test\n' }))
      await page.locator('#section-link-safety button', { hasText: 'Update now' }).click()
    },
  },
  {
    name: 'opt-ls-list-error',
    section: 'link-safety',
    title: 'Short links: list could not be downloaded',
    note: 'After pressing "Update now" with the source unreachable: a red line.',
    act: async (page) => {
      await page.route(SHORTENER_LIST, route => route.abort())
      await page.locator('#section-link-safety button', { hasText: 'Update now' }).click()
    },
  },
  {
    name: 'opt-ls-list-partial',
    section: 'link-safety',
    title: 'Short links: one of two sources failed',
    note: 'An amber line: loaded from one source, one failed.',
    settings: { linkSafety: { shortUrlListUpdateUrl: `${SHORTENER_LIST}\nhttps://lists.example.test/short.txt` } },
    act: async (page) => {
      await page.route(SHORTENER_LIST, route => route.fulfill({ status: 200, body: 'a.test\nb.test\n' }))
      await page.route('https://lists.example.test/**', route => route.abort())
      await page.locator('#section-link-safety button', { hasText: 'Update now' }).click()
    },
  },
  {
    name: 'opt-ls-list-loading',
    section: 'link-safety',
    title: 'Short links: list still downloading',
    note: 'The source never answers. The button should be disabled while it waits.',
    act: async (page) => {
      await page.route(SHORTENER_LIST, () => {})
      await page.locator('#section-link-safety button', { hasText: 'Update now' }).click()
    },
  },

  // ==========================================
  // Lookups
  // ==========================================
  { name: 'opt-lookups-empty', section: 'lookups', title: 'Lookup links: all removed', note: 'Empty box. The reset button in the corner is active.', settings: { lookupServices: '' } },
  { name: 'opt-lookups-custom', section: 'lookups', title: 'Lookup links: own entries, one malformed, one very long', note: 'There is no error message for a malformed line, it is only shown as typed.', settings: { lookupServices: 'My WHOIS | https://whois.example/{domain}\nBroken line without pipe\nVery long one | https://a-really-long-lookup-service-name.example.com/search/by/domain/name/{domain}?format=full&lang=en' } },

  // ==========================================
  // Email lists
  // ==========================================
  { name: 'opt-email-custom', section: 'email-lists', title: 'Email lists: own entries in every box', note: 'Own public services, disposable domains and mail sites. One mail-site line is malformed.', local: () => ({ customPublicEmailProviders: ['mail.corp.test'], customDisposableEmailDomains: ['trash.test', 'tmp.test'], customMailSites: ['corp.test = webmail.corp.test', 'bad line no equals'] }) },
  { name: 'opt-email-cached', section: 'email-lists', title: 'Email lists: all three downloaded earlier', note: 'Three grey lines with counts and dates.', settings: { mailSiteListUrl: 'https://lists.example.test/mail-sites.txt' }, local: () => ({ remotePublicEmailProviders: { domains: ['a.test', 'b.test'], updatedAt: Date.UTC(2026, 0, 10), urls: [PUBLIC_LIST] }, remoteDisposableEmailDomains: { domains: ['x.test', 'y.test', 'z.test'], updatedAt: Date.UTC(2026, 0, 11), urls: [DISPOSABLE_LIST] }, remoteMailSites: { domains: ['corp.test = webmail.corp.test'], updatedAt: Date.UTC(2026, 0, 12), urls: ['https://lists.example.test/mail-sites.txt'] } }) },
  {
    name: 'opt-email-mixed',
    section: 'email-lists',
    title: 'Email lists: one updated, one failed',
    note: 'Public services updated (green), disposable failed (red), side by side.',
    act: async (page) => {
      await page.route(PUBLIC_LIST, route => route.fulfill({ status: 200, body: 'a.test\nb.test\n' }))
      await page.route(DISPOSABLE_LIST, route => route.fulfill({ status: 404, body: '' }))
      const buttons = page.locator('#section-email-lists button', { hasText: 'Update now' })
      await buttons.nth(0).click()
      await buttons.nth(1).click()
    },
  },
  { name: 'opt-email-no-urls', section: 'email-lists', title: 'Email lists: source addresses cleared', note: 'Both update buttons disabled.', settings: { publicEmailListUrl: '', disposableEmailListUrl: '' } },

  // ==========================================
  // Your data: the history import as the page finds it
  // ==========================================
  { name: 'opt-data-never', section: 'data', title: 'Your data: nothing imported yet', note: 'Grey dot, the button reads "Import history", and there is no "last import" line.', importState: null },
  { name: 'opt-data-running', section: 'data', title: 'Your data: an import is running in the background', note: 'Blue dot. No progress bar, since that only appears for an import started from this page.', importState: { status: 'running', mode: 'quick', phase: 'reading', current: 0, total: 0, finishedAt: 0, domains: 0 } },
  { name: 'opt-data-interrupted', section: 'data', title: 'Your data: an import that was cut short', note: 'Its last sign of life was five minutes ago. Amber dot.', importState: { status: 'running', finishedAt: 0, updatedAt: -5 * 60 * 1000 } },
  { name: 'opt-data-partial', section: 'data', title: 'Your data: visit counts in, dates missing', note: 'The quick pass finished, the full one did not. Amber dot and the last import line.', importState: { mode: 'quick', fullDoneAt: 0 } },
  { name: 'opt-data-cancelled', section: 'data', title: 'Your data: import stopped by the user', note: 'Amber dot, "The import was stopped".', importState: { status: 'cancelled', mode: 'full', fullDoneAt: 0, domains: 150 } },
  { name: 'opt-data-failed', section: 'data', title: 'Your data: import failed', note: 'Red dot, no last import line.', importState: { status: 'failed', domains: 0 } },
  { name: 'opt-data-huge', section: 'data', title: 'Your data: a very large history', note: '1,234,567 sites in the last import line.', importState: { domains: 1234567, visits: 98765432 } },
  { name: 'opt-data-no-history', section: 'data', title: 'Your data: a browser that cannot read history', note: 'As in Firefox for Android: the import button and its explanation are gone, and an amber line says why.', init: hide('history') },
  {
    name: 'opt-data-ticked',
    section: 'data',
    title: 'Your data: both reset boxes ticked',
    note: 'The red reset button becomes active.',
    act: async (page) => {
      for (const box of await page.locator('#section-data input[type="checkbox"]').all())
        await box.check()
    },
  },
]

for (const c of CASES) {
  test(c.title, async ({ context, extensionId, shot }) => {
    if (c.settings)
      await patchSettings(context, c.settings)
    const now = Date.now()
    if (c.local)
      await setLocal(context, c.local(now))
    if (c.importState === null) {
      await inWorker(context, async () => chrome.storage.local.remove('__visilantHistoryImport'))
    }
    else if (c.importState) {
      // A negative `updatedAt` is that long before now
      const patch = { ...c.importState }
      if (typeof patch.updatedAt === 'number' && patch.updatedAt < 0)
        patch.updatedAt = now + patch.updatedAt
      else if (patch.status === 'running')
        patch.updatedAt = now
      await setLocal(context, { __visilantHistoryImport: { ...SETTLED_IMPORT, ...patch } })
    }
    const page = await context.newPage()
    if (c.init)
      await page.addInitScript(c.init)
    await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
    const section = page.locator(`#section-${c.section}`)
    await expect(section).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(600)
    if (c.act) {
      await section.scrollIntoViewIfNeeded()
      await c.act(page)
      await page.waitForTimeout(800)
    }
    await shot(page, { name: c.name, title: c.title, note: c.note, covers: [OPTIONS, RESET] }, { clip: `#section-${c.section}` })
  })
}

// ==========================================
// Whole-page states
// ==========================================

test('Settings: every section at its defaults', async ({ context, extensionId, shot }) => {
  await patchSettings(context, { theme: 'system' })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.locator('#section-general')).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(600)
  await shot(page, { name: 'opt-all-defaults', title: 'Settings: every section at its defaults', note: 'Theme left on "system", so nothing differs from the defaults: the reset buttons in the top corners of the cards should all be faint. The top of the page only.', covers: [OPTIONS, RESET] })
})

test('Settings: the reset confirmation', async ({ context, extensionId, shot }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.locator('#section-data')).toBeVisible({ timeout: 10000 })
  for (const box of await page.locator('#section-data input[type="checkbox"]').all())
    await box.check()
  await page.locator('#section-data button', { hasText: 'Reset selected data' }).click()
  await expect(page.locator('text=Confirm reset')).toBeVisible({ timeout: 5000 })
  await shot(page, { name: 'opt-reset-confirm', title: 'Settings: "are you sure" before wiping data', note: 'The only reset that asks first. Both things to be wiped are listed, with a warning that it cannot be undone.', covers: [OPTIONS] })
})

test('Settings: contents scrolled to the middle', async ({ context, extensionId, shot }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.locator('#section-link-safety')).toBeVisible({ timeout: 10000 })
  await page.locator('#section-link-safety').evaluate(el => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(700)
  await shot(page, { name: 'opt-nav-middle', title: 'Settings: the contents follow the scroll', note: 'Scrolled to the link check. On a wide screen the contents on the left highlight it, on a narrower one they sit above the settings.', covers: [OPTIONS, NAV] })
})

test('Settings: a change the browser refused to save', async ({ context, extensionId, shot }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.locator('#section-lookups')).toBeVisible({ timeout: 10000 })
  // Sync storage takes at most 8 KB per item, and the settings are one item
  const box = page.locator('#section-lookups textarea').first()
  await box.fill(`Huge | https://example.test/{domain}\n${'x'.repeat(9000)}`)
  await box.blur()
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await shot(page, { name: 'opt-write-error', title: 'Settings: a change the browser refused to save', note: 'Over 8 KB pasted into the lookup links, more than the browser lets one setting hold. A red banner at the top should say the change was not saved.', covers: [OPTIONS] })
})
