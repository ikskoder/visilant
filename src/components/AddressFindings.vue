<script setup lang="ts">
import type { EmailProviderKind } from '~/logic/email-providers'
import { inject } from 'vue'
import { useFindingsOnScreen } from '~/composables/useRedFlags'
import { ADDRESS_SHAPE_KEY, askBackgroundShape } from '~/logic/address-shape'
import { isCautionMailService } from '~/logic/email-providers'

/**
 * Everything found in an address itself, in one order wherever it is drawn:
 * the red flags first, then the lines that only ask the reader to be on their
 * guard.
 *
 * Two components find these, the structural markers and the lookalike line,
 * and each surface used to draw the one after the other. While every line was
 * red that order could not be seen. With two colours it could: a box read
 * orange, orange, red, orange, red, and the count of red flags beside the
 * verdict was followed by a line that was not one of them.
 *
 * No element of its own, as `AddressBlock`: each group takes its place in the
 * caller's grid.
 *
 * And the one place that says these lines are on screen. While they are,
 * every drawing of the address, in the heading above, in a table or a list
 * elsewhere, in its other spelling, has the labels the lines are about in
 * the lines' colours (`useFindingsOnScreen`). No surface joins the two by
 * hand, so none can draw one without the other.
 */
const props = defineProps<{
  hostname: string
  url?: string | null
  context?: 'email'
  /** Lines the caller knows about the host, see `DomainMarkers`. */
  notes?: { id: string, text: string }[]
  familiar?: boolean
  /**
   * The verdict is still out, for a few seconds at most: nothing is drawn
   * until it is in. A lookalike line would flash up for a site that turns out
   * familiar, and a flag line drawn at once stood without its count, which
   * waits for the same answer.
   */
  pending?: boolean
  /**
   * The surface calls the site a short-link service in a badge or a line of
   * its own, which is said in orange. The site is drawn in that orange with
   * it.
   */
  service?: boolean
  /**
   * The address is an email address, and this is what kind of mail service
   * its domain is. The line about the service is drawn here, last of the
   * lines about the address (`MailServiceNote`), and for a throwaway or a
   * forwarding service the site is drawn in the line's orange. A surface
   * used to draw that line itself and pass `service` beside it, and the
   * popup's card had the colour and no line.
   */
  mailService?: EmailProviderKind
  /** No badge on the surface names the kind of mail service, so its line does */
  nameMailService?: boolean
}>()

const lookupShape = inject(ADDRESS_SHAPE_KEY, askBackgroundShape)
useFindingsOnScreen(
  () => props.hostname,
  () => ({ url: props.url, context: props.context, familiar: props.familiar, pending: props.pending, service: props.service || isCautionMailService(props.mailService) }),
  host => lookupShape(host),
)
</script>

<template>
  <DomainMarkers v-if="!pending" show="flags" :hostname="hostname" :url="url" :context="context" :familiar="familiar" />
  <LookalikeNotice v-if="!pending" show="flags" :hostname="hostname" :context="context" />
  <DomainMarkers v-if="!pending" show="cautions" :hostname="hostname" :url="url" :context="context" :notes="notes" :familiar="familiar" />
  <LookalikeNotice v-if="!pending" show="cautions" :hostname="hostname" :context="context" />
  <MailServiceNote v-if="mailService" :kind="mailService" :domain="hostname" :named="nameMailService" />
</template>
