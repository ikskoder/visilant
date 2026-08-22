import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser from 'webextension-polyfill'
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
    expect(wrapper.text()).toContain('14')
    expect(wrapper.text()).not.toContain('statsFamilyWide')
  })

  it('falls back to the domain family when only subdomains have records', async () => {
    stubLocalStorage({ 'www.example.com': record })
    const wrapper = await mountForDomain('example.com')

    // Facts, and a line saying they are not about this exact address
    expect(wrapper.text()).toContain('activeDaysLabel')
    expect(wrapper.text()).toContain('14')
    expect(wrapper.text()).toContain('statsFamilyWide')
  })

  it('takes the earliest first visit and the latest last visit across the family', async () => {
    stubLocalStorage({
      'a.example.com': { ...record, firstSeen: Date.UTC(2025, 0, 1), lastSeen: Date.UTC(2026, 0, 1), activeDays: 3 },
      'b.example.com': { ...record, firstSeen: Date.UTC(2026, 0, 1), lastSeen: Date.UTC(2026, 7, 9), activeDays: 9 },
    })
    const wrapper = await mountForDomain('example.com')

    const text = wrapper.text()
    expect(text).toContain('2025')
    // Days overlap between subdomains, so the largest is the honest floor
    expect(text).toContain('9')
    expect(text).not.toContain('12')
  })

  it('shows no facts row when nothing in the family was ever visited', async () => {
    stubLocalStorage({})
    const wrapper = await mountForDomain('never-visited.example')

    expect(wrapper.text()).not.toContain('activeDaysLabel')
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
