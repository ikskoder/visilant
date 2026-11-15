import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../..')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return entry.name === '__tests__' ? [] : vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Every opening tag of this component in a file, attributes and all. */
function tags(source: string, component: string): string[] {
  return source.match(new RegExp(`<${component}\\b[^>]*>`, 'g')) ?? []
}

/**
 * A red notice names its sign. Red is four different things, a red flag, a
 * failed verdict, a failed comparison and an error, and each has a sign of its
 * own. A finding that is only worth a look is `caution`, orange, with the one
 * sign that tone has.
 *
 * A red notice with no icon is drawn with the bare triangle, which is what
 * every finding about an address was drawn with before the two were told
 * apart. So a line somebody adds as `tone="danger"` and nothing else is, more
 * often than not, a caution drawn in the wrong colour.
 */
describe('notice tones', () => {
  // An error on the settings page: nothing was saved. The triangle is its sign.
  const BARE_TRIANGLE_ALLOWED = ['options/Options.vue']

  it('finds the notices it is meant to check', () => {
    const all = vueFiles(SRC).flatMap(file => tags(readFileSync(file, 'utf8'), 'VzNotice'))
    expect(all.length).toBeGreaterThan(15)
    expect(all.some(tag => /\btone="caution"/.test(tag))).toBe(true)
  })

  it('has no red notice without a sign of its own outside the settings page', () => {
    const bare = vueFiles(SRC).flatMap((file) => {
      const name = relative(SRC, file)
      if (BARE_TRIANGLE_ALLOWED.includes(name))
        return []
      return tags(readFileSync(file, 'utf8'), 'VzNotice')
        .filter(tag => /\btone="danger"/.test(tag) && !/\s:?icon=/.test(tag))
        .map(tag => `${name}: ${tag.replace(/\s+/g, ' ')}`)
    })
    expect(bare).toEqual([])
  })

  // The triangle in red was the sign of every finding once. Named outright it
  // is the same mistake with one more attribute
  it('draws the red triangle on nothing but the settings page', () => {
    const triangles = vueFiles(SRC).flatMap((file) => {
      const name = relative(SRC, file)
      if (BARE_TRIANGLE_ALLOWED.includes(name))
        return []
      const source = readFileSync(file, 'utf8')
      return [...tags(source, 'VzNotice'), ...tags(source, 'VzBadge'), ...tags(source, 'VzIcon')]
        .filter(tag => /\b(?:icon|name)="alert"/.test(tag))
        .map(tag => `${name}: ${tag.replace(/\s+/g, ' ')}`)
    })
    expect(triangles).toEqual([])
  })
})

/**
 * The lines of findings about an address are drawn by one component,
 * `AddressFindings`, and that component is what marks the address: while it
 * is on screen, every drawing of the address has the labels the lines are
 * about in their colours (see SecureText.test.ts). A surface that drew the two
 * finders itself would draw lines that mark nothing.
 */
describe('findings and the address they are about', () => {
  const FINDERS = ['DomainMarkers', 'LookalikeNotice']
  const ALLOWED = ['components/AddressFindings.vue']

  it('finds the surfaces it is meant to check', () => {
    const drawing = vueFiles(SRC).filter(file => tags(readFileSync(file, 'utf8'), 'AddressFindings').length)
    expect(drawing.length).toBeGreaterThan(5)
  })

  it('has no surface that draws findings past the component that marks the address', () => {
    const past = vueFiles(SRC)
      .filter(file => !ALLOWED.includes(relative(SRC, file)))
      .filter(file => FINDERS.some(finder => tags(readFileSync(file, 'utf8'), finder).length))
      .map(file => relative(SRC, file))
    expect(past).toEqual([])
  })
})

/**
 * What kind of mail service an address is at, a public provider, a throwaway
 * service or a forwarding one, is said by one badge and one line. The tooltip,
 * the panel and the popup each had the badge written out, three surfaces had
 * the line, and the popup's card had none: "Disposable email" with not a word
 * about what that is. The line is one of the lines about the address, drawn by
 * `AddressFindings`, which is also what puts the site in the line's colour.
 */
describe('mail services', () => {
  const WORDS = /\b(?:emailDisposable(?:Domain|Hint)|emailForwarding\w*|emailPublicProvider\w*|emailHiddenOwnerHelp|emailRemotePublicHint)\b/
  const ALLOWED = ['components/MailServiceNote.vue', 'components/MailServiceBadge.vue']

  it('finds the words it is meant to check', () => {
    expect(ALLOWED.every(name => WORDS.test(readFileSync(join(SRC, name), 'utf8')) || /MAIL_SERVICE_VERDICTS/.test(readFileSync(join(SRC, name), 'utf8')))).toBe(true)
    expect(WORDS.test(readFileSync(join(SRC, 'logic/email-providers.ts'), 'utf8'))).toBe(true)
  })

  it('has no surface with words of its own about a mail service', () => {
    const own = vueFiles(SRC)
      .filter(file => !ALLOWED.includes(relative(SRC, file)))
      .filter(file => WORDS.test(readFileSync(file, 'utf8')))
      .map(file => relative(SRC, file))
    expect(own).toEqual([])
  })

  it('draws the line through the lines about the address and nowhere else', () => {
    const drawing = vueFiles(SRC)
      .filter(file => tags(readFileSync(file, 'utf8'), 'MailServiceNote').length)
      .map(file => relative(SRC, file))
    expect(drawing).toEqual(['components/AddressFindings.vue'])
  })

  // A comparison with one kind is a kind the next one added is left out of
  it('asks no surface which kind of service it is by name', () => {
    const asking = vueFiles(SRC)
      .filter(file => !ALLOWED.includes(relative(SRC, file)))
      .flatMap(file => (readFileSync(file, 'utf8').match(/[^\n]*===? '(?:disposable|forwarding|public)'[^\n]*/g) ?? []).map(line => `${relative(SRC, file)}: ${line.trim()}`))
    expect(asking).toEqual([])
  })
})

/**
 * One red flag was a red block in the check panel and a plain line in the
 * dialog beside it. A notice is a line, its sign and its words, on every
 * surface, and the box is asked for by the few blocks that are something else.
 */
describe('notices and their boxes', () => {
  // An error over the whole settings page, not a line about an address
  const BOXED_WARM_ALLOWED = ['options/Options.vue']

  it('boxes no red or orange notice outside the settings page', () => {
    const boxed = vueFiles(SRC).flatMap((file) => {
      const name = relative(SRC, file)
      if (BOXED_WARM_ALLOWED.includes(name))
        return []
      return tags(readFileSync(file, 'utf8'), 'VzNotice')
        .filter(tag => /\sboxed(?=[\s/>])/.test(tag) && !/\btone="(?:neutral|info)"/.test(tag))
        .map(tag => `${name}: ${tag}`)
    })
    expect(boxed).toEqual([])
  })

  it('has no surface left that chooses between a box and none', () => {
    const choosing = vueFiles(SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return ['VzNotice', 'AddressFindings', 'DomainMarkers', 'LookalikeNotice']
        .flatMap(component => tags(source, component))
        .filter(tag => /\s:?bare\b/.test(tag) || /\s:boxed=/.test(tag))
        .map(tag => `${relative(SRC, file)}: ${tag}`)
    })
    expect(choosing).toEqual([])
  })
})
