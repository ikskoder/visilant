import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import fs from 'fs-extra'
import { isDev, isFirefox, port, r } from '../scripts/utils'

export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

  // update this file to update this manifest.json
  // can also be conditional based on your need
  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    name: 'Visilant',
    version: pkg.version,
    description: '__MSG_extensionDescription__',
    default_locale: 'en', // We'll handle language switching differently
    browser_specific_settings: {
      gecko: {
        id: 'visilant@xcoder.non-existant-domain.com',
      },
    },
    action: {
      default_icon: './assets/icon-default.png',
      default_popup: './dist/popup/index.html',
    },
    options_ui: {
      page: './dist/options/index.html',
      open_in_tab: true,
    },
    background: isFirefox
      ? {
          scripts: ['dist/background/index.mjs'],
          type: 'module',
        }
      : {
          service_worker: './dist/background/index.mjs',
        },
    icons: {
      16: './assets/icon-default-16.png',
      48: './assets/icon-default-48.png',
      128: './assets/icon-default-128.png',
    },
    permissions: [
      'tabs',
      'storage',
      'activeTab',
    ],
    optional_permissions: [
      'history',
      'notifications',
    ],
    host_permissions: ['*://*/*'],
    content_scripts: [
      {
        matches: [
          '<all_urls>',
        ],
        js: [
          'dist/contentScripts/index.global.js',
        ],
      },
    ],
    web_accessible_resources: [
      {
        resources: [
          'dist/contentScripts/style.css',
          '_locales/*/messages.json',
        ],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: isDev
        // this is required on dev for Vite script to load
        ? `script-src \'self\' http://localhost:${port}; object-src \'self\'`
        : 'script-src \'self\'; object-src \'self\'',
    },
  }

  // FIXME: not work in MV3
  if (isDev && false) {
    // for content script, as browsers will cache them for each reload,
    // we use a background script to always inject the latest version
    // see src/background/contentScriptHMR.ts
    delete manifest.content_scripts
    manifest.permissions?.push('webNavigation')
  }

  return manifest
}
