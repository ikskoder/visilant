/**
 * Compare two runs of the catalogue picture by picture: .tmp/shots/compare/index.html.
 *
 * For somebody who changed a screen and wants to see what moved, on every case
 * at once and close up. `just shots-keep` puts the run aside before the change,
 * `just shots` draws the cases again after it, and `just shots-diff` lists
 * every case whose picture is no longer the same, cut to the part that changed
 * with the change marked: what went on the left, what came on the right.
 *
 * Rows of pixels are matched the way a text diff matches lines, so a block that
 * only moved up because something above it was removed is not reported, and a
 * one-line change on a page three screens long is found.
 *
 * pnpm exec esno e2e-shots/compare.ts [before] [after] [out]
 */
/* eslint-disable no-console -- a command-line step, and its output is the report */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { placeOf } from './gallery-sections'

const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, '.tmp/shots')
const BEFORE = path.resolve(process.argv[2] ?? path.join(SHOTS, 'before'))
const AFTER = path.resolve(process.argv[3] ?? path.join(SHOTS, 'run'))
const OUT = path.resolve(process.argv[4] ?? path.join(SHOTS, 'compare'))

// Dark is light in other colours, so its layout says nothing the light one has not
const COLUMNS = ['light', 'phone']

interface Picture { w: number, h: number, px: Uint32Array, bytes: Uint8Array }
/** Rows `y0` to `y1` and columns `x0` to `x1` of a picture */
type Band = [y0: number, y1: number, x0: number, x1: number]
interface Marks { gone: Uint8Array, came: Uint8Array }

/**
 * A screenshot as its pixels. Read here rather than with a library, of which
 * the project has none: a browser's screenshot is always eight bits a channel,
 * with or without transparency and never interlaced, and that much of the
 * format is the header, one deflated stream and five ways to predict a byte.
 */
function read(file: string): Picture {
  const data = fs.readFileSync(file)
  const w = data.readUInt32BE(16)
  const h = data.readUInt32BE(20)
  const channels = ({ 2: 3, 6: 4 } as Record<number, number>)[data[25]]
  if (data[24] !== 8 || !channels || data[28] !== 0)
    throw new Error(`${file} is not a PNG of the kind a screenshot is`)

  const parts: Buffer[] = []
  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at)
    if (data.toString('latin1', at + 4, at + 8) === 'IDAT')
      parts.push(data.subarray(at + 8, at + 8 + length))
    at += length + 12
  }
  const raw = zlib.inflateSync(Buffer.concat(parts))

  const stride = w * channels
  const lines = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const from = y * (stride + 1) + 1
    const to = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? lines[to + x - channels] : 0
      const up = y ? lines[to + x - stride] : 0
      const corner = y && x >= channels ? lines[to + x - stride - channels] : 0
      let predicted = 0
      if (filter === 1) {
        predicted = left
      }
      else if (filter === 2) {
        predicted = up
      }
      else if (filter === 3) {
        predicted = (left + up) >> 1
      }
      else if (filter === 4) {
        const estimate = left + up - corner
        const [dl, du, dc] = [left, up, corner].map(v => Math.abs(estimate - v))
        predicted = dl <= du && dl <= dc ? left : du <= dc ? up : corner
      }
      lines[to + x] = raw[from + x] + predicted
    }
  }

  const bytes = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    bytes[i * 4] = lines[i * channels]
    bytes[i * 4 + 1] = lines[i * channels + 1]
    bytes[i * 4 + 2] = lines[i * channels + 2]
    bytes[i * 4 + 3] = channels === 4 ? lines[i * channels + 3] : 255
  }
  return { w, h, px: new Uint32Array(bytes.buffer), bytes }
}

function rowHashes(img: Picture, from = 0, to = img.w): number[] {
  const out: number[] = []
  for (let y = 0; y < img.h; y++) {
    let hash = 2166136261
    for (let x = from; x < to; x++)
      hash = Math.imul(hash ^ img.px[y * img.w + x], 16777619)
    out.push(hash >>> 0)
  }
  return out
}

/** Myers' diff over two lists: which entries of each have no partner in the other. */
function diff(a: number[], b: number[]): Marks {
  const gone = new Uint8Array(a.length)
  const came = new Uint8Array(b.length)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start])
    start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  if (!n || !m) {
    gone.fill(1, start, endA)
    came.fill(1, start, endB)
    return { gone, came }
  }

  const max = n + m
  const trace: Int32Array[] = []
  const v = new Int32Array(2 * max + 2)
  const down = (frontier: Int32Array, k: number, d: number) => k === -d || (k !== d && frontier[max + k - 1] < frontier[max + k + 1])
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = down(v, k, d) ? v[max + k + 1] : v[max + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++
        y++
      }
      v[max + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }

  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const k = x - y
    const prevK = down(trace[d], k, d) ? k + 1 : k - 1
    const prevX = trace[d][max + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
    }
    if (x === prevX)
      came[start + --y] = 1
    else
      gone[start + --x] = 1
  }
  return { gone, came }
}

/** Two rows that differ by no more than the noise of drawing the same letters again. */
function nearlySame(b: Picture, yb: number, a: Picture, ya: number, from: number, to: number): boolean {
  const atB = yb * b.w * 4
  const atA = ya * a.w * 4
  for (let i = from * 4; i < to * 4; i++) {
    if (Math.abs(b.bytes[atB + i] - a.bytes[atA + i]) > 10)
      return false
  }
  return true
}

/**
 * Take back the marks on rows that only differ by that noise. A block that
 * moved by a fraction of a pixel is drawn with edges a shade lighter or darker,
 * which made every row of it a row that went and a row that came.
 */
function soften(rowsB: number[], rowsA: number[], marks: Marks, b: Picture, a: Picture, from: number, to: number) {
  let i = 0
  let j = 0
  while (i < rowsB.length || j < rowsA.length) {
    if (i < rowsB.length && j < rowsA.length && !marks.gone[i] && !marks.came[j]) {
      i++
      j++
      continue
    }
    const i0 = i
    const j0 = j
    while (i < rowsB.length && marks.gone[i])
      i++
    while (j < rowsA.length && marks.came[j])
      j++
    const n = i - i0
    const m = j - j0
    if (!n || !m || n * m > 400000)
      continue

    // The longest run of pairs in order, by rows that are nearly the same
    const best = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    const same = Array.from({ length: n }, () => new Uint8Array(m))
    for (let p = n - 1; p >= 0; p--) {
      for (let q = m - 1; q >= 0; q--) {
        same[p][q] = nearlySame(b, rowsB[i0 + p], a, rowsA[j0 + q], from, to) ? 1 : 0
        best[p][q] = same[p][q] ? best[p + 1][q + 1] + 1 : Math.max(best[p + 1][q], best[p][q + 1])
      }
    }
    let p = 0
    let q = 0
    while (p < n && q < m) {
      if (same[p][q]) {
        marks.gone[i0 + p++] = 0
        marks.came[j0 + q++] = 0
      }
      else if (best[p + 1][q] >= best[p][q + 1]) {
        p++
      }
      else {
        q++
      }
    }
  }
}

/** Runs of marked rows as bands, close ones joined, each with the columns it touches. */
function bands(marks: Uint8Array, img: Picture, from = 0, to = img.w): Band[] {
  const runs: [number, number][] = []
  for (let y = 0; y < marks.length; y++) {
    if (!marks[y])
      continue
    const last = runs.at(-1)
    if (last && y - last[1] <= 8)
      last[1] = y + 1
    else
      runs.push([y, y + 1])
  }
  // A line or two on its own is the edge of a shape redrawn a shade off, not a change
  return runs.filter(([y0, y1]) => y1 - y0 >= 3).map(([y0, y1]) => {
    // Against the nearest row that stayed: what differs from it is the content
    let ref = y0 - 1
    while (ref >= 0 && marks[ref])
      ref--
    if (ref < 0) {
      ref = y1
      while (ref < marks.length && marks[ref])
        ref++
    }
    let x0 = to
    let x1 = from
    for (let row = y0; row < y1 && ref < img.h; row++) {
      for (let x = from; x < to; x++) {
        if (img.px[row * img.w + x] !== img.px[ref * img.w + x]) {
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x + 1)
        }
      }
    }
    return x1 > x0 ? [y0, y1, Math.max(0, x0 - 6), Math.min(img.w, x1 + 6)] : [y0, y1, from, to]
  })
}

/** The columns where two pictures of one size differ, or nothing if none do. */
function changedColumns(b: Picture, a: Picture): [number, number] | undefined {
  let from = a.w
  let to = 0
  for (let i = 0; i < a.px.length; i++) {
    if (a.px[i] !== b.px[i]) {
      from = Math.min(from, i % a.w)
      to = Math.max(to, i % a.w + 1)
    }
  }
  return to > from ? [from, to] : undefined
}

/** The rows that are not one flat colour between two columns. */
function busyRows(img: Picture, from: number, to: number): number[] {
  const rows: number[] = []
  for (let y = 0; y < img.h; y++) {
    const first = img.px[y * img.w + from]
    for (let x = from + 1; x < to; x++) {
      if (img.px[y * img.w + x] !== first) {
        rows.push(y)
        break
      }
    }
  }
  return rows
}

/**
 * How far the extension's box reaches to the left and right of the columns that
 * changed, read off one row: outwards until the bare page begins, which is a
 * stretch of the colour the row has at one of its ends.
 */
function widen(img: Picture, y: number, from: number, to: number): [number, number] {
  const at = y * img.w
  // Either end of the row: a box in a corner covers one of them
  const page = [img.px[at + 4], img.px[at + img.w - 40]]
  const RUN = 16
  let left = from
  for (let x = from - 1, run = 0; x >= 0 && run < RUN; x--) {
    run = page.includes(img.px[at + x]) ? run + 1 : 0
    if (!run)
      left = x
  }
  let right = to
  for (let x = to, run = 0; x < img.w && run < RUN; x++) {
    run = page.includes(img.px[at + x]) ? run + 1 : 0
    if (!run)
      right = x + 1
  }
  return [left, right]
}

interface Change { bw: number, bh: number, aw: number, ah: number, box?: [number, number], before: Band[], after: Band[] }

function compare(b: Picture, a: Picture): Change | undefined {
  const sameSize = a.w === b.w && a.h === b.h
  let marks: Marks
  let from = 0
  let to = a.w
  if (sameSize) {
    // A picture of a web page with the extension's box over it. Only the
    // columns that changed are compared, and rows of one flat colour are left
    // out: both pictures are one screen high, so every row a shorter box gave
    // up comes back as a row of bare page, which is not a change to report.
    const columns = changedColumns(b, a)
    if (!columns)
      return undefined
    from = columns[0]
    to = columns[1]
    const rowsB = busyRows(b, from, to)
    const rowsA = busyRows(a, from, to)
    const hashB = rowHashes(b, from, to)
    const hashA = rowHashes(a, from, to)
    const busy = diff(rowsB.map(y => hashB[y]), rowsA.map(y => hashA[y]))
    soften(rowsB, rowsA, busy, b, a, from, to)
    marks = { gone: new Uint8Array(b.h), came: new Uint8Array(a.h) }
    rowsB.forEach((y, i) => marks.gone[y] = busy.gone[i])
    rowsA.forEach((y, i) => marks.came[y] = busy.came[i])
  }
  else {
    marks = diff(rowHashes(b), rowHashes(a))
    if (a.w === b.w) {
      soften(Array.from({ length: b.h }, (_, y) => y), Array.from({ length: a.h }, (_, y) => y), marks, b, a, 0, a.w)
    }
  }
  const before = bands(marks.gone, b, from, to)
  const after = bands(marks.came, a, from, to)
  if (!before.length && !after.length)
    return undefined

  // The narrowest reading of several rows: words of the page beside the box
  // can only make one of them wider than the box is
  const box = sameSize
    ? [[b, before] as const, [a, after] as const]
        .flatMap(([img, list]) => list.map(band => widen(img, Math.floor((band[0] + band[1]) / 2), from, to)))
        .reduce<[number, number]>((sum, [left, right]) => [Math.max(sum[0], left), Math.min(sum[1], right)], [0, a.w])
    : undefined
  return { bw: b.w, bh: b.h, aw: a.w, ah: a.h, box, before, after }
}

function main() {
  if (!fs.existsSync(BEFORE) || !fs.existsSync(AFTER)) {
    console.error(`[shots] nothing to compare: ${fs.existsSync(BEFORE) ? AFTER : BEFORE} is not there. \`just shots-keep\` puts the present run aside, \`just shots\` draws a new one.`)
    process.exitCode = 1
    return
  }
  const cases: object[] = []
  const names = new Set<string>()
  let same = 0
  for (const col of COLUMNS) {
    const list = (dir: string) => fs.existsSync(path.join(dir, col)) ? fs.readdirSync(path.join(dir, col)).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)) : []
    for (const name of [...new Set([...list(BEFORE), ...list(AFTER)])].sort()) {
      names.add(name)
      const [bf, af] = [BEFORE, AFTER].map(dir => path.join(dir, col, `${name}.png`))
      const meta = [af, bf].map(f => f.replace(/\.png$/, '.json')).filter(f => fs.existsSync(f)).map(f => JSON.parse(fs.readFileSync(f, 'utf8')))[0] ?? {}
      const [surface, topic, at] = placeOf(name)
      const base = { col, name, title: meta.title ?? name, order: meta.order ?? 0, surface, topic, at }
      if (!fs.existsSync(bf) || !fs.existsSync(af)) {
        cases.push({ ...base, kind: fs.existsSync(af) ? 'new' : 'gone' })
        continue
      }
      const change = fs.readFileSync(bf).equals(fs.readFileSync(af)) ? undefined : compare(read(bf), read(af))
      if (change)
        cases.push({ ...base, kind: 'changed', ...change })
      else
        same++
    }
  }

  fs.mkdirSync(OUT, { recursive: true })
  // The page names the pictures by these two folders, wherever the runs are kept
  for (const [link, target] of [['before-run', BEFORE], ['after-run', AFTER]]) {
    fs.rmSync(path.join(OUT, link), { force: true, recursive: true })
    fs.symlinkSync(path.relative(OUT, target), path.join(OUT, link))
  }
  fs.copyFileSync(path.join(__dirname, 'compare.html'), path.join(OUT, 'index.html'))
  fs.copyFileSync(path.join(__dirname, 'compare-crop.js'), path.join(OUT, 'crop.js'))
  fs.writeFileSync(path.join(OUT, 'diff-data.js'), `window.DIFF = ${JSON.stringify({ tally: { total: names.size }, cases })}\n`)
  const changed = new Set(cases.map(c => (c as { name: string }).name)).size
  console.log(`[shots] ${changed} of ${names.size} cases changed, ${same} pictures are the same: ${path.relative(ROOT, path.join(OUT, 'index.html'))}`)
}

main()
