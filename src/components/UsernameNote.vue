<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { SCRIPT_KEYS } from '~/logic/domain-markers'
import { usernameNote } from '~/logic/username-characters'

/**
 * The line about the username of an email address, the part before the @,
 * when something in it is not plain Latin: what exactly, and what it can mean
 * (`usernameNote`). One component for every surface that draws an address, so
 * the line reads the same in the tooltip, the check panel and a list of
 * recipients. Draws nothing for a plain username. Letters of another
 * alphabet drawn as Latin ones are a red flag (`usernameRedFlag`), the rest
 * is orange.
 */
const props = defineProps<{ local: string }>()

const { t } = useI18n()
const note = computed(() => usernameNote(props.local))

const alphabet = (script: string) => t.value(SCRIPT_KEYS[script] ?? 'scriptOther')

/** The words before the framed username, the username, the words after it */
const sentence = computed(() => {
  const found = note.value
  if (!found)
    return null
  switch (found.kind) {
    case 'invisible':
      return { text: found.count === 1 ? t.value('emailLocalInvisibleOne') : t.value('emailLocalInvisibleMany').replace('{n}', String(found.count)) }
    case 'lookalike': {
      const first = (found.count === 1 ? t.value('emailLocalLookalikeOne') : t.value('emailLocalLookalikeMany').replace('{n}', String(found.count)))
        .replace('{alphabet}', alphabet(found.script))
      if (!found.reads)
        return { text: `${first} ${t.value('emailLocalPassesFor')}` }
      const [before, after] = t.value('emailLocalReadsAs').split('{reads}')
      return { text: `${first} ${before}`, framed: found.reads, after }
    }
    case 'styled': {
      const [before, after] = t.value('emailLocalStyled').split('{reads}')
      return { text: before, framed: found.reads, after }
    }
    case 'mixed':
      return { text: t.value('emailLocalMixed').replace('{alphabet}', alphabet(found.script)) }
    case 'marks': {
      const [before, after] = t.value('emailLocalMarks').split('{plain}')
      return { text: before, framed: found.plain, after }
    }
    case 'script':
      return { text: t.value('emailLocalScript').replace('{alphabet}', alphabet(found.script)) }
    default:
      return { text: t.value('emailLocalOther') }
  }
})
</script>

<template>
  <VzNotice v-if="note && sentence && note.kind === 'lookalike'" tone="danger" icon="flag" data-status="username" :data-username="note.kind" data-red-flag>
    {{ sentence.text }}<template v-if="sentence.framed">
      <SecureText :text="sentence.framed" kind="account" size="s" plain data-username-reads />{{ sentence.after }}
    </template>
  </VzNotice>
  <VzNotice v-else-if="note && sentence" tone="caution" data-status="username" :data-username="note.kind">
    {{ sentence.text }}<template v-if="sentence.framed">
      <SecureText :text="sentence.framed" kind="account" size="s" plain data-username-reads />{{ sentence.after }}
    </template>
  </VzNotice>
</template>
