/**
 * What the check page is opened with, handed over out of sight.
 *
 * The page used to get it in its own address, `?check=1&value=mailto:...`.
 * That address stays in the browser's history, so a mail link somebody only
 * asked about was kept there whole, the names of everybody it writes to and
 * the message it starts included. A link clicked in a page is not kept at
 * all. The value is put in `storage.session` instead, which is gone when the
 * browser closes, and the page's address holds a key that says nothing.
 *
 * Not removed once read: the page asks again when it is reloaded, and would
 * otherwise come back empty. The last few are kept and the older ones go, so
 * a long session does not fill the store the tampering alarm also lives in.
 */

const PREFIX = 'checkHandoff:'
const INDEX = 'checkHandoffIndex'

/** Longer than any link somebody would ask about, and far inside what the store takes */
const MAX_VALUE = 64 * 1024
/** How many check pages opened this way can still be reloaded */
const KEPT = 20

/** Keep a value for the check page. Returns the query of the page's address. */
export async function putCheckHandoff(value: string): Promise<string> {
  // Whole characters: a cut through the middle of one cannot be encoded
  const kept = Array.from(value.slice(0, MAX_VALUE)).filter(char => char.length > 1 || !/[\uD800-\uDFFF]/.test(char)).join('')
  const inAddress = `check=1&value=${encodeURIComponent(kept)}`
  const session = browser.storage.session
  // A browser older than the store: in the address, as it used to be
  if (!session)
    return inAddress
  try {
    const id = crypto.randomUUID()
    const stored = await session.get(INDEX)
    const ids = Array.isArray(stored?.[INDEX]) ? (stored[INDEX] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : []
    ids.push(id)
    const old = ids.splice(0, Math.max(0, ids.length - KEPT))
    await session.set({ [`${PREFIX}${id}`]: kept, [INDEX]: ids })
    // The value is in by now. Old ones that will not go are not a reason to
    // put this one in the address after all
    if (old.length)
      await session.remove(old.map(entry => `${PREFIX}${entry}`)).catch(() => {})
    return `check=1&handoff=${id}`
  }
  catch {
    // A store that is full or refused: the check somebody asked for still
    // has to open
    return inAddress
  }
}

/** What the check page was opened with, by its address. Empty when there is nothing. */
export async function readCheckHandoff(params: URLSearchParams): Promise<string> {
  const id = params.get('handoff')
  if (!id)
    return params.get('value') ?? ''
  try {
    const key = `${PREFIX}${id}`
    const stored = await browser.storage.session?.get(key)
    return typeof stored?.[key] === 'string' ? stored[key] as string : ''
  }
  catch {
    return ''
  }
}
