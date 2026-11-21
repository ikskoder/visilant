/**
 * The pattern sheet: `.tmp/shots/patterns.html`.
 *
 * The catalogue has a card for every case, some 350 of them, and most differ
 * from their neighbours by one line. Nobody can look through that to find out
 * whether an address reads the same in the tooltip as in the dialog. This
 * page asks only that question: one row per state of a block, one column per
 * surface that draws the block, each cell the box alone, cut out of the
 * catalogue's own picture of a case. A row whose cells do not read alike is
 * the finding.
 *
 * Nothing is drawn here. `just shots` takes the pictures and notes where the
 * box sits in each (`box` in the case's json, see fixtures.ts), and this lays
 * a few dozen of them out. A cell names its case, so the full picture and the
 * note on what to look for are one click away in the catalogue.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(__dirname, '../.tmp/shots')
const RUN = path.join(ROOT, 'run')
const PROJECTS = ['light', 'dark', 'phone']

interface Block {
  title: string
  /** What has to be the same along a row. */
  rule: string
  surfaces: string[]
  /** State, then the case that shows it on each surface, in the order of `surfaces`. */
  rows: [state: string, ...cases: (string | null)[]][]
}

const BLOCKS: Block[] = [
  {
    title: 'An address and what is known about it',
    rule: 'Heading, the address (with its other spelling straight under it), then Status with the verdict and the count of red flags, the flags themselves, then the facts. The words follow how the reader got here: stopped on a click ("Open anyway", "Don\'t open"), or asked from the menu ("Open in new tab", "Close"). One block (AddressBlock.vue) in the tooltip and both dialogs. The check panel keeps the order and draws the facts as a grid.',
    surfaces: ['Link tooltip', 'Link dialog', 'Paste dialog', 'Check panel'],
    rows: [
      ['Familiar', 'tooltip-familiar', 'dialog-link-familiar', 'paste-frame-safe', null],
      ['Seen a few times', 'tt-some-visits', 'dlg-some-visits', 'paste-some-visits', 'cp-some-visits'],
      ['Never visited', 'tooltip-unfamiliar', 'dialog-link', 'paste-url', 'cp-never'],
      ['Facts hidden by the setting', 'tt-count-hidden', 'dlg-count-hidden', null, null],
      ['Facts with their bars', 'tooltip-thresholds', 'dlg-thresholds', null, null],
      ['Could not be checked', 'tt-unchecked', 'dlg-unchecked', 'paste-frame-error', null],
      ['A red flag', 'tt-mark-userinfo', 'dlg-markers', null, 'cp-markers'],
      ['Several familiar names parked in front: one line naming each, "or" between them, no comma beside an address', 'tt-mark-embedded-three', null, null, null],
      ['A lookalike', 'tt-look-one-edit', 'dlg-lookalike', 'paste-lookalike-site', null],
      ['A name in another alphabet', 'tooltip-punycode', 'dlg-idn', 'paste-idn-site', 'cp-ascii-list'],
      ['Longer than a line: each line that goes on ends in ↩, and an address in a sentence is not cut', null, 'dlg-long', null, 'cp-markers'],
      ['Asked for from the menu, nobody was stopped', 'qr-url', 'dlg-mode-off', null, null],
      ['Warnings turned off for the site', null, null, 'paste-frame-silenced', null],
      ['A paste in a box inside the page: the address is the page\'s, and nothing is said about the box', null, null, 'paste-frame-unfamiliar', null],
    ],
  },
  {
    title: 'What a frame says',
    rule: 'Two things, each by its own means. The line says whose the label is: solid on a tint is the site, dashed is a level in front of it, where anything can be written. The colour says a finding is about this label, the one the line under the address spells out: red for a red flag, orange for what is only worth a look. One function decides it for every surface (logic/piece-tones.ts), so a finding is never said in a line and left unmarked in the address. A piece quoted in a line is drawn as the address draws it, colour included. Another site named in a line, the one being imitated, keeps no colour: it is the real one.',
    surfaces: ['Link tooltip', 'Link dialog', 'Paste dialog', 'Check panel'],
    rows: [
      ['Nothing found: the site solid, the level in front dashed', 'tt-plain-subdomain', null, null, null],
      ['A familiar name parked in front: its labels red', 'tt-mark-embedded-known', 'dlg-markers', null, 'cp-markers'],
      ['A name nobody visited parked in front: nothing said, nothing coloured', 'tt-mark-embedded', null, null, null],
      ['Several parked names, all red', 'tt-mark-embedded-three', null, null, null],
      ['A name in another alphabet: red, in both spellings', 'tooltip-punycode', 'dlg-idn', 'paste-idn-site', null],
      ['A sure lookalike: the name red', 'tt-look-one-edit', 'dlg-lookalike', 'paste-lookalike-site', null],
      ['A near miss: the name orange', 'tt-look-two-edits', null, null, null],
      ['A shared platform: its ending orange, in the address and in the line', 'tt-hosted-on', null, null, null],
      ['Too many levels: all of them orange', 'tt-mark-deep', null, null, null],
      ['A throwaway mail service: the site orange', 'tooltip-email-disposable', null, null, 'cp-email-disposable'],
      ['A short-link service: the site orange', 'tooltip-shortener', 'dialog-link-shortener', null, null],
      ['Recipients: each address coloured by its own lines', 'em-recipient-notes', null, null, null],
      ['Frames switched off: the tint alone', 'tt-frames-off-flagged', null, null, null],
    ],
  },
  {
    title: 'The recipients of a mail link',
    rule: 'A row per recipient, by domain and then by username, so a lookalike sits beside the name it imitates. A closed row says what is known in signs: the verdict, the flag with how many red flags, the orange shield with how many things are worth a look, a throwaway or forwarding service among them. One row opens at a time, framed, with its words under it. On the check page the open row is the one the card shows large and the comparison takes. The same domain in other rows gets a violet frame while one is pointed at or open (MailRecipients.vue).',
    surfaces: ['Link tooltip', 'Check page'],
    rows: [
      ['All closed', 'em-same-domain', 'check-mailto'],
      ['A red flag opened', 'em-recipient-notes', 'ck-mailto-chosen'],
      ['A throwaway service opened', 'em-cc-bcc', null],
      ['A forwarding service opened', 'em-recipient-forwarding', null],
      ['Thirty, and two that are not addresses', 'em-thirty', 'ck-mailto-30'],
    ],
  },
  {
    title: 'A mail service',
    rule: 'Nobody opens the domain of a mail service, so it gets no verdict on visits. In its place a badge names the kind, and one line under the domain says what that means: grey for a public provider, orange for a throwaway or a forwarding service, with the site orange in the address. One badge and one line for every surface, in the same words (MailServiceBadge.vue, MailServiceNote.vue, drawn by AddressFindings.vue). What writing to such an address means is behind the question mark.',
    surfaces: ['Link tooltip', 'Check panel', 'Check page', 'Recipients'],
    rows: [
      ['A public provider', 'tooltip-email-public', 'cp-email-gmail', 'check-email-gmail', null],
      ['A throwaway service', 'tooltip-email-disposable', 'cp-email-disposable', 'check-email-disposable', 'em-cc-bcc'],
      ['A forwarding service', 'tooltip-email-forwarding', 'cp-email-forwarding', 'check-email-forwarding', 'em-recipient-forwarding'],
    ],
  },
  {
    title: 'Red and orange',
    rule: 'Red is a reason to stop: a red flag (a flag), a failed verdict (the shield with a cross). Orange is worth a look and no more: the shield with an exclamation mark, on a line or in a badge that stands where a verdict would. In one box the red flags come first, then the orange lines. Never an orange flag, never a red line without a flag.',
    surfaces: ['Link tooltip', 'Link dialog', 'Paste dialog', 'Check panel'],
    rows: [
      ['A red flag and an orange line together', 'tt-mark-deep', 'dlg-markers', null, 'cp-markers'],
      ['A site on a shared platform', 'tt-hosted-on', null, null, null],
      ['A near miss of a known site', 'tt-look-two-edits', null, null, null],
      ['A short link', 'tooltip-shortener', 'dlg-short-resolved', null, null],
      ['A throwaway mail service', 'tooltip-email-disposable', null, null, 'cp-email-disposable'],
      ['Before @: a letter of another alphabet', 'em-local-unicode', null, null, 'cp-email-local-unicode'],
      ['Before @: letters with marks', 'em-local-marks', null, null, null],
      ['Before @: a name in another alphabet', 'em-local-script', null, null, null],
      ['Before @: an invisible character', 'em-local-invisible', null, null, null],
    ],
  },
  {
    title: 'Help behind a question mark',
    rule: 'One button (VzHelp.vue), the same everywhere: read on hover, and a press puts the same words on a line under the row. It says what the reader needs at that step to decide, and never what is already on screen.',
    surfaces: ['Link tooltip', 'Link dialog', 'Paste dialog', 'Check panel'],
    rows: [
      ['Beside "Try to find where it leads"', 'tooltip-unfamiliar', 'dialog-link', null, null],
      ['Pressed', null, 'dlg-help-open', null, null],
      ['After "most likely"', 'tooltip-shortener-resolved', 'dlg-short-resolved', null, null],
      ['The two spellings of a name', 'tooltip-punycode', 'dlg-idn', 'paste-idn-site', 'cp-ascii-list'],
      ['A throwaway mail service', 'tooltip-email-disposable', null, null, 'cp-email-disposable'],
    ],
  },
  {
    title: 'A link that leads somewhere else',
    rule: 'One block (ShortLinkBlock.vue) in the tooltip and the dialog: the button, the same button while it works, then "Real destination" as an address block of its own. The popup\'s check field is different by design: it draws no destination, the card under it does.',
    surfaces: ['Link tooltip', 'Link dialog'],
    rows: [
      ['A short link, not followed yet', 'tooltip-shortener', 'dialog-link-shortener'],
      ['Being followed', 'tt-short-loading', 'dlg-short-pressed-loading'],
      ['Followed to a site never visited, with the redirect chain', 'tooltip-shortener-resolved', 'dlg-short-chain'],
      ['Followed to a familiar site', 'tt-short-to-familiar', 'dlg-short-to-familiar'],
      ['Followed to a lookalike', 'tt-short-to-lookalike', 'dlg-short-to-lookalike'],
      ['Could not be followed', 'tt-short-error', 'dlg-short-error'],
      ['An ordinary link, followed on request', 'tt-once-resolved', 'dlg-once-resolved'],
      ['An ordinary link, offered to follow', 'tt-short-any-idle', 'dlg-any-idle'],
    ],
  },
  {
    title: 'Link text names one site, the link goes to another',
    rule: 'One table (MismatchTable.vue). The rows of facts are there while at least one side has visits on show, and a side never visited then keeps its zeros.',
    surfaces: ['Link tooltip', 'Link dialog'],
    rows: [
      ['Familiar against never visited', 'tooltip-mismatch', 'dialog-link-mismatch'],
      ['Both familiar', null, 'dlg-familiar-mismatch'],
      ['With the count of passed checks', 'tt-mm-summary', null],
      ['One side hidden by the setting, the other never visited', 'tt-mm-count-mixed', null],
      ['The destination is a lookalike', 'tt-mm-lookalike', 'dlg-mismatch-lookalike'],
    ],
  },
  {
    title: 'An email address',
    rule: 'The address, then Status. The verdict is about the site of its domain and uses the same three words as everywhere else.',
    surfaces: ['Link tooltip', 'Check panel'],
    rows: [
      ['Domain never visited', 'em-embedded-ending', 'cp-email-suspicious'],
      ['Domain seen a few times', 'em-unfamiliar', null],
      ['Domain familiar', 'em-familiar', null],
      ['A public mail service', 'tooltip-email-public', 'cp-email-gmail'],
      ['A throwaway mail service', 'tooltip-email-disposable', 'cp-email-disposable'],
      ['The text shows another address', 'tooltip-email-mismatch', null],
      ['The text shows a domain alone', 'em-text-is-domain', null],
      ['The text shows another username at the same domain', 'em-mm-same-domain', null],
      ['The text shows a site, the mail goes to a public provider', 'em-mm-public', null],
      ['The text shows a site, the mail goes to a throwaway service', 'em-mm-disposable', null],
      ['Two public providers', 'em-mm-two-public', null],
      ['The text names none of several recipients', 'em-mm-several', null],
      ['Several recipients, two at one domain and one a letter off', 'em-same-domain', null],
      ['Mail read on another site', null, 'cp-email-mailsite'],
    ],
  },
  {
    title: 'What each part of an address is',
    rule: 'A question mark after every address (AddressParts.vue) opens a card that reads it part by part, with its own pieces in their frames: username, levels in front of the site, the own name of the site, the ending or the platform.',
    surfaces: ['Link tooltip'],
    rows: [
      ['A site with levels in front', 'tt-parts'],
      ['A site on a platform', 'tt-parts-platform'],
      ['An email address', 'em-parts'],
    ],
  },
  {
    title: 'The sign at the head of a box',
    rule: 'One icon, first in the first row of every box drawn over a page: Visilant\'s shield with the sign cut into it. An exclamation mark for a warning (red to stop for, orange when nothing in the box is red), a flag for red flags, an i for a note, a dash for a site that could not be checked. A verdict is never the sign of the box: it is the badge under the address. The logo where the row signals nothing. Never two icons side by side, never a row to itself. A red flag in a line of the box stays a flag.',
    surfaces: ['Link tooltip', 'Link dialog', 'Paste dialog', 'Check panel', 'Typing warning'],
    rows: [
      ['A warning to stop for, red', null, 'dlg-long', 'paste-text', null, 'warning-typing'],
      ['Worth a look and nothing red in the box, orange', null, 'dialog-link-shortener', null, null, null],
      ['Red flags', 'tt-mm-aria', 'dlg-lookalike', null, null, null],
      ['A note', null, 'dialog-link-familiar', 'paste-frame-safe', null, null],
      ['Could not be checked', null, 'dlg-unchecked', 'paste-frame-error', null, null],
      ['Nothing to signal', 'tooltip-qr-wifi', null, null, 'cp-www', null],
    ],
  },
]

/** Width and height of a PNG, from its header. */
function sizeOf(file: string): [number, number] {
  const head = Buffer.alloc(24)
  const fd = fs.openSync(file, 'r')
  fs.readSync(fd, head, 0, 24, 0)
  fs.closeSync(fd)
  return [head.readUInt32BE(16), head.readUInt32BE(20)]
}

interface Cut { src: string, x: number, y: number, width: number, height: number, sheet: [number, number] }

function cutOf(project: string, name: string): Cut | null {
  const picture = path.join(RUN, project, `${name}.png`)
  const meta = path.join(RUN, project, `${name}.json`)
  if (!fs.existsSync(picture) || !fs.existsSync(meta))
    return null
  const { box } = JSON.parse(fs.readFileSync(meta, 'utf8'))
  const [width, height] = sizeOf(picture)
  const ratio = box?.ratio || 1
  const src = `run/${project}/${name}.png`
  // A picture taken before the box was noted, or of a page with no box on it, is shown whole
  if (!box)
    return { src, x: 0, y: 0, width, height, sheet: [width, height] }
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  // To the far edge of the box, not its width from a start rounded down: a box at
  // 412.5 lost its right border that way
  return { src, x, y, width: Math.min(Math.ceil(box.x + box.width), width / ratio) - x, height: Math.min(Math.ceil(box.y + box.height), height / ratio) - y, sheet: [width / ratio, height / ratio] }
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

const missing: string[] = []
const cuts: Record<string, Record<string, Cut>> = {}
for (const block of BLOCKS) {
  for (const [, ...cases] of block.rows) {
    for (const name of cases) {
      if (!name)
        continue
      cuts[name] = {}
      for (const project of PROJECTS) {
        const cut = cutOf(project, name)
        if (cut)
          cuts[name][project] = cut
      }
      if (!cuts[name].light)
        missing.push(name)
    }
  }
}

const body = BLOCKS.map((block, at) => `<section id="b${at}">
<h2>${escapeHtml(block.title)}</h2>
<p class="rule">${escapeHtml(block.rule)}</p>
${block.rows.map(([state, ...cases]) => `<div class="row">${state ? `<h3>${escapeHtml(state)}</h3>` : ''}
<div class="cells">${cases.map((name, column) => `<figure><figcaption><b>${escapeHtml(block.surfaces[column])}</b>${name ? ` <a href="index.html#${name}">${name}</a>` : ''}</figcaption>${name ? `<div class="cut" data-case="${name}"></div>` : '<div class="none">no case for this surface</div>'}</figure>`).join('')}</div></div>`).join('\n')}
<textarea data-note="${escapeHtml(block.title)}" placeholder="A note on this block"></textarea>
</section>`).join('\n')

const count = Object.keys(cuts).length
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visilant – the pattern sheet</title><style>
:root { --bg:#f4f6fa; --ink:#121826; --ink2:#3d4659; --ink3:#5b6478; --line:#dde2eb; --brand:#0b6a84; }
* { box-sizing:border-box; }
body { margin:0; font:15px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
header { position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid var(--line); padding:8px 20px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
header h1 { font-size:17px; margin:0; }
header nav { display:flex; gap:10px; flex-wrap:wrap; font-size:13px; }
.try ul { margin:8px 0 0; padding-left:20px; display:grid; gap:6px; font-size:14px; }
header select, header button { font:inherit; font-size:13px; padding:4px 10px; border-radius:6px; border:1px solid var(--line); background:#fff; }
header button { margin-left:auto; border-color:var(--brand); background:var(--brand); color:#fff; cursor:pointer; }
a { color:var(--brand); }
main { padding:10px 20px 80px; }
.intro, .rule { color:var(--ink2); max-width:980px; margin:6px 0; }
.bad { color:#b3261e; }
h2 { margin:34px 0 0; font-size:20px; }
h3 { margin:0 0 6px; font-size:14px; }
.row { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:10px 0; overflow-x:auto; }
.cells { display:flex; gap:16px; align-items:flex-start; }
figure { margin:0; flex:none; }
figcaption { font-size:12px; color:var(--ink3); margin-bottom:4px; }
figcaption b { color:var(--ink2); text-transform:uppercase; letter-spacing:.05em; font-size:11px; }
.cut { background-repeat:no-repeat; border-radius:8px; outline:1px solid var(--line); }
.none { width:220px; padding:18px 12px; border:1px dashed var(--line); border-radius:8px; color:var(--ink3); font-size:13px; }
textarea { width:100%; max-width:980px; min-height:44px; font:inherit; font-size:14px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; }
</style></head><body>
<header>
  <h1>The pattern sheet</h1>
  <nav>${BLOCKS.map((block, at) => `<a href="#b${at}">${escapeHtml(block.title)}</a>`).join('')}</nav>
  <select id="project">${PROJECTS.map(project => `<option>${project}</option>`).join('')}</select>
  <button id="copy" type="button">Copy the notes</button>
</header>
<main>
<p class="intro">Each row is one state of one block, each column a surface that draws it, ${count} pictures in all. Read along a row: the cells should say the same things in the same order. Each cell is cut out of the catalogue's picture of the case named over it, and the name opens the whole picture.</p>
<section class="try">
<h2>Links to try by hand</h2>
<p class="rule">The pictures cannot show the right-click menu. These are live links for the browser this page is open in, with its own Visilant: right-click each one. The first five should offer "Check this email link", the next two "Check this link", and the last two no Visilant item at all. "Site details in a new tab" on a mail link opens the check page with the address in it. A page opened from a file gets the items only if "Allow access to file URLs" is on for the extension.</p>
<ul>
<li><a href="mailto:ann@corp.test">mailto: one address</a></li>
<li><a href="mailto:ann@corp.test,bob@corp.test?cc=eve@c0rp.test&amp;bcc=pay@new-place.test&amp;subject=Invoice">mailto: four recipients, two at one domain and one a letter off</a></li>
<li><a href="mailto:refunds@mailinator.com">mailto: a throwaway mail service</a></li>
<li><a href="mailto:dev@mozmail.com">mailto: a mail forwarding service</a></li>
<li><a href="mailto:?subject=Hello">mailto: no address at all</a></li>
<li><a href="https://never-seen-before.example/">a link to a page</a></li>
<li><a href="https://paypal.com.a.b.c.verify.example/login">a link with a decoy name and five subdomain levels</a></li>
<li><a href="tel:+10000000000">tel: a phone number</a></li>
<li><a href="javascript:void 0">javascript: a script</a></li>
</ul>
</section>
${missing.length ? `<p class="intro bad">No picture yet for: ${missing.map(escapeHtml).join(', ')}. Run <code>just shots</code>.</p>` : ''}
${body}
</main>
<script>
const CUTS = ${JSON.stringify(cuts)}
const select = document.getElementById('project')
function draw() {
  for (const el of document.querySelectorAll('.cut')) {
    const cut = (CUTS[el.dataset.case] || {})[select.value]
    el.style.cssText = cut
      ? 'width:' + cut.width + 'px;height:' + cut.height + 'px;background-image:url(' + cut.src + ');background-position:-' + cut.x + 'px -' + cut.y + 'px;background-size:' + cut.sheet[0] + 'px ' + cut.sheet[1] + 'px'
      : ''
    // A tooltip opens on hover, which a phone does not have, so that column has no picture of one
    el.classList.toggle('none', !cut)
    el.textContent = cut ? '' : 'no picture in this column'
  }
}
select.addEventListener('change', draw)
draw()
const KEY = 'visilant-pattern-notes'
const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
for (const area of document.querySelectorAll('textarea')) {
  area.value = saved[area.dataset.note] || ''
  area.addEventListener('input', () => { saved[area.dataset.note] = area.value; localStorage.setItem(KEY, JSON.stringify(saved)) })
}
document.getElementById('copy').addEventListener('click', (event) => {
  const text = [...document.querySelectorAll('textarea')].filter(area => area.value.trim()).map(area => '[' + area.dataset.note + ']\\n' + area.value.trim()).join('\\n\\n')
  navigator.clipboard.writeText(text || 'No notes.')
  event.target.textContent = 'Copied'
  setTimeout(() => event.target.textContent = 'Copy the notes', 1500)
})
</script>
</body></html>
`

fs.writeFileSync(path.join(ROOT, 'patterns.html'), html)
process.stdout.write(`[patterns] ${count} pictures in ${BLOCKS.length} blocks: .tmp/shots/patterns.html${missing.length ? `, ${missing.length} missing (${missing.join(', ')})` : ''}\n`)
if (missing.length)
  process.exitCode = 1
