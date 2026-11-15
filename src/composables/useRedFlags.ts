import type { ComputedRef } from 'vue'
import type { AddressShape } from '~/logic/domain-boundary'
import type { DomainMarker } from '~/logic/domain-markers'
import type { PieceTone } from '~/logic/piece-tones'
import { computed, onScopeDispose, shallowReactive, watch } from 'vue'
import { decodeHostname, dropExplainedMarkers, findDomainMarkers, isExplainableMarker } from '~/logic/domain-markers'
import { findEmbeddedTld } from '~/logic/email-safety'
import { pieceTones } from '~/logic/piece-tones'
import { isRedFlagLookalike, isRedFlagMarker } from '~/logic/red-flags'
import { useLookalikes } from './useLookalikes'

type Context = 'email' | undefined

/**
 * The structural markers of an address, as the lines under it draw them.
 *
 * Every place that shows markers shows the lookalike notice beside them, so
 * this is the one place that decides which of the two explains an address.
 * The markers a lookalike can explain, the embedded ending and a name of
 * Latin twins, are held back while the answer is on its way: drawn at once,
 * they would appear for a moment and vanish again under the lookalike line
 * that replaces them.
 *
 * Shared by the lines and the red-flag count, so the two filter the same list
 * the same way at every moment, the wait for the answer included.
 */
export function useDomainMarkers(
  hostname: () => string,
  url: () => string | null | undefined,
  context: () => Context,
): ComputedRef<DomainMarker[]> {
  const found = computed(() => {
    const host = hostname()
    if (!host)
      return []
    const markers = findDomainMarkers(host, url())
    // In the domain of an email address a few more endings count, `.io` and
    // `.co` among them. Where the red flag above has not already said it
    const ending = context() === 'email' && !markers.some(marker => marker.id === 'embedded-public-suffix') ? findEmbeddedTld(host) : null
    return ending ? [...markers, { id: 'mid-ending' as const, detail: ending.label, at: ending.index }] : markers
  })

  // Nothing is asked about an address with no marker a lookalike could explain
  const hasExplainable = computed(() => found.value.some(isExplainableMarker))
  const lookalikes = useLookalikes(hostname, context, () => hasExplainable.value)

  return computed(() => {
    const answer = lookalikes.value
    if (!answer)
      return found.value
    if (answer.status === 'pending')
      return found.value.filter(marker => !isExplainableMarker(marker))
    return dropExplainedMarkers(found.value, answer.status === 'answered' ? answer.matches : null)
  })
}

/**
 * How many red flags the lines under one address carry.
 *
 * Asks exactly what the lines ask, with the same hostname and context, so it
 * reads the same memoised lookalike answer. `extra` is for a flag the caller
 * draws itself, such as link text naming another site.
 */
export function useRedFlagCount(
  hostname: () => string,
  url: () => string | null | undefined,
  context: () => Context,
  extra: () => number = () => 0,
): ComputedRef<number> {
  const markers = useDomainMarkers(hostname, url, context)
  const lookalikes = useLookalikes(hostname, context)
  return computed(() => {
    const answer = lookalikes.value
    const matches = answer?.status === 'answered' ? answer.matches : []
    return markers.value.filter(isRedFlagMarker).length
      + matches.filter(isRedFlagLookalike).length
      + extra()
  })
}

/**
 * How many orange lines `AddressFindings` draws under one address: the
 * markers that are not red flags, the line about a shared platform, the
 * lookalikes that are only near misses, and the line about a throwaway or a
 * forwarding mail service. Read from what the lines read, as the red-flag
 * count is, so a folded list can give the number without the two drifting.
 * The line about the username is the caller's, see `MailRecipients`.
 */
export function useCautionCount(
  hostname: () => string,
  about: () => { context?: Context, familiar?: boolean, cautionService?: boolean },
  shape: (hostname: string) => AddressShape | undefined,
): ComputedRef<number> {
  const context = () => about().context
  const markers = useDomainMarkers(hostname, () => null, context)
  const lookalikes = useLookalikes(hostname, context)
  return computed(() => {
    const host = hostname()
    if (!host)
      return 0
    const on = about()
    const answer = lookalikes.value
    const matches = answer?.status === 'answered' ? answer.matches : []
    return markers.value.filter(marker => !isRedFlagMarker(marker)).length
      + (!on.familiar && shape(host)?.platform ? 1 : 0)
      + matches.filter(match => !isRedFlagLookalike(match)).length
      + (on.cautionService ? 1 : 0)
  })
}

/**
 * What the lines of findings under an address are given, which is all the
 * colours in the address are decided from.
 */
export interface AddressFindingsContext {
  url?: string | null
  context?: Context
  /** A familiar site gets no line about its platform, and no colour for one */
  familiar?: boolean
  /** The verdict is still out, and nothing that depends on it is drawn */
  pending?: boolean
  /**
   * The screen calls the site a kind of service, in a badge or a line of the
   * surface's own: a short-link service, a throwaway mail service
   */
  service?: boolean
}

const NO_TONES: Map<number, PieceTone> = new Map()

/**
 * The colour of each label of an address, by its place in it, from what the
 * lines under the address say. See `pieceTones` for which finding colours what.
 */
function usePieceTones(
  hostname: () => string,
  about: () => AddressFindingsContext,
  shape: (hostname: string) => AddressShape | undefined,
): ComputedRef<Map<number, PieceTone>> {
  const context = () => about().context
  const markers = useDomainMarkers(hostname, () => about().url, context)
  const lookalikes = useLookalikes(hostname, context)
  return computed(() => {
    const on = about()
    const host = hostname()
    if (on.pending || !host)
      return NO_TONES
    const answer = lookalikes.value
    return pieceTones(host, {
      markers: markers.value,
      lookalikes: answer?.status === 'answered' ? answer.matches : [],
      shape: shape(host),
      platform: !on.familiar,
      service: on.service,
    })
  })
}

/**
 * The findings that are on screen right now, by the address they are about.
 *
 * A finding is said in a line under an address and marked in the address
 * itself, and the two used to be joined by hand: each surface handed the
 * address what it handed the lines. A surface that forgot drew a red flag
 * under an address with nothing red in it, and a test that counted props
 * could not tell which address had been forgotten. So nothing is handed on
 * any more. The component that draws the lines puts what they found here,
 * for as long as it is on screen, and every address drawn meanwhile reads
 * its colours from here: the address in the heading, the same address in a
 * table or a list further down, its other spelling. Lines on screen and
 * colour in the address are one fact, and cannot be had apart.
 */
const onScreen = shallowReactive(new Map<string, readonly ComputedRef<Map<number, PieceTone>>[]>())

/** One key for both spellings of an address, whatever its case and with or without the dot at its end. */
function addressKey(hostname: string): string {
  // The three other dots a browser reads as one, made the one first
  return decodeHostname(hostname.replace(/[。．｡]/g, '.')).toLowerCase().replace(/\.$/, '')
}

/** For the component that draws the lines of findings about an address: says so, while it is mounted. */
export function useFindingsOnScreen(
  hostname: () => string,
  about: () => AddressFindingsContext,
  shape: (hostname: string) => AddressShape | undefined,
): void {
  const tones = usePieceTones(hostname, about, shape)
  let key = ''
  const leave = () => {
    if (!key)
      return
    const left = (onScreen.get(key) ?? []).filter(entry => entry !== tones)
    if (left.length)
      onScreen.set(key, left)
    else
      onScreen.delete(key)
    key = ''
  }
  watch(hostname, (host) => {
    leave()
    key = host ? addressKey(host) : ''
    if (key)
      onScreen.set(key, [...(onScreen.get(key) ?? []), tones])
  }, { immediate: true })
  onScopeDispose(leave)
}

/** For the painter: the colours of the labels of an address, if lines about it are on screen. */
export function tonesOnScreen(hostname: string): Map<number, PieceTone> {
  if (!hostname)
    return NO_TONES
  const blocks = onScreen.get(addressKey(hostname))
  if (!blocks?.length)
    return NO_TONES
  if (blocks.length === 1)
    return blocks[0].value
  // Two blocks of lines about one address, a tooltip over a dialog or the
  // check field over the card: each line on screen keeps its label, whichever
  // block drew it. The block drawn last used to speak alone, and where it was
  // still waiting for its verdict, or read the address as a site and not as
  // an address domain, the other block's lines stood over a plain address
  const merged = new Map<number, PieceTone>()
  for (const block of blocks) {
    for (const [index, tone] of block.value) {
      if (merged.get(index) !== 'danger')
        merged.set(index, tone)
    }
  }
  return merged
}

/** Forget what is on screen. For tests, which would otherwise share it. */
export function resetFindingsOnScreen() {
  onScreen.clear()
}
