<!-- eslint-disable no-console -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { defaultSettings, settings } from '~/logic/storage'
import { isIgnored, safetyLevel, showWarning, warningType } from '~/logic/ui-state'
import InputWarning from './InputWarning.vue'
import 'uno.css'

// Helper to send message safely (fallback to runtime.sendMessage)
async function sendMessageSafe<T = any>(id: string, data: any): Promise<T> {
  // Always use runtime.sendMessage to avoid long-lived ports that cause bfcache issues
  return await browser.runtime.sendMessage({ type: id, data }) as T
}

const hostname = ref('')

// Initialize settings
settings.value = settings.value || defaultSettings

// Check site safety and update UI
async function checkSiteSafety() {
  const response = await sendMessageSafe<{ count: number, hostname: string, lastSeen: number, ignored: boolean }>('get-visit-count', { url: window.location.href })
  if (!response)
    return

  const visitData = response
  const count = visitData.count
  hostname.value = visitData.hostname
  isIgnored.value = visitData.ignored

  // Update safety level
  safetyLevel.value = count >= settings.value.safety
}

// Handle ignoring site
async function ignoreSite() {
  if (!hostname.value) {
    // Fallback: Get hostname from current URL if not set
    hostname.value = new URL(window.location.href).hostname
  }
  if (!hostname.value)
    return

  // Send message to background script to ignore the site
  const response = await sendMessageSafe('ignore-site', { hostname: hostname.value })

  // If the operation was successful, update local state
  if (response === 'Site ignored successfully') {
    isIgnored.value = true
    // Hide warning
    showWarning.value = false
  }
}

onMounted(async () => {
  // Initialize settings
  if (!settings.value) {
    settings.value = defaultSettings
  }

  await checkSiteSafety()
})
</script>

<template>
  <InputWarning
    :safety-level="safetyLevel"
    :show="showWarning"
    :warning-type="warningType"
    @close="showWarning = false"
    @ignore-site="ignoreSite"
  />
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
