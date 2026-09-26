/**
 * Taking silences off sites that are familiar now.
 *
 * Two ways, both the user's: a button on the settings page that clears the
 * familiar ones in one go, and a setting, off unless asked for, that lifts a
 * silence on the next visit once the site qualifies.
 */
import { expect, test } from './fixtures'
import { inWorker, patchSettings, serveSite, waitForAutoImport } from './helpers'

// Evaluated inside the extension's service worker, where the MV3 API lives
declare const chrome: any

const DAY = 24 * 60 * 60 * 1000

/** A record the shipped rules call familiar: visits, active days and age all pass. */
function familiar(extra: Record<string, unknown> = {}) {
  return { count: 20, activeDays: 8, firstSeen: Date.now() - 60 * DAY, lastSeen: 1, ignored: true, ...extra }
}

/** One visit short of the shipped ten, and the other two checks pass. */
function almost() {
  return { count: 9, activeDays: 8, firstSeen: Date.now() - 60 * DAY, lastSeen: 1, ignored: true }
}

async function seed(context: any, records: Record<string, unknown>) {
  await inWorker(context, async (values: Record<string, unknown>) => {
    await chrome.storage.local.set(values)
  }, records)
}

async function record(context: any, host: string) {
  return inWorker<any>(context, async (key: string) => (await chrome.storage.local.get(key))[key], host)
}

async function openOptions(context: any, extensionId: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.waitForTimeout(1500)
  return page
}

test('the settings page clears the familiar silences it names, and only those', async ({ context, extensionId }) => {
  await waitForAutoImport(context)
  await seed(context, {
    'known-a.test': familiar(),
    'known-b.test': familiar({ silencedWhileFamiliar: true }),
    'new-site.test': almost(),
  })
  const page = await openOptions(context, extensionId)

  const note = page.locator('[data-familiar-silenced]')
  await expect(note).toContainText('Familiar now', { timeout: 5000 })
  await expect(note).toContainText('known-a.test, known-b.test')
  await expect(note).not.toContainText('new-site.test')

  await page.locator('[data-unsilence-familiar]').click()

  await expect(note).toHaveCount(0, { timeout: 5000 })
  expect((await record(context, 'known-a.test')).ignored).toBe(false)
  // A silence put on a familiar site goes as well: the button is the user asking
  expect((await record(context, 'known-b.test')).ignored).toBe(false)
  expect((await record(context, 'new-site.test')).ignored).toBe(true)
  await expect(page.locator('[data-silenced-list]')).toHaveValue('new-site.test')
})

test('the list follows a silence lifted in another window', async ({ context, extensionId }) => {
  await waitForAutoImport(context)
  await seed(context, { 'known-a.test': familiar() })
  const page = await openOptions(context, extensionId)
  await expect(page.locator('[data-familiar-silenced]')).toBeVisible({ timeout: 5000 })

  await seed(context, { 'known-a.test': familiar({ ignored: false }) })
  await expect(page.locator('[data-familiar-silenced]')).toHaveCount(0, { timeout: 5000 })
})

test('switching the setting on clears every familiar silence, once', async ({ context }) => {
  await waitForAutoImport(context)
  await seed(context, {
    'known-a.test': familiar(),
    'known-b.test': familiar({ silencedWhileFamiliar: true }),
    'new-site.test': almost(),
  })
  await patchSettings(context, { autoUnsilenceFamiliar: false })

  await patchSettings(context, { autoUnsilenceFamiliar: true })

  await expect.poll(async () => (await record(context, 'known-a.test')).ignored, { timeout: 5000 }).toBe(false)
  // Switching it on is the user asking for the list to be cleaned, and a silence
  // from before the note existed could not be told apart from this one anyway
  expect((await record(context, 'known-b.test')).ignored).toBe(false)
  expect((await record(context, 'new-site.test')).ignored).toBe(true)
})

/**
 * The box is followed while it is open, and what it started from is kept apart
 * from that. Compared against the list as it stood by the time the box was left,
 * a silence the popup added meanwhile read as a line deleted, and was undone.
 */
test('a silence added elsewhere while the list is being edited survives the save', async ({ context, extensionId }) => {
  await waitForAutoImport(context)
  await seed(context, { 'new-site.test': almost() })
  const page = await openOptions(context, extensionId)
  const box = page.locator('[data-silenced-list]')
  await expect(box).toHaveValue('new-site.test', { timeout: 5000 })

  await box.focus()
  await seed(context, { 'other-site.test': almost() })
  // Long enough for the batched re-read to land under the open box
  await page.waitForTimeout(800)
  await box.blur()

  await expect(box).toHaveValue('new-site.test\nother-site.test', { timeout: 5000 })
  expect((await record(context, 'other-site.test')).ignored).toBe(true)
})

test('with the setting on, the visit that makes a site familiar lifts its silence', async ({ page, context }) => {
  await waitForAutoImport(context)
  await patchSettings(context, { autoUnsilenceFamiliar: true })
  await seed(context, { 'almost-known.test': almost() })

  await serveSite(page, 'https://almost-known.test/')

  await expect.poll(async () => (await record(context, 'almost-known.test')).count, { timeout: 5000 }).toBe(10)
  const after = await record(context, 'almost-known.test')
  expect(after.ignored).toBe(false)
  expect(after).not.toHaveProperty('silencedWhileFamiliar')
})

test('with the setting off, a visit leaves the silence alone', async ({ page, context }) => {
  await waitForAutoImport(context)
  await seed(context, { 'almost-known.test': almost() })

  await serveSite(page, 'https://almost-known.test/')

  await expect.poll(async () => (await record(context, 'almost-known.test')).count, { timeout: 5000 }).toBe(10)
  expect((await record(context, 'almost-known.test')).ignored).toBe(true)
})

test('a site silenced while familiar stays silenced through its visits', async ({ page, context, extensionId }) => {
  await waitForAutoImport(context)
  await patchSettings(context, { autoUnsilenceFamiliar: true })
  await seed(context, { 'known-a.test': familiar({ ignored: false }) })

  // Sent the way the popup sends it – see the silenced-badge test in basic.spec
  const ui = await openOptions(context, extensionId)
  await ui.evaluate(async () => {
    await (globalThis as any).chrome.runtime.sendMessage({ type: 'ignore-site', data: { hostname: 'known-a.test', ignored: true } })
  })
  await ui.close()
  expect((await record(context, 'known-a.test')).silencedWhileFamiliar).toBe(true)

  await serveSite(page, 'https://known-a.test/')

  await expect.poll(async () => (await record(context, 'known-a.test')).count, { timeout: 5000 }).toBe(21)
  expect((await record(context, 'known-a.test')).ignored).toBe(true)
})
