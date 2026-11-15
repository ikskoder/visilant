<script setup lang="ts">
import type { FunctionalComponent } from 'vue'
import type { PieceTone } from '~/logic/piece-tones'
import { computed, h, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { tonesOnScreen } from '~/composables/useRedFlags'
import { ADDRESS_FRAMES_KEY, ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
import { ADDRESS_DOTS as DOTS } from '~/logic/domain-markers'
import { settings } from '~/logic/storage'

/**
 * An address, drawn as the evidence it is.
 *
 * Every label sits in a frame of its own, so the reader sees where one label
 * ends and the next begins: most people do not know a dot is a boundary, and a
 * frame is hard to miss. The labels of the registrable domain – the part one
 * party controls – get heavier frames on a neutral ground. That is what turns
 * `paypal.com.secure-login.test` from "PayPal" into "secure-login.test with a
 * decoy in front". The frames say who controls the name, never whether they can
 * be trusted. The reader can switch them off (`settings.addressFrames`), and
 * then the owner's labels go bold instead.
 *
 * Whatever the settings say, every character that has no business in a
 * hostname is marked: outside a to z, 0 to 9 and the hyphen in a host, outside
 * ASCII in an account name or a raw payload. Digits are drawn bold in a colour
 * of their own, since `paypa1` and `g00gle` are made of them.
 */
const props = withDefaults(defineProps<{
  text: string
  /**
   * What the text is. `host` gets frames, `email` is an account name, an `@`
   * and a framed host, `account` an account name on its own. `label` is a
   * piece of an address quoted in a sentence, one part of a name or an ending:
   * framed and marked like a host, with nobody asked who owns it, since it is
   * not an address. `raw` is text that
   * is not an address at all – a QR payload, a Wi-Fi password – and only has its
   * invisible and non-ASCII characters marked.
   */
  kind?: 'host' | 'email' | 'account' | 'label' | 'raw'
  /**
   * For a piece quoted from another address: how that address draws it, so
   * the piece looks the same in the sentence as it does above it. `name` is
   * the owner's own name, heavier and on a tint, `ending` what the name is
   * registered under, on the tint in grey, `free` a label in front of the
   * site, dashed. Without it a quoted piece is a plain label. `github.io`
   * named in the line under `someone.github.io` used to be drawn white, as
   * an address with no site in it, right under the same two labels in grey.
   */
  part?: 'name' | 'ending' | 'free'
  /** For a quoted piece again: the colour the address above draws it in. */
  tone?: PieceTone
  /**
   * Never coloured by findings, whatever lines are on screen. For an address
   * that is named, not checked: the familiar site in "May be imitating", the
   * site an address is made to look like, a row in a list of related
   * addresses. Such a name can be the very address some other block on screen
   * has lines about, and it would take that block's colours: one row of a
   * list in orange for something every row has, or the real site in the red
   * of its imitation.
   */
  plain?: boolean
  /** One of the address type sizes. Without it the address takes the size around it. */
  size?: 'xl' | 'l' | 'm' | 's'
  /** When set, wins over the case setting. */
  caseOverride?: 'lower' | 'upper'
  /**
   * Leave the letters exactly as they are.
   *
   * The case setting is about names an address is read by, where upper and lower
   * mean the same thing to the reader. This component is also handed text where
   * they do not: the raw output of a QR code, a Wi-Fi password, and the two
   * halves of an address mismatch, which are on screen precisely so the reader
   * can hold one against the other character by character. Changing the case of
   * those is not a display choice, it is changing the evidence – and for a
   * password it is changing the value.
   */
  preserveCase?: boolean
  /** Positions (in code points) of the characters a lookalike changed, underlined. */
  diff?: number[]
}>(), {
  kind: 'host',
})

const { t } = useI18n()
const lookupShape = inject(ADDRESS_SHAPE_KEY, askBackgroundShape)
const localFrames = inject(ADDRESS_FRAMES_KEY, undefined)

/**
 * Characters that are there but cannot be seen.
 *
 * Right-to-left overrides reverse the text after them, so `annexe\u202Efdp.exe`
 * reads as `annexeexe.pdf` on screen. Zero width characters split a name without
 * leaving a mark, so `paypa\u200Bl.com` looks like `paypal.com` and is not.
 * There is no glyph to style, so the name of the character is drawn beside it by
 * CSS. The character itself stays in the text, so a copy is still the real
 * address – but inside an inline block of no width, which isolates it: an
 * override there has nothing left to reorder, and a line separator nothing to
 * break.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Zl}\p{Zp}]/u
const PLAIN_HOST = /^[a-z0-9-]$/i
const DIGIT = /\d/
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

interface Run {
  text: string
  cls?: string
  title?: string
  cp?: string
  invisible?: boolean
  /** One of the characters a lookalike changed, for tests to find */
  diff?: boolean
}

interface Segment {
  runs: Run[]
  suffix: boolean
  /** The separator after this label, absent on the last one. */
  sep?: Run
  /** The colour of a finding about this label */
  tone?: PieceTone
}

interface Model {
  /** The whole text as one line of characters: an account name or a raw payload. */
  flat?: Run[]
  account?: Run[]
  ip?: Run[]
  ipTone?: PieceTone
  before?: Segment[]
  owner?: Segment[]
}

/**
 * Plain text with a place to break after each separator of an address part
 * the browser does not break after itself, `.` `_` `+`. A hyphen is one it
 * does, so it is left whole. A dot inside a username is no place to break for the
 * browser, so `yourbank.billing` broke as `yourbank.bil` and `ling`, a
 * piece nobody reads. With these the line breaks after a separator, and a run
 * of letters is cut only when it alone is longer than the line, which is
 * what `overflow-wrap: anywhere` falls back to. A `<wbr>` is not copied
 * with the text, as a zero-width space would be.
 */
function breakable(text: string) {
  return text.split(/(?<=[._+])/).flatMap(part => /[._+]$/.test(part) ? [part, h('wbr')] : [part])
}

/** A run of characters: plain text as a text node, a marked one in its span. */
const Runs: FunctionalComponent<{ runs: Run[] }> = ({ runs }) => runs.flatMap((run) => {
  if (!run.cls)
    return breakable(run.text)
  const marked = h('span', { 'class': run.cls, 'title': run.title, 'data-cp': run.cp, 'data-diff': run.diff ? '' : undefined }, run.invisible ? [h('span', { class: 'vz-ch__raw' }, run.text)] : run.text)
  // A separator marked for a reason of its own, a digit beside it or a
  // difference, is still a place to break
  return /[._+]$/.test(run.text) ? [marked, h('wbr')] : [marked]
})
Runs.props = ['runs']

function codePointName(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

const framesOn = computed(() => localFrames?.value ?? settings.value.addressFrames !== false)

function transform(char: string): string {
  if (props.preserveCase || props.kind === 'raw')
    return char
  // One setting for the whole address. The username had a second one of its
  // own, with a button beside it, and two case buttons over one address were
  // one too many to look at
  const mode = props.caseOverride ?? settings.value.domainCase
  return mode === 'upper' ? char.toUpperCase() : char.toLowerCase()
}

/**
 * One label's characters as runs: plain characters merged, every marked one on
 * its own. `start` is the code point position of the first one, for `diff`.
 *
 * `encoded` is a label in its `xn--` form, whose digits are part of the
 * encoding rather than digits anybody wrote. Coloured, they read as a warning
 * about characters that are not there.
 */
function runsOf(chars: string[], start: number, mode: 'host' | 'account' | 'raw', encoded = false): Run[] {
  const runs: Run[] = []
  const diff = props.diff ?? []
  const translate = t.value

  chars.forEach((char, offset) => {
    const classes: string[] = []
    let title: string | undefined
    if (INVISIBLE.test(char)) {
      const cp = codePointName(char)
      runs.push({ text: char, cls: 'vz-ch vz-ch--invisible', cp, title: translate('addressCharInvisible').replace('$1', cp), invisible: true })
      return
    }
    // An invisible character never gets here, and needs no underline: it is
    // already drawn by name
    const changed = diff.includes(start + offset)
    if (changed)
      classes.push('vz-ch--diff')
    // Judged on the character as written, before the case setting touches it
    const odd = mode === 'host' ? !PLAIN_HOST.test(char) : (char.codePointAt(0) ?? 0) > 0x7F
    if (odd) {
      classes.push('vz-ch--foreign')
      title = translate(mode === 'host' ? 'addressCharNotPlain' : 'addressCharNotAscii').replace('$1', codePointName(char))
    }
    // A changed digit carries only the mark for the change: red and the digit
    // colour on one character read as two different warnings
    else if (mode !== 'raw' && !changed && !encoded && DIGIT.test(char)) {
      classes.push('vz-ch--digit')
    }

    const shown = transform(char)
    if (classes.length) {
      runs.push({ text: shown, cls: `vz-ch ${classes.join(' ')}`, title, diff: changed || undefined })
      return
    }
    const last = runs.at(-1)
    if (last && !last.cls)
      last.text += shown
    else
      runs.push({ text: shown })
  })
  return runs
}

/** The host in the text, which is what findings are about: the part after the @ of an email address. */
const drawnHost = computed(() => {
  const text = props.text ?? ''
  if (props.kind === 'email')
    return text.slice(text.lastIndexOf('@') + 1)
  return props.kind === 'host' ? text : ''
})
// The labels a finding is about, in the finding's colour, for as long as the
// lines about this address are on screen. Nothing is handed in: the lines say
// what they found, and every drawing of the address reads it, see
// `useFindingsOnScreen`
const tones = computed(() => props.plain || props.part ? new Map<number, PieceTone>() : tonesOnScreen(drawnHost.value))

const model = computed<Model>(() => {
  const text = props.text ?? ''
  if (props.kind === 'raw' || props.kind === 'account')
    return { flat: runsOf(Array.from(text), 0, props.kind) }

  let host = text
  let account: Run[] | undefined
  let position = 0
  if (props.kind === 'email') {
    const at = text.lastIndexOf('@')
    if (at > 0) {
      const name = Array.from(text.slice(0, at))
      account = runsOf(name, 0, 'account')
      host = text.slice(at + 1)
      position = name.length + 1
    }
  }

  // An IP address is one frame: its dots are not boundaries between owners
  if (IPV4.test(host) || host.includes(':'))
    return { account, ip: runsOf(Array.from(host), position, 'raw'), ipTone: props.tone ?? tones.value.get(0) }

  // A dot at the very end reaches the same site, and is drawn outside the frames
  let trailing: Run | undefined
  const chars = Array.from(host)
  if (chars.length > 1 && DOTS.test(chars.at(-1)!)) {
    const dot = chars.pop()!
    trailing = {
      text: dot,
      cls: dot === '.' ? 'vz-dot vz-dot--trailing' : 'vz-dot vz-dot--trailing vz-ch--foreign',
      title: t.value('addressTrailingDot'),
    }
  }

  const labels: string[][] = [[]]
  const seps: string[] = []
  for (const char of chars) {
    if (DOTS.test(char)) {
      seps.push(char)
      labels.push([])
    }
    else {
      labels.at(-1)!.push(char)
    }
  }

  const quoted = props.part === 'name' || props.part === 'ending'
  const shape = host && props.kind !== 'label' && !props.part ? lookupShape(chars.join('')) : undefined
  const count = labels.length
  // A quoted piece is all one thing, whatever it is
  const owned = quoted ? count : Math.min(shape?.ownerLabels ?? 0, count)
  const suffix = quoted ? (props.part === 'ending' ? count : 0) : Math.min(shape?.suffixLabels ?? 0, owned)

  const segments: Segment[] = labels.map((label, index) => {
    const runs = runsOf(label, position, 'host', label.slice(0, 4).join('').toLowerCase() === 'xn--')
    position += label.length
    const sepChar = seps[index]
    let sep: Run | undefined
    if (sepChar !== undefined) {
      sep = sepChar === '.'
        ? { text: '.', cls: 'vz-dot' }
        : { text: sepChar, cls: 'vz-dot vz-ch--foreign', title: t.value('addressNotPlainDot').replace('$1', codePointName(sepChar)) }
      position += 1
    }
    return { runs, sep, suffix: owned > 0 && index >= count - suffix, tone: props.tone ?? tones.value.get(index) }
  })

  // The dot at the very end is drawn after the last label, in that label's
  // unbreakable unit: a unit of its own could start a line alone, with
  // nothing on the line above to say the address went on
  if (trailing)
    segments[count - 1].sep = trailing

  return {
    account,
    before: segments.slice(0, count - owned),
    owner: segments.slice(count - owned),
  }
})

/**
 * Where an address too long for one line goes on below.
 *
 * An address is kept in one piece wherever it fits (see `.vz-addr--box`): in a
 * sentence it moves to the next line whole rather than being cut at a dot,
 * because half an address at the end of a line reads as the address. One that
 * is longer than a whole line has to break, and each line that goes on gets a
 * mark after it, so `paypal.com.a.b.c.verify.` is not taken for the end.
 *
 * Only the browser knows where the lines broke, so the pieces are measured
 * after layout, and again whenever the box changes size. Each piece that can
 * end a line carries `data-piece`, in the order of the template.
 */
const root = ref<HTMLElement | null>(null)
const goesOn = ref<ReadonlySet<number>>(new Set())
let observer: ResizeObserver | null = null

function measure() {
  const pieces = root.value ? [...root.value.querySelectorAll<HTMLElement>('[data-piece]')] : []
  const found = new Set<number>()
  let above: number | null = null
  pieces.forEach((piece, index) => {
    const { top } = piece.getBoundingClientRect()
    // A tolerance: subpixel layout puts boxes on one line fractions apart
    if (above !== null && top > above + 2)
      found.add(index - 1)
    above = top
  })
  // Replaced only when it differs, or every measurement would draw again
  if (found.size !== goesOn.value.size || [...found].some(index => !goesOn.value.has(index)))
    goesOn.value = found
  measureInside()
}

/**
 * Where one frame breaks over lines: a username or a label longer than a
 * whole line. Between pieces the mark goes after the piece that ends a line,
 * and inside a frame there is no piece to hang it on, so each line of the
 * frame that goes on gets a mark laid over the address, just past the frame's
 * right edge, at that line's height. Read from the line boxes of the frame's
 * text, which a layout without boxes (a test page) does not have.
 */
const insideMarks = ref<{ x: number, y: number }[]>([])

function measureInside() {
  const box = root.value
  if (!box || typeof document.createRange !== 'function')
    return
  const origin = box.getBoundingClientRect()
  const marks: { x: number, y: number }[] = []
  for (const frame of box.querySelectorAll<HTMLElement>('.vz-lbl, .vz-addr__acct')) {
    const range = document.createRange()
    range.selectNodeContents(frame)
    const rects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : []
    const lines: { top: number, bottom: number }[] = []
    for (const rect of rects) {
      if (!rect.width && !rect.height)
        continue
      const line = lines.find(known => Math.abs(known.top - rect.top) <= 2)
      if (line)
        line.bottom = Math.max(line.bottom, rect.bottom)
      else
        lines.push({ top: rect.top, bottom: rect.bottom })
    }
    if (lines.length < 2)
      continue
    const right = frame.getBoundingClientRect().right - origin.left
    lines.sort((a, b) => a.top - b.top)
    for (const line of lines.slice(0, -1))
      marks.push({ x: Math.round(right), y: Math.round((line.top + line.bottom) / 2 - origin.top) })
  }
  const same = marks.length === insideMarks.value.length
    && marks.every((mark, index) => mark.x === insideMarks.value[index].x && mark.y === insideMarks.value[index].y)
  if (!same)
    insideMarks.value = marks
}

let pending = 0
function measureSoon() {
  if (pending)
    return
  pending = requestAnimationFrame(() => {
    pending = 0
    measure()
  })
}

watch(root, (element) => {
  observer?.disconnect()
  observer = null
  // Absent where there is no layout, and there nothing wraps either
  if (!element || typeof ResizeObserver === 'undefined')
    return
  // On the next frame, not inside the callback: a first wrap adds the room
  // for the mark, which changes the size of the very box being watched, and a
  // size changed inside its own callback is reported by the browser as an
  // error on the window. In a web page that window is the page's, error
  // trackers and all.
  observer = new ResizeObserver(measureSoon)
  observer.observe(element)
}, { immediate: true })

// The room a mark takes moves the breaks inside the box without changing its
// size, so the marks are measured again once they are drawn
watch([insideMarks, goesOn], () => measureSoon())

// What moves the line breaks without changing the size of the box: other
// text, frames switched off, and a font that arrives after the first layout
watch([model, framesOn], () => nextTick(measure))

onMounted(() => {
  document.fonts?.ready.then(() => {
    if (root.value)
      measure()
  }).catch(() => {})
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (pending)
    cancelAnimationFrame(pending)
})

/** The place of a piece among those measured: the @ of an email address comes first. */
const firstPiece = computed(() => model.value.account ? 1 : 0)
</script>

<template>
  <!--
    Held to one direction on purpose. A bidi control inside the text is shown,
    not obeyed, and the isolation keeps whatever is left from reordering the
    ordinary words around it on the page.
  -->
  <span
    ref="root"
    class="secure-domain-display vz-addr"
    :class="[size ? `vz-addr--${size}` : '', { 'vz-addr--noframes': !framesOn, 'vz-addr--box': !model.flat || kind === 'account', 'vz-addr--wrapped': goesOn.size > 0 || insideMarks.length > 0, 'vz-addr--owned': model.owner?.length, 'vz-addr--free': part === 'free' }]"
    dir="ltr"
  >
    <!-- The default slot is what goes after the address, a copy button. It is
         drawn inside the last label's unbreakable unit, so it never falls to a
         line of its own and never ends up far from where the address ends. -->
    <!-- A username on its own, in the frame it has inside an address -->
    <template v-if="model.flat && kind === 'account'">
      <span class="vz-addr__acct"><Runs :runs="model.flat" /></span><slot />
    </template>
    <template v-else-if="model.flat">
      <Runs :runs="model.flat" /><slot />
    </template>
    <template v-else>
      <template v-if="model.account">
        <span class="vz-addr__acct"><Runs :runs="model.account" /></span><span class="vz-addr__at" :class="{ 'vz-goes-on': goesOn.has(0) }" data-piece>@</span><wbr>
      </template>
      <!-- The domain apart from the @, so a surface can mark the domain alone -->
      <span class="vz-addr__domain">
        <span v-if="model.ip" class="vz-seg" data-piece><span class="vz-lbl vz-lbl--ip" :class="model.ipTone ? `vz-lbl--${model.ipTone}` : ''" :data-tone="model.ipTone"><Runs :runs="model.ip" /></span><slot /></span>
        <template v-else>
          <!-- A label and the dot after it never part, so no line starts with a dot.
             The dot that leads into the owner's labels stays outside them. -->
          <template v-for="(segment, s) in model.before" :key="`b${s}`">
            <span class="vz-seg" :class="{ 'vz-goes-on': goesOn.has(firstPiece + s) }" data-piece><span class="vz-lbl" :class="segment.tone ? `vz-lbl--${segment.tone}` : ''" :data-tone="segment.tone"><Runs :runs="segment.runs" /></span><span v-if="segment.sep" :class="segment.sep.cls" :title="segment.sep.title">{{ segment.sep.text }}</span><slot v-if="!model.owner?.length && s === model.before!.length - 1" /></span><wbr>
          </template>
          <span v-if="model.owner?.length" class="vz-own" data-owner>
            <template v-for="(segment, s) in model.owner" :key="`o${s}`">
              <span class="vz-seg" :class="{ 'vz-goes-on': goesOn.has(firstPiece + (model.before?.length ?? 0) + s) }" data-piece><span class="vz-lbl" :class="[{ 'vz-lbl--sfx': segment.suffix }, segment.tone ? `vz-lbl--${segment.tone}` : '']" :data-tone="segment.tone"><Runs :runs="segment.runs" /></span><span v-if="segment.sep" :class="segment.sep.cls" :title="segment.sep.title">{{ segment.sep.text }}</span><slot v-if="s === model.owner.length - 1" /></span><wbr v-if="segment.sep && s < model.owner.length - 1">
            </template>
          </span>
        </template>
      </span>
    </template>
    <span v-for="(mark, m) in insideMarks" :key="`in${m}`" class="vz-goes-on-inside" :style="{ left: `${mark.x}px`, top: `${mark.y}px` }" aria-hidden="true" />
  </span>
</template>
