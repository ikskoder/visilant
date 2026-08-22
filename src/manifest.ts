import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import fs from 'fs-extra'
import { isDev, isFirefox, r } from '../scripts/utils'

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
        data_collection_permissions: {
          required: ['none'],
        },
        // The declaration above is the extension's whole privacy statement, and
        // a browser that does not understand the key does not show it. Built-in
        // data consent landed in 140 on desktop.
        strict_min_version: '140.0',
      },
      // Without this key AMO assumes the extension is not compatible with
      // Android and does not list it as available there. It does not gate
      // installing – a direct link works either way – it decides whether anyone
      // browsing AMO on a phone is ever shown it.
      //
      // 142, not 140: the same consent feature reached Firefox for Android two
      // releases later, so 140 and 141 would be told the extension supports
      // them while the one thing it promises about data would go unread.
      gecko_android: {
        strict_min_version: '142.0',
      },
    },
    action: {
      default_icon: 'assets/icon-default.png',
      default_popup: 'dist/popup/index.html',
    },
    options_ui: {
      page: 'dist/options/index.html',
      open_in_tab: true,
    },
    // Deliberately no `type: 'module'` on the Firefox side. The background is
    // bundled as an IIFE, so it never needed module semantics, and Firefox for
    // Android silently refuses to run a module background: the script never
    // executes, every message from a content script comes back as "Receiving
    // end does not exist", and the extension looks alive while doing nothing.
    background: isFirefox
      ? {
          scripts: ['dist/background/index.mjs'],
        }
      : {
          service_worker: 'dist/background/index.mjs',
        },
    icons: {
      16: 'assets/icon-default-16.png',
      48: 'assets/icon-default-48.png',
      128: 'assets/icon-default-128.png',
    },
    permissions: [
      'tabs',
      'storage',
      'activeTab',
      'notifications',
      'contextMenus',
      // Required rather than optional: an empty profile treats every site as
      // unfamiliar, so without the one-off import at install the extension
      // warns about everything and reads as broken. See the welcome page.
      'history',
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
        run_at: 'document_start',
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
        ? 'script-src \'self\'; object-src \'self\''
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
