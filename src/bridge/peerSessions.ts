import axios from 'axios'
import { getOauthConfig } from '../constants/oauth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { isCcrV2EnvEnabled } from '../utils/residualFinalEnvGates.js'
import {
  CCR_BYOC_BETA,
  getOAuthHeaders,
  prepareApiRequest,
} from '../utils/teleport/api.js'
import { getClaudeCodeUserAgent } from '../utils/userAgent.js'
import { validateBridgeId } from './bridgeApi.js'
import { getBridgeAccessToken } from './bridgeConfig.js'
import { extractBridge403Resource } from './codeSessionApi.js'
import { getReplBridgeHandle } from './replBridgeHandle.js'
import { toCompatSessionId } from './sessionIdCompat.js'
import {
  clearTrustedDeviceTokenCache,
  enrollTrustedDevice,
  getTrustedDeviceToken,
} from './trustedDevice.js'

export type BridgePeerSession = {
  address: string
  name?: string
  cwd?: string
  pid?: number
  /**
   * densable 2.1.229 Esf — when false, ListAgents shows "offline".
   * Live local registry peers default to connected; remote cloud rows set transport.
   */
  connected?: boolean
  transport?: 'uds' | 'bridge' | 'cloud' | 'did'
  status?: string
}

/** densable q_i — account bridge peer list page budget */
export const BRIDGE_PEER_LIST_PAGE_BUDGET = 5

export type BridgeAccountPeerRow = {
  id: string
  title: string | null
  status: string
  updated_at: string
  environmentKind?: string
  connected?: boolean
}

export type ListBridgePeerSessionsStatus = {
  failed: boolean
  truncated: boolean
}

/** densable nBe — prefer /v1/code/sessions when CCR v2 session CRUD is on */
function useCcrV2SessionCrud(): boolean {
  if (isCcrV2EnvEnabled()) return true
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_ccr_v2_session_crud_cli',
    false,
  )
}

/** densable JGv */
function isBridgeEnvironmentKind(kind: unknown): kind is string {
  return (
    kind === 'bridge' ||
    kind === 'anthropic_cloud' ||
    kind === 'byoc' ||
    kind === 'snap'
  )
}

/** densable Pm / strip session_/cse_ for identity compare */
function stripSessionTag(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

/**
 * densable qGv / listBridgePeerSessions — paginated account RC session list.
 * Sets status.truncated when page budget exhausted with more remaining.
 */
export async function listBridgePeerSessions(
  status?: ListBridgePeerSessionsStatus,
): Promise<BridgeAccountPeerRow[]> {
  let accessToken: string
  let orgUUID: string
  try {
    ;({ accessToken, orgUUID } = await prepareApiRequest())
  } catch (err) {
    logForDebugging(`[bridge:peers] auth prep failed: ${errorMessage(err)}`)
    if (status) status.failed = true
    return []
  }

  const ccrV2 = useCcrV2SessionCrud()
  const base = `${getOauthConfig().BASE_API_URL}${
    ccrV2 ? '/v1/code/sessions' : '/v1/sessions'
  }`
  const headers: Record<string, string> = {
    ...getOAuthHeaders(accessToken),
    ...(!ccrV2
      ? {
          'anthropic-beta': CCR_BYOC_BETA,
          'x-organization-uuid': orgUUID,
        }
      : {}),
    'User-Agent': getClaudeCodeUserAgent(),
  }
  let trusted = getTrustedDeviceToken()
  if (trusted) headers['X-Trusted-Device-Token'] = trusted

  const selfId = getReplBridgeHandle()?.bridgeSessionId
  const selfBody = selfId ? stripSessionTag(selfId) : undefined
  const out: BridgeAccountPeerRow[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  let truncated = false
  let retriedTrusted = false

  for (let page = 0; page < BRIDGE_PEER_LIST_PAGE_BUDGET; page++) {
    const params = new URLSearchParams()
    if (ccrV2) params.set('limit', '100')
    if (cursor) params.set(ccrV2 ? 'cursor' : 'after_id', cursor)
    const qs = params.toString()
    const url = qs ? `${base}?${qs}` : base
    let response: {
      status: number
      data: {
        data?: unknown
        next_cursor?: string | null
        has_more?: boolean
        last_id?: string | null
      }
    }
    try {
      response = await axios.get(url, {
        headers,
        timeout: 15_000,
        validateStatus: (s: number) => s < 500,
      })
    } catch (err) {
      logForDebugging(
        `[bridge:peers] list request failed: ${errorMessage(err)}`,
      )
      if (status) status.failed = true
      return out
    }

    if (
      response.status === 403 &&
      !retriedTrusted &&
      extractBridge403Resource(response.data) === 'untrusted_device'
    ) {
      retriedTrusted = true
      clearTrustedDeviceTokenCache()
      await enrollTrustedDevice()
      const next = getTrustedDeviceToken()
      if (next) {
        headers['X-Trusted-Device-Token'] = next
        trusted = next
        page--
        continue
      }
    }

    if (response.status !== 200) {
      logForDebugging(`[bridge:peers] list failed ${response.status}`)
      if (status) status.failed = true
      return out
    }

    const body = response.data
    if (
      body === null ||
      typeof body !== 'object' ||
      !Array.isArray(body.data)
    ) {
      logForDebugging('[bridge:peers] list body `data` not an array; stopping')
      if (status) status.failed = true
      return out
    }

    for (const raw of body.data) {
      try {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as Record<string, unknown>
        const isCompat = 'session_status' in row
        const sessionStatus = isCompat
          ? String(row.session_status ?? '')
          : row.status === 'archived'
            ? 'archived'
            : row.worker_status === 'running' ||
                row.worker_status === 'requires_action'
              ? String(row.worker_status)
              : 'idle'
        if (sessionStatus === 'archived') continue
        const idRaw = typeof row.id === 'string' ? row.id : ''
        if (!idRaw) continue
        const id = isCompat ? idRaw : toCompatSessionId(idRaw)
        const bodyId = stripSessionTag(id)
        if (selfBody && bodyId === selfBody) continue
        if (seen.has(bodyId)) continue
        seen.add(bodyId)
        const title =
          typeof row.title === 'string'
            ? row.title
            : row.title === null
              ? null
              : null
        const updated =
          (isCompat
            ? typeof row.updated_at === 'string'
              ? row.updated_at
              : ''
            : typeof row.last_event_at === 'string'
              ? row.last_event_at
              : '') ?? ''
        const conn = row.connection_status
        out.push({
          id,
          title,
          status: sessionStatus,
          updated_at: updated,
          ...(isBridgeEnvironmentKind(row.environment_kind)
            ? { environmentKind: String(row.environment_kind) }
            : {}),
          ...(conn === 'connected' || conn === 'disconnected'
            ? { connected: conn === 'connected' }
            : {}),
        })
      } catch (err) {
        logForDebugging(
          `[bridge:peers] skipping malformed session row: ${errorMessage(err)}`,
        )
      }
    }

    const next = ccrV2
      ? (body.next_cursor ?? null)
      : body.has_more
        ? (body.last_id ?? null)
        : null
    if (!next) break
    cursor = next
    if (page === BRIDGE_PEER_LIST_PAGE_BUDGET - 1) {
      truncated = true
      logForDebugging(
        `[bridge:peers] page budget exhausted with more sessions remaining (scanned ${BRIDGE_PEER_LIST_PAGE_BUDGET} pages)`,
      )
    }
  }

  logForDebugging(
    `[bridge:peers] listed ${out.length} peer sessions${
      truncated
        ? ` — TRUNCATED at ${BRIDGE_PEER_LIST_PAGE_BUDGET} pages (more sessions exist)`
        : ''
    }`,
  )
  if (status) status.truncated = truncated
  return out
}

/**
 * List locally registered sessions that have published a Remote Control
 * session ID. The PID registry is the local source of truth for bridge peers
 * already known to this machine; SendMessage can use these bridge:<id>
 * addresses when the current process has an active bridge handle.
 */
export async function listBridgePeers(): Promise<BridgePeerSession[]> {
  const { listAllLiveSessions } = await import('../utils/udsClient.js')
  const sessions = await listAllLiveSessions()
  const peers: BridgePeerSession[] = []

  for (const session of sessions) {
    if (session.pid === process.pid || !session.bridgeSessionId) continue
    const compatId = toCompatSessionId(session.bridgeSessionId)
    peers.push({
      address: `bridge:${compatId}`,
      name: session.name ?? session.kind,
      cwd: session.cwd,
      pid: session.pid,
      transport: 'bridge',
      // densable Esf: live registry entry → connected; dead/stale would be offline
      connected: session.alive !== false,
    })
  }

  return peers
}

/**
 * Send a plain-text message to another Claude session via the bridge API.
 *
 * Called by SendMessageTool when the target address scheme is "bridge:".
 * Uses the current ReplBridgeHandle to derive the sender identity and
 * the session ingress URL for the POST request.
 *
 * @param target - Target session ID (from the "bridge:<sessionId>" address)
 * @param message - Plain text message content (structured messages are rejected upstream)
 * @returns { ok: true } on success, { ok: false, error } on failure. Never throws.
 */
export async function postInterClaudeMessage(
  target: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const handle = getReplBridgeHandle()
    if (!handle) {
      return { ok: false, error: 'Bridge not connected' }
    }

    const normalizedTarget = target.trim()
    if (!normalizedTarget) {
      return { ok: false, error: 'No target session specified' }
    }

    const accessToken = getBridgeAccessToken()
    if (!accessToken) {
      return { ok: false, error: 'No access token available' }
    }

    const compatTarget = toCompatSessionId(normalizedTarget)
    // Validate against path traversal — same allowlist as bridgeApi.ts
    validateBridgeId(compatTarget, 'target sessionId')
    const from = toCompatSessionId(handle.bridgeSessionId)
    const baseUrl = handle.sessionIngressUrl

    // densable 2.1.228 #13 — fbr(bridge:from, Soa()??name, body): wrap content so
    // other-machine receivers show RC session name (selfTitle) as sender.
    let fromName: string | undefined
    try {
      const { getSessionId } = await import('../bootstrap/state.js')
      const { getCurrentSessionTitle } = await import(
        '../utils/sessionStorage.js'
      )
      fromName = getCurrentSessionTitle(getSessionId())
    } catch {
      // optional
    }
    const { wrapCrossSessionMessage } = await import(
      '../utils/crossSessionMessage.js'
    )
    const content = wrapCrossSessionMessage(message, {
      from: `bridge:${from}`,
      ...(fromName !== undefined ? { fromName } : {}),
    })

    const url = `${baseUrl}/v1/sessions/${encodeURIComponent(compatTarget)}/messages`

    const response = await axios.post(
      url,
      {
        type: 'peer_message',
        from,
        content,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        timeout: 10_000,
        validateStatus: (s: number) => s < 500,
      },
    )

    if (response.status === 200 || response.status === 204) {
      logForDebugging(
        `[bridge:peer] Message sent to ${compatTarget} (${response.status})`,
      )
      return { ok: true }
    }

    const detail =
      typeof response.data === 'object' && response.data?.error?.message
        ? response.data.error.message
        : `HTTP ${response.status}`
    logForDebugging(`[bridge:peer] Send failed: ${detail}`)
    return { ok: false, error: detail }
  } catch (err: unknown) {
    const msg = errorMessage(err)
    logForDebugging(`[bridge:peer] postInterClaudeMessage error: ${msg}`)
    return { ok: false, error: msg }
  }
}
