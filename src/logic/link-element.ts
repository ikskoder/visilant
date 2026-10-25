/**
 * What counts as a link on a page, and how to read one.
 *
 * Three elements navigate when they are clicked: `<a href>`, `<area href>`
 * inside an image map, and SVG's own `<a>`. Only the first used to be found, so
 * a link drawn as a region of a picture or inside an SVG went past every check.
 * The SVG one also answers differently: its `href` and `target` are
 * `SVGAnimatedString` objects rather than strings, so code written for an
 * `HTMLAnchorElement` either skipped it or threw.
 *
 * Kept free of everything but the DOM: no domain lists and no Vue, so the
 * frame guard can use it without growing.
 */

export type LinkElement = HTMLAnchorElement | HTMLAreaElement | SVGAElement

const SVG = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'

/**
 * Told by name and namespace rather than by class. The attributes are read
 * rather than the animated properties, which is what those hold unless a
 * script animates them, and it reads the same in a DOM with no SVG classes.
 */
function isSvgLink(node: Element): node is SVGAElement {
  return node.namespaceURI === SVG && node.localName === 'a'
}

function svgHref(link: Element): string {
  return link.getAttribute('href') ?? link.getAttributeNS(XLINK, 'href') ?? ''
}

/**
 * Whether this element is a link that goes somewhere.
 *
 * An SVG `<a>` written with the old `xlink:href` matches no attribute selector
 * without a namespace, so it is asked for by name.
 */
export function isLinkElement(node: unknown): node is LinkElement {
  if (!(node instanceof Element))
    return false
  if (isSvgLink(node))
    return node.hasAttribute('href') || node.hasAttributeNS(XLINK, 'href')
  return (node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) && node.hasAttribute('href')
}

/**
 * Find the link behind an event.
 *
 * Takes the event rather than its target on purpose. A link inside a custom
 * element's shadow root retargets: `event.target` is the element that owns the
 * shadow root, not the anchor inside it, and `closest('a')` from there finds
 * nothing at all. `composedPath()` is the list of nodes the event actually
 * travelled through, shadow boundaries included, so the anchor is in it.
 *
 * A click on an image map region arrives with the `<area>` in the path, not the
 * picture, so the same walk finds that too.
 *
 * A closed shadow root does not appear in the path, and there is nothing to be
 * done about that from a content script. It is a limitation, not an oversight.
 */
export function findAnchorFromEvent(event: Event): LinkElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (isLinkElement(node))
      return node
  }

  return findAnchorElement(event.target)
}

/**
 * Find the closest link from an event target.
 *
 * The fallback for a caller with no event to hand. Prefer `findAnchorFromEvent`,
 * which also sees through an open shadow root.
 */
export function findAnchorElement(target: EventTarget | null): LinkElement | null {
  let node = target instanceof Element ? target : null
  while (node) {
    if (isLinkElement(node))
      return node
    node = node.parentElement
  }
  return null
}

/** The address a link leads to, resolved the way the browser would, or `''`. */
export function linkHref(link: LinkElement): string {
  if (!isSvgLink(link))
    return link.href
  const raw = svgHref(link).trim()
  if (!raw)
    return ''
  try {
    return new URL(raw, link.baseURI).href
  }
  catch {
    return ''
  }
}

/** The browsing context a link names, `''` when it names none. */
export function linkTarget(link: LinkElement): string {
  return isSvgLink(link) ? (link.getAttribute('target') ?? '') : link.target
}

/** The link's `rel`, which an SVG link may not have at all. */
export function linkRel(link: LinkElement): string {
  return isSvgLink(link) ? (link.getAttribute('rel') ?? '') : link.rel
}

/**
 * Where a link is on screen.
 *
 * An `<area>` has no box of its own, so it is placed on the picture whose map
 * it belongs to. The whole picture rather than the region, which is near enough
 * to put a tooltip beside it.
 */
export function linkRect(link: LinkElement): DOMRect {
  if (link instanceof HTMLAreaElement) {
    // A picture names its map by the map's name, or by its id
    const map = link.closest('map')
    const names = [map?.getAttribute('name'), map?.id].filter(Boolean).map(name => `#${name}`)
    // In the same tree as the map, which may be a shadow root
    const tree = link.getRootNode() as Document | ShadowRoot
    for (const image of Array.from(tree.querySelectorAll('img[usemap], input[usemap], object[usemap]'))) {
      if (names.includes(image.getAttribute('usemap') ?? ''))
        return image.getBoundingClientRect()
    }
  }
  return link.getBoundingClientRect()
}

/**
 * What a link says it points at, to somebody looking at the page.
 *
 * Its text where it has any. A link whose whole content is an image has none,
 * and the name on that image is in its `alt` – which is where a button reading
 * `paypal.com` sits when the check only ever read text. `aria-label` and
 * `title` come last for the same reason: both are what the link is announced
 * as, and neither was looked at either.
 */
export function anchorLabel(anchor: Element | null): string {
  return anchorLabels(anchor)[0] ?? ''
}

/**
 * Every name this link goes by, most likely first.
 *
 * A link has more than one, and picking a single one always picks wrong for
 * somebody. `aria-label` is what a screen reader announces and it overrides the
 * text for that reader, while the text is what everybody else sees - so
 * `<a aria-label="paypal.com">Click here</a>` and `<a href="evil">paypal.com</a>`
 * are the same trick told to two different audiences. Both are read, and a name
 * that disagrees with the destination is a mismatch whichever of them it was.
 *
 * An `<area>` has no text at all, and its `alt` is the name a screen reader
 * gives the region.
 */
export function anchorLabels(anchor: Element | null): string[] {
  if (!anchor)
    return []

  // The text first, because that is the name on screen and the one every other
  // surface shows. The rest are read too, but none of them displaces it.
  const names = [
    (anchor.textContent || '').trim(),
    ...(anchor instanceof HTMLAreaElement ? [(anchor.getAttribute('alt') || '').trim()] : []),
    ...Array.from(anchor.querySelectorAll('img')).map(image => (image.getAttribute('alt') || '').trim()),
    (anchor.getAttribute('aria-label') || '').trim(),
    (anchor.getAttribute('title') || '').trim(),
  ]

  return [...new Set(names.filter(Boolean))]
}

/**
 * A hostname without its leading `www.`, as far as telling two names apart goes.
 *
 * The background keeps `www.X` and `X` as one record (`visitKey`), and a link
 * from one to the other is a link within the site. The suffix list `visitKey`
 * uses is too big for a content script, and it is not needed here: both names
 * being compared are real addresses a browser has opened or is about to, so the
 * only case the list guards against – a bare suffix like `co.uk` – cannot come
 * up. The prefix stays when nothing with a dot would be left, so `www.com` is
 * still not `com`.
 */
export function withoutWww(hostname: string): string {
  let name = hostname.toLowerCase()
  while (name.startsWith('www.') && name.slice(4).includes('.'))
    name = name.slice(4)
  return name
}
