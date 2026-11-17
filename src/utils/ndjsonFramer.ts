/**
 * Shared NDJSON (Newline-Delimited JSON) socket framing.
 *
 * Accumulates incoming data chunks, splits on newlines, and emits
 * parsed JSON objects. Used by both pipeTransport (UDS+TCP) and
 * udsMessaging to avoid duplicating the same buffer logic.
 */
import type { Socket } from 'net'
import { StringDecoder } from 'node:string_decoder'

export type NdjsonFramerOptions = {
  maxFrameBytes?: number
  /**
   * densable UDS recv BUt — JS string `.length` after UTF-8 decode (not bytes).
   * Gold peel idx 208212558: `c+=k` then `c.length>BUt` (BUt=1048576 chars).
   */
  maxFrameChars?: number
  onFrameError?: (error: Error) => void
  destroyOnFrameError?: boolean
  onInvalidFrame?: (error: Error) => void
  destroyOnInvalidFrame?: boolean
}

/**
 * Attach an NDJSON framer to a socket. Calls `onMessage` for each
 * complete JSON line received. Malformed lines are skipped by default;
 * callers may opt into error callbacks or socket destruction.
 *
 * @param parse - Optional custom JSON parser (defaults to JSON.parse).
 *                Useful when the caller uses a wrapped parser like jsonParse
 *                from slowOperations.
 */
export function attachNdjsonFramer<T = unknown>(
  socket: Socket,
  onMessage: (msg: T) => void,
  parse: (text: string) => T = text => JSON.parse(text) as T,
  options: NdjsonFramerOptions = {},
): void {
  let buffer = ''
  let bufferBytes = 0
  let discardUntilNewline = false
  const maxFrameBytes = options.maxFrameBytes ?? Number.POSITIVE_INFINITY
  const maxFrameChars = options.maxFrameChars ?? Number.POSITIVE_INFINITY
  const shouldDestroyOnFrameError = options.destroyOnFrameError ?? true
  // Holds partial multibyte sequences across chunk boundaries. Decoding each
  // chunk independently would turn any UTF-8 character split by the socket into
  // replacement characters. Newline (0x0a) never appears inside a multibyte
  // sequence, so scanning for it at the byte level stays safe.
  const decoder = new StringDecoder('utf8')

  const resetDecoderAndBuffer = (): void => {
    buffer = ''
    bufferBytes = 0
    decoder.end()
  }

  const rejectOversizedFrame = (bytes: number): void => {
    const error = new Error(
      `NDJSON frame exceeded ${maxFrameBytes} bytes (${bytes})`,
    )
    options.onFrameError?.(error)
    if (shouldDestroyOnFrameError) {
      socket.destroy(error)
    }
  }

  const rejectOversizedChars = (chars: number): void => {
    const error = new Error(
      `NDJSON frame exceeded ${maxFrameChars} chars (${chars})`,
    )
    options.onFrameError?.(error)
    if (shouldDestroyOnFrameError) {
      socket.destroy(error)
    }
  }

  const exceedsCharCap = (): boolean => {
    if (!Number.isFinite(maxFrameChars) || buffer.length <= maxFrameChars) {
      return false
    }
    rejectOversizedChars(buffer.length)
    resetDecoderAndBuffer()
    return true
  }

  const rejectInvalidFrame = (error: unknown): void => {
    const frameError =
      error instanceof Error ? error : new Error('Invalid NDJSON frame')
    options.onInvalidFrame?.(frameError)
    if (options.destroyOnInvalidFrame ?? false) {
      socket.destroy(frameError)
    }
  }

  const emitLine = (line: string): void => {
    if (!line.trim()) return
    try {
      onMessage(parse(line))
    } catch (error) {
      rejectInvalidFrame(error)
    }
  }

  socket.on('data', (chunk: Buffer) => {
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 0x0a) continue

      if (discardUntilNewline) {
        discardUntilNewline = false
        resetDecoderAndBuffer()
        start = index + 1
        continue
      }

      const segmentBytes = index - start
      if (
        Number.isFinite(maxFrameBytes) &&
        bufferBytes + segmentBytes > maxFrameBytes
      ) {
        rejectOversizedFrame(bufferBytes + segmentBytes)
        resetDecoderAndBuffer()
        if (shouldDestroyOnFrameError) return
        start = index + 1
        continue
      }

      buffer += decoder.write(chunk.subarray(start, index))
      if (exceedsCharCap()) {
        if (shouldDestroyOnFrameError) return
        start = index + 1
        continue
      }
      emitLine(buffer)
      buffer = ''
      bufferBytes = 0
      start = index + 1
    }

    if (discardUntilNewline) {
      return
    }

    const tailBytes = chunk.length - start
    if (
      Number.isFinite(maxFrameBytes) &&
      bufferBytes + tailBytes > maxFrameBytes
    ) {
      rejectOversizedFrame(bufferBytes + tailBytes)
      resetDecoderAndBuffer()
      discardUntilNewline = true
      return
    }

    if (tailBytes > 0) {
      buffer += decoder.write(chunk.subarray(start))
      bufferBytes += tailBytes
      if (exceedsCharCap()) {
        discardUntilNewline = true
        return
      }
    }
  })
}
