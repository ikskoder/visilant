<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { trackOpenAddressParts } from '~/composables/openAddressParts'
import { useI18n } from '~/composables/useI18n'
import { ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
import { isIpHost } from '~/logic/domain-markers'

/**
 * A question mark after an address, and on it a card that reads that address
 * part by part: the username, the levels in front of the site, the site's own
 * name, its ending or the platform it is made on. Each with the pieces of
 * this address, in the frames it is drawn with, and what the frame means.
 * The frames said whose each part is, and nothing on screen said how to read
 * them.
 *
 * Read on hover, pinned by a press where nothing hovers, closed by a second
 * press, a press anywhere else, Esc (`closeOpenAddressParts`) or the pointer
 * leaving both the mark and an unpinned card. The card is a manual popover in
 * the top layer: a tooltip scrolls its content and would cut a card hung
 * below the address off at its edge.
 *
 * The mark sits in the address's own unit, after the copy button, so it never
 * falls to a line of its own. The card does not: it is moved out to the
 * surface. Inside, it took the address's owner frames for its own
 * pieces, the levels drawn as the site, and the address measured its pieces
 * for line breaks and found the card's.
 *
 * Draws nothing until the shape of the address is known, nor for an IP
 * address, which has no parts to read.
 */
const props = defineProps<{
  /** A hostname, or an email address */
  address: string
  /** As the address beside it, where a surface sets the case of its own */
  caseOverride?: 'lower' | 'upper'
}>()

const { t } = useI18n()
const lookupShape = inject(ADDRESS_SHAPE_KEY, askBackgroundShape)

const at = computed(() => props.address.lastIndexOf('@'))
const username = computed(() => at.value > 0 ? props.address.slice(0, at.value) : null)
const host = computed(() => (at.value >= 0 ? props.address.slice(at.value + 1) : props.address).replace(/[.。．｡]$/, ''))

const parts = computed(() => {
  if (!host.value || isIpHost(host.value))
    return null
  const shape = lookupShape(host.value)
  if (!shape || !shape.ownerLabels)
    return null
  // Split and joined again on the dots the address has, so a piece reads as
  // it does above
  const pieces = host.value.split(/([.。．｡])/)
  const labels = pieces.filter((_, index) => index % 2 === 0)
  const dots = pieces.filter((_, index) => index % 2 === 1)
  const join = (from: number, to: number) => labels.slice(from, to).map((label, index) => index === 0 ? label : `${dots[from + index - 1]}${label}`).join('')
  const owner = Math.min(shape.ownerLabels, labels.length)
  const suffix = Math.min(shape.suffixLabels, owner)
  const levels = join(0, labels.length - owner)
  const name = join(labels.length - owner, labels.length - suffix)
  const ending = join(labels.length - suffix, labels.length)
  if (!name || !ending || labels.some(label => !label))
    return null
  return { levels, name, ending, platform: Boolean(shape.platform) }
})

const open = ref(false)
// Opened by the pointer resting on the mark, or pinned by a press: a press on
// a mark the pointer has just opened keeps the card, it does not close it
const pinned = ref(false)
const mark = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const place = ref<Record<string, string>>({})
/** The surface the address is on, see above */
const target = ref<HTMLElement | null>(null)
let leaving: ReturnType<typeof setTimeout> | undefined
let untrack: (() => void) | undefined

// The mark comes and goes with the shape, which the content script asks for.
// The card goes to the surface the address is on, out of the block that holds
// the address, where a reader of that block took its username for a second
// one. Not further than a modal dialog, which makes everything outside it
// inert, nor past the page wrapper that carries the tokens in a web page.
watch(mark, (element) => {
  target.value = (element?.closest('dialog, [popover], .vz-root') as HTMLElement | null | undefined) ?? (element ? document.body : null)
}, { flush: 'post' })

function close() {
  open.value = false
  pinned.value = false
}

watch(() => props.address, close)
// The shape can be gone while the card is open, and the mark with it
watch(parts, (now) => {
  if (!now)
    close()
})

// Hung under the mark, kept inside the window, above it where there is no room below
function position() {
  const button = mark.value
  const box = card.value
  if (!button || !box)
    return
  // The size the surface was set to (A- / A+) is on an element the card is no longer in
  const scale = getComputedStyle(button).getPropertyValue('--vz-scale').trim()
  if (scale)
    box.style.setProperty('--vz-scale', scale)
  const r = button.getBoundingClientRect()
  const width = Math.min(box.offsetWidth, window.innerWidth - 16)
  const left = Math.max(8, Math.min(r.left - 24, window.innerWidth - width - 8))
  const below = r.bottom + 6
  const height = box.offsetHeight
  const top = below + height > window.innerHeight - 8 && r.top - 6 - height >= 8 ? r.top - 6 - height : below
  place.value = { left: `${left}px`, top: `${top}px`, ...(scale ? { '--vz-scale': scale } : {}) }
}

// Told by where the press is, not by the event path: on a web page the card
// is in a closed shadow root, which a listener on the window cannot see into
function within(element: HTMLElement | null, event: PointerEvent) {
  if (!element)
    return false
  const r = element.getBoundingClientRect()
  return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
}
function outsidePress(event: PointerEvent) {
  if (!within(card.value, event) && !within(mark.value, event))
    close()
}

// Where no dialog or tooltip takes Esc first, the popup above all, whose
// window Esc would otherwise close
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value)
    return
  event.preventDefault()
  close()
}

// A scroll inside a shadow root does not reach the window, the tooltip's own among them
let scrollRoot: ShadowRoot | null = null
function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  scrollRoot?.removeEventListener('scroll', position, true)
  const root = mark.value?.getRootNode()
  scrollRoot = on && root instanceof ShadowRoot ? root : null
  scrollRoot?.addEventListener('scroll', position, true)
  window[method]('scroll', position, true)
  window[method]('resize', position)
  window[method]('pointerdown', outsidePress as EventListener, true)
  window[method]('keydown', onEscape as EventListener)
}

watch(open, async (isOpen) => {
  untrack?.()
  untrack = isOpen ? trackOpenAddressParts(close) : undefined
  listen(isOpen)
  await nextTick()
  const box = card.value as (HTMLElement & { showPopover?: () => void, hidePopover?: () => void }) | null
  if (!box)
    return
  try {
    if (isOpen) {
      box.showPopover?.()
      position()
    }
    else {
      box.hidePopover?.()
    }
  }
  catch {
    // Already shown or hidden, or removed with the surface it was on
  }
})

function show() {
  clearTimeout(leaving)
  open.value = true
}
function press() {
  clearTimeout(leaving)
  if (open.value && !pinned.value) {
    pinned.value = true
    return
  }
  open.value = !open.value
  pinned.value = open.value
}
// A moment to cross from the mark to the card
function hideSoon() {
  clearTimeout(leaving)
  if (pinned.value)
    return
  leaving = setTimeout(close, 200)
}
onBeforeUnmount(() => {
  clearTimeout(leaving)
  untrack?.()
  listen(false)
})

const nameText = computed(() => t.value('addressPartNameText').split('{ending}'))
const platformText = computed(() => t.value('addressPartPlatformText').split('{name}'))
</script>

<template>
  <template v-if="parts">
    <button
      ref="mark"
      type="button"
      class="vz-iconbtn vz-iconbtn--xs vz-help vz-parts__mark"
      :aria-label="t('addressPartsAsk')"
      :title="open ? undefined : t('addressPartsAsk')"
      :aria-expanded="open"
      data-action="address-parts"
      @click.stop="press"
      @mouseenter="show"
      @mouseleave="hideSoon"
    >
      <VzIcon name="help" />
    </button>
    <Teleport v-if="target" :to="target">
      <div
        ref="card"
        popover="manual"
        class="vz-parts"
        :style="place"
        role="dialog"
        :aria-label="t('addressPartsAsk')"
        data-address-parts
        @mouseenter="show"
        @mouseleave="hideSoon"
      >
        <dl class="vz-parts__list">
          <template v-if="username !== null">
            <dt><SecureText kind="account" :text="username" size="s" :case-override="caseOverride" plain /></dt>
            <dd data-part="username">
              <b>{{ t('emailUsernameLabel') }}.</b> {{ t('addressPartUserText') }}
            </dd>
          </template>
          <template v-if="parts.levels">
            <dt><SecureText kind="label" part="free" :text="parts.levels" size="s" :case-override="caseOverride" plain /></dt>
            <dd data-part="levels">
              <b>{{ t('addressPartLevelsTitle') }}.</b> {{ t('addressPartLevelsText') }}
            </dd>
          </template>
          <dt><SecureText kind="label" part="name" :text="parts.name" size="s" :case-override="caseOverride" plain /></dt>
          <dd data-part="name">
            <b>{{ t('addressPartNameTitle') }}.</b> {{ nameText[0] }}<SecureText kind="label" part="ending" :text="parts.ending" size="s" :case-override="caseOverride" plain />{{ nameText[1] }}
          </dd>
          <dt><SecureText kind="label" part="ending" :text="parts.ending" size="s" :case-override="caseOverride" plain /></dt>
          <dd v-if="parts.platform" data-part="platform">
            <b>{{ t('addressPartPlatformTitle') }}.</b> {{ platformText[0] }}<SecureText kind="label" part="name" :text="parts.name" size="s" :case-override="caseOverride" plain />{{ platformText[1] }}
          </dd>
          <dd v-else data-part="ending">
            <b>{{ t('addressPartEndingTitle') }}.</b> {{ t('addressPartEndingText') }}
          </dd>
        </dl>
      </div>
    </Teleport>
  </template>
</template>
