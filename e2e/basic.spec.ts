import { expect, test } from './fixtures'
import { blankPage, inWorker, patchSettings, seedVisits, serveSite, waitForAutoImport } from './helpers'

// Evaluated inside the extension's own worker, where the namespace exists
declare const chrome: any

// Made-up hostnames served by the test itself. Nothing here touches the network:
// a real site can go down, change its markup or – worse – quietly become a site
// the profile has visited, which is the one thing several of these tests need to
// stay in control of.
const SITE_URL = 'https://tracked-site.test/'
const SITE_HOST = 'tracked-site.test'
const SUBDOMAIN_URL = 'https://shop.tracked-site.test/'

// ==========================================
// Popup – basic loading
// ==========================================

test('popup page loads and shows logo', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await expect(page.locator('img, svg, .logo, [class*="logo"]').first()).toBeVisible({ timeout: 5000 })
})

test('popup shows "visit a website" placeholder when no tab context', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await expect(page.locator('text=🌍')).toBeVisible({ timeout: 5000 })
})

test('popup has settings button', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await expect(page.locator('button[title="Settings"]')).toBeAttached({ timeout: 5000 })
})

// ==========================================
// Popup – domain display
// ==========================================

test('popup shows domain in standalone mode', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=google.com`)
  await page.waitForTimeout(1000)
  await expect(page.locator('text=google.com').first()).toBeVisible({ timeout: 5000 })
})

test('popup shows visit count for domain', async ({ page, extensionId, context }) => {
  await seedVisits(context, SITE_HOST, 3)

  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await page.waitForTimeout(1000)
  await expect(page.locator(`text=${SITE_HOST}`).first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.font-mono').filter({ hasText: /^3$/ }).first()).toBeAttached({ timeout: 5000 })
})

test('popup shows "no visit data" for unvisited domain', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=never-visited-domain-12345.com`)
  await page.waitForTimeout(1000)
  // Should show the "no visit data" message since no related domains exist
  const domainList = page.locator('.overflow-y-auto')
  await expect(domainList).not.toBeAttached({ timeout: 3000 })
})

// ==========================================
// Popup – font size controls
// ==========================================

test('popup font size increase/decrease buttons work', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await page.waitForTimeout(1000)

  // Find font size display
  const fontSizeDisplay = page.locator('text=100%').first()
  await expect(fontSizeDisplay).toBeAttached({ timeout: 5000 })

  // Click increase button (A+)
  await page.locator('button[title="Increase font size"]').click()
  await expect(page.locator('text=110%').first()).toBeAttached({ timeout: 3000 })

  // Click decrease button (A-)
  await page.locator('button[title="Decrease font size"]').click()
  await expect(page.locator('text=100%').first()).toBeAttached({ timeout: 3000 })
})

// ==========================================
// Popup – sort controls
// ==========================================

test('popup sort controls are visible for domain with data', async ({ page, extensionId, context }) => {
  await seedVisits(context, SITE_HOST, 2)

  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await page.waitForTimeout(1000)

  // Sort order toggle button (↑ or ↓)
  const sortToggle = page.locator('button:has-text("↑"), button:has-text("↓")')
  await expect(sortToggle.first()).toBeAttached({ timeout: 5000 })

  // Highlighting toggle (🌈)
  await expect(page.locator('button:has-text("🌈")')).toBeAttached({ timeout: 3000 })
})

// ==========================================
// Options page – loading & sections
// ==========================================

test('options page loads with logo and settings title', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // The logo is drawn into the page rather than loaded as an image, so that the
  // theme can repaint the wordmark
  await expect(page.locator('[role="img"][aria-label]').first()).toBeVisible({ timeout: 5000 })
})

test('options page has safety threshold input', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  const thresholdInput = page.locator('input[type="number"]').first()
  await expect(thresholdInput).toBeVisible({ timeout: 5000 })
  // Default threshold should be 10
  await expect(thresholdInput).toHaveValue('10')
})

// ==========================================
// Options page – toggle switches
// ==========================================

test('options page has display setting toggles', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Dynamic icon and show badge toggles. Counted by polling rather than once:
  // a bare count races the page's own render and reads zero when it wins
  const checkboxes = page.locator('input[type="checkbox"]')
  // At least dynamic icon + show badge + warning notification + link safety
  await expect.poll(() => checkboxes.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(4)
})

test('safety threshold can be changed', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  const thresholdInput = page.locator('input[type="number"]').first()
  await thresholdInput.fill('20')
  await expect(thresholdInput).toHaveValue('20')
})

// ==========================================
// Options page – notification settings
// ==========================================

test('notification settings expand when toggle is on', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Warning notification toggle – find the one that controls showWarningNotification
  // Radio buttons for warning type should be visible when notifications are enabled
  const radioButtons = page.locator('input[type="radio"][name="warningType"]')

  // If notifications are enabled by default, radios should exist
  if (await radioButtons.count() > 0) {
    await expect(radioButtons.first()).toBeAttached()
  }
})

// ==========================================
// Options page – link safety settings
// ==========================================

test('link safety section has master toggle', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Found by content rather than by position: the sections have been reordered
  // before and an index makes this assert whichever card happens to sit there
  const linkSafetyCard = page.locator('.bg-white.rounded-lg.shadow')
    .filter({ has: page.locator('input[type="radio"][value="hover"]') })
  const linkSafetyCheckboxes = linkSafetyCard.locator('input[type="checkbox"]')
  expect(await linkSafetyCheckboxes.count()).toBeGreaterThanOrEqual(1)
})

test('link safety tooltip trigger radio buttons', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Hover and click-left radio buttons for tooltip trigger
  const hoverRadio = page.locator('input[type="radio"][value="hover"]')
  const clickRadio = page.locator('input[type="radio"][value="click-left"]')

  if (await hoverRadio.isVisible()) {
    await expect(hoverRadio).toBeAttached()
    await expect(clickRadio).toBeAttached()
  }
})

test('link safety scope mode radio buttons', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Scope mode: everywhere, whitelist, blacklist
  const everywhereRadio = page.locator('input[type="radio"][value="everywhere"]')
  if (await everywhereRadio.isVisible()) {
    await expect(everywhereRadio).toBeAttached()
    await expect(page.locator('input[type="radio"][value="whitelist"]')).toBeAttached()
    await expect(page.locator('input[type="radio"][value="blacklist"]')).toBeAttached()
  }
})

test('scope domain list appears when whitelist selected', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Select whitelist mode
  const whitelistRadio = page.locator('input[type="radio"][value="whitelist"]')
  if (await whitelistRadio.isVisible()) {
    await whitelistRadio.click()
    // Domain list textarea should now be visible
    const textarea = page.locator('textarea').last()
    await expect(textarea).toBeVisible({ timeout: 3000 })
  }
})

// ==========================================
// Options page – database management
// ==========================================

// Buttons are found by their wording rather than by a colour class: the styling
// moved into `btn-primary` / `btn-danger` utilities once and would do so again

test('options page offers one history import and says it already ran', async ({ page, extensionId, context }) => {
  // Every line below is about an import that has finished, so waiting for it is
  // the test, not setup. A fixed pause only ever passed on a fast machine.
  await waitForAutoImport(context)
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // One button, which runs both passes in turn. Two of them only asked the user
  // to answer a question about browser APIs
  await expect(page.locator('button', { hasText: 'Re-import history' })).toBeVisible({ timeout: 5000 })
  await expect(page.locator('#section-data button')).toHaveCount(2)
  // The automatic import means these buttons are a re-run, not setup that was missed
  await expect(page.locator('text=imported automatically when Visilant was installed')).toBeVisible()
})

test('options page has reset data section with checkboxes', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  const resetButton = page.locator('button', { hasText: 'Reset selected data' })
  await expect(resetButton).toBeVisible({ timeout: 5000 })
  // Nothing is ticked, so there is nothing to reset
  await expect(resetButton).toBeDisabled()
})

test('reset asks before it wipes, and only for what was ticked', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  const resetButton = page.locator('button', { hasText: 'Reset selected data' })
  await expect(resetButton).toBeDisabled()

  await page.locator('label', { hasText: 'All information about site visits' })
    .locator('input[type="checkbox"]')
    .check()
  await expect(resetButton).toBeEnabled()

  // Destructive and irreversible, so it goes through a confirmation that lists
  // exactly what was picked
  await resetButton.click()
  await expect(page.locator('text=Confirm reset')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('li', { hasText: 'All information about site visits' })).toBeVisible()
  await expect(page.locator('li', { hasText: 'All settings' })).toHaveCount(0)

  await page.locator('button', { hasText: 'Cancel' }).click()
  await expect(page.locator('text=Confirm reset')).toHaveCount(0)
})

// ==========================================
// Options page – anti-tampering
// ==========================================

test('anti-tampering excluded domains textarea exists', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Anti-tampering textarea, scoped to its own card – other sections have
  // example.com in a placeholder too
  const textarea = page.locator('#section-tampering textarea')
  await expect(textarea).toBeVisible({ timeout: 5000 })
})

// ==========================================
// Service worker
// ==========================================

test('extension registers service worker', async ({ context }) => {
  let workers = context.serviceWorkers()
  if (workers.length === 0)
    await context.waitForEvent('serviceworker', { timeout: 5000 })
  workers = context.serviceWorkers()
  expect(workers.length).toBeGreaterThan(0)
})

// ==========================================
// Content script – visit tracking
// ==========================================

test('visiting a page tracks the domain', async ({ page, extensionId, context }) => {
  // A real navigation, because the navigation is what is under test here
  await serveSite(page, SITE_URL)
  await page.waitForTimeout(2000)

  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popupPage.waitForTimeout(1000)
  await expect(popupPage.locator(`text=${SITE_HOST}`).first()).toBeVisible({ timeout: 5000 })
  // Counted once, rather than merely displayed
  await expect(popupPage.locator('.font-mono').filter({ hasText: /^1$/ }).first()).toBeAttached({ timeout: 5000 })
  await popupPage.close()
})

test('visiting multiple subdomains shows domain family', async ({ page, extensionId, context }) => {
  await serveSite(page, SITE_URL)
  await page.waitForTimeout(2000)
  // The subdomain is served too, so it is a visit rather than a hope that the
  // real www host resolves – which is what the old `.catch(() => {})` was for
  await serveSite(page, SUBDOMAIN_URL)
  await page.waitForTimeout(2000)

  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popupPage.waitForTimeout(1000)
  await expect(popupPage.locator(`text=${SITE_HOST}`).first()).toBeVisible({ timeout: 5000 })
  // Both members of the family are listed, not just the one asked for
  await expect(popupPage.locator(`text=shop.${SITE_HOST}`).first()).toBeVisible({ timeout: 5000 })
  await popupPage.close()
})

// ==========================================
// Content script – link safety tooltip on hover
// ==========================================

test('link tooltip appears on hover over external link', async ({ page }) => {
  // The link is part of the fixture rather than injected into someone else's
  // markup, which cannot end up underneath whatever that site renders
  await serveSite(page, SITE_URL, blankPage('links', `
    <a id="test-external-link" href="https://some-unknown-domain-test.com"
       style="position:fixed;top:50px;left:50px;font-size:20px;z-index:9999">External Link</a>
  `))
  await page.waitForTimeout(2000)

  // Hover over the link
  await page.locator('#test-external-link').hover()
  await page.waitForTimeout(500) // debounce is 300ms

  // Tooltip should appear (in shadow DOM – check for the container being added)
  // The tooltip is rendered inside a shadow root, so we check the host element
  const tooltipHost = page.locator('body > div[style*="z-index"]')
  // Give extra time for the tooltip to render
  await page.waitForTimeout(1000)
  await expect(tooltipHost.first()).toBeAttached({ timeout: 5000 })
})

// ==========================================
// Popup – anti-tampering status
// ==========================================

test('popup shows anti-tampering status for domain', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await page.waitForTimeout(1000)

  // Green dot (protected) or amber dot should be visible
  const statusDot = page.locator('.bg-green-500, .bg-amber-400')
  await expect(statusDot.first()).toBeAttached({ timeout: 5000 })
})

test('popup can toggle anti-tampering for domain', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await page.waitForTimeout(1000)

  // Should show green dot (protected by default)
  await expect(page.locator('.bg-green-500').first()).toBeAttached({ timeout: 5000 })

  // Click the toggle button (disable protection)
  const toggleButton = page.locator('button.text-blue-500').first()
  await toggleButton.click()
  await page.waitForTimeout(500)

  // Should now show amber dot (not protected)
  await expect(page.locator('.bg-amber-400').first()).toBeAttached({ timeout: 3000 })

  // Toggle back
  await toggleButton.click()
  await page.waitForTimeout(500)
  await expect(page.locator('.bg-green-500').first()).toBeAttached({ timeout: 3000 })
})

// ==========================================
// Options – settings persistence
// ==========================================

test('safety threshold persists after page reload', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  const thresholdInput = page.locator('input[type="number"]').first()
  await thresholdInput.fill('25')
  await page.waitForTimeout(500)

  // Reload and check
  await page.reload()
  await page.waitForTimeout(1000)
  await expect(page.locator('input[type="number"]').first()).toHaveValue('25')

  // Reset back to default
  await page.locator('input[type="number"]').first().fill('10')
})

// ==========================================
// Cross-component: threshold affects popup colors
// ==========================================

test('changing safety threshold in options affects visit count color in popup', async ({ page, extensionId, context }) => {
  await seedVisits(context, SITE_HOST, 1)

  // Set threshold to 1 in options (count 1 >= 1, so green)
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)
  await page.locator('input[type="number"]').first().fill('1')
  await page.waitForTimeout(500)

  // Open popup – count should be green (safe)
  let popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popup.waitForTimeout(1500)
  await expect(popup.locator('.text-green-600').first()).toBeAttached({ timeout: 5000 })
  await popup.close()

  // Now set threshold to 999 (count 1 < 999, so red)
  await page.locator('input[type="number"]').first().fill('999')
  await page.waitForTimeout(500)

  popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popup.waitForTimeout(1500)
  await expect(popup.locator('.text-red-500').first()).toBeAttached({ timeout: 5000 })
  await popup.close()

  // Reset threshold
  await page.locator('input[type="number"]').first().fill('10')
  await page.waitForTimeout(500)
})

// ==========================================
// Cross-component: anti-tampering exclusion syncs between popup and options
// ==========================================

test('excluding domain in popup appears in options anti-tampering textarea', async ({ page, extensionId, context }) => {
  // Disable anti-tampering for the site in the popup
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popup.waitForTimeout(1500)

  // Click disable button
  const toggleBtn = popup.locator('button.text-blue-500').first()
  await toggleBtn.click()
  await popup.waitForTimeout(500)
  await expect(popup.locator('.bg-amber-400').first()).toBeAttached({ timeout: 3000 })
  await popup.close()

  // Open options – the anti-tampering textarea should list it
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const tamperingTextarea = page.locator('#section-tampering textarea')
  await expect(tamperingTextarea).toHaveValue(new RegExp(SITE_HOST.replace('.', '\\.')), { timeout: 5000 })

  // Clear it to reset
  await tamperingTextarea.fill('')
  await page.waitForTimeout(500)
})

// ==========================================
// Content script: input warning on unfamiliar site
// ==========================================

test('typing on unfamiliar site shows in-page warning', async ({ page, extensionId }) => {
  // Set notification style to in-page in options first
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  // Make sure notifications are enabled and set to in-page
  const notifRadio = page.locator('input[type="radio"][value="in-page"]')
  if (await notifRadio.isVisible())
    await notifRadio.click()
  await page.waitForTimeout(500)

  // Visit an unfamiliar site (threshold is 10, first visit = count 1)
  await serveSite(page, SITE_URL)
  await page.waitForTimeout(2000)

  // Type something on the page
  await page.keyboard.press('a')
  await page.waitForTimeout(1500)

  // Warning container should appear in the DOM (inside shadow root)
  // The content script mounts a container with max z-index
  const warningContainer = page.locator('body > div[style*="2147483647"]')
  await expect(warningContainer.first()).toBeAttached({ timeout: 5000 })
})

// ==========================================
// Content script: link intercept on unfamiliar domain click
// ==========================================

// ==========================================
// Content script: domain mismatch in link text vs href
// ==========================================

test('link with mismatched text domain triggers tooltip warning', async ({ page }) => {
  // Reads as google.com, goes somewhere else entirely
  await serveSite(page, SITE_URL, blankPage('phish', `
    <a id="test-mismatch-link" href="https://evil-phishing-site.com/login"
       style="position:fixed;top:150px;left:50px;font-size:20px;z-index:9999;background:white;padding:10px">https://google.com/login</a>
  `))
  await page.waitForTimeout(2000)

  // Hover over the mismatched link
  await page.locator('#test-mismatch-link').hover()
  await page.waitForTimeout(1500) // debounce 300ms + render

  // Tooltip should appear with mismatch warning
  const tooltipHost = page.locator('body > div[style*="2147483647"]')
  await expect(tooltipHost.first()).toBeAttached({ timeout: 5000 })
})

// ==========================================
// Popup: font size persists across navigations
// ==========================================

test('popup font size setting persists', async ({ page, extensionId, context }) => {
  // Open popup and change font size
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await page.waitForTimeout(1000)

  // Increase font twice: 100% → 120%
  await page.locator('button[title="Increase font size"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title="Increase font size"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator('text=120%').first()).toBeAttached({ timeout: 3000 })

  // Open popup in new tab – should still be 120%
  const popup2 = await context.newPage()
  await popup2.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popup2.waitForTimeout(1000)
  await expect(popup2.locator('text=120%').first()).toBeAttached({ timeout: 5000 })
  await popup2.close()

  // Reset font size back to 100%
  await page.locator('button[title="Decrease font size"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title="Decrease font size"]').click()
})

// ==========================================
// Options page – alignment and contents
// ==========================================

test('every explanatory text on the options page starts at the same left edge', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  // The page centres two things on purpose – its own title and the heading of
  // each section – and everything else reads down a single left edge. It used
  // to be the other way round, with each block opting out of centring, which is
  // how three descriptions ended up centred without anyone meaning it.
  const centred = await page.evaluate(() => {
    const out: string[] = []
    document.querySelectorAll('p, label, li, h3, span').forEach((el) => {
      const own = Array.from(el.childNodes)
        .filter(node => node.nodeType === 3 && (node.textContent || '').trim())
        .map(node => (node.textContent || '').trim())
        .join(' ')
      if (own.length < 4)
        return
      if (getComputedStyle(el).textAlign === 'center')
        out.push(own.slice(0, 40))
    })
    return out
  })

  expect(centred).toEqual([])
})

test('the options page has contents that scroll to a section', async ({ page, extensionId }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const nav = page.locator('nav').last()
  await expect(nav.locator('a')).toHaveCount(9)
  await expect(nav.locator('a').first()).toHaveText('General')

  // Clicking is handled in script rather than by the link: fragment navigation
  // does nothing at all on an extension page
  await nav.locator('a[href="#section-data"]').click()
  await page.waitForTimeout(1200)

  const heading = page.locator('#section-data h2')
  await expect(heading).toBeInViewport()
  // ...and the contents keep up with where the reader is
  await expect(nav.locator('a[aria-current]')).toHaveText('Your data')
})

/**
 * Turn one familiarity check off the way a person does.
 *
 * The checkbox takes no pointer events – the whole card is the switch, so a miss
 * still lands – which is exactly what `uncheck()` cannot cope with.
 */
async function clickCriterion(scope: any, index: number) {
  await scope.locator('#section-familiarity .space-y-3 > div').nth(index).locator('span.text-sm.font-medium').click()
}

test('the familiarity section switches a check on and keeps the last one', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const section = page.locator('#section-familiarity')
  const visits = section.locator('input[type="checkbox"]').nth(0)
  const activeDays = section.locator('input[type="checkbox"]').nth(1)
  const age = section.locator('input[type="checkbox"]').nth(2)

  // All three count out of the box, and with company any of them can be cleared
  await expect(visits).toBeChecked()
  await expect(activeDays).toBeChecked()
  await expect(age).toBeChecked()
  await expect(visits).toBeEnabled()

  await clickCriterion(page, 1)
  await clickCriterion(page, 2)
  await page.waitForTimeout(500)

  // The last one left cannot be cleared – there would be no question left to answer
  await expect(visits).toBeDisabled()
  const stored = await page.evaluate(async () => {
    const data = await chrome.storage.sync.get('settings')
    return JSON.parse(data.settings).familiarity
  })
  expect(stored.activeDays.enabled).toBe(false)
  expect(stored.visits).toEqual({ enabled: true, min: 10 })

  // Asking for two of two is the mode written out, and the count follows what
  // is actually enabled
  await clickCriterion(page, 1)
  await page.waitForTimeout(300)
  await section.locator('select').first().selectOption('atLeast')
  await page.waitForTimeout(300)
  await expect(section.locator('text=/ 2')).toBeVisible()
})

test('the contents belong to the settings page and nowhere else', async ({ page, extensionId, context }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)
  await expect(page.locator('text=On this page').first()).toBeAttached()

  for (const url of ['dist/popup/index.html', 'dist/welcome/index.html']) {
    const other = await context.newPage()
    await other.goto(`chrome-extension://${extensionId}/${url}`)
    await other.waitForTimeout(1500)
    await expect(other.locator('text=On this page')).toHaveCount(0)
    await other.close()
  }
})

test('a section reset puts back that section and leaves the others alone', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const resetIn = (section: string) => page.locator(`#section-${section} button[aria-label]`).first()
  // Nothing has been touched yet, so no reset has anything to do
  await expect(resetIn('lookups')).toBeDisabled()

  await page.locator('#section-lookups textarea').fill('Example | https://example.com/{domain}')
  await page.locator('#section-tampering textarea').first().fill('spa.example')
  await page.waitForTimeout(600)
  await expect(resetIn('lookups')).toBeEnabled()

  await resetIn('lookups').click()
  await page.waitForTimeout(600)

  const stored = await page.evaluate(async () => {
    const data = await chrome.storage.sync.get('settings')
    const parsed = JSON.parse(data.settings)
    return { lines: parsed.lookupServices.split('\n').length, excluded: parsed.antiTamperingExcludedDomains }
  })
  // The shipped links are back, and the section next door still holds the
  // domain that was typed into it
  expect(stored.lines).toBeGreaterThan(1)
  expect(stored.excluded).toBe('spa.example')
  await expect(resetIn('lookups')).toBeDisabled()
  await expect(resetIn('tampering')).toBeEnabled()

  await resetIn('tampering').click()
  await page.waitForTimeout(600)
  await expect(page.locator('#section-tampering textarea').first()).toHaveValue('')
})

test('turning explanations off empties the settings page of them and nothing else', async ({ page, extensionId, context }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const hints = page.locator('.hint')
  const total = await hints.count()
  expect(total).toBeGreaterThan(20)
  await expect(hints.first()).toBeVisible()
  const tall = await page.evaluate(() => document.body.scrollHeight)

  // The toggle sits last in General, next to the theme picker
  await page.locator('#section-general label.cursor-pointer').last().click()
  await page.waitForTimeout(700)

  // Still in the markup, just not taking up the page
  await expect(hints).toHaveCount(total)
  await expect(hints.first()).toBeHidden()
  expect(await page.evaluate(() => document.body.scrollHeight)).toBeLessThan(tall)
  // Its own description is the way back, so it stays
  await expect(page.locator('#section-general p').last()).toBeVisible()

  // The popup says what it says either way
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await popup.waitForTimeout(1200)
  await expect(popup.locator('.hint')).toHaveCount(0)
  await popup.close()

  await page.locator('#section-general label.cursor-pointer').last().click()
  await page.waitForTimeout(700)
  await expect(hints.first()).toBeVisible()
})

test('the badge draws whichever number the settings ask for', async ({ page, context }) => {
  const DAY = 24 * 60 * 60 * 1000
  // The install-time import writes the same records, so a seed laid before it
  // settles is overwritten and the badge then disagrees with the seed
  await waitForAutoImport(context)
  await seedVisits(context, SITE_HOST, 42, { activeDays: 12, firstSeen: Date.now() - 30 * DAY })
  await serveSite(page, SITE_URL)
  await page.waitForTimeout(800)

  // Read back what the record actually holds – the visit itself updates it, and
  // the badge has to agree with the record rather than with the seed
  const record: any = await inWorker(context, async (host: string) => {
    const stored = await chrome.storage.local.get(host)
    return stored[host]
  }, SITE_HOST)

  // The tab is found by its address rather than by being the active one in the
  // last focused window. A headless runner need have no focused window at all,
  // and that query then answers about some other tab – one the badge was never
  // drawn on, which is why the read stayed empty however long it waited.
  //
  // Waited on rather than read once as well: the background draws the badge
  // after it hears about the reload, so a fixed pause is a race.
  const badgeShows = async (content: string, expected: string) => {
    await patchSettings(context, { badgeContent: content })
    await page.reload()
    // The badge exists for the tab being looked at and no other – the background
    // returns early on `!tab.active`, so that a ctrl+clicked background tab
    // cannot repaint the icon of the tab in front of the user. Asking for it
    // without being on that tab is asking for something that by design is not
    // drawn, so the test does what a reader does and brings it to the front.
    await page.bringToFront()
    await expect.poll(() => inWorker(context, async (host: string) => {
      const [tab] = await chrome.tabs.query({ url: `*://${host}/*` })
      return tab ? chrome.action.getBadgeText({ tabId: tab.id }) : 'no tab'
    }, SITE_HOST), { timeout: 15000, intervals: [300] }).toBe(expected)
  }

  await badgeShows('visits', String(record.count))
  await badgeShows('activeDays', String(record.activeDays))
  await badgeShows('age', String(Math.floor((Date.now() - record.firstSeen) / DAY)))
  // All three checks are on out of the box, and this record clears every one
  await badgeShows('checks', '3/3')

  // With a single check left on, counting them says nothing the colour has not
  // already said, so the badge shows that check's own number
  await patchSettings(context, {
    familiarity: {
      visits: { enabled: true, min: 10 },
      activeDays: { enabled: false, min: 5 },
      age: { enabled: false, min: 10 },
      mode: 'all',
      atLeast: 2,
    },
  })
  await badgeShows('checks', String(record.count))
})

test('the counter list holds only the checks the user judges sites by', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const select = page.locator('#section-display select')
  await expect(select.locator('option')).toHaveText(['Visits', 'Active days', 'Days known', 'Passed checks'])

  await select.selectOption('age')
  await clickCriterion(page, 2)
  await page.waitForTimeout(600)

  // The check it named is gone from the list, and the box shows what the badge
  // will actually draw rather than sitting empty
  await expect(select.locator('option')).toHaveText(['Visits', 'Active days', 'Passed checks'])
  await expect(select).toHaveValue('checks')

  // One check left: there is nothing to choose between, so the whole thing goes
  await clickCriterion(page, 1)
  await page.waitForTimeout(600)
  await expect(select).toBeHidden()
})

test('a familiarity check switches from anywhere on its card except the number', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const card = page.locator('#section-familiarity .space-y-3 > div').nth(1)
  const box = page.locator('#section-familiarity .space-y-3 > div').nth(1).locator('input[type="checkbox"]')
  await card.scrollIntoViewIfNeeded()
  await expect(box).toBeChecked()

  // The corner of the card, well away from the checkbox – it used to do nothing
  const bounds = (await card.boundingBox())!
  await card.click({ position: { x: bounds.width - 20, y: bounds.height - 6 } })
  await expect(box).not.toBeChecked()
  await card.click({ position: { x: bounds.width - 20, y: bounds.height - 6 } })
  await expect(box).toBeChecked()

  // Except where a click is aiming at the number rather than at the switch
  await card.locator('input[type="number"]').click()
  await page.waitForTimeout(400)
  await expect(box).toBeChecked()
})

test('every choice on the options page is written at the same size', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  // Sixteen of these labels were a size smaller than the six beside them, which
  // reads as two kinds of control where there is only one
  const sizes = await page.evaluate(() => {
    const found: Record<string, number> = {}
    document.querySelectorAll('label').forEach((label) => {
      if (!label.querySelector('input[type="radio"], input[type="checkbox"]'))
        return
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
      let node: Node | null
      // eslint-disable-next-line no-cond-assign
      while (node = walker.nextNode()) {
        if ((node.textContent || '').trim().length < 2)
          continue
        const size = getComputedStyle(node.parentElement!).fontSize
        found[size] = (found[size] || 0) + 1
        break
      }
    })
    return found
  })

  expect(Object.keys(sizes)).toEqual(['14px'])
})

test('wiping the visits updates what the page says about the import, without a reload', async ({ page, context, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  // Sentinels under every kind of key the same storage area holds. A checkbox
  // that names visit information may not reach a single one of them.
  await inWorker(context, async () => chrome.storage.local.set({
    customShorteners: ['sentinel-short.test'],
    customPublicEmailProviders: ['sentinel-public.test'],
    customDisposableEmailDomains: ['sentinel-temp.test'],
    customMailSites: ['sentinel.test = mail.sentinel.test'],
    remoteShortenerDomains: { domains: ['sentinel-remote.test'], updatedAt: 1, urls: [] },
    remoteMailSites: { domains: ['sentinel.test = mail.sentinel.test'], updatedAt: 1, urls: [] },
    textDefaultsSeeded: true,
  }))

  const status = page.locator('#section-data p').nth(1)
  await page.locator('#section-data button').first().click()
  await expect(status).toContainText('Imported in full', { timeout: 20000 })

  await page.locator('label', { hasText: 'All information about site visits' }).locator('input').check()
  await page.locator('button', { hasText: 'Reset selected data' }).click()
  await page.locator('.btn-danger', { hasText: 'Reset' }).last().click()

  // The import state was wiped along with the visits, and this page is the one
  // that wiped it – so it says so straight away rather than at the next reload
  await expect(status).toContainText('Nothing imported yet', { timeout: 5000 })

  const survivors = await inWorker(context, async () => chrome.storage.local.get([
    'customShorteners',
    'customPublicEmailProviders',
    'customDisposableEmailDomains',
    'customMailSites',
    'remoteShortenerDomains',
    'remoteMailSites',
    'textDefaultsSeeded',
  ]))
  expect(survivors).toEqual({
    customShorteners: ['sentinel-short.test'],
    customPublicEmailProviders: ['sentinel-public.test'],
    customDisposableEmailDomains: ['sentinel-temp.test'],
    customMailSites: ['sentinel.test = mail.sentinel.test'],
    remoteShortenerDomains: { domains: ['sentinel-remote.test'], updatedAt: 1, urls: [] },
    remoteMailSites: { domains: ['sentinel.test = mail.sentinel.test'], updatedAt: 1, urls: [] },
    textDefaultsSeeded: true,
  })

  // And the visits really are gone, or the assertion above proves nothing
  const visits = await inWorker(context, async () => {
    const all = await chrome.storage.local.get(null)
    return Object.keys(all).filter(key => key.includes('.') && typeof (all[key] as any)?.count === 'number')
  })
  expect(visits).toEqual([])
})

test('the import button offers a first run before it offers a re-run', async ({ page, context, extensionId }) => {
  // The install-time import has to be out of the way before its state is wiped,
  // or the background writes it back underneath the page. Waited for rather
  // than slept through: a pause long enough here is not long enough on a
  // loaded machine, and the wipe then lands in the middle of the import.
  await waitForAutoImport(context)
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)
  await inWorker(context, async () => chrome.storage.local.remove('__visilantHistoryImport'))
  await page.reload()
  await page.waitForTimeout(1500)

  const button = page.locator('#section-data button').first()
  await expect(button).toHaveText('Import history')

  await button.click()
  // Nothing to re-do is only true until something has been done
  await expect(button).toHaveText('Re-import history', { timeout: 20000 })
})

test('a reset takes the lookalike index down with the records', async ({ page, context, extensionId }) => {
  // The index is a copy of the visit records held in the background's memory.
  // Deleting the records from the settings page left it answering questions from
  // that copy, and one write later it was back on disk.
  //
  // The install-time import has to be out of the way first: it writes the same
  // records, and a reset landing in the middle of it waits for the batch that is
  // already in flight before it can take the key.
  await waitForAutoImport(context)
  await seedVisits(context, 'gmail.com', 50, { activeDays: 30 })

  const check = await context.newPage()
  await check.goto(`chrome-extension://${extensionId}/dist/popup/index.html?check=1`)
  await check.waitForTimeout(1200)
  await check.evaluate(async () => chrome.runtime.sendMessage({ type: 'rebuild-familiar-index', data: {} }))

  const lookalikesFor = (target: any) => target.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'find-lookalikes', data: { hostname: 'gmal.com' } }))

  expect((await lookalikesFor(check)).length).toBeGreaterThan(0)

  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Brought to the front, because opening the check page above sent this one to
  // the background - and a background tab produces no animation frames, so
  // Playwright's "is this element stable" check waits for two of them forever.
  await page.bringToFront()
  // Waited for rather than slept through: the page holds a spinner until the
  // stored settings arrive, and a fixed pause lands in the middle of that
  await page.locator('#section-data').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('label', { hasText: 'All information about site visits' }).locator('input').check({ timeout: 20000 })
  await page.locator('button', { hasText: 'Reset selected data' }).click()
  await page.locator('.btn-danger', { hasText: 'Reset' }).last().click()
  await page.waitForTimeout(1500)

  // Nothing left to resemble
  expect(await lookalikesFor(check)).toEqual([])
})

test('turning the link check off reaches a tab that is already open', async ({ page, context }) => {
  // Every one of these used to be read once at document start and kept for the
  // life of the tab, so switching the trigger off left it intercepting clicks
  // until the page was reloaded.
  await patchSettings(context, {
    linkSafety: { enabled: true, tooltipTrigger: 'click-left', hoverDelay: 1500, showVisitCount: 'always', shortUrlMode: 'off', shortUrlShowFullUrl: false, shortUrlTraceChain: false, shortUrlResolveAny: false, shortUrlListUpdateUrl: '', scopeMode: 'everywhere', scopeDomains: '' },
  })

  await serveSite(page, SITE_URL, blankPage('links', `
    <a id="external" href="https://elsewhere-entirely.test/landed"
       style="position:fixed;top:50px;left:50px;font-size:20px;z-index:9999">External Link</a>
  `))
  await page.route('https://elsewhere-entirely.test/**', (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: blankPage('landed') }))
  await page.waitForTimeout(2500)

  // Held back, which is what the trigger is for
  await page.locator('#external').click()
  await page.waitForTimeout(1000)
  expect(page.url()).toBe(SITE_URL)

  // Escape the dialog, then turn the whole feature off from elsewhere
  await page.keyboard.press('Escape')
  await patchSettings(context, {
    linkSafety: { enabled: false, tooltipTrigger: 'click-left', hoverDelay: 1500, showVisitCount: 'always', shortUrlMode: 'off', shortUrlShowFullUrl: false, shortUrlTraceChain: false, shortUrlResolveAny: false, shortUrlListUpdateUrl: '', scopeMode: 'everywhere', scopeDomains: '' },
  })
  await page.waitForTimeout(1500)

  // The same tab, never reloaded, now lets the link do what links do
  await page.locator('#external').click()
  await page.waitForTimeout(1500)
  expect(page.url()).toContain('elsewhere-entirely.test')
})

// ==========================================
// Content script: the guard inside an iframe
// ==========================================

const FRAME_URL = 'https://embedded-form.test/'

/** A page whose form lives in a frame belonging to somebody else. */
async function serveFramedForm(page: any) {
  await page.route(`${FRAME_URL}**`, (route: any) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: blankPage('embedded', '<input id="inner" type="text" style="width:200px">'),
    }))
  await serveSite(page, SITE_URL, blankPage('host page', `
    <iframe id="frame" src="${FRAME_URL}" style="width:400px;height:200px;border:0"></iframe>
  `))
  await page.waitForTimeout(2500)
}

test('typing into a form inside an iframe is warned about', async ({ page }) => {
  // Events do not cross a frame boundary, so the top document's listeners never
  // saw this and a login form served in an iframe bypassed every warning
  await serveFramedForm(page)

  const inner = page.frameLocator('#frame').locator('#inner')
  await inner.click()
  await page.keyboard.type('hunter2')
  await page.waitForTimeout(2000)

  const warning = page.locator('body > div[style*="2147483647"]')
  await expect(warning.first()).toBeAttached({ timeout: 5000 })
})

test('a paste into an iframe on an unfamiliar site is held', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://tracked-site.test' })
  await patchSettings(context, { blockPasteOnUnfamiliar: true })

  const page = await context.newPage()
  await serveFramedForm(page)
  await page.evaluate(() => navigator.clipboard.writeText('correct-horse-battery-staple'))

  const inner = page.frameLocator('#frame').locator('#inner')
  await inner.click()
  await page.waitForTimeout(500)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForTimeout(2000)

  // Nothing arrived in the box, and the top document is asking about it
  await expect(inner).toHaveValue('')
  const overlay = await page.evaluate(() => {
    const el = document.elementFromPoint(8, 8) as HTMLElement | null
    return Boolean(el?.style && el.style.getPropertyValue('z-index') === '2147483647')
  })
  expect(overlay).toBe(true)
})

test('CONTROL: with the guard off, a paste into a frame lands in the field', async ({ context }) => {
  // The frame script runs in every advert on every page. If it interrupted
  // anything the user did not ask it to, every held paste above proves nothing.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://tracked-site.test' })

  const page = await context.newPage()
  await serveFramedForm(page)
  await page.evaluate(() => navigator.clipboard.writeText('ordinary text'))

  const inner = page.frameLocator('#frame').locator('#inner')
  await inner.click()
  await page.waitForTimeout(500)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForTimeout(1200)

  await expect(inner).toHaveValue('ordinary text')
})

test('a link inside a custom element is checked like any other', async ({ page }) => {
  // A link in an open shadow root retargets: the event's target is the host
  // element, and `closest('a')` from there finds nothing. The link check simply
  // never ran on it.
  await serveSite(page, SITE_URL, blankPage('shadow', `
    <link-card id="card"></link-card>
    <script>
      class LinkCard extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: 'open' })
          root.innerHTML = '<a id="inner" href="https://elsewhere-shadow.test/landing" style="font-size:20px">Open</a>'
        }
      }
      customElements.define('link-card', LinkCard)
    </script>
  `))
  await page.waitForTimeout(2500)

  // Hovering the host, because that is all the page exposes to a pointer
  await page.locator('#card').hover()
  await page.waitForTimeout(2500)

  const tooltipHost = page.locator('body > div[style*="2147483647"]')
  await expect(tooltipHost.first()).toBeAttached({ timeout: 5000 })
})

/**
 * Is the in-page warning on screen?
 *
 * It sits in the top right corner and takes pointer events, so a hit test there
 * retargets to the shadow host - which carries the inline maximum z-index. The
 * container itself is mounted on every page for the link check, so its mere
 * presence proves nothing.
 */
function warningShowing(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth - 30, 30) as HTMLElement | null
    return Boolean(el?.style && el.style.getPropertyValue('z-index') === '2147483647')
  })
}

test('a site shortcut is not reported as typing, but typing into a field is', async ({ page }) => {
  // A single key with no field under it is the site's own shortcut - `j` to move
  // down a list, `/` to open a search. Warning about those turned the feature
  // into noise on every keyboard-driven site.
  await serveSite(page, SITE_URL, blankPage('shortcuts', `
    <div style="height:200px">no field here</div>
    <input id="field" type="text" style="width:300px">
  `))
  await page.waitForTimeout(2500)

  await page.click('body', { position: { x: 20, y: 20 } })
  await page.keyboard.press('j')
  await page.waitForTimeout(1500)
  expect(await warningShowing(page)).toBe(false)

  // ...and the control: the same key, in a field, is exactly what this warns about
  await page.click('#field')
  await page.keyboard.press('j')
  await expect.poll(() => warningShowing(page), { timeout: 10000, intervals: [250] }).toBe(true)
})

/** The colour class on the big visit count at the top of the popup. */
async function countColour(page: any): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.font-mono.font-bold')
    const cls = el?.className ?? ''
    if (cls.includes('text-green'))
      return 'green'
    if (cls.includes('text-red'))
      return 'red'
    return 'none'
  })
}

test('the visit count is coloured by its own check, not by the whole verdict', async ({ context, extensionId }) => {
  // Three checks, two of which have to pass. The visit count fails its own bar
  // and the two dates clear theirs, so the site is familiar overall - and the
  // count used to be painted green on the strength of that, sitting next to an
  // active-day count that was correctly painted by its own check.
  await patchSettings(context, {
    familiarity: {
      visits: { enabled: true, min: 10 },
      activeDays: { enabled: true, min: 5 },
      age: { enabled: true, min: 10 },
      mode: 'atLeast',
      atLeast: 2,
    },
  })
  await seedVisits(context, 'partly.test', 3, {
    activeDays: 30,
    firstSeen: Date.now() - 400 * 24 * 60 * 60 * 1000,
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=partly.test`)
  await page.waitForTimeout(1800)

  expect(await countColour(page)).toBe('red')
  await page.close()
})

test('a visit count that clears its bar stays green when another check fails', async ({ context, extensionId }) => {
  // The same mistake the other way round: every check has to pass, the site was
  // first seen today, and fifty visits against a bar of ten came out red.
  await patchSettings(context, {
    familiarity: {
      visits: { enabled: true, min: 10 },
      activeDays: { enabled: true, min: 5 },
      age: { enabled: true, min: 10 },
      mode: 'all',
      atLeast: 2,
    },
  })
  await seedVisits(context, 'freshly.test', 50, { activeDays: 30, firstSeen: Date.now() })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=freshly.test`)
  await page.waitForTimeout(1800)

  expect(await countColour(page)).toBe('green')
  await page.close()
})

test('a visit count nobody judges by carries no colour at all', async ({ context, extensionId }) => {
  // Switched off, the count has no say in the verdict - the same as the two
  // dates, which the grid already leaves uncoloured when they are off
  await patchSettings(context, {
    familiarity: {
      visits: { enabled: false, min: 10 },
      activeDays: { enabled: true, min: 5 },
      age: { enabled: true, min: 10 },
      mode: 'all',
      atLeast: 2,
    },
  })
  await seedVisits(context, 'unjudged.test', 3, {
    activeDays: 30,
    firstSeen: Date.now() - 400 * 24 * 60 * 60 * 1000,
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=unjudged.test`)
  await page.waitForTimeout(1800)

  expect(await countColour(page)).toBe('none')
  await page.close()
})
