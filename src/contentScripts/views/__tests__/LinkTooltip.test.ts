import type { LinkTooltipData } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LinkTooltip from '../LinkTooltip.vue'

const baseData: LinkTooltipData = {
  domain: 'example.com',
  count: 5,
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

  it('shows go button when showGoButton=true', () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    const buttons = wrapper.findAll('button')
    const goButton = buttons.find(b => b.text().includes('→'))
    expect(goButton).toBeTruthy()
  })

  it('hides go button when showGoButton=false', () => {
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, showGoButton: false },
    })
    const buttons = wrapper.findAll('button')
    const goButton = buttons.find(b => b.text().includes('→'))
    expect(goButton).toBeUndefined()
  })

  it('emits go with href when go button is clicked', async () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    const buttons = wrapper.findAll('button')
    const goButton = buttons.find(b => b.text().includes('→'))
    await goButton!.trigger('click')
    expect(wrapper.emitted('go')?.[0]).toEqual(['https://example.com/page'])
  })

  it('emits details with domain when details button is clicked', async () => {
    const wrapper = mount(LinkTooltip, { props: defaultProps })
    const buttons = wrapper.findAll('button')
    // Details button has bg-blue-700/60 class
    const detailsButton = buttons.find(b => b.classes().some(c => c.includes('bg-blue')))
    await detailsButton!.trigger('click')
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
        textDomainCount: 100,
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
        resolvedCount: 0,
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
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('shows loading spinner when shortUrl status is loading', () => {
    const loadingData: LinkTooltipData = {
      ...baseData,
      shortUrl: {
        originalUrl: 'https://bit.ly/abc',
        resolvedUrl: '',
        resolvedDomain: '',
        resolvedCount: 0,
        resolvedIsSafe: false,
        chain: [],
        status: 'loading',
        isKnownShortener: true,
      },
    }
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, data: loadingData },
    })
    // Should have a spinning indicator
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
  })

  it('shows resolved domain when shortUrl is resolved', () => {
    const resolvedData: LinkTooltipData = {
      ...baseData,
      shortUrl: {
        originalUrl: 'https://bit.ly/abc',
        resolvedUrl: 'https://real-site.com/page',
        resolvedDomain: 'real-site.com',
        resolvedCount: 42,
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

  it('applies font scale from fontSize prop', () => {
    const wrapper = mount(LinkTooltip, {
      props: { ...defaultProps, fontSize: 120 },
    })
    const container = wrapper.find('.tooltip-container')
    expect(container.attributes('style')).toContain('font-size: 1.2em')
  })
})
