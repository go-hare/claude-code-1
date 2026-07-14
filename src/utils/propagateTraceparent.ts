/**
 * Official Axr — propagate W3C traceparent when first-party base (Gd) OR
 * CLAUDE_CODE_PROPAGATE_TRACEPARENT is truthy.
 *
 * Consumers still only attach a header when TRACEPARENT / generated id is present.
 */

import { isEnvTruthy } from './envUtils.js'
import { isFirstPartyAnthropicBaseUrl } from './model/providers.js'

export function shouldPropagateTraceparent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Official: return Gd() || ct(process.env.CLAUDE_CODE_PROPAGATE_TRACEPARENT)
  return (
    isFirstPartyAnthropicBaseUrl(env) ||
    isEnvTruthy(env.CLAUDE_CODE_PROPAGATE_TRACEPARENT)
  )
}
