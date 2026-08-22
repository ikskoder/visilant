import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTextBounded, MAX_LIST_SOURCES, ResponseTooLargeError } from '../bounded-fetch'
import { parseListUrls } from '../email-providers'

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(chunk)
      controller.close()
    },
  })
}

function respond(body: BodyInit | null, init: ResponseInit = {}) {
  const response = new Response(body, { status: 200, ...init })
  vi.stubGlobal('fetch', vi.fn(async () => response))
  return response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchTextBounded', () => {
  it('returns the body as text', async () => {
    respond('one.test\ntwo.test\n')
    await expect(fetchTextBounded('https://list.test/a')).resolves.toBe('one.test\ntwo.test\n')
  })

  it('throws on an HTTP error', async () => {
    respond('nope', { status: 404 })
    await expect(fetchTextBounded('https://list.test/a')).rejects.toThrow('HTTP 404')
  })

  it('refuses a content type it was not asked for, before reading the body', async () => {
    respond('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
    await expect(fetchTextBounded('https://list.test/a', { accept: type => type === 'text/plain' }))
      .rejects
      .toThrow('Unexpected content type')
  })

  it('takes an honest content-length as a reason not to download at all', async () => {
    respond('short', { headers: { 'content-length': '900000' } })
    await expect(fetchTextBounded('https://list.test/a', { maxBytes: 1000 }))
      .rejects
      .toThrow(ResponseTooLargeError)
  })

  // The case the header cannot cover: a source that understates its size, or
  // names none at all, is stopped by the reader rather than after the fact
  it('stops mid-stream when the body outgrows the cap', async () => {
    const chunk = new Uint8Array(400)
    respond(streamOf([chunk, chunk, chunk, chunk]))
    await expect(fetchTextBounded('https://list.test/a', { maxBytes: 1000 }))
      .rejects
      .toThrow(ResponseTooLargeError)
  })

  it('accepts a body that fits exactly', async () => {
    respond(streamOf([new Uint8Array(500), new Uint8Array(500)]))
    await expect(fetchTextBounded('https://list.test/a', { maxBytes: 1000 })).resolves.toHaveLength(1000)
  })
})

describe('parseListUrls', () => {
  it('keeps the http(s) lines and drops blanks and comments', () => {
    expect(parseListUrls('  https://a.test/l \n\n# a note\nnot-a-url\nhttp://b.test/l')).toEqual([
      'https://a.test/l',
      'http://b.test/l',
    ])
  })

  it('caps how many sources one field names', () => {
    const many = Array.from({ length: MAX_LIST_SOURCES + 5 }, (_, i) => `https://s${i}.test/l`).join('\n')
    expect(parseListUrls(many)).toHaveLength(MAX_LIST_SOURCES)
  })
})
