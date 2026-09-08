import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser from 'webextension-polyfill'
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

    expect(wrapper.text()).toContain('activeDaysLabel')
    expect(criterion(wrapper, 'activeDays')).toContain('14')
    expect(wrapper.text()).not.toContain('statsFamilyWide')
  })

  it('falls back to the domain family when only subdomains have records', async () => {
    stubLocalStorage({ 'www.example.com': record })
    const wrapper = await mountForDomain('example.com')

    // Facts, and a line saying they are not about this exact address
    expect(wrapper.text()).toContain('activeDaysLabel')
    expect(criterion(wrapper, 'activeDays')).toContain('14')
    expect(wrapper.text()).toContain('statsFamilyWide')
  })

  it('takes the earliest first visit and the latest last visit across the family', async () => {
    stubLocalStorage({
      'a.example.com': { ...record, firstSeen: Date.UTC(2025, 0, 1), lastSeen: Date.UTC(2026, 0, 1), activeDays: 3 },
      'b.example.com': { ...record, firstSeen: Date.UTC(2026, 0, 1), lastSeen: Date.UTC(2026, 7, 9), activeDays: 9 },
    })
    const wrapper = await mountForDomain('example.com')

    expect(criterion(wrapper, 'age')).toContain('2025')
    // Days overlap between subdomains, so the largest is the honest floor
    const activeDays = criterion(wrapper, 'activeDays')
    expect(activeDays).toContain('9')
    expect(activeDays).not.toContain('12')
  })

  it('shows no facts row when nothing in the family was ever visited', async () => {
    stubLocalStorage({})
    const wrapper = await mountForDomain('never-visited.example')

    expect(wrapper.text()).not.toContain('activeDaysLabel')
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
  it('offers the switch on a site that is not silenced', async () => {
    stubLocalStorage({ 'example.com': record })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).toContain('warningsActiveNotice')
    expect(wrapper.text()).toContain('ignoredSiteSilence')
    expect(wrapper.text()).not.toContain('ignoredSiteNotice')
  })

  it('offers the way back on a site that is', async () => {
    stubLocalStorage({ 'example.com': { ...record, ignored: true } })
    const wrapper = await mountForDomain('example.com')

    expect(wrapper.text()).toContain('ignoredSiteNotice')
    expect(wrapper.text()).toContain('ignoredSiteResume')
    expect(wrapper.text()).not.toContain('ignoredSiteSilence')
  })

  it('asks the background to silence the host, and not some parent of it', async () => {
    stubLocalStorage({ 'shop.example.com': record })
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
    stubLocalStorage({ 'example.com': record })
    window.history.replaceState({}, '', '/dist/popup/index.html?check=1')
    const wrapper = mount(Popup)
    await flushPromises()

    wrapper.findComponent(CheckField).vm.$emit('checked-domain', 'example.com')
    await flushPromises()

    // The panel is up – the facts are there – and the switch still is not
    expect(wrapper.text()).toContain('activeDaysLabel')
    expect(wrapper.text()).not.toContain('ignoredSiteSilence')
    expect(wrapper.text()).not.toContain('warningsActiveNotice')
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
