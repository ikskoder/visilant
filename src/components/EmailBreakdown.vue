<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import type { EmailAnalysis } from '~/logic/email-safety'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  analysis: EmailAnalysis
  params: { key: string, value: string }[]
  isDark: boolean
  compact?: boolean
  providerKind?: EmailProviderKind
}>()

const { t } = useI18n()

const MAX_PARAM_VALUE_LENGTH = 200

const displayParams = computed(() => props.params.map(({ key, value }) => ({
  key,
  value: value.length > MAX_PARAM_VALUE_LENGTH ? `${value.slice(0, MAX_PARAM_VALUE_LENGTH)}…` : value,
})))
</script>

<template>
  <div class="email-breakdown">
    <!-- Full address with per-char highlighting, @ kept neutral -->
    <div class="font-medium email-address break-all" :class="isDark ? 'text-white' : 'text-gray-900'">
      <SecureText :text="analysis.localPart" :force-highlight="true" :danger-only="true" /><span :class="isDark ? 'text-gray-400' : 'text-gray-500'">@</span><SecureText :text="analysis.domain" :force-highlight="true" :danger-only="true" />
    </div>

    <!-- Punycode of the domain -->
    <div v-if="analysis.domainInfo.punycode" class="email-label mt-1" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
      {{ t('linkTooltipPunycode') }}: {{ analysis.domainInfo.punycode }}
    </div>

    <!-- Embedded-TLD warning (paypal.com.evil.ru) -->
    <div v-if="analysis.suspiciousPattern" class="email-label mt-1" :class="isDark ? 'text-red-400' : 'text-red-600'">
      ⚠ {{ t('emailSuspiciousPattern') }} (.{{ analysis.suspiciousPattern.label }})
    </div>

    <!-- Unicode in the local part -->
    <div v-if="analysis.local.hasUnicode" class="email-label mt-1" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
      ⚠ {{ t('emailLocalUnicodeWarning') }}
    </div>

    <!-- Provider hints: judge the name, not the domain / disposable warning -->
    <div v-if="providerKind === 'public'" class="email-label mt-1" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
      {{ t('emailPublicProviderHint') }}
    </div>
    <div v-else-if="providerKind === 'disposable'" class="email-label mt-1" :class="isDark ? 'text-red-400' : 'text-red-600'">
      ⚠ {{ t('emailDisposableHint') }}
    </div>

    <!-- mailto query params (cc, bcc, subject, body...) -->
    <div v-if="displayParams.length" class="mt-2">
      <div class="email-label" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
        {{ t('emailTooltipParams') }}:
      </div>
      <div
        class="email-label space-y-0.5"
        :class="isDark ? 'text-gray-300' : 'text-gray-600'"
        :style="compact ? 'max-height: 100px; overflow-y: auto;' : ''"
      >
        <div v-for="param in displayParams" :key="param.key" class="break-all">
          <span :class="isDark ? 'text-gray-500' : 'text-gray-400'">{{ param.key }}:</span> {{ param.value }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.email-address {
  font-size: 1em !important;
  line-height: 1.3em !important;
  word-break: break-all !important;
}

.email-label {
  font-size: 0.85em !important;
  line-height: 1.3em !important;
  word-break: break-all !important;
}
</style>
