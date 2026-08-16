import { afterEach, describe, expect, it } from 'vitest'
import { classifyEmailDomain, loadCustomEmailLists, parseEmailDomainList, parseListUrls, updateDisposableList, updatePublicList } from '../email-providers'

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

describe('remote public provider list', () => {
  it('classifies remotely fetched domains as public', () => {
    expect(classifyEmailDomain('remote-provider.example')).toBe('regular')
    updatePublicList(['remote-provider.example'])
    expect(classifyEmailDomain('remote-provider.example')).toBe('public')
  })

  it('survives custom lists being loaded afterwards', () => {
    updatePublicList(['remote-provider.example'])
    loadCustomEmailLists(['mine.example'], [])

    expect(classifyEmailDomain('remote-provider.example')).toBe('public')
    expect(classifyEmailDomain('mine.example')).toBe('public')
    expect(classifyEmailDomain('gmail.com')).toBe('public')
  })

  it('replaces the previous remote list rather than accumulating', () => {
    updatePublicList(['first.example'])
    updatePublicList(['second.example'])

    expect(classifyEmailDomain('first.example')).toBe('regular')
    expect(classifyEmailDomain('second.example')).toBe('public')
  })

  it('still lets disposable win over a remotely listed provider', () => {
    updatePublicList(['both.example'])
    updateDisposableList(['both.example'])
    expect(classifyEmailDomain('both.example')).toBe('disposable')
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
