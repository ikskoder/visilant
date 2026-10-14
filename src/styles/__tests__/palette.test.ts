import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No palette colour anywhere in the interface.
 *
 * Every colour comes from a design token (`text-ink-2`, `bg-danger-tint`…),
 * which is one meaning in both themes. A palette class (`text-gray-500`,
 * `bg-red-100`) is a second, untested answer to the same question, and the
 * hundred and eighty of them that had piled up were why one verdict came out in three
 * colours. UnoCSS still knows the palette, so this is what keeps it out.
 */
const SRC = resolve(__dirname, '../..')
const PALETTE = /(?:^|[\s"'`:])(?:text|bg|border|ring|divide|from|to|via|fill|stroke|outline|accent|placeholder|decoration)-(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'node_modules')
      return []
    if (statSync(path).isDirectory())
      return files(path)
    return /\.(?:vue|ts)$/.test(name) ? [path] : []
  })
}

describe('colours come from tokens', () => {
  it('no source file names a palette colour class', () => {
    const offenders = files(SRC).flatMap(path => readFileSync(path, 'utf8').split('\n').map((line, index) => PALETTE.test(line) ? `${relative(SRC, path)}:${index + 1}: ${line.trim()}` : null).filter((hit): hit is string => hit !== null))
    expect(offenders).toEqual([])
  })
})
