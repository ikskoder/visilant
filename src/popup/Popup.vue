<script setup lang="ts">
import punycode from 'punycode'
import { getDomain } from 'tldts'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { settings } from '~/logic/storage'
import Logo from '../components/Logo.vue'
import SecureText from '../components/SecureText.vue'
import CheckField from './CheckField.vue'

const { t, isLoaded, loadedTranslations } = useI18n()
useTheme()

// Reactive translations
const translations = ref<Record<string, string>>({})

// Function to update translations
function updateTranslations() {
  if (!isLoaded.value)
    return

  const translationKeys = [
    'currentDomain',
    'baseDomain',
    'subdomains',
    'total',
    'sortBy',
    'sortByName',
    'sortByVisits',
    'toggleSortOrder',
    'toggleCase',
    'toggleHighlighting',
    'togglePunycodeListMode',
    'domainOriginal',
    'domainPunycode',
    'punycodeHelpTitle',
    'punycodeHelpContent',
    'current',
    'noVisitData',
    'visitWebsite',
    'settings',
    'antiTamperingProtected',
    'antiTamperingNotProtected',
    'antiTamperingDisableForSite',
    'antiTamperingEnableForSite',
    'antiTamperingTooltipWhat',
    'antiTamperingTooltipOn',
    'antiTamperingTooltipOff',
    'checkExternalButton',
  ]

  const newTranslations: Record<string, string> = {}
  for (const key of translationKeys) {
    newTranslations[key] = t.value(key)
  }
  translations.value = newTranslations
}

// Update translations when language changes or when translations are loaded
watch([loadedTranslations, isLoaded], () => {
  updateTranslations()
}, { immediate: true })

const isStandalonePage = ref(false)
const currentHostname = ref('')
const baseDomain = ref('')
const visits = ref<Record<string, any>>({})
const subdomains = ref<string[]>([])
const showPunycodeHelp = ref(false)

const unicodeHostname = computed(() => {
  if (!currentHostname.value)
    return ''
  return punycode.toUnicode(currentHostname.value)
})

const isPunycode = computed(() => {
  return currentHostname.value !== unicodeHostname.value
})

const cumulativeCount = computed(() => {
  return subdomains.value.reduce((acc, domain) => {
    return acc + (visits.value[domain]?.count || 0)
  }, 0)
})

const currentDomainCount = computed(() => {
  return visits.value[currentHostname.value]?.count || 0
})

const sortedSubdomains = computed(() => {
  const domains = [...subdomains.value]

  const option = settings.value.sortOption || 'visits'
  const order = settings.value.sortOrder || 'desc'
  const multiplier = order === 'asc' ? 1 : -1

  return domains.sort((a, b) => {
    if (option === 'visits') {
      const countA = visits.value[a]?.count || 0
      const countB = visits.value[b]?.count || 0
      if (countA !== countB)
        return (countA - countB) * multiplier

      // Fallback to name if counts are equal
      return a.localeCompare(b)
    }
    else {
      // Sort by name
      return a.localeCompare(b) * multiplier
    }
  })
})

function toggleSortOrder() {
  settings.value.sortOrder = settings.value.sortOrder === 'asc' ? 'desc' : 'asc'
}

function setSortOption(option: 'name' | 'visits') {
  settings.value.sortOption = option
}

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}

const isAntiTamperingExcluded = computed(() => {
  const hostname = currentHostname.value
  if (!hostname)
    return false
  const excludedStr = settings.value.antiTamperingExcludedDomains || ''
  if (!excludedStr)
    return false
  const excluded = excludedStr.split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean)
  const lowerHostname = hostname.toLowerCase()
  return excluded.some(domain => lowerHostname === domain || lowerHostname.endsWith(`.${domain}`))
})

function toggleAntiTampering() {
  const hostname = currentHostname.value
  if (!hostname)
    return

  const excludedStr = settings.value.antiTamperingExcludedDomains || ''
  const excluded = excludedStr.split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean)
  const lowerHostname = hostname.toLowerCase()

  if (isAntiTamperingExcluded.value) {
    // Remove from exclusion list
    const filtered = excluded.filter(d => d !== lowerHostname)
    settings.value.antiTamperingExcludedDomains = filtered.join('\n')
  }
  else {
    // Add to exclusion list
    excluded.push(lowerHostname)
    settings.value.antiTamperingExcludedDomains = excluded.join('\n')
  }
}

function getCountColor(count: number) {
  const threshold = settings.value.safety
  return count >= threshold ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

function toggleDomainCase() {
  settings.value.domainCase = settings.value.domainCase === 'upper' ? 'lower' : 'upper'
}

function toggleHighlighting() {
  settings.value.domainHighlighting = !settings.value.domainHighlighting
}

function togglePunycodeListMode() {
  settings.value.punycodeListMode = settings.value.punycodeListMode === 'unicode' ? 'ascii' : 'unicode'
}

function displayDomain(domain: string) {
  if (settings.value.punycodeListMode === 'ascii')
    return domain
  return punycode.toUnicode(domain)
}

async function loadDomainData(hostname: string) {
  currentHostname.value = hostname
  baseDomain.value = getDomain(hostname) || ''
  visits.value = {}
  subdomains.value = []

  if (!baseDomain.value)
    return

  const allData = await browser.storage.local.get(null)

  const matched: string[] = []
  for (const key of Object.keys(allData)) {
    if (key === 'settings')
      continue

    if (key === baseDomain.value || key.endsWith(`.${baseDomain.value}`)) {
      matched.push(key)
      visits.value[key] = allData[key]
    }
  }

  // Sort: current hostname first, then alphabetical
  subdomains.value = matched.sort((a, b) => {
    if (a === hostname)
      return -1
    if (b === hostname)
      return 1
    return a.localeCompare(b)
  })
}

function openCheckPage() {
  browser.tabs.create({ url: browser.runtime.getURL('dist/popup/index.html?check=1') })
}

onMounted(async () => {
  // Check if opened with a domain query param (from tooltip "Details" button or context menu)
  const urlParams = new URLSearchParams(window.location.search)
  const domainParam = urlParams.get('domain')

  if (domainParam) {
    isStandalonePage.value = true
    await loadDomainData(domainParam)
    return
  }

  // Standalone "check anything" page opened from the popup button
  if (urlParams.get('check')) {
    isStandalonePage.value = true
    return
  }

  // Default: use active tab's domain
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  if (tabs.length > 0 && tabs[0].url) {
    try {
      const url = new URL(tabs[0].url)
      if (!url.protocol.startsWith('http'))
        return
      await loadDomainData(url.hostname)
    }
    catch (e) {
      console.error('Invalid URL', e)
    }
  }
})
</script>

<template>
  <div :class="isStandalonePage ? 'min-h-screen flex justify-center bg-gray-50 dark:bg-gray-900 py-8' : ''">
    <main
      class="px-4 py-5 text-gray-700 dark:text-gray-200 relative"
      :class="isStandalonePage ? 'w-full max-w-[600px] bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700' : 'w-[600px]'"
      :style="{ fontSize: `${settings.popupFontSize}%` }"
    >
      <div class="flex justify-between items-center mb-4">
        <Logo class="h-8 w-auto" />
        <div class="flex items-center gap-2">
          <!-- Font size controls -->
          <div class="flex items-center gap-1 text-gray-400 dark:text-gray-500">
            <button
              class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-bold"
              title="Decrease font size"
              :disabled="settings.popupFontSize <= 70"
              :class="{ 'opacity-30 cursor-not-allowed': settings.popupFontSize <= 70 }"
              @click="settings.popupFontSize = Math.max(70, settings.popupFontSize - 10)"
            >
              A-
            </button>
            <span class="text-xs w-8 text-center tabular-nums">{{ settings.popupFontSize }}%</span>
            <button
              class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-bold"
              title="Increase font size"
              :disabled="settings.popupFontSize >= 150"
              :class="{ 'opacity-30 cursor-not-allowed': settings.popupFontSize >= 150 }"
              @click="settings.popupFontSize = Math.min(150, settings.popupFontSize + 10)"
            >
              A+
            </button>
          </div>
          <button class="icon-btn text-2xl" :title="translations.settings" @click="openOptionsPage">
            <div i-carbon-settings />
          </button>
        </div>
      </div>

      <!-- Popup: compact button opening the full check page; standalone: the field itself -->
      <button
        v-if="!isStandalonePage"
        class="w-full mb-4 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-500 transition-colors flex items-center justify-center gap-2"
        @click="openCheckPage"
      >
        <div i-carbon-qr-code />
        {{ translations.checkExternalButton }}
      </button>
      <CheckField v-else @checked-domain="loadDomainData" />

      <div v-if="currentHostname">
        <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
          <div class="text-xs uppercase tracking-wider opacity-50 mb-1">
            {{ translations.currentDomain }}
          </div>
          <div class="flex justify-between items-end">
            <div class="secure-domain-display font-bold break-all leading-tight mr-2" style="font-size: 1.8em;">
              <template v-if="isPunycode">
                <div class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-sans font-normal mb-0.5">
                  {{ translations.domainOriginal }}
                </div>
                <SecureText :text="unicodeHostname" />
                <div class="flex items-center gap-1 mt-2 mb-0.5">
                  <div class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-sans font-normal">
                    {{ translations.domainPunycode }}
                  </div>
                  <button
                    class="w-4 h-4 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 text-[10px] font-sans font-bold transition-colors"
                    @click="showPunycodeHelp = !showPunycodeHelp"
                  >
                    ?
                  </button>
                </div>
                <SecureText :text="currentHostname" />
              </template>
              <template v-else>
                <SecureText :text="currentHostname" />
              </template>
            </div>
            <div class="font-mono font-bold" style="font-size: 1.3em;" :class="getCountColor(currentDomainCount)">
              {{ currentDomainCount }}
            </div>
          </div>
          <!-- Anti-Tampering Status -->
          <div class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div
              class="flex items-center gap-1.5 cursor-help"
              :title="`${translations.antiTamperingTooltipWhat}\n\n${isAntiTamperingExcluded ? translations.antiTamperingTooltipOff : translations.antiTamperingTooltipOn}`"
            >
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="isAntiTamperingExcluded ? 'bg-amber-400' : 'bg-green-500'"
              />
              <span class="text-[11px]" :class="isAntiTamperingExcluded ? 'text-amber-600' : 'text-gray-400'">
                {{ isAntiTamperingExcluded ? translations.antiTamperingNotProtected : translations.antiTamperingProtected }}
              </span>
            </div>
            <button
              class="text-[11px] text-blue-500 hover:text-blue-700 hover:underline transition-colors"
              :title="isAntiTamperingExcluded ? translations.antiTamperingTooltipOn : translations.antiTamperingTooltipOff"
              @click="toggleAntiTampering"
            >
              {{ isAntiTamperingExcluded ? translations.antiTamperingEnableForSite : translations.antiTamperingDisableForSite }}
            </button>
          </div>
        </div>

        <div v-if="subdomains.length > 0">
          <div class="mb-2">
            <div class="flex justify-between items-center uppercase tracking-wider mb-1" style="font-size: 0.75em;">
              <span class="opacity-50">{{ translations.baseDomain }}</span>
              <span class="font-mono font-bold" :class="getCountColor(cumulativeCount)">{{ translations.total }}{{ cumulativeCount }}</span>
            </div>
            <div class="secure-domain-display font-bold break-all" style="font-size: 1.1em;">
              <SecureText :text="baseDomain" />
            </div>
          </div>

          <!-- Sort Controls -->
          <div class="flex flex-wrap gap-2 mb-2 items-center" style="font-size: 0.65em;">
            <span class="opacity-50">{{ translations.sortBy }}</span>
            <button
              class="btn-ghost btn-sm !rounded"
              :class="settings.sortOption === 'name' ? '!bg-blue-100 !border-blue-200 !text-blue-700 dark:!bg-blue-900/40 dark:!border-blue-700 dark:!text-blue-300' : ''"
              @click="setSortOption('name')"
            >
              {{ translations.sortByName }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded"
              :class="settings.sortOption === 'visits' ? '!bg-blue-100 !border-blue-200 !text-blue-700 dark:!bg-blue-900/40 dark:!border-blue-700 dark:!text-blue-300' : ''"
              @click="setSortOption('visits')"
            >
              {{ translations.sortByVisits }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded ml-auto w-6 flex items-center justify-center"
              :title="translations.toggleSortOrder"
              @click="toggleSortOrder"
            >
              {{ settings.sortOrder === 'asc' ? '↑' : '↓' }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
              :title="translations.toggleCase"
              @click="toggleDomainCase"
            >
              {{ settings.domainCase === 'upper' ? 'Aa' : 'AA' }}
            </button>
            <button
              class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center"
              :title="translations.toggleHighlighting"
              :aria-label="translations.toggleHighlighting"
              @click="toggleHighlighting"
            >
              🌈
            </button>
            <button
              class="btn-ghost btn-sm !rounded w-6 flex items-center justify-center font-bold"
              :title="translations.togglePunycodeListMode"
              :aria-label="translations.togglePunycodeListMode"
              @click="togglePunycodeListMode"
            >
              {{ settings.punycodeListMode === 'unicode' ? 'P' : 'O' }}
            </button>
          </div>

          <div class="uppercase tracking-wider mb-1 opacity-50" style="font-size: 0.75em;">
            {{ translations.subdomains }}
          </div>
          <div
            class="overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 shadow-sm"
            :class="isStandalonePage ? '' : 'max-h-[265px]'"
            style="font-size: 1.1em;"
          >
            <div
              v-for="domain in sortedSubdomains" :key="domain"
              class="p-2.5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              :class="{ 'bg-blue-50 hover:bg-blue-50 dark:bg-blue-900/30 dark:hover:bg-blue-900/30': domain === currentHostname }"
            >
              <span class="truncate flex-1 mr-3 secure-domain-display" :title="domain">
                <SecureText :text="displayDomain(domain)" />
                <span v-if="domain === currentHostname" class="ml-1 text-[10px] text-blue-500 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 px-1 rounded font-sans">{{ translations.current }}</span>
              </span>
              <span class="font-mono font-bold" :class="getCountColor(visits[domain]?.count)">
                {{ visits[domain]?.count || 0 }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="mt-4 text-sm opacity-50 text-center py-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          {{ translations.noVisitData }}
        </div>
      </div>
      <!-- Hidden on the standalone check page until something is checked -->
      <div v-else-if="!isStandalonePage" class="py-8 text-center opacity-50">
        <div class="text-4xl mb-2">
          🌍
        </div>
        <div>{{ translations.visitWebsite }}</div>
      </div>

      <!-- Punycode Help Modal -->
      <div v-if="showPunycodeHelp" class="absolute inset-0 bg-black/10 dark:bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-[90%] border border-gray-100 dark:border-gray-700 relative text-left">
          <button class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" @click="showPunycodeHelp = false">
            <div i-carbon-close class="text-lg" />
          </button>
          <h3 class="font-bold text-base mb-3 text-gray-900 dark:text-gray-100 font-sans pr-6">
            {{ translations.punycodeHelpTitle }}
          </h3>
          <div class="text-xs text-gray-600 dark:text-gray-400 font-sans whitespace-pre-wrap leading-relaxed">
            {{ translations.punycodeHelpContent }}
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
/* Prevent popup-level scrollbar */
html, body {
  overflow: hidden;
}

/* Hide scrollbar for Chrome, Safari and Opera */
.overflow-y-auto::-webkit-scrollbar {
  display: none;
}

/* Hide scrollbar for IE, Edge and Firefox */
.overflow-y-auto {
  -ms-overflow-style: none;  /* IE and Edge */
  scrollbar-width: none;  /* Firefox */
}
</style>
