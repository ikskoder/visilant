<!-- eslint-disable no-console -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { resolveTooltipTrigger } from '~/logic/platform'
import { applySettingsSnapshot, defaultSettings, settings } from '~/logic/storage'
import { checkPanelData, checkPanelVisible, isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, onTooltipHoverEnter, onTooltipHoverLeave, pasteInterceptData, pasteInterceptResolve, pasteInterceptVisible, safetyLevel, showWarning, warningFrameHost, warningType } from '~/logic/ui-state'
import { isTrackableHostname } from '~/logic/visit-stats'
import CheckPanel from './CheckPanel.vue'
import InputWarning from './InputWarning.vue'
import LinkInterceptDialog from './LinkInterceptDialog.vue'
import LinkTooltip from './LinkTooltip.vue'
import PasteInterceptDialog from './PasteInterceptDialog.vue'
import 'uno.css'

// The tooltip's "go" button belongs to the trigger that intercepts the click,
// which on a touchscreen is the one in use whatever the setting says
const effectiveTooltipTrigger = computed(() => resolveTooltipTrigger(
  settings.value?.linkSafety?.tooltipTrigger ?? defaultSettings.linkSafety.tooltipTrigger,
))

// Theme support for content scripts
const isDark = ref(true) // default dark until settings load
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

function resolveTheme() {
  const theme = settings.value?.theme || 'system'
  if (theme === 'dark')
    isDark.value = true
  else if (theme === 'light')
    isDark.value = false
  else
    isDark.value = mediaQuery.matches
}

function onSystemThemeChange() {
  if (settings.value?.theme === 'system') {
    isDark.value = mediaQuery.matches
  }
}

mediaQuery.addEventListener('change', onSystemThemeChange)
watch(() => settings.value?.theme, resolveTheme, { immediate: true })

onBeforeUnmount(() => {
  mediaQuery.removeEventListener('change', onSystemThemeChange)
})

provide('isDark', computed(() => isDark.value))

// Helper to send message safely (fallback to runtime.sendMessage)
async function sendMessageSafe<T = any>(id: string, data: any): Promise<T> {
  // Always use runtime.sendMessage to avoid long-lived ports that cause bfcache issues
  return await browser.runtime.sendMessage({ type: id, data }) as T
}

const hostname = ref('')

// Initialize settings. Applied rather than assigned: a content script is a
// read-only consumer of the settings – see `makeSettingsReadOnly`
if (!settings.value)
  applySettingsSnapshot(defaultSettings)

// Check site safety and update UI
async function checkSiteSafety() {
  // An address that is not tracked has a visit count of zero that can never
  // move, and reading that as unfamiliar would warn about the router's own page
  // forever. The content script already decides this - and used to have its
  // decision overwritten here, on any page the app was force-mounted on.
  const pageHost = window.location.hostname
  if (!pageHost || !isTrackableHostname(pageHost)) {
    hostname.value = pageHost
    safetyLevel.value = true
    return
  }

  const response = await sendMessageSafe<{ count: number, hostname: string, lastSeen: number, ignored: boolean, activeDays?: number, firstSeen?: number }>('get-visit-count', { url: window.location.href })
  if (!response)
    return

  const visitData = response
  hostname.value = visitData.hostname
  isIgnored.value = visitData.ignored

  // Update safety level – the same rules the badge and the content script use
  safetyLevel.value = isFamiliar(visitData, normalizeFamiliarity(settings.value.familiarity))
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
  // Only when there is no element behind this dialog. Where there is one, the
  // content script puts the click back on the link itself, which keeps the
  // target, `download`, `rel` and the page's own handler – see `followLink`.
  if (data?.url && data.ownNavigation !== false) {
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

// Paste intercept handlers. The promise is the paste itself waiting to happen,
// so it always has to be settled, whichever button was pressed.
async function resolvePasteIntercept(allowed: boolean, dontAskAgain: boolean) {
  pasteInterceptVisible.value = false
  pasteInterceptData.value = null
  if (pasteInterceptResolve.value) {
    pasteInterceptResolve.value(allowed)
    pasteInterceptResolve.value = null
  }
  // The same per-site switch the warning banner offers, reached from here so the
  // user does not have to hunt for it after being interrupted
  if (dontAskAgain)
    await ignoreSite()
}

function handleResolveInterceptUrl() {
  // Trigger resolve via the global function exposed by content script
  ;(window as any).__visilant_resolveInterceptUrl?.()
}

onMounted(async () => {
  // Initialize settings
  if (!settings.value)
    applySettingsSnapshot(defaultSettings)

  await checkSiteSafety()
})
</script>

<template>
  <!--
    The .dark class activates UnoCSS dark: variants inside the shadow DOM,
    matching how useTheme toggles it on documentElement in popup/options.

    The colour beside it is not decoration. `color` is an inherited property and
    inheritance crosses the shadow boundary, so any text in here that does not
    name its own colour takes the host page's – and a page whose text is near
    black rendered invisibly on the dark cards. Everything below still overrides
    it where it means something, this only decides what plain text looks like.
  -->
  <div :class="[{ dark: isDark }, isDark ? 'text-gray-100' : 'text-gray-900']">
    <InputWarning
      :safety-level="safetyLevel"
      :show="showWarning"
      :warning-type="warningType"
      :frame-host="warningFrameHost"
      :is-dark="isDark"
      @close="showWarning = false"
      @ignore-site="ignoreSite"
    />

    <LinkTooltip
      :visible="linkTooltipVisible"
      :data="linkTooltipData"
      :show-go-button="effectiveTooltipTrigger === 'click-left'"
      :font-size="settings.popupFontSize"
      :show-visit-count="settings.linkSafety?.showVisitCount ?? 'always'"
      :show-full-url="settings.linkSafety?.shortUrlShowFullUrl ?? false"
      :trace-chain="settings.linkSafety?.shortUrlTraceChain ?? false"
      :short-url-mode="settings.linkSafety?.shortUrlMode ?? 'off'"
      :is-dark="isDark"
      @hover-enter="handleTooltipHoverEnter"
      @close="handleTooltipClose"
      @go="handleTooltipGo"
      @details="handleTooltipDetails"
    />

    <CheckPanel
      :visible="checkPanelVisible"
      :data="checkPanelData"
      :font-size="settings.popupFontSize"
      :is-dark="isDark"
      @close="checkPanelVisible = false; checkPanelData = null"
      @details="handleTooltipDetails"
    />

    <LinkInterceptDialog
      :visible="linkInterceptVisible"
      :data="linkInterceptData"
      :show-visit-count="settings.linkSafety?.showVisitCount || 'always'"
      :show-full-url="settings.linkSafety?.shortUrlShowFullUrl ?? false"
      :trace-chain="settings.linkSafety?.shortUrlTraceChain ?? false"
      :short-url-mode="settings.linkSafety?.shortUrlMode ?? 'off'"
      :is-dark="isDark"
      @continue="handleInterceptContinue"
      @cancel="handleInterceptCancel"
      @details="handleTooltipDetails"
      @resolve-short-url="handleResolveInterceptUrl"
    />

    <PasteInterceptDialog
      :visible="pasteInterceptVisible"
      :data="pasteInterceptData"
      :is-dark="isDark"
      @allow="(dontAskAgain) => resolvePasteIntercept(true, dontAskAgain)"
      @cancel="(dontAskAgain) => resolvePasteIntercept(false, dontAskAgain)"
      @details="handleTooltipDetails"
    />
  </div>
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
