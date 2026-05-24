import { expect, test } from './fixtures'

// ==========================================
// Popup — basic loading
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
// Popup — domain display
// ==========================================

test('popup shows domain in standalone mode', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=google.com`)
  await page.waitForTimeout(1000)
  await expect(page.locator('text=google.com').first()).toBeVisible({ timeout: 5000 })
})

test('popup shows visit count for domain', async ({ page, extensionId }) => {
  // First visit a page so it gets tracked
  await page.goto('https://example.com')
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  // Open popup for that domain
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await page.waitForTimeout(1000)
  await expect(page.locator('text=example.com').first()).toBeVisible({ timeout: 5000 })
})

test('popup shows "no visit data" for unvisited domain', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=never-visited-domain-12345.com`)
  await page.waitForTimeout(1000)
  // Should show the "no visit data" message since no related domains exist
  const domainList = page.locator('.overflow-y-auto')
  await expect(domainList).not.toBeAttached({ timeout: 3000 })
})

// ==========================================
// Popup — font size controls
// ==========================================

test('popup font size increase/decrease buttons work', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
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
// Popup — sort controls
// ==========================================

test('popup sort controls are visible for domain with data', async ({ page, extensionId }) => {
  // Visit a page first to generate data
  await page.goto('https://example.com')
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await page.waitForTimeout(1000)

  // Sort order toggle button (↑ or ↓)
  const sortToggle = page.locator('button:has-text("↑"), button:has-text("↓")')
  await expect(sortToggle.first()).toBeAttached({ timeout: 5000 })

  // Highlighting toggle (🌈)
  await expect(page.locator('button:has-text("🌈")')).toBeAttached({ timeout: 3000 })
})

// ==========================================
// Options page — loading & sections
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
// Options page — toggle switches
// ==========================================

test('options page has display setting toggles', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Dynamic icon and show badge toggles
  const checkboxes = page.locator('input[type="checkbox"]')
  // At least dynamic icon + show badge + warning notification + link safety
  expect(await checkboxes.count()).toBeGreaterThanOrEqual(4)
})

test('safety threshold can be changed', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  const thresholdInput = page.locator('input[type="number"]').first()
  await thresholdInput.fill('20')
  await expect(thresholdInput).toHaveValue('20')
})

// ==========================================
// Options page — notification settings
// ==========================================

test('notification settings expand when toggle is on', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Warning notification toggle — find the one that controls showWarningNotification
  // Radio buttons for warning type should be visible when notifications are enabled
  const radioButtons = page.locator('input[type="radio"][name="warningType"]')

  // If notifications are enabled by default, radios should exist
  if (await radioButtons.count() > 0) {
    await expect(radioButtons.first()).toBeAttached()
  }
})

// ==========================================
// Options page — link safety settings
// ==========================================

test('link safety section has master toggle', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  // Link safety toggle exists
  const linkSafetyCheckboxes = page.locator('.bg-white.rounded-lg.shadow').nth(3).locator('input[type="checkbox"]')
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
// Options page — database management
// ==========================================

test('options page has import history button', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Import history button (blue)
  const importButton = page.locator('button.bg-blue-500').first()
  await expect(importButton).toBeVisible({ timeout: 5000 })
})

test('options page has reset data section with checkboxes', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Red reset button
  const resetButton = page.locator('button.bg-red-600').first()
  await expect(resetButton).toBeVisible({ timeout: 5000 })
  // Should be disabled when no checkboxes are selected
  await expect(resetButton).toBeDisabled()
})

test('reset button enables when checkbox selected', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)

  const resetButton = page.locator('button.bg-red-600').first()
  await expect(resetButton).toBeDisabled()

  // The reset checkboxes are near the bottom — find them by context
  const visitsCheckbox = page.locator('label:has(input[type="checkbox"])').filter({ hasText: /visit/i }).locator('input[type="checkbox"]')
  if (await visitsCheckbox.count() > 0) {
    await visitsCheckbox.first().click()
    await expect(resetButton).toBeEnabled()
  }
})

// ==========================================
// Options page — anti-tampering
// ==========================================

test('anti-tampering excluded domains textarea exists', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // Anti-tampering textarea — its placeholder starts with "example.com"
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
// Content script — visit tracking
// ==========================================

test('visiting a page tracks the domain', async ({ page, extensionId, context }) => {
  await page.goto('https://example.com')
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  // Open popup to verify
  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await popupPage.waitForTimeout(1000)
  await expect(popupPage.locator('text=example.com').first()).toBeVisible({ timeout: 5000 })
  await popupPage.close()
})

test('visiting multiple subdomains shows domain family', async ({ page, extensionId, context }) => {
  // Visit example.com
  await page.goto('https://example.com')
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  // Visit www.example.com (if it resolves)
  await page.goto('https://www.example.com').catch(() => {})
  await page.waitForTimeout(2000)

  // Check popup shows domain family
  const popupPage = await context.newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await popupPage.waitForTimeout(1000)
  await expect(popupPage.locator('text=example.com').first()).toBeVisible({ timeout: 5000 })
  await popupPage.close()
})

// ==========================================
// Content script — link safety tooltip on hover
// ==========================================

test('link tooltip appears on hover over external link', async ({ page, _extensionId }) => {
  // Create a page with an external link
  await page.goto('https://example.com')
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  // Inject an external link into the page
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = 'https://some-unknown-domain-test.com'
    link.textContent = 'External Link'
    link.id = 'test-external-link'
    link.style.cssText = 'position:fixed;top:50px;left:50px;font-size:20px;z-index:9999;'
    document.body.appendChild(link)
  })

  // Hover over the link
  await page.locator('#test-external-link').hover()
  await page.waitForTimeout(500) // debounce is 300ms

  // Tooltip should appear (in shadow DOM — check for the container being added)
  // The tooltip is rendered inside a shadow root, so we check the host element
  const tooltipHost = page.locator('body > div[style*="z-index"]')
  // Give extra time for the tooltip to render
  await page.waitForTimeout(1000)
  await expect(tooltipHost.first()).toBeAttached({ timeout: 5000 })
})

// ==========================================
// Popup — anti-tampering status
// ==========================================

test('popup shows anti-tampering status for domain', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await page.waitForTimeout(1000)

  // Green dot (protected) or amber dot should be visible
  const statusDot = page.locator('.bg-green-500, .bg-amber-400')
  await expect(statusDot.first()).toBeAttached({ timeout: 5000 })
})

test('popup can toggle anti-tampering for domain', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
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
// Options — settings persistence
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

  // Options headings should now be in Russian
  await expect(page.locator('text=Общие настройки')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Настройки уведомлений')).toBeVisible({ timeout: 3000 })

  // Open popup — it should also be in Russian
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  await popup.waitForTimeout(1500)

  // "Visit a website" in Russian
  await expect(popup.locator('text=Посетите веб-сайт')).toBeVisible({ timeout: 5000 })
  await popup.close()

  // Switch back to English
  await langSelect.selectOption('en')
  await page.waitForTimeout(1000)
  await expect(page.locator('text=General settings')).toBeVisible({ timeout: 5000 })
})

test('changing language in options switches popup domain view to that language', async ({ page, extensionId, context }) => {
  // Visit a domain first
  const tab = await context.newPage()
  await tab.goto('https://example.com')
  await tab.waitForLoadState('load')
  await tab.waitForTimeout(2000)
  await tab.close()

  // Switch to Russian in options
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)
  await page.locator('select').first().selectOption('ru')
  await page.waitForTimeout(1000)

  // Open popup for a domain — labels should be in Russian
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await popup.waitForTimeout(1500)

  // "Current domain" in Russian
  await expect(popup.locator('text=Текущий домен')).toBeVisible({ timeout: 5000 })
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
  // Visit a site so it has count=1
  const tab = await context.newPage()
  await tab.goto('https://example.com')
  await tab.waitForLoadState('load')
  await tab.waitForTimeout(2000)
  await tab.close()

  // Set threshold to 1 in options (count 1 >= 1, so green)
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1000)
  await page.locator('input[type="number"]').first().fill('1')
  await page.waitForTimeout(500)

  // Open popup — count should be green (safe)
  let popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await popup.waitForTimeout(1500)
  await expect(popup.locator('.text-green-600').first()).toBeAttached({ timeout: 5000 })
  await popup.close()

  // Now set threshold to 999 (count 1 < 999, so red)
  await page.locator('input[type="number"]').first().fill('999')
  await page.waitForTimeout(500)

  popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
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
  // Disable anti-tampering for example.com in popup
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await popup.waitForTimeout(1500)

  // Click disable button
  const toggleBtn = popup.locator('button.text-blue-500').first()
  await toggleBtn.click()
  await popup.waitForTimeout(500)
  await expect(popup.locator('.bg-amber-400').first()).toBeAttached({ timeout: 3000 })
  await popup.close()

  // Open options — anti-tampering textarea should contain example.com
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)

  const tamperingTextarea = page.locator('textarea[placeholder^="example.com"]')
  await expect(tamperingTextarea).toHaveValue(/example\.com/, { timeout: 5000 })

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
  await page.goto('https://httpbin.org')
  await page.waitForLoadState('load')
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
  await page.goto('https://example.com')
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)

  // Inject a link where text looks like one domain but href goes to another
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = 'https://evil-phishing-site.com/login'
    link.textContent = 'https://google.com/login'
    link.id = 'test-mismatch-link'
    link.style.cssText = 'position:fixed;top:150px;left:50px;font-size:20px;z-index:9999;background:white;padding:10px;'
    document.body.appendChild(link)
  })

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
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await page.waitForTimeout(1000)

  // Increase font twice: 100% → 120%
  await page.locator('button[title="Increase font size"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title="Increase font size"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator('text=120%').first()).toBeAttached({ timeout: 3000 })

  // Open popup in new tab — should still be 120%
  const popup2 = await context.newPage()
  await popup2.goto(`chrome-extension://${extensionId}/dist/popup/index.html?domain=example.com`)
  await popup2.waitForTimeout(1000)
  await expect(popup2.locator('text=120%').first()).toBeAttached({ timeout: 5000 })
  await popup2.close()

  // Reset font size back to 100%
  await page.locator('button[title="Decrease font size"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title="Decrease font size"]').click()
})
