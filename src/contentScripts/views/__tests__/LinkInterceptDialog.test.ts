import type { LinkInterceptData } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LinkInterceptDialog from '../LinkInterceptDialog.vue'

// A click that was held, which is what most of these are about. The check
// asked for from the menu has tests of its own below
const baseData: LinkInterceptData = {
  ownNavigation: false,
  domain: 'suspicious.com',
  url: 'https://suspicious.com/login',
  target: '_blank',
  stats: { count: 0 },
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
  afterEach(() => {
    vi.useRealTimers()
  })

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
    const closeBtn = wrapper.get('button[aria-label="closeDialog"]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  // The card is centred, so a line of help opening moves "Open anyway" under
  // a pointer that has not moved
  it('makes the press after opening help wait its half second again', async () => {
    vi.useFakeTimers()
    const shortUrl = { originalUrl: 'https://bit.ly/abc', resolvedUrl: '', resolvedDomain: '', resolvedStats: { count: 0 }, resolvedIsSafe: false, chain: [], status: 'idle' as const, isKnownShortener: true }
    const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, shortUrlMode: 'button' as const, data: { ...baseData, shortUrl } } })
    await vi.advanceTimersByTimeAsync(600)
    await wrapper.get('[data-action="help"]').trigger('click')
    await wrapper.get('[data-action="continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(600)
    await wrapper.get('[data-action="continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toHaveLength(1)
  })

  it('emits continue when continue button is clicked', async () => {
    vi.useFakeTimers()
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    await vi.advanceTimersByTimeAsync(500)
    await wrapper.get('[data-action="continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })

  // The click that opened the dialog is often the first of a double click, and
  // the second must not land on the way through
  it('ignores continue for the first half second', async () => {
    vi.useFakeTimers()
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    await wrapper.get('[data-action="continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toBeFalsy()
    await vi.advanceTimersByTimeAsync(500)
    await wrapper.get('[data-action="continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })

  // Going ahead is the risk button, the way back is the loud one
  it('makes the way back the primary action and continuing the risk one', () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    expect(wrapper.get('[data-action="back"]').classes()).toContain('vz-btn--primary')
    expect(wrapper.get('[data-action="continue"]').classes()).toContain('vz-btn--risk')
  })

  // A familiar destination with nothing to weigh has a plain way through, and
  // nothing to wait for
  it('lets a calm "Open link" through at once', async () => {
    const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data: { ...baseData, isSafe: true, stats: { count: 50 } } } })
    expect(wrapper.find('[data-action="back"]').exists()).toBe(false)
    await wrapper.get('[data-action="continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toBeTruthy()
  })

  it('shows details button when no mismatch', async () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    const detailsBtn = wrapper.get('[data-action="details"]')
    await detailsBtn.trigger('click')
    expect(wrapper.emitted('details')?.[0]).toEqual(['suspicious.com'])
  })

  // Each column of the mismatch table has its own, and a short link not yet
  // seen through has nothing behind it but the shortener's own page
  it('has no dialog-level details button on a mismatch or an unresolved short link', () => {
    const mismatchData: LinkInterceptData = {
      ...baseData,
      mismatch: {
        textDomain: 'paypal.com',
        textDomainStats: { count: 100 },
        textDomainIsSafe: true,
      },
    }
    const shortData: LinkInterceptData = {
      ...baseData,
      shortUrl: { originalUrl: 'https://bit.ly/abc', resolvedUrl: '', resolvedDomain: '', resolvedStats: { count: 0 }, resolvedIsSafe: false, chain: [], status: 'idle', isKnownShortener: true },
    }
    const detailsIn = (data: LinkInterceptData) => mount(LinkInterceptDialog, { props: { ...defaultProps, data } })
      // The dialog's own, not the pair inside the "shows / leads to" table
      .find('[data-action="details"]')
      .exists()
    expect(detailsIn(baseData)).toBe(true)
    expect(detailsIn(mismatchData)).toBe(false)
    expect(detailsIn(shortData)).toBe(false)
  })

  it('shows mismatch table when mismatch data is present', () => {
    const mismatchData: LinkInterceptData = {
      ...baseData,
      mismatch: {
        textDomain: 'paypal.com',
        textDomainStats: { count: 100 },
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
    const overlay = wrapper.find('dialog.vz-layer')
    await overlay.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('shows the facts of an unfamiliar site that has some', () => {
    const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data: { ...baseData, stats: { count: 3 } } } })
    expect(wrapper.get('[data-criterion="visits"]').text()).toBe('3')
  })

  // The badge reads "Never visited", and three failed zeros under it said so again
  it('leaves the facts out for a site never visited', () => {
    const wrapper = mount(LinkInterceptDialog, { props: defaultProps })
    expect(wrapper.find('[data-verdict="never"]').exists()).toBe(true)
    expect(wrapper.find('[data-criterion]').exists()).toBe(false)
  })

  it('shows resolve button when shortUrl is idle', () => {
    const shortData: LinkInterceptData = {
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
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: shortData },
    })
    expect(wrapper.find('[data-action="resolve"]').exists()).toBe(true)
  })

  it('emits resolveShortUrl when resolve button is clicked', async () => {
    const shortData: LinkInterceptData = {
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
    const wrapper = mount(LinkInterceptDialog, {
      props: { ...defaultProps, data: shortData },
    })
    await wrapper.get('[data-action="resolve"]').trigger('click')
    expect(wrapper.emitted('resolveShortUrl')).toBeTruthy()
  })

  // The title and the way forward follow what is known about the destination.
  // It used to say "Unfamiliar site ahead" whatever the link was.
  const shortUrl = (over: Partial<NonNullable<LinkInterceptData['shortUrl']>>) => ({
    originalUrl: 'https://bit.ly/abc',
    resolvedUrl: '',
    resolvedDomain: '',
    resolvedStats: { count: 0 },
    resolvedIsSafe: false,
    chain: [],
    status: 'idle' as const,
    isKnownShortener: true,
    ...over,
  })

  function titleAndProceed(data: LinkInterceptData) {
    const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data } })
    const buttons = wrapper.findAll('button').map(b => b.text())
    const proceed = buttons.find(b => b === 'linkInterceptOpen' || b === 'linkInterceptContinue')
    return { title: wrapper.find('h2').text(), proceed, hint: wrapper.text().includes('linkInterceptPhishingHint') }
  }

  it('calls an unfamiliar destination unfamiliar', () => {
    expect(titleAndProceed(baseData)).toEqual({ title: 'linkInterceptTitle', proceed: 'linkInterceptContinue', hint: true })
  })

  it('does not call a familiar destination unfamiliar', () => {
    const data = { ...baseData, isSafe: true, stats: { count: 50 } }
    expect(titleAndProceed(data)).toEqual({ title: 'linkInterceptTitleFamiliar', proceed: 'linkInterceptOpen', hint: false })
  })

  it('calls a short link not yet seen through hidden, even on a familiar shortener', () => {
    const data = { ...baseData, isSafe: true, shortUrl: shortUrl({ status: 'error', error: 'failed' }) }
    expect(titleAndProceed(data)).toEqual({ title: 'linkInterceptTitleHidden', proceed: 'linkInterceptContinue', hint: false })
  })

  it('judges a resolved short link by where it really goes', () => {
    const toUnknown = { ...baseData, isSafe: true, shortUrl: shortUrl({ status: 'resolved', resolvedDomain: 'x.test', resolvedIsSafe: false }) }
    expect(titleAndProceed(toUnknown).title).toBe('linkInterceptTitle')
    const toKnown = { ...baseData, isSafe: false, shortUrl: shortUrl({ status: 'resolved', resolvedDomain: 'x.test', resolvedIsSafe: true }) }
    expect(titleAndProceed(toKnown)).toEqual({ title: 'linkInterceptTitleFamiliar', proceed: 'linkInterceptOpen', hint: false })
  })

  it('does not wave a mismatched link through, even to a familiar site', () => {
    const data = { ...baseData, isSafe: true, mismatch: { textDomain: 'paypal.com', textDomainStats: { count: 0 }, textDomainIsSafe: false } }
    expect(titleAndProceed(data).proceed).toBe('linkInterceptContinue')
  })

  it('does not wave a link through while its destination is still being looked up', () => {
    const data = { ...baseData, isSafe: true, shortUrl: shortUrl({ status: 'loading', isKnownShortener: false }) }
    expect(titleAndProceed(data).proceed).toBe('linkInterceptContinue')
  })

  // Asked for from the menu: nobody clicked, nothing is held, and the dialog
  // must not speak as though somebody had been stopped on their way
  describe('a check asked for from the menu', () => {
    const askedData = { ...baseData, ownNavigation: undefined }
    function words(data: LinkInterceptData) {
      const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data } })
      return {
        title: wrapper.find('h2').text(),
        proceed: wrapper.get('[data-action="continue"]').text(),
        back: wrapper.find('[data-action="back"]').exists() ? wrapper.get('[data-action="back"]').text() : null,
      }
    }

    it('is a link check with a way to open and a way to close, not a stop', () => {
      expect(words(askedData)).toEqual({ title: 'linkInterceptTitleFamiliar', proceed: 'linkInterceptOpenNewTab', back: 'closeDialog' })
    })

    it('speaks of what lies ahead only to somebody who clicked', () => {
      expect(words(baseData)).toEqual({ title: 'linkInterceptTitle', proceed: 'linkInterceptContinue', back: 'linkInterceptCancel' })
    })

    // It has no reason it was held for, and has the flags all the same
    it('is headed by the red flags in the link when there are any', () => {
      const flagged = { ...askedData, url: 'https://paypal.com@suspicious.com/' }
      expect(words(flagged).title).toBe('linkInterceptTitleRedFlags')
      const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data: flagged } })
      expect(wrapper.get('.vz-dialog__head .vz-sig').attributes('data-sign')).toBe('flag')
    })

    it('keeps the risk button for a destination that is not known to be all right', () => {
      const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data: askedData } })
      expect(wrapper.get('[data-action="continue"]').classes()).toContain('vz-btn--risk')
      const calm = mount(LinkInterceptDialog, { props: { ...defaultProps, data: { ...askedData, isSafe: true, stats: { count: 50 } } } })
      expect(calm.get('[data-action="continue"]').classes()).toContain('vz-btn--primary')
      expect(calm.get('[data-action="continue"]').text()).toBe('linkInterceptOpenNewTab')
    })
  })

  // In a frame from another site the dialog cannot open the link: the button
  // lets the next click through, and has to say that and not "open"
  it('names the button for what it does when the link has to be clicked again', () => {
    const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data: { ...baseData, clickAgain: true } } })
    expect(wrapper.get('[data-action="continue"]').text()).toBe('linkInterceptAllowLink')
    expect(wrapper.get('[data-click-again]').text()).toBe('linkInterceptClickAgain')
  })

  // One icon at the head, the signature and the sign in one. The exclamation
  // mark is the only sign with two colours, so its tone is asserted by name
  describe('the sign at the head', () => {
    function sign(data: LinkInterceptData) {
      const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data } })
      const head = wrapper.get('.vz-dialog__head')
      // The signature, and the cross on the button that closes the dialog
      expect(head.findAll('svg')).toHaveLength(2)
      const sig = head.get('.vz-sig')
      return { sign: sig.attributes('data-sign'), tone: sig.attributes('data-tone') }
    }
    const bitly = { ...baseData, domain: 'bit.ly', url: 'https://bit.ly/abc' }

    it('is a red exclamation mark for an unfamiliar site', () => {
      expect(sign(baseData)).toEqual({ sign: 'alert', tone: 'danger' })
    })

    it('is a note for a familiar site with nothing found', () => {
      expect(sign({ ...baseData, isSafe: true, stats: { count: 50 } })).toEqual({ sign: 'info', tone: 'brand' })
    })

    it('is an orange exclamation mark for a short link with nothing red about it', () => {
      expect(sign({ ...bitly, shortUrl: shortUrl({ isKnownShortener: true }) })).toEqual({ sign: 'alert', tone: 'caution' })
    })

    it('is orange for a familiar site whose link is still being looked up', () => {
      expect(sign({ ...baseData, isSafe: true, shortUrl: shortUrl({ status: 'loading', isKnownShortener: false }) })).toEqual({ sign: 'alert', tone: 'caution' })
    })

    // Held as a short link, and the flag is on screen all the same
    it('stays red for a short link with a red flag in its address', () => {
      const data = { ...bitly, url: 'https://paypal.com@bit.ly/abc', shortUrl: shortUrl({ isKnownShortener: true }) }
      expect(sign(data)).toEqual({ sign: 'alert', tone: 'danger' })
    })

    it('stays red for a short link whose text names another site', () => {
      const data = { ...bitly, shortUrl: shortUrl({ isKnownShortener: true }), mismatch: { textDomain: 'paypal.com', textDomainStats: { count: 0 }, textDomainIsSafe: false } }
      expect(sign(data)).toEqual({ sign: 'alert', tone: 'danger' })
    })

    it('is a red flag when the click was held for red flags', () => {
      const data = { ...baseData, url: 'https://paypal.com@suspicious.com/', reasons: ['red-flags'] as LinkInterceptData['reasons'] }
      expect(sign(data)).toEqual({ sign: 'flag', tone: 'danger' })
    })

    // A decoy name before an @ is no less of one for the link ending somewhere familiar
    it('is not a calm note for a flagged link that was followed to a familiar site', () => {
      const data = {
        ...baseData,
        url: 'https://paypal.com@suspicious.com/',
        reasons: ['red-flags'] as LinkInterceptData['reasons'],
        shortUrl: shortUrl({ status: 'resolved', isKnownShortener: false, resolvedDomain: 'x.test', resolvedIsSafe: true }),
      }
      expect(sign(data).sign).not.toBe('info')
      const wrapper = mount(LinkInterceptDialog, { props: { ...defaultProps, data } })
      expect(wrapper.get('[data-action="continue"]').classes()).toContain('vz-btn--risk')
      expect(wrapper.find('[data-action="back"]').exists()).toBe(true)
    })

    it('is a grey dash when the site could not be checked', () => {
      expect(sign({ ...baseData, unchecked: true })).toEqual({ sign: 'unknown', tone: 'neutral' })
    })
  })
})
