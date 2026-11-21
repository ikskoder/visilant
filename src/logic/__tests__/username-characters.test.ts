import { describe, expect, it } from 'vitest'
import { usernameNote, usernameRedFlag } from '../username-characters'

// Says what is unusual about a username and what it can mean, the line
// "Unusual characters in the username" said neither
describe('what is unusual about a username', () => {
  it('is nothing for plain Latin letters, digits and signs', () => {
    expect(usernameNote('john.smith+news_1')).toBeNull()
  })

  it('names an invisible character before anything else', () => {
    expect(usernameNote('jo​hn')).toEqual({ kind: 'invisible', count: 1 })
    expect(usernameNote('jо​h‍n')).toEqual({ kind: 'invisible', count: 2 })
  })

  it('reads a letter of another alphabet among Latin ones as the Latin name', () => {
    expect(usernameNote('jоhn')).toEqual({ kind: 'lookalike', count: 1, script: 'cyrillic', reads: 'john' })
    expect(usernameNote('аnnа')).toEqual({ kind: 'lookalike', count: 2, script: 'cyrillic', reads: 'anna' })
    expect(usernameNote('jοhn')).toMatchObject({ script: 'greek', reads: 'john' })
  })

  // The lookalike check's fold puts l for і, which nobody sees there
  it('reads a twin as the letter it is seen as', () => {
    expect(usernameNote('іvan')).toMatchObject({ kind: 'lookalike', reads: 'ivan' })
  })

  it('takes capitals of another alphabet for the Latin capitals they look like', () => {
    expect(usernameNote('JОHN')).toEqual({ kind: 'lookalike', count: 1, script: 'cyrillic', reads: 'JOHN' })
  })

  it('takes a name made only of twins as a lookalike', () => {
    expect(usernameNote('аррӏе')).toEqual({ kind: 'lookalike', count: 5, script: 'cyrillic', reads: 'apple' })
  })

  it('reads full-width and styled forms as plain ones', () => {
    expect(usernameNote('ｊohn')).toEqual({ kind: 'styled', reads: 'john' })
    expect(usernameNote('Ｊohn')).toEqual({ kind: 'styled', reads: 'John' })
  })

  // а, н and в are no twins Chromium lists, so these read as the names they are
  it('names a name in one other alphabet as that alphabet, not as an imitation', () => {
    expect(usernameNote('иван')).toEqual({ kind: 'script', script: 'cyrillic' })
    expect(usernameNote('анна')).toEqual({ kind: 'script', script: 'cyrillic' })
    expect(usernameNote('вера')).toEqual({ kind: 'script', script: 'cyrillic' })
    expect(usernameNote('γιάννης')).toEqual({ kind: 'script', script: 'greek' })
  })

  it('names Latin and another alphabet that does not pass for Latin as a mixture', () => {
    expect(usernameNote('ivan.иванов')).toEqual({ kind: 'mixed', script: 'cyrillic' })
    expect(usernameNote('ivanиван')).toEqual({ kind: 'mixed', script: 'cyrillic' })
  })

  it('spells a username with marks without them, however the accent is written', () => {
    expect(usernameNote('josé')).toEqual({ kind: 'marks', plain: 'jose' })
    expect(usernameNote('josé')).toEqual({ kind: 'marks', plain: 'jose' })
    expect(usernameNote('jürgen.öst')).toEqual({ kind: 'marks', plain: 'jurgen.ost' })
  })

  // The small п is in Chromium's list, its capital looks like nothing Latin
  it('takes no capital for a twin only because its small letter is one', () => {
    expect(usernameNote('ПАПА')).toEqual({ kind: 'script', script: 'cyrillic' })
    expect(usernameNote('ivan.ПАПА')).toEqual({ kind: 'mixed', script: 'cyrillic' })
  })

  it('keeps the marks in the reading, since they are seen', () => {
    expect(usernameNote('jоsé')).toMatchObject({ kind: 'lookalike', reads: 'josé' })
  })

  // Raised, lowered and circled forms do not read as the plain ones
  it('says only that something is there for the rest', () => {
    expect(usernameNote('x²')).toEqual({ kind: 'other' })
    expect(usernameNote('ⓙohn')).toEqual({ kind: 'other' })
    expect(usernameNote('john★')).toEqual({ kind: 'other' })
    expect(usernameNote('yılmaz')).toEqual({ kind: 'other' })
    expect(usernameNote('ø')).toEqual({ kind: 'other' })
  })
})

// Only a username made to pass for another stops a click
describe('which username is a red flag', () => {
  it('is one with letters of another alphabet drawn as Latin ones', () => {
    expect(usernameRedFlag('jоhn')).toBe(true)
    expect(usernameRedFlag('аррӏе')).toBe(true)
  })

  it('is no other unusual username', () => {
    for (const name of ['john', 'иван', 'josé', 'ｊohn', 'jo​hn', 'ivan.иванов'])
      expect(usernameRedFlag(name), name).toBe(false)
  })
})
