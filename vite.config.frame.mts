import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import packageJson from './package.json'
import { isDev, out, r } from './scripts/utils'
import { BUILD_TARGET, sharedConfig } from './vite.config.mjs'

/**
 * The iframe guard, bundled on its own.
 *
 * Separate from the content script rather than a branch inside it, because this
 * one is injected into every frame of every page. Sharing a bundle would mean
 * parsing the whole extension - Vue, the domain lists, the tooltip - in every
 * advert on the page, to run a few event listeners. See src/contentScripts/frame.ts.
 */
/**
 * Fail the build when the frame bundle has taken in what it must not.
 *
 * The rule used to live only in a comment, and the bundle had quietly grown to
 * 36 KB with Vue's reactivity and the settings store in it: importing one pure
 * helper from src/logic/storage.ts built the store as a side effect, in every
 * frame. The markers are strings only those pull in. The size budget catches
 * what no marker names, a domain list above all, with room for honest growth.
 */
const FRAME_BUDGET_BYTES = 24 * 1024
const FORBIDDEN_IN_FRAME: [string, string][] = [
  ['__VUE', 'Vue'],
  ['mergeDefaults', 'the reactive settings store (import from ~/logic/settings-schema instead)'],
]

function frameBudget(): Plugin {
  return {
    name: 'visilant-frame-budget',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk')
          continue
        for (const [marker, what] of FORBIDDEN_IN_FRAME) {
          if (chunk.code.includes(marker))
            this.error(`${chunk.fileName} contains ${what}, which the frame guard must not load. See src/contentScripts/frame.ts.`)
        }
        if (!isDev && chunk.code.length > FRAME_BUDGET_BYTES)
          this.error(`${chunk.fileName} is ${chunk.code.length} bytes, over the frame guard's budget of ${FRAME_BUDGET_BYTES}. It runs in every frame of every page.`)
      }
    },
  }
}

export default defineConfig({
  ...sharedConfig,
  plugins: [...(sharedConfig.plugins ?? []), frameBudget()],
  define: {
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    // Named here too: a spread of `sharedConfig` is overwritten by this object,
    // so the shared target would not reach this bundle. See `BUILD_TARGET`.
    target: BUILD_TARGET,
    watch: isDev
      ? {}
      : undefined,
    outDir: out('dist/contentScripts'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: r('src/contentScripts/frame.ts'),
      name: `${packageJson.name}-frame`,
      formats: ['iife'],
    },
    rolldownOptions: {
      output: {
        entryFileNames: 'frame.global.js',
        extend: true,
      },
    },
  },
})
