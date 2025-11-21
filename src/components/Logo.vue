<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import logo from '../assets/logo.svg'

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
  <img :src="logo" :alt="altText" class="block object-contain">
</template>
