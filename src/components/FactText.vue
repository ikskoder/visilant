<script setup lang="ts">
import { computed } from 'vue'

/**
 * A fact's value, with the word after a number drawn as a word.
 *
 * Values are set in the monospace face so digits line up, and in it the unit
 * of "3 days" came out as a wide gap and a word in code type. The unit goes in
 * the text face here, held to its number by a no-break space so a narrow cell
 * never wraps "10" and "days" apart.
 */
const props = defineProps<{ text: string }>()

const UNIT = /(\d) (\p{L}+)/gu

const parts = computed(() => {
  const out: { text: string, unit?: boolean }[] = []
  let last = 0
  for (const match of props.text.matchAll(UNIT)) {
    const start = match.index! + 1
    out.push({ text: props.text.slice(last, start) })
    out.push({ text: `\u00A0${match[2]}`, unit: true })
    last = start + 1 + match[2].length
  }
  out.push({ text: props.text.slice(last) })
  return out.filter(part => part.text)
})
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <span v-if="part.unit" class="vz-fact__unit">{{ part.text }}</span><template v-else>
      {{ part.text }}
    </template>
  </template>
</template>
