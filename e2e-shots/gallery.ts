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
 */
/* eslint-disable no-console -- a command-line step, and its output is the report */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, '.tmp/shots')
const RUN = path.join(SHOTS, 'run')
const REPORT = path.join(SHOTS, 'report.json')

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

interface Scenario { file: string, title: string, line: number, outcomes: Map<string, Outcome> }

/** Every scenario the run had, with what became of it in each project. */
function readScenarios(): { scenarios: Scenario[], runErrors: string[] } {
  if (!fs.existsSync(REPORT))
    return { scenarios: [], runErrors: ['The run left no report, so it probably never started. The terminal says why.'] }
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'))
  const byId = new Map<string, Scenario>()
  const walk = (suite: any) => {
    for (const spec of suite.specs ?? []) {
      const id = `${spec.file}|${spec.title}`
      const scenario = byId.get(id) ?? { file: spec.file, title: spec.title, line: spec.line, outcomes: new Map() }
      byId.set(id, scenario)
      for (const t of spec.tests ?? []) {
        const result = t.results?.at(-1)
        if (!result)
          continue
        if (result.status === 'passed')
          scenario.outcomes.set(t.projectName, { status: 'passed' })
        else if (result.status === 'skipped')
          scenario.outcomes.set(t.projectName, { status: 'skipped', reason: t.annotations?.find((a: any) => a.type === 'skip')?.description ?? 'skipped' })
        else
          scenario.outcomes.set(t.projectName, { status: 'failed', error: String(result.error?.message ?? result.status).replace(ANSI, '').split('\n')[0].replace(/^Error: /, '') })
      }
    }
    for (const child of suite.suites ?? [])
      walk(child)
  }
  for (const suite of report.suites ?? [])
    walk(suite)
  const runErrors = (report.errors ?? []).map((e: any) => String(e.message ?? e).replace(ANSI, '').slice(0, 400))
  return { scenarios: [...byId.values()], runErrors }
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

/**
 * Where a case sits in the contents: what the user is looking at, then which
 * side of it. Matched on the picture name, first match wins, and the order here
 * is the order of the catalogue. A name nothing matches lands under "Other"
 * rather than dropping out of sight.
 */
const SECTIONS: [surface: string, topic: string, names: RegExp][] = [
  ['On a web page', 'Typing and copy warnings', /^warning-/],
  ['On a web page', 'Link tooltip: familiar or not', /^(tooltip-(familiar|unfamiliar|thresholds)|tt-(some-visits|subdomain|count|single|unknown|rule|thresholds))/],
  ['On a web page', 'Link tooltip: lookalikes', /^(tooltip-punycode|tt-(look|idn)-)/],
  ['On a web page', 'Link tooltip: a suspicious address', /^tt-mark-/],
  ['On a web page', 'Link tooltip: text names another site', /^(tooltip-mismatch|tt-mm-)/],
  ['On a web page', 'Link tooltip: short links', /^(tooltip-shortener|tt-(short|once)-)/],
  ['On a web page', 'Link tooltip: size and position', /^tt-(above|right|font|long)/],
  ['On a web page', 'Email links', /^(tooltip-email-|em-)/],
  ['On a web page', 'QR codes and selected text', /^(tooltip-qr|qr-|sel-)/],
  ['On a web page', 'Link dialog', /^(dialog-link|dlg-)/],
  ['On a web page', 'Paste dialog', /^(dialog-paste|paste-)/],
  ['On a web page', 'Check panel', /^(panel-|cp-)/],
  ['Toolbar popup', 'Familiar or not', /^(popup-(unfamiliar|family|thresholds)|pp-(rule|legacy|new-|root|solo|www))/],
  ['Toolbar popup', 'Lookalikes', /^(popup-punycode|pp-(look|idn|mixed|punycode))/],
  ['Toolbar popup', 'A suspicious address', /^pp-mark-/],
  ['Toolbar popup', 'The list of relatives', /^pp-(family|metric|sort)/],
  ['Toolbar popup', 'Warnings and anti-tampering', /^(popup-silenced|pp-(silenced|warnings|tamper))/],
  ['Toolbar popup', 'Special sites', /^(popup-(shortener|no-site)|pp-(localhost|dotted|private|public|platform|tenant|custom|tab-view))/],
  ['Toolbar popup', 'Size and text', /^(popup-large|pp-(font|name|highlight|upper))/],
  ['Toolbar popup', 'Site details page', /^(details-|pp-details)/],
  ['Check page', 'Empty and leftover', /^(check-(empty|nothing)|ck-stale)/],
  ['Check page', 'Sites and links', /^(check-(url|lookalike|punycode|unknown|shortener)|ck-(expand|userinfo|text-with))/],
  ['Check page', 'Email addresses', /^(check-email|ck-(account|custom|email|embedded|local|provider|mailsite|markers))/],
  ['Check page', 'Mailto with several recipients', /^(check-mailto|ck-(mailto|prefilled))/],
  ['Check page', 'Comparing two addresses', /^(check-compare|ck-compare)/],
  ['Check page', 'Phone, text, Wi-Fi, places, QR', /^ck-(geo|sms|tel|wifi|invisible|qr)/],
  ['Check page', '"Check elsewhere" links', /^ck-lookups/],
  ['Settings', 'The whole page', /^(options-(full|compact)|opt-(all|nav|write|reset))/],
  ['Settings', 'General', /^options-general/],
  ['Settings', 'Familiarity', /^(options-familiarity|opt-fam)/],
  ['Settings', 'Link check and short links', /^(options-link|opt-ls)/],
  ['Settings', 'Notifications', /^(options-notif|opt-notif)/],
  ['Settings', 'Display', /^(options-display|opt-display)/],
  ['Settings', 'Email lists', /^(options-email|opt-email)/],
  ['Settings', '"Check elsewhere" links', /^(options-lookups|opt-lookups)/],
  ['Settings', 'Anti-tampering', /^(options-tamper|opt-tamper)/],
  ['Settings', 'Your data and import', /^(options-data|opt-data)/],
  ['Welcome page', 'Import on install', /^welcome-/],
  ['Toolbar button', 'Icon and badge', /^toolbar/],
]

function placeOf(name: string): [string, string] {
  const hit = SECTIONS.find(([, , names]) => names.test(name))
  return hit ? [hit[0], hit[1]] : ['Other', 'Not placed in the contents yet']
}

interface Card { surface: string, topic: string, rank: number, name: string, title: string, note?: string, cells: Map<string, string>, failed: boolean }

function main() {
  const metas = readMetas()
  const { scenarios, runErrors } = readScenarios()
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
    const failed = [...scenario.outcomes.values()].some(o => o.status === 'failed')
    failedCount += [...scenario.outcomes.values()].filter(o => o.status === 'failed').length
    const missing = (project: string) => {
      const outcome = scenario.outcomes.get(project)
      if (outcome?.status === 'failed')
        return cell(project, note(outcome.error, true))
      if (outcome?.status === 'skipped')
        return cell(project, note(`Not shown here: ${outcome.reason}.`, false))
      return cell(project, note('Not part of this run.', false))
    }
    const names = [...new Set(own.map(m => m.name))]
    if (names.length === 0) {
      const name = slug(scenario.title)
      cards.push({ ...place(name), rank: fileRank(scenario.file) + scenario.line * 100, name, title: scenario.title, cells: new Map(PROJECTS.map(p => [p, missing(p)])), failed })
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
      cards.push({ ...place(name), rank: fileRank(first.file) + first.order, name, title: first.title, note: first.note, cells, failed })
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
  const missingViews = filtered ? [] : uncovered(metas)
  const notices = [
    ...runErrors.map(e => `<li><b>The run itself went wrong:</b> ${escapeHtml(e)}</li>`),
    ...(failedCount ? [`<li><b>${failedCount} ${failedCount === 1 ? 'picture' : 'pictures'} could not be drawn.</b> The screen the case waits for never appeared, so there was nothing to take a picture of. Usually that is a bug in the extension rather than in the case. Each red card says what was missing.</li>`] : []),
    ...(filtered ? ['<li>Only part of the cases were drawn this time, so whether every view has a case was not checked.</li>'] : []),
    ...cards.filter(c => c.surface === 'Other' && !c.failed).map(c => `<li><b>No topic for</b> <code>${c.name}</code>, so it is under Other at the bottom. Add a line to <code>SECTIONS</code> in e2e-shots/gallery.ts.</li>`),
    ...missingViews.map(v => `<li><b>No case shows</b> <code>${v}</code>. Add one to e2e-shots/ that lists it in <code>covers</code>.</li>`),
  ]

  const toc = surfaces.map(s => `<div class="surface" data-surface="${slug(s)}"><div class="s-title">${escapeHtml(s)}</div>${topicsOf(s).map((t) => {
    const list = cardsOf(s, t)
    return `<div class="topic" data-topic="${topicId(s, t)}"><a class="t-link" href="#${topicId(s, t)}"><span>${escapeHtml(t)}</span>${counter(list)}</a><div class="cases">${list.map(c => `<a href="#${c.name}"${c.failed ? ' class="bad"' : ''}>${escapeHtml(c.title)}</a>`).join('')}</div></div>`
  }).join('')}</div>`).join('')

  const body = surfaces.map(s => `<section data-surface="${slug(s)}"><h2>${escapeHtml(s)}</h2>${topicsOf(s).map(t => `<section data-topic="${topicId(s, t)}"><h3 id="${topicId(s, t)}">${escapeHtml(t)}</h3>${cardsOf(s, t).map(c => `<section class="card${c.failed ? ' bad' : ''}" id="${c.name}" data-title="${escapeHtml(c.title)}" data-surface-name="${escapeHtml(s)}" data-topic-name="${escapeHtml(t)}" data-surface-id="${slug(s)}" data-topic-id="${topicId(s, t)}" data-search="${escapeHtml(`${c.name} ${c.title} ${c.note ?? ''}`.toLowerCase())}">
  <div class="head"><h4>${escapeHtml(c.title)}</h4><code class="name">${c.name}</code><button class="copy" type="button" title="Copy the case name and title, to paste into a message">Copy name</button></div>${c.note ? `<p class="note">${escapeHtml(c.note)}</p>` : ''}
  <div class="row">${PROJECTS.map(p => c.cells.get(p)).join('')}</div>
</section>`).join('')}</section>`).join('')}</section>`).join('')

  const asset = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Visilant – every screen</title><style>${asset('gallery.css')}</style></head><body>
<nav>
  <header>
    <h1>Visilant – every screen</h1>
    <div class="meta">${cards.length} cases, drawn ${new Date().toLocaleString('en-GB')}${failedCount ? `<br><span class="missing" title="Show only these">● ${failedCount} ${failedCount === 1 ? 'picture is' : 'pictures are'} missing</span>` : ''}</div>
    <input type="search" autocomplete="off" placeholder="Find a case  ( / )">
    <div class="tools">${PROJECTS.map(p => `<label><input type="checkbox" data-column="${p}" checked> ${p}</label>`).join('')}${failedCount ? '<label><input type="checkbox" data-only-bad autocomplete="off"> only missing</label>' : ''}</div>
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
    <div class="meta"><span class="where"></span><code></code><span class="proj"></span><span class="pos"></span><button class="copy" type="button">Copy name</button>
      <span class="keys"><kbd>←</kbd> <kbd>→</kbd> picture &nbsp; <kbd>↑</kbd> <kbd>↓</kbd> case &nbsp; <kbd>c</kbd> copy &nbsp; <kbd>z</kbd> full size &nbsp; <kbd>Esc</kbd> close</span></div>
  </div>
  <button class="nav-btn prev" type="button" title="Previous picture">‹</button>
  <button class="nav-btn next" type="button" title="Next picture">›</button>
  <button class="close" type="button" title="Close">×</button>
</div>
<script>${asset('gallery-client.js')}</script>
</body></html>`
  fs.writeFileSync(path.join(SHOTS, 'index.html'), html)

  console.log(`[shots] ${cards.length} cases in .tmp/shots/index.html${failedCount ? `, ${failedCount} pictures could not be drawn (red dots there)` : ''}${missingViews.length ? `, ${missingViews.length} views no case shows` : ''}`)

  // An empty catalogue is never a clean run. Most often a `-g` that matched
  // nothing, which Playwright reports and then exits on with success.
  if (!cards.length) {
    console.error('[shots] no case was drawn. A -g filter matches case titles, not file or case names')
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
