<script setup lang="ts">
import { getDomain } from 'tldts'
import { computed, onMounted, ref } from 'vue'
import { settings } from '~/logic/storage'
import Logo from '../components/Logo.vue'

const currentHostname = ref('')
const rootDomain = ref('')
const visits = ref<Record<string, any>>({})
const relatedDomains = ref<string[]>([])

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

function formatDomain(domain: string) {
  if (!domain)
    return ''
  return settings.value.domainCase === 'upper' ? domain.toUpperCase() : domain.toLowerCase()
}

function toggleDomainCase() {
  settings.value.domainCase = settings.value.domainCase === 'upper' ? 'lower' : 'upper'
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
  <main class="w-[600px] px-4 py-5 text-gray-700">
    <div class="flex justify-between items-center mb-4">
      <Logo class="h-8 w-auto" />
      <button class="icon-btn text-2xl" title="Settings" @click="openOptionsPage">
        <div i-carbon-settings />
      </button>
    </div>

    <div v-if="currentHostname">
      <div class="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
        <div class="text-xs uppercase tracking-wider opacity-50 mb-1">
          Current Domain
        </div>
        <div class="flex justify-between items-end">
          <div class="font-mono font-bold break-all text-lg leading-tight mr-2">
            {{ formatDomain(currentHostname) }}
          </div>
          <div class="font-mono font-bold text-xl" :class="getCountColor(currentDomainCount)">
            {{ currentDomainCount }}
          </div>
        </div>
      </div>

      <div v-if="relatedDomains.length > 0">
        <div class="mb-2">
          <div class="flex justify-between items-center text-xs uppercase tracking-wider opacity-50 mb-1">
            <span>Family Visits</span>
            <span class="font-mono font-bold" :class="getCountColor(cumulativeCount)">Total: {{ cumulativeCount }}</span>
          </div>
          <div class="font-mono font-bold text-sm break-all">
            {{ formatDomain(rootDomain) }}
          </div>
        </div>

        <!-- Sort Controls -->
        <div class="flex gap-2 mb-2 text-[10px] items-center">
          <span class="opacity-50">Sort by</span>
          <button
            class="px-2 py-1 rounded border transition-colors"
            :class="settings.sortOption === 'name' ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'"
            @click="setSortOption('name')"
          >
            Name
          </button>
          <button
            class="px-2 py-1 rounded border transition-colors"
            :class="settings.sortOption === 'visits' ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'"
            @click="setSortOption('visits')"
          >
            Visits
          </button>
          <button
            class="px-2 py-1 rounded border bg-gray-50 border-gray-200 ml-auto hover:bg-gray-100 transition-colors w-6 flex items-center justify-center"
            title="Toggle Sort Order"
            @click="toggleSortOrder"
          >
            {{ settings.sortOrder === 'asc' ? '↑' : '↓' }}
          </button>
          <button
            class="px-2 py-1 rounded border bg-gray-50 border-gray-200 hover:bg-gray-100 transition-colors w-6 flex items-center justify-center"
            title="Toggle Case"
            @click="toggleDomainCase"
          >
            {{ settings.domainCase === 'upper' ? 'Aa' : 'AA' }}
          </button>
        </div>

        <div class="max-h-[300px] overflow-y-auto text-sm border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-sm">
          <div
            v-for="domain in sortedRelatedDomains" :key="domain"
            class="p-2.5 flex justify-between items-center hover:bg-gray-50 transition-colors"
            :class="{ 'bg-blue-50 hover:bg-blue-50': domain === currentHostname }"
          >
            <span class="truncate flex-1 mr-3" :title="domain">
              {{ formatDomain(domain) }}
              <span v-if="domain === currentHostname" class="ml-1 text-[10px] text-blue-500 bg-blue-100 px-1 rounded">CURRENT</span>
            </span>
            <span class="font-mono font-bold" :class="getCountColor(visits[domain]?.count)">
              {{ visits[domain]?.count || 0 }}
            </span>
          </div>
        </div>
      </div>
      <div v-else class="mt-4 text-sm opacity-50 text-center py-4 bg-gray-50 rounded-lg">
        No visit data found for this domain family.
      </div>
    </div>
    <div v-else class="py-8 text-center opacity-50">
      <div class="text-4xl mb-2">
        🌍
      </div>
      <div>Visit a website to see stats</div>
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
