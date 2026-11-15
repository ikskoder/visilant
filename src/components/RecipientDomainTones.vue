<script setup lang="ts">
import { inject } from 'vue'
import { useFindingsOnScreen } from '~/composables/useRedFlags'
import { ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'

/**
 * The colours of one domain in a folded list of recipients, where its lines
 * wait behind a closed row and the row says them as signs with counts
 * (`RecipientSigns`). Without this a lookalike domain in a closed row was
 * drawn plain beside its red flag. One per domain, however many addresses
 * are at it. Draws nothing.
 */
const props = defineProps<{ domain: string, familiar: boolean, service: boolean }>()

useFindingsOnScreen(
  () => props.domain,
  () => ({ context: 'email', familiar: props.familiar, service: props.service }),
  inject(ADDRESS_SHAPE_KEY, askBackgroundShape),
)
</script>

<template>
  <span hidden />
</template>
