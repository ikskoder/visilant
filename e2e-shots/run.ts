/**
 * `just shots`: build, draw every case, write the catalogue.
 *
 * Arguments go to Playwright, so `just shots -g popup` draws a part of them.
 * A case that cannot be drawn is reported in the catalogue, not here, so the
 * terminal stays quiet and the command fails only when there is no catalogue
 * to look at.
 */
/* eslint-disable no-console -- a command-line step, and its output is the report */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)

function step(command: string, commandArgs: string[], quiet = false) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', env: process.env })
  if (result.error)
    throw result.error
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

console.log('[shots] building a copy of the extension under .tmp/shots/build-src')
const build = step('pnpm', ['exec', 'esno', 'e2e-shots/build.ts'], true)
if (build.status !== 0) {
  console.error(build.output)
  console.error('[shots] the build failed, nothing was drawn')
  process.exit(1)
}

fs.rmSync(path.join(ROOT, '.tmp/shots/run'), { recursive: true, force: true })
fs.rmSync(path.join(ROOT, '.tmp/shots/report.json'), { force: true })
console.log('[shots] drawing every case (a few minutes, three browsers at once)')
step('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e-shots/playwright.config.ts', ...args])
// A filtered run leaves out cases on purpose, so the views they show are not
// missing, and the catalogue is told not to say they are
process.env.SHOTS_FILTERED = args.length ? '1' : ''
const gallery = step('pnpm', ['exec', 'esno', 'e2e-shots/gallery.ts'])
process.exit(gallery.status)
