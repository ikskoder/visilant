/// <reference types="vitest" />

import type { UserConfig } from 'vite'
import { dirname, relative } from 'node:path'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import packageJson from './package.json'
import { isDev, port, r } from './scripts/utils'

/**
 * The oldest browsers this build compiles for.
 *
 * Named rather than left to whatever Vite's default happens to be, for two
 * reasons. It is the same pair of numbers the manifest declares - Chrome 119 as
 * `minimum_chrome_version`, Firefox 140 as `strict_min_version` - so what is
 * compiled and what is promised cannot drift apart. And it takes the output out
 * of the hands of a Vite upgrade, which matters for a project whose releases
 * have to rebuild byte for byte.
 */
export const BUILD_TARGET = ['chrome119', 'firefox140']

export const sharedConfig: UserConfig = {
  root: r('src'),
  build: {
    target: BUILD_TARGET,
  },
  resolve: {
    alias: {
      '~/': `${r('src')}/`,
    },
  },
  define: {
    __DEV__: isDev,
    __NAME__: JSON.stringify(packageJson.name),
  },
  plugins: [
    Vue(),

    AutoImport({
      imports: [
        'vue',
        {
          'webextension-polyfill': [
            ['=', 'browser'],
          ],
        },
      ],
      dts: r('src/auto-imports.d.ts'),
    }),

    // https://github.com/antfu/unplugin-vue-components
    Components({
      dirs: [r('src/components')],
      // generate `components.d.ts` for ts support with Volar
      dts: r('src/components.d.ts'),
      resolvers: [
        // auto import icons
        IconsResolver({
          prefix: '',
        }),
      ],
    }),

    // https://github.com/antfu/unplugin-icons
    Icons(),

    // https://github.com/unocss/unocss
    UnoCSS(),

    // rewrite assets to use relative path
    {
      name: 'assets-rewrite',
      enforce: 'post',
      apply: 'build',
      transformIndexHtml(html, { path }) {
        return html.replace(/"\/assets\//g, `"${relative(dirname(path), '/assets')}/`)
      },
    },
  ],
  optimizeDeps: {
    include: [
      'vue',
      '@vueuse/core',
      'webextension-polyfill',
    ],
    exclude: [
      'vue-demi',
    ],
  },
}

export default defineConfig(({ command }) => ({
  ...sharedConfig,
  base: command === 'serve' ? `http://127.0.0.1:${port}/` : '/dist/',
  server: {
    port,
    hmr: {
      host: '127.0.0.1',
    },
    origin: `http://127.0.0.1:${port}`,
  },
  build: {
    // Named here too: this object replaces `sharedConfig.build` rather than
    // merging with it. See `BUILD_TARGET`.
    target: BUILD_TARGET,
    watch: isDev
      ? {}
      : undefined,
    outDir: r('extension/dist'),
    emptyOutDir: false,
    sourcemap: isDev ? 'hidden' : false,
    rolldownOptions: {
      input: {
        options: r('src/options/index.html'),
        popup: r('src/popup/index.html'),
        welcome: r('src/welcome/index.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    // The Vite root is `src`, which is where the extension is. The build scripts
    // are not, and they are worth testing too – so the unit run is anchored at
    // the repository root and names both trees. Listed rather than left to the
    // default glob, which would also pick up the Playwright specs in `e2e/`.
    dir: r('.'),
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
  },
}))
