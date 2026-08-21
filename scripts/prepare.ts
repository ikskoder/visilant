// generate stub index.html files for dev entry
import { execSync } from 'node:child_process'
import chokidar from 'chokidar'
import { isDev, r } from './utils'

function writeManifest() {
  // `esno` comes from node_modules/.bin, which pnpm puts on PATH. No `npx`:
  // it is one more thing that can reach for the network mid-build.
  execSync('esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

writeManifest()

if (isDev) {
  chokidar.watch([r('src/manifest.ts'), r('package.json')])
    .on('change', () => {
      writeManifest()
    })
}
