import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { settings } from '~/logic/storage'
import SecureText from '../SecureText.vue'

describe('secureText component', () => {
  it('renders plain ASCII domain without highlighting classes', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'google.com' },
    })
    expect(wrapper.text()).toBe('google.com')
  })

  it('renders empty text without crashing', () => {
    const wrapper = mount(SecureText, {
      props: { text: '' },
    })
    expect(wrapper.text()).toBe('')
  })

  it('renders single character', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'a' },
    })
    expect(wrapper.text()).toBe('a')
  })

  it('applies danger highlighting for Cyrillic characters with forceHighlight', () => {
    // 'а' is Cyrillic, visually identical to Latin 'a'
    const wrapper = mount(SecureText, {
      props: { text: 'gооgle.com', forceHighlight: true, dangerOnly: true },
    })
    const html = wrapper.html()
    // Cyrillic chars should get red highlighting
    expect(html).toContain('text-red-600')
  })

  it('highlights digits with forceHighlight', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'site123.com', forceHighlight: true },
    })
    const html = wrapper.html()
    expect(html).toContain('text-blue-600')
  })

  it('groups consecutive same-class characters into single spans', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'abc', forceHighlight: true },
    })
    // All alpha chars should be in one span
    const spans = wrapper.findAll('.secure-domain-display > span')
    expect(spans.length).toBe(1)
    expect(spans[0].text()).toBe('abc')
  })

  it('separates segments by character type', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'a1', forceHighlight: true },
    })
    // 'a' (alpha) and '1' (digit) have different classes -> 2 spans
    const spans = wrapper.findAll('.secure-domain-display > span')
    expect(spans.length).toBe(2)
  })

  it('respects dangerOnly – no highlighting for normal alpha/special chars', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'example.com', forceHighlight: true, dangerOnly: true },
    })
    const html = wrapper.html()
    expect(html).not.toContain('font-bold')
  })

  it('leaves Latin letters unstyled even with highlighting on', () => {
    // Colouring them would read as a verdict on the part of the address that is
    // simply ordinary, which is the opposite of what highlighting is for
    const wrapper = mount(SecureText, {
      props: { text: 'paypal', forceHighlight: true },
    })
    const span = wrapper.find('.secure-domain-display > span')

    expect(span.text()).toBe('paypal')
    expect(span.attributes('class') || '').toBe('')
  })

  it('still marks the characters that are not ordinary', () => {
    // pаypal with a Cyrillic а: the one character worth noticing
    const wrapper = mount(SecureText, {
      props: { text: 'pаypal', forceHighlight: true },
    })
    const html = wrapper.html()

    expect(html).toContain('text-red-600')
    expect(html).not.toContain('text-green')
  })

  describe('label break opportunities', () => {
    it('offers a break after every dot so long names wrap at label boundaries', () => {
      const wrapper = mount(SecureText, {
        props: { text: 'paypal.com.a.b.secure.example.net' },
      })
      expect(wrapper.findAll('wbr')).toHaveLength(6)
    })

    it('offers none for a name without dots', () => {
      const wrapper = mount(SecureText, { props: { text: 'localhost' } })
      expect(wrapper.findAll('wbr')).toHaveLength(0)
    })

    it('adds no characters, so the displayed text is exactly the input', () => {
      // <wbr> is an element with no text content – copying the domain out of the
      // popup must not pick up an invisible separator
      const wrapper = mount(SecureText, { props: { text: 'paypal.com.evil.net' } })
      expect(wrapper.text()).toBe('paypal.com.evil.net')
    })

    it('keeps the dot attached to the label it follows', () => {
      const wrapper = mount(SecureText, { props: { text: 'a.b' } })
      const spans = wrapper.findAll('.secure-domain-display > span')
      expect(spans.map(span => span.text())).toEqual(['a.', 'b'])
    })

    it('splits per character when markers are wanted, so no break can hide inside a span', () => {
      const wrapper = mount(SecureText, { props: { text: 'a.bc', markWraps: true } })
      const spans = wrapper.findAll('.secure-domain-display > span')

      expect(spans.map(span => span.text())).toEqual(['a', '.', 'b', 'c'])
      expect(wrapper.text()).toBe('a.bc')
    })

    it('splits per character regardless of highlighting, which must not change the markers', () => {
      const off = mount(SecureText, { props: { text: 'a1.bc', markWraps: true } })
      const on = mount(SecureText, { props: { text: 'a1.bc', markWraps: true, forceHighlight: true } })

      const count = (wrapper: typeof off) => wrapper.findAll('.secure-domain-display > span').length
      expect(count(off)).toBe(count(on))
    })

    it('marks no continuation without a measurable wrap', () => {
      // No layout engine here, so nothing wraps – the point is that asking for
      // wrap markers is safe even where they cannot be computed
      const wrapper = mount(SecureText, {
        props: { text: 'paypal.com.a.b.secure.example.net', markWraps: true },
      })
      expect(wrapper.html()).not.toContain('wraps-here')
    })

    it('still splits by character class inside a label', () => {
      const wrapper = mount(SecureText, {
        props: { text: 'a1.b', forceHighlight: true },
      })
      // Highlighting already gives the dot its own span, and the break lands after it
      const spans = wrapper.findAll('.secure-domain-display > span')
      expect(spans.map(span => span.text())).toEqual(['a', '1', '.', 'b'])
      expect(wrapper.findAll('wbr')).toHaveLength(1)
    })
  })
})

describe('characters that cannot be seen', () => {
  // A right-to-left override reverses everything after it, so this reads as
  // `annexeexe.pdf` on screen and is not that at all. There is no glyph to
  // colour red, so the character is named instead.
  it('names a right-to-left override rather than obeying it', () => {
    const wrapper = mount(SecureText, { props: { text: 'annexe‮fdp.exe' } })
    expect(wrapper.text()).toContain('<U+202E>')
    expect(wrapper.text()).not.toContain('‮')
  })

  it('names a zero-width space, which splits a name without leaving a mark', () => {
    const wrapper = mount(SecureText, { props: { text: 'paypa​l.com' } })
    expect(wrapper.text()).toContain('<U+200B>')
  })

  it('leaves an ordinary name exactly as it is', () => {
    const wrapper = mount(SecureText, { props: { text: 'example.com' } })
    expect(wrapper.text()).toBe('example.com')
  })

  it('holds the text to one direction', () => {
    const wrapper = mount(SecureText, { props: { text: 'example.com' } })
    expect(wrapper.find('span.secure-domain-display').attributes('dir')).toBe('ltr')
  })
})

describe('preserveCase', () => {
  // The raw text of a QR code and a Wi-Fi password are not domain names, and for
  // the second one lower-casing it is not a display choice at all.
  it('leaves the letters alone when asked to', () => {
    const wrapper = mount(SecureText, { props: { text: 'John.Doe', preserveCase: true } })
    expect(wrapper.text()).toBe('John.Doe')
  })

  it('still follows the case setting for a domain', () => {
    const wrapper = mount(SecureText, { props: { text: 'Example.COM', caseOverride: 'lower' } })
    expect(wrapper.text()).toBe('example.com')
  })
})

// The half before the @ has a control of its own, because the capitals somebody
// chose for their own name are part of how it was written down – while a domain
// reads the same either way.
describe('accountNameCase', () => {
  const domainCase = settings.value.domainCase
  const accountCase = settings.value.accountNameCase

  afterEach(() => {
    settings.value.domainCase = domainCase
    settings.value.accountNameCase = accountCase
  })

  it('leaves the name as it was typed by default', () => {
    const wrapper = mount(SecureText, { props: { text: 'John.Doe', accountName: true } })
    expect(wrapper.text()).toBe('John.Doe')
  })

  it('follows its own setting once that is moved', () => {
    settings.value.accountNameCase = 'upper'
    const wrapper = mount(SecureText, { props: { text: 'John.Doe', accountName: true } })
    expect(wrapper.text()).toBe('JOHN.DOE')
  })

  it('does not follow the domain setting', () => {
    settings.value.domainCase = 'upper'
    const wrapper = mount(SecureText, { props: { text: 'John.Doe', accountName: true } })
    expect(wrapper.text()).toBe('John.Doe')
  })

  it('leaves the domain to the domain setting', () => {
    settings.value.domainCase = 'upper'
    settings.value.accountNameCase = 'lower'
    const wrapper = mount(SecureText, { props: { text: 'Example.com' } })
    expect(wrapper.text()).toBe('EXAMPLE.COM')
  })
})
