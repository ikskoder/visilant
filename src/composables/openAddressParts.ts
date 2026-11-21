/**
 * The cards that read an address part by part (`AddressParts`) open right now,
 * each by what closes it.
 *
 * Esc closes the card before anything else: the dialogs listen for it on the
 * window in the capture phase and closed the whole dialog over an open card,
 * and the content script took the tooltip away with it. Each of those asks
 * here first and stops when a card was closed.
 */
const closers = new Set<() => void>()

export function trackOpenAddressParts(close: () => void): () => void {
  closers.add(close)
  return () => closers.delete(close)
}

/** Close every open card. True when there was one to close. */
export function closeOpenAddressParts(): boolean {
  if (!closers.size)
    return false
  for (const close of [...closers])
    close()
  return true
}
