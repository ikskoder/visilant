import { afterEach, describe, expect, it } from 'vitest'
import { classifyEmailDomain, loadCustomEmailLists, parseEmailDomainList, updateDisposableList } from '../email-providers'

afterEach(() => {
  // Reset runtime sets to built-ins only
  loadCustomEmailLists([], [])
  updateDisposableList([])
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

describe('parseEmailDomainList', () => {
  it('parses newline lists, skipping comments, blanks and dotless entries', () => {
    const parsed = parseEmailDomainList('# comment\nGmail.com\n\n  temp.io  \nnodots\n')
    expect(parsed).toEqual(['gmail.com', 'temp.io'])
  })
})
