<script setup lang="ts">
import type { EmailAnalysis } from '~/logic/email-safety'
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'
import { useLookalikeDiff } from '~/composables/useLookalikes'

const props = defineProps<{
  analysis: EmailAnalysis
  params: { key: string, value: string }[]
  compact?: boolean
  /**
   * Another block on the same screen already speaks for the domain: its name,
   * both of its spellings and the embedded ending, as the check page's
   * checked-domain card does. The breakdown then keeps to the account name, so
   * the domain is not drawn twice. The embedded-ending line stays whenever the
   * card's own test for it would miss the address, since the two tests do not
   * agree on every ending, and a warning left to a card that will not draw it is
   * a warning dropped.
   */
  domainElsewhere?: boolean
  /**
   * The addresses the list of recipients on the same screen draws, when it is
   * drawn. A `to`, `cc` or `bcc` field whose every address is in that
   * list is left out of the prefilled fields, where it was the same addresses a
   * second time. A field holding anything the list does not show stays whole:
   * an entry that did not read as an address is in no list, and this is then the only place a hidden copy can be seen.
   */
  listedRecipients?: string[]
}>()

const { t } = useI18n()
// The letters a lookalike changed, underlined in the domain. Asked as the
// lookalike notice beside this asks about an email domain
const domainDiff = useLookalikeDiff(() => props.analysis.domain, () => 'email')

const MAX_PARAM_VALUE_LENGTH = 200

/**
 * The fields a mail program fills in, named as words. Matched without regard to
 * case, as mail programs read them (RFC 6068), or `Subject=` would stay raw
 * beside a translated "Subject". Anything else keeps the name the link gave it.
 */
const FIELD_KEYS: Record<string, string> = {
  to: 'emailFieldTo',
  cc: 'emailFieldCc',
  bcc: 'emailFieldBcc',
  subject: 'emailFieldSubject',
  body: 'emailFieldBody',
}

// Own keys only: a page writes the link, and `?constructor=x` would otherwise
// find `Object` on the prototype and print it as the field's name
function fieldName(key: string): string {
  const lower = key.toLowerCase()
  return Object.hasOwn(FIELD_KEYS, lower) ? t.value(FIELD_KEYS[lower]) : key
}

const RECIPIENT_FIELDS = new Set(['to', 'cc', 'bcc'])

function repeatsTheList(key: string, value: string) {
  if (!props.listedRecipients?.length || !RECIPIENT_FIELDS.has(key.toLowerCase()))
    return false
  const listed = new Set(props.listedRecipients.map(address => address.toLowerCase()))
  const named = value.split(',').map(address => address.trim().toLowerCase()).filter(Boolean)
  return named.length > 0 && named.every(address => listed.has(address))
}

const displayParams = computed(() => props.params
  .filter(({ key, value }) => !repeatsTheList(key, value))
  .map(({ key, value }) => ({
    key: fieldName(key),
    value: value.length > MAX_PARAM_VALUE_LENGTH ? `${value.slice(0, MAX_PARAM_VALUE_LENGTH)}…` : value,
  })))
</script>

<template>
  <div class="email-breakdown grid gap-2">
    <!-- The address whole, the username and every label of the domain each in
         a frame of its own. It used to be two rows where there was room,
         "Account name" over "Domain", and the reader put the address back
         together. Not drawn where the card under the field draws it -->
    <SecureText v-if="!domainElsewhere" kind="email" :text="`${analysis.localPart}@${analysis.domain}`" size="l" :diff="domainDiff(`${analysis.localPart}@${analysis.domain}`)">
      <CopyButton :text="`${analysis.localPart}@${analysis.domain}`" /><AddressParts :address="`${analysis.localPart}@${analysis.domain}`" />
    </SecureText>
    <!-- The other spelling of an international domain, straight under the address -->
    <OtherSpelling v-if="!domainElsewhere" :shown="analysis.domain" :other="analysis.domainInfo.punycode" :diff="analysis.domainInfo.punycode ? domainDiff(analysis.domainInfo.punycode) : undefined" />
    <!-- The caller's verdict on the address and its red flags, which belong
         straight under it and above everything else said about it here -->
    <slot name="under-address" />

    <!-- A well-known ending in the middle of the domain is one of the lines
         every surface draws for it (AddressFindings), with its label marked -->

    <!-- Unicode in the local part -->
    <!-- Under the address it is about. A list of recipients says it under each -->
    <UsernameNote v-if="!listedRecipients?.length" :local="analysis.localPart" />

    <!-- What kind of mail service the domain is, a public provider or a
         throwaway one, is a line about the domain: it is drawn with the other
         lines about it (`AddressFindings`), under the domain and its badge -->

    <!-- mailto query params (cc, bcc, subject, body...) -->
    <div v-if="displayParams.length" class="grid gap-1">
      <span class="vz-eyebrow">{{ t('emailTooltipParams') }}</span>
      <dl class="email-params vz-well" :class="{ 'email-params--compact': compact }">
        <div v-for="param in displayParams" :key="param.key" class="email-param">
          <dt>{{ param.key }}</dt>
          <dd>{{ param.value }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.email-params {
  display: grid;
  gap: 2px;
  margin: 0;
  font-size: calc(13px * var(--vz-scale, 1));
  line-height: 1.4;
  color: var(--ink-2);
}

.email-params--compact {
  max-height: 100px;
  overflow-y: auto;
}

.email-param {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.email-param dt {
  color: var(--ink-3);
  flex: none;
}

.email-param dt::after {
  content: ':';
}

.email-param dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
