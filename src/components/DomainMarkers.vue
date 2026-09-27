<script setup lang="ts">
import type { DomainMarkerId, EmbeddedDomain } from '~/logic/domain-markers'
import { computed, inject, ref } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikes } from '~/composables/useLookalikes'
import { dropExplainedMarkers, findDomainMarkers } from '~/logic/domain-markers'

// Structural facts about an address – never a verdict, so this renders as a
// short list of observations rather than as a safe/unsafe badge.
const props = defineProps<{
  hostname: string
  url?: string | null
  /**
   * The context the lookalike notice beside this one is asked in. The two read
   * one shared answer, so it has to be the same question.
   */
  context?: 'email'
  /**
   * Lines the caller knows and this component does not – what a list says about
   * the host, say. Drawn first, in the same shape, so a notice and a marker under
   * one address read as one list rather than two blocks with a gap between them.
   */
  notes?: { id: string, text: string }[]
}>()

const isDark = inject('isDark', ref(false))
const { t } = useI18n()

const TRANSLATION_KEYS: Record<DomainMarkerId, string> = {
  'url-userinfo': 'domainMarkerUserinfo',
  'ip-host': 'domainMarkerIpHost',
  'embedded-public-suffix': 'domainMarkerEmbeddedSuffix',
  'deep-subdomains': 'domainMarkerDeepSubdomains',
  'mixed-scripts': 'domainMarkerMixedScripts',
}

const found = computed(() => {
  if (!props.hostname)
    return []
  return findDomainMarkers(props.hostname, props.url)
})

// Only the embedded ending can be explained by a lookalike, so nothing is asked
// about an address that does not have one
const hasEmbedded = computed(() => found.value.some(marker => marker.id === 'embedded-public-suffix'))
const lookalikes = useLookalikes(() => props.hostname, () => props.context, () => hasEmbedded.value)

/**
 * Every place that shows markers shows the lookalike notice beside them, so
 * this is the one place that decides which of the two explains an address.
 * The embedded ending is held back while the answer is on its way: drawn at
 * once, it would appear for a moment and vanish again under the lookalike
 * line that replaces it.
 */
const markers = computed(() => {
  const answer = lookalikes.value
  if (!answer)
    return found.value
  if (answer.status === 'pending')
    return found.value.filter(marker => marker.id !== 'embedded-public-suffix')
  return dropExplainedMarkers(found.value, answer.status === 'answered' ? answer.matches : null)
})

type SentencePart
  = | { text: string }
    | { kind: 'imitated' | 'site', name: string, glue: string }

/**
 * The sentence around the two names, each drawn as an address of its own: the
 * domain the address reads as in grey, as the familiar one is in the lookalike
 * line, and the site it really belongs to in this line's colour.
 */
function embeddedSentence(marker: EmbeddedDomain): SentencePart[] {
  let text = t.value(TRANSLATION_KEYS['embedded-public-suffix'])
  // A translation that lost a placeholder must not lose the name with it –
  // the names are the evidence, the words around them are not
  for (const placeholder of ['{domain}', '{site}']) {
    if (!text.includes(placeholder))
      text += ` ${placeholder}`
  }

  const pieces = text.split(/\{(domain|site)\}/)
  const parts: SentencePart[] = []
  for (let index = 0; index < pieces.length; index++) {
    if (index % 2 === 0) {
      if (pieces[index])
        parts.push({ text: pieces[index] })
      continue
    }
    // The comma after a name stays with it rather than opening the next line
    const next = pieces[index + 1] ?? ''
    const glue = /^[^\s\p{L}\p{N}]*/u.exec(next)?.[0] ?? ''
    pieces[index + 1] = next.slice(glue.length)
    parts.push(pieces[index] === 'domain'
      ? { kind: 'imitated', name: marker.imitated, glue }
      : { kind: 'site', name: marker.site, glue })
  }
  return parts
}
</script>

<template>
  <div v-if="markers.length || notes?.length" class="mb-2 flex flex-col gap-1">
    <div
      v-for="note in notes"
      :key="note.id"
      :data-marker-note="note.id"
      class="flex items-start gap-1 leading-snug"
      :class="isDark ? 'text-amber-400' : 'text-amber-700'"
    >
      <span class="flex-shrink-0" aria-hidden="true">⚠</span>
      <span class="break-words">{{ note.text }}</span>
    </div>
    <div
      v-for="marker in markers"
      :key="marker.id"
      :data-marker="marker.id"
      class="flex items-start gap-1 leading-snug"
      :class="isDark ? 'text-amber-400' : 'text-amber-700'"
    >
      <span class="flex-shrink-0" aria-hidden="true">⚠</span>
      <!-- break-words, not break-all: wrap between words, and only ever split a
           word that cannot fit on its own. An address or an IPv4 stays intact. -->
      <span v-if="marker.id === 'embedded-public-suffix'" class="break-words">
        <template v-for="(part, index) in embeddedSentence(marker)" :key="index">
          <template v-if="'text' in part">{{ part.text }}</template><span v-else class="whitespace-nowrap"><!--
            Blocked like the names in the lookalike line, so where each
            starts and stops is as plain.
          --><span
            :data-marker-imitated="part.kind === 'imitated' ? '' : undefined"
            :data-marker-site="part.kind === 'site' ? '' : undefined"
            class="inline-block max-w-full font-mono px-1 rounded whitespace-normal"
            :class="part.kind === 'imitated'
              ? (isDark ? 'bg-gray-700 text-gray-100' : 'bg-gray-100 text-gray-800')
              : (isDark ? 'bg-amber-400/20 text-amber-100' : 'bg-amber-100 text-amber-900')"
            ><SecureText :text="part.name" force-highlight danger-only /></span>{{ part.glue }}</span>
        </template>
      </span>
      <span v-else class="break-words">
        {{ t(TRANSLATION_KEYS[marker.id]) }}<template v-if="marker.detail">:
          <!-- The depth is a count, not a piece of the address. Through
               SecureText its digits came out blue and bold, the colour that
               marks a digit standing in for a letter, as though the number
               itself were suspect. -->
          <span v-if="marker.id === 'deep-subdomains'" data-marker-count>{{ marker.detail }}</span>
          <SecureText v-else :text="marker.detail" force-highlight danger-only class="font-mono whitespace-nowrap" />
        </template>
      </span>
    </div>
  </div>
</template>
