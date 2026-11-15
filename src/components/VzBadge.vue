<script setup lang="ts">
import type { IconName } from './VzIcon.vue'

/**
 * A verdict or a state, said with a shape, a word and a colour together – never
 * the colour alone. One per address. A verdict carries the shield, a count of
 * red flags the flag, and anything else the sign of its tone. `caution` is
 * for what stands where a verdict would and is not one: a short link, a
 * throwaway mail service.
 */
defineProps<{
  tone: 'safe' | 'danger' | 'caution' | 'neutral' | 'brand'
  icon?: IconName
}>()
</script>

<template>
  <span class="vz-badge" :class="`vz-badge--${tone}`" :data-tone="tone">
    <VzIcon v-if="icon" :name="icon" />
    <slot />
  </span>
</template>
