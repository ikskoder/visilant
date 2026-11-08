<script setup lang="ts">
import type { FamiliarityStats } from '~/logic/familiarity'
import type { CheckPanelData } from '~/logic/ui-state'
import punycode from 'punycode'
import { computed, provide, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import EmailCheckCaveat from '~/components/EmailCheckCaveat.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
import FamiliarityGrid from '~/components/FamiliarityGrid.vue'
import LookalikeNotice from '~/components/LookalikeNotice.vue'
import RedFlagCount from '~/components/RedFlagCount.vue'
import SecureText from '~/components/SecureText.vue'
import VzBadge from '~/components/VzBadge.vue'
import VzIcon from '~/components/VzIcon.vue'
import VzNotice from '~/components/VzNotice.vue'
import VzSig from '~/components/VzSig.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'
import { useModalDialog } from '~/composables/useModalDialog'
import { useTopLayer } from '~/composables/useTopLayer'
import { useVisualViewport } from '~/composables/useVisualViewport'
import { ADDRESS_FRAMES_KEY } from '~/logic/address-shape'
import { isListedPublicOnlyRemotely } from '~/logic/email-providers'
import { isFamiliar, normalizeFamiliarity } from '~/logic/familiarity'
import { alternateSpelling } from '~/logic/link-safety'
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

// Over what is on the screen, not the layout viewport, see `viewportCoverStyle`
const cover = useVisualViewport(() => props.visible && Boolean(props.data))

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

const otherSpelling = computed(() => props.data ? alternateSpelling(displayDomain(props.data.hostname)) : null)

/**
 * Whether the spelling toggle would change anything on this panel. On a plain
 * Latin address with plain Latin relatives it changes nothing, and on a phone,
 * where a button has no tooltip, a press that changes nothing explains nothing.
 */
const hasOtherSpelling = computed(() => Boolean(otherSpelling.value)
  || Boolean(props.data?.family.entries.some(entry => alternateSpelling(entry.hostname))))

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
 * The whole family's facts, drawn under the site's name.
 *
 * Falls back to the bare total for a background too old to send them, so the
 * panel still says something rather than treating every site as brand new.
 */
const familyStats = computed<FamiliarityStats>(() =>
  props.data?.family.stats ?? { count: props.data?.family.total ?? 0 })

/**
 * The checked name's own record, which is what the verdict beside it is about.
 *
 * The badge used to be taken on the family, so `checkout.paypal.test` read
 * "Familiar site" here, over a row of its own with a red cross, while a link
 * to it showed red and a form on it raised the typing warning. It now answers
 * the way the rest of the extension acts. A name with no record of its own is
 * not in the list, and has no visits.
 */
const ownStats = computed<FamiliarityStats>(() => {
  const family = props.data?.family
  const key = family?.key || props.data?.hostname
  const entry = family?.entries.find(candidate => candidate.hostname === key)
  return entry ? { count: entry.count, activeDays: entry.activeDays, firstSeen: entry.firstSeen } : { count: 0 }
})

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
 * Whether the family holds any host besides the one checked. Without one, the
 * fold is the checked host's own record again, number for number, and is not
 * drawn a second time under another name.
 */
const hasOtherHosts = computed(() => {
  const family = props.data?.family
  const key = family?.key || props.data?.hostname
  return Boolean(family?.entries.some(entry => entry.hostname !== key))
})

/**
 * Whether the checked name's own record is evidence at all. Not for a public or
 * throwaway mail provider, whose badge is about the provider, nor for an
 * address domain whose mail is read on another site, listed below: nobody
 * opens either, and their zero is the one number that never moves.
 */
const showOwnFacts = computed(() => {
  const data = props.data
  if (!data || isUntrackedHost.value || mailSites.value.length)
    return false
  return data.kind !== 'email' || data.email?.providerKind === 'regular'
})

const { statusLabel } = useFamiliarityFacts()

/** The badge beside the name being checked, worded as on every other surface. */
function statusBadge(stats: FamiliarityStats, hostname: string, email = false) {
  return statusLabel(passes(stats), stats.count, false, { hostname, email })
}
</script>

<template>
  <Transition name="overlay-fade" appear @enter="layer.enter">
    <dialog
      v-if="visible && data"
      :style="cover"
      class="vz-layer z-[2147483647] pointer-events-auto flex items-center justify-center p-4 vz-scrim"
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
            <VzBadge v-else :tone="statusBadge(ownStats, data.hostname, true).tone" :icon="statusBadge(ownStats, data.hostname, true).icon" :data-verdict="statusBadge(ownStats, data.hostname, true).verdict">
              {{ statusBadge(ownStats, data.hostname, true).text }}
            </VzBadge>
            <RedFlagCount :hostname="data.hostname" context="email" />
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
          <FamiliarityGrid v-if="showOwnFacts" :stats="ownStats" data-own-facts />
          <VzNotice v-if="data.email.analysis.suspiciousPattern" tone="danger">
            {{ t('emailSuspiciousPattern') }} (.{{ data.email.analysis.suspiciousPattern.label }})
          </VzNotice>
          <VzNotice v-if="data.email.analysis.local.hasUnicode" tone="danger">
            {{ t('emailLocalUnicodeWarning') }}
          </VzNotice>
          <VzNotice v-if="data.email.providerKind === 'public'" tone="neutral" icon="email">
            {{ t('emailPublicProviderHint') }}
          </VzNotice>
          <!-- See `remotePublicSet` -->
          <VzNotice v-else-if="data.email.providerKind === 'regular' && isListedPublicOnlyRemotely(data.email.analysis.domain)" tone="neutral" icon="email" data-status="listed-public">
            {{ t('emailRemotePublicHint') }}
          </VzNotice>
          <VzNotice v-else-if="data.email.providerKind === 'disposable'" tone="danger">
            {{ t('emailDisposableHint') }}
          </VzNotice>

          <!-- Last, because it qualifies everything above it -->
          <EmailCheckCaveat />
        </div>

        <!-- Domain: checked hostname -->
        <div v-else class="grid gap-2">
          <div class="flex items-center flex-wrap gap-2 justify-self-start">
            <VzBadge :tone="statusBadge(ownStats, data.hostname).tone" :icon="statusBadge(ownStats, data.hostname).icon" :data-verdict="statusBadge(ownStats, data.hostname).verdict">
              {{ statusBadge(ownStats, data.hostname).text }}
            </VzBadge>
            <RedFlagCount :hostname="data.hostname" />
          </div>
          <SecureText :text="displayDomain(data.hostname)" :case-override="localCase" size="l" :diff="linkDiff(displayDomain(data.hostname))">
            <CopyButton :text="displayDomain(data.hostname)" />
          </SecureText>
        </div>

        <!-- What the badge above was decided on: this name's own record, as on
             the toolbar popup. The family's figures used to stand here under
             the site's name, so a red badge sat over three green marks that
             were about a different name. -->
        <FamiliarityGrid v-if="showOwnFacts && data.kind !== 'email'" :stats="ownStats" data-own-facts />

        <!-- The other spelling of the name drawn above. The other one of the two
             as drawn, not of the hostname as it came: the panel draws the
             Unicode or the xn-- spelling as its toggle says, and this line
             repeated the one already on screen. -->
        <VzNotice v-if="otherSpelling" tone="danger">
          {{ t('linkTooltipPunycode') }}: <SecureText :text="otherSpelling" size="s" :diff="linkDiff(otherSpelling)">
            <CopyButton :text="otherSpelling" />
          </SecureText>
        </VzNotice>

        <!-- Why there are no numbers below, said before they are missed -->
        <VzNotice v-if="isUntrackedHost" tone="neutral" icon="unknown">
          <p class="vz-body-strong">
            {{ t(untrackedReason(data.hostname) === 'ip' ? 'untrackedIpTitle' : 'untrackedHostTitle') }}
          </p>
          <p>{{ t(untrackedReason(data.hostname) === 'ip' ? 'untrackedIpText' : 'untrackedHostText') }}</p>
        </VzNotice>

        <DomainMarkers :hostname="data.hostname" :context="data.kind === 'email' ? 'email' : undefined" :familiar="passes(ownStats)" />
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
            v-if="hasOtherSpelling"
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

          <!-- The whole family folded, under the name it is about and said to be
               a fold: visits a total, the rest the best single host. Only where
               there is a family beyond the checked name, and not for an address
               domain, whose mail sites below are what counts. -->
          <template v-if="hasOtherHosts && !mailSites.length">
            <span class="vz-eyebrow">{{ t('familySummaryTitle') }}</span>
            <FamiliarityGrid :stats="familyStats" aggregated data-family-stats />
          </template>

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
            <ul class="vz-list vz-scroll-y panel-list">
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
  width: min(600px, var(--vz-vw, 100vw) - 32px);
  max-width: none;
  max-height: calc(var(--vz-vh, 100dvh) - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
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

/* See .popup-list--capped */
.panel-list {
  max-height: calc(44px * 6.5 * var(--vz-scale, 1));
}

.panel-mail-row {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}
</style>
