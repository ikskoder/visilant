<script setup lang="ts">
import type { HistoryImportState } from '~/logic/history-import'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { HISTORY_IMPORT_STATE_KEY, readHistoryImportState } from '~/logic/history-import'
import { isolatePageZoom } from '~/logic/page-zoom'

const { t, isLoaded } = useI18n()
useTheme()

// The import runs in the background, so this page is a viewer of the published
// state, not its owner: it may be opened while the import runs, after it has
// finished, or reloaded halfway through.
const state = ref<HistoryImportState | null>(null)
const retrying = ref(false)

const status = computed(() => state.value?.status ?? 'running')
const isRunning = computed(() => status.value === 'running' || retrying.value)

/**
 * Result of the last pass that finished.
 *
 * The import runs twice – a fast counting pass, then a slow detail pass – and the
 * second one starts by publishing zeroes. Holding on to the last finished figures
 * keeps the page from blanking its own good news halfway through.
 */
const doneStats = ref<{ domains: number, visits: number } | null>(null)

function rememberIfDone(current: HistoryImportState | null) {
  if (current?.status === 'done')
    doneStats.value = { domains: current.domains, visits: current.visits }
}

/** True once nothing is left to do – both passes are in, or the import gave up. */
const isFinished = computed(() => !isRunning.value && (doneStats.value !== null || status.value === 'failed'))

// ==========================================
// Telling the user on a tab they are not looking at
// ==========================================

const pageTitle = document.title
let flashTimer: ReturnType<typeof setInterval> | null = null

function stopFlashing() {
  if (flashTimer !== null) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  document.title = pageTitle
}

/**
 * Blink the tab title when the import lands while the user is elsewhere.
 *
 * The import can take minutes and nobody should be asked to sit and watch it, so
 * the finish has to be visible from another tab. It stops the moment the page is
 * looked at, which is also the moment the news has been delivered.
 */
function startFlashing() {
  if (flashTimer !== null || !document.hidden)
    return

  let on = true
  document.title = `✅ ${t.value('welcomeTabDone')}`
  flashTimer = setInterval(() => {
    on = !on
    document.title = on ? `✅ ${t.value('welcomeTabDone')}` : pageTitle
  }, 1200)
}

function onVisibilityChange() {
  if (!document.hidden)
    stopFlashing()
}

watch(isFinished, (finished) => {
  // The quick pass finishing looks like an ending for the moment before the
  // detail pass announces itself, and that blink must not leave the title stuck
  if (finished)
    startFlashing()
  else
    stopFlashing()
})

/**
 * Percentage for the bar, or null while the phase has nothing to count.
 *
 * Reading the history is a single call that reports no progress, and it is the
 * slow part on a large profile – an honest indeterminate bar beats a fake one
 * creeping forward.
 */
const progress = computed(() => {
  const current = state.value
  if (!current || !current.total)
    return null
  return Math.round((current.current / current.total) * 100)
})

const runningLabel = computed(() => {
  // Once the counting pass is in, the slow pass is detail work and should say so
  // rather than repeating a progress line that suggests nothing works yet
  if (doneStats.value && state.value?.mode === 'full')
    return t.value('welcomeDetailsRunning')
  return state.value?.phase === 'saving' ? t.value('welcomeStatusSaving') : t.value('welcomeStatusReading')
})

function onStorageChanged(changes: Record<string, { newValue?: unknown }>, area: string) {
  if (area !== 'local')
    return
  const change = changes[HISTORY_IMPORT_STATE_KEY]
  if (change?.newValue) {
    state.value = change.newValue as HistoryImportState
    rememberIfDone(state.value)
  }
}

onMounted(async () => {
  // Same origin as the popup, so a zoom chosen here must stay here
  isolatePageZoom()

  state.value = await readHistoryImportState()
  rememberIfDone(state.value)
  browser.storage.onChanged.addListener(onStorageChanged)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  browser.storage.onChanged.removeListener(onStorageChanged)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopFlashing()
})

async function retry() {
  retrying.value = true
  try {
    await browser.runtime.sendMessage({ type: 'run-history-import', data: {} })
  }
  finally {
    retrying.value = false
    state.value = await readHistoryImportState()
    rememberIfDone(state.value)
  }
}

function openSettings() {
  browser.runtime.openOptionsPage()
}

function close() {
  window.close()
}
</script>

<template>
  <main class="px-4 py-10 text-gray-700 dark:text-gray-200">
    <div v-if="!isLoaded" class="flex justify-center items-center h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
    </div>

    <div v-else class="max-w-xl mx-auto space-y-6">
      <div class="text-center">
        <Logo style="max-width: 300px;" class="mx-auto" />
        <h1 class="text-xl font-bold">
          {{ t('welcomeTitle') }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t('welcomeSubtitle') }}
        </p>
      </div>

      <!-- Why this happens at all. First thing on the page on purpose: an import
           nobody asked for needs its reason next to it, not in a FAQ. -->
      <section class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">
          {{ t('welcomeWhyTitle') }}
        </h2>
        <p class="text-sm leading-relaxed">
          {{ t('welcomeWhyBody') }}
        </p>
      </section>

      <!-- Import status -->
      <section class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <template v-if="doneStats">
          <div class="flex gap-8">
            <div>
              <div class="text-2xl font-bold">
                {{ doneStats.domains.toLocaleString() }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('welcomeStatSites') }}
              </div>
            </div>
            <div>
              <div class="text-2xl font-bold">
                {{ doneStats.visits.toLocaleString() }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('welcomeStatVisits') }}
              </div>
            </div>
          </div>
          <p class="text-sm mt-3">
            {{ t('welcomeStatusDone') }}
          </p>
        </template>

        <!-- What is still going on, under the numbers rather than instead of them -->
        <div v-if="isRunning" :class="doneStats ? 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700' : ''">
          <div class="flex items-center gap-3">
            <div class="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500 flex-shrink-0" />
            <span class="text-sm" :class="doneStats ? 'text-gray-500 dark:text-gray-400' : 'font-medium'">
              {{ runningLabel }}
            </span>
          </div>
          <div class="w-full h-1 mt-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              v-if="progress !== null"
              class="h-full bg-blue-500 transition-all duration-200"
              :style="{ width: `${progress}%` }"
            />
            <div v-else class="h-full w-1/3 bg-blue-500 welcome-indeterminate" />
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {{ t('welcomeKeepOpen') }}
          </p>
        </div>

        <!-- No history to read in this browser, which is Firefox for Android.
             Nothing failed, so there is nothing to retry – the profile fills up
             as the user browses instead -->
        <template v-else-if="status === 'unsupported'">
          <p class="text-sm text-amber-600 dark:text-amber-400">
            {{ t('welcomeStatusUnsupported') }}
          </p>
        </template>

        <!-- Nothing was imported at all: the extension really is blind until this is fixed -->
        <template v-else-if="!doneStats">
          <p class="text-sm">
            {{ status === 'cancelled' ? t('welcomeStatusCancelled') : t('welcomeStatusFailed') }}
          </p>
          <button class="btn-primary mt-3" @click="retry">
            {{ t('welcomeRetry') }}
          </button>
        </template>

        <!-- Counted, but the detail pass gave up: worth saying, not worth alarming over -->
        <div v-else-if="status !== 'done'" class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('welcomeDetailsFailed') }}
          </p>
          <button class="btn-ghost btn-sm mt-3" @click="retry">
            {{ t('welcomeRetry') }}
          </button>
        </div>
      </section>

      <!-- What the import actually took, in the terms it is stored in -->
      <section class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">
          {{ t('welcomeSavedTitle') }}
        </h2>
        <ul class="text-sm space-y-1 list-disc list-inside">
          <li>{{ t('welcomeSavedHostname') }}</li>
          <li>{{ t('welcomeSavedCount') }}</li>
          <li>{{ t('welcomeSavedFirstSeen') }}</li>
          <li>{{ t('welcomeSavedLastSeen') }}</li>
          <li>{{ t('welcomeSavedActiveDays') }}</li>
        </ul>
        <!-- The figures are only as deep as the browser's own retention, which is
             the usual reason a rarely visited but long-known site stays under the
             familiarity threshold at first. The counter takes over from here, so
             the gap is a starting condition rather than a permanent one -->
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
          {{ t('welcomeSavedRetention') }}
        </p>
        <h3 class="text-sm font-semibold mt-4 mb-1">
          {{ t('welcomeNotSavedTitle') }}
        </h3>
        <p class="text-sm">
          {{ t('welcomeNotSaved') }}
        </p>
      </section>

      <section class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">
          {{ t('welcomeStorageTitle') }}
        </h2>
        <p class="text-sm leading-relaxed">
          {{ t('welcomeStorageBody') }}
        </p>
      </section>

      <!-- Defaults are one person's guess without any data behind them, and the
           settings are where the extension explains itself best -->
      <section class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">
          {{ t('welcomeDefaultsTitle') }}
        </h2>
        <p class="text-sm leading-relaxed">
          {{ t('welcomeDefaultsBody') }}
        </p>
      </section>

      <div class="flex gap-3 justify-center pb-6">
        <button class="btn-primary" @click="close">
          {{ t('welcomeDone') }}
        </button>
        <button class="btn-ghost" @click="openSettings">
          {{ t('welcomeOpenSettings') }}
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* The reading phase has no count to show, so the bar sweeps instead of filling */
.welcome-indeterminate {
  animation: welcome-sweep 1.2s ease-in-out infinite;
}

@keyframes welcome-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
</style>
