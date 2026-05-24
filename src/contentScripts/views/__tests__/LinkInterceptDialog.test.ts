import type { LinkInterceptData } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LinkInterceptDialog from '../LinkInterceptDialog.vue'

const baseData: LinkInterceptData = {
  domain: 'suspicious.com',
  url: 'https://suspicious.com/login',
  target: '_blank',
  count: 0,
  isSafe: false,
  mismatch: null,
  punycode: null,
}

const defaultProps = {
  visible: true,
  data: baseData,
  showVisitCount: 'always' as const,
  showFullUrl: false,
  traceChain: false,
  shortUrlMode: 'off' as const,
}

describe('linkInterceptDialog component', () => {
  it('renders when visible with data', () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    expect(wrapper.find('.dialog-container').exists()).toBe(true)
  })

  it('does not render when visible=false', () => {
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, visible: false },
    })
    expect(wrapper.find('.dialog-container').exists()).toBe(false)
  })

  it('does not render when data=null', () => {
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: null },
    })
    expect(wrapper.find('.dialog-container').exists()).toBe(false)
  })

  it('displays the domain name', () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    expect(wrapper.text()).toContain('suspicious.com')
  })

  it('emits cancel when close button is clicked', async () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    // Close button is the X icon with close-x class
    const closeBtn = wrapper.find('button.close-x')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits continue when continue button is clicked', async () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    const buttons = wrapper.findAll('button')
    // Continue button has red background
    const continueBtn = buttons.find(b => b.classes().some(c => c.includes('bg-red')))
    await continueBtn!.trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })

  it('shows details button when no mismatch', async () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    const buttons = wrapper.findAll('button')
    const detailsBtn = buttons.find(b => b.classes().some(c => c.includes('bg-blue')))
    expect(detailsBtn).toBeTruthy()

    await detailsBtn!.trigger('click')
    expect(wrapper.emitted('details')?.[0]).toEqual(['suspicious.com'])
  })

  it('has no dialog-level details button when mismatch is present', () => {
    const mismatchData: LinkInterceptData = {
      ...baseData,
      mismatch: {
        textDomain: 'paypal.com',
        textDomainCount: 100,
        textDomainIsSafe: true,
      },
    }
    const noMismatchWrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: baseData },
    })
    const mismatchWrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: mismatchData },
    })
    // Without mismatch: 3 action buttons (Go Back + Details + Continue) + 2 resolve/mark buttons
    // With mismatch: no dialog-level Details button, but MismatchTable adds its own 2
    // So total button count should differ
    const noMismatchButtons = noMismatchWrapper.findAll('button')
    const mismatchButtons = mismatchWrapper.findAll('button')
    expect(mismatchButtons.length).not.toBe(noMismatchButtons.length)
  })

  it('shows mismatch table when mismatch data is present', () => {
    const mismatchData: LinkInterceptData = {
      ...baseData,
      mismatch: {
        textDomain: 'paypal.com',
        textDomainCount: 100,
        textDomainIsSafe: true,
      },
    }
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: mismatchData },
    })
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).toContain('paypal.com')
  })

  it('shows punycode info when present', () => {
    const punycodeData: LinkInterceptData = {
      ...baseData,
      punycode: 'xn--example.com',
    }
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: punycodeData },
    })
    expect(wrapper.text()).toContain('xn--example.com')
  })

  it('emits cancel when backdrop is clicked', async () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    // The root overlay div has @click.self="emit('cancel')"
    const overlay = wrapper.find('.fixed.inset-0')
    await overlay.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('shows visit count for unfamiliar site', () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    expect(wrapper.text()).toContain('0')
  })

  it('shows resolve button when shortUrl is idle', () => {
    const shortData: LinkInterceptData = {
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
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: shortData },
    })
    const buttons = wrapper.findAll('button')
    const resolveBtn = buttons.find(b => b.classes().some(c => c.includes('bg-orange')))
    expect(resolveBtn).toBeTruthy()
  })

  it('emits resolveShortUrl when resolve button is clicked', async () => {
    const shortData: LinkInterceptData = {
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
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: shortData },
    })
    const buttons = wrapper.findAll('button')
    const resolveBtn = buttons.find(b => b.classes().some(c => c.includes('bg-orange')))
    await resolveBtn!.trigger('click')
    expect(wrapper.emitted('resolveShortUrl')).toBeTruthy()
  })
})
