<script setup lang="ts">
import { inject, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { openInBackgroundTab } from '~/logic/lookup-services'

/**
 * What the email check is not.
 *
 * The check exists because the address is right there and reading it costs
 * nothing, not because it settles anything. Visilant has no mailbox to look
 * into: it never learns which server sent a message, so a clean result says the
 * address is well formed and belongs to a domain with some history, and stops
 * exactly there. Somebody who takes that for a verdict is worse off than
 * somebody who never ran the check, which is why the limits are written down
 * next to it rather than left to be inferred.
 *
 * Collapsed, because it is five paragraphs and most checks do not need them.
 */
const isDark = inject('isDark', ref(false))
const { t } = useI18n()

const expanded = ref(false)

const PARAGRAPHS = [
  'emailCaveatNoMailbox',
  'emailCaveatReadAddress',
  'emailCaveatSenderHacked',
  'emailCaveatLinks',
  'emailCaveatAttachments',
]

/**
 * The services named in the text above, and where each one wants to be entered.
 *
 * VirusTotal appears twice because a link and a file are two different pages
 * there, and sending somebody to the wrong one is a small cruelty in the middle
 * of advice about not opening things.
 */
const LINKS: Record<string, { label: string, url: string }> = {
  'virustotal-url': { label: 'VirusTotal', url: 'https://www.virustotal.com/gui/home/url' },
  'virustotal-file': { label: 'VirusTotal', url: 'https://www.virustotal.com/gui/home/upload' },
  'urlscan': { label: 'urlscan.io', url: 'https://urlscan.io/' },
}

/**
 * A paragraph cut into plain text and links.
 *
 * The markers stay inside the translated sentence because word order moves
 * between languages and a link glued on at the end would land in the wrong
 * place. A translation that drops a marker simply loses that link, and one that
 * invents a marker renders it as the literal text it is – neither breaks the
 * paragraph, which is the point of splitting rather than injecting markup.
 */
function segments(text: string) {
  return text.split(/(\{[a-z-]+\})/g).map((part) => {
    const link = part.startsWith('{') ? LINKS[part.slice(1, -1)] : undefined
    return { link, text: link ? link.label : part }
  })
}
</script>

<template>
  <div class="mt-2">
    <!--
      Set apart rather than dimmed like the other disclosures, because this one
      is addressed to somebody who arrived worried and it is the only thing on
      screen written for them.

      Amber and not red: red on these surfaces means a check did not pass, and
      spending it on a line that is advice rather than a verdict would make the
      real reds count for less.
    -->
    <button
      class="flex items-center gap-1 text-left font-bold hover:underline"
      :class="isDark ? 'text-amber-400' : 'text-amber-700'"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
      <span>{{ t('emailCaveatTitle') }}</span>
    </button>

    <div
      v-if="expanded"
      class="mt-1 flex flex-col gap-1.5 leading-snug"
      :class="isDark ? 'text-gray-300' : 'text-gray-600'"
    >
      <p v-for="key in PARAGRAPHS" :key="key">
        <template v-for="(segment, index) in segments(t(key))" :key="index">
          <a
            v-if="segment.link"
            :href="segment.link.url"
            target="_blank"
            rel="noreferrer noopener"
            class="underline"
            :class="isDark ? 'text-blue-300' : 'text-blue-700'"
            @click="openInBackgroundTab($event, segment.link.url)"
          >{{ segment.text }}</a>
          <template v-else>
            {{ segment.text }}
          </template>
        </template>
      </p>
    </div>
  </div>
</template>
