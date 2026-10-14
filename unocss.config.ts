import { presetAttributify, presetIcons, presetUno, transformerDirectives } from 'unocss'
import { defineConfig } from 'unocss/vite'

// Every colour is a token from src/styles/tokens.css, which switches with the
// theme by itself. So there is no `dark:` pair to remember and no opacity
// modifier (`/40`) to reach for: a token is one meaning in both themes.
const token = (name: string) => `var(--${name})`

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      collections: {
        carbon: () => import('@iconify-json/carbon/icons.json').then(i => i.default as any),
      },
    }),
  ],
  theme: {
    colors: {
      'bg': token('bg'),
      'surface': { DEFAULT: token('surface'), sunken: token('surface-sunken'), hover: token('surface-hover') },
      'line': { DEFAULT: token('line'), strong: token('line-strong') },
      'ink': { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
      'logo': token('logo'),
      'brand': { DEFAULT: token('brand'), hover: token('brand-hover'), tint: token('brand-tint') },
      'on-brand': token('on-brand'),
      'safe': { DEFAULT: token('safe'), text: token('safe-text'), tint: token('safe-tint'), line: token('safe-line') },
      'danger': { DEFAULT: token('danger'), text: token('danger-text'), tint: token('danger-tint'), line: token('danger-line') },
      'neutral': { DEFAULT: token('neutral'), text: token('neutral-text'), tint: token('neutral-tint'), line: token('neutral-line') },
      'owner': { line: token('owner-line'), tint: token('owner-tint') },
    },
    // The families come from the tokens too, so inside a web page, where
    // `.vz-root--page` swaps them for generic ones, `font-mono` cannot name a
    // font the page could redefine
    fontFamily: {
      sans: token('font-sans'),
      mono: token('font-mono'),
    },
  },
  transformers: [
    transformerDirectives(),
  ],
})
