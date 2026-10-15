<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import type { EmailAnalysis } from '~/logic/email-safety'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { findEmbeddedPublicSuffix } from '~/logic/domain-markers'
import { settings } from '~/logic/storage'

const props = defineProps<{
  analysis: EmailAnalysis
  params: { key: string, value: string }[]
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
  /**
   * Another block on the same screen already speaks for the domain: its name,
   * both of its spellings and the embedded ending, as the check page's
   * checked-domain card does. The breakdown then keeps to the account name, so
   * the domain is not drawn twice. The embedded-ending line stays whenever the
   * card's own test for it would miss the address, since the two tests do not
   * agree on every ending, and a warning left to a card that will not draw it is
   * a warning dropped.
   */
  domainElsewhere?: boolean
}>()

const { t } = useI18n()
// The letters a lookalike changed, underlined in the domain. Asked as the
// lookalike notice beside this asks about an email domain
const domainDiff = useLookalikeDiff(() => props.analysis.domain, () => 'email')

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

const showSuspiciousPattern = computed(() => Boolean(props.analysis.suspiciousPattern)
  && !(props.domainElsewhere && findEmbeddedPublicSuffix(props.analysis.domain)))

const MAX_PARAM_VALUE_LENGTH = 200

const displayParams = computed(() => props.params.map(({ key, value }) => ({
  key,
  value: value.length > MAX_PARAM_VALUE_LENGTH ? `${value.slice(0, MAX_PARAM_VALUE_LENGTH)}…` : value,
})))
</script>

<template>
  <div class="email-breakdown grid gap-2">
    <!-- The whole address on one line, where a two-row breakdown would not fit:
         the link tooltip is one line wide -->
    <SecureText v-if="compact" kind="email" :text="`${analysis.localPart}@${analysis.domain}`" size="l" :diff="domainDiff(`${analysis.localPart}@${analysis.domain}`)" />

    <!--
      Named halves wherever there is room, the way the in-page check panel has
      always shown them. The two answer different questions: anyone can take any
      name at a public provider, while the domain is a site the history can say
      something about – and picking one out of the other in a single run of
      characters is the mistake this check exists to prevent.
    -->
    <template v-else>
      <div class="grid gap-1">
        <div class="flex items-center gap-2">
          <span class="vz-eyebrow">{{ t('emailAccountName') }}</span>
          <!-- Beside the name it acts on, rather than up in the header where it
               read as a control for the whole page -->
          <button
            v-if="caseControl"
            class="vz-toggle"
            :title="accountCaseTitle"
            :aria-label="accountCaseTitle"
            @click="cycleAccountNameCase"
          >
            {{ accountCaseLabel }}
          </button>
        </div>
        <SecureText :text="analysis.localPart" kind="account" size="l" />
      </div>
      <div v-if="!domainElsewhere" class="grid gap-1">
        <span class="vz-eyebrow">{{ t('emailDomainLabel') }}</span>
        <SecureText :text="analysis.domain" size="l" :diff="domainDiff(analysis.domain)" />
      </div>
    </template>

    <!-- The encoded spelling of an international domain -->
    <VzNotice v-if="analysis.domainInfo.punycode && !domainElsewhere" tone="danger" :bare="compact">
      {{ t('linkTooltipPunycode') }}: <SecureText :text="analysis.domainInfo.punycode" size="s" :diff="domainDiff(analysis.domainInfo.punycode)" />
    </VzNotice>

    <!-- Embedded-TLD warning (paypal.com.evil.ru) -->
    <VzNotice v-if="showSuspiciousPattern" tone="danger" :bare="compact">
      {{ t('emailSuspiciousPattern') }} (.{{ analysis.suspiciousPattern?.label }})
    </VzNotice>

    <!-- Unicode in the local part -->
    <VzNotice v-if="analysis.local.hasUnicode" tone="danger" :bare="compact">
      {{ t('emailLocalUnicodeWarning') }}
    </VzNotice>

    <!-- Provider hints: judge the name, not the domain / throwaway warning -->
    <VzNotice v-if="providerKind === 'public'" tone="neutral" icon="email" :bare="compact">
      {{ t('emailPublicProviderHint') }}
    </VzNotice>
    <VzNotice v-else-if="providerKind === 'disposable'" tone="danger" :bare="compact">
      {{ t('emailDisposableHint') }}
    </VzNotice>

    <!-- mailto query params (cc, bcc, subject, body...) -->
    <div v-if="displayParams.length" class="grid gap-1">
      <span class="vz-eyebrow">{{ t('emailTooltipParams') }}</span>
      <dl class="email-params vz-well" :class="{ 'email-params--compact': compact }">
        <div v-for="param in displayParams" :key="param.key" class="email-param">
          <dt>{{ param.key }}</dt>
          <dd>{{ param.value }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.email-params {
  display: grid;
  gap: 2px;
  margin: 0;
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
}

.email-params--compact {
  max-height: 100px;
  overflow-y: auto;
}

.email-param {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.email-param dt {
  color: var(--ink-3);
  flex: none;
}

.email-param dt::after {
  content: ':';
}

.email-param dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
