/**
 * Official 325 `Yn` / `cd` / `no` — HTTP MCP response size cap (16 MiB body,
 * 64 MiB single SSE event) and Content-Encoding decompression guard.
 */

import type { FetchLike } from '@modelcontextprotocol/client'

export const HTTP_MCP_MAX_RESPONSE_BYTES = 16777216 // 16 MiB (hke)
export const HTTP_MCP_MAX_SSE_EVENT_BYTES = 4 * HTTP_MCP_MAX_RESPONSE_BYTES // 64 MiB (rd)

const SSE_CONTENT_TYPE_RE = /^\s*text\/event-stream\s*(?:;|$)/i
const SSE_MEMCHR_THRESHOLD = 32
const SUPPORTED_ENCODINGS = new Map<string, 'gzip' | 'deflate'>([
  ['gzip', 'gzip'],
  ['x-gzip', 'gzip'],
  ['deflate', 'deflate'],
])
const STOPPED_READING_SUFFIX = 'so Claude Code stopped reading it'

export class HttpBodyOverflowError extends Error {
  constructor(limitBytes: number, kind: 'body' | 'event') {
    const mb = Math.round(limitBytes / 1024 / 1024)
    const detail =
      kind === 'event'
        ? `sent more than ${mb}MB in one event of an event stream (no blank line ended it)`
        : `sent a response larger than ${mb}MB (counted after decompression)`
    super(`${detail}, ${STOPPED_READING_SUFFIX}.`)
    this.name = 'HttpBodyOverflowError'
  }
}

export function createResponseSizeLimitTransform(
  maxEventBytes: number,
  maxBodyBytes: number,
): TransformStream<Uint8Array, Uint8Array> {
  let totalBytes = 0
  let eventBytes = 0
  const skipEventCheck = maxBodyBytes <= maxEventBytes
  let lineLen = 0
  let sawCr = false
  let lastYield = performance.now()

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      if (performance.now() - lastYield > 8) {
        await new Promise(resolve => setImmediate(resolve))
        lastYield = performance.now()
      }
      totalBytes += chunk.length
      if (totalBytes > maxBodyBytes) {
        controller.error(new HttpBodyOverflowError(maxBodyBytes, 'body'))
        return
      }
      if (skipEventCheck) {
        controller.enqueue(chunk)
        return
      }
      let lastBlankEnd = -1
      const { length } = chunk
      let nextLf = -1
      let nextCr = -1
      for (let i = 0; i < length; i++) {
        const byte = chunk[i]!
        if (sawCr && byte === 10) {
          sawCr = false
          continue
        }
        sawCr = false
        if (byte === 10 || byte === 13) {
          if (lineLen === 0) lastBlankEnd = i
          lineLen = 0
          sawCr = byte === 13
          continue
        }
        lineLen++
        if (lineLen < SSE_MEMCHR_THRESHOLD) continue
        const searchFrom = i + 1
        if (nextLf < searchFrom) {
          nextLf = chunk.indexOf(10, searchFrom)
          if (nextLf === -1) nextLf = length
        }
        if (nextCr < searchFrom) {
          nextCr = chunk.indexOf(13, searchFrom)
          if (nextCr === -1) nextCr = length
        }
        const nextEol = Math.min(nextLf, nextCr)
        lineLen += nextEol - searchFrom
        i = nextEol - 1
      }
      eventBytes =
        lastBlankEnd >= 0 ? length - 1 - lastBlankEnd : eventBytes + length
      if (eventBytes > maxEventBytes) {
        controller.error(new HttpBodyOverflowError(maxEventBytes, 'event'))
        return
      }
      controller.enqueue(chunk)
    },
  })
}

export function wrapFetchWithResponseLimit(
  baseFetch: FetchLike,
  options: { refusesCodings?: boolean } = {},
): FetchLike {
  const refusesCodings = options.refusesCodings === true
  return async (input: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const canDecompress = typeof DecompressionStream !== 'undefined'
    const response = await baseFetch(input, {
      ...init,
      ...(canDecompress ? { decompress: false } : {}),
    } as RequestInit)

    if (!response.body || response.body.locked) {
      return response
    }

    const encodings = (response.headers.get('content-encoding') ?? '')
      .toLowerCase()
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '' && s !== 'identity')
    const primaryEncoding = encodings[0]
    const extraEncodings = encodings.slice(1)

    if (refusesCodings && primaryEncoding !== undefined) {
      await response.body.cancel().catch(() => {})
      throw new Error(
        'sent a response with a Content-Encoding. Claude Code reads none from a tool container, so it did not read the response.',
      )
    }

    const hasEncodedBody =
      canDecompress && response.headers.get('content-length') !== '0'
    if (
      hasEncodedBody &&
      (primaryEncoding === 'br' || primaryEncoding === 'zstd')
    ) {
      await response.body.cancel().catch(() => {})
      throw new Error(
        'sent a response compressed with br or zstd. Claude Code reads only gzip and deflate, so it did not read the response.',
      )
    }

    const decompressionAlg =
      hasEncodedBody &&
      primaryEncoding !== undefined &&
      extraEncodings.length === 0
        ? SUPPORTED_ENCODINGS.get(primaryEncoding)
        : undefined
    const decodedStream = decompressionAlg
      ? response.body.pipeThrough(
          new DecompressionStream(
            decompressionAlg,
          ) as unknown as TransformStream<Uint8Array, Uint8Array>,
        )
      : response.body

    const reqHeaders = new Headers(init?.headers)
    let maxBodyBytes = HTTP_MCP_MAX_RESPONSE_BYTES
    if (
      response.ok &&
      SSE_CONTENT_TYPE_RE.test(response.headers.get('content-type') ?? '') &&
      reqHeaders.get('accept')?.includes('text/event-stream')
    ) {
      maxBodyBytes =
        response.status === 200 &&
        (method === 'GET' ||
          reqHeaders.get('mcp-method') === 'subscriptions/listen')
          ? Infinity
          : HTTP_MCP_MAX_SSE_EVENT_BYTES
    }

    const limitedStream = decodedStream.pipeThrough(
      createResponseSizeLimitTransform(
        HTTP_MCP_MAX_RESPONSE_BYTES,
        maxBodyBytes,
      ),
    )

    const validStatus = response.status >= 200 && response.status <= 599
    const wrapped = new Response(limitedStream, {
      status: validStatus ? response.status : 200,
      statusText: response.statusText,
      headers: response.headers,
    })
    if (!validStatus) {
      Object.defineProperty(wrapped, 'status', { value: response.status })
      Object.defineProperty(wrapped, 'ok', { value: response.ok })
    }
    Object.defineProperty(wrapped, 'url', { value: response.url })
    Object.defineProperty(wrapped, 'redirected', { value: response.redirected })
    Object.defineProperty(wrapped, 'type', { value: response.type })
    return wrapped
  }
}
