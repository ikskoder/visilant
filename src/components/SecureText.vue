<script setup lang="ts">
import type { FunctionalComponent } from 'vue'
import { computed, h, inject } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { ADDRESS_FRAMES_KEY, ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
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
   * and a framed host, `account` an account name on its own. `raw` is text that
   * is not an address at all – a QR payload, a Wi-Fi password – and only has its
   * invisible and non-ASCII characters marked.
   */
  kind?: 'host' | 'email' | 'account' | 'raw'
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
/** The four dots IDNA treats as a label separator. */
const DOTS = /[.。．｡]/
const PLAIN_HOST = /^[a-z0-9-]$/i
const DIGIT = /\d/
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

interface Run {
  text: string
  cls?: string
  title?: string
  cp?: string
  invisible?: boolean
}

interface Segment {
  runs: Run[]
  suffix: boolean
  /** The separator after this label, absent on the last one. */
  sep?: Run
}

interface Model {
  /** The whole text as one line of characters: an account name or a raw payload. */
  flat?: Run[]
  account?: Run[]
  ip?: Run[]
  before?: Segment[]
  owner?: Segment[]
  trailing?: Run
}

/** A run of characters: plain text as a text node, a marked one in its span. */
const Runs: FunctionalComponent<{ runs: Run[] }> = ({ runs }) => runs.map((run) => {
  if (!run.cls)
    return run.text
  return h('span', { 'class': run.cls, 'title': run.title, 'data-cp': run.cp }, run.invisible ? [h('span', { class: 'vz-ch__raw' }, run.text)] : run.text)
})
Runs.props = ['runs']

function codePointName(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

const framesOn = computed(() => localFrames?.value ?? settings.value.addressFrames !== false)

function transform(char: string, account: boolean): string {
  if (props.preserveCase || props.kind === 'raw')
    return char
  const mode = props.caseOverride ?? (account ? settings.value.accountNameCase : settings.value.domainCase)
  if (mode === 'upper')
    return char.toUpperCase()
  if (mode === 'lower')
    return char.toLowerCase()
  // `as-typed`, which only the account name setting has
  return char
}

/**
 * One label's characters as runs: plain characters merged, every marked one on
 * its own. `start` is the code point position of the first one, for `diff`.
 */
function runsOf(chars: string[], start: number, mode: 'host' | 'account' | 'raw'): Run[] {
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
    if (diff.includes(start + offset))
      classes.push('vz-ch--diff')
    // Judged on the character as written, before the case setting touches it
    const odd = mode === 'host' ? !PLAIN_HOST.test(char) : (char.codePointAt(0) ?? 0) > 0x7F
    if (odd) {
      classes.push('vz-ch--foreign')
      title = translate(mode === 'host' ? 'addressCharNotPlain' : 'addressCharNotAscii').replace('$1', codePointName(char))
    }
    else if (mode !== 'raw' && DIGIT.test(char)) {
      classes.push('vz-ch--digit')
    }

    const shown = transform(char, mode === 'account')
    if (classes.length) {
      runs.push({ text: shown, cls: `vz-ch ${classes.join(' ')}`, title })
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
    return { account, ip: runsOf(Array.from(host), position, 'raw') }

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

  const shape = host ? lookupShape(chars.join('')) : undefined
  const count = labels.length
  const owned = Math.min(shape?.ownerLabels ?? 0, count)
  const suffix = Math.min(shape?.suffixLabels ?? 0, owned)

  const segments: Segment[] = labels.map((label, index) => {
    const runs = runsOf(label, position, 'host')
    position += label.length
    const sepChar = seps[index]
    let sep: Run | undefined
    if (sepChar !== undefined) {
      sep = sepChar === '.'
        ? { text: '.', cls: 'vz-dot' }
        : { text: sepChar, cls: 'vz-dot vz-ch--foreign', title: t.value('addressNotPlainDot').replace('$1', codePointName(sepChar)) }
      position += 1
    }
    return { runs, sep, suffix: owned > 0 && index >= count - suffix }
  })

  return {
    account,
    before: segments.slice(0, count - owned),
    owner: segments.slice(count - owned),
    trailing,
  }
})
</script>

<template>
  <!--
    Held to one direction on purpose. A bidi control inside the text is shown,
    not obeyed, and the isolation keeps whatever is left from reordering the
    ordinary words around it on the page.
  -->
  <span
    class="secure-domain-display vz-addr"
    :class="[size ? `vz-addr--${size}` : '', { 'vz-addr--noframes': !framesOn }]"
    dir="ltr"
  >
    <template v-if="model.flat">
      <Runs :runs="model.flat" />
    </template>
    <template v-else>
      <template v-if="model.account">
        <span class="vz-addr__acct"><Runs :runs="model.account" /></span><span class="vz-addr__at">@</span><wbr>
      </template>
      <span v-if="model.ip" class="vz-lbl vz-lbl--ip"><Runs :runs="model.ip" /></span>
      <template v-else>
        <!-- A label and the dot after it never part, so no line starts with a dot.
             The dot that leads into the owner's labels stays outside them. -->
        <template v-for="(segment, s) in model.before" :key="`b${s}`">
          <span class="vz-seg"><span class="vz-lbl"><Runs :runs="segment.runs" /></span><span v-if="segment.sep" :class="segment.sep.cls" :title="segment.sep.title">{{ segment.sep.text }}</span></span><wbr>
        </template>
        <span v-if="model.owner?.length" class="vz-own" data-owner>
          <template v-for="(segment, s) in model.owner" :key="`o${s}`">
            <span class="vz-seg"><span class="vz-lbl" :class="{ 'vz-lbl--sfx': segment.suffix }"><Runs :runs="segment.runs" /></span><span v-if="segment.sep" :class="segment.sep.cls" :title="segment.sep.title">{{ segment.sep.text }}</span></span><wbr v-if="segment.sep">
          </template>
        </span>
        <span v-if="model.trailing" :class="model.trailing.cls" :title="model.trailing.title">{{ model.trailing.text }}</span>
      </template>
    </template>
  </span>
</template>
