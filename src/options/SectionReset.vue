<script setup lang="ts">
/**
 * Put one section back to how it ships.
 *
 * Sits in the corner of a settings card and speaks only for that card. Nothing
 * is asked before it acts, which is why it goes dead the moment the section
 * already matches its defaults – a button that cannot change anything cannot be
 * pressed by accident either. What it owns is decided by the page, since the
 * page is what owns the sections.
 */
defineProps<{
  label: string
  disabled: boolean
}>()

defineEmits<{ reset: [] }>()
</script>

<template>
  <button
    type="button"
    class="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:pointer-events-none"
    :title="label"
    :aria-label="label"
    :disabled="disabled"
    @click="$emit('reset')"
  >
    <div class="i-carbon-reset text-lg" />
  </button>
</template>
