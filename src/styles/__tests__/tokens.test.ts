import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The contrast every colour token promises, measured rather than hoped for.
 *
 * Small coloured text that nobody could read was the reason the design system
 * exists, so the ratios are a rule the build enforces: change a colour in
 * tokens.css and this says which pair it broke, in which theme.
 */
const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8')

function block(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart)
  expect(start, `${selectorStart} block`).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/--([\w-]+):([^;]+);/g))
    out[name] = value.trim()
  return out
}

const light = block(':root,')
const dark = { ...light, ...block('html.dark,') }

function resolveColor(theme: Record<string, string>, name: string): string {
  const value = theme[name]
  expect(value, `--${name}`).toBeDefined()
  const alias = value.match(/^var\(--([\w-]+)\)$/)
  return alias ? resolveColor(theme, alias[1]) : value
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Text holds 4.5:1, anything that is a shape a reader relies on (a frame, a
// control edge, an icon, the focus ring) holds 3:1
const CHECKS: [string, string[], number][] = [
  ['ink', ['bg', 'surface', 'surface-sunken', 'surface-hover', 'brand-tint', 'owner-tint', 'danger-tint', 'caution-tint', 'safe-tint', 'neutral-tint'], 4.5],
  // On the tints of a label too: the ending of an address is drawn in it, and
  // a finding about that ending puts it on red or orange
  ['ink-2', ['bg', 'surface', 'surface-sunken', 'surface-hover', 'owner-tint', 'danger-tint', 'caution-tint'], 4.5],
  // On the notice tints too: a line of help opened inside a notice is small text
  ['ink-3', ['bg', 'surface', 'surface-sunken', 'surface-hover', 'caution-tint', 'neutral-tint'], 4.5],
  // The digits of an address are drawn in it, on whatever the label stands on
  ['brand', ['bg', 'surface', 'surface-sunken', 'brand-tint', 'owner-tint', 'danger-tint', 'caution-tint'], 4.5],
  ['on-brand', ['brand', 'brand-hover'], 4.5],
  ['on-fill', ['safe', 'danger'], 4.5],
  ['safe-text', ['safe-tint', 'surface'], 4.5],
  ['danger-text', ['danger-tint', 'surface'], 4.5],
  ['caution-text', ['caution-tint', 'surface'], 4.5],
  ['neutral-text', ['neutral-tint', 'surface'], 4.5],
  ['safe', ['surface', 'surface-sunken', 'safe-tint'], 3],
  ['danger', ['surface', 'surface-sunken', 'danger-tint'], 3],
  // On its tint too: its sign is a shield, and the mark cut out of it is the tint
  ['caution', ['bg', 'surface', 'surface-sunken', 'caution-tint'], 3],
  // On its tint too: the shield of an unchecked verdict sits in a neutral badge,
  // and its cut-out mark is the badge's tint showing through
  ['neutral', ['surface', 'surface-sunken', 'neutral-tint'], 3],
  ['line-strong', ['surface', 'surface-sunken'], 3],
  ['label-line', ['surface', 'surface-sunken'], 3],
  ['owner-line', ['owner-tint', 'surface', 'surface-sunken'], 3],
  ['focus-ring', ['bg', 'surface', 'surface-sunken'], 3],
  // The frame round the same domain in a list, on a plain row and on the open one
  ['match', ['bg', 'surface', 'surface-sunken', 'surface-hover'], 3],
  ['logo', ['bg', 'surface', 'surface-sunken'], 3],
  ['char-foreign', ['danger-tint', 'caution-tint'], 4.5],
  // Digits are always marked, so they sit on every ground an address can: a
  // page, a card, a hovered or current list row, an owner's frame, any notice
  ['char-digit', ['bg', 'surface', 'surface-sunken', 'surface-hover', 'owner-tint', 'brand-tint', 'danger-tint', 'caution-tint', 'safe-tint', 'neutral-tint'], 4.5],
]

describe('design tokens', () => {
  for (const [themeName, theme] of [['light', light], ['dark', dark]] as const) {
    for (const [fg, grounds, need] of CHECKS) {
      for (const ground of grounds) {
        it(`${themeName}: ${fg} on ${ground} holds ${need}:1`, () => {
          expect(ratio(resolveColor(theme, fg), resolveColor(theme, ground))).toBeGreaterThanOrEqual(need)
        })
      }
    }
  }

  it('the dark block changes colours only, so the generic in-page fonts are never overridden', () => {
    const darkOnly = block('html.dark,')
    expect(Object.keys(darkOnly).filter(name => name.startsWith('font-'))).toEqual([])
  })
})
