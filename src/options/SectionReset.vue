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
    class="vz-iconbtn section-reset"
    :title="label"
    :aria-label="label"
    :disabled="disabled"
    @click="$emit('reset')"
  >
    <VzIcon name="reset" />
  </button>
</template>

<style scoped>
.section-reset {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
}

.section-reset:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background: transparent;
}
</style>
