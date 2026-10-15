<script setup lang="ts">
import type { EmailRecipientInfo } from '~/logic/ui-state'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'

/**
 * Everyone a `mailto:` would write to, each checked in its own right.
 *
 * The address at the front of a `mailto:` used to be the whole check, so a link
 * reading `mailto:known@example.com,attacker@evil.example` came back familiar on
 * the strength of the first name and carried the second along untouched. `cc`
 * and `bcc` were not looked at at all.
 *
 * Shown only when there is more than one, so an ordinary single-address link
 * keeps the shape it always had.
 */
const props = defineProps<{
  recipients: EmailRecipientInfo[]
  notChecked?: number
}>()

const { t } = useI18n()

const fieldLabel: Record<EmailRecipientInfo['field'], string> = {
  to: 'emailFieldTo',
  cc: 'emailFieldCc',
  bcc: 'emailFieldBcc',
}

const show = computed(() => props.recipients.length > 1 || (props.notChecked ?? 0) > 0)
</script>

<template>
  <div v-if="show" class="mail-recipients grid gap-2">
    <span class="vz-eyebrow">{{ t('emailRecipientsTitle') }} ({{ recipients.length + (notChecked ?? 0) }})</span>

    <ul class="grid gap-1">
      <li
        v-for="(recipient, index) in recipients"
        :key="`${recipient.field}-${index}`"
        class="recipient-row flex items-start gap-2"
      >
        <span class="vz-badge vz-badge--neutral recipient-field">{{ t(fieldLabel[recipient.field]) }}</span>
        <SecureText kind="email" :text="`${recipient.analysis.localPart}@${recipient.analysis.domain}`" size="m" class="min-w-0">
          <CopyButton :text="`${recipient.analysis.localPart}@${recipient.analysis.domain}`" />
        </SecureText>
      </li>
    </ul>

    <!-- Every marker that would have gone unsaid if only the first address had
         been looked at. Each names the recipient it belongs to. -->
    <template v-for="(recipient, index) in recipients" :key="`mark-${recipient.field}-${index}`">
      <VzNotice v-if="recipient.providerKind === 'disposable'" tone="danger" bare>
        <SecureText :text="recipient.analysis.domain" size="s" /> – {{ t('emailDisposableHint') }}
      </VzNotice>
      <VzNotice v-if="recipient.analysis.domainInfo.punycode" tone="danger" bare>
        <SecureText :text="recipient.analysis.domain" size="s" /> – <SecureText :text="recipient.analysis.domainInfo.punycode" size="s">
          <CopyButton :text="recipient.analysis.domainInfo.punycode" />
        </SecureText>
      </VzNotice>
      <VzNotice v-if="recipient.analysis.suspiciousPattern" tone="danger" bare>
        <SecureText :text="recipient.analysis.domain" size="s" /> – {{ t('emailSuspiciousPattern') }} (.{{ recipient.analysis.suspiciousPattern.label }})
      </VzNotice>
      <VzNotice v-if="recipient.providerKind === 'regular' && !recipient.isSafe" tone="danger" bare>
        <SecureText :text="recipient.analysis.domain" size="s" /> – {{ t('emailRecipientUnfamiliar') }}
      </VzNotice>
    </template>

    <p v-if="notChecked" class="vz-small">
      +{{ notChecked }} {{ t('emailRecipientsNotChecked') }}
    </p>
  </div>
</template>

<style scoped>
.recipient-field {
  /* Centred on the first line of the address beside it */
  margin-top: calc(3px * var(--vz-scale, 1));
  padding: calc(1px * var(--vz-scale, 1)) calc(6px * var(--vz-scale, 1));
  font-size: calc(12px * var(--vz-scale, 1));
}
</style>
