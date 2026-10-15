import type { AddressShape } from '~/logic/domain-boundary'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { ADDRESS_FRAMES_KEY, ADDRESS_SHAPE_KEY } from '~/logic/address-shape'
import { addressShape } from '~/logic/domain-boundary'
import { settings } from '~/logic/storage'
import SecureText from '../SecureText.vue'

// The pages provide the real shape, which is what these tests draw with
function draw(props: Record<string, unknown>, shape: (host: string) => AddressShape | undefined = addressShape) {
  return mount(SecureText, { props: props as any, global: { provide: { [ADDRESS_SHAPE_KEY as symbol]: shape } } })
}

const labels = (wrapper: ReturnType<typeof draw>) => wrapper.findAll('.vz-lbl').map(label => label.text())

afterEach(() => {
  settings.value.addressFrames = true
  settings.value.domainCase = 'lower'
  settings.value.accountNameCase = 'as-typed'
})

describe('frames', () => {
  it('puts every label in a frame of its own and adds no characters', () => {
    const wrapper = draw({ text: 'paypal.com.secure-login.test' })
    expect(labels(wrapper)).toEqual(['paypal', 'com', 'secure-login', 'test'])
    expect(wrapper.text()).toBe('paypal.com.secure-login.test')
  })

  it('gives the owner\'s labels heavier frames, and only theirs', () => {
    const wrapper = draw({ text: 'paypal.com.secure-login.test' })
    const owner = wrapper.find('[data-owner]')
    expect(owner.findAll('.vz-lbl').map(label => label.text())).toEqual(['secure-login', 'test'])
    expect(owner.findAll('.vz-lbl--sfx').map(label => label.text())).toEqual(['test'])
  })

  it('takes the owner as counts, so the encoded spelling gets the same frames', () => {
    const unicode = draw({ text: 'pаypal.com' })
    const encoded = draw({ text: 'xn--pypal-4ve.com' })
    expect(unicode.find('[data-owner]').findAll('.vz-lbl')).toHaveLength(2)
    expect(encoded.find('[data-owner]').findAll('.vz-lbl')).toHaveLength(2)
  })

  it('holds a two-label suffix in the owner frames', () => {
    const wrapper = draw({ text: 'www.bank.co.uk' })
    expect(wrapper.find('[data-owner]').findAll('.vz-lbl--sfx').map(label => label.text())).toEqual(['co', 'uk'])
  })

  it('draws thin frames only while the shape is not known', () => {
    const wrapper = draw({ text: 'mail.example.com' }, () => undefined)
    expect(labels(wrapper)).toHaveLength(3)
    expect(wrapper.find('[data-owner]').exists()).toBe(false)
  })

  it('keeps each dot with the label before it, so no line starts with a dot', () => {
    const wrapper = draw({ text: 'a.b.example.com' })
    const segments = wrapper.findAll('.vz-seg').map(segment => segment.text())
    expect(segments).toEqual(['a.', 'b.', 'example.', 'com'])
    expect(wrapper.findAll('wbr')).toHaveLength(3)
  })

  it('draws an IP address as one frame', () => {
    const wrapper = draw({ text: '192.168.1.10' })
    expect(labels(wrapper)).toEqual(['192.168.1.10'])
  })

  it('splits on the other IDNA dots too, and marks them', () => {
    const wrapper = draw({ text: 'paypal。com' })
    expect(labels(wrapper)).toEqual(['paypal', 'com'])
    expect(wrapper.find('.vz-dot.vz-ch--foreign').text()).toBe('。')
  })

  it('draws a dot at the very end outside the frames', () => {
    const wrapper = draw({ text: 'paypal.com.' })
    expect(labels(wrapper)).toEqual(['paypal', 'com'])
    expect(wrapper.find('.vz-dot--trailing').text()).toBe('.')
    expect(wrapper.text()).toBe('paypal.com.')
  })

  it('can be switched off', () => {
    settings.value.addressFrames = false
    const wrapper = draw({ text: 'example.com' })
    expect(wrapper.find('.vz-addr').classes()).toContain('vz-addr--noframes')
  })

  it('follows a view\'s own choice over the setting, both ways', () => {
    const local = ref(false)
    const wrapper = mount(SecureText, { props: { text: 'example.com' }, global: { provide: { [ADDRESS_SHAPE_KEY as symbol]: addressShape, [ADDRESS_FRAMES_KEY as symbol]: local } } })
    expect(wrapper.find('.vz-addr').classes()).toContain('vz-addr--noframes')
    settings.value.addressFrames = false
    local.value = true
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find('.vz-addr').classes()).not.toContain('vz-addr--noframes')
    })
  })
})

describe('marks', () => {
  it('marks a letter outside a to z whatever the highlighting setting says', () => {
    // 'о' twice is Cyrillic, visually identical to Latin 'o'
    const wrapper = draw({ text: 'gооgle.com' })
    expect(wrapper.findAll('.vz-ch--foreign').map(mark => mark.text())).toEqual(['о', 'о'])
  })

  it('marks an underscore in a host, which no registrable name has', () => {
    expect(draw({ text: 'my_site.com' }).find('.vz-ch--foreign').text()).toBe('_')
  })

  it('judges the character as written, so capitals are not marked', () => {
    const wrapper = draw({ text: 'PayPal.COM' })
    expect(wrapper.find('.vz-ch--foreign').exists()).toBe(false)
    expect(wrapper.text()).toBe('paypal.com')
  })

  it('leaves Latin letters unmarked', () => {
    // Colouring them would read as a verdict on the part of the address that is
    // simply ordinary, which is the opposite of what marking is for
    const wrapper = draw({ text: 'paypal.com' })
    expect(wrapper.find('.vz-ch').exists()).toBe(false)
  })

  it('always marks the digits of an address, never those of a raw payload', () => {
    expect(draw({ text: 'site123.com' }).findAll('.vz-ch--digit')).toHaveLength(3)
    expect(draw({ text: 'user7@site1.com', kind: 'email' }).findAll('.vz-ch--digit')).toHaveLength(2)
    expect(draw({ text: 'pass123', kind: 'raw' }).find('.vz-ch--digit').exists()).toBe(false)
  })

  it('underlines the characters a lookalike changed', () => {
    const wrapper = draw({ text: 'paypa1.com', diff: [5] })
    expect(wrapper.find('.vz-ch--diff').text()).toBe('1')
    expect(wrapper.findAll('[data-diff]').map(mark => mark.text())).toEqual(['1'])
  })
})

describe('characters that cannot be seen', () => {
  // A right-to-left override reverses everything after it, so this reads as
  // `annexeexe.pdf` on screen and is not that at all
  it('keeps a right-to-left override in the text, shut inside a box of its own, and names it', () => {
    const wrapper = draw({ text: 'annexe‮fdp.exe' })
    const mark = wrapper.find('.vz-ch--invisible')
    expect(mark.attributes('data-cp')).toBe('U+202E')
    expect(mark.find('.vz-ch__raw').text()).toBe('‮')
    // A copy is the real address
    expect(wrapper.text()).toBe('annexe‮fdp.exe')
  })

  it('names a zero-width space, which splits a name without leaving a mark', () => {
    const wrapper = draw({ text: 'paypa​l.com' })
    expect(wrapper.find('.vz-ch--invisible').attributes('data-cp')).toBe('U+200B')
  })

  it('holds the text to one direction', () => {
    expect(draw({ text: 'example.com' }).find('.secure-domain-display').attributes('dir')).toBe('ltr')
  })
})

describe('other kinds of text', () => {
  it('draws an email address as a plain account name, an @ and a framed host', () => {
    const wrapper = draw({ text: 'john.doe_1@mail.example.com', kind: 'email' })
    expect(wrapper.find('.vz-addr__acct').text()).toBe('john.doe_1')
    // Dots and underscores are ordinary in an account name
    expect(wrapper.find('.vz-addr__acct .vz-ch--foreign').exists()).toBe(false)
    expect(labels(wrapper)).toEqual(['mail', 'example', 'com'])
    expect(wrapper.text()).toBe('john.doe_1@mail.example.com')
  })

  it('marks only what is outside ASCII in an account name', () => {
    const wrapper = draw({ text: 'jоhn.doe', kind: 'account' })
    expect(wrapper.findAll('.vz-ch--foreign').map(mark => mark.text())).toEqual(['о'])
    expect(wrapper.find('.vz-lbl').exists()).toBe(false)
  })

  it('leaves a raw payload unframed and its case alone', () => {
    const wrapper = draw({ text: 'WIFI:S:Home;P:Secret1;', kind: 'raw' })
    expect(wrapper.find('.vz-lbl').exists()).toBe(false)
    expect(wrapper.find('.vz-ch').exists()).toBe(false)
    expect(wrapper.text()).toBe('WIFI:S:Home;P:Secret1;')
  })
})

describe('case', () => {
  // The raw text of a QR code and a Wi-Fi password are not domain names, and for
  // the second one lower-casing it is not a display choice at all
  it('leaves the letters alone when asked to', () => {
    expect(draw({ text: 'John.Doe', preserveCase: true }).text()).toBe('John.Doe')
  })

  it('follows the case setting for a domain', () => {
    expect(draw({ text: 'Example.COM', caseOverride: 'lower' }).text()).toBe('example.com')
    settings.value.domainCase = 'upper'
    expect(draw({ text: 'Example.com' }).text()).toBe('EXAMPLE.COM')
  })

  // The half before the @ has a control of its own, because the capitals somebody
  // chose for their own name are part of how it was written down
  it('leaves an account name as it was typed by default', () => {
    expect(draw({ text: 'John.Doe', kind: 'account' }).text()).toBe('John.Doe')
  })

  it('follows the account setting, not the domain one, for an account name', () => {
    settings.value.domainCase = 'upper'
    expect(draw({ text: 'John.Doe', kind: 'account' }).text()).toBe('John.Doe')
    settings.value.accountNameCase = 'upper'
    expect(draw({ text: 'John.Doe', kind: 'account' }).text()).toBe('JOHN.DOE')
  })
})
