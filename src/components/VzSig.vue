<script setup lang="ts">
import shieldMarkup from '../assets/icon.svg?raw'

/**
 * The signature line on everything drawn over a web page: the word Visilant
 * with the shield as its V, the way the logo on the extension's own pages draws
 * it. It says whose box this is. It proves nothing, because a page
 * can draw the same thing, which is why no decision may ever rest on it.
 */
</script>

<template>
  <!-- Read out as the name, since on screen it is a picture and "isilant" -->
  <div class="vz-sig" role="img" aria-label="Visilant">
    <!-- eslint-disable-next-line vue/no-v-html -- our own asset, no user input -->
    <span class="vz-sig__mark" aria-hidden="true" v-html="shieldMarkup" />
    <span aria-hidden="true">isilant</span>
  </div>
</template>

<style scoped>
.vz-sig__mark {
  display: inline-flex;
}

.vz-sig__mark :deep(svg) {
  width: calc(16px * var(--vz-scale, 1));
  height: calc(16px * var(--vz-scale, 1));
}
</style>
