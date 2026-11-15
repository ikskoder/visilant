/**
 * Turn a screenshot run into a catalogue to look through: .tmp/shots/index.html.
 *
 * One card per case, with what the case is and how it comes about, and the
 * screen in light, dark and at phone width side by side. It is for a person
 * checking that every case still looks right, most of which they could never
 * bring about on purpose in a real browser. Nothing is compared or asserted.
 *
 * A case that could not be drawn keeps its card and says why, rather than
 * leaving a gap nobody notices, and a view in the source that no case shows is
 * listed at the top.
 *
 * A run of part of the cases is merged into what the catalogue had: the cases
 * it ran get their new pictures and outcomes, the rest keep theirs. What it has
 * is kept in state.json next to the pictures.
 */
/* eslint-disable no-console -- a command-line step, and its output is the report */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { placeOf, SECTIONS } from './gallery-sections'

const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, '.tmp/shots')
const RUN = path.join(SHOTS, 'run')
const REPORT = path.join(SHOTS, 'report.json')
const STATE = path.join(SHOTS, 'state.json')
const CASES = path.join(SHOTS, 'cases.json')

// The views a case has to show. A new file here that no case lists is flagged.
const VIEW_DIRS = ['src/contentScripts/views', 'src/popup', 'src/options', 'src/welcome']

/** The scenario files, in the order their cases appear within a topic. */
const FILES = ['page.shot.ts', 'tooltip.shot.ts', 'dialogs.shot.ts', 'popup.shot.ts', 'popup-more.shot.ts', 'check.shot.ts', 'pages.shot.ts', 'options.shot.ts', 'toolbar.shot.ts']

const PROJECTS = ['light', 'dark', 'phone']

interface Meta {
  name: string
  title: string
  note?: string
  covers: string[]
  file: string
  order: number
  project: string
  test: string
  scale?: number
}

type Outcome = { status: 'passed' } | { status: 'skipped', reason: string } | { status: 'failed', error: string }

// Colour codes in Playwright's error messages
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*m/g

function readMetas(): Meta[] {
  if (!fs.existsSync(RUN))
    return []
  return fs.readdirSync(RUN, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => fs.readdirSync(path.join(RUN, entry.name))
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(RUN, entry.name, f), 'utf8')) as Meta))
}

interface Scenario { file: string, title: string, line: number, outcomes: Record<string, Outcome> }

/** What the catalogue holds, across runs of part of the cases. */
interface State {
  /** Whether a run of every case went into it, so a view no case shows can be told */
  complete: boolean
  fullAt?: string
  updatedAt: string
  scenarios: Record<string, Scenario>
}

/** Every scenario in a Playwright JSON report, run or only listed. */
function walkReport(report: any, visit: (spec: any, test: any) => void) {
  const walk = (suite: any) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? [])
        visit(spec, t)
    }
    for (const child of suite.suites ?? [])
      walk(child)
  }
  for (const suite of report.suites ?? [])
    walk(suite)
}

/** Every scenario the run had, with what became of it in each project. */
function readScenarios(): { scenarios: Scenario[], runErrors: string[], unfinished: number } {
  if (!fs.existsSync(REPORT))
    return { scenarios: [], runErrors: ['The run left no report, so it probably never started. The terminal says why.'], unfinished: 0 }
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'))
  const byId = new Map<string, Scenario>()
  let unfinished = 0
  walkReport(report, (spec, t) => {
    const id = `${spec.file}|${spec.title}`
    const scenario: Scenario = byId.get(id) ?? { file: spec.file, title: spec.title, line: spec.line, outcomes: {} }
    byId.set(id, scenario)
    const result = t.results?.at(-1)
    if (!result) {
      // Stopped with Ctrl+C, or never reached
      unfinished++
      return
    }
    if (result.status === 'passed')
      scenario.outcomes[t.projectName] = { status: 'passed' }
    else if (result.status === 'skipped')
      scenario.outcomes[t.projectName] = { status: 'skipped', reason: t.annotations?.find((a: any) => a.type === 'skip')?.description ?? 'skipped' }
    else
      scenario.outcomes[t.projectName] = { status: 'failed', error: String(result.error?.message ?? result.status).replace(ANSI, '').split('\n')[0].replace(/^Error: /, '') }
  })
  const runErrors = (report.errors ?? []).map((e: any) => String(e.message ?? e).replace(ANSI, '').slice(0, 400))
  // A case that never got to run in any column did not run at all
  return { scenarios: [...byId.values()].filter(s => Object.keys(s.outcomes).length), runErrors, unfinished }
}

function readState(): State | undefined {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  }
  catch {
    return undefined
  }
}

const pictureOf = (meta: Meta) => path.join(RUN, meta.project, `${meta.name}.json`)

function dropPicture(meta: Meta) {
  fs.rmSync(pictureOf(meta), { force: true })
  fs.rmSync(pictureOf(meta).replace(/\.json$/, '.png'), { force: true })
  fs.rmSync(pictureOf(meta).replace(/\.json$/, '.txt'), { force: true })
}

/**
 * Lines a screen may say twice, each with the cases it holds for and why.
 *
 * Everything else said twice on one screen is flagged on its card: a verdict
 * and the facts that repeat it, a caveat under two blocks, a list of one row
 * that is the address printed above it. The reason is part of the entry, so
 * that adding a line here is a decision somebody can read later.
 */
const REPEATS_ALLOWED: [line: string, cases: RegExp, why: string][] = [
  ['Never visited', /^(tooltip-email-mismatch|em-text-is-domain|em-mm-)/, 'the verdict of the address the mail goes to, under the address and again in the table, beside the address the link shows'],
  ['Familiar site', /^(tooltip-email-mismatch|em-text-is-domain|em-mm-)/, 'the verdict of the address the mail goes to, under the address and again in the table, beside the address the link shows'],
  ['Unfamiliar site', /^(tooltip-email-mismatch|em-text-is-domain|em-mm-)/, 'the verdict of the address the mail goes to, under the address and again in the table, beside the address the link shows'],
  ['Public email service', /^(tooltip-email-mismatch|em-text-is-domain|em-mm-)/, 'the verdict of the address the mail goes to, under the address and again in the table, beside the address the link shows'],
  ['Temporary email service', /^(tooltip-email-mismatch|em-text-is-domain|em-mm-)/, 'the verdict of the address the mail goes to, under the address and again in the table, beside the address the link shows'],
  ['Email forwarding service', /^(tooltip-email-mismatch|em-text-is-domain|em-mm-)/, 'the verdict of the address the mail goes to, under the address and again in the table, beside the address the link shows'],
  ['0', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['120', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['400', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['60', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Visits', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Active days', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Days known', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Check', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Shows', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Status', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['none', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['To', /^em-mm-several$/, 'the address the link shows heads the table of every recipient, so its side and the rows are drawn once per recipient'],
  ['Check elsewhere', /^(popup|pp|check|ck|details)-/, 'one under the address and one under its site, each about its own name'],
  ['Turn off', /^(popup|pp|details)-/, 'two switches, warnings and anti-tampering, each on a row of its own'],
  ['Turn on', /^(popup|pp|details)-/, 'the same two switches, both off'],
  ['Update now', /^(opt|options)-/, 'one button per downloaded list'],
  ['at least', /^(opt|options)-/, 'one per familiarity check'],
  ['Active days', /^(opt|options)-/, 'a familiarity check, and an option of the counter'],
  ['Days known', /^(opt|options)-/, 'a familiarity check, and an option of the counter'],
  ['Active days', /^(popup|pp|details|check|ck)-/, 'a fact of the address, and an option of the list of its relatives'],
  ['Days known', /^(popup|pp|details|check|ck)-/, 'a fact of the address, and an option of the list of its relatives'],
  ['Passed checks', /^(popup|pp|details|check|ck)-/, 'a fact of the address, and an option of the list of its relatives'],
  ['Familiar site', /^dlg-familiar-mismatch$/, 'both sides of the comparison are familiar'],
  ['not recorded', /./, 'two facts of one record, neither of them kept'],
  ['none', /mismatch|^tt-mm-|^em-mm-/, 'two facts of a site never visited, each beside the other side\'s number'],
  ['Never visited', /^(ck-mailsite-unvisited)$/, 'two mail sites, neither of them ever opened'],
  ['Never visited', /-once-resolved$/, 'the address a link goes to first and the one it ends at, each with its own verdict'],
  ['Never visited', /^cp-email-mailsite$/, 'the address domain and one of the sites its mail is read on, neither ever opened'],
  ['Email addresses', /^(opt|options)-/, 'the section and its line in the contents'],
  ['Familiarity rules', /^(opt|options)-/, 'the section and its line in the contents'],
  ['Toolbar icon', /^(opt|options)-/, 'the section and its line in the contents'],
  ['Link check', /^(opt|options)-/, 'the section and its line in the contents'],
  ['Check elsewhere', /^(opt|options)-/, 'the section and its line in the contents'],
  ['Your data', /^(opt|options)-/, 'the section and its line in the contents'],
  ['All information about site visits', /^opt-reset-confirm$/, 'the box that was ticked, and the dialog naming what will go'],
  ['All settings', /^opt-reset-confirm$/, 'the box that was ticked, and the dialog naming what will go'],
  ['This is a long pasted document line.', /^paste-revealed-long$/, 'the made-up clipboard contents'],
]

/**
 * What a case's screen says twice, from the words kept beside its picture.
 *
 * Only lines of two words or more, and whole links: an address under "Site"
 * and again in the list of that site's addresses is one name in two roles,
 * and so is a number or a one-word label of a table.
 */
function repeatsOf(name: string): string[] {
  // Every column: the phone lays some screens out with blocks the others lack.
  // Without regard to case, since a small heading is drawn in capitals and
  // comes back that way.
  const found = new Map<string, string>()
  for (const project of PROJECTS) {
    const file = path.join(RUN, project, `${name}.txt`)
    if (!fs.existsSync(file))
      continue
    const counts = new Map<string, number>()
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() && !line.startsWith('  [tooltip]'))
        counts.set(line.toLowerCase(), (counts.get(line.toLowerCase()) ?? 0) + 1)
    }
    for (const [line, count] of counts) {
      if (count > 1 && (/\p{L}{2,}\s+\p{L}{2,}/u.test(line) || /^https?:\/\//.test(line)))
        found.set(line, line)
    }
  }
  return [...found.keys()]
    .filter(line => !REPEATS_ALLOWED.some(([allowed, cases]) => allowed.toLowerCase() === line && cases.test(name)))
}

/**
 * Fold a run of part of the cases into what the catalogue had. Each case and
 * column the run went through is replaced whole, pictures included: a picture
 * it did not take again is one the case no longer takes, or one from before
 * it failed. A case gone from the files since loses its card.
 */
function mergeRun(fresh: Scenario[], now: string, whole: boolean): { state: State, before?: State, redrawn: Set<string> } {
  const filtered = process.env.SHOTS_FILTERED === '1'
  const before = filtered ? readState() : undefined
  // A run of everything that broke off is not one, or every view the missing
  // cases show would be reported as having no case until the next full run
  const complete = !filtered && whole
  const state: State = before
    ? { ...before, updatedAt: fresh.length ? now : before.updatedAt }
    : { complete, fullAt: complete ? now : undefined, updatedAt: now, scenarios: {} }
  const ran = new Set<string>()
  for (const scenario of fresh) {
    const id = `${scenario.file}|${scenario.title}`
    const kept = state.scenarios[id] ?? { ...scenario, outcomes: {} }
    state.scenarios[id] = { ...kept, line: scenario.line, outcomes: { ...kept.outcomes, ...scenario.outcomes } }
    for (const project of Object.keys(scenario.outcomes))
      ran.add(`${id}|${project}`)
  }

  const started = Number(process.env.SHOTS_STARTED ?? 0)
  const existing = filtered && fs.existsSync(CASES) ? listedCases() : undefined
  for (const meta of readMetas()) {
    const key = `${meta.file}|${meta.test}|${meta.project}`
    if (ran.has(key) && fs.statSync(pictureOf(meta)).mtimeMs < started)
      dropPicture(meta)
    else if (existing && !existing.has(key))
      dropPicture(meta)
  }
  if (existing) {
    for (const [id, scenario] of Object.entries(state.scenarios)) {
      for (const project of Object.keys(scenario.outcomes)) {
        if (!existing.has(`${id}|${project}`))
          delete scenario.outcomes[project]
      }
      if (!Object.keys(scenario.outcomes).length)
        delete state.scenarios[id]
    }
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2))
  return { state, before, redrawn: new Set(fresh.map(s => `${s.file}|${s.title}`)) }
}

/** Every case and column in the files right now, as `file|title|project`. */
function listedCases() {
  const cases = new Set<string>()
  walkReport(JSON.parse(fs.readFileSync(CASES, 'utf8')), (spec, t) => cases.add(`${spec.file}|${spec.title}|${t.projectName}`))
  return cases
}

function uncovered(metas: Meta[]): string[] {
  const claimed = new Set(metas.flatMap(m => m.covers))
  return VIEW_DIRS.flatMap(dir => fs.readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith('.vue'))
    .map(f => `${dir}/${f}`))
    .filter(f => !claimed.has(f))
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

interface Card { surface: string, topic: string, rank: number, name: string, title: string, note?: string, cells: Map<string, string>, failed: boolean, redrawn: boolean, repeats: string[] }

function main() {
  const now = new Date()
  const { scenarios: fresh, runErrors, unfinished } = readScenarios()
  const { state, before, redrawn } = mergeRun(fresh, now.toISOString(), fresh.length > 0 && !runErrors.length && !unfinished)
  const scenarios = Object.values(state.scenarios)
  const metas = readMetas()
  const metasByTest = new Map<string, Meta[]>()
  for (const m of metas)
    metasByTest.set(`${m.file}|${m.test}`, [...(metasByTest.get(`${m.file}|${m.test}`) ?? []), m])
  const fileRank = (file: string) => (FILES.includes(file) ? FILES.indexOf(file) : 99) * 1e6

  const cell = (project: string, html: string) => `<figure class="${project}"><figcaption>${project}</figcaption>${html}</figure>`
  const note = (text: string, failed: boolean) => `<div class="${failed ? 'failed' : 'skipped'}">${failed ? '<b>Could not be drawn.</b> ' : ''}${escapeHtml(text)}</div>`

  // One card per picture name. A scenario that drew nothing anywhere still gets
  // a card, from its title, so that it cannot drop out of sight.
  const cards: Card[] = []
  let failedCount = 0
  for (const scenario of scenarios) {
    const own = metasByTest.get(`${scenario.file}|${scenario.title}`) ?? []
    const outcomes = Object.values(scenario.outcomes)
    const failed = outcomes.some(o => o.status === 'failed')
    failedCount += outcomes.filter(o => o.status === 'failed').length
    const isRedrawn = redrawn.has(`${scenario.file}|${scenario.title}`)
    const missing = (project: string) => {
      const outcome = scenario.outcomes[project]
      if (outcome?.status === 'failed')
        return cell(project, note(outcome.error, true))
      if (outcome?.status === 'skipped')
        return cell(project, note(`Not shown here: ${outcome.reason}.`, false))
      if (outcome?.status === 'passed')
        return cell(project, note('This case draws nothing in this column.', false))
      return cell(project, note('Not drawn yet. Run the whole set, or this case, to see it.', false))
    }
    const names = [...new Set(own.map(m => m.name))]
    if (names.length === 0) {
      const name = slug(scenario.title)
      cards.push({ ...place(name), rank: fileRank(scenario.file) + scenario.line * 100, name, title: scenario.title, cells: new Map(PROJECTS.map(p => [p, missing(p)])), failed, redrawn: isRedrawn, repeats: [] })
      continue
    }
    for (const name of names) {
      const first = own.find(m => m.name === name)!
      const cells = new Map<string, string>()
      for (const project of PROJECTS) {
        const meta = own.find(m => m.name === name && m.project === project)
        const src = `run/${project}/${name}.png`
        cells.set(project, meta ? cell(project, `<a class="shot" href="${src}" data-project="${project}"><img loading="lazy" src="${src}"${pngSize(path.join(SHOTS, src))} alt=""></a>`) : missing(project))
      }
      const scale = own.find(m => m.name === name && m.scale)?.scale
      const scaleNote = scale ? `Drawn at text size ${scale} (SHOTS_SCALE).` : undefined
      cards.push({ ...place(name), rank: fileRank(first.file) + first.order, name, title: first.title, note: [first.note, scaleNote].filter(Boolean).join(' ') || undefined, cells, failed, redrawn: isRedrawn, repeats: repeatsOf(name) })
    }
  }

  // Surfaces and topics in the order of SECTIONS, "Other" last
  const order = (surface: string, topic: string) => {
    const i = SECTIONS.findIndex(([s, t]) => s === surface && t === topic)
    return i === -1 ? SECTIONS.length : i
  }
  cards.sort((a, b) => order(a.surface, a.topic) - order(b.surface, b.topic) || a.rank - b.rank)
  const surfaces = [...new Set(cards.map(c => c.surface))]
  const topicsOf = (surface: string) => [...new Set(cards.filter(c => c.surface === surface).map(c => c.topic))]
  const cardsOf = (surface: string, topic: string) => cards.filter(c => c.surface === surface && c.topic === topic)
  const topicId = (surface: string, topic: string) => `t-${slug(`${surface} ${topic}`)}`
  const badCount = (list: Card[]) => list.filter(c => c.failed).length
  const counter = (list: Card[]) => `<span class="count">${badCount(list) ? `<span class="dot">● ${badCount(list)}</span> ` : ''}${list.length}</span>`

  const filtered = process.env.SHOTS_FILTERED === '1'
  const missingViews = state.complete ? uncovered(metas) : []
  const fresher = cards.filter(c => c.redrawn)
  const repeating = cards.filter(c => c.repeats.length)
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB')
  const notices = [
    ...runErrors.map(e => `<li><b>The run itself went wrong:</b> ${escapeHtml(e)}</li>`),
    ...(failedCount ? [`<li><b>${failedCount} ${failedCount === 1 ? 'picture' : 'pictures'} could not be drawn.</b> The screen the case waits for never appeared, so there was nothing to take a picture of. Usually that is a bug in the extension rather than in the case. Each red card says what was missing.</li>`] : []),
    ...(filtered && fresher.length ? [`<li><b>Only ${fresher.length} ${fresher.length === 1 ? 'case was' : 'cases were'} drawn again just now:</b> ${fresher.map(c => `<a href="#${c.name}">${escapeHtml(c.title)}</a>`).join(', ')}. The rest are as they were${before ? ` on ${when(before.updatedAt)}` : ''}.</li>`] : []),
    ...(repeating.length ? [`<li><b>${repeating.length} ${repeating.length === 1 ? 'screen says' : 'screens say'} the same line twice:</b> ${repeating.map(c => `<a href="#${c.name}">${escapeHtml(c.title)}</a>`).join(', ')}. Each card names the line. Take one of the two off the screen, or add the line to <code>REPEATS_ALLOWED</code> in e2e-shots/gallery.ts with the reason it is said twice.</li>`] : []),
    ...(unfinished ? [`<li><b>The run stopped before ${unfinished} ${unfinished === 1 ? 'picture' : 'pictures'}.</b> Their cards keep what they had before, or say they were not drawn yet.</li>`] : []),
    ...(state.complete ? [] : ['<li>The whole set has not been drawn yet, only parts of it, so whether every view has a case was not checked. <code>just shots</code> draws everything.</li>']),
    ...cards.filter(c => c.surface === 'Other' && !c.failed).map(c => `<li><b>No topic for</b> <code>${c.name}</code>, so it is under Other at the bottom. Add a line to <code>SECTIONS</code> in e2e-shots/gallery-sections.ts.</li>`),
    ...missingViews.map(v => `<li><b>No case shows</b> <code>${v}</code>. Add one to e2e-shots/ that lists it in <code>covers</code>.</li>`),
  ]

  const toc = surfaces.map(s => `<div class="surface" data-surface="${slug(s)}"><div class="s-title">${escapeHtml(s)}</div>${topicsOf(s).map((t) => {
    const list = cardsOf(s, t)
    return `<div class="topic" data-topic="${topicId(s, t)}"><a class="t-link" href="#${topicId(s, t)}"><span>${escapeHtml(t)}</span>${counter(list)}</a><div class="cases">${list.map(c => `<a href="#${c.name}"${c.failed ? ' class="bad"' : ''}>${escapeHtml(c.title)}</a>`).join('')}</div></div>`
  }).join('')}</div>`).join('')

  const body = surfaces.map(s => `<section data-surface="${slug(s)}"><h2>${escapeHtml(s)}</h2>${topicsOf(s).map(t => `<section data-topic="${topicId(s, t)}"><h3 id="${topicId(s, t)}">${escapeHtml(t)}</h3>${cardsOf(s, t).map(c => `<section class="card${c.failed ? ' bad' : ''}" id="${c.name}" data-title="${escapeHtml(c.title)}" data-surface-name="${escapeHtml(s)}" data-topic-name="${escapeHtml(t)}" data-surface-id="${slug(s)}" data-topic-id="${topicId(s, t)}" data-search="${escapeHtml(`${c.name} ${c.title} ${c.note ?? ''}`.toLowerCase())}">
  <div class="head"><h4>${escapeHtml(c.title)}</h4><code class="name">${c.name}</code><button class="copy" type="button" title="Copy the case name and title, to paste into a message">Copy name</button></div>${c.note ? `<p class="note">${escapeHtml(c.note)}</p>` : ''}${c.repeats.length ? `<p class="repeats"><b>Said twice on this screen:</b> ${c.repeats.map(line => `“${escapeHtml(line.length > 90 ? `${line.slice(0, 90)}…` : line)}”`).join(', ')}</p>` : ''}
  <div class="row">${PROJECTS.map(p => c.cells.get(p)).join('')}</div>
</section>`).join('')}</section>`).join('')}</section>`).join('')

  const asset = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Visilant – every screen</title><style>${asset('gallery.css')}</style></head><body>
<nav>
  <header>
    <h1>Visilant – every screen</h1>
    <div class="meta">${cards.length} cases${state.fullAt ? `, all drawn ${when(state.fullAt)}` : ''}${state.updatedAt !== state.fullAt ? `, some again ${when(state.updatedAt)}` : ''}${failedCount ? `<br><span class="missing" title="Show only these">● ${failedCount} ${failedCount === 1 ? 'picture is' : 'pictures are'} missing</span>` : ''}</div>
    <input type="search" autocomplete="off" placeholder="Find a case  ( / )">
    <div class="tools">${PROJECTS.map(p => `<label><input type="checkbox" data-column="${p}" checked> ${p}</label>`).join('')}${failedCount ? '<label><input type="checkbox" data-only-bad autocomplete="off"> only missing</label>' : ''}</div>
    <div class="review"><button class="review-btn" type="button" title="Go through every picture from the first, and come back to where you stopped">Full review</button>
      <div class="review-offer" hidden><p></p><button type="button" data-review="continue">Continue there</button><button type="button" data-review="restart">Start from the first</button></div></div>
  </header>
  <div class="toc">${toc}</div>
</nav>
<main>
${notices.length ? `<ul class="notices">${notices.join('')}</ul>` : ''}
${body}
</main>
<div id="lb" hidden>
  <div class="stage"><img alt=""></div>
  <div class="caption">
    <h4></h4><p class="note"></p>
    <div class="meta"><span class="review-tag">Review</span><span class="where"></span><code></code><span class="proj"></span><span class="pos"></span><button class="copy" type="button">Copy name</button>
      <span class="keys"><kbd>←</kbd> <kbd>→</kbd> picture &nbsp; <kbd>↑</kbd> <kbd>↓</kbd> case &nbsp; <kbd>c</kbd> copy &nbsp; <kbd>z</kbd> full size &nbsp; <kbd>Esc</kbd> close</span></div>
  </div>
  <button class="nav-btn prev" type="button" title="Previous picture">‹</button>
  <button class="nav-btn next" type="button" title="Next picture">›</button>
  <button class="close" type="button" title="Close">×</button>
</div>
<script>${asset('gallery-client.js')}</script>
</body></html>`
  fs.writeFileSync(path.join(SHOTS, 'index.html'), html)

  console.log(`[shots] ${filtered ? `${fresher.length} drawn again, ` : ''}${cards.length} cases in .tmp/shots/index.html${failedCount ? `, ${failedCount} pictures could not be drawn (red dots there)` : ''}${missingViews.length ? `, ${missingViews.length} views no case shows` : ''}${repeating.length ? `, ${repeating.length} say a line twice (${repeating.slice(0, 8).map(c => c.name).join(', ')}${repeating.length > 8 ? ', …' : ''})` : ''}`)

  // An empty catalogue is never a clean run. Most often a `-g` that matched
  // nothing, which Playwright reports and then exits on with success.
  if (!fresh.length) {
    console.error('[shots] no case was drawn. A -g filter matches the name a case has in its file, test(\'copy warning\', …), and the file name, not the title or picture name on its card')
    process.exitCode = 1
  }
}

/**
 * The picture's own size as attributes, so a lazy picture holds its place
 * before it loads and a jump to a card lands where it should. A PNG keeps its
 * width and height at bytes 16 to 23.
 */
function pngSize(file: string) {
  try {
    const head = new Uint8Array(24)
    const fd = fs.openSync(file, 'r')
    fs.readSync(fd, head, 0, 24, 0)
    fs.closeSync(fd)
    const view = new DataView(head.buffer)
    return ` width="${view.getUint32(16)}" height="${view.getUint32(20)}"`
  }
  catch {
    return ''
  }
}

function place(name: string) {
  const [surface, topic] = placeOf(name)
  return { surface, topic }
}

main()
