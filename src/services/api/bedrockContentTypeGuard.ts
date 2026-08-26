/**
 * densable 2.1.239 #7 — Bedrock invoke-with-response-stream content-type.
 *
 * Official (fetch wrap after response):
 *   h = provider==="bedrock" && ok && url includes /invoke-with-response-stream
 *   if h && body && !content-type && !DISABLE_BEDROCK_CONTENT_TYPE_DEFAULT
 *     rewrap + set content-type to application/vnd.amazon.eventstream
 *   if h && content-type && !includes vnd.amazon.eventstream && !DISABLE_GUARD
 *     cancel body + throw BedrockUnexpectedContentTypeError
 *
 * Missing Content-Type (proxy strip) must be treated as eventstream so the
 * client does not fall back to a second non-stream request (double bill).
 * A transformed (non-eventstream) type fails immediately and is not retried.
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  type BodyIdleFetch,
  rewrapResponseWithBody,
} from '../../utils/bodyIdleWatchdog.js'

export const BEDROCK_EVENTSTREAM_CONTENT_TYPE =
  'application/vnd.amazon.eventstream'

export class BedrockUnexpectedContentTypeError extends Error {
  readonly code = 'BedrockUnexpectedContentType'
  readonly contentType: string
  constructor(contentType: string) {
    super(
      `Bedrock streaming response has content-type ${JSON.stringify(contentType)}; expected "application/vnd.amazon.eventstream". A gateway or proxy between Claude Code and Bedrock is likely transforming the response body — Bedrock's binary event-stream format must be passed through unmodified. Set CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_GUARD=1 to suppress this check while the gateway is being fixed.`,
    )
    this.name = 'BedrockUnexpectedContentTypeError'
    this.contentType = contentType
  }
}

export function isBedrockInvokeWithResponseStreamUrl(url: string): boolean {
  return url.includes('/invoke-with-response-stream')
}

export function applyBedrockStreamingContentType(
  response: Response,
  url: string,
  provider: string,
): Response {
  const isBedrockStream =
    provider === 'bedrock' &&
    response.ok &&
    isBedrockInvokeWithResponseStreamUrl(url)
  if (!isBedrockStream) {
    return response
  }

  let next = response
  if (
    next.body &&
    !next.headers.get('content-type') &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_DEFAULT)
  ) {
    next = rewrapResponseWithBody(next, next.body)
    next.headers.set('content-type', BEDROCK_EVENTSTREAM_CONTENT_TYPE)
  }

  const contentType = next.headers.get('content-type')
  const lower = contentType?.toLowerCase()
  if (
    contentType &&
    !lower?.includes('vnd.amazon.eventstream') &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_GUARD)
  ) {
    void next.body?.cancel().catch(() => {})
    throw new BedrockUnexpectedContentTypeError(contentType)
  }
  return next
}

export function wrapFetchWithBedrockContentTypeGuard(
  baseFetch: BodyIdleFetch,
  getProvider: () => string,
): BodyIdleFetch {
  return async (input, init) => {
    const response = await baseFetch(input, init)
    let url = ''
    try {
      url = input instanceof Request ? input.url : String(input)
    } catch {
      // never let URL parse crash the fetch
    }
    return applyBedrockStreamingContentType(response, url, getProvider())
  }
}
