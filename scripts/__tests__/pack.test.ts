import { describe, expect, it } from 'vitest'
import { assertManifestTarget } from '../pack'

const chromeManifest = { background: { service_worker: 'dist/background/index.mjs' } }
const firefoxManifest = { background: { scripts: ['dist/background/index.mjs'] } }

describe('assertManifestTarget', () => {
  it('accepts a tree built for the target', () => {
    expect(() => assertManifestTarget(chromeManifest, 'chrome')).not.toThrow()
    expect(() => assertManifestTarget(firefoxManifest, 'firefox')).not.toThrow()
  })

  // Both builds write to the same directory, so packing twice without a rebuild
  // in between used to produce two names for one tree
  it('refuses a tree built for the other browser', () => {
    expect(() => assertManifestTarget(chromeManifest, 'firefox')).toThrow(/built for chrome, not for firefox/)
    expect(() => assertManifestTarget(firefoxManifest, 'chrome')).toThrow(/built for firefox, not for chrome/)
  })

  it('refuses a manifest with no background at all', () => {
    expect(() => assertManifestTarget({}, 'chrome')).toThrow(/no background section/)
    expect(() => assertManifestTarget(null, 'chrome')).toThrow(/no background section/)
  })

  it('refuses a background section that names neither shape', () => {
    expect(() => assertManifestTarget({ background: { page: 'x.html' } }, 'chrome'))
      .toThrow(/built for neither browser/)
  })
})
