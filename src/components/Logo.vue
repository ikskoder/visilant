<script setup lang="ts">
/**
 * The wordmark, drawn into the page rather than loaded as an image.
 *
 * An `<img>` is a closed document: nothing outside it can reach the letters, so
 * a blue that reads at 9.3:1 on white and 1.9:1 on the dark page could only be
 * fixed by shipping a second file. Inlined, the same one file is repainted by
 * the theme – the rule below is the whole difference.
 */
import { ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import logoMarkup from '../assets/logo.svg?raw'

const { t, currentLanguage, isLoaded } = useI18n()
const altText = ref('')

function updateTranslations() {
  if (!isLoaded.value)
    return
  altText.value = t.value('logoAlt')
}

watch([currentLanguage, isLoaded], () => {
  updateTranslations()
}, { immediate: true })
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- our own asset, no user input -->
  <div class="logo-mark" role="img" :aria-label="altText" v-html="logoMarkup" />
</template>

<style>
/* Fits whatever the caller sizes: a height on the wrapper drives the popup's
   header, a width drives the 300px column on the settings and welcome pages */
.logo-mark svg {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
}

/* The letters are blue on a light background and white on a dark one. The shield
   keeps its colours in both – it carries its own white outline already. */
.dark .logo-mark .logo-wordmark {
  fill: #ffffff;
}
</style>
