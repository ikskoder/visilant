import { looksLatin, scriptOf } from './domain-markers'

/**
 * What is unusual about the username of an email address, the part before the
 * @, and so what it can mean. "Unusual characters in the username" said that
 * something was there and left the reader to guess what and why it mattered.
 *
 * One answer, the most telling first:
 * - `invisible`: a character nobody sees, so two addresses that look the same
 *   are not,
 * - `lookalike`: letters of another alphabet drawn as Latin ones, `jоhn` with
 *   a Cyrillic `о`, read as `john` (`reads`, null where a letter has no one
 *   Latin reading here) and not that address,
 * - `styled`: full-width or styled forms of plain letters and digits, `ｊohn`,
 *   read as `john`,
 * - `marks`: Latin letters with marks plain a to z has not, `josé`, an address
 *   other than `jose` (`plain`),
 * - `script`: a name written in one other alphabet, `иван`, nobody's
 *   imitation, which some mail services cannot send to,
 * - `mixed`: Latin letters and letters of one other alphabet that do not pass
 *   for Latin ones, `ivan.иванов`, as plain as `script` about imitation,
 * - `other`: anything else outside plain ASCII.
 */
export type UsernameNote
  = | { kind: 'invisible', count: number }
    | { kind: 'lookalike', count: number, script: string, reads: string | null }
    | { kind: 'styled', reads: string }
    | { kind: 'marks', plain: string }
    | { kind: 'script', script: string }
    | { kind: 'mixed', script: string }
    | { kind: 'other' }

/** As `SecureText` tells an invisible character, so the line and the address agree */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Zl}\p{Zp}]/u
const ASCII_LETTER = /^[a-z]$/i

/**
 * The Latin letter each twin is seen as, for the reading shown to the user.
 * Not the lookalike check's fold (`CONFUSABLE_FOLD`), which is made for
 * matching and puts `l` for `і` because it folds `i` to `l` too: shown, that
 * spelled a name nobody sees. A twin without a line here is still a twin
 * (`looksLatin`), only without a reading.
 */
const READS: Record<string, string> = {
  // Cyrillic, small
  а: 'a',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  ҽ: 'e',
  һ: 'h',
  і: 'i',
  ј: 'j',
  к: 'k',
  ӏ: 'l',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  ѕ: 's',
  ѵ: 'v',
  ԝ: 'w',
  ѡ: 'w',
  х: 'x',
  у: 'y',
  // Cyrillic, capital
  А: 'A',
  В: 'B',
  Е: 'E',
  Ѕ: 'S',
  І: 'I',
  Ј: 'J',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  // Greek, small
  α: 'a',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  υ: 'u',
  // Greek, capital
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  // Armenian
  գ: 'g',
  հ: 'h',
  ո: 'n',
  ս: 'u',
  զ: 'q',
  օ: 'o',
}

/**
 * Drawn as a Latin letter: a small letter in Chromium's list, or one read
 * here. Capitals only from here: the list is of small letters, and the capital
 * of a twin, `П` of `п`, need not look like anything Latin.
 */
function isTwin(char: string): boolean {
  return (char === char.toLowerCase() && looksLatin(char)) || char in READS
}

/**
 * The plain letter or digit a full-width or mathematical form folds to, `j`
 * for `ｊ`. Those two blocks only: a raised, lowered or circled form folds
 * too, and `x²` does not read as `x2`.
 */
function unstyled(char: string): string | undefined {
  const code = char.codePointAt(0)!
  const styled = (code >= 0xFF10 && code <= 0xFF5A) || (code >= 0x1D400 && code <= 0x1D7FF)
  const folded = char.normalize('NFKC')
  return styled && /^[a-z0-9]$/i.test(folded) ? folded : undefined
}

/** The letter a Latin letter with marks is without them, `e` for `é` */
function withoutMarks(char: string): string | undefined {
  const bare = char.normalize('NFD').replace(/\p{M}/gu, '')
  return bare !== char && ASCII_LETTER.test(bare) ? bare : undefined
}

/** What a character is seen as. A letter with marks is seen with them, `é` as `é` */
function reading(char: string): string | undefined {
  return READS[char] ?? unstyled(char) ?? (withoutMarks(char) ? char : undefined)
}

/**
 * A red flag: letters of another alphabet drawn as Latin ones, `jоhn` with a
 * Cyrillic `о`, is a username made to pass for another. Everything else
 * this file tells about a username is only worth a look. Counted wherever the
 * red flags of an email address are, the hold on a click on a mail link too.
 */
export function usernameRedFlag(username: string): boolean {
  return usernameNote(username)?.kind === 'lookalike'
}

export function usernameNote(username: string): UsernameNote | null {
  // One code point per accented letter, which text from macOS may not have
  const chars = [...username.normalize('NFC')]
  const odd = chars.filter(char => char.codePointAt(0)! > 0x7F)
  if (!odd.length)
    return null

  const invisible = odd.filter(char => INVISIBLE.test(char))
  if (invisible.length)
    return { kind: 'invisible', count: invisible.length }

  // Passes for a Latin name: nothing in it shows that it is not one. A name
  // in another alphabet passes only when every letter of it is a twin,
  // `аррӏе`, and `иван`, with its `и`, is read as what it is
  const twins = odd.filter(isTwin)
  const styled = odd.filter(char => !isTwin(char) && unstyled(char))
  if ((twins.length || styled.length) && odd.every(char => isTwin(char) || unstyled(char) || withoutMarks(char))) {
    const reads = odd.every(reading) ? chars.map(char => reading(char) ?? char).join('') : null
    if (!twins.length)
      return { kind: 'styled', reads: reads! }
    const scripts = new Set(twins.map(char => scriptOf([char])))
    return { kind: 'lookalike', count: twins.length, script: scripts.size === 1 ? [...scripts][0] : 'other', reads }
  }

  if (odd.every(char => withoutMarks(char)))
    return { kind: 'marks', plain: chars.map(char => withoutMarks(char) ?? char).join('') }

  // Letters of one alphabet that is not Latin, with or without Latin beside them
  const scripts = new Set(odd.map(char => /\p{L}/u.test(char) ? scriptOf([char]) : 'none'))
  const [script] = scripts
  if (scripts.size === 1 && !['none', 'other', 'latin'].includes(script))
    return chars.some(char => ASCII_LETTER.test(char)) ? { kind: 'mixed', script } : { kind: 'script', script }

  return { kind: 'other' }
}
