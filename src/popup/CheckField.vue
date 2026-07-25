<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import type { EmailAnalysis } from '~/logic/email-safety'
import type { ResolvedUrlResult } from '~/logic/url-shorteners'
import { getDomain } from 'tldts'
import { onMounted, ref } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import EmailBreakdown from '~/components/EmailBreakdown.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import { classifyEmailDomain, loadEmailListsFromStorage } from '~/logic/email-providers'
import { analyzeEmailAddress, parseMailtoUrl } from '~/logic/email-safety'
import { getHostnameFromHref, getPunycodeInfo } from '~/logic/link-safety'
import { classifyPayload, extractCheckTarget } from '~/logic/payload-classify'
import { decodeQrFromImageBitmapSource } from '~/logic/qr'
import { settings } from '~/logic/storage'
import { isShortenedUrl } from '~/logic/url-shorteners'

const emit = defineEmits<{
  (e: 'checkedDomain', hostname: string): void
}>()

const { t } = useI18n()
const { isDark } = useTheme()

interface UrlResolveState {
  status: 'idle' | 'loading' | 'resolved' | 'error'
  finalHostname?: string
  finalUrl?: string
  chain?: string[]
  finalCount?: number
  finalIsSafe?: boolean
}

type CheckResult
  = | { type: 'url', url: string, hostname: string, baseDomain: string, punycode: string | null, count: number, isSafe: boolean, isShortener: boolean, resolve: UrlResolveState }
    | { type: 'email', analysis: EmailAnalysis, params: { key: string, value: string }[], count: number, isSafe: boolean, providerKind: EmailProviderKind }
    | { type: 'raw', payloadKind: string, payload: string }
    | { type: 'invalid' }
    | { type: 'qr-error' }

const inputText = ref('')
const result = ref<CheckResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  loadEmailListsFromStorage()
})

// Visits are stored per exact hostname, but "have I been here" should count the
// whole domain family (gmail.com visits may live under www.gmail.com etc.)
async function getVisitData(hostname: string): Promise<{ count: number, isSafe: boolean }> {
  const base = getDomain(hostname) || hostname
  const allData = await browser.storage.local.get(null)
  let total = 0
  for (const key of Object.keys(allData)) {
    if (key === 'settings' || key === 'customShorteners')
      continue
    if (key === base || key.endsWith(`.${base}`))
      total += (allData[key] as { count?: number })?.count || 0
  }
  return { count: total, isSafe: total >= settings.value.safety }
}

async function checkUrl(url: string) {
  const hostname = getHostnameFromHref(url)
  if (!hostname) {
    result.value = { type: 'invalid' }
    return
  }
  const visitData = await getVisitData(hostname)
  const punycodeResult = getPunycodeInfo(hostname)
  result.value = {
    type: 'url',
    url,
    hostname,
    baseDomain: getDomain(hostname) || hostname,
    punycode: punycodeResult.hasUnicode ? (punycodeResult.ascii || null) : null,
    count: visitData.count,
    isSafe: visitData.isSafe,
    isShortener: isShortenedUrl(hostname),
    resolve: { status: 'idle' },
  }
  emit('checkedDomain', hostname)
}

async function checkEmail(addrOrMailto: string) {
  const isMailto = /^mailto:/i.test(addrOrMailto)
  const parsed = isMailto ? parseMailtoUrl(addrOrMailto) : null
  const address = isMailto ? parsed?.addresses[0] : addrOrMailto
  const analysis = address ? analyzeEmailAddress(address) : null
  if (!analysis) {
    result.value = { type: 'invalid' }
    return
  }
  const visitData = await getVisitData(analysis.domain)
  result.value = {
    type: 'email',
    analysis,
    params: parsed?.params ?? [],
    count: visitData.count,
    isSafe: visitData.isSafe,
    providerKind: classifyEmailDomain(analysis.domain),
  }
  emit('checkedDomain', analysis.domain)
}

async function runCheck(rawText: string) {
  const trimmed = rawText.trim()
  if (!trimmed) {
    result.value = null
    return
  }

  const { kind, value } = classifyPayload(trimmed)
  if (kind === 'url') {
    await checkUrl(value)
  }
  else if (kind === 'email') {
    // Keep the full mailto: string so params get parsed and shown
    await checkEmail(/^mailto:/i.test(trimmed) ? trimmed : value)
  }
  else if (kind !== 'text') {
    result.value = { type: 'raw', payloadKind: kind, payload: trimmed }
  }
  else {
    // Free-form text: try to extract an email / URL / bare domain
    const target = extractCheckTarget(trimmed)
    if (!target)
      result.value = { type: 'invalid' }
    else if (target.kind === 'email')
      await checkEmail(target.value)
    else if (target.kind === 'url')
      await checkUrl(target.value)
    else
      await checkUrl(`https://${target.value}`)
  }
}

function onSubmit() {
  runCheck(inputText.value)
}

async function expandUrl() {
  if (result.value?.type !== 'url' || result.value.resolve.status === 'loading')
    return
  const checked = result.value
  checked.resolve = { status: 'loading' }
  try {
    const resolved = await browser.runtime.sendMessage({ type: 'resolve-short-url', data: { url: checked.url } }) as ResolvedUrlResult
    if (result.value !== checked)
      return // a new check replaced this result meanwhile
    if (resolved && resolved.status === 'resolved' && resolved.finalHostname) {
      const visitData = await getVisitData(resolved.finalHostname)
      checked.resolve = {
        status: 'resolved',
        finalHostname: resolved.finalHostname,
        finalUrl: resolved.finalUrl,
        chain: resolved.chain,
        finalCount: visitData.count,
        finalIsSafe: visitData.isSafe,
      }
      // The real destination is what matters — switch the dashboard to it
      emit('checkedDomain', resolved.finalHostname)
    }
    else {
      checked.resolve = { status: 'error' }
    }
  }
  catch {
    if (result.value === checked)
      checked.resolve = { status: 'error' }
  }
}

// --- QR image intake: clipboard paste / drag-drop / file picker ---

async function handleImage(blob: Blob) {
  try {
    const payload = await decodeQrFromImageBitmapSource(blob)
    if (!payload) {
      result.value = { type: 'qr-error' }
      return
    }
    inputText.value = payload
    await runCheck(payload)
  }
  catch {
    result.value = { type: 'qr-error' }
  }
}

function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items)
    return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        event.preventDefault()
        handleImage(file)
        return
      }
    }
  }
  // No image — let the text paste proceed normally
}

function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/'))
    handleImage(file)
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    handleImage(file)
  input.value = ''
}

function getCountColor(count: number) {
  return count >= settings.value.safety ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

function statusText(isSafe: boolean, count: number) {
  if (isSafe)
    return { text: t.value('linkTooltipFamiliar'), class: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' }
  if (count === 0)
    return { text: t.value('linkTooltipNeverVisited'), class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' }
  return { text: t.value('linkTooltipUnfamiliar'), class: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' }
}

function subdomainPart(hostname: string, baseDomain: string) {
  if (hostname === baseDomain || !hostname.endsWith(`.${baseDomain}`))
    return null
  return hostname.slice(0, -baseDomain.length - 1)
}

function payloadTypeLabel(payloadKind: string) {
  const key = `qrType${payloadKind.charAt(0).toUpperCase()}${payloadKind.slice(1)}`
  return t.value(key)
}
</script>

<template>
  <div
    class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
    @paste="onPaste"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="text-xs uppercase tracking-wider opacity-50 mb-1.5">
      {{ t('checkFieldTitle') }}
    </div>

    <div class="flex gap-1.5 items-center">
      <input
        v-model="inputText"
        type="text"
        class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:border-blue-400 dark:focus:border-blue-500"
        :placeholder="t('checkFieldPlaceholder')"
        @keydown.enter="onSubmit"
      >
      <button
        class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
        :title="t('checkFieldSelectFile')"
        @click="fileInput?.click()"
      >
        <div i-carbon-qr-code />
      </button>
      <button
        class="px-3 h-8 flex-shrink-0 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm transition-colors"
        @click="onSubmit"
      >
        {{ t('checkFieldButton') }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelected">
    </div>

    <div class="text-[11px] opacity-40 mt-1">
      {{ t('checkFieldPasteHint') }}
    </div>

    <!-- Results -->
    <div v-if="result" class="mt-2">
      <!-- URL / domain -->
      <template v-if="result.type === 'url'">
        <div class="flex items-center flex-wrap gap-1.5 mb-1">
          <span
            class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
            :class="result.isShortener ? 'bg-orange-500' : result.isSafe ? 'bg-green-500' : 'bg-red-500'"
          />
          <span class="font-medium break-words secure-domain-display">
            <SecureText :text="result.hostname" />
          </span>
          <span v-if="result.isShortener" class="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
            {{ t('linkTooltipShortener') }}
          </span>
          <span v-else class="text-xs px-1.5 py-0.5 rounded" :class="statusText(result.isSafe, result.count).class">
            {{ statusText(result.isSafe, result.count).text.toLowerCase() }}
          </span>
        </div>

        <div v-if="subdomainPart(result.hostname, result.baseDomain)" class="text-xs opacity-60 mb-0.5">
          {{ t('baseDomain') }}: <SecureText :text="result.baseDomain" :force-highlight="true" :danger-only="true" />
        </div>

        <div v-if="result.punycode && result.punycode !== result.hostname" class="text-xs text-yellow-600 dark:text-yellow-400 mb-0.5 break-all">
          {{ t('linkTooltipPunycode') }}: {{ result.punycode }}
        </div>

        <div v-if="!result.isShortener" class="text-xs mb-1">
          {{ t('linkTooltipVisits') }}: <span class="font-mono font-bold" :class="getCountColor(result.count)">{{ result.count }}</span>
        </div>

        <!-- Structural markers and resemblance to a domain the user knows -->
        <div class="text-xs">
          <DomainMarkers :hostname="result.hostname" :url="result.url" />
          <LookalikeNotice :hostname="result.hostname" />
        </div>

        <!-- Expand shortened URL -->
        <button
          v-if="result.resolve.status === 'idle' || result.resolve.status === 'error'"
          class="mt-1 px-3 py-1 rounded-lg border text-xs transition-colors"
          :class="result.isShortener
            ? 'bg-orange-100 hover:bg-orange-200 text-orange-800 border-orange-300 dark:bg-orange-700/60 dark:hover:bg-orange-600/60 dark:text-orange-100 dark:border-orange-700/50'
            : 'bg-gray-100 hover:bg-gray-200 text-gray-600 border-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 dark:border-gray-600'"
          @click="expandUrl"
        >
          {{ t('checkFieldExpand') }}
        </button>
        <div v-if="result.resolve.status === 'error'" class="text-xs opacity-60 mt-1">
          {{ t('linkTooltipResolveError') }}
        </div>

        <div v-if="result.resolve.status === 'loading'" class="flex items-center gap-2 mt-1 text-xs opacity-70">
          <div class="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          {{ t('linkTooltipResolvingUrl') }}
        </div>

        <div v-if="result.resolve.status === 'resolved'" class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <div class="flex items-center flex-wrap gap-1.5 mb-1">
            <span
              class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              :class="result.resolve.finalIsSafe ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="font-medium break-words secure-domain-display">
              <SecureText :text="result.resolve.finalHostname || ''" />
            </span>
            <span class="text-xs px-1.5 py-0.5 rounded" :class="statusText(result.resolve.finalIsSafe || false, result.resolve.finalCount || 0).class">
              {{ statusText(result.resolve.finalIsSafe || false, result.resolve.finalCount || 0).text.toLowerCase() }}
            </span>
          </div>
          <div class="text-xs opacity-60 break-all mb-1">
            {{ result.resolve.finalUrl }}
          </div>
          <div v-if="result.resolve.chain && result.resolve.chain.length > 2" class="text-xs opacity-70">
            <div class="opacity-70 mb-0.5">
              {{ t('linkTooltipRedirectChain') }} ({{ result.resolve.chain.length }})
            </div>
            <div v-for="(hop, i) in result.resolve.chain" :key="i" class="break-all">
              {{ i + 1 }}. {{ hop }}
            </div>
          </div>
        </div>
      </template>

      <!-- Email -->
      <template v-else-if="result.type === 'email'">
        <div class="flex items-center flex-wrap gap-1.5 mb-1">
          <span class="text-xs opacity-50">{{ t('emailTooltipTitle') }}</span>
          <span v-if="result.providerKind === 'disposable'" class="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
            {{ t('emailDisposableDomain') }}
          </span>
          <span v-else-if="result.providerKind === 'public'" class="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            {{ t('emailPublicProvider') }}
          </span>
          <span v-else class="text-xs px-1.5 py-0.5 rounded" :class="statusText(result.isSafe, result.count).class">
            {{ statusText(result.isSafe, result.count).text.toLowerCase() }}
          </span>
        </div>
        <EmailBreakdown :analysis="result.analysis" :params="result.params" :provider-kind="result.providerKind" :is-dark="isDark" />
        <div v-if="result.providerKind === 'regular'" class="text-xs mt-1">
          {{ t('linkTooltipVisits') }}: <span class="font-mono font-bold" :class="getCountColor(result.count)">{{ result.count }}</span>
        </div>
      </template>

      <!-- tel: / WIFI: / sms: / geo: payloads -->
      <template v-else-if="result.type === 'raw'">
        <div class="text-xs opacity-50 mb-1">
          {{ t('qrPayloadType') }}: {{ payloadTypeLabel(result.payloadKind) }}
        </div>
        <div class="text-sm p-2 rounded bg-gray-100 dark:bg-gray-900 break-all">
          <SecureText :text="result.payload" :force-highlight="true" :danger-only="true" />
        </div>
      </template>

      <!-- Nothing recognized -->
      <div v-else-if="result.type === 'invalid'" class="text-xs opacity-60">
        {{ t('checkFieldInvalid') }}
      </div>

      <!-- QR decode failed -->
      <div v-else-if="result.type === 'qr-error'" class="text-xs text-red-500 dark:text-red-400">
        {{ t('qrNotFound') }}
      </div>
    </div>
  </div>
</template>
