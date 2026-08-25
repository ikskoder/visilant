import { getPunycodeInfo } from './link-safety'
import { settings } from './storage'

/**
 * The spelling of a name to draw, following `settings.punycodeListMode`.
 *
 * An international name has two of them, and which one is worth reading depends
 * on what the reader is doing. `рaypal.com` is what the address bar will show,
 * `xn--aypal-2ve.com` is the one that says out loud it is not the name it looks
 * like. The toggle in the header picks between them for the lists of names,
 * where there is one line per site and no room to print both.
 *
 * A name with nothing international about it has one spelling and comes back
 * untouched, so the toggle is a no-op there rather than a redraw.
 *
 * Not for a name under examination. The check card and the domain card both
 * print an international name in full, ascii first, because the reader is there
 * to see that the two spellings differ – choosing one of them for those would
 * hide the thing being checked.
 */
export function displayDomain(hostname: string): string {
  const info = getPunycodeInfo(hostname)
  if (!info.hasUnicode)
    return hostname

  const wanted = settings.value.punycodeListMode === 'ascii' ? info.ascii : info.unicode
  return wanted || hostname
}
