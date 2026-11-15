import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { resetLookalikeCache } from '~/composables/useLookalikes'
import { resetFindingsOnScreen } from '~/composables/useRedFlags'
import { findEmbeddedPublicSuffix } from '~/logic/domain-markers'
import { analyzeEmailAddress } from '~/logic/email-safety'
import AddressFindings from '../AddressFindings.vue'
import EmailBreakdown from '../EmailBreakdown.vue'
import MailRecipients from '../MailRecipients.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given

// What one test put on screen is not on the next one's
afterEach(() => {
  resetFindingsOnScreen()
  resetLookalikeCache()
})

function breakdown(params: { key: string, value: string }[], listedRecipients?: string[]) {
  return mount(EmailBreakdown, {
    props: { analysis: analyzeEmailAddress('ann@corp.test')!, params, listedRecipients, compact: true },
  })
}

// "A well-known ending in the middle of the domain" is the email check's own,
// coarser reading of what the structural markers call a red flag. It used to
// be a line three surfaces each wrote out. It is one of the lines every
// address gets now, said by the component that says the rest, with the
// ending marked in the address
describe('the well-known ending inside an address domain', () => {
  const lines = (domain: string, context?: 'email') => mount(AddressFindings, { props: { hostname: domain, context } })

  it('is not the email block\'s to say any more', () => {
    for (const address of ['x@paypal.com.evil.test', 'x@com.evil.test']) {
      const wrapper = mount(EmailBreakdown, { props: { analysis: analyzeEmailAddress(address)!, params: [], compact: true } })
      expect(wrapper.text()).not.toContain('emailSuspiciousPattern')
    }
  })

  it('is left to the red flag where the markers say it', async () => {
    expect(findEmbeddedPublicSuffix('paypal.com.evil.test')).toBeTruthy()
    const wrapper = lines('paypal.com.evil.test', 'email')
    await flushPromises()
    expect(wrapper.find('[data-marker="embedded-public-suffix"]').exists()).toBe(true)
    expect(wrapper.find('[data-marker="mid-ending"]').exists()).toBe(false)
  })

  it('is still said where only this check catches it, in orange, for an address domain alone', async () => {
    const analysis = analyzeEmailAddress('x@pay.io.evil.test')!
    expect(analysis.suspiciousPattern).toBeTruthy()
    const wrapper = lines('pay.io.evil.test', 'email')
    await flushPromises()
    const line = wrapper.get('[data-marker="mid-ending"]')
    expect(line.attributes('data-tone')).toBe('caution')
    expect(line.text()).toContain('emailSuspiciousPattern')
    // The ending itself, framed and in the line's colour
    expect(line.get('.vz-lbl').text()).toBe('io')
    expect(line.get('.vz-lbl').attributes('data-tone')).toBe('caution')
    // A site's address is not read this way
    expect(lines('pay.io.evil.test').find('[data-marker="mid-ending"]').exists()).toBe(false)
    expect(findEmbeddedPublicSuffix(analysis.domain)).toBeFalsy()
  })
})

// One row per recipient, what is known folded to signs, and the words of
// one row at a time under it once it is opened
describe('the table of recipients', () => {
  const recipient = (address: string, field: 'to' | 'cc' | 'bcc' = 'to', extra: Record<string, unknown> = {}) => ({
    field,
    analysis: analyzeEmailAddress(address)!,
    providerKind: 'regular' as const,
    stats: { count: 0 },
    isSafe: true,
    ...extra,
  })
  const row = (wrapper: ReturnType<typeof mount>, address: string) => wrapper.get(`[data-recipient="${address}"]`)
  const press = (wrapper: ReturnType<typeof mount>, address: string) => wrapper.get(`[data-recipient="${address}"] [data-action="recipient-open"]`).trigger('click')
  const more = (wrapper: ReturnType<typeof mount>) => wrapper.get('[data-recipient-more]')

  it('gives every recipient a row, by domain and then by username, the lookalike beside the name', () => {
    const recipients = [recipient('bob@corp.test'), recipient('eve@c0rp.test', 'cc', { isSafe: false }), recipient('ann@corp.test', 'bcc')]
    const wrapper = mount(MailRecipients, { props: { recipients } })
    expect(wrapper.findAll('[data-recipient]').map(item => item.attributes('data-recipient'))).toEqual(['eve@c0rp.test', 'ann@corp.test', 'bob@corp.test'])
    expect(row(wrapper, 'ann@corp.test').text()).toContain('emailFieldBcc')
    expect(wrapper.get('[data-recipients-summary]').text()).toBe('emailRecipientsSummary')
  })

  it('folds what is known to signs, a verdict for every row', () => {
    const recipients = [recipient('a@known.test', 'to', { stats: { count: 9 } }), recipient('b@new.test', 'cc', { isSafe: false }), recipient('c@new.test', 'cc', { isSafe: false }), recipient('d@gmail.com', 'bcc', { providerKind: 'public' }), recipient('e@lost.test', 'cc', { isSafe: false, unchecked: true })]
    const wrapper = mount(MailRecipients, { props: { recipients } })
    const verdicts = wrapper.findAll('[data-recipient]').map(item => item.get('[data-recipient-status] [data-verdict]').attributes('data-verdict'))
    expect(verdicts).toEqual(['public', 'familiar', 'unchecked', 'never', 'never'])
    // Nothing in words until a row is opened
    expect(wrapper.find('[data-recipient-more]').exists()).toBe(false)
    expect(wrapper.find('.vz-notice').exists()).toBe(false)
  })

  it('opens one row at a time, and a second press closes it', async () => {
    const recipients = [recipient('ann@corp.test'), recipient('bob@other.test', 'cc', { isSafe: false })]
    const wrapper = mount(MailRecipients, { props: { recipients } })
    await press(wrapper, 'bob@other.test')
    expect(more(wrapper).get('[data-recipient-verdict] [data-verdict]').attributes('data-verdict')).toBe('never')
    expect(row(wrapper, 'bob@other.test').attributes('data-open')).toBe('')
    await press(wrapper, 'ann@corp.test')
    expect(wrapper.findAll('[data-recipient-more]')).toHaveLength(1)
    expect(more(wrapper).get('[data-verdict]').attributes('data-verdict')).toBe('familiar')
    await press(wrapper, 'ann@corp.test')
    expect(wrapper.find('[data-recipient-more]').exists()).toBe(false)
  })

  // The check page shows the chosen address large, in its card
  it('hands the opened row to a surface that shows it large, and asks for a choice until then', async () => {
    const recipients = [recipient('ann@corp.test'), recipient('bob@other.test', 'cc')]
    expect(mount(MailRecipients, { props: { recipients } }).find('[data-status="choose-recipient"]').exists()).toBe(false)
    const wrapper = mount(MailRecipients, { props: { recipients, detailable: true } })
    expect(wrapper.find('[data-status="choose-recipient"]').exists()).toBe(true)
    await press(wrapper, 'bob@other.test')
    const [chosen, heading, open] = wrapper.emitted('choose')![0] as [{ analysis: { domain: string } }, string, boolean]
    expect(chosen.analysis.domain).toBe('other.test')
    expect(heading).toBe('emailRecipientPosition')
    expect(open).toBe(true)
    expect(wrapper.find('[data-status="choose-recipient"]').exists()).toBe(false)
    // Copied from the card there, so the row has no copy button of its own
    expect(row(wrapper, 'bob@other.test').find('.vz-copy').exists()).toBe(false)
    // Closed again, the card keeps the address and draws its lines itself
    await press(wrapper, 'bob@other.test')
    expect(wrapper.emitted('choose')![1][2]).toBe(false)
  })

  it('lets the open row be copied where nothing shows it large', async () => {
    const wrapper = mount(MailRecipients, { props: { recipients: [recipient('ann@corp.test'), recipient('bob@other.test', 'cc')] } })
    expect(wrapper.find('.vz-copy').exists()).toBe(false)
    await press(wrapper, 'bob@other.test')
    expect(row(wrapper, 'bob@other.test').find('.vz-copy').exists()).toBe(true)
  })

  it('counts an unusual character in a username among what is worth a look, and says it once open', async () => {
    const wrapper = mount(MailRecipients, { props: { recipients: [recipient('ann@corp.test'), recipient('jоhn@other.test', 'cc')] } })
    expect(row(wrapper, 'jоhn@other.test').get('[data-cautions]').attributes('data-cautions')).toBe('1')
    expect(row(wrapper, 'ann@corp.test').find('[data-cautions]').exists()).toBe(false)
    await press(wrapper, 'jоhn@other.test')
    const line = more(wrapper).get('[data-status="username"]')
    expect(line.attributes('data-username')).toBe('lookalike')
    expect(line.get('[data-username-reads]').text()).toBe('john')
  })

  // A tap is how a touchscreen reads it, and it must not open the row
  it('reads a field\'s meaning on a press without opening the row', async () => {
    const wrapper = mount(MailRecipients, { props: { recipients: [recipient('ann@corp.test'), recipient('bob@other.test', 'bcc')] } })
    await row(wrapper, 'bob@other.test').get('.recipient-field-wrap').trigger('click')
    expect(wrapper.find('[data-recipient-more]').exists()).toBe(false)
  })

  // The heading of the list counts the ones not checked, and so does the card's
  it('counts a position out of everybody the heading counts', async () => {
    const wrapper = mount(MailRecipients, { props: { recipients: [recipient('ann@corp.test'), recipient('bob@other.test', 'cc')], notChecked: 3, detailable: true } })
    await press(wrapper, 'ann@corp.test')
    expect(wrapper.emitted('choose')![0][1]).toBe('emailRecipientPosition')
  })

  it('says what each field means', () => {
    const wrapper = mount(MailRecipients, { props: { recipients: [recipient('ann@corp.test'), recipient('bob@other.test', 'bcc')] } })
    expect(row(wrapper, 'bob@other.test').get('[role="tooltip"]').text()).toBe('emailFieldBccHelp')
  })

  // Pointing at a domain frames every row at it in violet
  it('frames the same domain in every row while one is pointed at, and only a domain that repeats', async () => {
    const recipients = [recipient('ann@corp.test'), recipient('bob@corp.test'), recipient('eve@other.test', 'cc')]
    const wrapper = mount(MailRecipients, { props: { recipients } })
    expect(wrapper.find('[data-status="same-domain-hint"]').exists()).toBe(true)
    await row(wrapper, 'ann@corp.test').get('.vz-addr__domain').trigger('pointerover')
    const framed = () => wrapper.findAll('[data-recipient]').filter(item => item.find('.vz-addr--match').exists()).map(item => item.attributes('data-recipient'))
    expect(framed()).toEqual(['ann@corp.test', 'bob@corp.test'])
    await row(wrapper, 'eve@other.test').get('.vz-addr__domain').trigger('pointerover')
    expect(framed()).toEqual([])
    const alone = mount(MailRecipients, { props: { recipients: [recipients[0], recipients[2]] } })
    expect(alone.find('[data-status="same-domain-hint"]').exists()).toBe(false)
  })
})

describe('the lines under an open recipient', () => {
  const recipient = (address: string, field: 'to' | 'cc' = 'to') => ({
    field,
    analysis: analyzeEmailAddress(address)!,
    providerKind: 'regular' as const,
    stats: { count: 0 },
    isSafe: false,
  })
  const recipients = [recipient('a@paypal.com.evil.test'), recipient('b@paypal.com.other.test', 'cc')]
  const press = (wrapper: ReturnType<typeof mount>, address: string) => wrapper.get(`[data-recipient="${address}"] [data-action="recipient-open"]`).trigger('click')

  // The line every surface draws, headed with the kind's name where no badge stands
  it('says a throwaway service as every surface does, with what writing to it means behind the question mark', async () => {
    const throwaway = { ...recipient('c@mailinator.test', 'cc'), providerKind: 'disposable' as const }
    const wrapper = mount(MailRecipients, { props: { recipients: [recipients[0], throwaway] } })
    const sign = wrapper.get('[data-recipient="c@mailinator.test"] [data-recipient-status]')
    // Folded into the orange sign, not a second shield beside it
    expect(sign.findAll('[data-verdict]').map(item => item.attributes('data-verdict'))).toEqual(['disposable'])
    expect(sign.get('[data-cautions]').attributes('data-cautions')).toBe('1')
    await press(wrapper, 'c@mailinator.test')
    const line = wrapper.get('[data-recipient-more] [data-status="disposable"]')
    expect(line.find('[data-service-name]').exists()).toBe(true)
    expect(wrapper.find('[data-recipient-more] [data-recipient-verdict]').exists()).toBe(false)
    expect(line.text()).toContain('emailDisposableHint')
    expect(line.attributes('data-tone')).toBe('caution')
    await line.get('[data-action="help"]').trigger('click')
    expect(line.get('[data-help-text]').text()).toBe('emailHiddenOwnerHelp')
  })

  it('says a forwarding service the same way', async () => {
    const mask = { ...recipient('c@mozmail.com', 'cc'), providerKind: 'forwarding' as const }
    const wrapper = mount(MailRecipients, { props: { recipients: [recipients[0], mask] } })
    await press(wrapper, 'c@mozmail.com')
    const line = wrapper.get('[data-recipient-more] [data-status="forwarding"]')
    expect(line.text()).toContain('emailForwardingHint')
    expect(line.attributes('data-tone')).toBe('caution')
  })

  it('names a public provider in its badge and gives it no line', async () => {
    const free = { ...recipient('c@gmail.com', 'cc'), providerKind: 'public' as const }
    const wrapper = mount(MailRecipients, { props: { recipients: [recipients[0], free] } })
    await press(wrapper, 'c@gmail.com')
    const block = wrapper.get('[data-recipient-more]')
    expect(block.get('[data-verdict]').attributes('data-verdict')).toBe('public')
    expect(block.find('[data-status]').exists()).toBe(false)
  })

  // Said as under every other address, not as two addresses with a dash between
  it('gives the other spelling of a recipient\'s domain in words', async () => {
    const wrapper = mount(MailRecipients, { props: { recipients: [recipients[0], recipient('d@пример.test', 'cc')] } })
    await press(wrapper, 'd@пример.test')
    const spelling = wrapper.get('[data-recipient-more] [data-other-spelling]')
    expect(spelling.text()).toContain('domainPunycode')
    expect(spelling.text()).toContain('xn--')
  })

  // The same trick as in a site's address, so the same line, from the same
  // component, and the same red on the labels that spell the borrowed name
  it('says a well-known name inside a recipient\'s domain as every address says it, and colours it in a closed row too', async () => {
    const wrapper = mount(MailRecipients, { props: { recipients } })
    await flushPromises()
    const other = wrapper.get('[data-recipient="b@paypal.com.other.test"]')
    // Closed: a flag with its count, and the borrowed name in red in the address
    expect(other.get('[data-red-flags]').attributes('data-red-flags')).toBe('1')
    expect(other.findAll('.vz-lbl').map(label => label.attributes('data-tone') ?? '-')).toEqual(['danger', 'danger', '-', '-'])
    const first = wrapper.get('[data-recipient="a@paypal.com.evil.test"]')
    expect(first.findAll('.vz-lbl').map(label => label.attributes('data-tone') ?? '-')).toEqual(['danger', 'danger', '-', '-'])
    await press(wrapper, 'b@paypal.com.other.test')
    await flushPromises()
    const flag = wrapper.get('[data-recipient-more] [data-red-flag]')
    expect(flag.attributes('data-marker')).toBe('embedded-public-suffix')
    expect(flag.attributes('data-tone')).toBe('danger')
    expect(flag.findAll('[data-marker-imitated]').map(name => name.text())).toEqual(['paypal.com'])
  })
})

describe('the prefilled fields of a mailto', () => {
  it('lists every field while no list of recipients is drawn', () => {
    const wrapper = breakdown([{ key: 'cc', value: 'bob@corp.test' }, { key: 'subject', value: 'Invoice' }])
    expect(wrapper.text()).toContain('bob@corp.test')
    expect(wrapper.text()).toContain('Invoice')
  })

  // The list of recipients names it with its field, so here it was the same line again
  it('leaves out a copy the list of recipients already shows', () => {
    const wrapper = breakdown(
      [{ key: 'Cc', value: 'bob@corp.test, Eve@Other.test' }, { key: 'subject', value: 'Invoice' }],
      ['ann@corp.test', 'bob@corp.test', 'eve@other.test'],
    )
    expect(wrapper.text()).not.toContain('bob@corp.test')
    expect(wrapper.text()).toContain('Invoice')
  })

  // An entry that does not read as an address is in no list. Dropped here as
  // well, a hidden copy written as `Name <address>` would be on screen nowhere.
  it('keeps a hidden copy the list of recipients does not show', () => {
    const wrapper = breakdown(
      [{ key: 'bcc', value: 'Name <thief@evil.test>' }],
      ['ann@corp.test', 'bob@corp.test'],
    )
    expect(wrapper.text()).toContain('thief@evil.test')
  })

  it('keeps a field whole when only some of its addresses are listed', () => {
    const wrapper = breakdown(
      [{ key: 'bcc', value: 'bob@corp.test,p26@late.test' }],
      ['ann@corp.test', 'bob@corp.test'],
    )
    expect(wrapper.text()).toContain('p26@late.test')
  })
})
