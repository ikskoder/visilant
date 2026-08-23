<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { settings } from '~/logic/storage'

const props = withDefaults(defineProps<{
  text: string
  forceHighlight?: boolean
  dangerOnly?: boolean
  // Per-instance overrides – when set, they win over the global settings
  highlightOverride?: boolean
  caseOverride?: 'lower' | 'upper'
  /**
   * Show where a wrapped address continues onto the next line. Costs a layout
   * measurement, so it is opt-in and belongs on the large displays that actually
   * wrap, not on every inline mention of a domain.
   */
  markWraps?: boolean
  /**
   * Leave the letters exactly as they are.
   *
   * The case setting is about domain names, where upper and lower mean the same
   * thing. This component is also handed things where they do not: the name half
   * of an email address, a username, the raw text out of a QR code, a Wi-Fi
   * password. Lower-casing those is not a display choice, it is changing the
   * evidence - and for a password it is changing the value.
   */
  preserveCase?: boolean
}>(), {
  // Absent boolean props default to false in Vue. Keeping undefined lets the
  // ?? fallback to global settings still work when the prop is not passed
  highlightOverride: undefined,
})
const RE_ALPHA = /[a-z]/i
const RE_DIGIT = /\d/
const RE_SPECIAL = /[.\-_]/

/**
 * Characters that are there but cannot be seen.
 *
 * Right-to-left overrides reverse the text after them, so `annexe\u202Efdp.exe`
 * reads as `annexeexe.pdf` on screen while being something else entirely. Zero
 * width characters split a name without leaving a mark, so `paypa\u200Bl.com`
 * looks like `paypal.com` and is not. A CSS class cannot make either of them
 * visible - there is no glyph to style - so they are replaced by a token that
 * says which character is sitting there.
 */
const INVISIBLE = new Set([
  0x00AD, // soft hyphen
  0x061C, // arabic letter mark
  0x180E, // mongolian vowel separator
  0x200B, // zero width space
  0x200C, // zero width non-joiner
  0x200D, // zero width joiner
  0x200E, // left-to-right mark
  0x200F, // right-to-left mark
  0x2028, // line separator
  0x2029, // paragraph separator
  0x202A, // left-to-right embedding
  0x202B, // right-to-left embedding
  0x202C, // pop directional formatting
  0x202D, // left-to-right override
  0x202E, // right-to-left override
  0x2060, // word joiner
  0x2066, // left-to-right isolate
  0x2067, // right-to-left isolate
  0x2068, // first strong isolate
  0x2069, // pop directional isolate
  0xFEFF, // zero width no-break space
])

/** The same red as an unexpected letter: it is the same kind of surprise. */
const INVISIBLE_CLASS = 'text-red-600 dark:text-red-400 font-bold bg-red-100 dark:bg-red-900/30 rounded px-0.5 mx-0.5'

function invisibleToken(codePoint: number): string {
  return `<U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}>`
}

const segments = computed(() => {
  const text = props.text
  if (!text)
    return []

  // Helper to get class for a character
  function getClass(char: string): string {
    const highlightOn = props.highlightOverride ?? (props.forceHighlight || settings.value.domainHighlighting)
    if (!highlightOn)
      return ''
    // Latin letters are left alone deliberately. Colouring them green reads as a
    // verdict – "this part is fine" – when all it means is "this is the ordinary
    // case". Highlighting exists to make the unexpected characters stand out, and
    // painting the majority of an address in a reassuring colour works against
    // exactly that.
    if (RE_ALPHA.test(char))
      return ''
    if (RE_DIGIT.test(char))
      return 'text-blue-600 dark:text-blue-400 font-bold'
    if (RE_SPECIAL.test(char))
      return props.dangerOnly ? '' : (props.forceHighlight ? 'text-gray-300 font-bold' : 'text-gray-900 dark:text-gray-100 font-bold')
    // Other characters (Cyrillic, etc.)
    return 'text-red-600 dark:text-red-400 font-bold bg-red-100 dark:bg-red-900/30 rounded px-0.5 mx-0.5'
  }

  // Helper to apply case transformation
  function transform(char: string): string {
    if (props.preserveCase)
      return char
    const mode = props.caseOverride ?? settings.value.domainCase
    if (mode === 'upper')
      return char.toUpperCase()
    if (mode === 'lower')
      return char.toLowerCase()
    return char
  }

  const result: { text: string, class: string }[] = []
  let currentClass: string | null = null
  let currentText = ''

  const push = () => {
    if (currentText)
      result.push({ text: currentText, class: currentClass ?? '' })
  }

  // Walked by code point rather than by code unit, so a character outside the
  // basic plane is one character here rather than two halves of one
  for (const char of Array.from(text)) {
    const codePoint = char.codePointAt(0) ?? 0
    const shown = INVISIBLE.has(codePoint) ? invisibleToken(codePoint) : transform(char)
    const charClass = INVISIBLE.has(codePoint) ? INVISIBLE_CLASS : getClass(char)

    if (charClass === currentClass) {
      currentText += shown
    }
    else {
      push()
      currentClass = charClass
      currentText = shown
    }
  }

  push()
  return result
})

// A hostname contains no spaces, so a browser has nowhere to wrap it and ends up
// splitting mid-label. Marking a break opportunity after every dot lets long
// names wrap at label boundaries instead. <wbr> is an element rather than a
// character, so copying the domain still yields exactly what is on screen.
const parts = computed(() => {
  const result: { text: string, class: string, breakAfter: boolean }[] = []

  for (const segment of segments.value) {
    // Where the continuation marker is wanted, every character gets its own span
    // so that a line break always falls between two of them. Grouping instead
    // would hide any break landing inside a run, which is most of them – and how
    // coarse the runs are happens to depend on whether highlighting is on, so the
    // marker would come and go with an unrelated setting.
    //
    // Adjacent inline boxes introduce no wrap opportunities of their own, and
    // ligatures are already disabled on this face, so the text lays out the same
    // either way.
    if (props.markWraps) {
      for (const char of segment.text)
        result.push({ text: char, class: segment.class, breakAfter: char === '.' })
      continue
    }

    let buffer = ''

    for (const char of segment.text) {
      buffer += char
      if (char === '.') {
        result.push({ text: buffer, class: segment.class, breakAfter: true })
        buffer = ''
      }
    }

    if (buffer)
      result.push({ text: buffer, class: segment.class, breakAfter: false })
  }

  return result
})

// Which parts a line actually ended on. Only the browser knows where the wrap
// landed, so this is measured after layout rather than derived from the text.
const root = ref<HTMLElement | null>(null)
const endsLine = ref<Set<number>>(new Set())
let observer: ResizeObserver | null = null

function measureWraps() {
  const element = root.value
  if (!element)
    return

  const spans = [...element.querySelectorAll<HTMLElement>(':scope > span')]
  const found = new Set<number>()
  let previousTop: number | null = null

  for (let index = 0; index < spans.length; index++) {
    const { top } = spans[index].getBoundingClientRect()
    // A tolerance, because subpixel layout puts same-line boxes fractions apart
    if (previousTop !== null && top > previousTop + 1)
      found.add(index - 1)
    previousTop = top
  }

  // Replacing the set unconditionally would re-render on every measurement
  if (found.size !== endsLine.value.size || [...found].some(index => !endsLine.value.has(index)))
    endsLine.value = found
}

watch([root, () => props.markWraps], ([element, enabled]) => {
  observer?.disconnect()
  observer = null
  endsLine.value = new Set()

  if (!element || !enabled)
    return

  // Fires on font-size changes and container resizes alike, both of which move
  // where the address breaks. Absent in environments without layout, where there
  // is nothing to measure anyway.
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => measureWraps())
    observer.observe(element)
  }

  nextTick(measureWraps)
}, { immediate: true })

watch(parts, () => {
  if (props.markWraps)
    nextTick(measureWraps)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <!--
    Held to one direction on purpose. A bidi control inside the text is shown as
    a token rather than obeyed, and the isolation keeps whatever is left from
    reordering the ordinary words around it on the page.
  -->
  <span ref="root" class="secure-domain-display" dir="ltr">
    <template v-for="(part, index) in parts" :key="index"><span :class="[part.class, { 'wraps-here': endsLine.has(index) }]">{{ part.text }}</span><wbr v-if="part.breakAfter"></template>
  </span>
</template>

<style scoped>
.secure-domain-display {
  unicode-bidi: isolate;
}

/*
 * The continuation marker is absolutely positioned on purpose: laid out in flow
 * it would take up space, change where the line breaks, and move the very wrap
 * it is marking.
 */
.wraps-here {
  position: relative;
}

.wraps-here::after {
  content: '↩';
  position: absolute;
  margin-left: 0.1em;
  font-size: 0.95em;
  line-height: 1;
  letter-spacing: normal;
  opacity: 0.55;
}
</style>
