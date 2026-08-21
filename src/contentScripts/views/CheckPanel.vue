<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import type { CheckPanelData } from '~/logic/ui-state'
import punycode from 'punycode'
import { computed, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { settings } from '~/logic/storage'
import { isTrackableHostname } from '~/logic/visit-stats'

const props = defineProps<{
  visible: boolean
  data: CheckPanelData | null
  fontSize: number
  isDark: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()

// Local display toggles – start from the global settings but only affect this panel
const localHighlight = ref(settings.value.domainHighlighting)
const localCase = ref<'lower' | 'upper'>(settings.value.domainCase)
const localPunycodeMode = ref<'unicode' | 'ascii'>(settings.value.punycodeListMode)

watch(() => props.visible, (visible) => {
  if (visible) {
    localHighlight.value = settings.value.domainHighlighting
    localCase.value = settings.value.domainCase
    localPunycodeMode.value = settings.value.punycodeListMode
  }
})

// Escape closes the panel while it is open
watch(() => props.visible, (visible) => {
  if (visible)
    window.addEventListener('keydown', onKeydown, true)
  else
    window.removeEventListener('keydown', onKeydown, true)
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

// Same convention as the popup row: a button shows the state it is in, and the
// tooltip says what pressing it will do
const highlightingTitle = computed(() => {
  const action = localHighlight.value
    ? t.value('highlightingTurnOff')
    : t.value('highlightingTurnOn')
  return `${action}\n\n${t.value('highlightingLegend')}`
})

const caseTitle = computed(() => localCase.value === 'upper'
  ? t.value('caseToLower')
  : t.value('caseToUpper'))

const punycodeTitle = computed(() => localPunycodeMode.value === 'unicode'
  ? t.value('punycodeShowAscii')
  : t.value('punycodeShowUnicode'))

function displayDomain(domain: string) {
  if (localPunycodeMode.value === 'ascii')
    return domain
  try {
    return punycode.toUnicode(domain)
  }
  catch {
    return domain
  }
}

const familiarityRules = computed(() => normalizeFamiliarity(settings.value.familiarity))

/**
 * The whole family's facts, which is what the verdict is about.
 *
 * Falls back to the bare total for a background too old to send them, so the
 * panel still says something rather than treating every site as brand new.
 */
const familyStats = computed<FamiliarityStats>(() =>
  props.data?.family.stats ?? { count: props.data?.family.total ?? 0 })

/**
 * Where the mail of an address domain is read, when that is somewhere else.
 *
 * `gmail.com` is never opened by anyone, so its own family is an unmovable zero.
 * The sites below are the ones the visits are on.
 */
const mailSites = computed(() => props.data?.family.mailSites ?? [])

function countColor(stats: FamiliarityStats) {
  return isFamiliar(stats, familiarityRules.value)
    ? (props.isDark ? 'text-green-400' : 'text-green-600')
    : (props.isDark ? 'text-red-400' : 'text-red-500')
}

// Hostnames without a dot are never counted, so there is no visit verdict to
// give. Same reasoning as the popup: a zero that can never change is not an
// answer, and colouring it red says something about the address that is untrue.
const isUntrackedHost = computed(() => {
  const hostname = props.data?.hostname
  return Boolean(hostname) && !isTrackableHostname(hostname!)
})

function statusBadge(stats: FamiliarityStats, hostname: string) {
  const count = stats.count
  if (!isTrackableHostname(hostname))
    return { text: t.value('untrackedHostBadge'), class: props.isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600' }
  if (isFamiliar(stats, familiarityRules.value))
    return { text: t.value('linkTooltipFamiliar'), class: props.isDark ? 'bg-green-900/40 text-green-400' : 'bg-green-100 text-green-700' }
  if (count === 0)
    return { text: t.value('linkTooltipNeverVisited'), class: props.isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700' }
  return { text: t.value('linkTooltipUnfamiliar'), class: props.isDark ? 'bg-yellow-900/40 text-yellow-400' : 'bg-yellow-100 text-yellow-700' }
}
</script>

<template>
  <Transition name="panel-fade">
    <div
      v-if="visible && data"
      class="fixed inset-0 z-[2147483647] pointer-events-auto flex items-center justify-center p-4"
      style="background: rgba(0, 0, 0, 0.45);"
      @click.self="emit('close')"
    >
      <div
        class="panel-container rounded-xl shadow-2xl p-4"
        :class="isDark ? 'bg-gray-900 border border-gray-700/50 text-gray-200' : 'bg-white border border-gray-200 text-gray-800'"
        :style="{ fontSize: `${fontSize / 100}em` }"
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-3">
          <span class="panel-label uppercase tracking-wider" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
            {{ t('checkPanelTitle') }}
          </span>
          <button
            class="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
            :class="isDark ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <!-- Email: full address, local part included, with local display toggles -->
        <div v-if="data.kind === 'email' && data.email" class="mb-2">
          <div class="flex items-center flex-wrap gap-1.5 mb-1">
            <span class="panel-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">{{ t('emailTooltipTitle') }}</span>
            <span v-if="data.email.providerKind === 'disposable'" class="panel-label px-1.5 py-0.5 rounded" :class="isDark ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700'">
              {{ t('emailDisposableDomain') }}
            </span>
            <span v-else-if="data.email.providerKind === 'public'" class="panel-label px-1.5 py-0.5 rounded" :class="isDark ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-700'">
              {{ t('emailPublicProvider') }}
            </span>
            <span v-else class="panel-label px-1.5 py-0.5 rounded" :class="statusBadge(familyStats, data.hostname).class">
              {{ statusBadge(familyStats, data.hostname).text.toLowerCase() }}
            </span>
          </div>
          <div class="panel-label uppercase tracking-wider mb-0.5" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
            {{ t('emailAccountName') }}
          </div>
          <div class="panel-address font-bold">
            <SecureText :text="data.email.analysis.localPart" :highlight-override="localHighlight" :case-override="localCase" />
          </div>
          <div class="panel-label uppercase tracking-wider mt-1.5 mb-0.5" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
            {{ t('emailDomainLabel') }}
          </div>
          <div class="panel-address font-bold">
            <SecureText :text="data.email.analysis.domain" :highlight-override="localHighlight" :case-override="localCase" />
          </div>
          <div v-if="data.email.analysis.suspiciousPattern" class="panel-label mt-1" :class="isDark ? 'text-red-400' : 'text-red-600'">
            ⚠ {{ t('emailSuspiciousPattern') }} (.{{ data.email.analysis.suspiciousPattern.label }})
          </div>
          <div v-if="data.email.analysis.local.hasUnicode" class="panel-label mt-1" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
            ⚠ {{ t('emailLocalUnicodeWarning') }}
          </div>
          <div v-if="data.email.providerKind === 'public'" class="panel-label mt-1" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
            {{ t('emailPublicProviderHint') }}
          </div>
          <div v-else-if="data.email.providerKind === 'disposable'" class="panel-label mt-1" :class="isDark ? 'text-red-400' : 'text-red-600'">
            ⚠ {{ t('emailDisposableHint') }}
          </div>
        </div>

        <!-- Domain: checked hostname -->
        <div v-else class="mb-2">
          <div class="flex items-center flex-wrap gap-1.5 mb-1">
            <span class="panel-label px-1.5 py-0.5 rounded" :class="statusBadge(familyStats, data.hostname).class">
              {{ statusBadge(familyStats, data.hostname).text.toLowerCase() }}
            </span>
          </div>
          <div class="panel-address font-bold">
            <SecureText :text="displayDomain(data.hostname)" :highlight-override="localHighlight" :case-override="localCase" />
          </div>
        </div>

        <!-- Punycode. Skipped when it would repeat the hostname verbatim -->
        <div v-if="data.punycode && data.punycode !== data.hostname" class="panel-label mb-2 break-all" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
          {{ t('linkTooltipPunycode') }}: {{ data.punycode }}
        </div>

        <!-- Why there are no numbers below, said before they are missed -->
        <div
          v-if="isUntrackedHost"
          class="mb-2 p-2 rounded-lg"
          :class="isDark ? 'bg-blue-900/20 border border-blue-800/50 text-blue-200' : 'bg-blue-50 border border-blue-100 text-blue-900'"
        >
          <div class="panel-label font-bold" :class="isDark ? 'text-blue-300' : 'text-blue-800'">
            {{ t('untrackedHostTitle') }}
          </div>
          <div class="panel-label mt-0.5">
            {{ t('untrackedHostText') }}
          </div>
        </div>

        <!-- Structural markers -->
        <DomainMarkers :hostname="data.hostname" class="panel-label" />
        <LookalikeNotice :hostname="data.hostname" :context="data.kind === 'email' ? 'email' : undefined" class="panel-label" />

        <!-- Local display toggles -->
        <div class="flex items-center gap-1.5 mb-2">
          <!-- A plain Latin address looks the same either way, so the button has
               to carry its own state -->
          <button
            class="panel-toggle"
            :class="[isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-100', localHighlight ? (isDark ? 'bg-blue-900/40' : 'bg-blue-100') : 'grayscale opacity-60']"
            :title="highlightingTitle"
            :aria-label="highlightingTitle"
            :aria-pressed="localHighlight"
            @click="localHighlight = !localHighlight"
          >
            🌈
          </button>
          <button
            class="panel-toggle font-bold"
            :class="isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-100'"
            :title="caseTitle"
            :aria-label="caseTitle"
            @click="localCase = localCase === 'upper' ? 'lower' : 'upper'"
          >
            {{ localCase === 'upper' ? 'AA' : 'aa' }}
          </button>
          <button
            class="panel-toggle font-bold"
            :class="isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-100'"
            :title="punycodeTitle"
            :aria-label="punycodeTitle"
            @click="localPunycodeMode = localPunycodeMode === 'unicode' ? 'ascii' : 'unicode'"
          >
            {{ localPunycodeMode === 'unicode' ? 'O' : 'P' }}
          </button>
        </div>

        <!-- Domain family, same info as the extension popup. Dropped entirely for
             an untracked host: the family is the address itself, and every number
             in it would be a zero that can never move. -->
        <div v-if="!isUntrackedHost" class="pt-2" :class="isDark ? 'border-t border-gray-700/50' : 'border-t border-gray-200'">
          <div class="flex justify-between items-center mb-1">
            <span class="panel-label uppercase tracking-wider" :class="isDark ? 'text-gray-500' : 'text-gray-400'">{{ t('baseDomain') }}</span>
            <!-- With the mailbox listed below, this zero is a fact about a name
                 nobody opens rather than a verdict, so it is not painted as one -->
            <span
              class="panel-label font-mono font-bold"
              :class="mailSites.length ? (isDark ? 'text-gray-500' : 'text-gray-400') : countColor(familyStats)"
            >{{ t('total') }}{{ data.family.total }}</span>
          </div>
          <div class="font-bold break-all mb-2">
            <SecureText :text="displayDomain(data.family.baseDomain)" :highlight-override="localHighlight" :case-override="localCase" />
          </div>

          <!-- An address domain has no site of its own – say where its mail lives -->
          <template v-if="mailSites.length">
            <div class="panel-label uppercase tracking-wider mb-1" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
              {{ t('mailSiteLabel') }}
            </div>
            <div
              class="panel-list rounded-lg border divide-y shadow-sm mb-1"
              :class="isDark ? 'border-gray-700 divide-gray-700' : 'border-gray-200 divide-gray-100'"
            >
              <div
                v-for="site in mailSites"
                :key="site.site"
                class="p-2.5 flex justify-between items-center gap-3"
              >
                <span class="break-all panel-entry">
                  <SecureText :text="displayDomain(site.site)" :highlight-override="localHighlight" :case-override="localCase" />
                </span>
                <span class="font-mono font-bold panel-entry flex-shrink-0" :class="countColor(site.stats)">{{ site.total }}</span>
              </div>
            </div>
            <div class="panel-label mb-2" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
              {{ t('mailSiteNote') }}
            </div>
          </template>

          <template v-if="data.family.entries.length > 0">
            <div class="panel-label uppercase tracking-wider mb-1" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
              {{ t('subdomains') }}
            </div>
            <div
              class="panel-list rounded-lg border divide-y overflow-y-auto shadow-sm"
              :class="isDark ? 'border-gray-700 divide-gray-700' : 'border-gray-200 divide-gray-100'"
              style="max-height: 265px;"
            >
              <div
                v-for="entry in data.family.entries"
                :key="entry.hostname"
                class="p-2.5 flex justify-between items-center gap-3 transition-colors"
                :class="entry.hostname === data.hostname
                  ? (isDark ? 'bg-blue-900/30' : 'bg-blue-50')
                  : (isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50')"
              >
                <span class="break-all panel-entry">
                  <SecureText :text="displayDomain(entry.hostname)" :highlight-override="localHighlight" :case-override="localCase" />
                </span>
                <span class="font-mono font-bold panel-entry flex-shrink-0" :class="countColor(entry)">{{ entry.count }}</span>
              </div>
            </div>
          </template>
          <div v-else-if="!mailSites.length" class="panel-label py-2 text-center" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
            {{ t('noVisitData') }}
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
* {
  font-family: Arial, Helvetica, sans-serif !important;
}

/* Same domain rendering as the popup (main.css is not bundled into the
   content script, so replicate it): distinct glyphs, no ligatures, spacing.
   Atkinson Hyperlegible is unavailable on arbitrary pages – monospace fallback. */
.secure-domain-display {
  font-family: 'Atkinson Hyperlegible', ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace !important;
  font-variant-ligatures: none !important;
  font-feature-settings: 'zero' 1, 'ss02' 1 !important;
  letter-spacing: 0.25em !important;
}

button {
  box-shadow: none !important;
  text-shadow: none !important;
  outline: none !important;
}

.panel-container {
  width: min(600px, 94vw) !important;
  max-height: 85vh !important;
  overflow-y: auto !important;
  box-sizing: border-box !important;
}

.panel-label {
  font-size: 0.8em !important;
  line-height: 1.35em !important;
}

.panel-entry {
  font-size: 0.95em !important;
  line-height: 1.35em !important;
}

/* Custom thin scrollbar for the subdomain list and the panel itself */
.panel-list,
.panel-container {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.45) transparent;
}

.panel-list::-webkit-scrollbar,
.panel-container::-webkit-scrollbar {
  width: 6px !important;
  height: 6px !important;
}

.panel-list::-webkit-scrollbar-track,
.panel-container::-webkit-scrollbar-track {
  background: transparent !important;
}

.panel-list::-webkit-scrollbar-thumb,
.panel-container::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45) !important;
  border-radius: 3px !important;
}

.panel-list::-webkit-scrollbar-thumb:hover,
.panel-container::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.7) !important;
}

.panel-address {
  font-size: 1.15em !important;
  line-height: 1.35em !important;
  /* Wrap at the label boundaries SecureText marks, and split a label only
     when it cannot fit on a line by itself */
  word-break: normal !important;
  overflow-wrap: break-word !important;
}

.panel-toggle {
  min-width: 28px !important;
  height: 28px !important;
  padding: 0 6px !important;
  border-radius: 6px !important;
  border-width: 1px !important;
  border-style: solid !important;
  font-size: 0.8em !important;
  transition: background-color 0.15s ease !important;
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.15s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}
</style>
