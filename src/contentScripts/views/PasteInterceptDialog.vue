<script setup lang="ts">
import type { PasteInterceptData } from '~/logic/ui-state'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DomainMarkers from '~/components/DomainMarkers.vue'
import FamiliarityFacts from '~/components/FamiliarityFacts.vue'
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

const props = defineProps<{
  visible: boolean
  data: PasteInterceptData | null
}>()

const emit = defineEmits<{
  (e: 'allow'): void
  (e: 'cancel'): void
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()

// The letters a lookalike changed, underlined in the address. Asked as the
// lookalike notice under it asks, so both read one answer
const linkDiff = useLookalikeDiff(() => props.data?.domain ?? '')
const { statusLabel } = useFamiliarityFacts()

// Hidden by default. Whatever is pasted here is exactly the kind of thing that
// should not land on a screen without being asked for.
const revealed = ref(false)
watch(() => props.visible, () => {
  revealed.value = false
})

/**
 * What the dialog is for right now.
 *
 * A held paste has to say something even before there is a verdict, and again
 * when the verdict turns out to be "this site is fine" or "no idea". Absent
 * means the case this dialog started life as: an unfamiliar site.
 */
const status = computed(() => props.data?.status ?? 'unfamiliar')
const isDecision = computed(() => status.value === 'unfamiliar' || status.value === 'error')

const title = computed(() => {
  switch (status.value) {
    case 'checking': return t.value('pasteInterceptCheckingTitle')
    case 'safe': return t.value('pasteInterceptSafeTitle')
    case 'error': return t.value('pasteInterceptErrorTitle')
    default: return t.value('pasteInterceptTitle')
  }
})

const message = computed(() => {
  switch (status.value) {
    case 'checking': return t.value('pasteInterceptCheckingMessage')
    case 'safe': return t.value('pasteInterceptSafeMessage')
    case 'error': return t.value('pasteInterceptErrorMessage')
    default: return t.value('pasteInterceptMessage')
  }
})

// The dialog itself, and the button focus lands on when it opens. Never the one
// that goes through with the paste – see `useModalDialog`.
const card = ref<HTMLElement | null>(null)
const safeButton = ref<HTMLElement | null>(null)

// Above anything the page can lay over it – see `useTopLayer`. A close that
// was not ours keeps the paste out, never lets it in.
const layer = useTopLayer({
  mode: 'modal',
  visible: () => props.visible && Boolean(props.data),
  onDismiss: () => emit('cancel'),
})

// Over what is on the screen, not the layout viewport, see `viewportCoverStyle`
const cover = useVisualViewport(() => props.visible && Boolean(props.data))

useModalDialog({
  visible: () => props.visible && Boolean(props.data),
  container: () => card.value,
  initialFocus: () => safeButton.value,
  onEscape: () => emit('cancel'),
})

/**
 * How long "Allow pasting" ignores a press after it appears, so the second
 * half of a hurried double press cannot be the one that lets the paste through.
 */
const RISK_DELAY_MS = 500
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | undefined

// Counted from the moment the button appears, not from when the dialog opened:
// while the site is being checked there is only "Don't paste", and "Allow
// pasting" takes its place on screen once the answer is in
watch(() => props.visible && Boolean(props.data) && isDecision.value, (shown) => {
  clearTimeout(armTimer)
  armed.value = false
  if (shown)
    armTimer = setTimeout(() => armed.value = true, RISK_DELAY_MS)
}, { immediate: true })

onBeforeUnmount(() => clearTimeout(armTimer))

function onAllow() {
  if (armed.value)
    emit('allow')
}

const payloadKind = computed(() => {
  const kind = props.data?.payload.kind
  return kind ? t.value(`pasteInterceptKind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`) : ''
})
</script>

<template>
  <Transition name="overlay-fade" appear @enter="layer.enter">
    <dialog
      v-if="visible && data"
      :style="cover"
      class="vz-layer z-[2147483647] flex items-center justify-center pointer-events-auto"
      :aria-label="title"
      @click.self="emit('cancel')"
    >
      <!-- Backdrop. Transparent to clicks, or it would sit between the user and
           the overlay behind it and swallow every click-outside -->
      <div class="absolute inset-0 vz-scrim pointer-events-none" />

      <div
        ref="card"
        class="relative dialog-container vz-overlay vz-dialog"
        :data-status="status"
      >
        <VzSig />
        <div class="vz-dialog__head">
          <VzIcon v-if="status === 'safe'" name="pass" large class="tone-safe" />
          <VzIcon v-else-if="status === 'checking'" name="pending" large class="tone-neutral" />
          <VzIcon v-else-if="status === 'error'" name="unknown" large class="tone-neutral" />
          <VzIcon v-else name="alert" large class="tone-danger" />
          <h2 class="vz-title">
            {{ title }}
          </h2>
          <button
            :aria-label="t('closeDialog')"
            :title="t('closeDialog')"
            class="vz-iconbtn"
            @click="emit('cancel')"
          >
            <VzIcon name="close" />
          </button>
        </div>

        <p class="vz-body">
          {{ message }}
        </p>

        <!-- The box is not part of the page the address bar names. That is the
             fact worth reading before anything about visit counts. -->
        <VzNotice v-if="data.inFrame" tone="danger">
          <span class="vz-body-strong">{{ t('pasteInterceptInFrame') }}</span>
        </VzNotice>

        <!-- The address is the point of the whole dialog, so it gets the weight.
             The facts under it are only shown once there are any: a dialog put up
             before the check finished has nothing to report but the name. -->
        <div class="vz-well grid gap-3">
          <div class="dialog-address">
            <SecureText :text="data.domain" size="l" :diff="linkDiff(data.domain)">
              <CopyButton :text="data.domain" />
            </SecureText>
            <VzBadge v-if="status === 'safe'" tone="safe" icon="shield-pass" data-verdict="familiar">
              {{ t('linkTooltipFamiliar') }}
            </VzBadge>
            <VzBadge v-else-if="status === 'checking'" tone="neutral" icon="pending" data-verdict="checking">
              {{ t('statusChecking') }}
            </VzBadge>
            <VzBadge v-else-if="status === 'unfamiliar'" :tone="statusLabel(false, data.stats.count).tone" :icon="statusLabel(false, data.stats.count).icon" :data-verdict="statusLabel(false, data.stats.count).verdict">
              {{ statusLabel(false, data.stats.count).text }}
            </VzBadge>
            <!-- Asked as the lines below ask, once they are drawn -->
            <RedFlagCount v-if="status !== 'checking'" :hostname="data.domain" />
          </div>
          <FamiliarityFacts v-if="status === 'unfamiliar'" :stats="data.stats" />

          <!-- Punycode. Skipped when it would repeat the domain verbatim -->
          <VzNotice v-if="data.punycode && data.punycode !== data.domain" tone="danger" bare>
            {{ t('linkTooltipPunycode') }}: <SecureText :text="data.punycode" size="s" :diff="linkDiff(data.punycode)">
              <CopyButton :text="data.punycode" />
            </SecureText>
          </VzNotice>

          <!-- Structural markers. These read the name itself, so they are worth
               showing even when the visit history could not be reached. -->
          <!-- Held back while the verdict is out, like the lookalike line under it, so
               the platform line does not flash up for a site that is familiar -->
          <DomainMarkers :hostname="data.domain" :familiar="status === 'safe' || status === 'checking'" bare />
          <LookalikeNotice v-if="status !== 'checking'" :hostname="data.domain" bare />
        </div>

        <!-- What is on the clipboard, described before it is shown. A paste
             held in an iframe keeps its text there, so there is nothing to
             describe and nothing worth sending across for the sake of it. -->
        <div v-if="!data.inFrame" class="vz-well grid gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="vz-small">
              {{ payloadKind }} · {{ data.payload.length }} {{ t('pasteInterceptChars') }}
            </span>
            <button class="vz-btn vz-btn--sm" data-action="reveal" @click="revealed = !revealed">
              <VzIcon name="view" />{{ revealed ? t('pasteInterceptHide') : t('pasteInterceptReveal') }}
            </button>
          </div>
          <!-- v-text rather than interpolation: the preview renders with pre-wrap,
               so any indentation the formatter puts inside the tag would show up
               as blank space in front of the payload -->
          <div
            v-if="revealed"
            class="payload-preview"
            v-text="data.payload.preview"
          />
        </div>

        <!-- Said before the button is pressed, so the paste not happening on its
             own reads as the design rather than as a bug -->
        <p v-if="status === 'unfamiliar'" class="vz-small">
          {{ t('pasteInterceptRepeatHint') }}
        </p>

        <!--
          Where a tickbox used to be, and for the reason given in `InputWarning`:
          it silenced the site for good, and this dialog is raised mid-paste,
          with the reader in a hurry and a page free to tell them which box to
          tick. Saying where the switch is costs the same one line and cannot be
          aimed. Nothing to say while there is no verdict.
        -->
        <p v-if="status === 'unfamiliar'" class="vz-small">
          {{ t('warningSilenceHint') }}
        </p>

        <!-- The way out is the loud button. Refusing is named rather than left
             to the close cross: this dialog interrupts a real action, so the way
             out has to be as obvious as the way through. -->
        <div class="vz-dialog__actions">
          <!-- One button where there is nothing to weigh up: the paste is already
               cancelled either way, and the only thing left is to say so -->
          <template v-if="status === 'safe'">
            <button class="vz-btn" data-action="details" @click="emit('details', data.domain)">
              {{ t('linkInterceptDomainInfo') }}
            </button>
            <button ref="safeButton" class="vz-btn vz-btn--primary" data-action="understood" @click="emit('allow')">
              {{ t('pasteInterceptUnderstood') }}
            </button>
          </template>
          <template v-else-if="isDecision">
            <button ref="safeButton" class="vz-btn vz-btn--primary" data-action="cancel" @click="emit('cancel')">
              {{ t('pasteInterceptCancel') }}
            </button>
            <button class="vz-btn" data-action="details" @click="emit('details', data.domain)">
              {{ t('linkInterceptDomainInfo') }}
            </button>
            <button class="vz-btn vz-btn--risk" data-action="allow" @click="onAllow">
              {{ t('pasteInterceptAllow') }}
            </button>
          </template>
          <button v-else ref="safeButton" class="vz-btn vz-btn--primary" data-action="cancel" @click="emit('cancel')">
            {{ t('pasteInterceptCancel') }}
          </button>
        </div>
      </div>
    </dialog>
  </Transition>
</template>

<style scoped>
.dialog-container {
  width: min(440px, var(--vz-vw, 100vw) - 32px);
  max-width: none;
  /* The actions are at the bottom, and this dialog is raised by a paste –
     which on a phone means the keyboard is up and the viewport is already half
     of what it was. Without a cap of its own it grew past the visible area and
     took its buttons with it. `dvh` is the measurement that follows the
     keyboard, and the safe-area insets keep it clear of the gesture bar. */
  max-height: calc(var(--vz-vh, 100dvh) - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dialog-address {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* The payload is arbitrary text from an untrusted page, so it is boxed in:
   wrapped rather than stretching the dialog, and scrolled rather than growing it */
.payload-preview {
  font-family: var(--font-mono);
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 6px 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 120px;
  overflow-y: auto;
}
</style>
