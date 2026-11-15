import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultFamiliaritySettings } from '~/logic/familiarity'
import { settings } from '~/logic/storage'
import FamiliarityGrid from '../FamiliarityGrid.vue'

// No locale is loaded under jsdom, so `t` hands back the key it was given

function configure() {
  settings.value.showFamiliarityThresholds = false
  settings.value.familiarity = structuredClone(defaultFamiliaritySettings)
}

describe('familiarityGrid component', () => {
  afterEach(() => configure())

  it('gives every check a cell once there is a visit on record', () => {
    configure()
    const wrapper = mount(FamiliarityGrid, { props: { stats: { count: 2 } } })
    expect(wrapper.findAll('[data-criterion]')).toHaveLength(3)
    expect(wrapper.find('[data-never-visited]').exists()).toBe(false)
  })

  // Under a badge that is not a verdict on the site, such as "Short link",
  // nothing else would say it
  it('says a site was never visited in one line, not as a cell per check', () => {
    configure()
    const wrapper = mount(FamiliarityGrid, { props: { stats: { count: 0 } } })
    expect(wrapper.get('[data-never-visited]').text()).toBe('linkTooltipNeverVisited')
    expect(wrapper.find('[data-criterion]').exists()).toBe(false)
  })

  it('draws nothing for such a site under a verdict that already says it', () => {
    configure()
    const wrapper = mount(FamiliarityGrid, { props: { stats: { count: 0 }, verdictBeside: true } })
    expect(wrapper.text()).toBe('')
  })
})
