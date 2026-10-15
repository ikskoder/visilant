<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import type { CheckPanelData } from '~/logic/ui-state'
import punycode from 'punycode'
import { computed, provide, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import EmailCheckCaveat from '~/components/EmailCheckCaveat.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import SecureText from '~/components/SecureText.vue'
import VzBadge from '~/components/VzBadge.vue'
import VzIcon from '~/components/VzIcon.vue'
import VzNotice from '~/components/VzNotice.vue'
import VzSig from '~/components/VzSig.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { useModalDialog } from '~/composables/useModalDialog'
import { useTopLayer } from '~/composables/useTopLayer'
import { ADDRESS_FRAMES_KEY } from '~/logic/address-shape'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { settings } from '~/logic/storage'
import { isTrackableHostname, untrackedReason } from '~/logic/visit-stats'

const props = defineProps<{
  visible: boolean
  data: CheckPanelData | null
  fontSize: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()

// The letters a lookalike changed, underlined in the address. Asked as the
// lookalike notice under it asks, so both read one answer
const linkDiff = useLookalikeDiff(
  () => props.data?.hostname ?? '',
  () => props.data?.kind === 'email' ? 'email' : undefined,
)

// Local display toggles – start from the global settings but only affect this panel
const localCase = ref<'lower' | 'upper'>(settings.value.domainCase)
const localPunycodeMode = ref<'unicode' | 'ascii'>(settings.value.punycodeListMode)
const localFrames = ref(settings.value.addressFrames !== false)
provide(ADDRESS_FRAMES_KEY, localFrames)

watch(() => props.visible, (visible) => {
  if (visible) {
    localCase.value = settings.value.domainCase
    localPunycodeMode.value = settings.value.punycodeListMode
    localFrames.value = settings.value.addressFrames !== false
  }
})

/**
 * The panel, and the button focus lands on when it opens.
 *
 * Escape used to be handled here on its own, and the listener was only removed
 * when the panel was hidden – so a panel that was open when the app was torn
 * down left its handler on the window. Everything about the keyboard now lives
 * in one place, which also brings the focus trap and giving focus back.
 */
const card = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLElement | null>(null)

// Above anything the page can lay over it – see `useTopLayer`
const layer = useTopLayer({
  mode: 'modal',
  visible: () => props.visible && Boolean(props.data),
  onDismiss: () => emit('close'),
})

useModalDialog({
  visible: () => props.visible && Boolean(props.data),
  container: () => card.value,
  initialFocus: () => closeButton.value,
  onEscape: () => emit('close'),
})

// Same convention as the popup row: a button shows the state it is in, and the
// tooltip says what pressing it will do
const caseTitle = computed(() => localCase.value === 'upper'
  ? t.value('caseToLower')
  : t.value('caseToUpper'))

const framesTitle = computed(() => localFrames.value
  ? t.value('framesTurnOff')
  : t.value('framesTurnOn'))

const punycodeTitle = computed(() => localPunycodeMode.value === 'unicode'
  ? t.value('punycodeShowAscii')
  : t.value('punycodeShowUnicode'))

function displayDomain(domain: string) {
  if (localPunycodeMode.value === 'ascii')
    return domain
  try {
    return punycode.toUnicode(domain)
  }
  catch {
    return domain
  }
}

const familiarityRules = computed(() => normalizeFamiliarity(settings.value.familiarity))

/**
 * The whole family's facts, which is what the verdict is about.
 *
 * Falls back to the bare total for a background too old to send them, so the
 * panel still says something rather than treating every site as brand new.
 */
const familyStats = computed<FamiliarityStats>(() =>
  props.data?.family.stats ?? { count: props.data?.family.total ?? 0 })

/**
 * Where the mail of an address domain is read, when that is somewhere else.
 *
 * `gmail.com` is never opened by anyone, so its own family is an unmovable zero.
 * The sites below are the ones the visits are on.
 */
const mailSites = computed(() => props.data?.family.mailSites ?? [])

function passes(stats: FamiliarityStats) {
  return isFamiliar(stats, familiarityRules.value)
}

// Hostnames without a dot are never counted, so there is no visit verdict to
// give. Same reasoning as the popup: a zero that can never change is not an
// answer, and colouring it red says something about the address that is untrue.
const isUntrackedHost = computed(() => {
  const hostname = props.data?.hostname
  return Boolean(hostname) && !isTrackableHostname(hostname!)
})

/**
 * The badge beside the name being checked. Beside an email address it never
 * says "never visited": nobody visits an address, and next to "Email address"
 * it read as though somebody could. Familiar and unfamiliar are about the site
 * behind it, and read the same either way.
 */
function statusBadge(stats: FamiliarityStats, hostname: string, email = false) {
  const count = stats.count
  if (!isTrackableHostname(hostname))
    return { text: t.value(untrackedReason(hostname) === 'ip' ? 'untrackedIpBadge' : 'untrackedHostBadge'), tone: 'neutral', icon: 'unknown', verdict: 'untracked' } as const
  if (isFamiliar(stats, familiarityRules.value))
    return { text: t.value('linkTooltipFamiliar'), tone: 'safe', icon: 'pass', verdict: 'familiar' } as const
  if (count === 0)
    return { text: t.value(email ? 'linkTooltipUnfamiliar' : 'linkTooltipNeverVisited'), tone: 'danger', icon: 'alert', verdict: email ? 'unfamiliar' : 'never' } as const
  return { text: t.value('linkTooltipUnfamiliar'), tone: 'danger', icon: 'alert', verdict: 'unfamiliar' } as const
}
</script>

<template>
  <Transition name="overlay-fade" appear @enter="layer.enter">
    <dialog
      v-if="visible && data"
      class="vz-layer fixed inset-0 z-[2147483647] pointer-events-auto flex items-center justify-center p-4 vz-scrim"
      :aria-label="t('checkPanelTitle')"
      @click.self="emit('close')"
    >
      <div
        ref="card"
        class="panel-container vz-overlay vz-dialog"
        :style="{ '--vz-scale': fontSize / 100 }"
      >
        <VzSig />
        <div class="vz-dialog__head">
          <h2 class="vz-title">
            {{ t('checkPanelTitle') }}
          </h2>
          <button
            ref="closeButton"
            :aria-label="t('closeDialog')"
            :title="t('closeDialog')"
            class="vz-iconbtn"
            @click="emit('close')"
          >
            <VzIcon name="close" />
          </button>
        </div>

        <!-- Email: full address, account name included -->
        <div v-if="data.kind === 'email' && data.email" class="grid gap-3">
          <div class="panel-row">
            <span class="vz-eyebrow">{{ t('emailTooltipTitle') }}</span>
            <VzBadge v-if="data.email.providerKind === 'disposable'" tone="danger" icon="alert" data-verdict="disposable">
              {{ t('emailDisposableDomain') }}
            </VzBadge>
            <VzBadge v-else-if="data.email.providerKind === 'public'" tone="neutral" icon="email" data-verdict="public">
              {{ t('emailPublicProvider') }}
            </VzBadge>
            <VzBadge v-else :tone="statusBadge(familyStats, data.hostname, true).tone" :icon="statusBadge(familyStats, data.hostname, true).icon" :data-verdict="statusBadge(familyStats, data.hostname, true).verdict">
              {{ statusBadge(familyStats, data.hostname, true).text }}
            </VzBadge>
          </div>
          <div class="grid gap-1">
            <span class="vz-eyebrow">{{ t('emailAccountName') }}</span>
            <SecureText :text="data.email.analysis.localPart" kind="account" size="l">
              <CopyButton :text="data.email.analysis.localPart" />
            </SecureText>
          </div>
          <div class="grid gap-1">
            <span class="vz-eyebrow">{{ t('emailDomainLabel') }}</span>
            <SecureText :text="data.email.analysis.domain" :case-override="localCase" size="l" :diff="linkDiff(data.email.analysis.domain)">
              <CopyButton :text="data.email.analysis.domain" />
            </SecureText>
          </div>
          <VzNotice v-if="data.email.analysis.suspiciousPattern" tone="danger">
            {{ t('emailSuspiciousPattern') }} (.{{ data.email.analysis.suspiciousPattern.label }})
          </VzNotice>
          <VzNotice v-if="data.email.analysis.local.hasUnicode" tone="danger">
            {{ t('emailLocalUnicodeWarning') }}
          </VzNotice>
          <VzNotice v-if="data.email.providerKind === 'public'" tone="neutral" icon="email">
            {{ t('emailPublicProviderHint') }}
          </VzNotice>
          <VzNotice v-else-if="data.email.providerKind === 'disposable'" tone="danger">
            {{ t('emailDisposableHint') }}
          </VzNotice>

          <!-- Last, because it qualifies everything above it -->
          <EmailCheckCaveat />
        </div>

        <!-- Domain: checked hostname -->
        <div v-else class="grid gap-2">
          <VzBadge :tone="statusBadge(familyStats, data.hostname).tone" :icon="statusBadge(familyStats, data.hostname).icon" :data-verdict="statusBadge(familyStats, data.hostname).verdict" class="justify-self-start">
            {{ statusBadge(familyStats, data.hostname).text }}
          </VzBadge>
          <SecureText :text="displayDomain(data.hostname)" :case-override="localCase" size="l" :diff="linkDiff(displayDomain(data.hostname))">
            <CopyButton :text="displayDomain(data.hostname)" />
          </SecureText>
        </div>

        <!-- Punycode. Skipped when it would repeat the hostname verbatim -->
        <VzNotice v-if="data.punycode && data.punycode !== data.hostname" tone="danger">
          {{ t('linkTooltipPunycode') }}: <SecureText :text="data.punycode" size="s" :diff="linkDiff(data.punycode)">
            <CopyButton :text="data.punycode" />
          </SecureText>
        </VzNotice>

        <!-- Why there are no numbers below, said before they are missed -->
        <VzNotice v-if="isUntrackedHost" tone="neutral" icon="unknown">
          <p class="vz-body-strong">
            {{ t(untrackedReason(data.hostname) === 'ip' ? 'untrackedIpTitle' : 'untrackedHostTitle') }}
          </p>
          <p>{{ t(untrackedReason(data.hostname) === 'ip' ? 'untrackedIpText' : 'untrackedHostText') }}</p>
        </VzNotice>

        <DomainMarkers :hostname="data.hostname" :context="data.kind === 'email' ? 'email' : undefined" :familiar="passes(familyStats)" />
        <LookalikeNotice :hostname="data.hostname" :context="data.kind === 'email' ? 'email' : undefined" />

        <!-- Display toggles for this panel only. Each shows its state by being
             pressed, and a plain Latin address looks the same either way, so the
             button has to carry the state itself. -->
        <div class="vz-toggles justify-self-start" role="group" :aria-label="t('addressDisplayGroup')">
          <button
            class="vz-toggle"
            :title="caseTitle"
            :aria-label="caseTitle"
            :aria-pressed="localCase === 'upper'"
            @click="localCase = localCase === 'upper' ? 'lower' : 'upper'"
          >
            <VzIcon name="case" />
          </button>
          <button
            class="vz-toggle"
            :title="framesTitle"
            :aria-label="framesTitle"
            :aria-pressed="localFrames"
            data-toggle="frames"
            @click="localFrames = !localFrames"
          >
            <VzIcon name="frames" />
          </button>
          <button
            class="vz-toggle"
            :title="punycodeTitle"
            :aria-label="punycodeTitle"
            :aria-pressed="localPunycodeMode === 'ascii'"
            @click="localPunycodeMode = localPunycodeMode === 'unicode' ? 'ascii' : 'unicode'"
          >
            <VzIcon name="script" />
          </button>
        </div>

        <!-- Domain family, same info as the extension popup. Dropped entirely for
             an untracked host: the family is the address itself, and every number
             in it would be a zero that can never move. -->
        <div v-if="!isUntrackedHost" class="panel-section">
          <!-- No figure beside this heading. A bare "Total" repeated the visits
               line printed under it, with no word for what it counted, and next
               to a mail domain it was a zero nobody could move. -->
          <div class="grid gap-1">
            <span class="vz-eyebrow">{{ t('baseDomain') }}</span>
            <SecureText :text="displayDomain(data.family.baseDomain)" :case-override="localCase" size="m" />
          </div>

          <!-- What the badge above was decided on. Left out when the mail sites
               are listed below: those facts belong to the name nobody opens, and
               the numbers that mean anything are on the rows further down. -->
          <FamiliarityFacts v-if="!mailSites.length" :stats="familyStats" />

          <!-- An address domain has no site of its own – say where its mail lives -->
          <template v-if="mailSites.length">
            <span class="vz-eyebrow">{{ t('mailSiteLabel') }}</span>
            <!-- The facts rather than the bare total the related-domain rows carry:
                 this site is the one the verdict about the address actually
                 rests on, so it is judged in full like any other -->
            <ul class="vz-list">
              <li v-for="site in mailSites" :key="site.site" class="vz-list__row panel-mail-row">
                <SecureText :text="displayDomain(site.site)" :case-override="localCase" size="m" />
                <FamiliarityFacts :stats="site.stats" />
              </li>
            </ul>
            <p class="vz-small">
              {{ t('mailSiteNote') }}
            </p>
          </template>

          <template v-if="data.family.entries.length > 0">
            <span class="vz-eyebrow">{{ t('relatedDomains') }}</span>
            <ul class="vz-list panel-list">
              <li
                v-for="entry in data.family.entries"
                :key="entry.hostname"
                class="vz-list__row"
                :class="{ 'vz-list__row--current': entry.hostname === (data.family.key || data.hostname) }"
              >
                <div class="vz-list__main">
                  <SecureText :text="displayDomain(entry.hostname)" :case-override="localCase" size="m" />
                </div>
                <!-- The number, then its mark: numbers line up on the right edge -->
                <span class="vz-list__num">
                  {{ entry.count }}
                  <VzIcon :name="passes(entry) ? 'pass' : 'fail'" :label="t(passes(entry) ? 'familiarityFactPassed' : 'familiarityFactFailed')" :class="passes(entry) ? 'tone-safe' : 'tone-danger'" :data-result="passes(entry) ? 'pass' : 'fail'" />
                </span>
              </li>
            </ul>
          </template>
          <p v-else-if="!mailSites.length" class="vz-small text-center">
            {{ t('noVisitData') }}
          </p>
        </div>
      </div>
    </dialog>
  </Transition>
</template>

<style scoped>
.panel-container {
  width: min(600px, 100vw - 32px);
  max-width: none;
  max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.panel-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.panel-section {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.panel-list {
  max-height: 265px;
  overflow-y: auto;
}

.panel-mail-row {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}
</style>
