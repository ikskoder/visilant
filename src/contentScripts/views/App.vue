<!-- eslint-disable no-console -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { defaultSettings, settings } from '~/logic/storage'
import { isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, onTooltipHoverEnter, onTooltipHoverLeave, safetyLevel, showWarning, warningType } from '~/logic/ui-state'
import InputWarning from './InputWarning.vue'
import LinkInterceptDialog from './LinkInterceptDialog.vue'
import LinkTooltip from './LinkTooltip.vue'
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

// Link tooltip handlers
function handleTooltipHoverEnter() {
  onTooltipHoverEnter.fn?.()
}

function handleTooltipClose() {
  if (onTooltipHoverLeave.fn) {
    onTooltipHoverLeave.fn()
  }
  else {
    linkTooltipVisible.value = false
    linkTooltipData.value = null
  }
}

function handleTooltipGo(href: string) {
  linkTooltipVisible.value = false
  linkTooltipData.value = null
  window.location.href = href
}

function handleTooltipDetails(domain: string) {
  linkTooltipVisible.value = false
  linkTooltipData.value = null
  // Send message to background to open popup page with domain context
  browser.runtime.sendMessage({
    type: 'open-popup-tab',
    data: { domain },
  })
}

// Link intercept handlers
function handleInterceptContinue() {
  const data = linkInterceptData.value
  linkInterceptVisible.value = false
  linkInterceptData.value = null
  if (linkInterceptResolve.value) {
    linkInterceptResolve.value(true)
    linkInterceptResolve.value = null
  }
  if (data?.url) {
    const target = data.target || '_self'
    if (target === '_blank' || target === '_new')
      window.open(data.url, '_blank', 'noopener,noreferrer')
    else
      window.location.href = data.url
  }
}

function handleInterceptCancel() {
  linkInterceptVisible.value = false
  linkInterceptData.value = null
  if (linkInterceptResolve.value) {
    linkInterceptResolve.value(false)
    linkInterceptResolve.value = null
  }
}

function handleResolveInterceptUrl() {
  // Trigger resolve via the global function exposed by content script
  ;(window as any).__visilant_resolveInterceptUrl?.()
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

  <LinkTooltip
    :visible="linkTooltipVisible"
    :data="linkTooltipData"
    :show-go-button="settings.linkSafety?.tooltipTrigger === 'click-left'"
    :font-size="settings.popupFontSize"
    :show-visit-count="settings.linkSafety?.showVisitCount ?? 'always'"
    :show-full-url="settings.linkSafety?.shortUrlShowFullUrl ?? false"
    :trace-chain="settings.linkSafety?.shortUrlTraceChain ?? false"
    @hover-enter="handleTooltipHoverEnter"
    @close="handleTooltipClose"
    @go="handleTooltipGo"
    @details="handleTooltipDetails"
  />

  <LinkInterceptDialog
    :visible="linkInterceptVisible"
    :data="linkInterceptData"
    :show-visit-count="settings.linkSafety?.showVisitCount || 'always'"
    :show-full-url="settings.linkSafety?.shortUrlShowFullUrl ?? false"
    :trace-chain="settings.linkSafety?.shortUrlTraceChain ?? false"
    @continue="handleInterceptContinue"
    @cancel="handleInterceptCancel"
    @details="handleTooltipDetails"
    @resolve-short-url="handleResolveInterceptUrl"
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
