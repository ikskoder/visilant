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
    <!-- Full address with per-char highlighting, @ kept neutral. Only where a
         two-row breakdown would not fit – the link tooltip is one line wide. -->
    <div v-if="compact" class="font-bold email-address break-all" :class="isDark ? 'text-white' : 'text-gray-900'">
      <SecureText :text="analysis.localPart" :force-highlight="true" :danger-only="true" :preserve-case="true" /><span :class="isDark ? 'text-gray-400' : 'text-gray-500'">@</span><SecureText :text="analysis.domain" :force-highlight="true" :danger-only="true" />
    </div>

    <!--
      Named halves wherever there is room, the way the in-page check panel has
      always shown them. The two answer different questions: anyone can take any
      name at a public provider, while the domain is a site the history can say
      something about – and picking one out of the other in a single run of
      letter-spaced characters is the mistake this check exists to prevent.
    -->
    <template v-else>
      <div class="email-label uppercase tracking-wider" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
        {{ t('emailAccountName') }}
      </div>
      <div class="font-bold email-address break-all" :class="isDark ? 'text-white' : 'text-gray-900'">
        <SecureText :text="analysis.localPart" :force-highlight="true" :danger-only="true" :preserve-case="true" />
      </div>
      <div class="email-label uppercase tracking-wider mt-1" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
        {{ t('emailDomainLabel') }}
      </div>
      <div class="font-bold email-address break-all" :class="isDark ? 'text-white' : 'text-gray-900'">
        <SecureText :text="analysis.domain" :force-highlight="true" :danger-only="true" />
      </div>
    </template>

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
  /* The two halves of the address are what the whole check is about, and they
     were set at the same size as the labels naming them. Everything else here
     is context for these two lines. */
  font-size: 1.3em !important;
  line-height: 1.25em !important;
  word-break: break-all !important;
}

.email-label {
  font-size: 0.85em !important;
  line-height: 1.3em !important;
  /* These lines are sentences, so they wrap between words. Only something that
     cannot fit on a line of its own – a long address, a mailto parameter – is
     split, and mid-word breaks stop happening to ordinary prose. */
  word-break: normal !important;
  overflow-wrap: anywhere !important;
}
</style>
