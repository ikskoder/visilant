// Classification of email domains: well-known public providers (anyone can
// register an address – domain reputation says nothing about the sender) and
// disposable/temp-mail services (almost always spam or scam in real mail).
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
33mail.com
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

export type EmailProviderKind = 'public' | 'disposable' | 'regular'

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
let remotePublic: string[] = []
let remoteDisposable: string[] = []
let publicSet = new Set<string>(parseEmailDomainList(BUILTIN_PUBLIC_PROVIDERS))
let disposableSet = new Set<string>(parseEmailDomainList(BUILTIN_DISPOSABLE_DOMAINS))

function rebuildSets() {
  publicSet = new Set<string>([...parseEmailDomainList(BUILTIN_PUBLIC_PROVIDERS), ...customPublic, ...remotePublic])
  disposableSet = new Set<string>([...parseEmailDomainList(BUILTIN_DISPOSABLE_DOMAINS), ...customDisposable, ...remoteDisposable])
}

/**
 * Load user-defined lists (called on startup from storage.local).
 */
export function loadCustomEmailLists(publicDomains: string[], disposableDomains: string[]): void {
  customPublic = publicDomains.map(d => d.trim().toLowerCase()).filter(d => d.length > 0)
  customDisposable = disposableDomains.map(d => d.trim().toLowerCase()).filter(d => d.length > 0)
  rebuildSets()
}

/**
 * Load a remotely fetched disposable-domain list (merged, built-ins never lost).
 */
export function updateDisposableList(remoteDomains: string[]): void {
  remoteDisposable = remoteDomains.map(d => d.trim().toLowerCase()).filter(d => d.length > 0)
  rebuildSets()
}

/**
 * Load a remotely fetched list of public providers (merged, built-ins kept).
 *
 * Held in its own slice rather than written straight into the set, so a later
 * rebuild – adding a custom domain, say – cannot silently throw it away.
 */
export function updatePublicList(remoteDomains: string[]): void {
  remotePublic = remoteDomains.map(d => d.trim().toLowerCase()).filter(d => d.length > 0)
  rebuildSets()
}

export function getDisposableCount(): number {
  return disposableSet.size
}

export function getPublicCount(): number {
  return publicSet.size
}

function matchesSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain))
    return true
  for (const d of set) {
    if (domain.endsWith(`.${d}`))
      return true
  }
  return false
}

/**
 * Classify an email domain. Disposable wins over public: some temp-mail
 * services hide behind provider-looking names.
 */
export function classifyEmailDomain(domain: string): EmailProviderKind {
  const lower = domain.trim().toLowerCase()
  if (matchesSet(lower, disposableSet))
    return 'disposable'
  if (matchesSet(lower, publicSet))
    return 'public'
  return 'regular'
}

const MAX_REMOTE_LIST_SIZE = 100_000

/**
 * Fetch a newline-separated domain list (lines starting with # are comments).
 * Returns the parsed domains. Throws on network/HTTP errors.
 */
export async function fetchRemoteDomainList(url: string): Promise<string[]> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to fetch list: ${response.status}`)
  const text = await response.text()
  return parseEmailDomainList(text).slice(0, MAX_REMOTE_LIST_SIZE)
}

/** Read a newline-separated list of source URLs, ignoring blanks and comments. */
export function parseListUrls(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && /^https?:\/\//i.test(line))
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
    STORAGE_KEY_REMOTE_PUBLIC,
    STORAGE_KEY_REMOTE_DISPOSABLE,
  ])
  loadCustomEmailLists(
    (stored[STORAGE_KEY_CUSTOM_PUBLIC] as string[]) || [],
    (stored[STORAGE_KEY_CUSTOM_DISPOSABLE] as string[]) || [],
  )
  const remotePublicStored = stored[STORAGE_KEY_REMOTE_PUBLIC] as { domains?: string[] } | undefined
  if (remotePublicStored?.domains?.length)
    updatePublicList(remotePublicStored.domains)

  const remote = stored[STORAGE_KEY_REMOTE_DISPOSABLE] as { domains?: string[] } | undefined
  if (remote?.domains?.length)
    updateDisposableList(remote.domains)
}
