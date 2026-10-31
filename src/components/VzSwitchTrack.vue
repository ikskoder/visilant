<script setup lang="ts">
/**
 * The visible part of a `.vz-switch`, placed right after its checkbox.
 *
 * Drawn as one SVG rather than a bordered box with a pseudo-element knob.
 * Chrome rounds the knob's box to whole device pixels separately from the
 * track's, so wherever the 4px gap comes to a half pixel (at 312.5% it is
 * 12.5) the knob sat a device pixel off the middle, on some rows and not
 * others. Inside one SVG both shapes share one coordinate space and nothing
 * is rounded on its own.
 */
</script>

<template>
  <svg class="vz-switch__track" viewBox="0 0 40 24" width="40" height="24" aria-hidden="true">
    <rect class="vz-switch__rail" x="0.5" y="0.5" width="39" height="23" rx="11.5" />
    <circle class="vz-switch__knob" cx="12" cy="12" r="8" />
  </svg>
</template>
