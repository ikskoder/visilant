import type { Component } from 'vue'
import { defineComponent, h } from 'vue'

/**
 * The verdict: Visilant's shield with a check, a cross or a dash cut out of it.
 *
 * Cut out rather than drawn on top, as carbon's `checkmark-filled` is: the
 * mark is whatever is behind the shield, the badge's own tint, which is a pair
 * the contrast tests already hold to its ratio. A mark painted in a second
 * colour would keep that colour in a forced-colours theme that turns the
 * shield the same one. The outline is the same for every verdict, so the mark
 * and the words beside it carry the difference, never the colour alone.
 *
 * Defined once here rather than inside VzIcon's setup, which runs for every
 * icon on the page.
 */
const SHIELD = 'M16 1.6L28.4 5.6V15.2C28.4 22.7 23.2 28.2 16 30.4C8.8 28.2 3.6 22.7 3.6 15.2V5.6Z'
const SHIELD_MARKS = {
  pass: 'M10 15.9L12.2 13.7L14.6 16.1L20.3 10.4L22.5 12.6L14.6 20.5Z',
  fail: 'M10.8 12.7L13.1 10.4L16 13.3L18.9 10.4L21.2 12.7L18.3 15.6L21.2 18.5L18.9 20.8L16 17.9L13.1 20.8L10.8 18.5L13.7 15.6Z',
  unknown: 'M10.5 14.1H21.5V17.1H10.5Z',
}

function shield(mark: keyof typeof SHIELD_MARKS): Component {
  return defineComponent({
    name: `VzShield-${mark}`,
    // Passed on by hand below, so Vue must not add them a second time
    inheritAttrs: false,
    setup: (_props, { attrs }) => () => h('svg', { ...attrs, xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 32 32', width: '1.2em', height: '1.2em' }, [
      h('path', { 'fill-rule': 'evenodd', 'd': `${SHIELD}${SHIELD_MARKS[mark]}` }),
    ]),
  })
}

export const ShieldPass = shield('pass')
export const ShieldFail = shield('fail')
export const ShieldUnknown = shield('unknown')
