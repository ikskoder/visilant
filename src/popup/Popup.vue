<script setup lang="ts">
import punycode from 'punycode'
import { getDomain } from 'tldts'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { settings } from '~/logic/storage'
import Logo from '../components/Logo.vue'
import SecureText from '../components/SecureText.vue'

const { t, isLoaded, loadedTranslations } = useI18n()

// Reactive translations
const translations = ref<Record<string, string>>({})

// Function to update translations
function updateTranslations() {
  if (!isLoaded.value)
    return

  const translationKeys = [
    'currentDomain',
    'familyVisits',
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

const currentHostname = ref('')
const rootDomain = ref('')
const visits = ref<Record<string, any>>({})
const relatedDomains = ref<string[]>([])
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
  return relatedDomains.value.reduce((acc, domain) => {
    return acc + (visits.value[domain]?.count || 0)
  }, 0)
})

const currentDomainCount = computed(() => {
  return visits.value[currentHostname.value]?.count || 0
})

const sortedRelatedDomains = computed(() => {
  const domains = [...relatedDomains.value]

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

function getCountColor(count: number) {
  const threshold = settings.value.safety
  return count >= threshold ? 'text-green-600' : 'text-red-500'
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

onMounted(async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  if (tabs.length > 0 && tabs[0].url) {
    try {
      const url = new URL(tabs[0].url)
      // Only handle http/https
      if (!url.protocol.startsWith('http'))
        return

      currentHostname.value = url.hostname
      rootDomain.value = getDomain(currentHostname.value) || ''

      if (!rootDomain.value)
        return

      const allData = await browser.storage.local.get(null)

      // Filter for related domains
      const related: string[] = []
      for (const key of Object.keys(allData)) {
        if (key === 'settings')
          continue // Skip settings

        // Check if key is the root domain or a subdomain of it
        if (key === rootDomain.value || key.endsWith(`.${rootDomain.value}`)) {
          related.push(key)
          visits.value[key] = allData[key]
        }
      }

      // Sort: current hostname first, then alphabetical
      relatedDomains.value = related.sort((a, b) => {
        if (a === currentHostname.value)
          return -1
        if (b === currentHostname.value)
          return 1
        return a.localeCompare(b)
      })
    }
    catch (e) {
      console.error('Invalid URL', e)
    }
  }
})
</script>

<template>
  <main class="w-[600px] min-h-[400px] px-4 py-5 text-gray-700 relative" :style="{ fontSize: `${settings.popupFontSize}%` }">
    <div class="flex justify-between items-center mb-4">
      <Logo class="h-8 w-auto" />
      <div class="flex items-center gap-2">
        <!-- Font size controls -->
        <div class="flex items-center gap-1 text-gray-400">
          <button
            class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-sm font-bold"
            title="Decrease font size"
            :disabled="settings.popupFontSize <= 70"
            :class="{ 'opacity-30 cursor-not-allowed': settings.popupFontSize <= 70 }"
            @click="settings.popupFontSize = Math.max(70, settings.popupFontSize - 10)"
          >
            A-
          </button>
          <span class="text-xs w-8 text-center tabular-nums">{{ settings.popupFontSize }}%</span>
          <button
            class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-sm font-bold"
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

    <div v-if="currentHostname">
      <div class="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
        <div class="text-xs uppercase tracking-wider opacity-50 mb-1">
          {{ translations.currentDomain }}
        </div>
        <div class="flex justify-between items-end">
          <div class="secure-domain-display font-bold break-all leading-tight mr-2" style="font-size: 1.8em;">
            <template v-if="isPunycode">
              <div class="text-[10px] uppercase tracking-wider text-gray-400 font-sans font-normal mb-0.5">
                {{ translations.domainOriginal }}
              </div>
              <SecureText :text="unicodeHostname" />
              <div class="flex items-center gap-1 mt-2 mb-0.5">
                <div class="text-[10px] uppercase tracking-wider text-gray-400 font-sans font-normal">
                  {{ translations.domainPunycode }}
                </div>
                <button
                  class="w-4 h-4 flex items-center justify-center rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 text-[10px] font-sans font-bold transition-colors"
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
      </div>

      <div v-if="relatedDomains.length > 0">
        <div class="mb-2">
          <div class="flex justify-between items-center uppercase tracking-wider mb-1" style="font-size: 0.75em;">
            <span class="opacity-50">{{ translations.familyVisits }}</span>
            <span class="font-mono font-bold" :class="getCountColor(cumulativeCount)">{{ translations.total }}{{ cumulativeCount }}</span>
          </div>
          <div class="secure-domain-display font-bold break-all" style="font-size: 1.1em;">
            <SecureText :text="rootDomain" />
          </div>
        </div>

        <!-- Sort Controls -->
        <div class="flex gap-2 mb-2 items-center" style="font-size: 0.65em;">
          <span class="opacity-50">{{ translations.sortBy }}</span>
          <button
            class="px-2 py-1 rounded border transition-colors"
            :class="settings.sortOption === 'name' ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'"
            @click="setSortOption('name')"
          >
            {{ translations.sortByName }}
          </button>
          <button
            class="px-2 py-1 rounded border transition-colors"
            :class="settings.sortOption === 'visits' ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'"
            @click="setSortOption('visits')"
          >
            {{ translations.sortByVisits }}
          </button>
          <button
            class="px-2 py-1 rounded border bg-gray-50 border-gray-200 ml-auto hover:bg-gray-100 transition-colors w-6 flex items-center justify-center"
            :title="translations.toggleSortOrder"
            @click="toggleSortOrder"
          >
            {{ settings.sortOrder === 'asc' ? '↑' : '↓' }}
          </button>
          <button
            class="px-2 py-1 rounded border bg-gray-50 border-gray-200 hover:bg-gray-100 transition-colors w-6 flex items-center justify-center"
            :title="translations.toggleCase"
            @click="toggleDomainCase"
          >
            {{ settings.domainCase === 'upper' ? 'Aa' : 'AA' }}
          </button>
          <button
            class="px-2 py-1 rounded border bg-gray-50 border-gray-200 hover:bg-gray-100 transition-colors w-6 flex items-center justify-center"
            :title="translations.toggleHighlighting"
            :aria-label="translations.toggleHighlighting"
            @click="toggleHighlighting"
          >
            🌈
          </button>
          <button
            class="px-2 py-1 rounded border bg-gray-50 border-gray-200 hover:bg-gray-100 transition-colors w-6 flex items-center justify-center font-bold"
            :title="translations.togglePunycodeListMode"
            :aria-label="translations.togglePunycodeListMode"
            @click="togglePunycodeListMode"
          >
            {{ settings.punycodeListMode === 'unicode' ? 'P' : 'O' }}
          </button>
        </div>

        <div class="max-h-[300px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-sm" style="font-size: 1.1em;">
          <div
            v-for="domain in sortedRelatedDomains" :key="domain"
            class="p-2.5 flex justify-between items-center hover:bg-gray-50 transition-colors"
            :class="{ 'bg-blue-50 hover:bg-blue-50': domain === currentHostname }"
          >
            <span class="truncate flex-1 mr-3 secure-domain-display" :title="domain">
              <SecureText :text="displayDomain(domain)" />
              <span v-if="domain === currentHostname" class="ml-1 text-[10px] text-blue-500 bg-blue-100 px-1 rounded font-sans">{{ translations.current }}</span>
            </span>
            <span class="font-mono font-bold" :class="getCountColor(visits[domain]?.count)">
              {{ visits[domain]?.count || 0 }}
            </span>
          </div>
        </div>
      </div>
      <div v-else class="mt-4 text-sm opacity-50 text-center py-4 bg-gray-50 rounded-lg">
        {{ translations.noVisitData }}
      </div>
    </div>
    <div v-else class="py-8 text-center opacity-50">
      <div class="text-4xl mb-2">
        🌍
      </div>
      <div>{{ translations.visitWebsite }}</div>
    </div>

    <!-- Punycode Help Modal -->
    <div v-if="showPunycodeHelp" class="absolute inset-0 bg-black/10 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-[90%] border border-gray-100 relative text-left">
        <button class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors" @click="showPunycodeHelp = false">
          <div i-carbon-close class="text-lg" />
        </button>
        <h3 class="font-bold text-base mb-3 text-gray-900 font-sans pr-6">
          {{ translations.punycodeHelpTitle }}
        </h3>
        <div class="text-xs text-gray-600 font-sans whitespace-pre-wrap leading-relaxed">
          {{ translations.punycodeHelpContent }}
        </div>
      </div>
    </div>
  </main>
</template>

<style>
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
