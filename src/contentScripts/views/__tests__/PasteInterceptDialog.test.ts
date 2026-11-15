import type { PasteInterceptData } from '~/logic/ui-state'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PasteInterceptDialog from '../PasteInterceptDialog.vue'

const data: PasteInterceptData = {
  domain: 'unfamiliar.test',
  stats: { count: 1 },
  punycode: null,
  payload: { kind: 'text', length: 24, preview: 'hunter2' } as PasteInterceptData['payload'],
}

function open(overrides: Partial<PasteInterceptData> = {}) {
  return mount(PasteInterceptDialog, {
    props: { visible: true, data: { ...data, ...overrides } },
  })
}

/**
 * This dialog interrupts a paste, so the reader is mid-action and in a hurry –
 * which is exactly when a tickbox labelled "do not warn me about this site
 * again" gets ticked on the say-so of the page underneath. The page cannot
 * reach in here, but it can write instructions beside it, so the control it
 * would aim at is not here to be aimed at. See the note in `InputWarning`.
 */
// What the reader is looking at when this comes up: a field that stayed empty
describe('the paste dialog from where the reader stands', () => {
  // A paste in a box inside the page is judged by the page, so the address is
  // the page's, and is headed as that
  it('heads the address as the page\'s when the paste was in a box inside it', () => {
    const inFrame = open({ inFrame: true })
    expect(inFrame.text()).toContain('pasteInterceptPageHeading')
    expect(open().text()).not.toContain('pasteInterceptPageHeading')
  })

  // The card is centred, so a line of help opening moves "Allow pasting"
  // under a pointer that has not moved
  it('makes the press after opening help wait its half second again', async () => {
    vi.useFakeTimers()
    try {
      // The other spelling of the name brings a question mark with it
      const wrapper = open({ domain: 'пример.test', punycode: 'xn--e1afmkfd.test' })
      vi.advanceTimersByTime(600)
      await wrapper.get('[data-action="help"]').trigger('click')
      await wrapper.get('[data-action="allow"]').trigger('click')
      expect(wrapper.emitted('allow')).toBeUndefined()
      vi.advanceTimersByTime(600)
      await wrapper.get('[data-action="allow"]').trigger('click')
      expect(wrapper.emitted('allow')).toHaveLength(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  // Let through because the user turned warnings off is not "familiar"
  it('does not call a silenced site familiar', () => {
    const silenced = open({ status: 'safe', silenced: true, stats: { count: 1 } })
    expect(silenced.text()).toContain('pasteInterceptSilencedMessage')
    expect(silenced.text()).not.toContain('pasteInterceptSafeMessage')
    expect(silenced.get('[data-address-status] [data-verdict]').attributes('data-verdict')).toBe('unfamiliar')

    const familiar = open({ status: 'safe', stats: { count: 50 } })
    expect(familiar.text()).toContain('pasteInterceptSafeMessage')
    expect(familiar.get('[data-address-status] [data-verdict]').attributes('data-verdict')).toBe('familiar')
  })
})

describe('the paste dialog and the per-site silence', () => {
  it('has no control that silences the site', () => {
    const wrapper = open()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('pasteInterceptDontAskAgain')
  })

  it('says where the switch is instead', () => {
    expect(open().text()).toContain('warningSilenceHint')
  })

  // Nothing to point at while there is no verdict about the site yet
  it('keeps quiet about it before the check has finished', () => {
    expect(open({ status: 'checking' }).text()).not.toContain('warningSilenceHint')
  })

  it('settles the paste either way without carrying a second decision', async () => {
    vi.useFakeTimers()
    const wrapper = open()
    // Allowing ignores a press for the first half second
    await vi.advanceTimersByTimeAsync(500)

    const allow = wrapper.findAll('button').find(b => b.text() === 'pasteInterceptAllow')!
    await allow.trigger('click')
    expect(wrapper.emitted('allow')).toEqual([[]])

    const cancel = wrapper.findAll('button').find(b => b.text() === 'pasteInterceptCancel')!
    await cancel.trigger('click')
    expect(wrapper.emitted('cancel')).toEqual([[]])
    vi.useRealTimers()
  })

  // The verdict can take a while. "Allow pasting" then appears where "Don't
  // paste" was, and must not already be live for a press aimed at the other one
  it('counts the half second from when "Allow pasting" appears, not from when the dialog opened', async () => {
    vi.useFakeTimers()
    const wrapper = open({ status: 'checking' })
    await vi.advanceTimersByTimeAsync(2000)
    await wrapper.setProps({ data: { ...data, status: 'unfamiliar' } })
    await wrapper.get('[data-action="allow"]').trigger('click')
    expect(wrapper.emitted('allow')).toBeFalsy()
    await vi.advanceTimersByTimeAsync(500)
    await wrapper.get('[data-action="allow"]').trigger('click')
    expect(wrapper.emitted('allow')).toBeTruthy()
    vi.useRealTimers()
  })

  it('ignores "Allow pasting" for the first half second', async () => {
    vi.useFakeTimers()
    const wrapper = open()
    await wrapper.get('[data-action="allow"]').trigger('click')
    expect(wrapper.emitted('allow')).toBeFalsy()
    vi.useRealTimers()
  })
})
