import { describe, expect, it, vi } from 'vitest'
import { askBackgroundShape } from '../address-shape'
import { addressShape } from '../domain-boundary'

describe('addressShape', () => {
  it('counts the owner and the suffix from the right', () => {
    expect(addressShape('checkout.paypal.com')).toEqual({ ownerLabels: 2, suffixLabels: 1 })
    expect(addressShape('www.bank.co.uk')).toEqual({ ownerLabels: 3, suffixLabels: 2 })
  })

  // A platform that hands out one name per customer: the tenant is the owner
  it('gives a hosting tenant the owner frames, not the platform', () => {
    expect(addressShape('evil.github.io')).toEqual({ ownerLabels: 3, suffixLabels: 2 })
  })

  // Counts rather than strings, so both spellings of one name get the same frames
  it('gives the same counts to the Unicode and the encoded spelling', () => {
    expect(addressShape('mail.pаypal.com')).toEqual(addressShape('mail.xn--pypal-4ve.com'))
  })

  it('says there is no owner for an IP address or a dotless name', () => {
    expect(addressShape('192.168.1.10')).toEqual({ ownerLabels: 0, suffixLabels: 0 })
    expect(addressShape('intranet')).toEqual({ ownerLabels: 0, suffixLabels: 0 })
  })

  // The URL parser reads U+2024 as a dot, the painter does not split on it, so
  // owner frames counted from the parsed name would land on the decoy
  it('gives no owner when the parser would see more labels than are drawn', () => {
    expect(addressShape('login.paypal.evil\u2024com')).toEqual({ ownerLabels: 0, suffixLabels: 0 })
  })

  it('ignores a dot at the very end', () => {
    expect(addressShape('paypal.com.')).toEqual({ ownerLabels: 2, suffixLabels: 1 })
  })
})

describe('askBackgroundShape', () => {
  it('asks the background once for every host drawn in the same tick, and answers from then on', async () => {
    const send = vi.mocked(browser.runtime.sendMessage)
    send.mockClear()
    send.mockResolvedValueOnce({
      'one.example.com': { ownerLabels: 2, suffixLabels: 1 },
      'two.example.org': { ownerLabels: 2, suffixLabels: 1 },
    })

    // Nothing known yet, so the frames stay thin rather than guessing
    expect(askBackgroundShape('one.example.com')).toBeUndefined()
    expect(askBackgroundShape('two.example.org')).toBeUndefined()
    await vi.waitFor(() => expect(askBackgroundShape('one.example.com')).toEqual({ ownerLabels: 2, suffixLabels: 1 }))

    const asked = send.mock.calls.filter(([message]: any[]) => message?.type === 'address-shapes')
    expect(asked).toHaveLength(1)
    expect((asked[0][0] as any).data.hosts).toEqual(['one.example.com', 'two.example.org'])
  })

  it('takes a missing background as nothing known, and asks again later', async () => {
    const send = vi.mocked(browser.runtime.sendMessage)
    send.mockClear()
    send.mockRejectedValueOnce(new Error('Receiving end does not exist'))
    expect(askBackgroundShape('late.example.net')).toBeUndefined()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    send.mockResolvedValueOnce({ 'late.example.net': { ownerLabels: 2, suffixLabels: 1 } })
    await vi.waitFor(() => {
      askBackgroundShape('late.example.net')
      expect(askBackgroundShape('late.example.net')).toEqual({ ownerLabels: 2, suffixLabels: 1 })
    })
  })
})
