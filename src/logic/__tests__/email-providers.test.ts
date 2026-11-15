import { afterEach, describe, expect, it } from 'vitest'
import { builtinMailServiceOf, classifyEmailDomain, isJudgedByVisits, isKnownMailDomain, isListedPublicOnlyRemotely, loadCustomEmailLists, parseEmailDomainList, parseListUrls, updateDisposableList, updatePublicList, withoutServiceNameMatches } from '../email-providers'

afterEach(() => {
  // Reset runtime sets to built-ins only
  loadCustomEmailLists([], [])
  updateDisposableList([])
  updatePublicList([])
})

describe('classifyEmailDomain', () => {
  it('classifies well-known public providers', () => {
    expect(classifyEmailDomain('gmail.com')).toBe('public')
    expect(classifyEmailDomain('outlook.com')).toBe('public')
    expect(classifyEmailDomain('mail.ru')).toBe('public')
    expect(classifyEmailDomain('ukr.net')).toBe('public')
    expect(classifyEmailDomain('GMAIL.COM')).toBe('public')
  })

  it('classifies known disposable services', () => {
    expect(classifyEmailDomain('mailinator.com')).toBe('disposable')
    expect(classifyEmailDomain('10minutemail.com')).toBe('disposable')
    expect(classifyEmailDomain('yopmail.com')).toBe('disposable')
  })

  it('matches subdomains of listed domains', () => {
    expect(classifyEmailDomain('foo.mailinator.com')).toBe('disposable')
    expect(classifyEmailDomain('smtp.gmail.com')).toBe('public')
  })

  it('returns regular for corporate/unknown domains', () => {
    expect(classifyEmailDomain('example.com')).toBe('regular')
    expect(classifyEmailDomain('paypal.com')).toBe('regular')
    expect(classifyEmailDomain('some-company.de')).toBe('regular')
  })

  it('includes user-defined lists', () => {
    loadCustomEmailLists(['mycorp-webmail.com'], ['my-temp-mail.xyz'])
    expect(classifyEmailDomain('mycorp-webmail.com')).toBe('public')
    expect(classifyEmailDomain('my-temp-mail.xyz')).toBe('disposable')
    // built-ins survive
    expect(classifyEmailDomain('gmail.com')).toBe('public')
    expect(classifyEmailDomain('mailinator.com')).toBe('disposable')
  })

  it('merges a remote disposable list without losing built-ins or custom entries', () => {
    loadCustomEmailLists([], ['my-temp-mail.xyz'])
    updateDisposableList(['remote-trash.example'])
    expect(classifyEmailDomain('remote-trash.example')).toBe('disposable')
    expect(classifyEmailDomain('my-temp-mail.xyz')).toBe('disposable')
    expect(classifyEmailDomain('mailinator.com')).toBe('disposable')
  })

  it('prefers disposable over public when a domain is in both lists', () => {
    loadCustomEmailLists(['tricky.example'], ['tricky.example'])
    expect(classifyEmailDomain('tricky.example')).toBe('disposable')
  })
})

// A downloaded list may add caution, never take it away: "public" lifts the red
// verdict off an address, so whoever maintains the list could lift it off any
// domain they liked
describe('remote public provider list', () => {
  it('never makes a domain public, only marks it as listed', () => {
    updatePublicList(['remote-provider.example'])
    expect(classifyEmailDomain('remote-provider.example')).toBe('regular')
    expect(isListedPublicOnlyRemotely('remote-provider.example')).toBe(true)
    expect(isListedPublicOnlyRemotely('unlisted.example')).toBe(false)
  })

  it('is not needed for what the built-in and the user lists already name', () => {
    updatePublicList(['remote-provider.example', 'gmail.com', 'mine.example'])
    loadCustomEmailLists(['mine.example'], [])

    expect(classifyEmailDomain('mine.example')).toBe('public')
    expect(classifyEmailDomain('gmail.com')).toBe('public')
    expect(isListedPublicOnlyRemotely('gmail.com')).toBe(false)
    expect(isListedPublicOnlyRemotely('mine.example')).toBe(false)
    expect(isListedPublicOnlyRemotely('remote-provider.example')).toBe(true)
  })

  it('replaces the previous remote list rather than accumulating', () => {
    updatePublicList(['first.example'])
    updatePublicList(['second.example'])

    expect(isListedPublicOnlyRemotely('first.example')).toBe(false)
    expect(isListedPublicOnlyRemotely('second.example')).toBe(true)
  })

  it('still lets disposable win over a remotely listed provider', () => {
    updatePublicList(['both.example'])
    updateDisposableList(['both.example'])
    expect(classifyEmailDomain('both.example')).toBe('disposable')
    expect(isListedPublicOnlyRemotely('both.example')).toBe(false)
  })
})

describe('parseEmailDomainList', () => {
  it('parses newline lists, skipping comments, blanks and dotless entries', () => {
    const parsed = parseEmailDomainList('# comment\nGmail.com\n\n  temp.io  \nnodots\n')
    expect(parsed).toEqual(['gmail.com', 'temp.io'])
  })
})

describe('parseListUrls', () => {
  it('reads one source per line', () => {
    expect(parseListUrls('https://a.example/list.txt\nhttps://b.example/list.txt'))
      .toEqual(['https://a.example/list.txt', 'https://b.example/list.txt'])
  })

  it('ignores blanks, comments and anything that is not a url', () => {
    const urls = parseListUrls('\n# a note\nnot a url\nhttps://a.example/list.txt\n  \n')
    expect(urls).toEqual(['https://a.example/list.txt'])
  })

  it('accepts a single url, so an existing setting keeps working', () => {
    expect(parseListUrls('https://a.example/list.txt')).toHaveLength(1)
  })
})

// An address that passes mail on to a real mailbox: a mask, not a throwaway box
describe('forwarding services', () => {
  it('names the built-in ones, and the addresses under them', () => {
    expect(classifyEmailDomain('mozmail.com')).toBe('forwarding')
    expect(classifyEmailDomain('duck.com')).toBe('forwarding')
    expect(classifyEmailDomain('privaterelay.appleid.com')).toBe('forwarding')
    expect(classifyEmailDomain('myname.mozmail.com')).toBe('forwarding')
    // The company's own domain is not its relay
    expect(classifyEmailDomain('appleid.com')).toBe('regular')
  })

  it('takes the user\'s own', () => {
    loadCustomEmailLists([], [], ['alias.example'])
    expect(classifyEmailDomain('alias.example')).toBe('forwarding')
    loadCustomEmailLists([], [], [])
    expect(classifyEmailDomain('alias.example')).toBe('regular')
  })

  // Lists of throwaway domains name forwarding services too, and this is the
  // exact statement of the two. Both are said in orange
  it('wins over a downloaded disposable list', () => {
    updateDisposableList(['mozmail.com'])
    expect(classifyEmailDomain('mozmail.com')).toBe('forwarding')
  })

  it('gives way to what the user wrote into their own lists', () => {
    loadCustomEmailLists([], ['mozmail.com'])
    expect(classifyEmailDomain('mozmail.com')).toBe('disposable')
    loadCustomEmailLists(['mozmail.com'], [])
    expect(classifyEmailDomain('mozmail.com')).toBe('public')
  })

  // Their own word, over a list that is shipped or downloaded: with the
  // lists first there was no way to correct one
  it('lets the user call a domain public that a disposable list names', () => {
    loadCustomEmailLists(['mailinator.com', 'remote-trash.example'], [])
    updateDisposableList(['remote-trash.example'])
    expect(classifyEmailDomain('mailinator.com')).toBe('public')
    expect(classifyEmailDomain('remote-trash.example')).toBe('public')
  })

  it('wins over public, as disposable does', () => {
    loadCustomEmailLists(['both.example'], [], ['both.example'])
    expect(classifyEmailDomain('both.example')).toBe('forwarding')
  })

  // A downloaded list of public providers lifts no verdict, and it does not
  // unmake a forwarding service either
  it('is not touched by a downloaded list of public providers', () => {
    updatePublicList(['mozmail.com'])
    expect(classifyEmailDomain('mozmail.com')).toBe('forwarding')
    expect(isListedPublicOnlyRemotely('mozmail.com')).toBe(false)
  })
})

describe('the built-in lists', () => {
  it('name a forwarding service under one kind only', () => {
    // 33mail gives its addresses under a name of the user's
    expect(classifyEmailDomain('someone.33mail.com')).toBe('forwarding')
    expect(classifyEmailDomain('opayq.com')).toBe('forwarding')
    expect(classifyEmailDomain('private.icloud.com')).toBe('forwarding')
    // Hide My Email is at the ordinary iCloud domain and cannot be told apart
    expect(classifyEmailDomain('icloud.com')).toBe('public')
  })

  // `mozmail.com` is two letters from `hotmail.com`, and was said to be made
  // to look like it. The answer is the listed name, so a caller can tell the
  // service's own labels from one in front of them, which is often the
  // user's to choose: `paypal.anonaddy.com`
  it('know a shipped mail service by name, and say which name it is', () => {
    expect(builtinMailServiceOf('mozmail.com')).toBe('mozmail.com')
    expect(builtinMailServiceOf('Someone.MozMail.com.')).toBe('mozmail.com')
    expect(builtinMailServiceOf('paypal.anonaddy.com')).toBe('anonaddy.com')
    expect(builtinMailServiceOf('gmx.net')).toBe('gmx.net')
    expect(builtinMailServiceOf('mozmai1.com')).toBeUndefined()
    expect(builtinMailServiceOf('com')).toBeUndefined()
  })

  // A list that is downloaded or typed could otherwise clear any name of a
  // lookalike finding
  it('do not count what a downloaded or the user\'s own list adds', () => {
    loadCustomEmailLists(['paypa1.test'], [], ['paypa1-alias.test'])
    updatePublicList(['paypa1-remote.test'])
    expect(builtinMailServiceOf('paypa1.test')).toBeUndefined()
    expect(builtinMailServiceOf('paypa1-alias.test')).toBeUndefined()
    expect(builtinMailServiceOf('paypa1-remote.test')).toBeUndefined()
  })
})

// Whether a click on a mail link goes through as one to a known address
describe('an address the reader can take as known', () => {
  it('is one at a public provider, or at a familiar ordinary domain', () => {
    expect(isKnownMailDomain('public', false)).toBe(true)
    expect(isKnownMailDomain('regular', true)).toBe(true)
    expect(isKnownMailDomain('regular', false)).toBe(false)
  })

  it('is never one at a throwaway or a forwarding service', () => {
    expect(isKnownMailDomain('disposable', true)).toBe(false)
    expect(isKnownMailDomain('forwarding', true)).toBe(false)
  })

  it('is judged by visits only at an ordinary domain', () => {
    expect(isJudgedByVisits('regular')).toBe(true)
    expect(['public', 'disposable', 'forwarding'].some(kind => isJudgedByVisits(kind as any))).toBe(false)
  })
})

// What the lookalike check is left with for an address at a mail service
describe('a mail service\'s own name', () => {
  const found = (...evidence: string[]) => evidence.map(piece => ({ evidence: piece }))

  it('is nobody\'s lookalike, on its own and under a name of the user\'s', () => {
    expect(withoutServiceNameMatches('mozmail.com', found('mozmail'))).toEqual([])
    expect(withoutServiceNameMatches('someone.mozmail.com', found('mozmail'))).toEqual([])
  })

  // The label in front is the user's to choose: exactly what the check is for
  it('keeps what was found in a label in front of it', () => {
    expect(withoutServiceNameMatches('paypal.anonaddy.com', found('paypal', 'anonaddy'))).toEqual(found('paypal'))
    expect(withoutServiceNameMatches('paypal.com.anonaddy.com', found('paypal.com'))).toEqual(found('paypal.com'))
  })

  // A line can name several parked domains, each judged on its own
  it('takes a name out of a line that names several, and keeps the rest', () => {
    const line = { domain: 'anonaddy.com', evidence: 'anonaddy.com', also: [{ domain: 'paypal.com', evidence: 'paypal.com', visits: 1 }] }
    expect(withoutServiceNameMatches('anonaddy.com.paypal.com.anonaddy.com', [line])).toEqual([{ domain: 'paypal.com', evidence: 'paypal.com', visits: 1, also: undefined }])
    // The marks were about the name that went
    expect(withoutServiceNameMatches('anonaddy.com.paypal.com.anonaddy.com', [{ ...line, marks: [0] }])[0]).toMatchObject({ domain: 'paypal.com', marks: undefined })
  })

  it('leaves every other address alone', () => {
    expect(withoutServiceNameMatches('mozmai1.com', found('mozmai1'))).toEqual(found('mozmai1'))
    expect(withoutServiceNameMatches('paypa1.test', found('paypa1'))).toEqual(found('paypa1'))
  })
})
