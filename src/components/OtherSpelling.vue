<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

/**
 * The other spelling of an international name, straight under the address it
 * belongs to: the readable one under an `xn--` address, the coded one under a
 * readable address.
 *
 * Part of the address, not a finding about it. It used to be a warning line
 * among the findings, headed "Also written", with a warning sign of its own.
 * But it warns of nothing: it is the same address, and what is wrong with the
 * name, if anything is, is said by the red flag about its alphabet. What the
 * reader needs from this line is what the coded address was made to be read
 * as, and they need it next to that address.
 */
const props = defineProps<{
  /** The address as it is drawn above this line. */
  shown: string
  /** Its other spelling. Nothing is drawn when there is none or it is the same. */
  other?: string | null
  /** Marks the letters that differ from a familiar name, as the address above does. */
  diff?: number[]
}>()

const { t } = useI18n()

const label = computed(() => /(?:^|\.)xn--/i.test(props.shown) ? t.value('addressMeantToReadAs') : t.value('domainPunycode'))
</script>

<template>
  <!-- What the two spellings are, for the reader who has never met an xn--
       address, behind a question mark. True under either label, so it speaks
       of both spellings and not of "the one above" -->
  <div v-if="other && other !== shown" class="vz-small other-spelling" data-other-spelling>
    {{ label }}: <SecureText :text="other" size="s" :diff="diff">
      <CopyButton :text="other" />
    </SecureText>
    <VzHelp :text="t('addressSpellingHelp')" :about="shown" />
  </div>
</template>
