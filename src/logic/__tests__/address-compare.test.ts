import { describe, expect, it } from 'vitest'
import { compareAddresses } from '../address-compare'

/** The characters one side carries, for reading an alignment back as a string. */
function row(cells: { checked?: string, known?: string }[], side: 'checked' | 'known') {
  return cells.map(cell => cell[side] ?? '').join('')
}

describe('comparing two addresses', () => {
  it('calls the same address the same', () => {
    const result = compareAddresses('anna@example.org', 'anna@example.org')
    expect(result.identical).toBe(true)
    expect(result.differences).toBe(0)
    expect(result.cells.every(cell => cell.same)).toBe(true)
  })

  it('points at the one character that changed', () => {
    const result = compareAddresses('anna@exarnple.org', 'anna@example.org')
    const differing = result.cells.filter(cell => !cell.same)

    // "m" became "rn": one character on the trusted side, two on the checked one
    expect(differing.map(cell => cell.checked ?? cell.known).join('')).toBe('rnm')
    expect(row(result.cells, 'checked')).toBe('anna@exarnple.org')
    expect(row(result.cells, 'known')).toBe('anna@example.org')
  })

  /**
   * The reason for aligning instead of comparing position by position. With a
   * straight index comparison every character after the insertion moves by one
   * and reads as wrong, which buries the character that was actually added.
   */
  it('blames an inserted character rather than everything after it', () => {
    const result = compareAddresses('annaa@example.org', 'anna@example.org')

    expect(result.differences).toBe(1)
    expect(result.cells.filter(cell => !cell.same)[0]).toEqual({ checked: 'a', same: false })
  })

  it('blames a missing character the same way', () => {
    const result = compareAddresses('ana@example.org', 'anna@example.org')

    expect(result.differences).toBe(1)
    expect(result.cells.filter(cell => !cell.same)[0]).toEqual({ known: 'n', same: false })
  })

  // The whole point of the feature: these are indistinguishable to a reader and
  // are two different addresses
  it('sees a lookalike letter from another script', () => {
    const result = compareAddresses('anna@exаmple.org', 'anna@example.org')

    expect(result.identical).toBe(false)
    expect(result.cells.filter(cell => !cell.same)).toHaveLength(2)
  })

  // A domain is case-insensitive and mail servers treat the name that way in
  // practice, so this is a difference in typing rather than a second address
  it('says when the only difference is how it was typed', () => {
    const result = compareAddresses('Anna@Example.ORG', 'anna@example.org')

    expect(result.identical).toBe(false)
    expect(result.sameIgnoringCase).toBe(true)
  })

  it('does not claim a real difference is only a matter of case', () => {
    expect(compareAddresses('anna@example.org', 'anna@exampIe.org').sameIgnoringCase).toBe(false)
  })

  it('handles one side being empty', () => {
    const result = compareAddresses('anna@example.org', '')
    expect(result.differences).toBe('anna@example.org'.length)
    expect(row(result.cells, 'known')).toBe('')
  })

  // The alignment table is quadratic, so the input is bounded rather than trusted
  it('refuses to grow a table for a pasted novel', () => {
    const long = `${'a'.repeat(5000)}@example.org`
    const result = compareAddresses(long, long)
    expect(result.cells.length).toBeLessThanOrEqual(320)
  })
})
