/**
 * densable 2.1.229 #20 — messages-only body > 32MB fail-once classification.
 *
 * densable symbols:
 * - `Y0r` / `aLb` — API request body limit (32 MiB, overridable)
 * - `fwp` — classify {unrecoverable | strippable_media | compactable}
 * - `hwp` / `ywp` / `gwp` / `xYo` / `_wp` — user-facing + errorDetails copy
 *
 * Unrecoverable means (bodyBytes - mediaBytes) > limit: stripping images/docs
 * cannot help, so compact/media-strip retries must not loop — fail once with
 * `request_body_over_limit:` details (does NOT match isMediaSizeError).
 *
 * **Scope (densable fwp 1:1):** `bodyBytes` / `mediaBytes` measure **message
 * contents only** (`JSON.stringify` of each message's `content`), not the full
 * HTTP request (tools / system / betas / metadata). Large tool schemas alone
 * can still 413 via the generic path; only messages-alone over limit is the
 * fail-once unrecoverable class.
 */

import { API_REQUEST_BODY_MAX_SIZE } from '../../constants/apiLimits.js'
import { formatFileSize } from '../../utils/format.js'

export type RequestBodySizeKind =
  | 'unrecoverable'
  | 'strippable_media'
  | 'compactable'

export type RequestBodySizeMeasure = {
  kind: RequestBodySizeKind
  bodyBytes: number
  mediaBytes: number
  limitBytes: number
}

/** densable dwp — image / document content blocks */
function isMediaContentBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false
  const t = (block as { type?: unknown }).type
  return t === 'image' || t === 'document'
}

/** densable Afa — UTF-8 byte length of JSON-serialized content */
export function contentUtf8Bytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return 0
  }
}

/** densable uLb — media bytes for one content block (incl. nested tool_result) */
function mediaBytesInBlock(block: unknown): number {
  if (!block || typeof block !== 'object') return 0
  const b = block as { type?: string; content?: unknown }
  if (isMediaContentBlock(b)) return contentUtf8Bytes(b)
  if (b.type === 'tool_result' && Array.isArray(b.content)) {
    return b.content.reduce(
      (sum: number, inner: unknown) =>
        isMediaContentBlock(inner) ? sum + contentUtf8Bytes(inner) : sum,
      0,
    )
  }
  return 0
}

/**
 * densable cLb — sum media bytes across user messages only
 * (assistant messages do not carry user-uploaded image/document bodies).
 */
export function measureMediaBytesInMessagesForAPI(
  messagesForAPI: ReadonlyArray<{ type?: string; message?: unknown }>,
): number {
  let total = 0
  for (const msg of messagesForAPI) {
    if (msg?.type !== 'user') continue
    const message = msg.message as { content?: unknown } | undefined
    const content = message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      total += mediaBytesInBlock(block)
    }
  }
  return total
}

/** densable body size: all message contents as JSON */
export function measureBodyBytesInMessagesForAPI(
  messagesForAPI: ReadonlyArray<{ type?: string; message?: unknown }>,
): number {
  return contentUtf8Bytes(
    messagesForAPI.map(m => {
      const message = m?.message as { content?: unknown } | undefined
      return message?.content
    }),
  )
}

/**
 * densable fwp — classify whether 413 can be recovered by stripping media.
 * unrecoverable: non-media body alone already exceeds limit.
 */
export function classifyRequestBodySize(
  messagesForAPI: ReadonlyArray<{ type?: string; message?: unknown }>,
  limitBytes: number = API_REQUEST_BODY_MAX_SIZE,
): RequestBodySizeMeasure {
  const mediaBytes = measureMediaBytesInMessagesForAPI(messagesForAPI)
  const bodyBytes = measureBodyBytesInMessagesForAPI(messagesForAPI)
  const kind: RequestBodySizeKind =
    bodyBytes - mediaBytes > limitBytes
      ? 'unrecoverable'
      : mediaBytes > 0
        ? 'strippable_media'
        : 'compactable'
  return { kind, bodyBytes, mediaBytes, limitBytes }
}

/** densable ALb — fwp with try/catch (returns undefined on measure failure) */
export function tryClassifyRequestBodySize(
  messagesForAPI: ReadonlyArray<{ type?: string; message?: unknown }>,
  limitBytes?: number,
): RequestBodySizeMeasure | undefined {
  try {
    return classifyRequestBodySize(messagesForAPI, limitBytes)
  } catch {
    return undefined
  }
}

/** densable kfa — sizes under 1KB */
export function formatSizeAtLeast1KB(bytes: number): string {
  if (bytes < 1024) return 'less than 1KB'
  return formatFileSize(bytes)
}

/** densable mwp — body size, with "(X over it)" when rounding collides with limit */
export function formatBodySizeWithOver(
  measure: Pick<RequestBodySizeMeasure, 'bodyBytes' | 'limitBytes'>,
): string {
  const bodyLabel = formatFileSize(measure.bodyBytes)
  const over = measure.bodyBytes - measure.limitBytes
  if (bodyLabel === formatFileSize(measure.limitBytes) && over > 0) {
    return `${bodyLabel} (${formatSizeAtLeast1KB(over)} over it)`
  }
  return bodyLabel
}

/**
 * densable hwp — unrecoverable clear message (messages alone > limit).
 */
export function formatUnrecoverableRequestTooLargeMessage(
  measure: RequestBodySizeMeasure,
  isNonInteractive: boolean,
): string {
  const limitLabel = formatFileSize(measure.limitBytes)
  const about = `this conversation is about ${formatBodySizeWithOver(measure)}`
  const mediaPart =
    measure.mediaBytes === 0
      ? 'none of it is images or documents that could be removed'
      : `only ${formatSizeAtLeast1KB(measure.mediaBytes)} of it is images or documents that could be removed`
  const base = `Request too large for the API's ${limitLabel} request limit: ${about}, and ${mediaPart}, so removing attachments or compacting cannot make it fit.`
  return isNonInteractive
    ? `${base} Reduce the input (large tool results or pasted content) or start a new session; this conversation cannot continue as is.`
    : `${base} Double press esc to go back past the large content, or /clear to start a new conversation.`
}

/** densable gwp — generic accumulated-media advice */
export function formatAccumulatedMediaAdvice(
  isNonInteractive: boolean,
): string {
  return isNonInteractive
    ? 'Accumulated images and attachments in the conversation pushed the request over the limit. Remove older images or compact the conversation.'
    : 'Accumulated images and attachments in the conversation pushed the request over the limit. Run /compact, or double press esc to go back and remove attachments.'
}

/** densable xYo — generic X8i content (no measure) */
export function formatGenericRequestTooLargeMessage(
  isNonInteractive: boolean,
  limitBytes: number = API_REQUEST_BODY_MAX_SIZE,
): string {
  return `Request too large (max ${formatFileSize(limitBytes)}). ${formatAccumulatedMediaAdvice(isNonInteractive)}`
}

/** densable ywp — strippable media detail + gwp */
export function formatStrippableMediaRequestTooLargeMessage(
  measure: RequestBodySizeMeasure,
  isNonInteractive: boolean,
): string {
  const limitLabel = formatFileSize(measure.limitBytes)
  const mediaPart = `${formatSizeAtLeast1KB(measure.mediaBytes)} of about ${formatBodySizeWithOver(measure)} is images or documents`
  return `Request too large (max ${limitLabel}; ${mediaPart}). ${formatAccumulatedMediaAdvice(isNonInteractive)}`
}

/**
 * densable `_wp` — errorDetails for unrecoverable path.
 * Intentionally NOT `request_too_large:` so isMediaSizeError / reactive strip
 * does not treat this as strip-and-retry.
 */
export function formatUnrecoverableRequestBodyErrorDetails(
  measure: RequestBodySizeMeasure,
): string {
  return `request_body_over_limit: body=${measure.bodyBytes}B (messages only) media=${measure.mediaBytes}B limit=${measure.limitBytes}B`
}
