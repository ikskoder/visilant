import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import MismatchTable from '../MismatchTable.vue'

const DAY = 24 * 60 * 60 * 1000

describe('mismatchTable component', () => {
  const defaultProps = {
    textDomain: 'paypal.com',
    textDomainIsSafe: true,
    textDomainStats: { count: 50, activeDays: 20, firstSeen: Date.now() - 400 * DAY },
    destDomain: 'evil.com',
    destIsSafe: false,
    destStats: { count: 0 },
    showVisitCount: 'always' as const,
  }

  it('renders a table with both domains', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).toContain('paypal.com')
    expect(wrapper.text()).toContain('evil.com')
  })

  it('shows visit counts when showVisitCount is always', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    expect(wrapper.text()).toContain('50')
    expect(wrapper.text()).toContain('0')
  })

  // The whole point of the table is a comparison, so every check the user judges
  // by gets a row of its own rather than the visit count standing in for them
  it('gives each familiarity check a row', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const labels = wrapper.findAll('tr').map(row => row.text())
    expect(labels.some(text => text.includes('familiarityVisits'))).toBe(true)
    expect(labels.some(text => text.includes('familiarityActiveDays'))).toBe(true)
    expect(labels.some(text => text.includes('familiarityAge'))).toBe(true)
  })

  // A record written before those fields existed cannot answer them, and a zero
  // there would read as a measured fact rather than as a blank
  it('says unknown where a fact was never recorded', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    expect(wrapper.text()).toContain('statsUnknown')
  })

  // The colour alone says nothing to a reader who does not already know what
  // green means here, so each side of the comparison carries a mark too
  it('marks each side of every check as passed or not', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const marks = wrapper.findAll('[data-passed="visits"]').map(node => node.text())
    // The familiar domain clears the visit check, the unvisited one does not
    expect(marks).toEqual(['✓', '✗'])
  })

  // These surfaces are drawn on somebody else's page in both themes, and the
  // verdict used to be a flat text-yellow-400 – a dark-theme choice that all
  // but vanishes on the white card the light theme draws
  it('picks the verdict colour for the theme it is drawn in', () => {
    const statusOf = (isDark: boolean) => mount(MismatchTable, {
      props: defaultProps,
      global: { provide: { isDark: ref(isDark) } },
    // Row 0 is the head, row 1 the two domains, row 2 the verdict
    }).findAll('tr')[2].findAll('td')[1].classes()

    expect(statusOf(true)).toContain('text-green-400')
    expect(statusOf(false)).toContain('text-green-700')
  })

  it('hides visit counts when showVisitCount is never', () => {
    const wrapper = mount(MismatchTable, {
      props: { ...defaultProps, showVisitCount: 'never' as const },
    })
    // Should not have a visits row at all
    const rows = wrapper.findAll('tr')
    const hasVisitRow = rows.some(r => r.text().includes('50'))
    expect(hasVisitRow).toBe(false)
  })

  it('shows counts only for unfamiliar domains when showVisitCount is unfamiliar', () => {
    const wrapper = mount(MismatchTable, {
      props: { ...defaultProps, showVisitCount: 'unfamiliar' as const },
    })
    // destDomain (unsafe, count=0) should show count
    // textDomain (safe) should be hidden
    expect(wrapper.text()).toContain('0')
  })

  it('emits details with domain when details button is clicked', async () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const buttons = wrapper.findAll('button')
    // There should be 2 details buttons (one per column)
    expect(buttons.length).toBe(2)

    await buttons[0].trigger('click')
    expect(wrapper.emitted('details')?.[0]).toEqual(['paypal.com'])

    await buttons[1].trigger('click')
    expect(wrapper.emitted('details')?.[1]).toEqual(['evil.com'])
  })

  it('applies custom cellPadding', () => {
    const wrapper = mount(MismatchTable, {
      props: { ...defaultProps, cellPadding: 'p-4' },
    })
    const cells = wrapper.findAll('td')
    const hasCustomPadding = cells.some(c => c.classes().includes('p-4'))
    expect(hasCustomPadding).toBe(true)
  })
})
