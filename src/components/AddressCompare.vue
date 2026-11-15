<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { compareAddresses } from '~/logic/address-compare'
import { extractEmailFromText } from '~/logic/email-safety'

/**
 * The checked address against one the user already trusts.
 *
 * Everything else here judges a domain. This judges the name in front of it,
 * which is the half no history can speak for: a domain the user has written to
 * for years says nothing about whether today's sender is the same person. The
 * only thing that does is an earlier address, and comparing the two by eye is
 * exactly the task eyes are worst at.
 *
 * Nothing is stored and nothing is sent. The pasted address lives in this
 * component until the panel is closed.
 */
const props = defineProps<{
  address: string
  /**
   * Which question this is. Given, a new address under the same key keeps what
   * was pasted: one trusted address held against each recipient of a link in
   * turn. Without it every new address is a new question.
   */
  resetKey?: number | string
}>()

const { t } = useI18n()

const expanded = ref(false)
const pasted = ref('')

// A different address is a different question, so the old answer goes with it
watch(() => props.resetKey ?? props.address, () => {
  pasted.value = ''
  expanded.value = false
})

/** Pasted text is usually a whole `Name <address>`, or a line out of a client. */
const known = computed(() => extractEmailFromText(pasted.value.trim()))

const comparison = computed(() => known.value ? compareAddresses(props.address, known.value) : null)

const verdict = computed(() => {
  const result = comparison.value
  if (!result)
    return null
  if (result.identical)
    return { text: t.value('addressCompareIdentical'), good: true }
  if (result.sameIgnoringCase)
    return { text: t.value('addressCompareCaseOnly'), good: true }
  return {
    text: result.differences === 1
      ? t.value('addressCompareDiffersOne')
      : (t.value('addressCompareDiffers') || '').replace('{n}', String(result.differences)),
    good: false,
  }
})

/** A differing pair is marked like an unexpected character in an address. */
function cellClass(same: boolean) {
  return same ? 'text-ink-2' : 'vz-ch--foreign'
}
</script>

<template>
  <div class="address-compare">
    <button
      class="vz-btn vz-btn--quiet vz-btn--sm vz-btn--flush"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <VzIcon :name="expanded ? 'chevron-down' : 'chevron-right'" />
      <span>{{ t('addressCompareTitle') }}</span>
    </button>

    <div v-if="expanded" class="mt-1 grid gap-2">
      <p class="vz-small">
        {{ t('addressCompareHint') }}
      </p>

      <input
        v-model="pasted"
        type="text"
        class="vz-input vz-input--addr w-full"
        :placeholder="t('addressComparePlaceholder')"
      >

      <p v-if="pasted.trim() && !known" class="vz-small">
        {{ t('addressCompareNotAnAddress') }}
      </p>

      <template v-if="comparison">
        <!-- One grid so both rows share their columns: a character and the one it
             is being held against always sit in the same place. Scrolls sideways
             rather than wrapping, because a wrapped row would break that. -->
        <div class="vz-well vz-scroll-x">
          <div class="vz-addr inline-grid gap-y-1" style="grid-auto-flow: column; grid-template-rows: auto auto;">
            <div class="pr-2 vz-eyebrow whitespace-nowrap self-center">
              {{ t('addressCompareChecked') }}
            </div>
            <div class="pr-2 vz-eyebrow whitespace-nowrap self-center">
              {{ t('addressCompareKnown') }}
            </div>

            <template v-for="(cell, index) in comparison.cells" :key="index">
              <!-- The dot is not a character in the address, it is the absence of
                   one: this side has nothing where the other side has something -->
              <div class="px-0.5 text-center" :class="cellClass(cell.same)">
                {{ cell.checked ?? '·' }}
              </div>
              <div class="px-0.5 text-center" :class="cellClass(cell.same)">
                {{ cell.known ?? '·' }}
              </div>
            </template>
          </div>
        </div>

        <VzNotice v-if="verdict" :tone="verdict.good ? 'neutral' : 'danger'" :icon="verdict.good ? 'pass' : 'fail'">
          {{ verdict.text }}
        </VzNotice>
      </template>
    </div>
  </div>
</template>
