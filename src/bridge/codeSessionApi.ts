/**
 * Thin HTTP wrappers for the CCR v2 code-session API.
 *
 * Separate file from remoteBridgeCore.ts so the SDK /bridge subpath can
 * export createCodeSession + fetchRemoteCredentials without bundling the
 * heavy CLI tree (analytics, transport, etc.). Callers supply explicit
 * accessToken + baseUrl — no implicit auth or config reads.
 */

import axios from 'axios'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { extractErrorDetail } from './debugUtils.js'
import { toCompatSessionId } from './sessionIdCompat.js'

const ANTHROPIC_VERSION = '2023-06-01'

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

export async function createCodeSession(
  baseUrl: string,
  accessToken: string,
  title: string,
  timeoutMs: number,
  tags?: string[],
  /**
   * densable session_grouping_id (l) — optional project grouping for
   * claude.ai session cards / reattach GROUPING.
   */
  sessionGroupingId?: string,
): Promise<string | null> {
  const url = `${baseUrl}/v1/code/sessions`
  let response
  try {
    response = await axios.post(
      url,
      // bridge: {} is the positive signal for the oneof runner — omitting it
      // (or sending environment_id: "") now 400s. BridgeRunner is an empty
      // message today; it's a placeholder for future bridge-specific options.
      // densable: ...l && {session_grouping_id:l}
      {
        title,
        bridge: {},
        ...(tags?.length ? { tags } : {}),
        ...(sessionGroupingId
          ? { session_grouping_id: sessionGroupingId }
          : {}),
      },
      {
        headers: oauthHeaders(accessToken),
        timeout: timeoutMs,
        validateStatus: s => s < 500,
      },
    )
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] Session create request failed: ${errorMessage(err)}`,
    )
    return null
  }

  if (response.status !== 200 && response.status !== 201) {
    const detail = extractErrorDetail(response.data)
    logForDebugging(
      `[code-session] Session create failed ${response.status}${detail ? `: ${detail}` : ''}`,
    )
    return null
  }

  const data: unknown = response.data
  if (
    !data ||
    typeof data !== 'object' ||
    !('session' in data) ||
    !data.session ||
    typeof data.session !== 'object' ||
    !('id' in data.session) ||
    typeof data.session.id !== 'string' ||
    !data.session.id.startsWith('cse_')
  ) {
    logForDebugging(
      `[code-session] No session.id (cse_*) in response: ${jsonStringify(data).slice(0, 200)}`,
    )
    return null
  }
  return data.session.id
}

/**
 * Credentials from POST /bridge. JWT is opaque — do not decode.
 * Each /bridge call bumps worker_epoch server-side (it IS the register).
 */
export type RemoteCredentials = {
  worker_jwt: string
  api_base_url: string
  expires_in: number
  worker_epoch: number
}

/**
 * densable /bridge failure shapes (jni).
 * - terminal:true  → mdt() — hard fail (auth/resource/malformed)
 * - terminal:false → Hde() — soft oauth_rejected (retry / adopt-loop)
 * Network/5xx collapse to null (transient).
 */
export type BridgeCredentialTerminalFailure = {
  terminal: true
  reason:
    | 'invalid_session_id'
    | 'untrusted_device'
    | 'session_stale_relogin'
    | 'request_rejected'
    | 'malformed_response'
    | 'grouping_rejected'
  status?: number
  detail?: string
}

export type BridgeCredentialOAuthRejected = {
  terminal: false
  reason: 'oauth_rejected'
}

export type BridgeCredentialFailure =
  | BridgeCredentialTerminalFailure
  | BridgeCredentialOAuthRejected

export type BridgeCredentialResult =
  | RemoteCredentials
  | BridgeCredentialFailure
  | null

/** densable mdt — terminal:!0 failure object */
export function isTerminalBridgeFailure(
  value: unknown,
): value is BridgeCredentialTerminalFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'terminal' in value &&
    (value as { terminal: unknown }).terminal === true
  )
}

/** densable Hde — terminal:!1 (oauth_rejected) soft failure */
export function isNonTerminalBridgeFailure(
  value: unknown,
): value is BridgeCredentialOAuthRejected {
  return (
    typeof value === 'object' &&
    value !== null &&
    'terminal' in value &&
    (value as { terminal: unknown }).terminal === false
  )
}

export function isRemoteCredentials(
  value: BridgeCredentialResult,
): value is RemoteCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    'worker_jwt' in value &&
    typeof (value as RemoteCredentials).worker_jwt === 'string'
  )
}

/** densable A$p — HTTP status → oauth_rejected | transient | rejected */
export function classifyBridgeHttpStatus(
  status: number,
): 'oauth_rejected' | 'transient' | 'rejected' {
  if (status === 401) return 'oauth_rejected'
  if (status === 408 || status === 429 || status >= 500) return 'transient'
  return 'rejected'
}

/** densable fDe — 403 body resource for trusted-device / stale-relogin */
export function extractBridge403Resource(
  data: unknown,
  detail?: string,
): 'untrusted_device' | 'session_stale_relogin' | undefined {
  if (
    data !== null &&
    typeof data === 'object' &&
    'error' in data &&
    data.error !== null &&
    typeof data.error === 'object' &&
    'resource' in data.error
  ) {
    const r = (data.error as { resource?: unknown }).resource
    if (r === 'untrusted_device' || r === 'session_stale_relogin') return r
  }
  if (detail?.includes('trusted device')) return 'untrusted_device'
  return undefined
}

/**
 * densable Nls/czu Unarchive — POST /v1/sessions/{compatId}/unarchive.
 * Same compat path as archive (not /v1/code/sessions). Returns status or
 * error token; "invalid" when session id cannot be retagged.
 */
export async function unarchiveCodeSession(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  orgUUID: string,
  timeoutMs: number,
  /** Optional: inject trusted-device header (CLI path). */
  trustedDeviceToken?: string,
): Promise<number | 'timeout' | 'error' | 'invalid'> {
  if (!sessionId) return 'invalid'
  const compatId = toCompatSessionId(sessionId)
  if (!compatId) return 'invalid'
  try {
    const headers = oauthHeaders(accessToken)
    headers['anthropic-beta'] = 'ccr-byoc-2025-07-29'
    headers['x-organization-uuid'] = orgUUID
    if (trustedDeviceToken) {
      headers['X-Trusted-Device-Token'] = trustedDeviceToken
    }
    const response = await axios.post(
      `${baseUrl}/v1/sessions/${compatId}/unarchive`,
      {},
      {
        headers,
        timeout: timeoutMs,
        validateStatus: () => true,
      },
    )
    logForDebugging(
      `[code-session] Unarchive ${compatId} status=${response.status}`,
    )
    return response.status
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] Unarchive ${compatId} failed: ${errorMessage(err)}`,
    )
    return axios.isAxiosError(err) && err.code === 'ECONNABORTED'
      ? 'timeout'
      : 'error'
  }
}

/**
 * densable jni — POST /bridge with typed failures.
 * Returns credentials | {terminal,reason} | null (transient).
 */
export async function fetchRemoteCredentials(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  timeoutMs: number,
  trustedDeviceToken?: string,
): Promise<BridgeCredentialResult> {
  if (!sessionId) {
    return { terminal: true, reason: 'invalid_session_id' }
  }
  const url = `${baseUrl}/v1/code/sessions/${sessionId}/bridge`
  const headers = oauthHeaders(accessToken)
  if (trustedDeviceToken) {
    headers['X-Trusted-Device-Token'] = trustedDeviceToken
  }
  let response
  try {
    response = await axios.post(
      url,
      {},
      {
        headers,
        timeout: timeoutMs,
        validateStatus: s => s < 500,
      },
    )
  } catch (err: unknown) {
    logForDebugging(
      `[code-session] /bridge request failed: ${errorMessage(err)}`,
    )
    // densable: network → null (transient)
    return null
  }

  if (response.status !== 200) {
    const detail = extractErrorDetail(response.data)
    logForDebugging(
      `[code-session] /bridge failed ${response.status}${detail ? `: ${detail}` : ''}`,
    )
    if (response.status === 403) {
      const resource = extractBridge403Resource(response.data, detail)
      if (resource) {
        return { terminal: true, reason: resource, status: 403, detail }
      }
    }
    switch (classifyBridgeHttpStatus(response.status)) {
      case 'oauth_rejected':
        // densable: {terminal:!1, reason:"oauth_rejected"}
        return { terminal: false, reason: 'oauth_rejected' }
      case 'transient':
        return null
      case 'rejected':
        return {
          terminal: true,
          reason: 'request_rejected',
          status: response.status,
          detail,
        }
    }
  }

  const data: unknown = response.data
  if (
    data === null ||
    typeof data !== 'object' ||
    !('worker_jwt' in data) ||
    typeof data.worker_jwt !== 'string' ||
    !('expires_in' in data) ||
    typeof data.expires_in !== 'number' ||
    !('api_base_url' in data) ||
    typeof data.api_base_url !== 'string' ||
    !('worker_epoch' in data)
  ) {
    logForDebugging(
      `[code-session] /bridge response malformed (need worker_jwt, expires_in, api_base_url, worker_epoch): ${jsonStringify(data).slice(0, 200)}`,
    )
    // densable: malformed → {terminal:!0, reason:"malformed_response"}
    return { terminal: true, reason: 'malformed_response', status: 200 }
  }
  // protojson serializes int64 as a string to avoid JS precision loss;
  // Go may also return a number depending on encoder settings.
  const rawEpoch = data.worker_epoch
  const epoch = typeof rawEpoch === 'string' ? Number(rawEpoch) : rawEpoch
  if (
    typeof epoch !== 'number' ||
    !Number.isFinite(epoch) ||
    !Number.isSafeInteger(epoch)
  ) {
    logForDebugging(
      `[code-session] /bridge worker_epoch invalid: ${jsonStringify(rawEpoch)}`,
    )
    return { terminal: true, reason: 'malformed_response', status: 200 }
  }
  return {
    worker_jwt: data.worker_jwt,
    api_base_url: data.api_base_url,
    expires_in: data.expires_in,
    worker_epoch: epoch,
  }
}
