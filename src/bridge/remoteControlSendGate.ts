/**
 * densable 2.1.238 #27 — Aom / Rom Remote Control send gate.
 *
 * `.live` OK; else CLAUDE_CODE_REMOTE → no-container-address if mrr() is
 * undefined else OK; else rc-disconnected.
 *
 * mrr: only CLAUDE_CODE_REMOTE_SESSION_ID through TMn then KL. Garbage
 * sid → no-container-address. No getReplBridgeSessionId fallback.
 * Do not invent Desktop/cloud handoff / XKn supervisedBridgeSession live.
 */

import { isReplBridgeActive } from '../bootstrap/state.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { getReplBridgeHandle } from './replBridgeHandle.js'
import { toCompatSessionId } from './sessionIdCompat.js'

export type RemoteControlSendBlockReason =
  | 'rc-disconnected'
  | 'no-container-address'

export const RC_DISCONNECTED_MESSAGE = 'Remote Control is not connected'
export const NO_CONTAINER_ADDRESS_MESSAGE = 'this session has no reply address'

/** densable XKn()?.live */
export function isRemoteControlLive(): boolean {
  return getReplBridgeHandle() !== null && isReplBridgeActive()
}

/** densable `usa` + `am` nonempty + `session_`/`cse_` prefix (`TMn`). */
export function isValidRemoteControlSessionId(id: string): boolean {
  return (
    (id.startsWith('session_') || id.startsWith('cse_')) &&
    id !== '' &&
    /^[a-zA-Z0-9_-]+$/.test(id) &&
    id.replace(/^(?:session|cse)_/, '') !== ''
  )
}

/** densable mrr — CLAUDE_CODE_REMOTE_SESSION_ID through TMn then KL. */
export function getRemoteControlReplyAddress(): string | undefined {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) return undefined
  const fromEnv = process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? ''
  return isValidRemoteControlSessionId(fromEnv)
    ? toCompatSessionId(fromEnv)
    : undefined
}

/**
 * densable Aom — undefined means send is allowed.
 */
export function getRemoteControlSendBlockReason():
  | RemoteControlSendBlockReason
  | undefined {
  if (isRemoteControlLive()) return undefined
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return getRemoteControlReplyAddress() === undefined
      ? 'no-container-address'
      : undefined
  }
  return 'rc-disconnected'
}

/** densable Rom */
export function formatRemoteControlSendBlock(
  reason: RemoteControlSendBlockReason,
): string {
  return reason === 'rc-disconnected'
    ? RC_DISCONNECTED_MESSAGE
    : NO_CONTAINER_ADDRESS_MESSAGE
}
