<!-- eslint-disable no-console -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { defaultSettings, settings } from '~/logic/storage'
import InputWarning from './InputWarning.vue'
import 'uno.css'

// Helper to send message safely (fallback to runtime.sendMessage)
async function sendMessageSafe<T = any>(id: string, data: any): Promise<T> {
  // Always use runtime.sendMessage to avoid long-lived ports that cause bfcache issues
  return await browser.runtime.sendMessage({ type: id, data }) as T
}

const showWarning = ref(false)
const safetyLevel = ref<boolean | null>(null)
const warningType = ref<'input' | 'copy'>('input')

// Track notification state
const hasNotifiedOnThisPage = ref(false)
const hostname = ref('')
const isIgnored = ref(false)

// Initialize settings
settings.value = settings.value || defaultSettings

// Show notifications based on user preferences
async function showNotifications(type: 'input' | 'copy') {
  // Ensure settings are initialized
  if (!settings.value) {
    settings.value = defaultSettings
  }

  // Check if this site is ignored
  if (isIgnored.value) {
    return
  }

  // Check if we've already shown a notification on this page
  if (hasNotifiedOnThisPage.value) {
    return
  }

  // Check if the specific warning type is enabled
  if (type === 'input' && !settings.value.showInputWarning) {
    return
  }

  if (type === 'copy' && !settings.value.showCopyWarning) {
    return
  }

  // Set the warning type
  warningType.value = type

  const style = settings.value.notificationStyle || defaultSettings.notificationStyle

  if (style === 'browser' || style === 'both')
    await sendMessageSafe('show-notification', { warningType: type }) // Show browser notification with type

  if (style === 'in-page' || style === 'both')
    showWarning.value = true

  // Update tracking state
  hasNotifiedOnThisPage.value = true
}

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

// Handle keydown event
async function handleKeydown(event: KeyboardEvent) {
  // Check for copy/cut key combinations (Ctrl+C or Ctrl+X)
  if (event.ctrlKey && (event.key === 'c' || event.key === 'C' || event.key === 'x' || event.key === 'X')) {
    // For copy/cut operations, use the copy notification type instead of input
    if (safetyLevel.value === false && settings.value?.showWarningNotification) {
      await showNotifications('copy')
    }
    return
  }

  // Skip triggering warnings for any keys pressed with modifiers (Ctrl or Alt)
  if (event.ctrlKey || event.altKey) {
    return
  }

  // List of keys to ignore (special keys and navigation keys)
  const ignoredKeys = [
    'Shift',
    // Ctrl is used in copy/cut/paste so it might be dangerous to ignore it
    // UPD: Made dedicated copy/cut/paste handler, so now it's fine
    'Control',
    'Alt',
    'Meta',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Tab',
    'Escape',
    'Enter',
    'CapsLock',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'F1',
    'F2',
    'F3',
    'F4',
    'F5',
    'F6',
    'F7',
    'F8',
    'F9',
    'F10',
    'F11',
    'F12',
  ]

  // If the pressed key is in the ignored list, do nothing.
  if (ignoredKeys.includes(event.key)) {
    return
  }

  // Trigger notification if conditions are met.
  if (safetyLevel.value === false && settings.value?.showWarningNotification) {
    await showNotifications('input')
  }
}

// Handle paste event
async function handlePaste() {
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('input')
}

// Handle copy/cut events
async function handleCopyCut() {
  if (safetyLevel.value === false && settings.value?.showWarningNotification)
    await showNotifications('copy')
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

  // Add event listeners for keydown and paste
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('paste', handlePaste, true)
  window.addEventListener('copy', handleCopyCut, true)
  window.addEventListener('cut', handleCopyCut, true)
})

onUnmounted(() => {
  // Clean up event listeners
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('paste', handlePaste, true)
  window.removeEventListener('copy', handleCopyCut, true)
  window.removeEventListener('cut', handleCopyCut, true)
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
