<script setup lang="ts">
import type { MailServiceKind } from '~/logic/email-providers'
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { MAIL_SERVICE_VERDICTS } from '~/logic/email-providers'

/**
 * What stands where the verdict would for an address at a mail service: a
 * public provider, a throwaway service, a forwarding service. Nobody opens
 * such a domain, so a verdict on its visits would be about nothing.
 *
 * The one badge for it on every surface drawn over a page. The popup draws
 * its verdicts larger and reads the same table.
 */
const props = defineProps<{ kind: MailServiceKind }>()

const { t } = useI18n()
const look = computed(() => MAIL_SERVICE_VERDICTS[props.kind])
</script>

<template>
  <VzBadge :tone="look.tone" :icon="look.icon" :data-verdict="look.verdict">
    {{ t(look.label) }}
  </VzBadge>
</template>
