import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetLookalikeCache } from '~/composables/useLookalikes'
import { ADDRESS_SHAPE_KEY } from '~/logic/address-shape'
import { addressShape } from '~/logic/domain-boundary'
import DomainMarkers from '../DomainMarkers.vue'
import LookalikeNotice from '../LookalikeNotice.vue'
import RedFlagCount from '../RedFlagCount.vue'

const SUBDOMAIN_MATCH = {
  domain: 'yourbank.com',
  visits: 40,
  reason: 'familiar-as-subdomain',
  evidence: 'yourbank.com',
  severity: 'high',
}

/**
 * What the background sends when the lookalike check could not run. The line
 * about a domain parked in front is drawn only then: with an answer in hand,
 * a familiar one has its lookalike line and an unknown one imitates nothing
 * the user trusts.
 */
const NO_ANSWER = undefined

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

  it('says a platform tenant is not the platform, unless the site is familiar', () => {
    const global = { provide: { [ADDRESS_SHAPE_KEY as symbol]: addressShape } }
    const tenant = mount(DomainMarkers, { props: { hostname: 'someone.github.io' }, global })
    expect(tenant.find('[data-marker="hosted-on"] [data-marker-platform]').text()).toBe('github.io')
    // Drawn as the address above draws the same two labels: an ending, on the
    // tint in grey. It used to be white, as an address with no site in it
    const platform = tenant.get('[data-marker-platform]')
    expect(platform.findAll('[data-owner] .vz-lbl--sfx').map(label => label.text())).toEqual(['github', 'io'])
    // And in the line's own orange, which the address above gives them too
    expect(platform.findAll('.vz-lbl').map(label => label.attributes('data-tone'))).toEqual(['caution', 'caution'])

    expect(mount(DomainMarkers, { props: { hostname: 'someone.github.io', familiar: true }, global })
      .find('[data-marker="hosted-on"]').exists()).toBe(false)
    expect(mount(DomainMarkers, { props: { hostname: 'github.com' }, global })
      .find('[data-marker="hosted-on"]').exists()).toBe(false)
  })

  // The flag in red is for what is built to be misread, the orange shield for the rest
  it('draws a red flag on a red flag and the orange shield on any other finding', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: 'a.b.c.d.evil.test', url: 'https://paypal.com@a.b.c.d.evil.test/' } })
    const flag = wrapper.get('[data-marker="url-userinfo"]')
    expect(flag.attributes()).toHaveProperty('data-red-flag')
    expect(flag.attributes('data-tone')).toBe('danger')
    expect(flag.find('.vz-icon--flag').exists()).toBe(true)
    const caution = wrapper.get('[data-marker="deep-subdomains"]')
    expect(caution.attributes()).not.toHaveProperty('data-red-flag')
    expect(caution.attributes('data-tone')).toBe('caution')
    expect(caution.find('.vz-icon--shield-alert').exists()).toBe(true)
  })

  // The count beside the verdict is about the red flags, so they come first
  // whatever order the checks found them in
  it('puts the red flags before the lines that are only worth a look', () => {
    const props = { hostname: 'someone.a.b.c.github.io', url: 'https://paypal.com@someone.a.b.c.github.io/' }
    const global = { provide: { [ADDRESS_SHAPE_KEY as symbol]: addressShape } }
    const order = (show?: 'flags' | 'cautions') => mount(DomainMarkers, { props: { ...props, show }, global })
      .findAll('[data-marker]')
      .map(line => line.attributes('data-marker'))
    expect(order()).toEqual(['url-userinfo', 'deep-subdomains', 'hosted-on'])
    // The two halves a caller can put something between
    expect(order('flags')).toEqual(['url-userinfo'])
    expect(order('cautions')).toEqual(['deep-subdomains', 'hosted-on'])
  })

  it('counts the same red flags the lines draw', async () => {
    answerLookalikes([SUBDOMAIN_MATCH])
    const count = mount(RedFlagCount, { props: { hostname: 'yourbank.com.evil.net', url: 'https://x@yourbank.com.evil.net/' } })
    const lines = mount({ components: { DomainMarkers, LookalikeNotice }, template: '<div><DomainMarkers hostname="yourbank.com.evil.net" url="https://x@yourbank.com.evil.net/" /><LookalikeNotice hostname="yourbank.com.evil.net" /></div>' })
    await flushPromises()
    // The decoy name and the lookalike. The embedded ending is explained by the
    // lookalike line, so it is neither drawn nor counted.
    expect(lines.findAll('[data-red-flag]')).toHaveLength(2)
    expect(count.attributes('data-red-flags')).toBe('2')
  })

  // The name of Latin twins and the lookalike line about the same name are one
  // trick, drawn once and counted once, as the click was decided on
  it('counts a name of Latin twins once when it copies a familiar site', async () => {
    answerLookalikes([{ domain: 'apple.com', visits: 40, reason: 'confusable', evidence: 'аррӏе', severity: 'high' }])
    const count = mount(RedFlagCount, { props: { hostname: 'xn--80ak6aa92e.com' } })
    const lines = mount({ components: { DomainMarkers, LookalikeNotice }, template: '<div><DomainMarkers hostname="xn--80ak6aa92e.com" /><LookalikeNotice hostname="xn--80ak6aa92e.com" /></div>' })
    await flushPromises()
    expect(lines.find('[data-marker="non-latin-name"]').exists()).toBe(false)
    expect(lines.findAll('[data-red-flag]')).toHaveLength(1)
    expect(count.attributes('data-red-flags')).toBe('1')
  })

  it('draws a name of Latin twins when no familiar site explains it', async () => {
    answerLookalikes([])
    const wrapper = mount(DomainMarkers, { props: { hostname: 'xn--80ak6aa92e.com' } })
    await flushPromises()
    expect(wrapper.find('[data-marker="non-latin-name"]').attributes()).toHaveProperty('data-red-flag')
  })

  it('renders nothing without a hostname', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: '' } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('names the imitated domain and the real site', async () => {
    answerLookalikes(NO_ANSWER)
    const wrapper = mount(DomainMarkers, { props: { hostname: 'something.com.evil.net' } })
    await flushPromises()
    expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)
    // The tests load no translations, so the key stands in for the sentence and
    // this is also the path a translation that lost its {site} placeholder takes
    expect(wrapper.find('[data-marker-site]').text()).toBe('evil.net')
    expect(wrapper.find('[data-marker-imitated]').text()).toBe('something.com')
  })

  // The levels between the decoy and the owner's name are the owner's to
  // write, and can spell a second reassuring name as easily as the first
  it('names the owner\'s site alone once the shape of the address is known', async () => {
    answerLookalikes(NO_ANSWER)
    const global = { provide: { [ADDRESS_SHAPE_KEY as symbol]: addressShape } }
    const known = mount(DomainMarkers, { props: { hostname: 'paypal.com.a.b.c.verify.com' }, global })
    await flushPromises()
    expect(known.find('[data-marker-site]').text()).toBe('verify.com')
    // Until it is, everything after the decoy, which always contains the site
    const unknown = mount(DomainMarkers, { props: { hostname: 'paypal.com.a.b.c.verify.com' }, global: { provide: { [ADDRESS_SHAPE_KEY as symbol]: () => undefined } } })
    await flushPromises()
    expect(unknown.find('[data-marker-site]').text()).toBe('a.b.c.verify.com')
  })

  // An owner longer than what the check took for the site: the line named
  // `uk.com`, an ending anybody can register under, as the real site
  it('takes the real site from the address itself, never a bare ending', async () => {
    answerLookalikes(NO_ANSWER)
    // The check takes `uk.com` for the site here, one label short of the owner
    const shape = () => ({ ownerLabels: 3, suffixLabels: 2 })
    const wrapper = mount(DomainMarkers, { props: { hostname: 'paypal.com.uk.com' }, global: { provide: { [ADDRESS_SHAPE_KEY as symbol]: shape } } })
    await flushPromises()
    expect(wrapper.get('[data-marker-site]').text()).toBe('com.uk.com')
  })

  // The same trick played twice is said twice, in one line
  it('names every domain parked in front, with "or" between them and no comma', async () => {
    answerLookalikes(NO_ANSWER)
    const global = { provide: { [ADDRESS_SHAPE_KEY as symbol]: addressShape } }
    const wrapper = mount(DomainMarkers, { props: { hostname: 'paypal.com.google.com.apple.com.verify.com' }, global })
    await flushPromises()
    const line = wrapper.get('[data-marker="embedded-public-suffix"]')
    expect(line.findAll('[data-marker-imitated]').map(name => name.text())).toEqual(['paypal.com', 'google.com', 'apple.com'])
    expect(line.get('[data-marker-site]').text()).toBe('verify.com')
    expect(line.text().split('listOr')).toHaveLength(3)
    // A comma after an address reads as one of its dots
    expect(line.text()).not.toContain(',')
  })

  // A full stop straight after a piece of an address is one more dot of it
  it('starts what follows a piece of an address on a line of its own, with no full stop', async () => {
    answerLookalikes([])
    const wrapper = mount(DomainMarkers, { props: { hostname: 'пример.com' } })
    await flushPromises()
    const line = wrapper.get('[data-marker="non-latin-name"]')
    expect(line.get('[data-marker-why]').classes()).toContain('block')
    expect(line.text()).not.toMatch(/com\s*\./)
    // After a count the sentence simply goes on
    const deep = mount(DomainMarkers, { props: { hostname: 'a.b.c.d.evil.test' } })
    await flushPromises()
    expect(deep.get('[data-marker="deep-subdomains"] [data-marker-why]').classes()).not.toContain('block')
  })

  // Every piece of an address quoted in a line is drawn in its frame
  it('frames the name in another alphabet and the ending it stands before', async () => {
    answerLookalikes([])
    const wrapper = mount(DomainMarkers, { props: { hostname: 'пример.com' } })
    await flushPromises()
    const line = wrapper.get('[data-marker="non-latin-name"]')
    expect(line.get('[data-marker-name]').text()).toBe('пример')
    expect(line.find('[data-marker-name] .vz-lbl').exists()).toBe(true)
    expect(line.get('[data-marker-ending]').text()).toBe('com')
    expect(line.find('[data-marker-ending] .vz-lbl').exists()).toBe(true)
    // The ending as an ending, on the tint in grey, and the name in the red
    // the address above draws it in
    expect(line.find('[data-marker-ending] [data-owner] .vz-lbl--sfx').exists()).toBe(true)
    expect(line.get('[data-marker-name] .vz-lbl').attributes('data-tone')).toBe('danger')
    // The name before the ending, as the address has them
    expect(line.html().indexOf('data-marker-name')).toBeLessThan(line.html().indexOf('data-marker-ending'))
    // With examples in its own alphabet, since Cyrillic has endings of its own
    expect(line.text()).toContain('domainMarkerNonLatinWhyExamples')
  })

  // The real site said once, however many familiar names stand in front of it
  it('names every parked familiar domain in one line, with "or" between them', async () => {
    answerLookalikes([{ ...SUBDOMAIN_MATCH, site: 'verify.test', also: [{ domain: 'google.com', evidence: 'google.com', visits: 9 }] }])
    const wrapper = mount(LookalikeNotice, { props: { hostname: 'yourbank.com.google.com.verify.test' } })
    await flushPromises()
    const lines = wrapper.findAll('[data-lookalike]')
    expect(lines).toHaveLength(1)
    expect(lines[0].findAll('[data-lookalike-site]').map(name => name.text())).toEqual(['yourbank.com', 'google.com'])
    expect(lines[0].text().split('listOr')).toHaveLength(2)
    // A word of its own, not glued to the names beside it
    expect(lines[0].text()).toMatch(/\slistOr\s/)
    expect(lines[0].text()).not.toContain(',')
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
    answer(NO_ANSWER)
    await flushPromises()
    expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)
  })

  // `pending.com` was never visited, so it imitates nothing the user trusts
  it('says nothing about a domain parked in front that the user does not know', async () => {
    answerLookalikes([])
    const wrapper = mount(DomainMarkers, { props: { hostname: 'pending.com.evil.net' } })
    await flushPromises()
    expect(wrapper.find('[data-marker]').exists()).toBe(false)
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
    answerLookalikes(NO_ANSWER)
    const wrapper = mount(DomainMarkers, {
      props: {
        hostname: 'paypal.com.a.b.secure.evil.net',
        url: 'https://user@paypal.com.a.b.secure.evil.net/',
      },
    })
    await flushPromises()
    // userinfo + embedded ending + depth
    expect(wrapper.findAll('[data-marker]')).toHaveLength(3)
  })

  it('draws the subdomain depth as a plain number, not as part of an address', () => {
    const wrapper = mount(DomainMarkers, { props: { hostname: 'a.b.c.d.evil.net' } })
    const count = wrapper.find('[data-marker="deep-subdomains"] [data-marker-count]')
    expect(count.text()).toBe('4')
    // No digit highlighting inside it, which is what SecureText would add
    expect(count.find('.secure-domain-display').exists()).toBe(false)
    expect(count.find('.vz-ch--digit').exists()).toBe(false)
  })

  it('never echoes a password from the URL', () => {
    const wrapper = mount(DomainMarkers, {
      props: { hostname: 'evil.net', url: 'https://user:hunter2@evil.net/' },
    })
    expect(wrapper.text()).not.toContain('hunter2')
  })
})
