/**
 * Fetching with a ceiling on everything a remote source controls.
 *
 * Each of these lists is fetched from a URL the user typed, and the extension
 * has host permissions for every site – so the source decides how long the
 * request hangs and how many bytes come back. A source that never answers used
 * to leave the settings page saying "updating" forever, and a source answering
 * with a gigabyte used to be read into memory whole before the first line was
 * counted. Neither is an attack anyone can start on the user's behalf, but a URL
 * can be mistyped and a maintained list can change hands.
 *
 * So: a deadline, a byte cap enforced while reading rather than after, and a cap
 * on how many sources one field can name.
 */

/** How long any one source has to answer in full. */
export const FETCH_TIMEOUT_MS = 15_000

/** Ceiling on one downloaded list. The largest lists in the wild are a few MB. */
export const MAX_LIST_BYTES = 8 * 1024 * 1024

/** How many URLs one source field is read as. Beyond this they are not fetched. */
export const MAX_LIST_SOURCES = 10

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`Response exceeds ${limit} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

interface BoundedOptions {
  timeoutMs?: number
  maxBytes?: number
  /** Rejects a response whose content type is not wanted, before any of it is read. */
  accept?: (contentType: string) => boolean
}

async function boundedResponse(url: string, options: BoundedOptions): Promise<{ response: Response, maxBytes: number }> {
  const maxBytes = options.maxBytes ?? MAX_LIST_BYTES
  const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS) })
  if (!response.ok)
    throw new Error(`HTTP ${response.status}`)

  if (options.accept && !options.accept((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()))
    throw new Error('Unexpected content type')

  // Only a hint, and a lying one on a hostile source – so it saves the download
  // when it is honest, and the reader below is what actually holds the line
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new ResponseTooLargeError(maxBytes)

  return { response, maxBytes }
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body
  if (!body) {
    // No streaming here – nothing to do but read it and check afterwards
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes)
      throw new ResponseTooLargeError(maxBytes)
    return buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      if (!value)
        continue
      total += value.byteLength
      if (total > maxBytes)
        throw new ResponseTooLargeError(maxBytes)
      chunks.push(value)
    }
  }
  finally {
    // Stops the transfer rather than leaving it running for a body we abandoned
    await reader.cancel().catch(() => {})
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/** Fetch text, giving up on the deadline or the byte cap, whichever comes first. */
export async function fetchTextBounded(url: string, options: BoundedOptions = {}): Promise<string> {
  const { response, maxBytes } = await boundedResponse(url, options)
  return new TextDecoder().decode(await readBounded(response, maxBytes))
}

/** Fetch bytes under the same limits, for the things that are not text. */
export async function fetchBlobBounded(url: string, options: BoundedOptions = {}): Promise<Blob> {
  const { response, maxBytes } = await boundedResponse(url, options)
  const bytes = await readBounded(response, maxBytes)
  return new Blob([bytes as BlobPart], { type: response.headers.get('content-type') || '' })
}
