import { defineConfig } from 'vite'
import packageJson from './package.json'
import { isDev, r } from './scripts/utils'
import { sharedConfig } from './vite.config.mjs'

/**
 * The iframe guard, bundled on its own.
 *
 * Separate from the content script rather than a branch inside it, because this
 * one is injected into every frame of every page. Sharing a bundle would mean
 * parsing the whole extension - Vue, the domain lists, the tooltip - in every
 * advert on the page, to run a few event listeners. See src/contentScripts/frame.ts.
 */
export default defineConfig({
  ...sharedConfig,
  define: {
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    watch: isDev
      ? {}
      : undefined,
    outDir: r('extension/dist/contentScripts'),
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
