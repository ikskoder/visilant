import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser from 'webextension-polyfill'
import { settings } from '~/logic/storage'
import CheckField from '../CheckField.vue'
import Popup from '../Popup.vue'

// The details page is opened for a link's hostname or an email's domain, which
// is frequently not the hostname visits were recorded under
const record = {
  count: 42,
  lastSeen: Date.UTC(2026, 7, 9),
  firstSeen: Date.UTC(2026, 4, 7),
  activeDays: 14,
  ignored: false,
}

/**
 * The same site before it was known: two visits, one day, first seen today.
 *
 * `record` above clears every default bar, and the warnings row is only drawn
 * where a warning could actually fire – so anything about that row needs a site
 * the checks have not passed yet.
 */
const unfamiliar = {
  count: 2,
  lastSeen: Date.now(),
  firstSeen: Date.now(),
  activeDays: 1,
  ignored: false,
}

function stubLocalStorage(data: Record<string, unknown>) {
  ;(browser.storage as any).local = {
    get: vi.fn().mockResolvedValue(data),
    set: vi.fn().mockResolvedValue(undefined),
  }
}

async function mountForDomain(domain: string) {
  window.history.replaceState({}, '', `/dist/popup/index.html?domain=${domain}`)
  const wrapper = mount(Popup)
  await flushPromises()
  return wrapper
}

/**
 * The text of one fact cell, rather than of the whole panel.
 *
 * Asserting a number against `wrapper.text()` reads every other number on the
 * page too, and this panel carries one that moves on its own: the age criterion
 * renders the days since the first visit, which passed 612 in September 2026.
 * `not.toContain('12')`, written to prove that active days are not summed,
 * therefore started failing on a calendar date and would have kept doing it
 * through every 12x and 120x-day window afterwards.
 */
function criterion(wrapper: ReturnType<typeof mount>, id: string) {
  return wrapper.get(`[data-criterion="${id}"]`).text()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('popup as a standalone page', () => {
  // This page was opened about a site the reader had just been looking at, so
  // the exclusion shortcut belongs here – unlike on the check page, where the
  // name on screen was typed into a field
  it('offers the anti-tampering control, record or not', async () => {
    stubLocalStorage({})
    const wrapper = await mountForDomain('never-visited.example')

    expect(wrapper.text()).toContain('antiTampering')
  })

  it('shows the visit facts when the address has a record of its own', async () => {
    stubLocalStorage({ 'example.com': record })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.find('[data-criterion="activeDays"]').exists()).toBe(true)
    expect(criterion(wrapper, 'activeDays')).toContain('14')
    expect(wrapper.text()).not.toContain('statsFamilyWide')
  })

  /**
   * The panel never borrows the family's numbers for the address it names.
   *
   * It used to, whenever the address had no record of its own, with a caption to
   * say the facts were family-wide. That put a number under a hostname that was
   * sometimes the host's and sometimes the family's – and on the check page it
   * sat a few pixels under the field's own fold of the family, so one screen
   * carried two rows headed `Visits` with different numbers in them. The
   * family's figures moved to the base domain, which is the name they are about,
   * and this row now answers only for the name above it.
   */
  it('answers for the exact address, with the family under the base domain', async () => {
    stubLocalStorage({ 'www.example.com': record })
    const wrapper = await mountForDomain('example.com')

    // Nothing is recorded for `example.com` itself, and the row says so rather
    // than showing what the subdomain has been up to
    expect(criterion(wrapper, 'activeDays')).toContain('statsUnknown')
    expect(criterion(wrapper, 'visits')).toContain('0')

    // The family's own facts, under the family's own name
    const family = wrapper.get('[data-family-stats]')
    expect(family.get('[data-criterion="activeDays"]').text()).toContain('14')
  })

  it('takes the earliest first visit across the family, and says it in days', async () => {
    stubLocalStorage({
      'a.example.com': { ...record, firstSeen: Date.UTC(2025, 0, 1), activeDays: 3 },
      'b.example.com': { ...record, firstSeen: Date.UTC(2026, 0, 1), activeDays: 9 },
    })
    const wrapper = await mountForDomain('example.com')
    const family = wrapper.get('[data-family-stats]')

    // The count is what the age check is made of, so it is the number on show.
    // 2025 is a year and a bit back, which no reading of the later date is.
    const age = family.get('[data-criterion="age"]')
    expect(Number.parseInt(age.text(), 10)).toBeGreaterThan(365)
    // The date it was measured from is still there, one hover away
    expect(age.attributes('title')).toContain('2025')

    // Days overlap between subdomains, so the largest is the honest floor
    const activeDays = family.get('[data-criterion="activeDays"]').text()
    expect(activeDays).toContain('9')
    expect(activeDays).not.toContain('12')
  })

  it('shows the visit count as a fact in the row, not beside the hostname', async () => {
    stubLocalStorage({ 'example.com': record })
    const wrapper = await mountForDomain('example.com')

    // One count on the panel, in the column that names the check it belongs to
    expect(wrapper.findAll('[data-criterion="visits"]')).toHaveLength(1)
    expect(criterion(wrapper, 'visits')).toContain('42')
  })

  /**
   * A zero is an answer. The row used to disappear entirely when there was no
   * record, which leaves a reader working out whether the address was never
   * visited or whether the panel simply failed to say – and those are the two
   * things a check page exists to tell apart. A host nothing is ever counted for
   * is the one case that still says so in words instead, above.
   */
  it('says nothing was recorded rather than dropping the row', async () => {
    stubLocalStorage({})
    const wrapper = await mountForDomain('never-visited.example')

    expect(criterion(wrapper, 'visits')).toContain('0')
    expect(criterion(wrapper, 'activeDays')).toContain('statsUnknown')
    // No family either, so nothing is borrowed from one
    expect(wrapper.find('[data-family-stats]').exists()).toBe(false)
  })
})

/**
 * The switch that used to be a button inside the in-page warning.
 *
 * It moved here because a page cannot reach into this window: it cannot draw
 * over it, script it, or tell the reader to press something in it while they
 * are looking at the page. So this is now the only place warnings can be turned
 * off, which is why the row has to be here whichever way it is set.
 */
describe('turning the warnings off for a site', () => {
  it('offers the switch on a site the warnings can still fire on', async () => {
    stubLocalStorage({ 'example.com': unfamiliar })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).toContain('warningsActiveNotice')
    expect(wrapper.text()).toContain('ignoredSiteSilence')
    expect(wrapper.text()).not.toContain('ignoredSiteNotice')
  })

  /**
   * Nothing warns on a familiar site, so a switch offering to turn a warning
   * off there promises a guard that was never posted.
   */
  it('keeps the row away from a familiar site', async () => {
    stubLocalStorage({ 'example.com': record })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).not.toContain('warningsActiveNotice')
    expect(wrapper.text()).not.toContain('ignoredSiteSilence')
    // The anti-tampering row is not a function of the verdict and stays put
    expect(wrapper.text()).toContain('antiTamperingProtected')
  })

  // A zero that can never move is not a site the warnings have anything to say
  // about – the content script treats it as safe for exactly that reason
  it('keeps the row away from a host that is never counted', async () => {
    stubLocalStorage({})
    const wrapper = await mountForDomain('localhost')

    expect(wrapper.text()).not.toContain('warningsActiveNotice')
  })

  /**
   * The half that matters: this window is the only place an exception can be
   * lifted, so a silenced site keeps the row whatever its verdict says. A
   * familiar record here, which would otherwise take the row away.
   */
  it('offers the way back on a site that is silenced', async () => {
    stubLocalStorage({ 'example.com': { ...record, ignored: true } })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).toContain('ignoredSiteNotice')
    expect(wrapper.text()).toContain('ignoredSiteResume')
    expect(wrapper.text()).not.toContain('ignoredSiteSilence')
  })

  it('asks the background to silence the host, and not some parent of it', async () => {
    stubLocalStorage({ 'shop.example.com': unfamiliar })
    const sent = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined as never)
    const wrapper = await mountForDomain('shop.example.com')

    const button = wrapper.findAll('button').find(b => b.text() === 'ignoredSiteSilence')!
    await button.trigger('click')
    await flushPromises()

    expect(sent).toHaveBeenCalledWith({
      type: 'ignore-site',
      data: { hostname: 'shop.example.com', ignored: true },
    })
  })

  it('asks the background to lift it again', async () => {
    stubLocalStorage({ 'example.com': { ...record, ignored: true } })
    const sent = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined as never)
    const wrapper = await mountForDomain('example.com')

    const button = wrapper.findAll('button').find(b => b.text() === 'ignoredSiteResume')!
    await button.trigger('click')
    await flushPromises()

    expect(sent).toHaveBeenCalledWith({
      type: 'ignore-site',
      data: { hostname: 'example.com', ignored: false },
    })
  })

  /**
   * The name here was typed into a field rather than visited, so there is no
   * site this window is about and nothing to silence.
   *
   * Checked after a name has been entered, not on the empty page: with the
   * field still blank there is no hostname and the whole panel is absent, so
   * an empty page would pass this whether the check-page rule existed or not.
   */
  it('keeps the switch off the check page', async () => {
    // Unfamiliar, so the row would be there on any other page
    stubLocalStorage({ 'example.com': unfamiliar })
    window.history.replaceState({}, '', '/dist/popup/index.html?check=1')
    const wrapper = mount(Popup)
    await flushPromises()

    wrapper.findComponent(CheckField).vm.$emit('checked-domain', 'example.com')
    await flushPromises()

    // The panel is up – the facts are there – and the switch still is not
    expect(wrapper.find('[data-criterion="activeDays"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('ignoredSiteSilence')
    expect(wrapper.text()).not.toContain('warningsActiveNotice')
  })
})

/**
 * The list under the panel, which is about the rest of the family.
 *
 * Everything it can say about the address at the top of the page is already
 * said there, in a panel that names the checks and the bars they have to clear.
 * So the list earns its place only when there is another host in it.
 */
describe('the domain family list', () => {
  beforeEach(() => {
    settings.value.listMetric = 'visits'
    settings.value.sortByName = false
    settings.value.sortOrder = 'desc'
  })

  it('stays away when the site is the only host in its family', async () => {
    stubLocalStorage({ 'example.com': record })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.find('[data-family-stats]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('relatedDomains')
    // The facts are on the panel above, so this is not an empty profile either
    expect(wrapper.text()).not.toContain('noVisitData')
  })

  it('appears as soon as there is another host to compare against', async () => {
    stubLocalStorage({ 'example.com': record, 'www.example.com': record })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).toContain('relatedDomains')
    // Visits are the one fact that adds up, and the family's row is where the
    // sum lives now – it used to be repeated beside the list's heading as well
    const family = wrapper.get('[data-family-stats]')
    expect(family.get('[data-criterion="visits"]').text()).toContain('84')
  })

  /**
   * A row of numbers that does not say what it covers or how it got there.
   *
   * On a base domain that is also the address the window is about, the name and
   * its heading are skipped – and the card was then a bare row of figures with
   * nothing to say they summarised the list below it. Worse, the figures are
   * folded two different ways: 84 visits is a sum and 14 active days is the best
   * single host, so read side by side without a word about it they invite a
   * comparison that means nothing.
   */
  it('says what the family row covers and how each figure was folded', async () => {
    stubLocalStorage({ 'example.com': record, 'www.example.com': record })
    const wrapper = await mountForDomain('example.com')

    // The name is the one already at the top of the page, so the heading that
    // would repeat it is skipped – and this line has to be there regardless
    expect(wrapper.text()).not.toContain('baseDomain')
    expect(wrapper.text()).toContain('familySummaryTitle')

    const family = wrapper.get('[data-family-stats]')
    expect(family.get('[data-fold="visits"]').text()).toContain('foldTotal')
    expect(family.get('[data-fold="activeDays"]').text()).toContain('foldMax')
    expect(family.get('[data-fold="age"]').text()).toContain('foldMax')

    // The card about one host says nothing of the kind – nothing is folded there
    expect(wrapper.findAll('[data-fold]')).toHaveLength(3)
  })

  it('leaves out the base domain when it is the name already on show', async () => {
    stubLocalStorage({ 'example.com': record, 'www.example.com': record })

    const onBase = await mountForDomain('example.com')
    expect(onBase.text()).not.toContain('baseDomain')

    const onSubdomain = await mountForDomain('www.example.com')
    expect(onSubdomain.text()).toContain('baseDomain')
  })

  it('draws the metric the dropdown asks for, folded the way that metric folds', async () => {
    stubLocalStorage({
      'example.com': { ...record, activeDays: 14 },
      'www.example.com': { ...record, activeDays: 9 },
    })
    const wrapper = await mountForDomain('example.com')

    await wrapper.get('[data-list-metric]').setValue('activeDays')
    await flushPromises()

    // Days spent on two hosts of one family are not two days of knowing it, so
    // the family takes the largest single member rather than the sum
    const family = wrapper.get('[data-family-stats]')
    expect(family.get('[data-criterion="activeDays"]').text()).toContain('14')
    // And the column now carries that number rather than the visit count
    const rows = wrapper.findAll('[data-family-value]')
    expect(rows.map(row => row.text())).toEqual(['14', '9'])
  })

  /**
   * The reason the metric and the order are two settings rather than one.
   *
   * As a single row of chips with `Name` among them, ordering alphabetically
   * also meant answering "and which number, then?" – and the only answer was to
   * drop whatever the reader had chosen.
   */
  it('keeps the number on show when the order goes alphabetical', async () => {
    stubLocalStorage({
      'zebra.example.com': { ...record, activeDays: 14 },
      'alpha.example.com': { ...record, activeDays: 9 },
    })
    const wrapper = await mountForDomain('zebra.example.com')

    await wrapper.get('[data-list-metric]').setValue('activeDays')
    await wrapper.get('[data-sort-by-name]').trigger('click')
    await flushPromises()

    // Alphabetical, descending – and still active days in the column
    const rows = wrapper.findAll('[data-family-value]')
    expect(rows.map(row => row.text())).toEqual(['14', '9'])
  })
})

describe('hostnames that are never counted', () => {
  it('explains itself instead of showing a zero that can never move', async () => {
    stubLocalStorage({})
    const wrapper = await mountForDomain('localhost')

    expect(wrapper.text()).toContain('untrackedHostTitle')
    expect(wrapper.text()).toContain('untrackedHostText')
    // A dash, not a count, and no promise that data is merely missing
    expect(wrapper.text()).not.toContain('noVisitData')
  })

  it('leaves an ordinary address alone', async () => {
    stubLocalStorage({ 'example.com': record })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).not.toContain('untrackedHostTitle')
    expect(wrapper.text()).toContain('42')
  })
})
