import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
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

  it('respects dangerOnly — no highlighting for normal alpha/special chars', () => {
    const wrapper = mount(SecureText, {
      props: { text: 'example.com', forceHighlight: true, dangerOnly: true },
    })
    const html = wrapper.html()
    // Alpha chars should have empty class in dangerOnly mode
    expect(html).not.toContain('text-green-600')
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
      // <wbr> is an element with no text content — copying the domain out of the
      // popup must not pick up an invisible separator
      const wrapper = mount(SecureText, { props: { text: 'paypal.com.evil.net' } })
      expect(wrapper.text()).toBe('paypal.com.evil.net')
    })

    it('keeps the dot attached to the label it follows', () => {
      const wrapper = mount(SecureText, { props: { text: 'a.b' } })
      const spans = wrapper.findAll('.secure-domain-display > span')
      expect(spans.map(span => span.text())).toEqual(['a.', 'b'])
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
