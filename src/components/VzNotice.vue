<script setup lang="ts">
import type { IconName } from './VzIcon.vue'

/**
 * One sentence about what looks wrong, or what is worth knowing, with the
 * tone's icon to its left. The words stay ink: small coloured text is what the
 * design system exists to get rid of.
 *
 * No box. A line about an address is its sign and its words on every surface:
 * it used to be boxed on a tinted ground in the check panel and the popup and
 * bare in the tooltip and the dialogs, so one red flag was a red block here
 * and a line there. `boxed` is for the few blocks that are not a line about
 * an address: an error over the settings page, an explanation with a heading
 * of its own. A red or orange one is never boxed outside the settings page,
 * and notice-tones.test.ts fails on one that is.
 *
 * Two warm tones, and they are not steps of one scale. `danger` is red: a red
 * flag, a failed verdict, an error, something that cannot be undone. It always
 * names its icon, since those are four different signs. `caution` is orange:
 * a finding that is not a reason to stop on its own, with one sign of its own,
 * the shield with an exclamation mark.
 */
const props = defineProps<{
  tone: 'danger' | 'caution' | 'neutral' | 'info'
  icon?: IconName
  boxed?: boolean
}>()

const DEFAULT_ICONS = { danger: 'alert', caution: 'shield-alert', neutral: 'info', info: 'info' } as const
</script>

<template>
  <div class="vz-notice" :class="[`vz-notice--${props.tone}`, { 'vz-notice--bare': !props.boxed }]" :data-tone="props.tone">
    <VzIcon :name="props.icon ?? DEFAULT_ICONS[props.tone]" :class="props.boxed ? '' : `tone-${props.tone === 'info' ? 'brand' : props.tone}`" />
    <div class="vz-notice__text">
      <slot />
    </div>
  </div>
</template>
