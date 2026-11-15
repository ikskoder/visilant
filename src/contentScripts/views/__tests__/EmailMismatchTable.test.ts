import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EmailMismatchTable from '../EmailMismatchTable.vue'

const DAY = 24 * 60 * 60 * 1000
const familiar = { stats: { count: 120, activeDays: 60, firstSeen: Date.now() - 400 * DAY }, isSafe: true }
const never = { stats: { count: 0 }, isSafe: false }

function shows(username: string | null, domain: string, kind: 'regular' | 'public' | 'disposable' | 'forwarding' = 'regular', facts = familiar) {
  return { textAddress: username ? `${username}@${domain}` : domain, username, domain, providerKind: kind, ...facts }
}
function goes(username: string, domain: string, kind: 'regular' | 'public' | 'disposable' | 'forwarding' = 'regular', facts = never) {
  return { username, domain, providerKind: kind, ...facts }
}

const table = (props: Record<string, unknown>) => mount(EmailMismatchTable, { props: { showVisitCount: 'always', ...props } as any })

// The text of a mail link against where the mail goes, part by part: what
// is the same once across both columns, what differs side by side
describe('the table of what a mail link shows and where it goes', () => {
  it('draws a part that is the same once, across both columns', () => {
    const wrapper = table({ shows: shows('billing', 'yourbank.test'), goes: goes('billing', 'yourbank-help.test') })
    const username = wrapper.get('[data-row="username"]')
    expect(username.findAll('td')).toHaveLength(1)
    expect(username.get('td').attributes('colspan')).toBe('2')
    expect(wrapper.get('[data-row="domain"]').findAll('td')).toHaveLength(2)
  })

  it('sets parts that differ side by side, the target\'s frame marked', () => {
    const wrapper = table({ shows: shows('billing', 'corp.test'), goes: goes('b1lling', 'corp.test', 'regular', familiar) })
    const username = wrapper.get('[data-row="username"]')
    expect(username.findAll('td')).toHaveLength(2)
    expect(username.find('.email-mismatch__differs').exists()).toBe(true)
  })

  // One domain has one verdict, and its numbers are the card's below
  it('says the verdict of one domain once and leaves out the visits', () => {
    const wrapper = table({ shows: shows('billing', 'corp.test'), goes: goes('b1lling', 'corp.test', 'regular', familiar) })
    expect(wrapper.get('[data-row="status"]').findAll('td')).toHaveLength(1)
    expect(wrapper.find('[data-passed]').exists()).toBe(false)
  })

  it('sets the visits of two domains side by side', () => {
    const wrapper = table({ shows: shows('billing', 'yourbank.test'), goes: goes('billing', 'yourbank-help.test') })
    expect(wrapper.findAll('[data-verdict]').map(badge => badge.attributes('data-verdict'))).toEqual(['familiar', 'never'])
    expect(wrapper.findAll('[data-passed="visits"]')).toHaveLength(2)
  })

  // Nobody opens the domain of a mail service, so a count there says nothing
  it('gives a mail service its badge and one cell saying why it has no visits', () => {
    const wrapper = table({ shows: shows('billing', 'corp.test'), goes: goes('corp.billing', 'gmail.com', 'public') })
    expect(wrapper.find('[data-not-by-visits]').exists()).toBe(true)
    expect(wrapper.findAll('[data-passed="visits"]')).toHaveLength(1)
  })

  it('draws no visit rows when neither side is judged by visits', () => {
    const wrapper = table({ shows: shows('ann', 'gmail.com', 'public'), goes: goes('ann', 'outlook.com', 'public') })
    expect(wrapper.find('[data-not-by-visits]').exists()).toBe(false)
    expect(wrapper.find('[data-passed]').exists()).toBe(false)
  })

  it('says in words that the text named no username', () => {
    const wrapper = table({ shows: shows(null, 'corp.test'), goes: goes('x', 'new-place.test') })
    expect(wrapper.get('[data-no-username]').text()).toBe('emailMismatchNoUsername')
  })

  it('heads the column with which recipient it is, when there are several', () => {
    const wrapper = table({ shows: shows('billing', 'corp.test'), goes: goes('billing', 'c0rp.test'), position: { n: 2, total: 3 } })
    expect(wrapper.get('thead').text()).toContain('emailMismatchGoesToOf')
  })

  it('underlines the labels of the target domain the text does not have', () => {
    const wrapper = table({ shows: shows('billing', 'yourbank.test'), goes: goes('billing', 'yourbank-help.test') })
    const marked = wrapper.get('[data-row="domain"] [data-side="goes"]').findAll('[data-diff]').map(char => char.text()).join('')
    expect(marked).toBe('yourbank-help')
  })

  it('leaves the labels the text has anywhere plain', () => {
    const wrapper = table({ shows: shows(null, 'acme.com'), goes: goes('x', 'acme.com.evil.test') })
    const marked = wrapper.get('[data-row="domain"] [data-side="goes"]').findAll('[data-diff]').map(char => char.text()).join('')
    expect(marked).toBe('eviltest')
  })

  // The same address in two spellings is one address
  it('takes a domain in its coded form and a username in other case for the same', () => {
    const wrapper = table({ shows: shows('Billing', 'münich.example'), goes: goes('billing', 'xn--mnich-kva.example') })
    expect(wrapper.get('[data-row="username"]').findAll('td')).toHaveLength(1)
    expect(wrapper.get('[data-row="domain"]').findAll('td')).toHaveLength(1)
  })

  it('lets each heading copy its whole address', () => {
    const wrapper = table({ shows: shows('billing', 'yourbank.test'), goes: goes('billing', 'yourbank-help.test') })
    expect(wrapper.findAll('thead .vz-copy')).toHaveLength(2)
  })

  // Every label is in the text, one of them twice
  it('underlines what stands out of place when every label is somewhere in the text', () => {
    const wrapper = table({ shows: shows('boss', 'paypal.com'), goes: goes('boss', 'paypal.com.com') })
    const marked = wrapper.get('[data-row="domain"] [data-side="goes"]').findAll('[data-diff]').map(char => char.text()).join('')
    expect(marked).toBe('paypalcom')
  })
})
