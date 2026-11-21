<script setup lang="ts">
import type { ShortUrlInfo } from '~/logic/ui-state'
import { computed } from 'vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { showsVisitFacts } from '~/logic/show-visit-facts'

/**
 * A link that may lead somewhere else, in each of its four states: offered to
 * be followed, being followed, followed to its end, could not be followed.
 *
 * One block for the tooltip and the dialog. They used to carry a copy each,
 * and the copies had drifted in wording, in order and in what they left out.
 * `compact` is the one thing a surface chooses: small buttons, a long address
 * cut to three lines and the chain in a box of its own, for a tooltip that
 * has to stay a tooltip.
 */
const props = defineProps<{
  link: ShortUrlInfo
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  showFullUrl: boolean
  traceChain: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  (e: 'resolve'): void
  (e: 'markShortener'): void
}>()

const { t } = useI18n()
const { statusLabel } = useFamiliarityFacts()

// A chain of two is the link and where it went, which the block already says
const showChain = computed(() => props.traceChain && props.link.chain.length > 2)

const failure = computed(() => {
  if (props.link.error === 'same_domain')
    return t.value(props.link.isKnownShortener ? 'linkTooltipResolveSameDomainShortener' : 'linkTooltipResolveSameDomain')
  return t.value(props.link.error === 'refused' ? 'linkTooltipResolveRefused' : 'linkTooltipResolveError')
})
// Asking again cannot change either of these two answers
const canRetry = computed(() => props.link.error !== 'same_domain' && props.link.error !== 'refused')
</script>

<template>
  <!-- Beside the button, what pressing it costs and why it only tries: the
       link is requested for real, and that is the reader's to decide -->
  <div v-if="link.status === 'idle'" class="vz-ask">
    <button class="vz-btn vz-btn--block" :class="{ 'vz-btn--sm': compact }" data-action="resolve" @click.stop="emit('resolve')">
      <VzIcon name="link" />{{ t('linkResolveTry') }}
    </button>
    <VzHelp :text="t('linkResolveHelp')" :about="link.originalUrl" />
  </div>

  <button v-else-if="link.status === 'loading'" class="vz-btn vz-btn--block" :class="{ 'vz-btn--sm': compact }" disabled>
    <VzIcon name="pending" />{{ t('linkTooltipResolvingUrl') }}
  </button>

  <div v-else-if="link.status === 'resolved'" class="short-link__end">
    <!-- The destination gets the same reading as an address written out in
         full. Following a short link is the one case where the user could
         not have looked at it themselves, and it used to get a visit count
         and nothing else. -->
    <AddressBlock
      :heading="t('linkTooltipShortenedUrl')"
      heading-icon="link"
      :note="t('linkTooltipResolveDisclaimer')"
      :note-help="t('linkResolveWhyNotCertain')"
      :hostname="link.resolvedDomain"
      :punycode="link.resolvedPunycode"
      :badge="statusLabel(link.resolvedDomain, link.resolvedIsSafe, link.resolvedStats.count, link.resolvedUnchecked)"
      :familiar="link.resolvedIsSafe"
      :facts="!link.resolvedUnchecked && showsVisitFacts(showVisitCount, link.resolvedIsSafe) ? link.resolvedStats : null"
    >
      <!-- Not above a chain: its last step is this address -->
      <template v-if="showFullUrl && link.resolvedUrl && !showChain" #url>
        <p class="vz-small short-link__url">
          <!-- Three lines at most in a tooltip, the rest in the title and in
               the copy. A tracking link can run to twenty lines and push
               everything else out of it. -->
          <span class="short-link__text" :class="{ 'short-link__text--clamp': compact }" :title="compact ? link.resolvedUrl : undefined">{{ link.resolvedUrl }}</span>
          <CopyButton :text="link.resolvedUrl" inline />
        </p>
      </template>
    </AddressBlock>

    <div v-if="showChain" class="grid gap-1">
      <span class="vz-eyebrow">{{ t('linkTooltipRedirectChain') }}</span>
      <ol class="short-link__chain" :class="{ 'vz-well': compact }">
        <li v-for="(hop, i) in link.chain" :key="i">
          <span class="short-link__n">{{ i + 1 }}.</span>
          <span class="short-link__text">{{ hop }}</span>
          <!-- Every step: any of them may be the address to look up elsewhere -->
          <CopyButton :text="hop" inline />
        </li>
      </ol>
    </div>

    <!-- Only once following has shown the link really leads somewhere else:
         before that nothing says this site is a short-link service, and a
         stray press would hide every link from it -->
    <button v-if="!link.isKnownShortener" class="vz-btn vz-btn--sm vz-btn--quiet vz-btn--flush justify-self-start" data-action="mark-shortener" @click.stop="emit('markShortener')">
      {{ t('linkTooltipMarkAsShortener') }}
    </button>
  </div>

  <!-- Could not be followed. Said as what it is, never drawn as an empty or a
       passed result -->
  <template v-else-if="link.status === 'error'">
    <VzNotice tone="neutral">
      {{ failure }}
    </VzNotice>
    <button v-if="canRetry" class="vz-btn vz-btn--block" :class="{ 'vz-btn--sm': compact }" data-action="retry" @click.stop="emit('resolve')">
      {{ t('linkTooltipRetryResolve') }}
    </button>
  </template>
</template>

<style scoped>
.short-link__end {
  display: grid;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.short-link__url {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}

.short-link__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.short-link__text--clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}

.short-link__chain {
  list-style: none;
  display: grid;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
}

.short-link__chain li {
  display: flex;
  gap: 6px;
}

.short-link__n {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  flex: none;
}
</style>
