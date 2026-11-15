<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'

defineOptions({ inheritAttrs: false })

/**
 * A question mark beside something a reader may stop at, with what they need
 * to know at that step to decide: why a button says "try", what a box from
 * another site means, how sure "most likely" is.
 *
 * For the reader who never opens the settings, where most of this is written
 * down. Read on hover, as every other explanation of a control here is, and
 * opened by a press where nothing hovers, a phone or a keyboard: the same
 * words go on a line of their own under the row.
 *
 * No element of its own. The button stands in the caller's row and takes the
 * caller's attributes. The line takes a whole row of a wrapping flex parent,
 * or the next line of a block, so the parent has to be one of the two.
 */
const props = defineProps<{
  text: string
  /**
   * What the help is about, an address mostly. When that changes under a
   * surface that stays up, a tooltip moving to the next link, the line closes:
   * left open, it stood under a link nobody had asked about.
   */
  about?: string
}>()

const { t } = useI18n()

const open = ref(false)
watch(() => props.about, () => {
  open.value = false
})

/**
 * The opened line, brought into view inside the box it opened in. A tooltip
 * already at its full height scrolls, and a press that put the line below
 * the fold looked like a press that did nothing. Only that box is moved, by
 * hand: `scrollIntoView` may scroll the web page under it as well.
 */
const line = ref<HTMLElement | null>(null)
watch(open, async (isOpen) => {
  if (!isOpen)
    return
  await nextTick()
  const element = line.value
  if (!element)
    return
  for (let box = element.parentElement; box; box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight || !/auto|scroll/.test(getComputedStyle(box).overflowY))
      continue
    const below = element.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom
    if (below > 0)
      box.scrollTop += below + 4
    break
  }
})
</script>

<template>
  <!-- A short name, with what it says as its description: the whole text as
       the name was up to 400 characters of button name. Several of these on
       one screen are told apart by that description. Once the line is open
       the words are on screen, so the hover text and the description go:
       they said the same thing over the line they were said on -->
  <button
    type="button"
    class="vz-iconbtn vz-iconbtn--xs vz-help"
    v-bind="$attrs"
    :title="open ? undefined : text"
    :aria-label="t('helpButtonLabel')"
    :aria-description="open ? undefined : text"
    :aria-expanded="open"
    data-action="help"
    @click.stop="open = !open"
  >
    <VzIcon name="help" />
  </button>
  <p v-if="open" ref="line" class="vz-small vz-help__text" data-help-text>
    {{ text }}
  </p>
</template>
