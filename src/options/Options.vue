<script setup lang="ts">
import { ref, watch } from 'vue'
import logo from '~/assets/logo.svg'
import { useI18n } from '~/composables/useI18n'
import { defaultSettings, settings } from '~/logic/storage'

const { t, setLanguage, currentLanguage, isLoaded } = useI18n()

// Reactive translations
const translations = ref<Record<string, string>>({})

// Function to update translations
function updateTranslations() {
  if (!isLoaded.value)
    return

  const translationKeys = [
    'extensionName',
    'settings',
    'generalSettings',
    'languageSettings',
    'selectLanguage',
    'languageEnglish',
    'languageRussian',
    'languageUkrainian',
    'safetyLevels',
    'visitsThreshold',
    'visitsThresholdDesc',
    'displaySettings',
    'dynamicIcon',
    'dynamicIconDesc',
    'showBadge',
    'showBadgeDesc',
    'notificationSettings',
    'showWarningNotification',
    'showWarningNotificationDesc',
    'showInputWarning',
    'showCopyWarning',
    'notificationStyle',
    'browserNotifications',
    'inPageNotifications',
    'bothNotifications',
    'notificationCooldown',
    'notificationCooldownDesc',
    'databaseManagement',
    'importHistory',
    'importing',
    'importHistoryDesc',
    'resetData',
    'visitsInfo',
    'allSettings',
    'resetSelectedData',
    'selectDataToReset',
    'confirmReset',
    'confirmResetMessage',
    'cannotBeUndone',
    'cancel',
    'reset',
    'historyPermissionRequired',
    'notificationPermissionRequired',
    'warningTriggerEventsTitle',
    'bothWarningTriggers',
    'defaultSafetyThreshold',
    'linkSafetySettings',
    'linkSafetySettingsDesc',
    'linkSafetyEnabled',
    'linkTooltipTrigger',
    'linkTooltipTriggerHover',
    'linkTooltipTriggerClickLeft',
    'linkShowVisitCount',
    'linkShowVisitCountAlways',
    'linkShowVisitCountNever',
    'linkShowVisitCountUnfamiliar',
    'linkShowVisitCountFamiliar',
    'linkInterceptEnabled',
    'linkInterceptEnabledDesc',
    'linkShortUrlSection',
    'linkShortUrlSectionWarning',
    'linkShortUrlModeOff',
    'linkShortUrlModeButton',
    'linkShortUrlModeAuto',
    'linkShortUrlShowFullUrl',
    'linkShortUrlTraceChain',
    'linkShortUrlResolveAny',
    'linkShortUrlResolveAnyDesc',
    'linkShortUrlListUpdateUrl',
    'linkShortUrlListUpdateUrlDesc',
    'linkShortUrlResetCustom',
    'linkScopeMode',
    'linkScopeEverywhere',
    'linkScopeWhitelist',
    'linkScopeBlacklist',
    'linkScopeDomains',
  ]

  const newTranslations: Record<string, string> = {}
  for (const key of translationKeys) {
    newTranslations[key] = t.value(key)
  }
  translations.value = newTranslations
}

// Update translations when language changes or when translations are loaded
watch([currentLanguage, isLoaded], () => {
  updateTranslations()
}, { immediate: true })

// Watch notification settings changes
watch(() => settings.value.showWarningNotification, async (newVal) => {
  if (newVal && ['browser', 'both'].includes(settings.value.notificationStyle)) {
    const granted = await browser.permissions.request({
      permissions: ['notifications'],
    })
    if (!granted) {
      // If permission denied, fallback to in-page notifications
      settings.value.notificationStyle = 'in-page'
      // eslint-disable-next-line no-alert
      alert(t.value('notificationPermissionRequired'))
    }
  }
})

watch(() => settings.value.notificationStyle, async (newVal) => {
  if (settings.value.showWarningNotification && ['browser', 'both'].includes(newVal)) {
    const granted = await browser.permissions.request({
      permissions: ['notifications'],
    })
    if (!granted) {
      // If permission denied, fallback to in-page notifications
      settings.value.notificationStyle = 'in-page'
      // eslint-disable-next-line no-alert
      alert(t.value('notificationPermissionRequired'))
    }
  }
})

// Loading states
const isImporting = ref(false)
const importProgress = ref({ current: 0, total: 0 })
const showResetConfirm = ref(false)

// Reset selection states
const resetSelections = ref({
  visits: false,
  settings: false,
  customShorteners: false,
})

// Language settings
const availableLanguages = [
  { code: 'en', name: 'languageEnglish' },
  { code: 'ru', name: 'languageRussian' },
  { code: 'uk', name: 'languageUkrainian' },
]

// Function to change language
async function changeLanguage(langCode: string) {
  // setLanguage handles both UI update and storage persistence
  await setLanguage(langCode)
  updateTranslations()
}

// Convert string values to numbers when updating thresholds
function updateSafetyThreshold(value: string) {
  settings.value = {
    ...settings.value,
    safety: Number(value),
  }
}

// Database management functions
async function importHistory() {
  try {
    // Request history permission first
    const granted = await browser.permissions.request({
      permissions: ['history'],
    })

    if (!granted) {
      // User denied the permission
      // eslint-disable-next-line no-alert
      alert(t.value('historyPermissionRequired'))
      return
    }

    isImporting.value = true
    const history = await browser.history.search({
      text: '',
      maxResults: 999999, // can't be 0 bcs of firefox
      startTime: 0, // from the beginning
    })

    // Group visits by hostname
    const visitsInfo = new Map<string, number>()
    importProgress.value.total = history.length

    for (const item of history) {
      importProgress.value.current++
      if (!item.url)
        continue
      try {
        const hostname = new URL(item.url).hostname
        visitsInfo.set(hostname, (visitsInfo.get(hostname) || 0) + 1)
      }
      catch {
        // Skip invalid URLs
        continue
      }
    }

    // Update storage with visit counts
    let processed = 0
    const totalSites = visitsInfo.size
    importProgress.value = { current: 0, total: totalSites }
    const now = Date.now()

    for (const [hostname, count] of visitsInfo) {
      processed++
      importProgress.value.current = processed
      await browser.storage.local.set({
        [hostname]: {
          count,
          lastSeen: now,
          ignored: false,
        },
      })
    }
  }
  finally {
    isImporting.value = false
    importProgress.value = { current: 0, total: 0 }
  }
}

async function resetSelected() {
  showResetConfirm.value = false

  if (resetSelections.value.visits) {
    // Get all keys from storage
    const result = await browser.storage.local.get(null)
    const keysToRemove = Object.keys(result).filter(key =>
      // Remove only visit counts (entries that are not settings)
      key !== 'settings',
    )
    // Remove all visit count entries
    await browser.storage.local.remove(keysToRemove)
  }

  if (resetSelections.value.settings) {
    // Reset settings to defaults
    settings.value = { ...defaultSettings }
  }

  if (resetSelections.value.customShorteners) {
    await browser.storage.local.remove('customShorteners')
  }

  // Reset selections
  resetSelections.value = {
    visits: false,
    settings: false,
    customShorteners: false,
  }
}

// Watch for changes in settings
watch(settings, (_newVal, _oldVal) => { }, { deep: true })
</script>

<template>
  <main class="px-4 py-10 text-center text-gray-700 dark:text-gray-200">
    <div v-if="!isLoaded" class="flex justify-center items-center h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
    </div>

    <div v-else>
      <img :src="logo" style="max-width: 300px;" class="mx-auto" :alt="translations.extensionName">
      <div class="text-xl font-bold mb-6">
        {{ translations.settings }}
      </div>

      <div class="max-w-md mx-auto space-y-6">
        <!-- General Settings -->
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold mb-4">
            {{ translations.generalSettings }}
          </h2>

          <!-- Language Settings -->
          <div class="flex flex-col items-start mb-6">
            <label class="text-sm font-medium mb-2">{{ translations.selectLanguage }}</label>
            <select
              v-model="currentLanguage"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              @change="(e) => changeLanguage((e.target as HTMLSelectElement).value)"
            >
              <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">
                {{ translations[lang.name] }}
              </option>
            </select>
          </div>

          <!-- Threshold Settings -->
          <div class="space-y-4">
            <div class="flex flex-col items-center">
              <label class="text-sm font-medium mb-1">{{ translations.visitsThreshold }}</label>
              <div class="flex items-center w-full">
                <input
                  :value="settings.safety" type="number" min="1"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  :placeholder="translations.defaultSafetyThreshold" @input="updateSafetyThreshold(($event.target as HTMLInputElement).value)"
                >
              </div>
              <p class="text-xs text-gray-500 mt-1">
                {{ translations.visitsThresholdDesc }}
              </p>
            </div>
          </div>
        </div>

        <!-- Display Settings -->
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold mb-4">
            {{ translations.displaySettings }}
          </h2>

          <div class="space-y-4">
            <div class="flex items-start justify-between">
              <div class="text-left">
                <label class="text-sm font-medium">{{ translations.dynamicIcon }}</label>
                <p class="text-xs text-gray-500">
                  {{ translations.dynamicIconDesc }}
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input v-model="settings.changeIcon" type="checkbox" class="sr-only peer">
                <div
                  class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
                />
              </label>
            </div>

            <div class="flex items-start justify-between">
              <div class="text-left">
                <label class="text-sm font-medium">{{ translations.showBadge }}</label>
                <p class="text-xs text-gray-500">
                  {{ translations.showBadgeDesc }}
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input v-model="settings.showBadge" type="checkbox" class="sr-only peer">
                <div
                  class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
                />
              </label>
            </div>
          </div>
        </div>

        <!-- Notification Settings -->
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold mb-4">
            {{ translations.notificationSettings }}
          </h2>

          <!-- Show Notifications Toggle -->
          <div class="flex items-start justify-between mb-4">
            <div class="text-left">
              <label class="text-sm font-medium">{{ translations.showWarningNotification }}</label>
              <p class="text-xs text-gray-500">
                {{ translations.showWarningNotificationDesc }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="settings.showWarningNotification" type="checkbox" class="sr-only peer">
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
              />
            </label>
          </div>
          <!-- <div> -->
          <div v-if="settings.showWarningNotification">
            <!-- Warning Trigger Events Section -->
            <div class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-left text-sm font-medium mb-3">
                {{ translations.warningTriggerEventsTitle }}:
              </h3>

              <div class="space-y-2">
                <label class="flex items-center mt-2">
                  <input
                    type="radio" name="warningType" value="input"
                    :checked="settings.showInputWarning && !settings.showCopyWarning"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;" @change="() => {
                      settings.showInputWarning = true;
                      settings.showCopyWarning = false;
                    }"
                  >
                  <span class="text-left ml-2">{{ translations.showInputWarning }}</span>
                </label>
                <label class="flex items-center mt-2">
                  <input
                    type="radio" name="warningType" value="copy"
                    :checked="!settings.showInputWarning && settings.showCopyWarning"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;" @change="() => {
                      settings.showInputWarning = false;
                      settings.showCopyWarning = true;
                    }"
                  >
                  <span class="text-left ml-2">{{ translations.showCopyWarning }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    type="radio" name="warningType" value="both"
                    :checked="settings.showInputWarning && settings.showCopyWarning"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;" @change="() => {
                      settings.showInputWarning = true;
                      settings.showCopyWarning = true;
                    }"
                  >
                  <span class="text-left ml-2">{{ translations.bothWarningTriggers }}</span>
                </label>
              </div>
            </div>

            <!-- Notification Style -->
            <div class="space-y-2">
              <div class="mt-6">
                <h3 class="text-left text-sm font-medium mb-3">
                  {{ translations.notificationStyle }}
                </h3>
                <div class="space-y-2">
                  <label class="flex items-center">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="browser"
                      class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2">{{ translations.browserNotifications }}</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="in-page"
                      class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2">{{ translations.inPageNotifications }}</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="settings.notificationStyle" type="radio" value="both"
                      class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2">{{ translations.bothNotifications }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Link Safety Settings -->
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold mb-2">
            {{ translations.linkSafetySettings }}
          </h2>
          <p class="text-xs text-gray-500 mb-4 text-left">
            {{ translations.linkSafetySettingsDesc }}
          </p>

          <!-- Master Toggle -->
          <div class="flex items-start justify-between mb-4">
            <div class="text-left">
              <label class="text-sm font-medium">{{ translations.linkSafetyEnabled }}</label>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="settings.linkSafety.enabled" type="checkbox" class="sr-only peer">
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
              />
            </label>
          </div>

          <div v-if="settings.linkSafety.enabled">
            <!-- Tooltip Trigger -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-left text-sm font-medium mb-3">
                {{ translations.linkTooltipTrigger }}:
              </h3>
              <div class="space-y-2">
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="hover"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkTooltipTriggerHover }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.tooltipTrigger" type="radio" value="click-left"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkTooltipTriggerClickLeft }}</span>
                </label>
              </div>
            </div>

            <!-- Show Visit Count -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-left text-sm font-medium mb-3">
                {{ translations.linkShowVisitCount }}:
              </h3>
              <div class="space-y-2">
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="always"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountAlways }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="unfamiliar"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountUnfamiliar }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="familiar"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountFamiliar }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.showVisitCount" type="radio" value="never"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkShowVisitCountNever }}</span>
                </label>
              </div>
            </div>

            <!-- Navigation Intercept -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <div class="flex items-start justify-between">
                <div class="text-left">
                  <label class="text-sm font-medium">{{ translations.linkInterceptEnabled }}</label>
                  <p class="text-xs text-gray-500">
                    {{ translations.linkInterceptEnabledDesc }}
                  </p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="settings.linkSafety.interceptEnabled" type="checkbox" class="sr-only peer">
                  <div
                    class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"
                  />
                </label>
              </div>
            </div>

            <!-- Shortened URL Settings -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-left text-sm font-medium mb-1">
                {{ translations.linkShortUrlSection }}
              </h3>
              <p class="text-left text-xs text-gray-500 mb-3">
                {{ translations.linkShortUrlSectionWarning }}
              </p>

              <!-- Mode: off / button / auto -->
              <div class="text-left space-y-2 mb-3">
                <label class="flex items-center cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="off" class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">{{ translations.linkShortUrlModeOff }}</span>
                </label>
                <label class="flex items-center cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="button" class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">{{ translations.linkShortUrlModeButton }}</span>
                </label>
                <label class="flex items-center cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlMode" type="radio" value="auto" class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;">
                  <span class="ml-2 text-sm">{{ translations.linkShortUrlModeAuto }}</span>
                </label>
              </div>

              <!-- Sub-options (only when not off) -->
              <div v-if="settings.linkSafety.shortUrlMode !== 'off'" class="text-left space-y-3 ml-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
                <!-- Show full URL -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlShowFullUrl" type="checkbox" class="flex-shrink-0 rounded" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; accent-color: #3b82f6;">
                  <span class="text-sm">{{ translations.linkShortUrlShowFullUrl }}</span>
                </label>

                <!-- Show redirect chain -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlTraceChain" type="checkbox" class="flex-shrink-0 rounded" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; accent-color: #3b82f6;">
                  <span class="text-sm">{{ translations.linkShortUrlTraceChain }}</span>
                </label>

                <!-- Resolve any URL -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="settings.linkSafety.shortUrlResolveAny" type="checkbox" class="flex-shrink-0 rounded" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; accent-color: #3b82f6;">
                  <span class="text-sm">{{ translations.linkShortUrlResolveAny }}</span>
                </label>
                <p v-if="settings.linkSafety.shortUrlResolveAny" class="text-left text-xs text-gray-500 ml-6">
                  {{ translations.linkShortUrlResolveAnyDesc }}
                </p>

                <!-- Remote list update URL -->
                <div class="text-left">
                  <label class="text-sm font-medium">{{ translations.linkShortUrlListUpdateUrl }}</label>
                  <p class="text-xs text-gray-500 mb-1">
                    {{ translations.linkShortUrlListUpdateUrlDesc }}
                  </p>
                  <input
                    v-model="settings.linkSafety.shortUrlListUpdateUrl"
                    type="url"
                    placeholder="https://raw.githubusercontent.com/..."
                    class="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 text-left"
                  >
                </div>
              </div>
            </div>

            <!-- Scope Mode -->
            <div class="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 class="text-left text-sm font-medium mb-3">
                {{ translations.linkScopeMode }}:
              </h3>
              <div class="space-y-2">
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="everywhere"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkScopeEverywhere }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="whitelist"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkScopeWhitelist }}</span>
                </label>
                <label class="flex items-center">
                  <input
                    v-model="settings.linkSafety.scopeMode" type="radio" value="blacklist"
                    class="h-4 w-4 flex-shrink-0" style="accent-color: #3b82f6;"
                  >
                  <span class="ml-2">{{ translations.linkScopeBlacklist }}</span>
                </label>
              </div>

              <!-- Domain List -->
              <div v-if="settings.linkSafety.scopeMode !== 'everywhere'" class="mt-3">
                <textarea
                  v-model="settings.linkSafety.scopeDomains"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  rows="3"
                  :placeholder="translations.linkScopeDomains"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Database Management -->
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 class="text-lg font-semibold mb-4">
            {{ translations.databaseManagement }}
          </h2>

          <div class="space-y-4">
            <div>
              <button
                class="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                :disabled="isImporting" @click="importHistory"
              >
                <template v-if="!isImporting">
                  {{ translations.importHistory }}
                </template>
                <template v-else>
                  {{ translations.importing }} {{ importProgress.current }}/{{ importProgress.total }}
                </template>
              </button>
              <div v-if="isImporting" class="w-full h-1 mt-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-500 transition-all duration-200"
                  :style="{ width: `${(importProgress.current / importProgress.total) * 100}%` }"
                />
              </div>
              <p class="text-xs text-gray-500 mt-1">
                {{ translations.importHistoryDesc }}
              </p>
            </div>

            <div class="space-y-2">
              <div class="text-left">
                <h3 class="text-sm font-medium mb-2">
                  {{ translations.resetData }}
                </h3>
                <div class="space-y-2">
                  <label class="flex items-center">
                    <input
                      v-model="resetSelections.visits" type="checkbox"
                      class="h-4 w-4 flex-shrink-0 rounded" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.visitsInfo }}</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="resetSelections.settings" type="checkbox"
                      class="h-4 w-4 flex-shrink-0 rounded" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.allSettings }}</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      v-model="resetSelections.customShorteners" type="checkbox"
                      class="h-4 w-4 flex-shrink-0 rounded" style="accent-color: #3b82f6;"
                    >
                    <span class="ml-2 text-sm">{{ translations.linkShortUrlResetCustom }}</span>
                  </label>
                </div>
              </div>

              <button
                class="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors mt-4
                disabled:bg-gray-400 disabled:text-gray-200 disabled:cursor-not-allowed"
                :disabled="isImporting || !Object.values(resetSelections).some(Boolean)"
                @click="showResetConfirm = true"
              >
                {{ translations.resetSelectedData }}
              </button>
              <p class="text-xs text-gray-500 mt-1">
                {{ translations.selectDataToReset }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- Reset Confirmation Dialog -->
  <div v-if="showResetConfirm" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full">
      <h3 class="text-lg font-semibold mb-4">
        {{ translations.confirmReset }}
      </h3>
      <p class="text-sm text-gray-600 dark:text-gray-300 mb-2">
        {{ translations.confirmResetMessage }}
      </p>
      <ul class="list-disc list-inside mb-6 text-sm text-gray-600 dark:text-gray-300">
        <li v-if="resetSelections.visits">
          {{ translations.visitsInfo }}
        </li>
        <li v-if="resetSelections.settings">
          {{ translations.allSettings }}
        </li>
        <li v-if="resetSelections.customShorteners">
          {{ translations.linkShortUrlResetCustom }}
        </li>
      </ul>
      <p class="text-sm text-gray-600 dark:text-gray-300 mb-6">
        {{ translations.cannotBeUndone }}!
      </p>
      <div class="flex space-x-3">
        <button
          class="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          @click="showResetConfirm = false"
        >
          {{ translations.cancel }}
        </button>
        <button
          class="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          @click="resetSelected"
        >
          {{ translations.reset }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
}
</style>
