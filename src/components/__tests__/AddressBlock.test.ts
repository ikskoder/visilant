import type { ShortUrlInfo } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultFamiliaritySettings } from '~/logic/familiarity'
import { settings } from '~/logic/storage'
import AddressBlock from '../AddressBlock.vue'
import ShortLinkBlock from '../ShortLinkBlock.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given

function configure() {
  settings.value.showFamiliarityThresholds = false
  settings.value.familiarity = structuredClone(defaultFamiliaritySettings)
}

const never = { verdict: 'never', text: 'Never visited', tone: 'danger' as const, icon: 'shield-fail' as const }
const unfamiliar = { verdict: 'unfamiliar', text: 'Unfamiliar site', tone: 'danger' as const, icon: 'shield-fail' as const }

/** Where each part starts in the text of the block, to compare their order. */
function order(text: string, ...parts: string[]) {
  return parts.map(part => text.indexOf(part))
}

describe('addressBlock component', () => {
  afterEach(() => configure())

  // The one order every surface drawn over a page shares
  it('reads heading, address, status, flags, facts, in that order', () => {
    configure()
    const wrapper = mount(AddressBlock, {
      props: { heading: 'Destination', hostname: 'evil.test', url: 'https://bank.test@evil.test/', badge: unfamiliar, familiar: false, facts: { count: 3 } },
    })
    const places = order(wrapper.text(), 'Destination', 'evil.test', 'linkInterceptStatus', 'Unfamiliar site', 'redFlagsOne', 'familiarityVisits')
    expect(places.every(place => place >= 0)).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
    expect(wrapper.get('[data-address-status] [data-verdict]').attributes('data-verdict')).toBe('unfamiliar')
    expect(wrapper.find('[data-address-status] [data-red-flags]').exists()).toBe(true)
  })

  // "Never visited" is the whole answer for a record with no visits
  it('draws no facts under a verdict that reads never visited', () => {
    configure()
    const wrapper = mount(AddressBlock, { props: { hostname: 'new.test', badge: never, familiar: false, facts: { count: 0 } } })
    expect(wrapper.find('[data-criterion]').exists()).toBe(false)
    expect(wrapper.find('[data-never-visited]').exists()).toBe(false)
  })

  // A dialog headed "Short link" has said the verdict in its title
  it('has no status row with neither a verdict nor a flag', () => {
    const wrapper = mount(AddressBlock, { props: { hostname: 'bit.ly', badge: null, familiar: false } })
    expect(wrapper.find('[data-address-status]').exists()).toBe(false)
  })

  it('keeps the word Status for a verdict, not for a count of flags alone', () => {
    const wrapper = mount(AddressBlock, { props: { hostname: 'evil.test', url: 'https://bank.test@evil.test/', badge: null, familiar: false } })
    expect(wrapper.find('[data-address-status] [data-red-flags]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('linkInterceptStatus')
  })

  it('says the site could not be checked in place of its facts', () => {
    const wrapper = mount(AddressBlock, { props: { hostname: 'x.test', badge: null, familiar: false, facts: { count: 3 }, unchecked: true } })
    expect(wrapper.find('[data-status="unchecked"]').exists()).toBe(true)
    expect(wrapper.find('[data-criterion]').exists()).toBe(false)
  })

  // The paste dialog goes up before its check has answered. The count and
  // the lines wait together: a flag line drawn at once stood without its count
  it('holds the flags back while the verdict is still out, the count and the lines alike', async () => {
    const props = { hostname: 'evil.test', url: 'https://bank.test@evil.test/', badge: { verdict: 'checking', text: 'Checking', tone: 'neutral' as const }, familiar: true }
    const wrapper = mount(AddressBlock, { props: { ...props, pending: true } })
    expect(wrapper.find('[data-red-flags]').exists()).toBe(false)
    expect(wrapper.find('[data-marker]').exists()).toBe(false)
    await wrapper.setProps({ pending: false })
    expect(wrapper.find('[data-red-flags]').exists()).toBe(true)
    expect(wrapper.find('[data-marker="url-userinfo"]').exists()).toBe(true)
  })
})

describe('shortLinkBlock component', () => {
  afterEach(() => configure())

  const link = (patch: Partial<ShortUrlInfo>): ShortUrlInfo => ({
    originalUrl: 'https://bit.ly/abc',
    resolvedUrl: '',
    resolvedDomain: '',
    resolvedStats: { count: 0 },
    resolvedIsSafe: false,
    chain: [],
    status: 'idle',
    isKnownShortener: true,
    ...patch,
  })
  const props = { showVisitCount: 'always' as const, showFullUrl: true, traceChain: true }
  const followed = { status: 'resolved' as const, resolvedUrl: 'https://end.test/page?id=1', resolvedDomain: 'end.test' }

  it('offers to follow a short link, and says so while it does', async () => {
    const wrapper = mount(ShortLinkBlock, { props: { ...props, link: link({}) } })
    expect(wrapper.get('[data-action="resolve"]').text()).toBe('linkResolveTry')
    await wrapper.get('[data-action="resolve"]').trigger('click')
    expect(wrapper.emitted('resolve')).toHaveLength(1)
    await wrapper.setProps({ link: link({ status: 'loading' }) })
    expect(wrapper.get('button[disabled]').text()).toBe('linkTooltipResolvingUrl')
  })

  // How sure "Real destination" is goes in its heading, before the address it
  // qualifies, and nowhere else
  it('heads where the link ended with how sure that is, then the address and its verdict', () => {
    configure()
    const wrapper = mount(ShortLinkBlock, { props: { ...props, link: link({ ...followed, chain: ['https://bit.ly/abc', 'https://end.test/page?id=1'] }) } })
    const text = wrapper.text()
    const places = order(text, 'linkTooltipShortenedUrl', 'linkTooltipResolveDisclaimer', 'end.test', 'linkInterceptStatus', 'linkTooltipNeverVisited')
    expect(places.every(place => place >= 0)).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
    expect(text.split('linkTooltipResolveDisclaimer')).toHaveLength(2)
    // Why it is only most likely is behind the question mark, not on the screen
    expect(text).not.toContain('linkResolveWhyNotCertain')
    // The whole address, since there is no chain to end in it
    expect(text).toContain('https://end.test/page?id=1')
    expect(text).not.toContain('linkTooltipRedirectChain')
  })

  // Read on hover where there is one, and put on a line by a press where there is not
  it('keeps why the destination is only most likely behind a question mark', async () => {
    configure()
    const wrapper = mount(ShortLinkBlock, { props: { ...props, link: link(followed) } })
    const help = wrapper.get('[data-action="help"]')
    expect(help.attributes('title')).toBe('linkResolveWhyNotCertain')
    expect(wrapper.find('[data-help-text]').exists()).toBe(false)
    // A short name, with what it says read out after it
    expect(help.attributes('aria-label')).toBe('helpButtonLabel')
    expect(help.attributes('aria-description')).toBe('linkResolveWhyNotCertain')
    await help.trigger('click')
    expect(wrapper.get('[data-help-text]').text()).toBe('linkResolveWhyNotCertain')
    expect(help.attributes('aria-expanded')).toBe('true')
    // The words are on the line now: hovering said them again over it
    expect(help.attributes('title')).toBeUndefined()
    expect(help.attributes('aria-description')).toBeUndefined()
    await help.trigger('click')
    expect(wrapper.find('[data-help-text]').exists()).toBe(false)
    expect(help.attributes('title')).toBe('linkResolveWhyNotCertain')
  })

  // The button only tries, and pressing it requests the link for real: both
  // are the reader's to know before the press, not after
  it('says beside the button what following a link costs, and closes that for the next link', async () => {
    const wrapper = mount(ShortLinkBlock, { props: { ...props, link: link({}) } })
    const help = wrapper.get('[data-action="resolve"] ~ [data-action="help"]')
    expect(help.attributes('title')).toBe('linkResolveHelp')
    await help.trigger('click')
    expect(wrapper.get('[data-help-text]').text()).toBe('linkResolveHelp')
    // Asking is not following
    expect(wrapper.emitted('resolve')).toBeUndefined()
    // The same block under the next link: nobody asked about that one
    await wrapper.setProps({ link: link({ originalUrl: 'https://bit.ly/other' }) })
    expect(wrapper.find('[data-help-text]').exists()).toBe(false)
  })

  // The last step of the chain is the whole address, so it is not printed twice
  it('draws the chain in place of the whole address once there is a hop in between', () => {
    configure()
    const chain = ['https://bit.ly/abc', 'https://tinyurl.com/x', 'https://end.test/page?id=1']
    const wrapper = mount(ShortLinkBlock, { props: { ...props, link: link({ ...followed, chain }) } })
    expect(wrapper.text()).toContain('linkTooltipRedirectChain')
    expect(wrapper.text().split('https://end.test/page?id=1')).toHaveLength(2)
  })

  it('offers to mark the site as a short-link service only once a link from it led elsewhere', async () => {
    configure()
    const known = mount(ShortLinkBlock, { props: { ...props, link: link(followed) } })
    expect(known.find('[data-action="mark-shortener"]').exists()).toBe(false)
    const unknown = mount(ShortLinkBlock, { props: { ...props, link: link({ ...followed, isKnownShortener: false }) } })
    await unknown.get('[data-action="mark-shortener"]').trigger('click')
    expect(unknown.emitted('markShortener')).toHaveLength(1)
  })

  it('says a link could not be followed, and offers to try again only where that can help', () => {
    const failed = mount(ShortLinkBlock, { props: { ...props, link: link({ status: 'error', error: 'network' }) } })
    expect(failed.text()).toContain('linkTooltipResolveError')
    expect(failed.find('[data-action="retry"]').exists()).toBe(true)
    const same = mount(ShortLinkBlock, { props: { ...props, link: link({ status: 'error', error: 'same_domain' }) } })
    expect(same.text()).toContain('linkTooltipResolveSameDomainShortener')
    expect(same.find('[data-action="retry"]').exists()).toBe(false)
  })
})
