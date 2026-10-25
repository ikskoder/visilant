import type { LinkFacts } from '../intercept'
import { describe, expect, it } from 'vitest'
import { interceptReasons, interceptsAnything } from '../intercept'
import { defaultInterceptSettings } from '../storage'

const clean: LinkFacts = { familiar: false, unchecked: false, shortLink: false, redFlags: 0 }

describe('interceptReasons', () => {
  // The everyday new site: the typing warning covers it, a click is not stopped
  it('lets an unfamiliar link without flags through on the shipped settings', () => {
    expect(interceptReasons(clean, defaultInterceptSettings)).toEqual([])
  })

  it('stops it once "unfamiliar" is ticked, and never a familiar one for that', () => {
    const settings = { ...defaultInterceptSettings, unfamiliar: true }
    expect(interceptReasons(clean, settings)).toEqual(['unfamiliar'])
    expect(interceptReasons({ ...clean, familiar: true }, settings)).toEqual([])
  })

  // A flag is a trick in the link, and a site the user knows does not play it
  it('stops on red flags whatever the verdict', () => {
    expect(interceptReasons({ ...clean, familiar: true, redFlags: 1 }, defaultInterceptSettings)).toEqual(['red-flags'])
  })

  it('needs as many flags as the setting asks for', () => {
    const settings = { ...defaultInterceptSettings, minRedFlags: 2 }
    expect(interceptReasons({ ...clean, redFlags: 1 }, settings)).toEqual([])
    expect(interceptReasons({ ...clean, redFlags: 2 }, settings)).toEqual(['red-flags'])
  })

  it('stops a short link even to a familiar service', () => {
    expect(interceptReasons({ ...clean, familiar: true, shortLink: true }, defaultInterceptSettings)).toEqual(['short-link'])
    expect(interceptReasons({ ...clean, shortLink: true }, { ...defaultInterceptSettings, shortLinks: false })).toEqual([])
  })

  // No answer is not a clean link
  it('stops a link nobody could check while a check that needs the answer is on', () => {
    expect(interceptReasons({ ...clean, unchecked: true }, defaultInterceptSettings)).toEqual(['unchecked'])
    expect(interceptReasons({ ...clean, unchecked: true }, { ...defaultInterceptSettings, redFlags: false })).toEqual([])
    expect(interceptReasons({ ...clean, unchecked: true }, { ...defaultInterceptSettings, redFlags: false, unfamiliar: true })).toEqual(['unchecked'])
  })

  it('stops nothing with every box cleared', () => {
    const off = { ...defaultInterceptSettings, unfamiliar: false, shortLinks: false, redFlags: false }
    expect(interceptsAnything(off)).toBe(false)
    expect(interceptReasons({ familiar: false, unchecked: true, shortLink: true, redFlags: 4 }, off)).toEqual([])
  })
})
