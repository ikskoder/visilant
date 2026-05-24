import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MismatchTable from '../MismatchTable.vue'

describe('mismatchTable component', () => {
  const defaultProps = {
    textDomain: 'paypal.com',
    textDomainIsSafe: true,
    textDomainCount: 50,
    destDomain: 'evil.com',
    destIsSafe: false,
    destCount: 0,
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
