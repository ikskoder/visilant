import { describe, expect, it } from 'vitest'
import { describePastePayload, editableTargetOf, isEditableEventTarget, isEditableTarget, shouldHoldPasteUndecided, shouldInterceptPaste } from '../paste-guard'

describe('shouldInterceptPaste', () => {
  const base = {
    enabled: true,
    siteIsSafe: false as boolean | null,
    ignored: false,
    hasText: true,
    targetIsEditable: true,
    alreadyAllowed: false,
  }

  it('holds a paste into a field on an unfamiliar site', () => {
    expect(shouldInterceptPaste(base)).toBe(true)
  })

  it('does nothing unless the user asked for it', () => {
    expect(shouldInterceptPaste({ ...base, enabled: false })).toBe(false)
  })

  it('leaves familiar sites alone', () => {
    expect(shouldInterceptPaste({ ...base, siteIsSafe: true })).toBe(false)
  })

  it('waits rather than guesses while the safety check is still in flight', () => {
    // Blocking on an unknown would hold pastes on every site for the first moments of a page
    expect(shouldInterceptPaste({ ...base, siteIsSafe: null })).toBe(false)
  })

  it('respects a site the user has chosen to ignore', () => {
    expect(shouldInterceptPaste({ ...base, ignored: true })).toBe(false)
  })

  it('does not interrupt a paste that carries no text or has nowhere to land', () => {
    expect(shouldInterceptPaste({ ...base, hasText: false })).toBe(false)
    expect(shouldInterceptPaste({ ...base, targetIsEditable: false })).toBe(false)
  })
})

describe('describePastePayload', () => {
  it('recognises the shapes worth naming', () => {
    expect(describePastePayload('https://example.com/a').kind).toBe('url')
    expect(describePastePayload('  user@example.com ').kind).toBe('email')
    expect(describePastePayload('4111 1111 1111 1111').kind).toBe('digits')
    expect(describePastePayload('just some words').kind).toBe('text')
  })

  it('does not call a short number a code', () => {
    expect(describePastePayload('42').kind).toBe('text')
  })

  it('measures the payload without revealing it', () => {
    const info = describePastePayload('a\nb\nc')
    expect(info.length).toBe(5)
    expect(info.lines).toBe(3)
  })

  it('caps the preview, so a huge clipboard cannot fill the dialog', () => {
    expect(describePastePayload('x'.repeat(5000)).preview.length).toBe(300)
  })

  it('reports an empty clipboard as having no lines', () => {
    expect(describePastePayload('').lines).toBe(0)
  })
})

describe('shouldInterceptPaste, once confirmed', () => {
  it('leaves the rest of the page alone after the user has looked at the address', () => {
    expect(shouldInterceptPaste({
      enabled: true,
      siteIsSafe: false,
      ignored: false,
      hasText: true,
      targetIsEditable: true,
      alreadyAllowed: true,
    })).toBe(false)
  })
})

describe('shouldHoldPasteUndecided', () => {
  const base = {
    enabled: true,
    verdictKnown: false,
    ignored: false,
    hasText: true,
    targetIsEditable: true,
    alreadyAllowed: false,
  }

  // The window this closes: a page opens, the verdict is still on its way, and
  // the user pastes a password into it. The guard asked for a strict `false`
  // and got `null`, so the paste went straight through.
  it('holds a paste made before the page has been judged', () => {
    expect(shouldHoldPasteUndecided(base)).toBe(true)
  })

  it('lets a paste through once there is a verdict, whichever it is', () => {
    expect(shouldHoldPasteUndecided({ ...base, verdictKnown: true })).toBe(false)
  })

  it('does nothing when the guard is off', () => {
    expect(shouldHoldPasteUndecided({ ...base, enabled: false })).toBe(false)
  })

  it('leaves an ignored site alone, which is the user decision', () => {
    expect(shouldHoldPasteUndecided({ ...base, ignored: true })).toBe(false)
  })

  it('does not interrupt a paste that cannot leak anything', () => {
    expect(shouldHoldPasteUndecided({ ...base, targetIsEditable: false })).toBe(false)
    expect(shouldHoldPasteUndecided({ ...base, hasText: false })).toBe(false)
  })

  it('stops asking once the user has confirmed a paste on this page', () => {
    expect(shouldHoldPasteUndecided({ ...base, alreadyAllowed: true })).toBe(false)
  })
})

describe('isEditableEventTarget', () => {
  // A field inside a custom element's shadow root retargets: the event's target
  // is the host element, which is not editable and has no value. The paste guard
  // saw an ordinary click target and let the paste straight through.
  function eventWithPath(path: EventTarget[]): Event {
    return { target: path[path.length - 1], composedPath: () => path } as unknown as Event
  }

  it('finds a field the event was retargeted away from', () => {
    const input = document.createElement('input')
    const host = document.createElement('my-widget')

    expect(isEditableTarget(host)).toBe(false)
    expect(isEditableEventTarget(eventWithPath([input, host]))).toBe(true)
  })

  it('still answers for an ordinary field with no shadow root in the way', () => {
    const input = document.createElement('input')
    expect(isEditableEventTarget(eventWithPath([input]))).toBe(true)
  })

  it('says no when nothing in the path can be typed into', () => {
    const div = document.createElement('div')
    const button = document.createElement('button')
    expect(isEditableEventTarget(eventWithPath([button, div]))).toBe(false)
  })

  it('falls back to the target where there is no composed path', () => {
    const input = document.createElement('input')
    expect(isEditableEventTarget({ target: input } as unknown as Event)).toBe(true)
  })

  it('hands back the field itself, so focus can be put back into it', () => {
    const input = document.createElement('input')
    const host = document.createElement('my-widget')
    expect(editableTargetOf(eventWithPath([input, host]))).toBe(input)
  })
})
