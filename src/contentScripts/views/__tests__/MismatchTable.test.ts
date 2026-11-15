import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MismatchTable from '../MismatchTable.vue'

const DAY = 24 * 60 * 60 * 1000

describe('mismatchTable component', () => {
  afterEach(() => {
    // Put back what jsdom had, so no later test finds a clipboard it did not ask for
    Reflect.deleteProperty(navigator, 'clipboard')
  })

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

  // Beside the numbers of the other side an empty cell takes the same room as
  // a zero and says less. A site never visited has no active days yet, and
  // "none" there is a blank rather than a measured zero
  it('keeps the zeros of a site never visited beside the numbers of the other', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    expect(wrapper.text()).toContain('statsNoneYet')
    expect(wrapper.findAll('[data-passed="visits"]').map(node => node.attributes('data-result'))).toEqual(['pass', 'fail'])
    expect(wrapper.findAll('tbody td').filter(cell => !cell.text() && !cell.element.children.length)).toHaveLength(1)
  })

  // Two verdicts reading "Never visited" over three rows of zeros against zeros
  it('draws no rows of facts when neither site was ever visited', () => {
    const wrapper = mount(MismatchTable, { props: { ...defaultProps, textDomainIsSafe: false, textDomainStats: { count: 0 } } })
    expect(wrapper.text()).not.toContain('familiarityVisits')
    expect(wrapper.findAll('[data-verdict]').map(node => node.attributes('data-verdict'))).toEqual(['never', 'never'])
  })

  // "hidden by settings" against a zero and two "none": nothing to compare
  it('draws no rows when one side is hidden by the setting and the other was never visited', () => {
    const wrapper = mount(MismatchTable, { props: { ...defaultProps, showVisitCount: 'unfamiliar' as const } })
    expect(wrapper.text()).not.toContain('familiarityVisits')
    expect(wrapper.text()).not.toContain('mismatchVisitsHidden')
  })

  // The other way round the numbers are on show, and the side without them
  // says why
  it('says a side is hidden by the setting beside the numbers of the other', () => {
    const wrapper = mount(MismatchTable, { props: { ...defaultProps, showVisitCount: 'familiar' as const } })
    expect(wrapper.findAll('[data-passed="visits"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('mismatchVisitsHidden')
  })

  // The colour alone says nothing to a reader who does not already know what
  // green means here, so each side of the comparison carries a mark too
  it('marks each side of every check as passed or not', () => {
    const wrapper = mount(MismatchTable, { props: { ...defaultProps, destStats: { count: 2 } } })
    const marks = wrapper.findAll('[data-passed="visits"]').map(node => node.attributes('data-result'))
    // The familiar domain clears the visit check, the one seen twice does not
    expect(marks).toEqual(['pass', 'fail'])
  })

  // A verdict is a word, a shape and a colour together, the same in both themes
  it('gives each side its verdict as a badge', () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const badges = wrapper.findAll('[data-verdict]').map(node => node.attributes('data-verdict'))
    expect(badges).toEqual(['familiar', 'never'])
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
      props: { ...defaultProps, destStats: { count: 2 }, showVisitCount: 'unfamiliar' as const },
    })
    // destDomain (unsafe, seen twice) shows its count, textDomain (safe) says it is hidden
    expect(wrapper.findAll('[data-passed="visits"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('mismatchVisitsHidden')
  })

  it('copies each address as it is, not as drawn', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const copies = wrapper.findAll('[data-action="copy"]')
    expect(copies).toHaveLength(2)
    await copies[1].trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('evil.com')
    expect(copies[1].attributes('data-copy-state')).toBe('copied')
    // Said to a screen reader, since a changed title is not read out
    expect(wrapper.findAll('[role="status"]')[1].text()).not.toBe('')
  })

  it('says so when the clipboard refuses', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const copy = wrapper.find('[data-action="copy"]')
    await copy.trigger('click')
    await flushPromises()
    expect(copy.attributes('data-copy-state')).toBe('failed')
  })

  it('emits details with domain when details button is clicked', async () => {
    const wrapper = mount(MismatchTable, { props: defaultProps })
    const buttons = wrapper.findAll('button:not([data-action="copy"])')
    // There should be 2 details buttons (one per column)
    expect(buttons.length).toBe(2)

    await buttons[0].trigger('click')
    expect(wrapper.emitted('details')?.[0]).toEqual(['paypal.com'])

    await buttons[1].trigger('click')
    expect(wrapper.emitted('details')?.[1]).toEqual(['evil.com'])
  })
})
