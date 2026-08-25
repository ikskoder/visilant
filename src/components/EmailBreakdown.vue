<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import type { EmailAnalysis } from '~/logic/email-safety'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { settings } from '~/logic/storage'

const props = defineProps<{
  analysis: EmailAnalysis
  params: { key: string, value: string }[]
  isDark: boolean
  compact?: boolean
  providerKind?: EmailProviderKind
  /**
   * Offer the control that decides how the account name is cased.
   *
   * Only where the two halves are named, and only from a surface that can write
   * settings – the popup and the check page. The tooltip in a page draws the
   * address as one line with no labels, and it has nowhere to put a control the
   * reader would have to aim at through a shadow root.
   */
  caseControl?: boolean
}>()

const { t } = useI18n()

/**
 * Three positions, not two: a domain reads the same in either case, while the
 * capitals in a name are part of how somebody wrote it down. Left as typed
 * until asked otherwise. The button shows where it stands and its tooltip names
 * the next position, which is the order pressing moves through.
 */
const ACCOUNT_CASES = ['as-typed', 'lower', 'upper'] as const

const accountCaseLabel = computed(() => {
  const mode = settings.value.accountNameCase
  return mode === 'upper' ? 'AA' : mode === 'lower' ? 'aa' : 'Aa'
})

const accountCaseTitle = computed(() => {
  const mode = settings.value.accountNameCase
  if (mode === 'as-typed')
    return t.value('accountCaseToLower')
  if (mode === 'lower')
    return t.value('accountCaseToUpper')
  return t.value('accountCaseAsTyped')
})

function cycleAccountNameCase() {
  const at = ACCOUNT_CASES.indexOf(settings.value.accountNameCase)
  settings.value.accountNameCase = ACCOUNT_CASES[(at + 1) % ACCOUNT_CASES.length]
}

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
      <SecureText :text="analysis.localPart" :force-highlight="true" :danger-only="true" account-name /><span :class="isDark ? 'text-gray-400' : 'text-gray-500'">@</span><SecureText :text="analysis.domain" :force-highlight="true" :danger-only="true" />
    </div>

    <!--
      Named halves wherever there is room, the way the in-page check panel has
      always shown them. The two answer different questions: anyone can take any
      name at a public provider, while the domain is a site the history can say
      something about – and picking one out of the other in a single run of
      letter-spaced characters is the mistake this check exists to prevent.
    -->
    <template v-else>
      <div class="email-label uppercase tracking-wider flex items-center gap-1.5" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
        {{ t('emailAccountName') }}
        <!-- Beside the name it acts on, rather than up in the header where it
             read as a control for the whole page -->
        <button
          v-if="caseControl"
          class="btn-ghost btn-sm !rounded normal-case leading-none px-1 py-0.5"
          :title="accountCaseTitle"
          :aria-label="accountCaseTitle"
          @click="cycleAccountNameCase"
        >
          {{ accountCaseLabel }}
        </button>
      </div>
      <div class="font-bold email-address break-all" :class="isDark ? 'text-white' : 'text-gray-900'">
        <SecureText :text="analysis.localPart" :force-highlight="true" :danger-only="true" account-name />
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
