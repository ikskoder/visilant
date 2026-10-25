// generate stub index.html files for dev entry
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import chokidar from 'chokidar'
import { isDev, isFirefox, log, out, r } from './utils'

function writeManifest() {
  // `esno` comes from node_modules/.bin, which pnpm puts on PATH. No `npx`:
  // it is one more thing that can reach for the network mid-build.
  execSync('esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

/** The sources kept in `extension/` that every build carries. */
const SHARED = ['_locales', 'assets']

/**
 * Give the Firefox build its own copy of the locales and icons.
 *
 * Replaced whole rather than copied over: a locale removed from the sources
 * would otherwise stay in the copy and be packed, which a clean build would
 * not do. Copies, not links: the Nix build copies the tree out with `cp -r`
 * and hashes it with `find -type f`, which would keep a link pointing into
 * its sandbox and skip it in the hashes.
 */
function copyShared() {
  if (!isFirefox)
    return
  for (const entry of SHARED) {
    fs.rmSync(out(entry), { recursive: true, force: true })
    fs.cpSync(r('extension', entry), out(entry), { recursive: true })
  }
  log('PRE', 'copy _locales and assets into extension-firefox/')
}

copyShared()
writeManifest()

if (isDev) {
  chokidar.watch([r('src/manifest.ts'), r('package.json')])
    .on('change', () => {
      writeManifest()
    })
  if (isFirefox) {
    chokidar.watch(SHARED.map(entry => r('extension', entry)), { ignoreInitial: true })
      .on('all', () => copyShared())
  }
}
