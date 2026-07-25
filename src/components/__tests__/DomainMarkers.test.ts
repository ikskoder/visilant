import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DomainMarkers from '../DomainMarkers.vue'

describe('domainMarkers component', () => {
  it('renders nothing for an ordinary hostname', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: 'www.example.com' } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders nothing without a hostname', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: '' } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('shows the evidence for a domain ending used as a subdomain', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: 'paypal.com.evil.net' } })
    expect(wrapper.text()).toContain('com')
    expect(wrapper.findAll('span[aria-hidden="true"]')).toHaveLength(1)
  })

  it('reads userinfo off the URL when one is given', () => {
    const wrapper = mount(DomainMarkers, {
      props: { hostname: 'evil.net', url: 'https://paypal.com@evil.net/login' },
    })
    expect(wrapper.text()).toContain('paypal.com')
  })

  it('renders one row per marker', () => {
    const wrapper = mount(DomainMarkers, {
      props: {
        hostname: 'paypal.com.a.b.secure.evil.net',
        url: 'https://user@paypal.com.a.b.secure.evil.net/',
      },
    })
    // userinfo + embedded ending + depth
    expect(wrapper.findAll('span[aria-hidden="true"]')).toHaveLength(3)
  })

  it('never echoes a password from the URL', () => {
    const wrapper = mount(DomainMarkers, {
      props: { hostname: 'evil.net', url: 'https://user:hunter2@evil.net/' },
    })
    expect(wrapper.text()).not.toContain('hunter2')
  })
})
