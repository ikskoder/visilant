<script setup lang="ts">
import type { DomainMarkerId, EmbeddedDomain } from '~/logic/domain-markers'
import { computed, inject } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikes } from '~/composables/useLookalikes'
import { ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
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
  notes?: { id: string, text: string, icon?: 'link' }[]
  /** No box around each line, for the tooltip where space is tight. */
  bare?: boolean
  /**
   * The address is one the user knows. Leaves out the line about the hosting
   * platform: it is there to stop a famous platform name from vouching for a
   * stranger, and a site the user already knows needs no vouching.
   */
  familiar?: boolean
}>()

const { t } = useI18n()

const TRANSLATION_KEYS: Record<DomainMarkerId, string> = {
  'url-userinfo': 'domainMarkerUserinfo',
  'ip-host': 'domainMarkerIpHost',
  'embedded-public-suffix': 'domainMarkerEmbeddedSuffix',
  'deep-subdomains': 'domainMarkerDeepSubdomains',
  'mixed-scripts': 'domainMarkerMixedScripts',
}

const lookupShape = inject(ADDRESS_SHAPE_KEY, askBackgroundShape)

/**
 * The platform this address is a tenant of, `github.io` for `alice.github.io`.
 * Anybody can open a site there, and the platform's name in the address reads
 * as the platform's word for the site, which it is not.
 */
const platform = computed(() => props.hostname && !props.familiar ? lookupShape(props.hostname)?.platform : undefined)

const hostedSentence = computed(() => {
  const [before = '', after = ''] = t.value('domainMarkerHostedOn').split('{platform}')
  const glue = /^[^\s\p{L}\p{N}]*/u.exec(after)?.[0] ?? ''
  return { before, glue, after: after.slice(glue.length) }
})

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
  <!-- Every line here is a warning, so every line is red with the one warning
       sign. There used to be an amber step below red, and a reader cannot tell
       three warm colours apart at a glance. -->
  <div v-if="markers.length || notes?.length || platform" class="domain-markers grid gap-2">
    <VzNotice
      v-for="note in notes"
      :key="note.id"
      tone="danger"
      :icon="note.icon"
      :bare="bare"
      :data-marker-note="note.id"
    >
      {{ note.text }}
    </VzNotice>
    <VzNotice v-if="platform" tone="danger" :bare="bare" data-marker="hosted-on">
      {{ hostedSentence.before }}<span class="vz-nobr"><SecureText :text="platform" size="s" data-marker-platform />{{ hostedSentence.glue }}</span>{{ hostedSentence.after }}
    </VzNotice>
    <VzNotice
      v-for="marker in markers"
      :key="marker.id"
      tone="danger"
      :bare="bare"
      :data-marker="marker.id"
    >
      <template v-if="marker.id === 'embedded-public-suffix'">
        <template v-for="(part, index) in embeddedSentence(marker)" :key="index">
          <template v-if="'text' in part">
            {{ part.text }}
          </template><span v-else class="vz-nobr"><SecureText
            :text="part.name"
            size="s"

            :data-marker-imitated="part.kind === 'imitated' ? '' : undefined"
            :data-marker-site="part.kind === 'site' ? '' : undefined"
          />{{ part.glue }}</span>
        </template>
      </template>
      <template v-else>
        {{ `${t(TRANSLATION_KEYS[marker.id])}${marker.detail ? ':' : ''}` }}
        <template v-if="marker.detail">
          <!-- The depth is a count, not a piece of the address, so it is not
               drawn as one -->
          <b v-if="marker.id === 'deep-subdomains'" data-marker-count>{{ marker.detail }}</b>
          <!-- The part before @ is ignored by the browser and dressed as a
               site, so it is struck through rather than framed -->
          <span v-else-if="marker.id === 'url-userinfo'" class="vz-addr vz-addr--s vz-decoy">{{ marker.detail }}</span>
          <SecureText v-else :text="marker.detail" :kind="marker.id === 'mixed-scripts' ? 'raw' : 'host'" size="s" />
        </template>
      </template>
    </VzNotice>
  </div>
</template>
