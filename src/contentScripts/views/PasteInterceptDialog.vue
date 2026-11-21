<script setup lang="ts">
import type { PasteInterceptData } from '~/logic/ui-state'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import VzIcon from '~/components/VzIcon.vue'
import VzSig from '~/components/VzSig.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
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
/** The verdict under the address. None when the check failed: the title says so. */
const addressBadge = computed(() => {
  switch (status.value) {
    // Let through because the user silenced this site is not the same as familiar
    case 'safe': return statusLabel(props.data?.domain ?? '', !props.data?.silenced, props.data?.stats.count ?? 0)
    case 'checking': return { verdict: 'checking', text: t.value('statusChecking'), tone: 'neutral' as const, icon: 'pending' as const }
    case 'unfamiliar': return statusLabel(props.data?.domain ?? '', false, props.data?.stats.count ?? 0)
    default: return null
  }
})
const isDecision = computed(() => status.value === 'unfamiliar' || status.value === 'error')

// A paste held on a site that turned out familiar is titled as any held
// paste. Titled "Familiar site" with a green check it read as a result worth a
// dialog, when it is a hiccup: the device was too slow to have the check in
// when the paste came, and a paste once stopped cannot be let through. The
// line under the title says so, and the verdict is under the address as
// everywhere else.
const title = computed(() => {
  switch (status.value) {
    case 'checking': return t.value('pasteInterceptCheckingTitle')
    case 'error': return t.value('pasteInterceptErrorTitle')
    default: return t.value('pasteInterceptTitle')
  }
})

const message = computed(() => {
  switch (status.value) {
    case 'checking': return t.value('pasteInterceptCheckingMessage')
    case 'safe': return t.value(props.data?.silenced ? 'pasteInterceptSilencedMessage' : props.data?.nowFamiliar ? 'pasteInterceptNowFamiliarMessage' : 'pasteInterceptSafeMessage')
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

// A line of help opening moves the buttons of a centred card under the
// pointer, so the press after it waits the same half second
function onCardPress(event: MouseEvent) {
  if (!isDecision.value || !(event.target as Element | null)?.closest?.('[data-action="help"]'))
    return
  clearTimeout(armTimer)
  armed.value = false
  armTimer = setTimeout(() => armed.value = true, RISK_DELAY_MS)
}

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
        @click.capture="onCardPress"
      >
        <div class="vz-dialog__head">
          <VzSig :mark="status === 'safe' ? 'info' : status === 'checking' ? 'pending' : status === 'error' ? 'unknown' : 'alert'" large />
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

        <!-- The address is the point of the whole dialog, so it gets the weight.
             The facts under it are only shown once there are any: a dialog put up
             before the check finished has nothing to report but the name. -->
        <div class="vz-well grid gap-3">
          <!-- While the verdict is out nothing that depends on it is drawn, so a
               line about a platform or a lookalike does not flash up for a
               site that turns out familiar -->
          <!-- A paste in a frame is judged by the page the frame sits on, so
               the address is the page's, and is headed as that. Nothing is
               said about the frame itself, not even that another site serves
               it: the dialog is up because the page is unfamiliar, a familiar
               page raises none whatever its frames, so the line never changed
               what a reader should do. Naming that site was worse than
               useless: nobody visits the address of a payment box, so it can
               only ever read "Never visited", or stand there unchecked -->
          <AddressBlock
            :heading="data.inFrame ? t('pasteInterceptPageHeading') : undefined"
            :hostname="data.domain"
            :punycode="data.punycode"
            :badge="addressBadge"
            :familiar="(status === 'safe' && !data.silenced) || status === 'checking'"
            :facts="status === 'unfamiliar' ? data.stats : null"
            :pending="status === 'checking'"
          />
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
          <!-- Risk, details, way out: the way out at the right edge in every
               state, as in the link dialog -->
          <template v-else-if="isDecision">
            <button class="vz-btn vz-btn--risk" data-action="allow" @click="onAllow">
              {{ t('pasteInterceptAllow') }}
            </button>
            <button class="vz-btn" data-action="details" @click="emit('details', data.domain)">
              {{ t('linkInterceptDomainInfo') }}
            </button>
            <button ref="safeButton" class="vz-btn vz-btn--primary" data-action="cancel" @click="emit('cancel')">
              {{ t('pasteInterceptCancel') }}
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
