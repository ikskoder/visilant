<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { isListedPublicOnlyRemotely, MAIL_SERVICE_VERDICTS } from '~/logic/email-providers'

/**
 * What a mail service means for the address at it, in words: the line that
 * goes with the badge (`MailServiceBadge`).
 *
 * One line per kind, the same on every surface, and one question mark behind
 * which is what writing to such an address means. The line says what the kind
 * means and leaves its name to the badge above it: "Temporary email service"
 * over "A temporary email service." was the same three words twice. Where no
 * badge stands, under a recipient in a list, the line is headed with the name
 * the badge would carry (`named`), from the same table. There used to be three
 * wordings of each: one for a mail link, one for an address met anywhere
 * else and a short one for a list of recipients. Side by side on one sheet
 * they read as three different explanations of one thing, and the popup's
 * card had none of them: it said the kind and left the reader to know what
 * that is.
 *
 * Drawn through `AddressFindings` and nowhere else, so the line stands with
 * the other lines about the address, after the red flags, and the site in
 * the address is in the line's colour whenever the line is on screen.
 */
const props = defineProps<{
  kind: EmailProviderKind
  /** The domain the line is about */
  domain: string
  /** No badge beside the line names the kind, so the line is headed with it */
  named?: boolean
}>()

const { t } = useI18n()

const LINES = {
  disposable: 'emailDisposableHint',
  forwarding: 'emailForwardingHint',
} as const

const caution = computed(() => props.kind === 'disposable' || props.kind === 'forwarding' ? LINES[props.kind] : null)
const name = computed(() => props.named && props.kind !== 'regular' ? t.value(MAIL_SERVICE_VERDICTS[props.kind].label) : '')
</script>

<template>
  <VzNotice v-if="caution" tone="caution" :data-status="kind">
    <span v-if="name" class="block vz-body-strong" data-service-name>{{ name }}</span>
    {{ t(caution) }}
    <VzHelp :text="t('emailHiddenOwnerHelp')" :about="domain" />
  </VzNotice>
  <!-- Judge the name before the @, not the domain -->
  <VzNotice v-else-if="kind === 'public'" tone="neutral" icon="email" data-status="public">
    <span v-if="name" class="block vz-body-strong" data-service-name>{{ name }}</span>
    {{ t('emailPublicProviderHint') }}
  </VzNotice>
  <!-- Only the downloaded list says so, which is not enough to lift the
       verdict, see `remotePublicSet` -->
  <VzNotice v-else-if="kind === 'regular' && isListedPublicOnlyRemotely(domain)" tone="neutral" icon="email" data-status="listed-public">
    {{ t('emailRemotePublicHint') }}
  </VzNotice>
</template>
