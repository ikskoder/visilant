import type { InterceptSettings } from './storage'

/**
 * Why a click on a link is held and the dialog asks first.
 *
 * - `red-flags`: the link carries at least the set number of red flags (see
 *   logic/red-flags.ts), whether or not the site is familiar: a flag is a
 *   trick in the link itself, which a site the user knows does not play.
 * - `short-link`: the link goes through a short-link service, which hides
 *   where it really leads.
 * - `unfamiliar`: the site is not familiar under the user's rules.
 * - `unchecked`: the background could not be asked, so neither the verdict nor
 *   the lookalike check has an answer. An answer that did not come is not a
 *   clean link, so it stops whenever a check that needs the answer is on.
 */
export type InterceptReason = 'red-flags' | 'short-link' | 'unfamiliar' | 'unchecked'

export interface LinkFacts {
  familiar: boolean
  unchecked: boolean
  shortLink: boolean
  redFlags: number
}

export function interceptReasons(facts: LinkFacts, settings: InterceptSettings): InterceptReason[] {
  const reasons: InterceptReason[] = []
  if (facts.unchecked && (settings.unfamiliar || settings.redFlags))
    reasons.push('unchecked')
  if (settings.redFlags && facts.redFlags >= settings.minRedFlags)
    reasons.push('red-flags')
  if (settings.shortLinks && facts.shortLink)
    reasons.push('short-link')
  if (settings.unfamiliar && !facts.unchecked && !facts.familiar)
    reasons.push('unfamiliar')
  return reasons
}

/** Whether any click could be held at all, so a page can skip the listeners' work. */
export function interceptsAnything(settings: InterceptSettings): boolean {
  return settings.unfamiliar || settings.shortLinks || settings.redFlags
}
