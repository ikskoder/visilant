<script setup lang="ts">
import type { EmailRecipientInfo } from '~/logic/ui-state'
import { computed, ref, watch } from 'vue'
import AddressFindings from '~/components/AddressFindings.vue'
import MailServiceBadge from '~/components/MailServiceBadge.vue'
import OtherSpelling from '~/components/OtherSpelling.vue'
import RecipientDomainTones from '~/components/RecipientDomainTones.vue'
import RecipientSigns from '~/components/RecipientSigns.vue'
import SecureText from '~/components/SecureText.vue'
import { useFamiliarityFacts } from '~/composables/useFamiliarityFacts'
import { useI18n } from '~/composables/useI18n'
import { isCautionMailService } from '~/logic/email-providers'
import { recipientsAreListed, sortedRecipients } from '~/logic/mail-recipient-list'

/**
 * Everyone a `mailto:` would write to, each checked in its own right.
 *
 * The address at the front of a `mailto:` used to be the whole check, so a
 * link reading `mailto:known@example.com,attacker@evil.example` came back
 * familiar on the strength of the first name and carried the second along
 * untouched. `cc` and `bcc` were not looked at at all.
 *
 * A table with a row per recipient: the field, the address whole, what is
 * known about it folded to signs with counts (`RecipientSigns`), and a
 * chevron. A press opens the row, one at a time, and the words come out
 * under it in a framed block: the other spelling, the verdict and the lines
 * every address gets (`AddressFindings`). The list used to say everything
 * about every domain at once, and with a few recipients it was a page of
 * warnings nobody could tell apart.
 *
 * Sorted by domain, then username (`sortedRecipients`), so the addresses at
 * one domain stand together and a lookalike sits right beside the name it
 * imitates. They are no longer folded under their domain: two people at one
 * domain are two rows. Pointing at a domain, or opening a row, frames the
 * same domain in every other row in violet, which only says "the same" and
 * nothing about the domain.
 *
 * Where the surface shows one address large (`detailable`, the check page
 * with its card), opening a row is choosing it: the card shows that address,
 * with the copy button. Elsewhere, in a tooltip with no card, the open row
 * has the copy button.
 *
 * Shown only when there is more than one, so an ordinary single-address link
 * keeps the shape it always had.
 */
const props = defineProps<{
  recipients: EmailRecipientInfo[]
  notChecked?: number
  /** The surface shows the chosen address large, under the list */
  detailable?: boolean
}>()

const emit = defineEmits<{
  /**
   * A row was opened or closed. `heading` names its place in the list, for the
   * card that shows it; `open` whether the row's own lines are on screen, so
   * the card does not draw them a second time.
   */
  (e: 'choose', recipient: EmailRecipientInfo, heading: string, open: boolean): void
}>()

const { t } = useI18n()
const { statusLabel } = useFamiliarityFacts()

const FIELD_LABELS: Record<EmailRecipientInfo['field'], string> = {
  to: 'emailFieldTo',
  cc: 'emailFieldCc',
  bcc: 'emailFieldBcc',
}
const FIELD_HELP: Record<EmailRecipientInfo['field'], string> = {
  to: 'emailFieldToHelp',
  cc: 'emailFieldCcHelp',
  bcc: 'emailFieldBccHelp',
}

const show = computed(() => recipientsAreListed(props.recipients, props.notChecked))
const rows = computed(() => sortedRecipients(props.recipients))
const address = (recipient: EmailRecipientInfo) => `${recipient.analysis.localPart}@${recipient.analysis.domain}`

/** How many rows stand at each domain */
const perDomain = computed(() => {
  const counts = new Map<string, number>()
  for (const recipient of rows.value)
    counts.set(recipient.analysis.domain, (counts.get(recipient.analysis.domain) ?? 0) + 1)
  return counts
})
const domains = computed(() => [...perDomain.value.keys()].map((domain) => {
  const first = rows.value.find(recipient => recipient.analysis.domain === domain)!
  return { domain, familiar: first.isSafe, service: isCautionMailService(first.providerKind) }
}))
const repeats = computed(() => rows.value.length > perDomain.value.size)

const summary = computed(() => {
  const total = props.recipients.length + (props.notChecked ?? 0)
  const key = perDomain.value.size === 1 ? 'emailRecipientsSummaryOneDomain' : 'emailRecipientsSummary'
  return t.value(key).replace('{recipients}', String(total)).replace('{domains}', String(perDomain.value.size))
})

const matchHint = computed(() => {
  const [before = '', after = ''] = t.value('emailRecipientsMatchHint').split('{frame}')
  return { before, after }
})

const open = ref<number | null>(null)
const chosen = ref<number | null>(null)
const pointed = ref<string | null>(null)

// A new link is a new list, and nothing in it is open or chosen yet
watch(() => props.recipients, () => {
  open.value = null
  chosen.value = null
  pointed.value = null
})

function heading(index: number) {
  const recipient = rows.value[index]
  return t.value('emailRecipientPosition')
    .replace('{field}', t.value(FIELD_LABELS[recipient.field]))
    .replace('{n}', String(index + 1))
    // Counted as the heading of the list counts, the ones not checked included
    .replace('{total}', String(props.recipients.length + (props.notChecked ?? 0)))
}

function toggle(index: number) {
  open.value = open.value === index ? null : index
  if (props.detailable) {
    chosen.value = index
    emit('choose', rows.value[index], heading(index), open.value === index)
  }
}

/** The domain framed in violet: the one pointed at, or else the open row's */
const framed = computed(() => {
  const domain = pointed.value ?? (open.value !== null ? rows.value[open.value]?.analysis.domain : null)
  return domain && (perDomain.value.get(domain) ?? 0) > 1 ? domain : null
})

function onPointer(event: PointerEvent) {
  const part = (event.target as Element | null)?.closest?.('.vz-addr__domain')
  pointed.value = part ? part.closest<HTMLElement>('[data-recipient-domain]')?.dataset.recipientDomain ?? null : null
}

/** Where each row and its open block stand in the grid, under the headings */
const layout = computed(() => {
  let line = 2
  return rows.value.map((recipient, index) => {
    const row = line++
    const isOpen = open.value === index
    const more = isOpen ? line++ : 0
    return { recipient, index, row, more, isOpen }
  })
})
</script>

<template>
  <div v-if="show" class="mail-recipients grid gap-2" @pointerover="onPointer" @pointerleave="pointed = null">
    <span class="vz-eyebrow" data-recipients-summary>{{ summary }}</span>
    <!-- Only where a domain repeats: with every domain different there is
         nothing to frame -->
    <p v-if="repeats" class="vz-small" data-status="same-domain-hint">
      {{ matchHint.before }}<span class="vz-match-sample">{{ t('emailRecipientsMatchFrame') }}</span>{{ matchHint.after }}
    </p>
    <RecipientDomainTones v-for="item in domains" :key="item.domain" :domain="item.domain" :familiar="item.familiar" :service="item.service" />

    <div class="recipients-table">
      <span class="recipients-head" style="grid-row: 1; grid-column: 2">{{ t('emailRecipientsAddressColumn') }}</span>
      <span class="recipients-head" style="grid-row: 1; grid-column: 3 / -1">{{ t('linkInterceptStatus') }}</span>

      <template v-for="{ recipient, index, row, more, isOpen } in layout" :key="`${index}-${address(recipient)}`">
        <!-- The open row and its words as one framed block, behind them -->
        <div v-if="isOpen" class="recipient-open" :style="{ gridRow: `${row} / ${more + 1}`, gridColumn: '1 / -1' }" />
        <!-- `display: contents`: its cells are the grid's, and a press anywhere
             on them opens the row -->
        <div
          class="recipient-row"
          :data-recipient="address(recipient)"
          :data-recipient-domain="recipient.analysis.domain"
          :data-open="isOpen ? '' : undefined"
          :data-chosen="detailable && chosen === index ? '' : undefined"
          @click="toggle(index)"
        >
          <button
            type="button"
            class="recipient-rowbtn"
            :style="{ gridRow: row, gridColumn: '1 / -1' }"
            :aria-label="address(recipient)"
            :aria-expanded="isOpen"
            data-action="recipient-open"
          />
          <span class="recipient-cell" :style="{ gridRow: row, gridColumn: 1 }">
            <!-- What the field means, on hover or focus -->
            <!-- A tap on it reads it and opens nothing: on a touchscreen there is no other way to read it -->
            <span class="recipient-field-wrap" tabindex="0" :aria-describedby="`recipient-field-${index}`" @click.stop>
              <span class="vz-badge vz-badge--neutral recipient-field" :data-field="recipient.field">{{ t(FIELD_LABELS[recipient.field]) }}</span>
              <span :id="`recipient-field-${index}`" class="recipient-field-tip" role="tooltip">{{ t(FIELD_HELP[recipient.field]) }}</span>
            </span>
          </span>
          <span class="recipient-cell recipient-address" :style="{ gridRow: row, gridColumn: 2 }">
            <SecureText kind="email" :text="address(recipient)" size="s" :class="{ 'vz-addr--match': framed === recipient.analysis.domain }">
              <!-- No card in a tooltip: the open row is where the address is copied -->
              <CopyButton v-if="isOpen && !detailable" :text="address(recipient)" @click.stop />
            </SecureText>
          </span>
          <span class="recipient-cell recipient-status" :style="{ gridRow: row, gridColumn: 3 }" data-recipient-status>
            <RecipientSigns :recipient="recipient" />
          </span>
          <span class="recipient-cell recipient-chevron" :style="{ gridRow: row, gridColumn: -2 }" aria-hidden="true">
            <VzIcon :name="isOpen ? 'chevron-down' : 'chevron-right'" />
          </span>
        </div>
        <!-- In the order every address has: its other spelling, the verdict,
             then the red flags and what is only worth a look. A throwaway or
             forwarding service is said once, in its line headed with its name -->
        <div v-if="isOpen" class="recipient-more" :style="{ gridRow: more, gridColumn: '2 / -1' }" data-recipient-more>
          <OtherSpelling :shown="recipient.analysis.domain" :other="recipient.analysis.domainInfo.punycode" />
          <!-- Not where the card under the list shows the chosen address with its verdict -->
          <div v-if="!detailable && !isCautionMailService(recipient.providerKind)" class="recipient-verdict" data-recipient-verdict>
            <MailServiceBadge v-if="recipient.providerKind !== 'regular'" :kind="recipient.providerKind" />
            <VzBadge v-else-if="recipient.unchecked" tone="neutral" icon="shield-unknown" data-verdict="unchecked">
              {{ t('verdictUnchecked') }}
            </VzBadge>
            <VzBadge v-else :tone="statusLabel(recipient.isSafe, recipient.stats.count).tone" :icon="statusLabel(recipient.isSafe, recipient.stats.count).icon" :data-verdict="statusLabel(recipient.isSafe, recipient.stats.count).verdict">
              {{ statusLabel(recipient.isSafe, recipient.stats.count).text }}
            </VzBadge>
          </div>
          <AddressFindings :hostname="recipient.analysis.domain" context="email" :familiar="recipient.isSafe" :mail-service="isCautionMailService(recipient.providerKind) ? recipient.providerKind : undefined" name-mail-service />
          <UsernameNote :local="recipient.analysis.localPart" />
        </div>
      </template>
    </div>

    <p v-if="notChecked" class="vz-small">
      +{{ notChecked }} {{ t('emailRecipientsNotChecked') }}
    </p>
    <p v-if="detailable && chosen === null" class="vz-small" data-status="choose-recipient">
      {{ t('emailRecipientsChoose') }}
    </p>
  </div>
</template>

<style scoped>
/* The field, the address, the status, room to spare, the chevron. The
   address keeps a short name whole and gives way first when there is no
   room; the status never does */
.recipients-table {
  display: grid;
  grid-template-columns: max-content minmax(0, max-content) max-content minmax(0, 1fr) max-content;
  column-gap: var(--space-2);
  row-gap: 2px;
  align-items: start;
}

.recipients-head {
  font-size: calc(11px * var(--vz-scale, 1));
  line-height: calc(16px * var(--vz-scale, 1));
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-3);
  white-space: nowrap;
}

.recipient-row {
  display: contents;
  cursor: pointer;
}

.recipient-rowbtn {
  all: unset;
  box-sizing: border-box;
  align-self: stretch;
  margin: 0 calc(-6px * var(--vz-scale, 1));
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.recipient-row:hover > .recipient-rowbtn {
  background: var(--surface-hover);
}

.recipient-rowbtn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

/* Inside the frame of the open block, so its hover never paints over the frame */
.recipient-row[data-open] > .recipient-rowbtn {
  margin: 1px calc(-5px * var(--vz-scale, 1)) 0;
}

.recipient-row[data-open]:hover > .recipient-rowbtn {
  background: color-mix(in srgb, var(--ink) 5%, transparent);
}

.recipient-open {
  align-self: stretch;
  margin: 0 calc(-6px * var(--vz-scale, 1));
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--surface-hover);
}

.recipient-cell {
  position: relative;
  min-width: 0;
  padding: calc(5px * var(--vz-scale, 1)) 0;
}

.recipient-address {
  overflow-wrap: anywhere;
}

.recipient-status,
.recipient-chevron {
  color: var(--ink-3);
}

.recipient-row[data-open] .recipient-chevron {
  color: var(--ink);
}

.recipient-field {
  padding: calc(1px * var(--vz-scale, 1)) calc(5px * var(--vz-scale, 1));
  font-size: calc(11px * var(--vz-scale, 1));
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

.recipient-field-wrap {
  position: relative;
  display: inline-block;
  cursor: help;
  border-radius: var(--radius-sm);
}

.recipient-field-wrap:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

/* Beside the field, on its line, over the address */
.recipient-field-tip {
  display: none;
  position: absolute;
  z-index: 3;
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
  width: max-content;
  max-width: calc(240px * var(--vz-scale, 1));
  padding: calc(6px * var(--vz-scale, 1)) calc(10px * var(--vz-scale, 1));
  border-radius: var(--radius-sm);
  background: var(--ink);
  color: var(--surface);
  font-size: calc(12px * var(--vz-scale, 1));
  line-height: calc(16px * var(--vz-scale, 1));
  font-weight: 400;
  box-shadow: var(--shadow-overlay);
  pointer-events: none;
}

.recipient-field-wrap:hover .recipient-field-tip,
.recipient-field-wrap:focus-visible .recipient-field-tip {
  display: block;
}

.recipient-cell:has(.recipient-field-wrap:hover),
.recipient-cell:has(.recipient-field-wrap:focus-visible) {
  z-index: 4;
}

.recipient-more {
  display: grid;
  gap: var(--space-2);
  padding-bottom: calc(10px * var(--vz-scale, 1));
  min-width: 0;
  contain: inline-size;
}

.recipient-verdict {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
