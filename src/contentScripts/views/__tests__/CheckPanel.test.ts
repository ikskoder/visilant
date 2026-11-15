import type { CheckPanelData } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { analyzeEmailAddress } from '~/logic/email-safety'
import CheckPanel from '../CheckPanel.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given

const DAY = 24 * 60 * 60 * 1000
const known = { count: 120, activeDays: 60, firstSeen: Date.now() - 400 * DAY }

function panel(data: Partial<CheckPanelData> & Pick<CheckPanelData, 'hostname' | 'family'>) {
  return mount(CheckPanel, {
    props: { visible: true, fontSize: 100, data: { kind: 'domain', punycode: null, email: null, ...data } },
  })
}

describe('what the check panel says about the site', () => {
  // The badge reads "Never visited" and there is nothing else to tell
  it('says nothing more about a name with no record that is its own site', () => {
    const wrapper = panel({ hostname: 'new-place.test', family: { baseDomain: 'new-place.test', entries: [], total: 0 } })
    expect(wrapper.find('[data-verdict="never"]').exists()).toBe(true)
    expect(wrapper.find('[data-criterion]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('baseDomain')
    expect(wrapper.text()).not.toContain('noVisitData')
    expect(wrapper.text()).not.toContain('relatedDomains')
  })

  // Its name and its count are at the top of the panel already
  it('does not list a site whose only address is the one checked', () => {
    const wrapper = panel({ hostname: 'low.test', family: { baseDomain: 'low.test', key: 'low.test', entries: [{ hostname: 'low.test', count: 3 }], total: 3 } })
    expect(wrapper.findAll('[data-criterion="visits"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('baseDomain')
    expect(wrapper.text()).not.toContain('relatedDomains')
  })

  it('names the site and lists its addresses when there are others', () => {
    const wrapper = panel({
      hostname: 'checkout.paypal.test',
      family: { baseDomain: 'paypal.test', key: 'checkout.paypal.test', entries: [{ hostname: 'paypal.test', ...known }, { hostname: 'checkout.paypal.test', count: 4 }], total: 124, stats: known },
    })
    expect(wrapper.text()).toContain('baseDomain')
    expect(wrapper.text()).toContain('relatedDomains')
    expect(wrapper.find('[data-family-stats]').exists()).toBe(true)
  })

  it('says so when the checked address is all that is recorded on its site', () => {
    const wrapper = panel({
      hostname: 'blog.solo.test',
      family: { baseDomain: 'solo.test', key: 'blog.solo.test', entries: [{ hostname: 'blog.solo.test', ...known }], total: 120 },
    })
    expect(wrapper.text()).toContain('baseDomain')
    expect(wrapper.find('[data-family-only-host]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('relatedDomains')
  })

  it('says a site named apart from the address has no visits', () => {
    const wrapper = panel({ hostname: 'shop.brand-new.test', family: { baseDomain: 'brand-new.test', entries: [], total: 0 } })
    expect(wrapper.text()).toContain('baseDomain')
    expect(wrapper.text()).toContain('noVisitData')
  })

  // The provider's own facts are left out, so the row is the only place its count is given
  it('keeps the one row for a mail provider that has a record of its own', () => {
    const wrapper = panel({
      kind: 'email',
      hostname: 'corpmail.test',
      email: { analysis: analyzeEmailAddress('ann@corpmail.test')!, providerKind: 'public' },
      family: { baseDomain: 'corpmail.test', key: 'corpmail.test', entries: [{ hostname: 'corpmail.test', count: 7 }], total: 7 },
    })
    expect(wrapper.find('[data-own-facts]').exists()).toBe(false)
    expect(wrapper.text()).toContain('relatedDomains')
    expect(wrapper.text()).toContain('7')
  })

  // One verdict on one record: the badge used to read "Unfamiliar site" over
  // a line reading "Never visited"
  it('says an address domain was never visited once, in the verdict under the address', () => {
    const wrapper = panel({
      kind: 'email',
      hostname: 'corp.test',
      email: { analysis: analyzeEmailAddress('ann@corp.test')!, providerKind: 'regular' },
      family: { baseDomain: 'corp.test', entries: [], total: 0 },
    })
    expect(wrapper.find('[data-address-status] [data-verdict="never"]').exists()).toBe(true)
    expect(wrapper.find('[data-never-visited]').exists()).toBe(false)
    expect(wrapper.find('[data-own-facts]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('noVisitData')
  })
})
