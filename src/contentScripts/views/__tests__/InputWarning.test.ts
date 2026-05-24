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

  it('emits ignoreSite when "dont show again" is clicked', async () => {
    const wrapper = mount(InputWarning, { props: defaultProps })
    // The ignore button is the first button with group class
    const ignoreBtn = wrapper.find('button.group')
    await ignoreBtn.trigger('click')
    expect(wrapper.emitted('ignoreSite')).toBeTruthy()
  })
})
