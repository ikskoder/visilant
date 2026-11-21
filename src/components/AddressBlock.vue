<script setup lang="ts">
import type { IconName } from './VzIcon.vue'
import type { FamiliarityStats } from '~/logic/familiarity'
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { useRedFlagCount } from '~/composables/useRedFlags'

/**
 * One address and what is known about it, in one order on every surface drawn
 * over a web page:
 *
 *   heading → the address → Status: verdict, count of red flags → the flags
 *   themselves and the other findings → the facts the verdict was decided on.
 *
 * The tooltip, both dialogs and the check panel each used to write this out
 * for themselves, and each had drifted: the verdict above the address here
 * and beside it there, the flags straight under it or five blocks down. A
 * change to how an address reads then had to be made, and looked at, once per
 * surface. What differs between surfaces is passed in – which badge, which
 * facts – and never the order.
 *
 * No element of its own: the parts take their places in the caller's grid, so
 * the rhythm of a tooltip and of a dialog stays the caller's.
 */
const props = defineProps<{
  /** The small heading over the address, such as "Destination". None in a dialog whose title is the heading. */
  heading?: string
  headingIcon?: IconName
  /** How sure the heading is, in brackets after it. */
  note?: string
  /** Why it is no surer than that. Behind a question mark after the note: read on hover, or opened by a press where nothing hovers. */
  noteHelp?: string
  hostname: string
  /** The whole link, for the findings that read more than the hostname. */
  url?: string | null
  /** The other spelling of an international name, shown when it differs. */
  punycode?: string | null
  /** The verdict. None where the surface's own title has already said it. */
  badge?: { verdict: string, text: string, tone: 'safe' | 'danger' | 'caution' | 'neutral' | 'brand', icon?: IconName } | null
  /** Whether the site is familiar, which decides which findings are worth a line. */
  familiar: boolean
  /** The facts under the verdict. None when the settings hide them or there is no verdict on a site. */
  facts?: FamiliarityStats | null
  /** The background could not be asked: said in place of the facts. */
  unchecked?: boolean
  /** The verdict is still on its way: nothing that depends on it is drawn yet. */
  pending?: boolean
  caseOverride?: 'lower' | 'upper'
  /** The badge calls the site a short-link service, so the site is drawn in the badge's orange. */
  service?: boolean
}>()

const { t } = useI18n()

// Asked as the lookalike line below asks, so the two read one answer
const diff = useLookalikeDiff(() => props.hostname)
// The same question the count asks, so the row is there exactly when it has something in it
const flags = useRedFlagCount(() => props.hostname, () => props.url, () => undefined)
const hasStatus = computed(() => Boolean(props.badge) || (!props.pending && flags.value > 0))
</script>

<template>
  <!-- The heading and the address it names, held closer than the blocks around them -->
  <div class="address-block__name">
    <div v-if="heading || $slots.lead" class="address-block__row">
      <slot name="lead" />
      <span v-if="heading" class="vz-eyebrow inline-flex items-center gap-1"><VzIcon v-if="headingIcon" :name="headingIcon" />{{ heading }}</span>
      <span v-if="note" class="vz-small">({{ note }})</span>
      <VzHelp v-if="note && noteHelp" :text="noteHelp" :about="hostname" />
    </div>
    <SecureText :text="hostname" :case-override="caseOverride" size="l" :diff="diff(hostname)">
      <CopyButton :text="hostname" /><AddressParts :address="hostname" />
    </SecureText>
    <OtherSpelling :shown="hostname" :other="punycode" :diff="punycode ? diff(punycode) : undefined" />
    <slot name="url" />
  </div>

  <!-- The word "Status" only before a verdict: a count of flags alone is not one -->
  <div v-if="hasStatus" class="address-block__row" data-address-status>
    <span v-if="badge" class="vz-eyebrow">{{ t('linkInterceptStatus') }}</span>
    <VzBadge v-if="badge" :tone="badge.tone" :icon="badge.icon" :data-verdict="badge.verdict">
      {{ badge.text }}
    </VzBadge>
    <RedFlagCount v-if="!pending" :hostname="hostname" :url="url" />
  </div>

  <!-- These read the name itself, so they are drawn even when the visit
       history could not be reached: the red flags, then what is only worth a
       look -->
  <AddressFindings :hostname="hostname" :url="url" :familiar="familiar" :pending="pending" :service="service" />

  <VzNotice v-if="unchecked" tone="neutral" icon="unknown" data-status="unchecked">
    {{ t('linkUncheckedNotice') }}
  </VzNotice>
  <FamiliarityFacts v-else-if="facts" :stats="facts" verdict-beside />
</template>

<style scoped>
.address-block__name {
  display: grid;
  gap: var(--space-1);
}

.address-block__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Belongs to the note before it, so it stands closer than the row's own gap */
.address-block__row :deep(.vz-help) {
  margin-left: calc(var(--space-1) - var(--space-2));
}
</style>
