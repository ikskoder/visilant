import { defineConfig } from 'vite'
import { isDev, out, r } from './scripts/utils'
import { BUILD_TARGET } from './vite.config.mjs'

/**
 * The clipboard wrapper, which runs in the page's own world.
 *
 * Deliberately not built from `sharedConfig`. That one auto-imports `browser`
 * from the polyfill, and a single stray mention of it would put the polyfill
 * into the page's world, where it throws on load and where the page can read
 * it. Nothing here but the alias, so the file can name the channel constants.
 * See src/contentScripts/clipboard-main.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~/': `${r('src')}/`,
    },
  },
  build: {
    // Named here too, as in every config. See `BUILD_TARGET`.
    target: BUILD_TARGET,
    watch: isDev
      ? {}
      : undefined,
    outDir: out('dist/contentScripts'),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: r('src/contentScripts/clipboard-main.ts'),
      name: 'visilantClipboard',
      formats: ['iife'],
    },
    rolldownOptions: {
      output: {
        entryFileNames: 'clipboard.global.js',
      },
    },
  },
})
