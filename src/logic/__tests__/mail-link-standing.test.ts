import { describe, expect, it } from 'vitest'
import { analyzeEmailAddress } from '../email-safety'
import { mailLinkStanding } from '../mail-recipient-list'

// The click on a mail link is held on this answer, and the button in the
// tooltip is drawn as a risk on it. One function, so the two cannot disagree

function at(address: string, providerKind: 'public' | 'disposable' | 'forwarding' | 'regular', isSafe: boolean, unchecked = false) {
  return {
    field: 'to' as const,
    analysis: analyzeEmailAddress(address)!,
    providerKind,
    stats: { count: 0 },
    isSafe,
    unchecked,
  }
}
const link = (recipients: ReturnType<typeof at>[], recipientsNotChecked = 0) => mailLinkStanding({ providerKind: recipients[0].providerKind, recipients, recipientsNotChecked }, recipients[0])

describe('where a mail link stands', () => {
  it('is familiar when everybody is at a public provider or a familiar domain', () => {
    expect(link([at('a@gmail.com', 'public', false), at('b@corp.test', 'regular', true)])).toEqual({ familiar: true, unchecked: false })
  })

  it('is not when the one address is at an unfamiliar domain', () => {
    expect(link([at('a@new.test', 'regular', false)]).familiar).toBe(false)
  })

  // The one an attacker would hide behind a name the reader knows
  it('is not when one unfamiliar address stands behind a known one', () => {
    expect(link([at('a@corp.test', 'regular', true), at('x@new.test', 'regular', false)]).familiar).toBe(false)
  })

  it.each(['disposable', 'forwarding'] as const)('is not for an address at a %s service, wherever in the list', (kind) => {
    expect(link([at('a@service.test', kind, true)]).familiar).toBe(false)
    expect(link([at('a@gmail.com', 'public', false), at('x@service.test', kind, false)]).familiar).toBe(false)
  })

  // `cc=Boss <ceo@evil.test>` does not read as an address here, and a mail
  // program may take it
  it('is unchecked when the link names anybody who was not checked', () => {
    expect(link([at('a@gmail.com', 'public', false)], 1)).toEqual({ familiar: true, unchecked: true })
  })

  it('is unchecked when the lookup failed for a domain that is judged by visits', () => {
    expect(link([at('a@corp.test', 'regular', false, true)]).unchecked).toBe(true)
    expect(link([at('a@gmail.com', 'public', false), at('b@corp.test', 'regular', false, true)]).unchecked).toBe(true)
  })

  // Nothing is looked up about gmail.com that the answer depends on
  it('is not unchecked for a failed lookup about a mail service', () => {
    expect(link([at('a@gmail.com', 'public', false, true)])).toEqual({ familiar: true, unchecked: false })
  })

  it('answers for a bare address, which has no list', () => {
    expect(mailLinkStanding({ providerKind: 'regular' }, { isSafe: true })).toEqual({ familiar: true, unchecked: false })
    expect(mailLinkStanding({ providerKind: 'regular' }, { isSafe: false, unchecked: true })).toEqual({ familiar: false, unchecked: true })
    expect(mailLinkStanding({ providerKind: 'forwarding' }, { isSafe: true }).familiar).toBe(false)
  })
})
