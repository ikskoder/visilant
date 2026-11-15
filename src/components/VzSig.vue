<script setup lang="ts">
import type { ShieldMark } from './shield-icons'
import { computed } from 'vue'
import shieldMarkup from '../assets/icon.svg?raw'

/**
 * The signature on everything drawn over a web page: Visilant's shield, at the
 * start of the first row of the box. It says whose box this is. It proves
 * nothing, because a page can draw the same thing, which is why no decision
 * may ever rest on it.
 *
 * One icon, never two: where the row also has something to signal, the sign
 * is cut into the shield (`mark`) in the colour of what it signals, and where
 * it has not, the shield carries the logo's letter. The shield used to stand
 * beside a triangle or a flag of the same size, two pictures before the first
 * word. And never a row to itself: as the whole word on its own line it was
 * the first thing read on every surface and the least worth reading.
 */
const props = defineProps<{
  /** What the row signals. None draws the logo. */
  mark?: Exclude<ShieldMark, 'fail' | 'pass'>
  /** The warning is one to be on guard about, not one to stop for: the same mark in orange. */
  caution?: boolean
  /** The size of a title's icon, for a row whose words are a title. */
  large?: boolean
}>()

// No check and no cross: those are a verdict, and a verdict is a badge beside
// the address it is about, never the sign of the whole box
const TONES = { alert: 'danger', flag: 'danger', info: 'brand', unknown: 'neutral', pending: 'neutral' } as const
const tone = computed(() => !props.mark ? undefined : props.mark === 'alert' && props.caution ? 'caution' : TONES[props.mark])
</script>

<template>
  <!-- Read out as the name, since on screen it is a picture -->
  <span v-if="mark" class="vz-sig" :class="{ 'vz-sig--lg': large }" title="Visilant" :data-sign="mark" :data-tone="tone">
    <VzIcon :name="`shield-${mark}`" :large="large" label="Visilant" :class="`tone-${tone}`" />
  </span>
  <!-- eslint-disable-next-line vue/no-v-html -- our own asset, no user input -->
  <span v-else class="vz-sig" :class="{ 'vz-sig--lg': large }" role="img" aria-label="Visilant" title="Visilant" v-html="shieldMarkup" />
</template>
