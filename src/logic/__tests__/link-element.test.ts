import { describe, expect, it } from 'vitest'
import { anchorLabels, findAnchorElement, findAnchorFromEvent, isLinkElement, linkHref, linkRect, linkTarget } from '../link-element'

const SVG = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'

function eventWithPath(path: EventTarget[]): Event {
  return { target: path[0], composedPath: () => path } as unknown as Event
}

function svgLink(attribute: 'href' | 'xlink:href', value: string) {
  const svg = document.createElementNS(SVG, 'svg')
  const link = document.createElementNS(SVG, 'a')
  if (attribute === 'href')
    link.setAttribute('href', value)
  else
    link.setAttributeNS(XLINK, 'xlink:href', value)
  const shape = document.createElementNS(SVG, 'rect')
  link.appendChild(shape)
  svg.appendChild(link)
  document.body.appendChild(svg)
  return { link, shape }
}

describe('what counts as a link', () => {
  it('finds a region of an image map', () => {
    const area = document.createElement('area')
    area.href = 'https://example.com/region'
    expect(findAnchorFromEvent(eventWithPath([area, document.body]))).toBe(area)
    expect(linkHref(area as any)).toBe('https://example.com/region')
  })

  // Its href is an object rather than a string, and it used to be skipped
  it('finds an SVG link written with href or the old xlink:href', () => {
    for (const attribute of ['href', 'xlink:href'] as const) {
      const { link, shape } = svgLink(attribute, '/landed')
      expect(findAnchorElement(shape)).toBe(link)
      expect(linkHref(link as any)).toBe(new URL('/landed', document.baseURI).href)
      link.closest('svg')!.remove()
    }
  })

  it('reads an SVG link\'s target as text', () => {
    const { link } = svgLink('href', 'https://example.com/')
    link.setAttribute('target', '_blank')
    expect(linkTarget(link as any)).toBe('_blank')
    link.closest('svg')!.remove()
  })

  it('leaves out links that go nowhere', () => {
    expect(isLinkElement(document.createElement('a'))).toBe(false)
    expect(isLinkElement(document.createElement('area'))).toBe(false)
    expect(isLinkElement(document.createElementNS(SVG, 'a'))).toBe(false)
    expect(isLinkElement(document.createElement('div'))).toBe(false)
  })

  it('reads a region\'s alt as its name', () => {
    const area = document.createElement('area')
    area.href = 'https://evil.test/'
    area.alt = 'paypal.com'
    expect(anchorLabels(area)).toEqual(['paypal.com'])
  })

  // A region has no box of its own, so a tooltip is placed on its picture
  it('places a region on the picture its map belongs to', () => {
    document.body.innerHTML = '<map name="m"><area id="r" href="https://example.com/"></map><img id="i" usemap="#m">'
    const image = document.getElementById('i')!
    const rect = { top: 5, bottom: 45, left: 10, right: 110, width: 100, height: 40, x: 10, y: 5, toJSON: () => ({}) } as DOMRect
    image.getBoundingClientRect = () => rect
    expect(linkRect(document.getElementById('r') as HTMLAreaElement)).toBe(rect)
    document.body.innerHTML = ''
  })
})
