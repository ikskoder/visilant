import { resolve } from 'node:path'
import process from 'node:process'
import { bgCyan, black } from 'kolorist'

export const port = Number(process.env.PORT || '') || 3303
export const r = (...args: string[]) => resolve(__dirname, '..', ...args)
export const isDev = process.env.NODE_ENV !== 'production'
export const isFirefox = process.env.EXTENSION === 'firefox'

/**
 * Where a build goes: `extension/` for Chrome, `extension-firefox/` for
 * Firefox. One directory used to take both, so a Firefox build (`just bf`,
 * `just ar`, `just dfr`) silently replaced the Chrome build a developer's
 * Chrome had loaded, and the extension there stopped answering on its next
 * start. Chrome keeps `extension/`: an unpacked extension without a `key`
 * takes its id from its path, and moving it would leave the visit data of a
 * developer's install behind under the old id.
 *
 * The locales and icons are sources kept in `extension/`, and the Firefox
 * build gets a fresh copy of them, see scripts/prepare.ts.
 */
export const OUT_DIRS = { chrome: 'extension', firefox: 'extension-firefox' } as const
export const outDir = isFirefox ? OUT_DIRS.firefox : OUT_DIRS.chrome
export const out = (...args: string[]) => r(outDir, ...args)

export function log(name: string, message: string) {
  console.log(black(bgCyan(` ${name} `)), message)
}
