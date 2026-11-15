import type { Component } from 'vue'
import { defineComponent, h } from 'vue'
import logo from '../assets/icon.svg?raw'

/**
 * Visilant's shield with a mark cut out of it. Two uses, one shape:
 *
 * - the verdict, in a badge: a check, a cross or a dash,
 * - the sign at the head of a box drawn over a web page, which is also the
 *   signature saying whose box it is: `!` for a warning, a flag for a red
 *   flag, `i` for a note, dots while a check is out. The signature and the
 *   sign used to be two icons side by side.
 *
 * The outline is the logo's own, read from the asset, so the shield in a
 * badge, the shield in a head row and the logo beside them are one silhouette.
 *
 * Cut out rather than drawn on top, as carbon's `checkmark-filled` is: the
 * mark is whatever is behind the shield, the badge's own tint, which is a pair
 * the contrast tests already hold to its ratio. A mark painted in a second
 * colour would keep that colour in a forced-colours theme that turns the
 * shield the same one. The outline is the same for every sign, so the mark
 * and the words beside it carry the difference, never the colour alone.
 *
 * Defined once here rather than inside VzIcon's setup, which runs for every
 * icon on the page.
 */

// The logo is drawn on this square, and so is every shield
const BOX = { x: 224, y: 224, size: 1600 }
// The marks are written on a 32 by 32 grid around this point, where the
// logo's own letter sits, and drawn a fifth larger than written
const GRID = 32
const CENTRE = { x: 16, y: 15.6 }
const MARK_SCALE = 1.2

/** A path written on the 32 grid, with `M`, `L`, `H`, `V`, `C` and `Z` only, moved onto the logo's square. */
function onLogoSquare(path: string, scale = 1): string {
  const unit = BOX.size / GRID
  const x = (value: number) => +(BOX.x + unit * (CENTRE.x + (value - CENTRE.x) * scale)).toFixed(1)
  const y = (value: number) => +(BOX.y + unit * (CENTRE.y + (value - CENTRE.y) * scale)).toFixed(1)
  return path.replace(/([MLHVCZ])([^MLHVCZ]*)/g, (_all, command: string, rest: string) => {
    const numbers = rest.trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (command === 'H')
      return `H${numbers.map(x).join(' ')}`
    if (command === 'V')
      return `V${numbers.map(y).join(' ')}`
    return `${command}${numbers.map((value, i) => (i % 2 ? y(value) : x(value))).join(' ')}`
  })
}

/** The logo's shield without its letter: the first path of the asset. */
export const LOGO_OUTLINE = /<path[^>]*\sd="([^"]+)"/.exec(logo)?.[1]
// Drawn only if the asset ever stops carrying a path where it is looked for.
// A test holds that it does, so a shield is never quietly this one
const PLAIN_OUTLINE = onLogoSquare('M16 0.4L29.6 4.6V15.2C29.6 23.2 23.8 29.2 16 31.6C8.2 29.2 2.4 23.2 2.4 15.2V4.6Z')

const SHIELD_MARKS = {
  pass: 'M10 15.9L12.2 13.7L14.6 16.1L20.3 10.4L22.5 12.6L14.6 20.5Z',
  fail: 'M10.8 12.7L13.1 10.4L16 13.3L18.9 10.4L21.2 12.7L18.3 15.6L21.2 18.5L18.9 20.8L16 17.9L13.1 20.8L10.8 18.5L13.7 15.6Z',
  unknown: 'M10.5 14.1H21.5V17.1H10.5Z',
  alert: 'M14.1 8.4H17.9L17.3 17.1H14.7ZM14.3 19.2H17.7V22.6H14.3Z',
  flag: 'M10.6 8.6H13V9.6H22.2L19.9 13.1L22.2 16.6H13V22.6H10.6Z',
  info: 'M14.3 8.6H17.7V12H14.3ZM14.3 13.8H17.7V22.6H14.3Z',
  pending: 'M9.2 14H12.4V17.2H9.2ZM14.4 14H17.6V17.2H14.4ZM19.6 14H22.8V17.2H19.6Z',
}

export type ShieldMark = keyof typeof SHIELD_MARKS

/** The whole icon as one path: the outline, then the mark as a hole in it. */
export function shieldPath(mark: ShieldMark): string {
  return `${LOGO_OUTLINE ?? PLAIN_OUTLINE}${onLogoSquare(SHIELD_MARKS[mark], MARK_SCALE)}`
}

function shield(mark: ShieldMark): Component {
  const d = shieldPath(mark)
  return defineComponent({
    name: `VzShield-${mark}`,
    // Passed on by hand below, so Vue must not add them a second time
    inheritAttrs: false,
    setup: (_props, { attrs }) => () => h('svg', { ...attrs, xmlns: 'http://www.w3.org/2000/svg', viewBox: `${BOX.x} ${BOX.y} ${BOX.size} ${BOX.size}`, width: '1.2em', height: '1.2em' }, [
      h('path', { 'fill-rule': 'evenodd', d }),
    ]),
  })
}

export const ShieldPass = shield('pass')
export const ShieldFail = shield('fail')
export const ShieldUnknown = shield('unknown')
export const ShieldAlert = shield('alert')
export const ShieldFlag = shield('flag')
export const ShieldInfo = shield('info')
export const ShieldPending = shield('pending')
