import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import packageJson from './package.json'
import { isDev, r } from './scripts/utils'
import { BUILD_TARGET, sharedConfig } from './vite.config.mjs'

/**
 * Turns every rem in the content script's stylesheet into px.
 *
 * That stylesheet is drawn inside a shadow root on somebody else's page, and
 * rem there is the page's root font size: a page at 10px squeezed every gap
 * and every utility-sized line of the warnings, one at 24px blew them up. The
 * extension's own pages keep rem, it is theirs.
 *
 * Only values change, never selectors, so a class like `.text-[0.75rem]` keeps
 * matching its element. Runs after UnoCSS, which writes its CSS late.
 */
export function remToPx(css: string): string {
  // Split into preludes (the text before a `{`) and declarations (the text up
  // to a `;` or `}`). Only declarations hold values.
  return css.split(/([{};])/).map((part, index, parts) => {
    if (parts[index + 1] === '{' || part === '{' || part === '}' || part === ';')
      return part
    return part.replace(/(-?(?:\d+(?:\.\d+)?|\.\d+))rem\b/g, (_, n) => `${+(Number(n) * 16).toFixed(3)}px`)
  }).join('')
}

function remToPxPlugin(): Plugin {
  return {
    name: 'visilant:rem-to-px',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css'))
          file.source = remToPx(String(file.source))
      }
    },
  }
}

// bundling the content script using Vite
export default defineConfig({
  ...sharedConfig,
  plugins: [...(sharedConfig.plugins ?? []), remToPxPlugin()],
  define: {
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    // https://github.com/vitejs/vite/issues/9320
    // https://github.com/vitejs/vite/issues/9186
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    // Named here too: a spread of `sharedConfig` is overwritten by this object,
    // so the shared target would not reach this bundle. See `BUILD_TARGET`.
    target: BUILD_TARGET,
    watch: isDev
      ? {}
      : undefined,
    outDir: r('extension/dist/contentScripts'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: r('src/contentScripts/index.ts'),
      name: packageJson.name,
      formats: ['iife'],
    },
    rolldownOptions: {
      output: {
        entryFileNames: 'index.global.js',
        extend: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === `${packageJson.name}.css`)
            return 'style.css'
          return '[name].[hash][extname]'
        },
      },
    },
  },
})
