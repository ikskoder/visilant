<script setup lang="ts">
import type { IconName } from './VzIcon.vue'

/**
 * A verdict or a state, said with a shape, a word and a colour together – never
 * the colour alone. One per address. The tone decides the colours, the icon is
 * the tone's own unless the meaning has a better one (`link` for a short link).
 */
defineProps<{
  tone: 'safe' | 'danger' | 'neutral' | 'brand'
  icon?: IconName
}>()
</script>

<template>
  <span class="vz-badge" :class="`vz-badge--${tone}`" :data-tone="tone">
    <VzIcon v-if="icon" :name="icon" />
    <slot />
  </span>
</template>
