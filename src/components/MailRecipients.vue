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
  isDark: boolean
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
  <div v-if="show" class="mail-recipients mt-2">
    <div class="recipients-label uppercase tracking-wider" :class="isDark ? 'text-gray-500' : 'text-gray-400'">
      {{ t('emailRecipientsTitle') }} ({{ recipients.length + (notChecked ?? 0) }})
    </div>

    <div
      v-for="(recipient, index) in recipients"
      :key="`${recipient.field}-${index}`"
      class="recipient-row flex items-start gap-1 mt-0.5"
    >
      <span
        class="recipient-field shrink-0 px-1 rounded"
        :class="isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'"
      >{{ t(fieldLabel[recipient.field]) }}</span>
      <span class="break-all" :class="isDark ? 'text-white' : 'text-gray-900'">
        <SecureText :text="recipient.analysis.localPart" :force-highlight="true" :danger-only="true" account-name /><span :class="isDark ? 'text-gray-400' : 'text-gray-500'">@</span><SecureText :text="recipient.analysis.domain" :force-highlight="true" :danger-only="true" />
      </span>
    </div>

    <!-- Every marker that would have gone unsaid if only the first address had
         been looked at. Each names the recipient it belongs to. -->
    <div
      v-for="(recipient, index) in recipients"
      :key="`mark-${recipient.field}-${index}`"
      class="recipient-note"
    >
      <div v-if="recipient.providerKind === 'disposable'" class="mt-0.5" :class="isDark ? 'text-red-400' : 'text-red-600'">
        ⚠ {{ recipient.analysis.domain }} – {{ t('emailDisposableHint') }}
      </div>
      <div v-if="recipient.analysis.domainInfo.punycode" class="mt-0.5" :class="isDark ? 'text-yellow-400' : 'text-yellow-600'">
        ⚠ {{ recipient.analysis.domain }} – {{ recipient.analysis.domainInfo.punycode }}
      </div>
      <div v-if="recipient.analysis.suspiciousPattern" class="mt-0.5" :class="isDark ? 'text-red-400' : 'text-red-600'">
        ⚠ {{ recipient.analysis.domain }} – {{ t('emailSuspiciousPattern') }} (.{{ recipient.analysis.suspiciousPattern.label }})
      </div>
      <div v-if="recipient.providerKind === 'regular' && !recipient.isSafe" class="mt-0.5" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
        {{ recipient.analysis.domain }} – {{ t('emailRecipientUnfamiliar') }}
      </div>
    </div>

    <div v-if="notChecked" class="mt-0.5" :class="isDark ? 'text-gray-400' : 'text-gray-500'">
      +{{ notChecked }} {{ t('emailRecipientsNotChecked') }}
    </div>
  </div>
</template>

<style scoped>
.mail-recipients {
  font-size: 0.75rem;
  line-height: 1.3;
}

.recipients-label {
  font-size: 0.625rem;
}

.recipient-field {
  font-size: 0.625rem;
  line-height: 1.4;
}
</style>
