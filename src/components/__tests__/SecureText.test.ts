import type { AddressShape } from '~/logic/domain-boundary'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { resetLookalikeCache } from '~/composables/useLookalikes'
import { resetFindingsOnScreen } from '~/composables/useRedFlags'
import { ADDRESS_FRAMES_KEY, ADDRESS_SHAPE_KEY } from '~/logic/address-shape'
import { addressShape } from '~/logic/domain-boundary'
import { settings } from '~/logic/storage'
import AddressFindings from '../AddressFindings.vue'
import SecureText from '../SecureText.vue'

// The pages provide the real shape, which is what these tests draw with
function draw(props: Record<string, unknown>, shape: (host: string) => AddressShape | undefined = addressShape) {
  return mount(SecureText, { props: props as any, global: { provide: { [ADDRESS_SHAPE_KEY as symbol]: shape } } })
}

const labels = (wrapper: ReturnType<typeof draw>) => wrapper.findAll('.vz-lbl').map(label => label.text())

afterEach(() => {
  settings.value.addressFrames = true
  settings.value.domainCase = 'lower'
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

  // A unit of its own could start a line alone, with nothing on the line
  // above to say the address went on
  it('keeps the dot at the very end in the last label\'s unit', () => {
    const wrapper = draw({ text: 'paypal.com.' })
    const pieces = wrapper.findAll('[data-piece]')
    expect(pieces).toHaveLength(2)
    expect(pieces[1].find('.vz-dot--trailing').exists()).toBe(true)
  })

  // A piece quoted in a sentence: framed, and nobody is asked who owns it
  it('frames a quoted piece without asking whose it is', () => {
    let asked = 0
    const wrapper = draw({ text: 'com', kind: 'label' }, () => {
      asked++
      return { ownerLabels: 1, suffixLabels: 1 }
    })
    expect(labels(wrapper)).toEqual(['com'])
    expect(wrapper.find('[data-owner]').exists()).toBe(false)
    expect(asked).toBe(0)
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

  // The digits of an `xn--` label are the encoding, not digits anybody wrote
  it('leaves the digits of an encoded label alone', () => {
    expect(draw({ text: 'xn--pple-43d.test1.com' }).findAll('.vz-ch--digit')).toHaveLength(1)
  })

  // Red and the digit colour on one character read as two warnings
  it('gives a changed digit only the mark for the change', () => {
    const one = draw({ text: 'paypa1.com', diff: [5] }).find('.vz-ch--diff')
    expect(one.exists()).toBe(true)
    expect(one.classes()).not.toContain('vz-ch--digit')
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
  it('draws an email address as a username in a frame of its own kind, an @ and a framed host', () => {
    const wrapper = draw({ text: 'john.doe_1@mail.example.com', kind: 'email' })
    expect(wrapper.find('.vz-addr__acct').text()).toBe('john.doe_1')
    // Not a label of the domain: its own frame, outside the owner's, and
    // nothing the findings colour or count
    expect(wrapper.find('.vz-addr__acct').classes()).not.toContain('vz-lbl')
    expect(wrapper.find('.vz-own .vz-addr__acct').exists()).toBe(false)
    // Dots and underscores are ordinary in an account name
    expect(wrapper.find('.vz-addr__acct .vz-ch--foreign').exists()).toBe(false)
    expect(labels(wrapper)).toEqual(['mail', 'example', 'com'])
    expect(wrapper.text()).toBe('john.doe_1@mail.example.com')
  })

  it('marks only what is outside ASCII in an account name', () => {
    const wrapper = draw({ text: 'jоhn.doe', kind: 'account' })
    expect(wrapper.findAll('.vz-ch--foreign').map(mark => mark.text())).toEqual(['о'])
    // On its own it keeps the frame it has inside an address
    expect(wrapper.find('.vz-lbl').exists()).toBe(false)
    expect(wrapper.find('.vz-addr__acct').text()).toBe('jоhn.doe')
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

  // One case setting for the whole address. The username had its own, with a
  // button of its own, and two over one address were one too many
  it('turns a username by the same setting as the domain', () => {
    expect(draw({ text: 'John.Doe', kind: 'account' }).text()).toBe('john.doe')
    expect(draw({ text: 'John.Doe@Example.com', kind: 'email' }).text()).toBe('john.doe@example.com')
    settings.value.domainCase = 'upper'
    expect(draw({ text: 'John.Doe', kind: 'account' }).text()).toBe('JOHN.DOE')
    expect(draw({ text: 'John.Doe@Example.com', kind: 'email' }).text()).toBe('JOHN.DOE@EXAMPLE.COM')
  })
})

/**
 * jsdom lays nothing out, so the lines are handed in: each piece is told which
 * line it is on, and the observer's callback is called by hand. What is tested
 * is which pieces are marked as going on, the index arithmetic that the
 * account name, the labels in front and the owner's labels each shift.
 */
describe('the mark after a line that goes on', () => {
  let resized: (() => void) | undefined
  let frames: FrameRequestCallback[] = []

  function drawOnLines(props: Record<string, unknown>, lines: number[]) {
    resized = undefined
    frames = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resized = callback
      }

      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const wrapper = draw(props)
    wrapper.findAll('[data-piece]').forEach((piece, index) => {
      piece.element.getBoundingClientRect = () => ({ top: (lines[index] ?? 0) * 28 }) as DOMRect
    })
    return wrapper
  }

  async function settle() {
    // The observer is made once the element is there, a tick after the mount
    await nextTick()
    resized?.()
    frames.splice(0).forEach(frame => frame(0))
    await nextTick()
  }

  const marked = (wrapper: ReturnType<typeof draw>) => wrapper.findAll('[data-piece]').map(piece => piece.classes().includes('vz-goes-on'))

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks the last piece of every line but the last', async () => {
    const wrapper = drawOnLines({ text: 'paypal.com.secure.verify-login.test' }, [0, 0, 1, 1, 2])
    await settle()
    expect(marked(wrapper)).toEqual([false, true, false, true, false])
    expect(wrapper.get('.vz-addr').classes()).toContain('vz-addr--wrapped')
  })

  it('marks nothing in an address on one line', async () => {
    const wrapper = drawOnLines({ text: 'mail.google.com' }, [0, 0, 0])
    await settle()
    expect(marked(wrapper)).toEqual([false, false, false])
    expect(wrapper.get('.vz-addr').classes()).not.toContain('vz-addr--wrapped')
  })

  // The @ is a piece too, and comes first
  it('counts the @ of an email address as the first piece', async () => {
    const wrapper = drawOnLines({ text: 'support@paypal.com.verify.test', kind: 'email' }, [0, 1, 1, 2, 2])
    await settle()
    expect(marked(wrapper)).toEqual([true, false, true, false, false])
  })

  // The size of the box changes when the room for the mark is added, and a
  // size changed inside the observer's own callback is an error on the window
  it('measures on the next frame, never inside the observer\'s callback', async () => {
    const wrapper = drawOnLines({ text: 'paypal.com.evil.test' }, [0, 0, 1, 1])
    await nextTick()
    expect(resized).toBeDefined()
    resized?.()
    await nextTick()
    expect(wrapper.get('.vz-addr').classes()).not.toContain('vz-addr--wrapped')
    await settle()
    expect(wrapper.get('.vz-addr').classes()).toContain('vz-addr--wrapped')
  })
})

// Two things are read off a frame: whose the label is, by the line, and
// whether a finding is about it, by the colour
describe('what a frame says', () => {
  const tonesOf = (wrapper: { findAll: ReturnType<typeof draw>['findAll'] }) => wrapper.findAll('.vz-lbl').map(label => label.attributes('data-tone') ?? '-')
  const provide = { [ADDRESS_SHAPE_KEY as symbol]: addressShape }
  /** The lines of findings about an address, on screen. */
  const lines = (props: Record<string, unknown>) => mount(AddressFindings, { props: props as any, global: { provide } })

  afterEach(() => {
    resetFindingsOnScreen()
    resetLookalikeCache()
    vi.mocked(browser.runtime.sendMessage).mockReset()
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined)
  })

  it('marks an address whose site is known, so the labels in front of it are drawn dashed', () => {
    expect(draw({ text: 'mail.google.com' }).get('.vz-addr').classes()).toContain('vz-addr--owned')
    // No site in it, or none known yet: every frame is the plain one
    expect(draw({ text: 'intranet' }).get('.vz-addr').classes()).not.toContain('vz-addr--owned')
    expect(draw({ text: 'mail.google.com' }, () => undefined).get('.vz-addr').classes()).not.toContain('vz-addr--owned')
  })

  // Lines on screen and colour in the address are one fact: nothing is handed
  // from the one to the other, so no surface can draw the one without the other
  it('colours an address while lines of findings about it are on screen, and only then', async () => {
    const address = draw({ text: 'paypal.com.a.b.c.evil.test' })
    await flushPromises()
    expect(tonesOf(address)).toEqual(['-', '-', '-', '-', '-', '-', '-'])
    const under = lines({ hostname: 'paypal.com.a.b.c.evil.test' })
    await flushPromises()
    expect(tonesOf(address)).toEqual(['danger', 'danger', 'caution', 'caution', 'caution', '-', '-'])
    // Every line has its piece: as many flags and orange lines as colours
    expect(under.findAll('[data-red-flag]')).toHaveLength(1)
    expect(under.findAll('[data-marker="deep-subdomains"]')).toHaveLength(1)
    under.unmount()
    await flushPromises()
    expect(tonesOf(address)).toEqual(['-', '-', '-', '-', '-', '-', '-'])
  })

  it('colours every drawing of that address, its other spelling and an email address at it', async () => {
    lines({ hostname: 'пример.com' })
    await flushPromises()
    expect(tonesOf(draw({ text: 'пример.com' }))).toEqual(['danger', '-'])
    expect(tonesOf(draw({ text: 'xn--e1afmkfd.com' }))).toEqual(['danger', '-'])
    expect(tonesOf(draw({ text: 'ПРИМЕР.com.' }))).toEqual(['danger', '-'])
    expect(tonesOf(draw({ text: 'support@пример.com', kind: 'email' }))).toEqual(['danger', '-'])
    // Another address, and a piece quoted in a sentence, are not that address
    expect(tonesOf(draw({ text: 'example.com' }))).toEqual(['-', '-'])
    expect(tonesOf(draw({ text: 'пример', kind: 'label' }))).toEqual(['-'])
  })

  it('colours nothing while the verdict is still out', async () => {
    const under = lines({ hostname: 'paypal.com.evil.test' })
    const address = draw({ text: 'paypal.com.evil.test' })
    await flushPromises()
    expect(tonesOf(address)).toEqual(['danger', 'danger', '-', '-'])
    await under.setProps({ pending: true })
    await flushPromises()
    expect(under.find('[data-red-flag]').exists()).toBe(false)
    expect(tonesOf(address)).toEqual(['-', '-', '-', '-'])
  })

  // A tooltip over a dialog, the check field over the card: the block drawn
  // last used to speak alone, and the other block's lines stood over a plain address
  it('keeps the label of every line on screen when two blocks are about one address', async () => {
    for (const order of [[{ context: 'email' }, {}], [{}, { context: 'email' }]]) {
      const blocks = order.map(extra => lines({ hostname: 'x.io.evil.test', ...extra }))
      await flushPromises()
      expect(blocks.filter(block => block.find('[data-marker="mid-ending"]').exists())).toHaveLength(1)
      expect(tonesOf(draw({ text: 'x.io.evil.test' }))).toEqual(['-', 'caution', '-', '-'])
      blocks.forEach(block => block.unmount())
    }
    // One still waiting for its verdict does not blank what the other has said
    lines({ hostname: 'paypal.com.evil.test' })
    lines({ hostname: 'paypal.com.evil.test', pending: true })
    await flushPromises()
    expect(tonesOf(draw({ text: 'paypal.com.evil.test' }))).toEqual(['danger', 'danger', '-', '-'])
    // Nor does one that knows the site hide the platform the other still names
    lines({ hostname: 'someone.github.io' })
    lines({ hostname: 'someone.github.io', familiar: true })
    await flushPromises()
    expect(tonesOf(draw({ text: 'someone.github.io' }))).toEqual(['-', 'caution', 'caution'])
  })

  // Through the components, as a surface draws it: the check that finds the
  // ending and the code that colours it used to read the address differently
  it('marks the ending in the middle of an address domain where the check found it', async () => {
    const cases: [hostname: string, tones: string[]][] = [
      ['pay.io.evil.test', ['-', 'caution', '-', '-']],
      ['PAY.IO.evil.test.', ['-', 'caution', '-', '-']],
      ['io.io.evil.test', ['caution', '-', '-', '-']],
    ]
    for (const [hostname, expected] of cases) {
      const under = lines({ hostname, context: 'email' })
      await flushPromises()
      expect(under.find('[data-marker="mid-ending"]').exists()).toBe(true)
      expect(tonesOf(draw({ text: `x@${hostname}`, kind: 'email' }))).toEqual(expected)
      under.unmount()
    }
    // A dot at the very end is not one more level: no line, and no colour
    const plainEnding = lines({ hostname: 'bbc.co.uk.', context: 'email' })
    await flushPromises()
    expect(plainEnding.find('[data-marker="mid-ending"]').exists()).toBe(false)
    expect(tonesOf(draw({ text: 'x@bbc.co.uk.', kind: 'email' }))).toEqual(['-', '-', '-'])
  })

  // The familiar site in "May be imitating", a row in a list of related
  // addresses: named, not checked, even when some other block is about it
  it('leaves an address that is only named in its plain frames', async () => {
    lines({ hostname: 'bit.ly', service: true })
    await flushPromises()
    expect(tonesOf(draw({ text: 'bit.ly' }))).toEqual(['caution', 'caution'])
    expect(tonesOf(draw({ text: 'bit.ly', plain: true }))).toEqual(['-', '-'])
    // The site an address is made to look like, in the line that says so
    lines({ hostname: 'shop.com', service: true })
    const imitation = lines({ hostname: 'shop.com.evil.test' })
    await flushPromises()
    expect(imitation.findAll('[data-marker-imitated] .vz-lbl').map(label => label.attributes('data-tone') ?? '-')).toEqual(['-', '-'])
  })

  it('colours a platform only while its line is drawn, which it is not for a familiar site', async () => {
    const stranger = lines({ hostname: 'someone.github.io' })
    await flushPromises()
    expect(stranger.find('[data-marker="hosted-on"]').exists()).toBe(true)
    expect(tonesOf(draw({ text: 'someone.github.io' }))).toEqual(['-', 'caution', 'caution'])
    // The same block, once the site turns out to be one the reader knows
    const address = draw({ text: 'someone.github.io' })
    await stranger.setProps({ familiar: true })
    await flushPromises()
    expect(stranger.find('[data-marker="hosted-on"]').exists()).toBe(false)
    expect(tonesOf(address)).toEqual(['-', '-', '-'])
  })

  it('colours the site of a service the surface calls out', async () => {
    lines({ hostname: 'bit.ly', service: true })
    lines({ hostname: 'mx.mailinator.com', context: 'email', service: true })
    lines({ hostname: 'plain.test', service: false })
    await flushPromises()
    expect(tonesOf(draw({ text: 'bit.ly' }))).toEqual(['caution', 'caution'])
    expect(tonesOf(draw({ text: 'x@mx.mailinator.com', kind: 'email' }))).toEqual(['-', 'caution', 'caution'])
    expect(tonesOf(draw({ text: 'plain.test' }))).toEqual(['-', '-'])
  })

  it('colours the label a lookalike was found in, once the background has answered', async () => {
    const match = { domain: 'paypal.com', visits: 40, reason: 'edit-distance', evidence: 'paypol', severity: 'high' }
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: any) => message?.type === 'find-lookalikes' ? [match] : undefined)
    const under = lines({ hostname: 'paypol.evil.test' })
    const address = draw({ text: 'paypol.evil.test' })
    await flushPromises()
    expect(under.find('[data-lookalike]').exists()).toBe(true)
    // The label in front of the site, where the near miss is, not the site's name
    expect(tonesOf(address)).toEqual(['danger', '-', '-'])
  })

  it('gives the frame of a numeric address its colour too', async () => {
    lines({ hostname: '203.0.113.7' })
    await flushPromises()
    expect(tonesOf(draw({ text: '203.0.113.7' }))).toEqual(['danger'])
  })

  // A piece quoted in a line under the address looks as it does in the address
  it('draws a quoted piece as the address it is quoted from draws it', () => {
    const ending = draw({ text: 'github.io', part: 'ending' })
    expect(ending.findAll('[data-owner] .vz-lbl--sfx').map(label => label.text())).toEqual(['github', 'io'])
    const name = draw({ text: 'пример', kind: 'label', part: 'name', tone: 'danger' })
    expect(name.find('[data-owner] .vz-lbl').exists()).toBe(true)
    expect(name.find('.vz-lbl--sfx').exists()).toBe(false)
    expect(tonesOf(name)).toEqual(['danger'])
    const free = draw({ text: 'secure', kind: 'label', part: 'free' })
    expect(free.get('.vz-addr').classes()).toContain('vz-addr--free')
    expect(free.find('[data-owner]').exists()).toBe(false)
  })
})

// A dot in a username is no place to break for the browser, so a long one
// broke in the middle of a word: `yourbank.bil` and `ling`
describe('where an address may break', () => {
  it('lets a username break after each separator', () => {
    const wrapper = draw({ text: 'your.bank_billing+news-1', kind: 'account' })
    const html = wrapper.get('.vz-addr__acct').html()
    // After the dot, the underscore and the plus. The browser breaks after a hyphen itself
    expect(html.match(/<wbr>/g)).toHaveLength(3)
    expect(wrapper.get('.vz-addr__acct').text()).toBe('your.bank_billing+news-1')
  })

  // A label is one text: the browser breaks after its hyphen itself
  it('leaves a label with a hyphen whole', () => {
    const wrapper = draw({ text: 'yourbank-help.test' })
    expect(wrapper.get('.vz-lbl').html()).not.toContain('<wbr>')
  })
})
