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

  return element.isContentEditable
}
