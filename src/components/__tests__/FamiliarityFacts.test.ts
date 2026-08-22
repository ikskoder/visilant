import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultFamiliaritySettings } from '~/logic/familiarity'
import { settings } from '~/logic/storage'
import FamiliarityFacts from '../FamiliarityFacts.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given. That
// is what the assertions match on – the keys are the stable part anyway.
const DAY = 24 * 60 * 60 * 1000

/**
 * Both settings this component reads, set outright.
 *
 * `settings` is backed by extension storage and re-hydrates on its own, so a
 * value left to an afterEach can come back before the next test renders.
 */
function configure(options: { thresholds?: boolean, familiarity?: Partial<typeof defaultFamiliaritySettings> } = {}) {
  settings.value.showFamiliarityThresholds = options.thresholds === true
  settings.value.familiarity = { ...structuredClone(defaultFamiliaritySettings), ...options.familiarity }
}

describe('familiarityFacts component', () => {
  afterEach(() => configure())

  it('names every check the verdict was drawn from', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, {
      props: { stats: { count: 12, activeDays: 6, firstSeen: Date.now() - 40 * DAY } },
    })
    expect(wrapper.text()).toContain('familiarityVisits')
    expect(wrapper.text()).toContain('familiarityActiveDays')
    expect(wrapper.text()).toContain('familiarityAge')
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).toContain('6')
    expect(wrapper.text()).toContain('40')
  })

  // A number with no say in the verdict has no business taking up a line
  it('leaves out a check the user has switched off', () => {
    configure({ familiarity: { age: { enabled: false, min: 10 } } })
    const wrapper = mount(FamiliarityFacts, {
      props: { stats: { count: 12, activeDays: 6, firstSeen: Date.now() - 40 * DAY } },
    })
    expect(wrapper.text()).toContain('familiarityVisits')
    expect(wrapper.text()).not.toContain('familiarityAge')
  })

  // Three checks side by side run off the edge of a phone, so each gets a line
  it('stacks the facts one per line while the bar is hidden', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, {
      props: { stats: { count: 3, activeDays: 1, firstSeen: Date.now() } },
    })
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('span[data-criterion]')).toHaveLength(3)
    expect(wrapper.find('[data-criterion="visits"]').text()).toBe('3')
  })

  // The lines are of different lengths, so a trailing mark would land in a
  // different place on each one and there would be no column to read down
  it('opens each stacked line with its mark rather than closing it', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, { props: { stats: { count: 3 } } })
    const line = wrapper.findAll('span[title]')[0].text()
    expect(line.indexOf('✗')).toBeLessThan(line.indexOf('familiarityVisits'))
  })

  // A bare "3 / 10" a moment later is a pair of numbers whose meaning is gone,
  // so the bar arrives with headings rather than on its own
  it('lays the facts out as a headed table once the bar is asked for', () => {
    configure({ thresholds: true })
    const wrapper = mount(FamiliarityFacts, {
      props: { stats: { count: 3, activeDays: 1, firstSeen: Date.now() } },
    })
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).toContain('familiarityFactCheck')
    expect(wrapper.text()).toContain('familiarityFactValue')
    expect(wrapper.text()).toContain('familiarityFactNeeded')
    expect(wrapper.find('[data-criterion="visits"]').text()).toBe('3')
    expect(wrapper.find('[data-required="visits"]').text()).toBe('10')
    expect(wrapper.text()).toContain('✗')
  })

  // Both shapes carry the mark, and not only the colour: green on its own asks
  // the reader to already know what green means here
  it.each([true, false])('marks each check as passed or not (bar shown: %s)', (thresholds) => {
    configure({ thresholds })
    const passing = mount(FamiliarityFacts, {
      props: { stats: { count: 50, activeDays: 30, firstSeen: Date.now() - 400 * DAY } },
    })
    expect(passing.find('[data-passed="visits"]').text()).toBe('✓')
    expect(passing.text()).not.toContain('✗')

    const failing = mount(FamiliarityFacts, { props: { stats: { count: 1 } } })
    expect(failing.find('[data-passed="visits"]').text()).toBe('✗')
    // A fact nothing ever recorded is a failed check like any other
    expect(failing.find('[data-passed="age"]').text()).toBe('✗')
    expect(failing.find('[data-passed="age"]').classes()).toContain('text-red-500')
  })

  // Records written before those fields existed cannot answer them, and no
  // amount of visiting fills them in – only a history import can
  it('says unknown rather than zero for a fact never recorded', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, { props: { stats: { count: 4 } } })
    expect(wrapper.text()).toContain('statsUnknown')
    expect(wrapper.html()).toContain('statsImportHint')
  })

  it('marks a passed check apart from a failed one', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, {
      props: { stats: { count: 50, activeDays: 1, firstSeen: Date.now() - 400 * DAY } },
    })
    const html = wrapper.html()
    expect(html).toContain('text-green-600')
    expect(html).toContain('text-red-500')
  })

  // Under `all` the colours say everything. Under `any` a red check next to a
  // familiar verdict looks like a bug without a tally to explain it.
  it('tallies the checks only when not all of them have to pass', () => {
    const props = { stats: { count: 50, activeDays: 1, firstSeen: Date.now() } }

    configure()
    expect(mount(FamiliarityFacts, { props }).text()).not.toContain('badgeContentChecks')

    configure({ familiarity: { mode: 'any' } })
    const wrapper = mount(FamiliarityFacts, { props })
    expect(wrapper.text()).toContain('badgeContentChecks')
    expect(wrapper.find('[data-criterion="checks"]').text()).toBe('1 / 3')
  })

  // The tally is the conclusion and the checks above it are the working, so it
  // is set apart rather than reading as one more row
  it.each([true, false])('sets the tally in bold (bar shown: %s)', (thresholds) => {
    configure({ thresholds, familiarity: { mode: 'any' } })
    const wrapper = mount(FamiliarityFacts, { props: { stats: { count: 50 } } })
    const tally = wrapper.find('[data-criterion="checks"]')
    const line = thresholds ? tally.element.closest('tr') : tally.element.parentElement
    expect(line?.className).toContain('font-bold')
  })

  // The verdict is the answer and the facts are the working, so it goes first,
  // right under the address it is about
  it('puts the status handed to it above the facts', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, {
      props: { stats: { count: 0 } },
      slots: { status: '<span class="verdict">never visited</span>' },
    })
    expect(wrapper.find('.verdict').exists()).toBe(true)
    expect(wrapper.text().indexOf('never visited')).toBeLessThan(wrapper.text().indexOf('familiarityVisits'))
  })

  // A fact that was never recorded fails its check like any other, so greying it
  // out told the reader it did not count while it was deciding the answer
  it('colours a missing fact as a failure, in italics', () => {
    configure()
    const wrapper = mount(FamiliarityFacts, { props: { stats: { count: 50 } } })
    const missing = wrapper.find('[data-criterion="age"]')
    expect(missing.classes()).toContain('text-red-500')
    expect(missing.classes()).toContain('italic')
  })

  it('draws the table with borders of its own', () => {
    configure({ thresholds: true })
    const wrapper = mount(FamiliarityFacts, { props: { stats: { count: 3 } } })
    expect(wrapper.find('table').classes()).toContain('familiarity-table')
  })
})
