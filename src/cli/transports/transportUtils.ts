import { URL } from 'url'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { HybridTransport } from './HybridTransport.js'
import { SSETransport } from './SSETransport.js'
import type { Transport } from './Transport.js'
import { WebSocketTransport } from './WebSocketTransport.js'

/**
 * Helper function to get the appropriate transport for a URL.
 *
 * Transport selection priority:
 * 1. SSETransport (SSE reads + POST writes) when CLAUDE_CODE_USE_CCR_V2 is set
 * 2. HybridTransport (WS reads + POST writes) when CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2 is set
 * 3. WebSocketTransport (WS reads + WS writes) — default
 */
export function getTransportForUrl(
  url: URL,
  headers: Record<string, string> = {},
  sessionId?: string,
  refreshHeaders?: () => Record<string, string>,
): Transport {
  // Official USE_CCR_V2 densable.
  let useCcrV2 = isEnvTruthy(process.env.CLAUDE_CODE_USE_CCR_V2)
  try {
    const { isCcrV2EnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    useCcrV2 = isCcrV2EnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (useCcrV2) {
    // v2: SSE for reads, HTTP POST for writes
    // --sdk-url is the session URL (.../sessions/{id});
    // derive the SSE stream URL by appending /worker/events/stream
    const sseUrl = new URL(url.href)
    if (sseUrl.protocol === 'wss:') {
      sseUrl.protocol = 'https:'
    } else if (sseUrl.protocol === 'ws:') {
      sseUrl.protocol = 'http:'
    }
    sseUrl.pathname =
      sseUrl.pathname.replace(/\/$/, '') + '/worker/events/stream'
    return new SSETransport(sseUrl, headers, sessionId, refreshHeaders)
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    // Official POST_FOR_SESSION_INGRESS_V2 densable.
    let postForSessionIngressV2 = isEnvTruthy(
      process.env.CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2,
    )
    try {
      const { isPostForSessionIngressV2Enabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
      postForSessionIngressV2 = isPostForSessionIngressV2Enabled()
    } catch {
      // keep raw env fallback
    }
    if (postForSessionIngressV2) {
      return new HybridTransport(url, headers, sessionId, refreshHeaders)
    }
    return new WebSocketTransport(url, headers, sessionId, refreshHeaders)
  } else {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
  }
}
