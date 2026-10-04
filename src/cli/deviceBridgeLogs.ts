/**
 * densable 2.1.283 leftover unique wrap — logs / URL / reject-key only.
 *
 * gold `ze` @200247778, `Ke` @200253132, `fe` @200253421, `Ve` @200254158
 * CONNECTED-PATH logs. No socket fleet. No fake connected event.
 *
 * gold `xe` = `wss://bridge.claudeusercontent.com`
 * gold `Ne` = `wss://bridge-staging.claudeusercontent.com`
 * Those are oauth-only official fleet constants — wrap env only +
 * undefined default. Unknown oauth suffix skips (empty→prod would
 * have returned `xe`; we do not ship that WSS).
 *
 * gold He skip:
 * `[deviceBridge] skipped: no device bridge for this OAuth environment`
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { fileSuffixForOauthConfig } from 'src/constants/oauth.js'

type AnalyticsString =
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

function c(value: string): AnalyticsString {
  return value as AnalyticsString
}

function ue(value: string | null | undefined): AnalyticsString | undefined {
  return value == null ? undefined : c(value)
}

function hr(value: unknown): AnalyticsString {
  return c(String(value))
}

function D2(value: unknown): AnalyticsString | undefined {
  return value == null ? undefined : hr(value)
}

export type DeviceBridgeTransportEvent =
  | {
      kind: 'authenticated'
      protocolVersion: number
      timings: {
        hbIntervalMs: number
        stalenessMs: number
        rpcTimeoutMs: number
      }
    }
  | {
      kind: 'rejected'
      phase: string
      reason?: string | null
      status?: number | string | null
      slotContention: boolean
    }
  | {
      kind: 'closed'
      phase: string
      code?: number | string | null
      superseded: boolean
    }
  | { kind: 'token_unavailable' }
  | { kind: 'handshake_timeout' }
  | { kind: 'socket_error' }
  | { kind: 'dial_failed' }

export type DeviceBridgeLivenessEvent =
  | { kind: 'pong_timeout'; consecutive: number }
  | { kind: 'reconnect_exhausted' }
  | { kind: 'heartbeat_unsupported'; protocolVersion: unknown }
  | {
      kind: 'reannounce'
      reason: string
      outcome: string
      inFlightAtStart: number
      drainedMs: number
      drainTimedOut: boolean
    }
  | { kind: 'reannounce_contended'; reason: string }

/**
 * gold `ze` @200247778 — CLAUDE_REMOTE_TOOLS_BRIDGE_URL if defined;
 * else oauth suffix switch. Unknown / non-env default is undefined.
 */
export function remoteToolsBridgeBaseUrl(): string | undefined {
  if (process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL !== undefined) {
    return process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL
  }
  switch (fileSuffixForOauthConfig()) {
    case '':
      // gold xe oauth-only WSS — do not ship the official fleet URL
      return undefined
    case '-staging-oauth':
      // gold Ne oauth-only WSS — do not ship the official fleet URL
      return undefined
    default:
      return undefined
  }
}

/**
 * gold `Ke` @200253132 — reject/closed coalescing key. default → undefined.
 */
export function deviceBridgeRejectKey(
  event: DeviceBridgeTransportEvent,
): string | undefined {
  switch (event.kind) {
    case 'rejected':
      return `rejected:${event.phase}:${event.reason ?? ''}:${event.status ?? ''}`
    case 'closed':
      return `closed:${event.phase}:${event.code ?? ''}:${event.superseded}`
    case 'token_unavailable':
    case 'handshake_timeout':
    case 'socket_error':
    case 'dial_failed':
      return event.kind
    default:
      return undefined
  }
}

/**
 * gold `fe` @200253421 — CALL logEvent with gold field names.
 * Do NOT emit tengu_device_bridge_connected unless the caller passes
 * an authenticated event.
 */
export function logDeviceBridgeTransportEvent(
  event: DeviceBridgeTransportEvent,
): void {
  switch (event.kind) {
    case 'authenticated':
      logEvent('tengu_device_bridge_connected', {
        protocol_version: event.protocolVersion,
        hb_interval_ms: event.timings.hbIntervalMs,
        staleness_ms: event.timings.stalenessMs,
        rpc_timeout_ms: event.timings.rpcTimeoutMs,
      })
      return
    case 'rejected':
      logEvent('tengu_device_bridge_rejected', {
        phase: c(event.phase),
        reason: ue(event.reason),
        status: D2(event.status),
        slot_contention: event.slotContention,
      })
      return
    case 'closed':
      logEvent('tengu_device_bridge_closed', {
        phase: c(event.phase),
        code: D2(event.code),
        superseded: event.superseded,
      })
      return
    case 'token_unavailable':
    case 'handshake_timeout':
    case 'socket_error':
      logEvent('tengu_device_bridge_connect_failed', {
        cause: c(event.kind),
      })
      return
    case 'dial_failed':
      logEvent('tengu_device_bridge_connect_failed', {
        cause: c('dial_failed'),
      })
      return
    default:
      return
  }
}

/**
 * gold `Ve` @200254158 — pong_timeout / reconnect_exhausted /
 * heartbeat_unsupported / reannounce / reannounce_contended.
 */
export function logDeviceBridgeLivenessEvent(
  event: DeviceBridgeLivenessEvent,
): void {
  switch (event.kind) {
    case 'pong_timeout':
      logEvent('tengu_device_bridge_pong_timeout', {
        consecutive: event.consecutive,
      })
      return
    case 'reconnect_exhausted':
      logEvent('tengu_device_bridge_reconnect_exhausted', {})
      return
    case 'heartbeat_unsupported':
      logEvent('tengu_device_bridge_heartbeat_unsupported', {
        protocol_version: hr(event.protocolVersion),
      })
      return
    case 'reannounce':
      logEvent('tengu_device_bridge_reannounce', {
        reason: c(event.reason),
        outcome: c(event.outcome),
        inflight_at_start: event.inFlightAtStart,
        drained_ms: event.drainedMs,
        drain_timed_out: event.drainTimedOut,
      })
      return
    case 'reannounce_contended':
      logEvent('tengu_device_bridge_reannounce_contended', {
        reason: c(event.reason),
      })
      return
    default:
      return
  }
}
