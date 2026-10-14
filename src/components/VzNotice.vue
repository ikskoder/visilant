<script setup lang="ts">
import type { IconName } from './VzIcon.vue'

/**
 * One sentence about what looks wrong, or what is worth knowing, with the
 * tone's icon to its left. The words stay ink: small coloured text is what the
 * design system exists to get rid of. `bare` drops the box where space is tight.
 */
const props = defineProps<{
  tone: 'danger' | 'neutral' | 'info'
  icon?: IconName
  bare?: boolean
}>()

const DEFAULT_ICONS = { danger: 'alert', neutral: 'info', info: 'info' } as const
</script>

<template>
  <div class="vz-notice" :class="[`vz-notice--${props.tone}`, { 'vz-notice--bare': props.bare }]" :data-tone="props.tone">
    <VzIcon :name="props.icon ?? DEFAULT_ICONS[props.tone]" :class="props.bare ? `tone-${props.tone === 'info' ? 'brand' : props.tone}` : ''" />
    <div class="vz-notice__text">
      <slot />
    </div>
  </div>
</template>
