import { fetchTextBounded, MAX_LIST_SOURCES } from './bounded-fetch'
import { matchesDomainSet } from './domain-set'

// Classification of email domains: well-known public providers (anyone can
// register an address – domain reputation says nothing about the sender),
// disposable/temp-mail services (almost always spam or scam in real mail) and
// forwarding services, whose addresses pass mail on to a mailbox nobody sees.
// Mirrors the url-shorteners.ts pattern: built-in list + user list + remote list.

const BUILTIN_PUBLIC_PROVIDERS = `
gmail.com
googlemail.com
outlook.com
hotmail.com
live.com
msn.com
yahoo.com
ymail.com
rocketmail.com
aol.com
icloud.com
me.com
mac.com
proton.me
protonmail.com
pm.me
tutanota.com
tutamail.com
tuta.io
zoho.com
zohomail.com
gmx.com
gmx.net
gmx.de
web.de
mail.com
fastmail.com
hey.com
yandex.ru
yandex.com
ya.ru
mail.ru
bk.ru
inbox.ru
list.ru
internet.ru
rambler.ru
ukr.net
i.ua
meta.ua
seznam.cz
centrum.cz
azet.sk
wp.pl
o2.pl
onet.pl
interia.pl
t-online.de
freenet.de
orange.fr
laposte.net
free.fr
sfr.fr
libero.it
virgilio.it
tiscali.it
terra.com
uol.com.br
bol.com.br
naver.com
daum.net
hanmail.net
qq.com
163.com
126.com
yeah.net
sina.com
foxmail.com
rediffmail.com
comcast.net
verizon.net
att.net
sbcglobal.net
cox.net
charter.net
earthlink.net
bluewin.ch
telenet.be
skynet.be
ziggo.nl
kpnmail.nl
xs4all.nl
abv.bg
mail.ee
`

const BUILTIN_DISPOSABLE_DOMAINS = `
10minutemail.com
10minutemail.net
10minemail.com
20minutemail.com
anonbox.net
burnermail.io
byom.de
crazymailing.com
discard.email
dispostable.com
disposablemail.com
dropmail.me
emailondeck.com
emlhub.com
fakeinbox.com
getnada.com
grr.la
guerrillamail.biz
guerrillamail.com
guerrillamail.de
guerrillamail.net
guerrillamail.org
guerrillamailblock.com
harakirimail.com
inboxkitten.com
jetable.org
kurzepost.de
mail-temporaire.fr
mail7.io
mailcatch.com
maildrop.cc
mailinator.com
mailinator.net
mailnesia.com
mailsac.com
meltmail.com
mintemail.com
moakt.com
mohmal.com
mytemp.email
nada.email
objectmail.com
proxymail.eu
rcpt.at
sharklasers.com
spam4.me
spamgourmet.com
spoofmail.de
tempail.com
temp-mail.io
temp-mail.org
tempinbox.com
tempmail.com
tempmailo.com
tempr.email
throwawaymail.com
tmail.ws
trash-mail.com
trashmail.com
trashmail.de
wegwerfmail.de
yopmail.com
yopmail.fr
yopmail.net
`

/**
 * Services that hand out an address which passes mail on to a real mailbox:
 * a mask over somebody's own address, kept for as long as they like.
 *
 * Not a throwaway mailbox, which is why it is not on the list above: nobody
 * else can read it and it does not expire. Somebody who publishes one is
 * keeping spam out of their own mailbox, and a site that named it "Disposable
 * email", or judged it by visits nobody makes to such a domain and called it
 * "Never visited", said something untrue about them either way.
 *
 * Only domains a service uses for nothing but such addresses. Hide My Email
 * and Fastmail's masked addresses are at the provider's ordinary domain and
 * cannot be told from a mailbox there.
 *
 * Built-in and the user's own, and no downloaded copy. This kind takes the
 * visit verdict off an address, and a downloaded list may add caution, never
 * take it away, see `remotePublicSet`.
 */
const BUILTIN_FORWARDING_DOMAINS = `
# Firefox Relay
mozmail.com
# DuckDuckGo Email Protection
duck.com
# Sign in with Apple, the old domain and the one new addresses are given at
privaterelay.appleid.com
private.icloud.com
# SimpleLogin
simplelogin.com
simplelogin.co
simplelogin.io
simplelogin.fr
aleeas.com
slmail.me
slmails.com
silomails.com
8shield.net
8alias.com
dralias.com
# Proton Pass
passmail.net
passmail.com
passinbox.com
passfwd.com
pass2mail.com
# addy.io, once AnonAddy
anonaddy.com
anonaddy.me
addy.io
addy.to
4wrd.cc
mailer.me
addymail.com
# Blur, now IronVest
opayq.com
# 33mail, whose addresses are under a name of the user's: x@name.33mail.com
33mail.com
erine.email
# Brave Email Aliases
bravealias.com
`

export type EmailProviderKind = 'public' | 'disposable' | 'forwarding' | 'regular'

/** A domain that is a mail service of some kind, and so not judged by visits. */
export type MailServiceKind = Exclude<EmailProviderKind, 'regular'>

/**
 * What every surface calls a mail service, in place of a verdict on visits
 * nobody makes to such a domain: the word, its colour and its sign.
 *
 * The tooltip, the check panel and the popup each had these written out, and
 * a kind added to one was a kind the others did not know.
 */
export const MAIL_SERVICE_VERDICTS = {
  public: { verdict: 'public', label: 'emailPublicProvider', tone: 'neutral', icon: 'email' },
  disposable: { verdict: 'disposable', label: 'emailDisposableDomain', tone: 'caution', icon: 'shield-alert' },
  forwarding: { verdict: 'forwarding', label: 'emailForwardingDomain', tone: 'caution', icon: 'shield-alert' },
} as const satisfies Record<MailServiceKind, { verdict: MailServiceKind, label: string, tone: 'neutral' | 'caution', icon: string }>

/**
 * Whether an address at this kind of domain is one the reader can take as
 * known: a public provider, where the domain says nothing either way, or an
 * ordinary domain they are familiar with. Not a throwaway or a forwarding
 * service, whatever its visits: who is behind such an address cannot be known.
 */
export function isKnownMailDomain(kind: EmailProviderKind, familiar: boolean): boolean {
  return kind === 'public' || (kind === 'regular' && familiar)
}

/**
 * A kind of service the reader is told to be careful with: whoever is behind
 * such an address cannot be known. Its site is drawn in the colour of that
 * line, and writing to it is going ahead past a warning.
 */
export function isCautionMailService(kind: EmailProviderKind | null | undefined): boolean {
  return kind != null && kind !== 'regular' && MAIL_SERVICE_VERDICTS[kind].tone === 'caution'
}

/**
 * Below this, a provider's name is an ordinary word rather than a brand.
 *
 * `mail.com`, `list.ru`, `free.fr`, `web.de` and `hey.com` are all on the list
 * above and all name themselves after something people write every day. Used as
 * something to resemble, they would flag unrelated domains constantly, so the
 * lookalike reference set below keeps only the distinctive names.
 */
const MIN_PROVIDER_LABEL_LENGTH = 5

/**
 * The providers worth comparing an address against, built once.
 *
 * Only the built-in list feeds this. The remote and user lists exist to widen
 * what counts as a public mailbox, which is a different question from what is
 * worth imitating – thousands of fetched domains would be pure noise here.
 */
export function getProviderReferenceDomains(): { domain: string, label: string }[] {
  return parseEmailDomainList(BUILTIN_PUBLIC_PROVIDERS)
    .map(domain => ({ domain, label: domain.split('.')[0] }))
    .filter(entry => entry.label.length >= MIN_PROVIDER_LABEL_LENGTH)
}

export function parseEmailDomainList(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0 && !d.startsWith('#') && d.includes('.'))
}

// Runtime sets – built-in + user-defined + remotely fetched
let customPublic: string[] = []
let customDisposable: string[] = []
let customForwarding: string[] = []
let remotePublic: string[] = []
let remoteDisposable: string[] = []
let publicSet = new Set<string>(parseEmailDomainList(BUILTIN_PUBLIC_PROVIDERS))
/**
 * The downloaded list of public providers, kept out of `publicSet`.
 *
 * A public provider is judged by the name before @ rather than by visits, so
 * landing in that set lifts the red verdict off an address. Whoever maintains a
 * list somewhere else could lift it off any domain they liked, from the next
 * press of Update on. A downloaded list may add caution, never take it away: a
 * domain only this list names stays an ordinary site, judged by visits, and
 * gets the line saying anyone may register an address there on top.
 */
let remotePublicSet = new Set<string>()
let disposableSet = new Set<string>(parseEmailDomainList(BUILTIN_DISPOSABLE_DOMAINS))
/** The user's own disposable domains alone, which outrank the built-in forwarding list */
let customDisposableSet = new Set<string>()
let customForwardingSet = new Set<string>()
let customPublicSet = new Set<string>()

function rebuildSets() {
  publicSet = new Set<string>([...parseEmailDomainList(BUILTIN_PUBLIC_PROVIDERS), ...customPublic])
  remotePublicSet = new Set<string>(remotePublic)
  disposableSet = new Set<string>([...parseEmailDomainList(BUILTIN_DISPOSABLE_DOMAINS), ...customDisposable, ...remoteDisposable])
  customDisposableSet = new Set<string>(customDisposable)
  customForwardingSet = new Set<string>(customForwarding)
  customPublicSet = new Set<string>(customPublic)
}

function normalizeDomains(domains: string[]): string[] {
  return domains.map(d => d.trim().toLowerCase()).filter(d => d.length > 0)
}

/** Load the user's own list of public providers. */
export function loadCustomPublicList(domains: string[]): void {
  customPublic = normalizeDomains(domains)
  rebuildSets()
}

/** Load the user's own list of disposable domains. */
export function loadCustomDisposableList(domains: string[]): void {
  customDisposable = normalizeDomains(domains)
  rebuildSets()
}

/** Load the user's own list of forwarding domains. */
export function loadCustomForwardingList(domains: string[]): void {
  customForwarding = normalizeDomains(domains)
  rebuildSets()
}

/**
 * Load user-defined lists (called on startup from storage.local).
 */
export function loadCustomEmailLists(publicDomains: string[], disposableDomains: string[], forwardingDomains: string[] = []): void {
  customPublic = normalizeDomains(publicDomains)
  customDisposable = normalizeDomains(disposableDomains)
  customForwarding = normalizeDomains(forwardingDomains)
  rebuildSets()
}

/**
 * Load a remotely fetched disposable-domain list (merged, built-ins never lost).
 */
export function updateDisposableList(remoteDomains: string[]): void {
  remoteDisposable = normalizeDomains(remoteDomains)
  rebuildSets()
}

/**
 * Load a remotely fetched list of public providers (merged, built-ins kept).
 *
 * Held in its own slice rather than written straight into the set, so a later
 * rebuild – adding a custom domain, say – cannot silently throw it away.
 */
export function updatePublicList(remoteDomains: string[]): void {
  remotePublic = normalizeDomains(remoteDomains)
  rebuildSets()
}

export function getDisposableCount(): number {
  return disposableSet.size
}

export function getPublicCount(): number {
  return new Set([...publicSet, ...remotePublicSet]).size
}

/**
 * Named only by the downloaded list of public providers. Such a domain is still
 * classified `regular`, see `remotePublicSet`.
 */
export function isListedPublicOnlyRemotely(domain: string): boolean {
  const lower = domain.trim().toLowerCase()
  return classifyEmailDomain(lower) === 'regular' && matchesDomainSet(lower, remotePublicSet)
}

const BUILTIN_PUBLIC = new Set<string>(parseEmailDomainList(BUILTIN_PUBLIC_PROVIDERS))
const BUILTIN_FORWARDING = new Set<string>(parseEmailDomainList(BUILTIN_FORWARDING_DOMAINS))

/**
 * The mail service this build ships the name of, a public provider or a
 * forwarding service, that a domain is or is under.
 *
 * The service's own name is nobody's lookalike. `mozmail.com` is two letters
 * from `hotmail.com`, and `gmx.com` is `gmx.net` with another ending, so
 * each was said to be made to look like the other. That goes for the
 * service's own labels and nothing in front of them: at several of these
 * services the label in front is the user's to choose, and
 * `paypal.anonaddy.com` is exactly what a lookalike check is for. So this
 * answers with the listed name, and the caller drops only what was found in
 * its labels.
 *
 * Only the lists in this file: one that is downloaded or typed could
 * otherwise clear any name it liked.
 */
export function builtinMailServiceOf(domain: string): string | undefined {
  const labels = domain.trim().toLowerCase().replace(/\.$/, '').split('.')
  for (let from = 0; from < labels.length - 1; from++) {
    const name = labels.slice(from).join('.')
    if (BUILTIN_PUBLIC.has(name) || BUILTIN_FORWARDING.has(name))
      return name
  }
  return undefined
}

/**
 * What a lookalike check found, less what it found in a shipped mail
 * service's own name: `mozmail` is not made to look like `hotmail`. What it
 * found in a label in front of that name stays.
 */
export function withoutServiceNameMatches<Match extends { evidence: string, also?: { evidence: string }[] }>(hostname: string, matches: Match[]): Match[] {
  const service = builtinMailServiceOf(hostname)
  if (!service)
    return matches
  const own = new Set(service.split('.'))
  const inName = (evidence: string) => evidence.toLowerCase().split('.').every(label => own.has(label))
  // A line can name several parked domains, and each is judged on its own
  return matches.flatMap((match): Match[] => {
    const also = match.also?.filter(item => !inName(item.evidence))
    const rest = also?.length ? also : undefined
    if (!inName(match.evidence))
      return [match.also ? { ...match, also: rest } : match]
    // The first name went, so the next one leads the line
    const [next, ...after] = also ?? []
    // Its marks were about the name that went
    return next ? [{ ...match, ...next, marks: undefined, also: after.length ? after : undefined }] : []
  })
}

/** Whether visits say anything about a domain of this kind: not about a mail service. */
export function isJudgedByVisits(kind: EmailProviderKind): boolean {
  return kind === 'regular'
}

/**
 * Classify an email domain.
 *
 * What the user wrote into their own lists comes first, whatever the shipped
 * and the downloaded lists say of the same domain: it is their word, and a
 * list that outranked it left them no way to correct one. Among their own
 * the most careful reading wins, disposable, then forwarding, then public.
 *
 * Then the same order for the rest. Disposable wins over public: some
 * temp-mail services hide behind provider-looking names. Forwarding wins over
 * the disposable lists, the downloaded one included: lists of throwaway
 * domains name forwarding services too, and of the two statements this is the
 * exact one. Both are said in orange, so nothing is played down by it.
 */
export function classifyEmailDomain(domain: string): EmailProviderKind {
  const lower = domain.trim().toLowerCase()
  if (matchesDomainSet(lower, customDisposableSet))
    return 'disposable'
  if (matchesDomainSet(lower, customForwardingSet))
    return 'forwarding'
  if (matchesDomainSet(lower, customPublicSet))
    return 'public'
  if (matchesDomainSet(lower, BUILTIN_FORWARDING))
    return 'forwarding'
  if (matchesDomainSet(lower, disposableSet))
    return 'disposable'
  if (matchesDomainSet(lower, BUILTIN_PUBLIC))
    return 'public'
  return 'regular'
}

const MAX_REMOTE_LIST_SIZE = 100_000

/**
 * Fetch a newline-separated domain list (lines starting with # are comments).
 * Returns the parsed domains. Throws on network/HTTP errors.
 */
export async function fetchRemoteDomainList(url: string): Promise<string[]> {
  return parseEmailDomainList(await fetchTextBounded(url)).slice(0, MAX_REMOTE_LIST_SIZE)
}

/**
 * Read a newline-separated list of source URLs, ignoring blanks and comments.
 *
 * Capped, and capped here rather than at the fetch: this is also what the
 * settings page counts when it says how many sources a field names, so a URL
 * past the cap is missing from the count as well as from the update.
 */
export function parseListUrls(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && /^https?:\/\//i.test(line))
    .slice(0, MAX_LIST_SOURCES)
}

export interface RemoteListResult {
  domains: string[]
  /** Sources that answered, and sources that did not */
  ok: number
  failed: number
}

/**
 * Fetch several lists and merge them into one deduplicated set.
 *
 * A source that fails is counted and skipped rather than failing the whole
 * update: one dead URL should not throw away the lists that did answer.
 */
export async function fetchRemoteDomainLists(urls: string[]): Promise<RemoteListResult> {
  const merged = new Set<string>()
  let ok = 0
  let failed = 0

  const results = await Promise.allSettled(urls.map(url => fetchRemoteDomainList(url)))

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      failed++
      continue
    }

    ok++
    for (const domain of result.value)
      merged.add(domain)
  }

  return { domains: [...merged].slice(0, MAX_REMOTE_LIST_SIZE), ok, failed }
}

// storage.local keys shared by all contexts
export const STORAGE_KEY_CUSTOM_PUBLIC = 'customPublicEmailProviders'
export const STORAGE_KEY_CUSTOM_DISPOSABLE = 'customDisposableEmailDomains'
export const STORAGE_KEY_CUSTOM_FORWARDING = 'customForwardingEmailDomains'
export const STORAGE_KEY_REMOTE_PUBLIC = 'remotePublicEmailProviders'
export const STORAGE_KEY_REMOTE_DISPOSABLE = 'remoteDisposableEmailDomains'

/**
 * Load all email domain lists from storage.local into the runtime sets.
 * Call once on startup in every context that classifies email domains.
 */
export async function loadEmailListsFromStorage(): Promise<void> {
  const stored = await browser.storage.local.get([
    STORAGE_KEY_CUSTOM_PUBLIC,
    STORAGE_KEY_CUSTOM_DISPOSABLE,
    STORAGE_KEY_CUSTOM_FORWARDING,
    STORAGE_KEY_REMOTE_PUBLIC,
    STORAGE_KEY_REMOTE_DISPOSABLE,
  ])
  loadCustomEmailLists(
    (stored[STORAGE_KEY_CUSTOM_PUBLIC] as string[]) || [],
    (stored[STORAGE_KEY_CUSTOM_DISPOSABLE] as string[]) || [],
    (stored[STORAGE_KEY_CUSTOM_FORWARDING] as string[]) || [],
  )
  // Applied even when empty. Storage is the source of truth for these layers, and
  // a list the user has just cleared has to leave the runtime set with it.
  const remotePublicStored = stored[STORAGE_KEY_REMOTE_PUBLIC] as { domains?: string[] } | undefined
  updatePublicList(remotePublicStored?.domains || [])

  const remote = stored[STORAGE_KEY_REMOTE_DISPOSABLE] as { domains?: string[] } | undefined
  updateDisposableList(remote?.domains || [])
}
