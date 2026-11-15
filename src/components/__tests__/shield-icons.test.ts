import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LOGO_OUTLINE, shieldPath } from '../shield-icons'
import VzSig from '../VzSig.vue'

const logo = readFileSync(resolve(__dirname, '../../assets/icon.svg'), 'utf8')

describe('shield icons', () => {
  // Every shield is cut from the logo's own outline. Were the asset redrawn in
  // another shape, the icons would fall back to a plain shield without a word
  it('takes its outline from the logo', () => {
    expect(LOGO_OUTLINE).toBeTruthy()
    expect(logo).toContain(`fill="#0891b2" d="${LOGO_OUTLINE}"`)
    expect(shieldPath('alert').startsWith(LOGO_OUTLINE!)).toBe(true)
  })

  // A mark outside the logo's square would be drawn beside the shield, or not at all
  it('keeps every mark inside the square the logo is drawn on', () => {
    for (const mark of ['pass', 'fail', 'unknown', 'alert', 'flag', 'info', 'pending'] as const) {
      const cut = shieldPath(mark).slice(LOGO_OUTLINE!.length)
      const numbers = cut.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
      expect(numbers.length).toBeGreaterThan(4)
      expect(Math.min(...numbers)).toBeGreaterThan(224 + 300)
      expect(Math.max(...numbers)).toBeLessThan(224 + 1600 - 300)
    }
  })
})

describe('vzSig component', () => {
  // One picture at the head of a box: the sign is in the shield, not beside it
  it('draws the sign and the signature as one icon', () => {
    const wrapper = mount(VzSig, { props: { mark: 'alert', large: true } })
    expect(wrapper.findAll('svg')).toHaveLength(1)
    expect(wrapper.get('.vz-sig').attributes('data-sign')).toBe('alert')
    expect(wrapper.get('svg').classes()).toEqual(expect.arrayContaining(['vz-icon--shield-alert', 'tone-danger']))
    expect(wrapper.get('svg').attributes('aria-label')).toBe('Visilant')
  })

  // Red and orange share this one mark, so the tone is said in an attribute a
  // test can read, not in the colour alone
  it('draws the exclamation mark in orange for a box with nothing red in it', () => {
    expect(mount(VzSig, { props: { mark: 'alert' } }).get('.vz-sig').attributes('data-tone')).toBe('danger')
    const wrapper = mount(VzSig, { props: { mark: 'alert', caution: true } })
    expect(wrapper.get('.vz-sig').attributes('data-tone')).toBe('caution')
    expect(wrapper.get('svg').classes()).toContain('tone-caution')
    // Only the exclamation mark has an orange reading
    expect(mount(VzSig, { props: { mark: 'flag', caution: true } }).get('.vz-sig').attributes('data-tone')).toBe('danger')
  })

  it('draws the logo where the row has nothing to signal', () => {
    const wrapper = mount(VzSig)
    expect(wrapper.findAll('svg')).toHaveLength(1)
    expect(wrapper.get('.vz-sig').attributes('aria-label')).toBe('Visilant')
    expect(wrapper.find('[data-sign]').exists()).toBe(false)
  })
})
