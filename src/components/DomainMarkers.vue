<script setup lang="ts">
import type { DomainMarker, DomainMarkerId, EmbeddedDomain } from '~/logic/domain-markers'
import { computed, inject } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useDomainMarkers } from '~/composables/useRedFlags'
import { ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
import { decodeHostname, imitatedDomains, NATIONAL_ENDINGS, SCRIPT_KEYS } from '~/logic/domain-markers'
import { isRedFlagMarker } from '~/logic/red-flags'

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
  /**
   * The address is one the user knows. Leaves out the line about the hosting
   * platform: it is there to stop a famous platform name from vouching for a
   * stranger, and a site the user already knows needs no vouching.
   */
  familiar?: boolean
  /**
   * One half of the lines, for a caller that puts something between the two
   * (`AddressFindings`): the red flags, or everything else. Both when left out.
   */
  show?: 'flags' | 'cautions'
}>()

const { t } = useI18n()

const TRANSLATION_KEYS: Record<DomainMarkerId, string> = {
  'url-userinfo': 'domainMarkerUserinfo',
  'ip-host': 'domainMarkerIpHost',
  'embedded-public-suffix': 'domainMarkerEmbeddedSuffix',
  'deep-subdomains': 'domainMarkerDeepSubdomains',
  'mixed-scripts': 'domainMarkerMixedScripts',
  'non-latin-name': 'domainMarkerNonLatin',
  'mid-ending': 'emailSuspiciousPattern',
}

/**
 * A second sentence after the detail, for the markers whose label says what was
 * found but not why it matters. Kept apart from the label, which ends in the
 * detail itself ("Too many subdomain levels: 5").
 */
const WHY_KEYS: Partial<Record<DomainMarkerId, string>> = {
  'ip-host': 'domainMarkerIpHostWhy',
  'deep-subdomains': 'domainMarkerDeepSubdomainsWhy',
}

/**
 * The line's own words, with the alphabet and the ending named where the line
 * names them. A name of Latin twins gets the sharper line, since it is read as
 * the Latin name it imitates.
 */
function markerLabel(marker: DomainMarker): string {
  if (marker.id !== 'non-latin-name')
    return t.value(TRANSLATION_KEYS[marker.id])
  const alphabet = t.value(SCRIPT_KEYS[marker.script] ?? 'scriptOther')
  const key = marker.twins
    ? 'domainMarkerLatinTwins'
    : marker.tldScript === 'latin'
      ? 'domainMarkerNonLatin'
      : SCRIPT_KEYS[marker.tldScript] ? 'domainMarkerOtherEnding' : 'domainMarkerOtherEndingUnnamed'
  const label = t.value(key)
    .replace('{alphabet}', alphabet)
    .replace('{endingAlphabet}', t.value(SCRIPT_KEYS[marker.tldScript] ?? 'scriptOther'))
  // The alphabet opens two of these sentences, and the word for one with no
  // name of its own, "non-Latin", is written to stand mid-sentence
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function markerWhy(marker: DomainMarker): string | undefined {
  if (marker.id === 'non-latin-name')
    return marker.twins ? t.value('domainMarkerLatinTwinsWhy') : nonLatinWhy(marker.script)
  const key = WHY_KEYS[marker.id]
  return key ? t.value(key) : undefined
}

const lookupShape = inject(ADDRESS_SHAPE_KEY, askBackgroundShape)

/**
 * The platform this address is a tenant of, `github.io` for `alice.github.io`.
 * Anybody can open a site there, and the platform's name in the address reads
 * as the platform's word for the site, which it is not.
 */
const platform = computed(() => props.hostname && !props.familiar && props.show !== 'flags' ? lookupShape(props.hostname)?.platform : undefined)

/**
 * How many levels stand in front of the site. The check counts them without
 * the list of endings, so under a shared platform it counts one too many,
 * and the address above, which knows where the site starts, colours one
 * fewer than the line said. Once that is known the line says the same number.
 */
function depthOf(guess: string): string {
  const owner = lookupShape(props.hostname)?.ownerLabels ?? 0
  const count = props.hostname.replace(/[.。．｡]$/, '').split(/[.。．｡]/).length
  return owner > 0 && owner < count ? String(count - owner) : guess
}

/**
 * How the address above draws one of its labels, for the same label quoted in
 * a line under it: the owner's name, part of the ending, or a label in front
 * of the site. Unknown until the shape of the address is, and then the piece
 * is drawn plain, as the address itself is.
 */
function partOf(label: string): 'name' | 'ending' | 'free' | undefined {
  const shape = lookupShape(props.hostname)
  if (!shape?.ownerLabels)
    return undefined
  // The readable spelling, which is what a line quotes
  const labels = decodeHostname(props.hostname).toLowerCase().replace(/\.$/, '').split('.')
  const at = labels.lastIndexOf(label.toLowerCase())
  if (at < 0)
    return undefined
  if (at < labels.length - shape.ownerLabels)
    return 'free'
  return at >= labels.length - shape.suffixLabels ? 'ending' : 'name'
}

const hostedSentence = computed(() => {
  const [before = '', after = ''] = t.value('domainMarkerHostedOn').split('{platform}')
  const glue = /^[^\s\p{L}\p{N}]*/u.exec(after)?.[0] ?? ''
  return { before, glue, after: after.slice(glue.length) }
})

// Which markers are drawn, and which wait for the lookalike answer, is decided
// in `useDomainMarkers`, which the red-flag count beside the verdict reads too
const found = useDomainMarkers(() => props.hostname, () => props.url, () => props.context)
// The red flags first: the count beside the verdict is about them, and with
// two colours a red line under an orange one read as an afterthought
const markers = computed(() => [
  ...(props.show === 'cautions' ? [] : found.value.filter(isRedFlagMarker)),
  ...(props.show === 'flags' ? [] : found.value.filter(marker => !isRedFlagMarker(marker))),
])
const shownNotes = computed(() => props.show === 'flags' ? [] : props.notes ?? [])

type SentencePart
  = | { text: string }
    | { kind: string, name: string, glue: string }

/**
 * A sentence with pieces of the address in it, each drawn in its frame.
 * `names` gives what stands at each `{placeholder}`.
 */
function sentenceWith(text: string, names: Record<string, string>): SentencePart[] {
  // A translation that lost a placeholder must not lose the name with it –
  // the names are the evidence, the words around them are not
  for (const key of Object.keys(names)) {
    if (!text.includes(`{${key}}`))
      text += ` {${key}}`
  }

  const pieces = text.split(new RegExp(`\\{(${Object.keys(names).join('|')})\\}`))
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
    parts.push({ kind: pieces[index], name: names[pieces[index]], glue })
  }
  return parts
}

/**
 * Why a name in another alphabet under this ending is a red flag, with the
 * endings of that alphabet as examples where it has any.
 */
function nonLatinWhy(script: string): string {
  const alphabet = t.value(SCRIPT_KEYS[script] ?? 'scriptOther')
  const endings = NATIONAL_ENDINGS[script]
  // An alphabet with no name here has no endings to give as examples either,
  // and "in non-Latin letters under an ending in the same letters" was said of
  // an ending that already is non-Latin, only in another alphabet
  if (!endings)
    return t.value('domainMarkerNonLatinWhy')
  // Each held left to right, so the dot of a right-to-left ending stays in front of it
  // "Or" between them, and no full stop after the last: beside an ending a
  // comma or a full stop reads as part of it
  const examples = endings.map(ending => `\u2066.${ending}\u2069`).join(` ${t.value('listOr')} `)
  return t.value('domainMarkerNonLatinWhyExamples').replace('{alphabet}', alphabet).replace('{examples}', examples)
}

/**
 * The sentence about a name in another alphabet, with the name and the ending
 * it stands before drawn in their frames, as every other piece of an address
 * is: "Cyrillic letters [пример] before the Latin ending .[test]".
 */
function nonLatinSentence(marker: Extract<DomainMarker, { id: 'non-latin-name' }>): SentencePart[] {
  return sentenceWith(markerLabel(marker), { name: marker.detail, ending: marker.tld })
}

/**
 * The sentence around the two names, each drawn as an address of its own: the
 * domain the address reads as in grey, as the familiar one is in the lookalike
 * line, and the site it really belongs to in this line's colour.
 */
/**
 * The site an address with a decoy in front really belongs to.
 *
 * The check that finds the decoy has no suffix list, so it names everything
 * after it, `a.b.c.verify.test`. Those extra levels are the owner's to write,
 * and can spell a second reassuring name as easily as the first. Where the
 * shape of the address is known, the site named is the owner's alone,
 * `verify.test`, the same labels the address above draws in heavier frames.
 * Until then, and when the background cannot be asked, it stays everything
 * after the decoy, which always contains the real site.
 */
function realSite(marker: EmbeddedDomain): string {
  const owner = lookupShape(props.hostname)?.ownerLabels ?? 0
  // The owner's labels off the address itself, the ones drawn in heavier
  // frames above. Cut from `marker.site`, an owner longer than what the check
  // took for the site fell back to that guess, and `paypal.com.uk.com` was
  // told its real site is `uk.com`, an ending anybody can register under
  const labels = props.hostname.toLowerCase().replace(/\.$/, '').split('.')
  return owner > 0 && owner <= labels.length ? labels.slice(-owner).join('.') : marker.site
}

/**
 * Every domain the address is dressed as goes where the sentence names one,
 * "paypal.com or google.com or apple.com". "Or", since the address passes for
 * one of them at a time, and between every two, never a comma: a comma after
 * an address is a dot to anybody who is not looking for the difference.
 */
function embeddedSentence(marker: EmbeddedDomain): SentencePart[] {
  const domains = imitatedDomains(marker)
  const names: Record<string, string> = { site: realSite(marker) }
  const list = domains.map((domain, index) => {
    names[`domain${index}`] = domain
    return `${index ? ` ${t.value('listOr')} ` : ''}{domain${index}}`
  }).join('')
  const text = t.value(TRANSLATION_KEYS['embedded-public-suffix'])
  // A translation that lost the placeholder still names them, at the end
  return sentenceWith(text.includes('{domain}') ? text.replace('{domain}', () => list) : `${text} ${list}`, names)
}
</script>

<template>
  <!-- Two kinds of line, told apart by sign and colour together. A red flag
       (see logic/red-flags.ts) is red with a flag: the address is built to be
       misread. Everything else is orange with the shield and its exclamation
       mark: worth a look, and not a reason to stop on its own. They were all
       red once, and nothing showed that one kind stops a click and the other
       never does. -->
  <div v-if="markers.length || shownNotes.length || platform" class="domain-markers grid gap-2">
    <VzNotice
      v-for="marker in markers"
      :key="marker.id"
      :tone="isRedFlagMarker(marker) ? 'danger' : 'caution'"
      :icon="isRedFlagMarker(marker) ? 'flag' : undefined"
      :data-red-flag="isRedFlagMarker(marker) ? '' : undefined"

      :data-marker="marker.id"
    >
      <template v-if="marker.id === 'embedded-public-suffix'">
        <template v-for="(part, index) in embeddedSentence(marker)" :key="index">
          <template v-if="'text' in part">
            {{ part.text }}
          </template><span v-else class="vz-nobr"><SecureText
            :text="part.name"
            size="s"
            plain
            :data-marker-imitated="part.kind.startsWith('domain') ? '' : undefined"
            :data-marker-site="part.kind === 'site' ? '' : undefined"
          />{{ part.glue }}</span>
        </template>
      </template>
      <template v-else-if="marker.id === 'non-latin-name' && !marker.twins">
        <template v-for="(part, index) in nonLatinSentence(marker)" :key="index">
          <template v-if="'text' in part">
            {{ part.text }}
          </template><span v-else class="vz-nobr">{{ part.kind === 'ending' ? '.' : '' }}<SecureText
            :text="part.name"
            kind="label"
            :part="part.kind === 'ending' ? 'ending' : partOf(part.name)"
            :tone="part.kind === 'name' ? 'danger' : undefined"
            size="s"

            :data-marker-name="part.kind === 'name' ? '' : undefined"
            :data-marker-ending="part.kind === 'ending' ? '' : undefined"
          />{{ part.glue }}</span>
        </template>
        <!-- On a line of its own: a full stop straight after a piece of an
             address is one more dot of the address to anybody not looking
             for the difference -->
        <span class="block" data-marker-why>{{ markerWhy(marker) }}</span>
      </template>
      <template v-else>
        {{ `${markerLabel(marker)}${marker.detail ? ':' : ''}` }}
        <template v-if="marker.detail">
          <!-- The depth is a count, not a piece of the address, so it is not
               drawn as one -->
          <b v-if="marker.id === 'deep-subdomains'" data-marker-count>{{ depthOf(marker.detail) }}</b>
          <!-- The part before @ is ignored by the browser and dressed as a
               site, so it is struck through rather than framed -->
          <span v-else-if="marker.id === 'url-userinfo'" class="vz-addr vz-addr--s vz-decoy">{{ marker.detail }}</span>
          <!-- One part of the name, in its frame like every piece of an address -->
          <SecureText
            v-else-if="marker.id === 'mixed-scripts' || marker.id === 'non-latin-name' || marker.id === 'mid-ending'"
            :text="marker.detail"
            kind="label"
            :part="partOf(marker.detail)"
            :tone="isRedFlagMarker(marker) ? 'danger' : 'caution'"
            size="s"
          />
          <SecureText v-else :text="marker.detail" size="s" />
        </template>
        <!-- After a count the sentence simply goes on. After a piece of an
             address it starts a line of its own, with no full stop put
             beside the address -->
        <span v-if="markerWhy(marker) && marker.detail && marker.id !== 'deep-subdomains'" class="block" data-marker-why>{{ markerWhy(marker) }}</span>
        <span v-else-if="markerWhy(marker)" data-marker-why>{{ `${marker.detail ? '. ' : ''}${markerWhy(marker)}` }}</span>
      </template>
    </VzNotice>
    <VzNotice
      v-for="note in shownNotes"
      :key="note.id"
      tone="caution"

      :data-marker-note="note.id"
    >
      {{ note.text }}
    </VzNotice>
    <VzNotice v-if="platform" tone="caution" data-marker="hosted-on">
      {{ hostedSentence.before }}<span class="vz-nobr"><SecureText :text="platform" part="ending" tone="caution" size="s" data-marker-platform />{{ hostedSentence.glue }}</span>{{ hostedSentence.after }}
    </VzNotice>
  </div>
</template>
