<script setup lang="ts">
import { computed } from 'vue'
import VzBadge from '~/components/VzBadge.vue'
import { useI18n } from '~/composables/useI18n'
import { useRedFlagCount } from '~/composables/useRedFlags'

/**
 * How many red flags the lines under this address carry, beside its verdict.
 *
 * Goes next to the verdict of the same name, never one for a whole box: a box
 * that names two addresses (a short link and where it leads) gets one count
 * per name, or the number would be left for the reader to assign.
 *
 * Takes the hostname and context the lines below are drawn with, so it asks
 * the same lookalike question and reads the same answer. Nothing at all when
 * there are none: a green "0 red flags" would read as a clean bill.
 */
const props = defineProps<{
  hostname: string
  url?: string | null
  context?: 'email'
  /** A flag the caller draws itself, such as link text naming another site. */
  extra?: number
}>()

const { t } = useI18n()

const count = useRedFlagCount(() => props.hostname, () => props.url, () => props.context, () => props.extra ?? 0)
const text = computed(() => count.value === 1
  ? t.value('redFlagsOne')
  : t.value('redFlagsMany').replace('{n}', String(count.value)))
</script>

<template>
  <VzBadge v-if="count > 0" tone="danger" icon="flag" :data-red-flags="count">
    {{ text }}
  </VzBadge>
</template>
