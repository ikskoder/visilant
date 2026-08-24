/**
 * Holding a paste back on an unfamiliar site until the user has looked at where
 * they are.
 *
 * Typing cannot be held this way, because keystrokes cannot be buffered across an
 * async dialog without wrecking the page. A paste can: the whole payload arrives
 * in one cancelable event, so it can be stopped and described before it lands.
 *
 * Nothing here ever inserts text. Confirming lifts the block and the user pastes
 * again themselves, which keeps the real paste real: formatting, images, undo and
 * the page's own paste handling all behave exactly as they always would.
 */

/** What is on the clipboard, described without putting it on screen. */
export interface PastePayloadInfo {
  length: number
  lines: number
  /** Rough shape, so the dialog can say something true about the payload. */
  kind: 'url' | 'email' | 'digits' | 'text'
  /** Shown only if the user asks for it, and never in full. */
  preview: string
}

/** How much of the payload the reveal button is willing to show. */
const PREVIEW_LIMIT = 300
/** Shortest run of digits that reads as a card number, a code or an account. */
const DIGITS_MIN = 6

export function describePastePayload(text: string): PastePayloadInfo {
  const trimmed = text.trim()
  const digitsOnly = trimmed.replace(/[\s-]/g, '')

  let kind: PastePayloadInfo['kind'] = 'text'
  if (/^https?:\/\/\S+$/i.test(trimmed))
    kind = 'url'
  // Dots excluded from the label classes on purpose: letting them match there too
  // makes the label and the separator interchangeable, which backtracks badly
  else if (/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(trimmed))
    kind = 'email'
  else if (digitsOnly.length >= DIGITS_MIN && /^\d+$/.test(digitsOnly))
    kind = 'digits'

  return {
    length: text.length,
    lines: text ? text.split('\n').length : 0,
    kind,
    preview: text.slice(0, PREVIEW_LIMIT),
  }
}

/**
 * Should this paste be held for confirmation?
 *
 * Deliberately narrow. A site the user has marked as ignored is their decision,
 * a paste into something that is not an editable field cannot leak a password,
 * and an empty payload has nothing to protect.
 */
export function shouldInterceptPaste(options: {
  enabled: boolean
  /** null while the check is still in flight, false when the site is unfamiliar. */
  siteIsSafe: boolean | null
  ignored: boolean
  hasText: boolean
  targetIsEditable: boolean
  /** The user has already confirmed a paste on this page. */
  alreadyAllowed: boolean
}): boolean {
  return options.enabled
    && !options.alreadyAllowed
    && options.siteIsSafe === false
    && !options.ignored
    && options.hasText
    && options.targetIsEditable
}

/**
 * Should this paste be held because there is no verdict yet?
 *
 * The verdict for a page arrives a moment after the page does, and a paste made
 * in that moment used to go straight through: the guard asked for a strict
 * `false` and got `null`. That is the opposite of what the setting says – it was
 * switched on precisely to stop a secret going into a site the user has not
 * looked at, and the seconds right after a page opens are when that happens.
 *
 * Holding costs a cancelled paste on a site that turns out to be familiar. The
 * dialog says so and the user pastes again, which is the same thing they already
 * do after confirming – nothing here ever inserts text.
 */
export function shouldHoldPasteUndecided(options: {
  enabled: boolean
  /** Whether the page has been judged at all – either verdict counts. */
  verdictKnown: boolean
  ignored: boolean
  hasText: boolean
  targetIsEditable: boolean
  alreadyAllowed: boolean
}): boolean {
  return options.enabled
    && !options.verdictKnown
    && !options.alreadyAllowed
    && !options.ignored
    && options.hasText
    && options.targetIsEditable
}

/** Can text be typed into this element at all? */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || element.nodeType !== 1)
    return false

  const tag = element.tagName
  if (tag === 'TEXTAREA')
    return true
  if (tag === 'INPUT') {
    const input = element as HTMLInputElement
    // Buttons, checkboxes and the like report a value but take no typed text
    return !input.readOnly && !input.disabled && !/^(?:button|checkbox|radio|submit|reset|file|image|range|color)$/i.test(input.type)
  }

  // Coerced rather than returned as it comes: an element type the engine has no
  // opinion about answers `undefined` here, and a function whose type says
  // boolean should not hand one out
  return Boolean(element.isContentEditable)
}

/**
 * The same question asked of an event rather than of its target.
 *
 * A field inside a custom element's shadow root retargets: `event.target` is the
 * host element, which is not editable and has no value, so the paste guard saw
 * an ordinary click target and let the paste through. `composedPath()` is the
 * list of nodes the event really passed through, and the field is in it.
 *
 * A closed shadow root is not in that list. Nothing a content script can do
 * reaches inside one, which is a limitation rather than an oversight.
 */
export function isEditableEventTarget(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (isEditableTarget(node))
      return true
  }

  return isEditableTarget(event.target)
}

/**
 * Whether a paste lands somewhere that takes the text.
 *
 * The same question as above with one more answer allowed, and only pastes ask
 * it. A field inside a *closed* shadow root is in no `composedPath()` and no
 * content script can reach it: what is left at the end of the path is the host,
 * which has no value and is not editable, so the guard saw an ordinary element
 * and let the paste through. A custom element - the tag with a hyphen in it,
 * which is what a component with a closed root is - is taken at its word here.
 *
 * A trusted paste event is itself most of the evidence: it means somebody hit
 * paste while that element had the focus. Keystrokes cannot be read the same
 * way, because a site's single-key shortcuts land on whatever has the focus and
 * warning about those turned the whole feature into noise.
 */
export function isPasteSink(event: Event): boolean {
  if (isEditableEventTarget(event))
    return true

  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  const deepest = (path[0] ?? event.target) as Element | null
  if (!deepest || deepest.nodeType !== 1)
    return false

  // `shadowRoot` is null for a closed root and for no root at all. An open one
  // would have put its field in the path above, so anything still here either
  // hides its root or has none, and only the first of those is worth guarding.
  return deepest.tagName.includes('-') && deepest.shadowRoot === null
}

/** The element an event was actually typed into, shadow roots included. */
export function editableTargetOf(event: Event): HTMLElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (isEditableTarget(node))
      return node as HTMLElement
  }

  return isEditableTarget(event.target) ? event.target as HTMLElement : null
}
