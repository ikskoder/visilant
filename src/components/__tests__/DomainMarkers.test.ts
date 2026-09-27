import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetLookalikeCache } from '~/composables/useLookalikes'
import DomainMarkers from '../DomainMarkers.vue'
import LookalikeNotice from '../LookalikeNotice.vue'

const SUBDOMAIN_MATCH = {
  domain: 'yourbank.com',
  visits: 40,
  reason: 'familiar-as-subdomain',
  evidence: 'yourbank.com',
  severity: 'high',
}

function answerLookalikes(answer: unknown) {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: any) =>
    message?.type === 'find-lookalikes' ? answer : undefined)
}

afterEach(() => {
  resetLookalikeCache()
  vi.mocked(browser.runtime.sendMessage).mockReset()
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined)
})

describe('domainMarkers component', () => {
  it('renders nothing for an ordinary hostname', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: 'www.example.com' } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders nothing without a hostname', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: '' } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('names the imitated domain and the real site', async () => {
    answerLookalikes([])
    const wrapper = mount(DomainMarkers, { props: { hostname: 'something.com.evil.net' } })
    await flushPromises()
    expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)
    // The tests load no translations, so the key stands in for the sentence and
    // this is also the path a translation that lost its {site} placeholder takes
    expect(wrapper.find('[data-marker-site]').text()).toBe('evil.net')
    expect(wrapper.find('[data-marker-imitated]').text()).toBe('something.com')
  })

  it('leaves the ending to the lookalike line that already explains it', async () => {
    answerLookalikes([SUBDOMAIN_MATCH])
    const wrapper = mount({
      components: { DomainMarkers, LookalikeNotice },
      template: `<div>
        <DomainMarkers hostname="yourbank.com.pay-verify.top" />
        <LookalikeNotice hostname="yourbank.com.pay-verify.top" />
      </div>`,
    })
    await flushPromises()
    expect(wrapper.find('[data-lookalike-reason="familiar-as-subdomain"]').exists()).toBe(true)
    expect(wrapper.find('[data-marker]').exists()).toBe(false)
    // Both components read one answer, so the background is asked once
    const asked = vi.mocked(browser.runtime.sendMessage).mock.calls.filter(([message]: any[]) => message?.type === 'find-lookalikes')
    expect(asked).toHaveLength(1)
  })

  it('holds the ending back while the lookalike answer is on its way', async () => {
    let answer!: (value: unknown) => void
    vi.mocked(browser.runtime.sendMessage).mockImplementation(() => new Promise((resolve) => {
      answer = resolve
    }))
    const wrapper = mount(DomainMarkers, { props: { hostname: 'pending.com.evil.net' } })
    expect(wrapper.find('[data-marker]').exists()).toBe(false)
    answer([])
    await flushPromises()
    expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)
  })

  it('stops holding the ending back after a while, and still takes a late answer', async () => {
    vi.useFakeTimers()
    try {
      let answer!: (value: unknown) => void
      vi.mocked(browser.runtime.sendMessage).mockImplementation(() => new Promise((resolve) => {
        answer = resolve
      }))
      const wrapper = mount({
        components: { DomainMarkers, LookalikeNotice },
        template: `<div>
          <DomainMarkers hostname="slow.yourbank.com.pay-verify.top" />
          <LookalikeNotice hostname="slow.yourbank.com.pay-verify.top" />
        </div>`,
      })
      expect(wrapper.find('[data-marker]').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(2500)
      expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)

      // A worker slow to wake still gets its warning onto the screen
      answer([SUBDOMAIN_MATCH])
      await flushPromises()
      expect(wrapper.find('[data-lookalike-reason="familiar-as-subdomain"]').exists()).toBe(true)
      expect(wrapper.find('[data-marker]').exists()).toBe(false)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('asks separately for an address that came out of an email', async () => {
    answerLookalikes([])
    mount(DomainMarkers, { props: { hostname: 'twice.com.evil.net' } })
    mount(DomainMarkers, { props: { hostname: 'twice.com.evil.net', context: 'email' } })
    await flushPromises()
    const contexts = vi.mocked(browser.runtime.sendMessage).mock.calls.filter(([message]: any[]) => message?.type === 'find-lookalikes').map(([message]: any[]) => message.data.context)
    expect(contexts).toEqual([undefined, 'email'])
  })

  it('shows the ending when the lookalike check could not answer', async () => {
    // The shared mock answers undefined, which is what a torn-down worker does
    const wrapper = mount(DomainMarkers, { props: { hostname: 'yourbank.com.pay-verify.top' } })
    await flushPromises()
    expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)
  })

  it('asks nothing about an address without an embedded ending', async () => {
    mount(DomainMarkers, { props: { hostname: 'a.b.c.d.evil.net' } })
    await flushPromises()
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'find-lookalikes' }))
  })

  it('reads userinfo off the URL when one is given', () => {
    const wrapper = mount(DomainMarkers, {
      props: { hostname: 'evil.net', url: 'https://paypal.com@evil.net/login' },
    })
    expect(wrapper.text()).toContain('paypal.com')
  })

  it('renders one row per marker', async () => {
    answerLookalikes([])
    const wrapper = mount(DomainMarkers, {
      props: {
        hostname: 'paypal.com.a.b.secure.evil.net',
        url: 'https://user@paypal.com.a.b.secure.evil.net/',
      },
    })
    await flushPromises()
    // userinfo + embedded ending + depth
    expect(wrapper.findAll('span[aria-hidden="true"]')).toHaveLength(3)
  })

  it('draws the subdomain depth as a plain number, not as part of an address', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: 'a.b.c.d.evil.net' } })
    const count = wrapper.find('[data-marker="deep-subdomains"] [data-marker-count]')
    expect(count.text()).toBe('4')
    // No digit highlighting inside it, which is what SecureText would add
    expect(count.find('.secure-domain-display').exists()).toBe(false)
    expect(count.html()).not.toContain('text-blue')
  })

  it('never echoes a password from the URL', () => {
    const wrapper = mount(DomainMarkers, {
      props: { hostname: 'evil.net', url: 'https://user:hunter2@evil.net/' },
    })
    expect(wrapper.text()).not.toContain('hunter2')
  })
})
