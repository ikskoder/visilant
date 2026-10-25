import type { ComputedRef } from 'vue'
import type { DomainMarker } from '~/logic/domain-markers'
import { computed } from 'vue'
import { dropExplainedMarkers, findDomainMarkers, isExplainableMarker } from '~/logic/domain-markers'
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
  const found = computed(() => hostname() ? findDomainMarkers(hostname(), url()) : [])

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
