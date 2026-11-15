import type { LinkTooltipData } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { analyzeEmailAddress } from '~/logic/email-safety'
import LinkTooltip from '../LinkTooltip.vue'

const baseData: LinkTooltipData = {
  domain: 'example.com',
  stats: { count: 5 },
  isSafe: false,
  mismatch: null,
  punycode: null,
  anchorRect: { top: 100, bottom: 120, left: 50, right: 200 },
  href: 'https://example.com/page',
}

const defaultProps = {
  visible: true,
  data: baseData,
  showGoButton: true,
  fontSize: 100,
  showVisitCount: 'always' as const,
  showFullUrl: false,
  traceChain: false,
}

// The click on a mail link is held over every recipient. The button was drawn
// from the first address alone: calm, over a link the click was held on
describe('the button that opens the mail app', () => {
  const at = (address: string, providerKind: 'public' | 'forwarding' | 'regular', isSafe: boolean) => ({ field: 'to' as const, analysis: analyzeEmailAddress(address)!, providerKind, stats: { count: 0 }, isSafe })
  const mail = (recipients: ReturnType<typeof at>[], recipientsNotChecked = 0): LinkTooltipData => ({
    ...baseData,
    kind: 'email',
    domain: recipients[0].analysis.domain,
    isSafe: recipients[0].isSafe,
    href: `mailto:${recipients.map(r => r.analysis.raw).join(',')}`,
    email: { analysis: recipients[0].analysis, params: [], mismatch: null, providerKind: recipients[0].providerKind, writing: true, recipients, recipientsNotChecked },
  })
  const go = (data: LinkTooltipData) => mount(LinkTooltip, { props: { ...defaultProps, data } }).get('[data-action="go"]')

  it('is calm when everybody is known', () => {
    expect(go(mail([at('a@gmail.com', 'public', false), at('b@corp.test', 'regular', true)])).classes()).not.toContain('vz-btn--risk')
  })

  it('is a risk for a forwarding address behind a known one', () => {
    expect(go(mail([at('a@gmail.com', 'public', false), at('x@mozmail.com', 'forwarding', false)])).classes()).toContain('vz-btn--risk')
  })

  it('is a risk for an unfamiliar address behind a known one', () => {
    expect(go(mail([at('a@corp.test', 'regular', true), at('x@new.test', 'regular', false)])).classes()).toContain('vz-btn--risk')
  })

  it('is a risk when the link names somebody who was not checked', () => {
    expect(go(mail([at('a@gmail.com', 'public', false)], 1)).classes()).toContain('vz-btn--risk')
  })
})

describe('linkTooltip component', () => {
  it('renders when visible with data', () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    expect(wrapper.find('.tooltip-container').exists()).toBe(true)
  })

  it('does not render when visible=false', () => {
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, visible: false },
    })
    expect(wrapper.find('.tooltip-container').exists()).toBe(false)
  })

  it('does not render when data=null', () => {
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: null },
    })
    expect(wrapper.find('.tooltip-container').exists()).toBe(false)
  })

  it('displays the domain name', () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    expect(wrapper.text()).toContain('example.com')
  })

  it('shows visit count when showVisitCount=always', () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    expect(wrapper.text()).toContain('5')
  })

  it('hides visit count when showVisitCount=never', () => {
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, showVisitCount: 'never' as const },
    })
    // The count "5" should not appear in a visits context
    const visitsText = wrapper.findAll('div').filter(d => d.text().includes(': 5'))
    expect(visitsText.length).toBe(0)
  })

  // A tooltip over a link somebody points at: the link is right there to be
  // clicked, and the tooltip goes when the pointer does
  it('has neither a button that opens the link nor a close button over a hovered link', () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    expect(wrapper.find('[data-action="open"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="close"]').exists()).toBe(false)
  })

  // Asked for from the menu, a QR code mostly: nothing to click under it and no
  // pointer that leaves it
  describe('asked for from the menu', () => {
    const asked = { ...defaultProps, data: { ...baseData, asked: true } }

    it('closes by its own button', async () => {
      const wrapper = mount(LinkTooltip, { props: asked })
      await wrapper.get('[data-action="close"]').trigger('click')
      expect(wrapper.emitted('dismiss')).toHaveLength(1)
    })

    // The pointer crossing it on the way somewhere else is not a pointer that left a link
    it('stays when the pointer leaves it, where a hovered one goes', async () => {
      const kept = mount(LinkTooltip, { props: asked })
      await kept.get('[popover]').trigger('mouseleave')
      expect(kept.emitted('close')).toBeUndefined()
      const hovered = mount(LinkTooltip, { props: defaultProps })
      await hovered.get('[popover]').trigger('mouseleave')
      expect(hovered.emitted('close')).toHaveLength(1)
    })

    it('is not calm while where the link leads is still being looked up', () => {
      const data = { ...asked.data, isSafe: true, shortUrl: { originalUrl: 'https://example.com/page', resolvedUrl: '', resolvedDomain: '', resolvedStats: { count: 0 }, resolvedIsSafe: false, chain: [], status: 'loading' as const, isKnownShortener: false } }
      expect(mount(LinkTooltip, { props: { ...asked, data } }).get('[data-action="open"]').classes()).toContain('vz-btn--risk')
    })

    it('opens a site that is not known to be all right only after half a second, from a red button', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = mount(LinkTooltip, { props: asked })
        const open = wrapper.get('[data-action="open"]')
        expect(open.text()).toBe('linkInterceptOpenNewTab')
        expect(open.classes()).toContain('vz-btn--risk')
        await open.trigger('click')
        expect(wrapper.emitted('open')).toBeUndefined()
        vi.advanceTimersByTime(600)
        await open.trigger('click')
        expect(wrapper.emitted('open')?.[0]).toEqual(['https://example.com/page'])
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('opens a familiar site with nothing found at once', async () => {
      const wrapper = mount(LinkTooltip, { props: { ...asked, data: { ...asked.data, isSafe: true, stats: { count: 50 } } } })
      const open = wrapper.get('[data-action="open"]')
      expect(open.classes()).not.toContain('vz-btn--risk')
      await open.trigger('click')
      expect(wrapper.emitted('open')).toHaveLength(1)
    })

    // Familiar, and the address is built to be misread all the same
    it('keeps the red button for a familiar site with a red flag in the link', () => {
      const data = { ...asked.data, isSafe: true, href: 'https://paypal.com@example.com/' }
      expect(mount(LinkTooltip, { props: { ...asked, data } }).get('[data-action="open"]').classes()).toContain('vz-btn--risk')
    })

    it('has a close button and nothing to open on a piece of plain text', () => {
      const data = { ...asked.data, kind: 'text' as const, domain: '', rawText: { payload: 'WIFI:T:WPA;S:x;;', payloadKind: 'wifi' as const } }
      const wrapper = mount(LinkTooltip, { props: { ...asked, data } })
      expect(wrapper.find('[data-action="close"]').exists()).toBe(true)
      expect(wrapper.find('[data-action="open"]').exists()).toBe(false)
      expect(wrapper.find('[data-status="no-address"]').exists()).toBe(false)
    })

    // Asked to check an email link, the answer was "Content type: Text"
    it('says a mail link has no address to check', () => {
      const data = { ...asked.data, kind: 'text' as const, domain: '', rawText: { payload: 'mailto:?subject=Hi', payloadKind: 'text' as const, mailWithoutAddress: true } }
      const wrapper = mount(LinkTooltip, { props: { ...asked, data } })
      expect(wrapper.get('[data-status="no-address"]').text()).toBe('mailLinkNoAddress')
      expect(wrapper.text()).toContain('mailLinkHeading')
      expect(wrapper.text()).not.toContain('qrPayloadType')
      expect(wrapper.text()).toContain('mailto:?subject=Hi')
    })
  })

  it('emits details with domain when details button is clicked', async () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    await wrapper.get('[data-action="details"]').trigger('click')
    expect(wrapper.emitted('details')?.[0]).toEqual(['example.com'])
  })

  it('emits hoverEnter on mouseenter', async () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    const root = wrapper.find('.fixed')
    await root.trigger('mouseenter')
    expect(wrapper.emitted('hoverEnter')).toBeTruthy()
  })

  it('emits close on mouseleave', async () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    const root = wrapper.find('.fixed')
    await root.trigger('mouseleave')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows mismatch warning when mismatch data is present', () => {
    const mismatchData: LinkTooltipData = {
      ...baseData,
      mismatch: {
        textDomain: 'paypal.com',
        textDomainStats: { count: 100 },
        textDomainIsSafe: true,
      },
    }
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: mismatchData },
    })
    // Should show mismatch warning icon (svg)
    expect(wrapper.findAll('svg').length).toBeGreaterThan(0)
    // Should contain MismatchTable
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('shows punycode info when present', () => {
    const punycodeData: LinkTooltipData = {
      ...baseData,
      punycode: 'xn--e1afmapc.com',
    }
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: punycodeData },
    })
    expect(wrapper.text()).toContain('xn--e1afmapc.com')
  })

  it('shows shortener resolve button when shortUrl status is idle', () => {
    const shortData: LinkTooltipData = {
      ...baseData,
      shortUrl: {
        originalUrl: 'https://bit.ly/abc',
        resolvedUrl: '',
        resolvedDomain: '',
        resolvedStats: { count: 0 },
        resolvedIsSafe: false,
        chain: [],
        status: 'idle',
        isKnownShortener: true,
      },
    }
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: shortData },
    })
    // Should show resolve button
    expect(wrapper.find('[data-action="resolve"]').exists()).toBe(true)
  })

  it('shows loading spinner when shortUrl status is loading', () => {
    const loadingData: LinkTooltipData = {
      ...baseData,
      shortUrl: {
        originalUrl: 'https://bit.ly/abc',
        resolvedUrl: '',
        resolvedDomain: '',
        resolvedStats: { count: 0 },
        resolvedIsSafe: false,
        chain: [],
        status: 'loading',
        isKnownShortener: true,
      },
    }
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: loadingData },
    })
    // A disabled button that says it is checking, with the pending sign
    expect(wrapper.find('button[disabled] .vz-icon--pending').exists()).toBe(true)
  })

  it('shows resolved domain when shortUrl is resolved', () => {
    const resolvedData: LinkTooltipData = {
      ...baseData,
      shortUrl: {
        originalUrl: 'https://bit.ly/abc',
        resolvedUrl: 'https://real-site.com/page',
        resolvedDomain: 'real-site.com',
        resolvedStats: { count: 42 },
        resolvedIsSafe: true,
        chain: ['https://bit.ly/abc', 'https://real-site.com/page'],
        status: 'resolved',
        isKnownShortener: true,
      },
    }
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: resolvedData },
    })
    expect(wrapper.text()).toContain('real-site.com')
  })

  // The heading, the address, then what is known about it. The verdict used to
  // sit beside the heading, above the address it was about
  it('puts the verdict under the address, behind the word Status', () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    const text = wrapper.text()
    expect(text.indexOf('example.com')).toBeGreaterThan(text.indexOf('linkTooltipDestination'))
    expect(text.indexOf('linkInterceptStatus')).toBeGreaterThan(text.indexOf('example.com'))
    expect(wrapper.find('[data-verdict]').element.previousElementSibling?.textContent).toBe('linkInterceptStatus')
  })

  // An ordinary link followed somewhere else: what is known about the address
  // it goes to first is said nowhere else, so it stays, and the address it
  // ends at gets a verdict of its own
  it('keeps the verdict and facts of the first address once the link has been followed', () => {
    const followed: LinkTooltipData = {
      ...baseData,
      shortUrl: {
        originalUrl: 'https://example.com/page',
        resolvedUrl: 'https://end.test/',
        resolvedDomain: 'end.test',
        resolvedStats: { count: 0 },
        resolvedIsSafe: false,
        chain: ['https://example.com/page', 'https://end.test/'],
        status: 'resolved',
        isKnownShortener: false,
      },
    }
    const wrapper = mount(LinkTooltip, { props: { ...defaultProps, data: followed } })
    expect(wrapper.findAll('[data-verdict]').map(node => node.attributes('data-verdict'))).toEqual(['unfamiliar', 'never'])
    expect(wrapper.find('[data-criterion="visits"]').text()).toBe('5')
    // How sure "Real destination" is goes in its heading, once
    expect(wrapper.text().split('linkTooltipResolveDisclaimer')).toHaveLength(2)
    expect(wrapper.text().indexOf('linkTooltipResolveDisclaimer')).toBeLessThan(wrapper.text().indexOf('end.test'))
  })

  it('applies font scale from fontSize prop', () => {
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, fontSize: 120 },
    })
    const container = wrapper.find('.tooltip-container')
    expect(container.attributes('style')).toContain('--vz-scale: 1.2')
  })
})
