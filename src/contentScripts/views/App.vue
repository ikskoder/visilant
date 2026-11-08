<!-- eslint-disable no-console -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { isMessageError } from '~/logic/message-error'
import { applySettingsSnapshot, defaultSettings, settings } from '~/logic/storage'
import { checkPanelData, checkPanelVisible, isIgnored, linkInterceptData, linkInterceptResolve, linkInterceptVisible, linkTooltipData, linkTooltipVisible, onTooltipHoverEnter, onTooltipHoverLeave, pasteInterceptData, pasteInterceptResolve, pasteInterceptVisible, safetyLevel, showWarning, warningType } from '~/logic/ui-state'
import { isTrackableHostname } from '~/logic/visit-stats'
import CheckPanel from './CheckPanel.vue'
import InputWarning from './InputWarning.vue'
import LinkInterceptDialog from './LinkInterceptDialog.vue'
import LinkTooltip from './LinkTooltip.vue'
import PasteInterceptDialog from './PasteInterceptDialog.vue'
// The same rule the extension's own pages get, since the in-page surfaces carry
// the same titled facts and load none of `main.css`
import '~/styles/tokens.css'
import '~/styles/vz.css'
import '~/styles/help-cursor.css'
import 'uno.css'

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

// Helper to send message safely (fallback to runtime.sendMessage)
async function sendMessageSafe<T = any>(id: string, data: any): Promise<T | null> {
  // Always use runtime.sendMessage to avoid long-lived ports that cause bfcache issues
  const answer = await browser.runtime.sendMessage({ type: id, data })
  // A handler that failed answers with a reason. Nothing here may read that as
  // a verdict about the page - it says the opposite.
  return isMessageError(answer) ? null : answer as T
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

// Nothing here turns the warnings off any more. Silencing a site is a decision
// the page must not be able to steer, and every surface in this document is
// drawn over a page that can write instructions next to it – see the note in
// `InputWarning`. The switch is in the popup, and `isIgnored` is now only ever
// read: the background tells this document what the popup decided.

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
  // An address domain from an email tooltip is a mail provider, not a site
  // somebody opens, and the page has to know that to say so instead of
  // reading its zero as "never visited"
  const tooltip = linkTooltipData.value
  const context = tooltip?.kind === 'email' && tooltip.domain === domain ? 'email' : undefined
  linkTooltipVisible.value = false
  linkTooltipData.value = null
  // Send message to background to open popup page with domain context
  browser.runtime.sendMessage({
    type: 'open-popup-tab',
    data: { domain, context },
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
function resolvePasteIntercept(allowed: boolean) {
  pasteInterceptVisible.value = false
  pasteInterceptData.value = null
  if (pasteInterceptResolve.value) {
    pasteInterceptResolve.value(allowed)
    pasteInterceptResolve.value = null
  }
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
    `.vz-root` carries every design token, declared here on the wrapper rather
    than inherited from the host element, so no rule on the page can reach them.
    `.vz-root--page` swaps the named fonts for generic ones, and `.dark` the
    colours. It also gives plain text its colour: `color` inherits across the
    shadow boundary, and a page whose text is near black used to draw invisibly
    on the dark cards.
  -->
  <div class="vz-root vz-root--page" :class="{ dark: isDark }">
    <InputWarning
      :safety-level="safetyLevel"
      :show="showWarning"
      :warning-type="warningType"
      @close="showWarning = false"
    />

    <LinkTooltip
      :visible="linkTooltipVisible"
      :data="linkTooltipData"
      :show-go-button="linkTooltipData?.heldClick === true"
      :font-size="settings.popupFontSize"
      :show-visit-count="settings.linkSafety?.showVisitCount ?? 'always'"
      :show-full-url="settings.linkSafety?.shortUrlShowFullUrl ?? false"
      :trace-chain="settings.linkSafety?.shortUrlTraceChain ?? false"
      :short-url-mode="settings.linkSafety?.shortUrlMode ?? 'off'"
      @hover-enter="handleTooltipHoverEnter"
      @close="handleTooltipClose"
      @go="handleTooltipGo"
      @details="handleTooltipDetails"
    />

    <CheckPanel
      :visible="checkPanelVisible"
      :data="checkPanelData"
      :font-size="settings.popupFontSize"
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
      @continue="handleInterceptContinue"
      @cancel="handleInterceptCancel"
      @details="handleTooltipDetails"
      @resolve-short-url="handleResolveInterceptUrl"
    />

    <PasteInterceptDialog
      :visible="pasteInterceptVisible"
      :data="pasteInterceptData"
      @allow="resolvePasteIntercept(true)"
      @cancel="resolvePasteIntercept(false)"
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
