import { describe, expect, it } from 'vitest'
import { describePastePayload, shouldInterceptPaste } from '../paste-guard'

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
