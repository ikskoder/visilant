/**
 * What a page can read about the user's visits from what Visilant puts in it.
 *
 * The box the warnings are drawn in is an element in the page, and it used to
 * go only on pages that might need a warning. With the link check off, any
 * script on a site could read from its absence that the user comes there often.
 */
import { expect, test } from './fixtures'
import { blankPage, patchSettings, seedVisits, serveSite } from './helpers'

/** Elements Visilant added to the page: the host is the one pinned on top. */
function hostsOnPage(page: any): Promise<number> {
  return page.evaluate(() => Array.from(document.body.children)
    .filter(element => (element as HTMLElement).style?.getPropertyValue('z-index') === '2147483647')
    .length)
}

for (const linkCheck of [true, false]) {
  test(`with the link check ${linkCheck ? 'on' : 'off'}, the box is on a familiar page and an unfamiliar one alike`, async ({ page, context }) => {
    await patchSettings(context, { linkSafety: { enabled: linkCheck } })
    await seedVisits(context, 'well-known.test', 60, { activeDays: 30 })

    for (const url of ['https://well-known.test/', 'https://never-seen.test/']) {
      await serveSite(page, url, blankPage('a page'))
      await expect.poll(() => hostsOnPage(page), { timeout: 8000 }).toBe(1)
    }
  })
}

// The style sheet is fetched by the content script. Were it listed among the
// page's own resources, the page could time it or see it at all.
test('the page\'s resource list shows nothing Visilant loaded', async ({ page }) => {
  await serveSite(page, 'https://never-seen.test/', blankPage('a page'))
  await expect.poll(() => hostsOnPage(page), { timeout: 8000 }).toBe(1)

  const entries: string[] = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))
  expect(entries.filter(name => !name.startsWith('https://never-seen.test/'))).toEqual([])
})
