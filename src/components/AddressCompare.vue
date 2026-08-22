<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
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
}>()

const isDark = inject('isDark', ref(false))
const { t } = useI18n()

const expanded = ref(false)
const pasted = ref('')

// A different address is a different question, so the old answer goes with it
watch(() => props.address, () => {
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
    text: (t.value('addressCompareDiffers') || '').replace('{n}', String(result.differences)),
    good: false,
  }
})

function cellClass(same: boolean) {
  if (same)
    return isDark.value ? 'text-gray-300' : 'text-gray-600'
  return isDark.value ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700'
}
</script>

<template>
  <div class="mt-2">
    <button
      class="flex items-center gap-1 text-left opacity-70 hover:opacity-100 transition-opacity"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ t('addressCompareTitle') }}</span>
    </button>

    <div v-if="expanded" class="mt-1">
      <p class="opacity-60 leading-snug mb-1">
        {{ t('addressCompareHint') }}
      </p>

      <input
        v-model="pasted"
        type="text"
        class="w-full px-2 py-1 rounded border"
        :class="isDark
          ? 'bg-gray-900 border-gray-600 text-gray-200'
          : 'bg-white border-gray-300 text-gray-800'"
        :placeholder="t('addressComparePlaceholder')"
      >

      <p v-if="pasted.trim() && !known" class="mt-1 opacity-60">
        {{ t('addressCompareNotAnAddress') }}
      </p>

      <template v-if="comparison">
        <!-- One grid so both rows share their columns: a character and the one it
             is being held against always sit in the same place. Scrolls sideways
             rather than wrapping, because a wrapped row would break that. -->
        <div class="mt-1.5 overflow-x-auto">
          <div class="inline-grid gap-y-0.5 font-mono" style="grid-auto-flow: column; grid-template-rows: auto auto;">
            <div class="pr-2 opacity-50 whitespace-nowrap">
              {{ t('addressCompareChecked') }}
            </div>
            <div class="pr-2 opacity-50 whitespace-nowrap">
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

        <p
          v-if="verdict"
          class="mt-1 leading-snug"
          :class="verdict.good
            ? (isDark ? 'text-green-400' : 'text-green-700')
            : (isDark ? 'text-red-400' : 'text-red-600')"
        >
          {{ verdict.text }}
        </p>
      </template>
    </div>
  </div>
</template>
