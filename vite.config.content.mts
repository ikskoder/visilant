import { defineConfig } from 'vite'
import packageJson from './package.json'
import { isDev, r } from './scripts/utils'
import { BUILD_TARGET, sharedConfig } from './vite.config.mjs'

// bundling the content script using Vite
export default defineConfig({
  ...sharedConfig,
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
