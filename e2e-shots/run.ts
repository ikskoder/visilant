/**
 * `just shots`: build, draw every case, write the catalogue.
 *
 * Arguments go to Playwright, so `just shots -g popup` draws a part of them.
 * A part redraws only its own cards: the rest of the catalogue keeps the
 * pictures it had, and only a run with no arguments starts it from scratch.
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
const SHOTS = path.join(ROOT, '.tmp/shots')
const CONFIG = ['-c', 'e2e-shots/playwright.config.ts']
const args = process.argv.slice(2)
const filtered = args.length > 0

function step(command: string, commandArgs: string[], quiet = false) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 })
  if (result.error)
    throw result.error
  return { status: result.status ?? 1, stdout: result.stdout ?? '', output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

console.log('[shots] building a copy of the extension under .tmp/shots/build-src')
const build = step('pnpm', ['exec', 'esno', 'e2e-shots/build.ts'], true)
if (build.status !== 0) {
  console.error(build.output)
  console.error('[shots] the build failed, nothing was drawn')
  process.exit(1)
}

// A part of the cases keeps the rest of the catalogue, so it needs to know
// which cases still exist: one renamed or deleted since would otherwise keep
// its old card for good. Listing them only loads the files, under a second.
fs.rmSync(path.join(SHOTS, 'cases.json'), { force: true })
if (filtered) {
  const list = step('pnpm', ['exec', 'playwright', 'test', ...CONFIG, '--list', '--reporter=json'], true)
  if (list.status !== 0) {
    console.error(list.output)
    console.error('[shots] could not list the cases, nothing was drawn')
    process.exit(1)
  }
  try {
    JSON.parse(list.stdout)
  }
  catch {
    console.error(list.output.slice(0, 2000))
    console.error('[shots] the list of cases is not JSON, so something else printed into it. Nothing was drawn')
    process.exit(1)
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, 'cases.json'), list.stdout)
}
else {
  fs.rmSync(path.join(SHOTS, 'run'), { recursive: true, force: true })
  fs.rmSync(path.join(SHOTS, 'state.json'), { force: true })
}
fs.rmSync(path.join(SHOTS, 'report.json'), { force: true })

// Pictures older than this, of a case that ran again, are left over from
// before: a picture the case no longer takes, or one from before it failed
process.env.SHOTS_STARTED = String(Date.now())
console.log(filtered ? '[shots] drawing the cases that match' : '[shots] drawing every case (a few minutes, three browsers at once)')
step('pnpm', ['exec', 'playwright', 'test', ...CONFIG, ...args])
process.env.SHOTS_FILTERED = filtered ? '1' : ''
const gallery = step('pnpm', ['exec', 'esno', 'e2e-shots/gallery.ts'])
process.exit(gallery.status)
