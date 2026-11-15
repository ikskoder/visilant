<script setup lang="ts">
import type { EmailRecipientInfo } from '~/logic/ui-state'
import { computed, inject } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useCautionCount, useRedFlagCount } from '~/composables/useRedFlags'
import { ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
import { isCautionMailService, MAIL_SERVICE_VERDICTS } from '~/logic/email-providers'
import { usernameNote } from '~/logic/username-characters'

/**
 * What is known about one recipient, folded to its signs for a row of the
 * list: the verdict's shield, the flag with how many red flags, and the
 * orange shield with how many things are worth a look. The words of each are
 * its label, and the open row says them in full (`MailRecipients`).
 *
 * A throwaway or a forwarding service is itself a thing worth a look, so it
 * joins the orange count rather than standing beside it as a second orange
 * shield: two of them read as two of one thing.
 */
const props = defineProps<{ recipient: EmailRecipientInfo }>()

const { t } = useI18n()
const { statusLabel } = useFamiliarityFacts()
const lookupShape = inject(ADDRESS_SHAPE_KEY, askBackgroundShape)

const domain = () => props.recipient.analysis.domain
const service = computed(() => isCautionMailService(props.recipient.providerKind))
const flags = useRedFlagCount(domain, () => null, () => 'email')
const cautions = useCautionCount(domain, () => ({ context: 'email', familiar: props.recipient.isSafe, cautionService: service.value }), lookupShape)
// The line about the username is drawn by the list, not under the domain
const orange = computed(() => cautions.value + (usernameNote(props.recipient.analysis.localPart) ? 1 : 0))

const verdict = computed(() => {
  const { providerKind, unchecked, isSafe, stats } = props.recipient
  // A throwaway or forwarding service is in the orange count, see above
  if (service.value)
    return null
  // A public provider: the badge's own look, folded to its sign
  if (providerKind !== 'regular') {
    const look = MAIL_SERVICE_VERDICTS[providerKind]
    return { tone: look.tone, icon: look.icon, verdict: look.verdict, text: t.value(look.label) }
  }
  if (unchecked)
    return { tone: 'neutral', icon: 'shield-unknown', verdict: 'unchecked', text: t.value('verdictUnchecked') }
  return statusLabel(isSafe, stats.count)
})

const flagText = computed(() => flags.value === 1 ? t.value('redFlagsOne') : t.value('redFlagsMany').replace('{n}', String(flags.value)))
const orangeText = computed(() => {
  // A service and nothing else: the sign is the service, and says so
  if (service.value && orange.value === 1)
    return t.value(MAIL_SERVICE_VERDICTS[props.recipient.providerKind as 'disposable' | 'forwarding'].label)
  return orange.value === 1 ? t.value('cautionsOne') : t.value('cautionsMany').replace('{n}', String(orange.value))
})
</script>

<template>
  <span class="recipient-signs">
    <span v-if="verdict" class="recipient-sign" :class="`recipient-sign--${verdict.tone}`" :data-verdict="verdict.verdict" :title="verdict.text" role="img" :aria-label="verdict.text">
      <VzIcon :name="verdict.icon as any" />
    </span>
    <span v-if="flags > 0" class="recipient-sign recipient-sign--danger" :data-red-flags="flags" :title="flagText" role="img" :aria-label="flagText">
      <VzIcon name="flag" />{{ flags }}
    </span>
    <span v-if="orange > 0" class="recipient-sign recipient-sign--caution" :data-cautions="orange" :data-verdict="service ? recipient.providerKind : undefined" :title="orangeText" role="img" :aria-label="orangeText">
      <VzIcon name="shield-alert" />{{ service && orange === 1 ? '' : orange }}
    </span>
  </span>
</template>

<style scoped>
.recipient-signs {
  display: inline-flex;
  align-items: center;
  gap: calc(6px * var(--vz-scale, 1));
  white-space: nowrap;
}

/* The sign in its colour, the count beside it in the matching text colour */
.recipient-sign {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: calc(12px * var(--vz-scale, 1));
  line-height: calc(16px * var(--vz-scale, 1));
  font-weight: 700;
}

.recipient-sign .vz-icon {
  width: calc(16px * var(--vz-scale, 1));
  height: calc(16px * var(--vz-scale, 1));
  vertical-align: 0;
}

.recipient-sign--safe { color: var(--safe-text); }
.recipient-sign--safe .vz-icon { color: var(--safe); }
.recipient-sign--danger { color: var(--danger-text); }
.recipient-sign--danger .vz-icon { color: var(--danger); }
.recipient-sign--caution { color: var(--caution-text); }
.recipient-sign--caution .vz-icon { color: var(--caution); }
.recipient-sign--neutral { color: var(--neutral-text); }
.recipient-sign--neutral .vz-icon { color: var(--neutral); }
</style>
