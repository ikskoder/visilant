import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import FactText from '../FactText.vue'

/** In a span of its own, as every surface draws it, and read as the page reads it. */
function draw(text: string) {
  const wrapper = mount({ render: () => h('span', [h(FactText, { text })]) })
  return { text: wrapper.element.textContent, units: wrapper.findAll('.vz-fact__unit').map(unit => unit.element.textContent) }
}

describe('factText', () => {
  it('draws the word after a number apart, held to it by a no-break space', () => {
    expect(draw('3 / 10 days')).toEqual({ text: '3 / 10\u00A0days', units: ['\u00A0days'] })
  })

  it('leaves a bare number and a placeholder as they are', () => {
    expect(draw('465')).toEqual({ text: '465', units: [] })
    expect(draw('not recorded')).toEqual({ text: 'not recorded', units: [] })
  })

  it('marks every unit when the bar repeats it', () => {
    expect(draw('3 days / 7 days')).toEqual({ text: '3\u00A0days / 7\u00A0days', units: ['\u00A0days', '\u00A0days'] })
  })
})
