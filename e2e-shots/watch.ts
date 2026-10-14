/**
 * `just shots-watch`: take the screenshots again whenever the sources change.
 *
 * Waits for the edits to stop for a while before starting, because one change
 * usually touches several files, and never runs two at once: a change made
 * during a run queues exactly one more run after it. A run costs a build and
 * three browsers, so this is deliberately not eager.
 */
/* eslint-disable no-console -- a command-line watcher, and its output is the report */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(__dirname, '..')
const WATCHED = ['src', 'extension/_locales', 'e2e-shots']
const QUIET_MS = Number(process.env.SHOTS_QUIET_MS ?? 15000)

let timer: NodeJS.Timeout | undefined
let running = false
let pending = false

function run() {
  running = true
  pending = false
  const started = Date.now()
  console.log(`\n[shots] ${new Date().toLocaleTimeString('en-GB')} – taking the screenshots`)
  const child = spawn('pnpm', ['exec', 'esno', 'e2e-shots/run.ts', ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' })
  child.on('exit', (code) => {
    running = false
    console.log(`[shots] done in ${Math.round((Date.now() - started) / 1000)} s${code ? ` (exit ${code}, see the top of the gallery)` : ''}. Watching.`)
    if (pending)
      run()
  })
}

function changed(file: string | null) {
  // The run writes its own files under .tmp, and editors write swap files
  if (file && /(?:^|\/)(?:\.#|#)|~$|\.swp$/.test(file))
    return
  if (running) {
    pending = true
    return
  }
  clearTimeout(timer)
  timer = setTimeout(run, QUIET_MS)
}

for (const dir of WATCHED)
  fs.watch(path.join(ROOT, dir), { recursive: true }, (_event, file) => changed(file))

console.log(`[shots] watching ${WATCHED.join(', ')}. A run starts ${QUIET_MS / 1000} s after the last change. Ctrl+C to stop.`)
run()
