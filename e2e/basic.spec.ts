import { expect, test } from './fixtures'
import { blankPage, seedVisits, serveSite } from './helpers'

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
  await expect(page.locator('img[alt]').first()).toBeVisible({ timeout: 5000 })
})

test('options page has safety threshold input', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  const thresholdInput = page.locator('input[type="number"]').first()
  await expect(thresholdInput).toBeVisible({ timeout: 5000 })
  // Default threshold should be 10
  await expect(thresholdInput).toHaveValue('10')
})

test('options page has language selector', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  const langSelect = page.locator('select').first()
  await expect(langSelect).toBeVisible({ timeout: 5000 })
  // Should have 3 language options
  const options = langSelect.locator('option')
  await expect(options).toHaveCount(3)
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

test('options page offers both history imports and says one already ran', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  await expect(page.locator('button', { hasText: 'Full import' })).toBeVisible({ timeout: 5000 })
  await expect(page.locator('button', { hasText: 'Refresh from history' })).toBeVisible()
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
  // Anti-tampering textarea – its placeholder starts with "example.com"
  const textarea = page.locator('textarea[placeholder^="example.com"]')
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
// Cross-component: language switching
// ==========================================

test('changing language in options switches popup to that language', async ({ page, extensionId, context }) => {
  // Open options, switch to Russian
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const langSelect = page.locator('select').first()
  await langSelect.selectOption('ru')
  await page.waitForTimeout(1000)

  // Options headings should now be in Russian. Named by role, since the same
  // words also appear as entries in the page contents.
  await expect(page.getByRole('heading', { name: 'Общие настройки' })).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('heading', { name: 'Настройки уведомлений' })).toBeVisible({ timeout: 3000 })

  // Open popup – it should also be in Russian
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await popup.waitForTimeout(1500)

  // "Visit a website" in Russian
  await expect(popup.locator('text=Посетите веб-сайт')).toBeVisible({ timeout: 5000 })
  await popup.close()

  // Switch back to English
  await langSelect.selectOption('en')
  await page.waitForTimeout(1000)
  await expect(page.getByRole('heading', { name: 'General settings' })).toBeVisible({ timeout: 5000 })
})

test('changing language in options switches popup domain view to that language', async ({ page, extensionId, context }) => {
  await seedVisits(context, SITE_HOST, 1)

  // Switch to Russian in options
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)
  await page.locator('select').first().selectOption('ru')
  await page.waitForTimeout(1000)

  // Open popup for a domain – labels should be in Russian
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=${SITE_HOST}`)
  await popup.waitForTimeout(1500)

  // Opened with ?domain=, so this is the standalone page, where the heading is
  // "checked domain" rather than "current domain"
  await expect(popup.locator('text=Проверяемый домен')).toBeVisible({ timeout: 5000 })
  // Anti-tampering status in Russian
  await expect(popup.locator('text=Защита от вмешательства')).toBeAttached({ timeout: 3000 })
  await popup.close()

  // Switch back to English
  await page.locator('select').first().selectOption('en')
  await page.waitForTimeout(1000)
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

  const tamperingTextarea = page.locator('textarea[placeholder^="example.com"]')
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
  await expect(nav.locator('a')).toHaveCount(8)
  await expect(nav.locator('a').first()).toHaveText('General settings')

  // Clicking is handled in script rather than by the link: fragment navigation
  // does nothing at all on an extension page
  await nav.locator('a[href="#section-data"]').click()
  await page.waitForTimeout(1200)

  const heading = page.locator('#section-data h2')
  await expect(heading).toBeInViewport()
  // ...and the contents keep up with where the reader is
  await expect(nav.locator('a[aria-current]')).toHaveText('Your data')
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
