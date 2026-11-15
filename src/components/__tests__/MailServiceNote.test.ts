import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { resetLookalikeCache } from '~/composables/useLookalikes'
import { resetFindingsOnScreen } from '~/composables/useRedFlags'
import { ADDRESS_SHAPE_KEY } from '~/logic/address-shape'
import { addressShape } from '~/logic/domain-boundary'
import { isCautionMailService, loadCustomEmailLists, MAIL_SERVICE_VERDICTS, updatePublicList } from '~/logic/email-providers'
import AddressFindings from '../AddressFindings.vue'
import MailServiceBadge from '../MailServiceBadge.vue'
import SecureText from '../SecureText.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given

const provide = { [ADDRESS_SHAPE_KEY as symbol]: addressShape }
/** The lines about an email address's domain, as every surface draws them. */
function lines(hostname: string, props: Record<string, unknown> = {}) {
  return mount(AddressFindings, { props: { hostname, context: 'email', familiar: true, ...props } as any, global: { provide } })
}

afterEach(() => {
  resetFindingsOnScreen()
  resetLookalikeCache()
  loadCustomEmailLists([], [])
  updatePublicList([])
})

// One line per kind and one question mark, the same wherever it is drawn.
// There were three wordings of each, and side by side they read as three
// explanations of one thing
describe.each([
  ['disposable', 'mailinator.com', 'emailDisposableHint'],
  ['forwarding', 'mozmail.com', 'emailForwardingHint'],
] as const)('the line about a %s mail service', (kind, domain, key) => {
  it('says what the service is, with what writing to it means behind the question mark', async () => {
    const wrapper = lines(domain, { mailService: kind })
    const line = wrapper.get(`[data-status="${kind}"]`)
    expect(line.text()).toBe(key)
    expect(line.attributes('data-tone')).toBe('caution')
    await line.get('[data-action="help"]').trigger('click')
    expect(line.get('[data-help-text]').text()).toBe('emailHiddenOwnerHelp')
  })

  // The badge names the kind where there is one. Under a recipient in a list
  // there is none, and the line is headed with the same name
  it('is headed with the kind\'s name only where no badge says it', () => {
    expect(lines(domain, { mailService: kind }).find('[data-service-name]').exists()).toBe(false)
    const named = lines(domain, { mailService: kind, nameMailService: true })
    expect(named.get('[data-service-name]').text()).toBe(MAIL_SERVICE_VERDICTS[kind].label)
    expect(named.get(`[data-status="${kind}"]`).text()).toContain(key)
  })

  // Lines on screen and colour in the address are one fact
  it('draws the site in the line\'s orange while the line is on screen', async () => {
    const address = mount(SecureText, { props: { text: domain }, global: { provide } })
    const tones = () => address.findAll('.vz-lbl').map(label => label.attributes('data-tone') ?? '-')
    await flushPromises()
    expect(tones()).toEqual(['-', '-'])
    const under = lines(domain, { mailService: kind })
    await flushPromises()
    expect(tones()).toEqual(['caution', 'caution'])
    under.unmount()
    await flushPromises()
    expect(tones()).toEqual(['-', '-'])
  })

  it('is a kind of service the reader is told to be careful with', () => {
    expect(isCautionMailService(kind)).toBe(true)
    expect(MAIL_SERVICE_VERDICTS[kind].tone).toBe('caution')
  })
})

describe('the line about a public mail service', () => {
  it('says to judge the name before the @, in grey, and colours nothing', async () => {
    const address = mount(SecureText, { props: { text: 'gmail.com' }, global: { provide } })
    const wrapper = lines('gmail.com', { mailService: 'public' })
    await flushPromises()
    const line = wrapper.get('[data-status="public"]')
    expect(line.text()).toBe('emailPublicProviderHint')
    expect(line.attributes('data-tone')).toBe('neutral')
    expect(address.findAll('[data-tone]')).toHaveLength(0)
    expect(isCautionMailService('public')).toBe(false)
  })

  // A downloaded list may add a note, never lift the verdict
  it('notes a domain only a downloaded list names, which stays an ordinary one', () => {
    expect(lines('corp.test', { mailService: 'regular' }).find('.vz-notice').exists()).toBe(false)
    updatePublicList(['corp.test'])
    expect(lines('corp.test', { mailService: 'regular' }).get('[data-status="listed-public"]').text()).toBe('emailRemotePublicHint')
  })
})

describe('an ordinary domain', () => {
  it('gets no line about a mail service', () => {
    expect(lines('corp.test', { mailService: 'regular' }).find('[data-status]').exists()).toBe(false)
    expect(lines('corp.test').find('[data-status]').exists()).toBe(false)
    expect(isCautionMailService('regular')).toBe(false)
    expect(isCautionMailService(undefined)).toBe(false)
  })
})

describe('the badge in place of a verdict', () => {
  it.each(['public', 'disposable', 'forwarding'] as const)('names a %s service from the one table', (kind) => {
    const badge = mount(MailServiceBadge, { props: { kind } }).get('.vz-badge')
    expect(badge.attributes('data-verdict')).toBe(kind)
    expect(badge.attributes('data-tone')).toBe(MAIL_SERVICE_VERDICTS[kind].tone)
    expect(badge.text()).toBe(MAIL_SERVICE_VERDICTS[kind].label)
  })
})
