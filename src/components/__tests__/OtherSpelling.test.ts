import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AddressBlock from '../AddressBlock.vue'
import OtherSpelling from '../OtherSpelling.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given

describe('otherSpelling component', () => {
  // Under a coded address, what it was made to be read as
  it('gives the readable name under an xn-- address', () => {
    const wrapper = mount(OtherSpelling, { props: { shown: 'xn--e1afmkfd.test', other: 'пример.test' } })
    expect(wrapper.text()).toContain('addressMeantToReadAs')
    expect(wrapper.text()).toContain('пример')
  })

  it('gives the coded form under a readable address, a subdomain included', () => {
    expect(mount(OtherSpelling, { props: { shown: 'пример.test', other: 'xn--e1afmkfd.test' } }).text()).toContain('domainPunycode')
    expect(mount(OtherSpelling, { props: { shown: 'www.xn--e1afmkfd.test', other: 'www.пример.test' } }).text()).toContain('addressMeantToReadAs')
  })

  it('draws nothing for a name with one spelling', () => {
    expect(mount(OtherSpelling, { props: { shown: 'example.test', other: null } }).find('[data-other-spelling]').exists()).toBe(false)
    expect(mount(OtherSpelling, { props: { shown: 'example.test', other: 'example.test' } }).find('[data-other-spelling]').exists()).toBe(false)
  })

  // Part of the address, not one of the findings about it: no warning sign,
  // and before the verdict, not among the lines under it
  it('sits straight under the address, before the status, with no sign of its own', () => {
    const badge = { verdict: 'never', text: 'Never visited', tone: 'danger' as const, icon: 'shield-fail' as const }
    const wrapper = mount(AddressBlock, { props: { hostname: 'xn--e1afmkfd.test', punycode: 'пример.test', badge, familiar: false } })
    const line = wrapper.get('[data-other-spelling]')
    expect(line.find('.vz-notice').exists()).toBe(false)
    expect(line.find('.vz-icon--shield-alert, .vz-icon--alert, .vz-icon--flag').exists()).toBe(false)
    const html = wrapper.html()
    expect(html.indexOf('data-other-spelling')).toBeLessThan(html.indexOf('data-address-status'))
    expect(wrapper.findAll('[data-other-spelling]')).toHaveLength(1)
  })
})
