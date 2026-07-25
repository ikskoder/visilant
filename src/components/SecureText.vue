<script setup lang="ts">
import { computed } from 'vue'
import { settings } from '~/logic/storage'

const props = withDefaults(defineProps<{
  text: string
  forceHighlight?: boolean
  dangerOnly?: boolean
  // Per-instance overrides — when set, they win over the global settings
  highlightOverride?: boolean
  caseOverride?: 'lower' | 'upper'
}>(), {
  // Absent boolean props default to false in Vue; keep undefined so the
  // ?? fallback to global settings still works when the prop is not passed
  highlightOverride: undefined,
})
const RE_ALPHA = /[a-z]/i
const RE_DIGIT = /\d/
const RE_SPECIAL = /[.\-_]/

const segments = computed(() => {
  const text = props.text
  if (!text)
    return []

  // Helper to get class for a character
  function getClass(char: string): string {
    const highlightOn = props.highlightOverride ?? (props.forceHighlight || settings.value.domainHighlighting)
    if (!highlightOn)
      return ''
    if (RE_ALPHA.test(char))
      return props.dangerOnly ? '' : 'text-green-600 dark:text-green-400 font-bold'
    if (RE_DIGIT.test(char))
      return 'text-blue-600 dark:text-blue-400 font-bold'
    if (RE_SPECIAL.test(char))
      return props.dangerOnly ? '' : (props.forceHighlight ? 'text-gray-300 font-bold' : 'text-gray-900 dark:text-gray-100 font-bold')
    // Other characters (Cyrillic, etc.)
    return 'text-red-600 dark:text-red-400 font-bold bg-red-100 dark:bg-red-900/30 rounded px-0.5 mx-0.5'
  }

  // Helper to apply case transformation
  function transform(char: string): string {
    const mode = props.caseOverride ?? settings.value.domainCase
    if (mode === 'upper')
      return char.toUpperCase()
    if (mode === 'lower')
      return char.toLowerCase()
    return char
  }

  const result: { text: string, class: string }[] = []
  let currentClass = getClass(text[0])
  let currentText = transform(text[0])

  for (let i = 1; i < text.length; i++) {
    const char = text[i]
    const charClass = getClass(char)
    const transformedChar = transform(char)
    if (charClass === currentClass) {
      currentText += transformedChar
    }
    else {
      result.push({ text: currentText, class: currentClass })
      currentClass = charClass
      currentText = transformedChar
    }
  }
  // Push the last segment
  result.push({ text: currentText, class: currentClass })
  return result
})
</script>

<template>
  <span class="secure-domain-display">
    <span
      v-for="(segment, index) in segments"
      :key="index"
      :class="segment.class"
    >{{ segment.text }}</span>
  </span>
</template>
