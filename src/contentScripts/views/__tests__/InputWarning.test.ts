import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InputWarning from '../InputWarning.vue'

describe('inputWarning component', () => {
  const defaultProps = {
    safetyLevel: false as boolean | null,
    show: true,
    warningType: 'input' as const,
  }

  it('renders when show=true and safetyLevel=false', () => {
    const wrapper = mount(InputWarning, { props: defaultProps })
    expect(wrapper.html()).toBeTruthy()
    // Should contain the warning container
    expect(wrapper.find('.popup-container').exists()).toBe(true)
  })

  it('does not render when show=false', () => {
    const wrapper = mount(InputWarning, {
      props: { ...defaultProps, show: false },
    })
    expect(wrapper.find('.popup-container').exists()).toBe(false)
  })

  it('does not render when safetyLevel=true (safe site)', () => {
    const wrapper = mount(InputWarning, {
      props: { ...defaultProps, safetyLevel: true },
    })
    expect(wrapper.find('.popup-container').exists()).toBe(false)
  })

  it('does not render when safetyLevel=null', () => {
    const wrapper = mount(InputWarning, {
      props: { ...defaultProps, safetyLevel: null },
    })
    expect(wrapper.find('.popup-container').exists()).toBe(false)
  })

  it('emits close when close button is clicked', async () => {
    const wrapper = mount(InputWarning, { props: defaultProps })
    // Close button is the last button with sr-only text
    const closeBtn = wrapper.find('button.flex-shrink-0')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  /**
   * The whole point of the change: silencing a site is not reachable from the
   * page the warning is about. A page cannot press a button in a closed shadow
   * root, but it can tell the reader to, so there is no button to be told about.
   * The only control left here closes the warning, which decides nothing.
   */
  it('offers nothing that turns the warnings off', () => {
    const wrapper = mount(InputWarning, { props: defaultProps })
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.find('button.flex-shrink-0').exists()).toBe(true)
  })

  it('says where the switch actually is', () => {
    const wrapper = mount(InputWarning, { props: defaultProps })
    expect(wrapper.text()).toContain('warningSilenceHint')
  })
})
