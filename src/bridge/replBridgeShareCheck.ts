/**
 * Official 2.1.325 `DRt` / `P1o` / `ERt` / `IRt` (#2373):
 * Before `/resume` or `/teleport` moves this terminal to another conversation,
 * check whether the currently connected Remote Control session has a share link
 * (`GET /v2/sessions/:id/share`). If `effective_visibility` is `org_shared` or
 * `sign_in_shared` — or if the visibility cannot be checked — disconnect Remote
 * Control first and return the user-facing notice.
 */
import axios from 'axios'
import { getOauthConfig } from '../constants/oauth.js'
import { getClaudeAIOAuthTokens, isClaudeAISubscriber } from '../utils/auth.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import type { ReplBridgeHandle } from './replBridge.js'
import { getReplBridgeHandle, setReplBridgeHandle } from './replBridgeHandle.js'
import { toCompatSessionId } from './sessionIdCompat.js'

export const SHARE_CHECK_TIMEOUT_MS = 5_000

export type BridgeShareVisibility = 'private' | 'shared' | 'unknown'

export type ShareDisconnectReason = 'shared' | 'unknown' | 'landing'

export const RC_SHARE_DISCONNECT_MESSAGES: Record<
  ShareDisconnectReason,
  string
> = {
  shared:
    'Remote Control disconnected: it was connected to a session with a share link, and this terminal is moving to another conversation. Run /remote-control to connect again.',
  unknown:
    'Remote Control disconnected: this terminal is moving to another conversation, and it could not check whether the connected session has a share link. Run /remote-control to connect again.',
  landing:
    "Remote Control disconnected: this terminal isn't on the conversation it was connected to, and it could not check whether that session has a share link. Run /remote-control to connect again.",
}

export const AUTO_UPLOAD_SHARE_DISCONNECT_MESSAGES: Record<
  ShareDisconnectReason,
  string
> = {
  shared:
    'Session auto-upload stopped: it was connected to a session with a share link, and this terminal is moving to another conversation. In /config, turn "Auto-upload sessions to claude.ai (view-only)" off and on to start again.',
  unknown:
    'Session auto-upload stopped: this terminal is moving to another conversation, and it could not check whether the connected session has a share link. In /config, turn "Auto-upload sessions to claude.ai (view-only)" off and on to start again.',
  landing:
    'Session auto-upload stopped: this terminal isn\'t on the conversation it was connected to, and it could not check whether that session has a share link. In /config, turn "Auto-upload sessions to claude.ai (view-only)" off and on to start again.',
}

const SAFE_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export function formatShareDisconnectNotice(
  reason: ShareDisconnectReason,
  outboundOnly = false,
): string {
  return outboundOnly
    ? AUTO_UPLOAD_SHARE_DISCONNECT_MESSAGES[reason]
    : RC_SHARE_DISCONNECT_MESSAGES[reason]
}

export function classifyEffectiveVisibility(
  body: unknown,
): BridgeShareVisibility {
  const vis =
    typeof body === 'object' && body !== null && 'effective_visibility' in body
      ? (body as { effective_visibility?: unknown }).effective_visibility
      : undefined
  switch (vis) {
    case 'private':
    case 'sealed_owner_only':
      return 'private'
    case 'org_shared':
    case 'sign_in_shared':
      return 'shared'
    default:
      return 'unknown'
  }
}

export type FetchShareVisibilityFn = (
  sessionId: string,
  timeoutMs: number,
) => Promise<{ status: number; data: unknown } | { failure: string }>

async function defaultFetchShareVisibility(
  sessionId: string,
  timeoutMs: number,
): Promise<{ status: number; data: unknown } | { failure: string }> {
  if (!isClaudeAISubscriber()) {
    return { failure: 'third_party' }
  }
  const compatId = toCompatSessionId(sessionId)
  if (!SAFE_SESSION_ID_RE.test(compatId)) {
    return { failure: 'unsafe_id' }
  }
  const token = getClaudeAIOAuthTokens()?.accessToken
  if (!token) {
    return { failure: 'no_token' }
  }
  const baseUrl = getOauthConfig().BASE_API_URL.replace(/\/+$/, '')
  const url = `${baseUrl}/v2/sessions/${encodeURIComponent(compatId)}/share`
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'ccr-byoc-2025-07-29',
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    })
    if (res.status === 200) {
      return { status: 200, data: res.data }
    }
    if (res.status === 401) {
      return { failure: 'unauthorized' }
    }
    return { failure: res.status >= 500 ? 'server_error' : 'client_error' }
  } catch (err) {
    logForDebugging(`[bridge:repl] Share lookup failed: ${errorMessage(err)}`)
    return { failure: 'network' }
  }
}

/**
 * Official 2.1.325 `DRt`: query `/v2/sessions/:id/share` and classify whether
 * the session is private, shared, or unknown (including errors/timeouts).
 */
export async function checkBridgeSessionShareVisibility(
  bridgeSessionId: string,
  opts?: {
    timeoutMs?: number
    fetcher?: FetchShareVisibilityFn
  },
): Promise<BridgeShareVisibility> {
  const timeoutMs = opts?.timeoutMs ?? SHARE_CHECK_TIMEOUT_MS
  const fetcher = opts?.fetcher ?? defaultFetchShareVisibility
  try {
    const result = await Promise.race([
      fetcher(bridgeSessionId, timeoutMs),
      new Promise<{ failure: string }>(resolve =>
        setTimeout(() => resolve({ failure: 'timeout' }), timeoutMs),
      ),
    ])
    if ('failure' in result) {
      return 'unknown'
    }
    return classifyEffectiveVisibility(result.data)
  } catch (err) {
    logForDebugging(`[bridge:repl] Share check threw: ${errorMessage(err)}`)
    return 'unknown'
  }
}

export type DisconnectSharedBridgeResult = {
  disconnected: boolean
  visibility?: BridgeShareVisibility
  notice?: string
}

/**
 * Official 2.1.325 (#2373): called before `/resume` or `/teleport` switches
 * conversations. If Remote Control is connected to a session with a share link
 * (or visibility cannot be checked), disconnect Remote Control first and return
 * the user-facing notice.
 */
export async function disconnectBridgeBeforeConversationSwitch(opts?: {
  handle?: ReplBridgeHandle | null
  outboundOnly?: boolean
  timeoutMs?: number
  fetcher?: FetchShareVisibilityFn
  onDisconnected?: (notice: string) => void
}): Promise<DisconnectSharedBridgeResult> {
  const activeHandle =
    opts?.handle !== undefined ? opts.handle : getReplBridgeHandle()
  if (!activeHandle) {
    return { disconnected: false }
  }
  const visibility = await checkBridgeSessionShareVisibility(
    activeHandle.bridgeSessionId,
    {
      timeoutMs: opts?.timeoutMs,
      fetcher: opts?.fetcher,
    },
  )
  if (visibility === 'private') {
    return { disconnected: false, visibility }
  }
  const notice = formatShareDisconnectNotice(
    visibility,
    opts?.outboundOnly === true,
  )
  try {
    await activeHandle.teardown()
  } catch (err) {
    logForDebugging(
      `[bridge:repl] Share check teardown failed: ${errorMessage(err)}`,
    )
  }
  if (opts?.handle === undefined && getReplBridgeHandle() === activeHandle) {
    setReplBridgeHandle(null)
  }
  opts?.onDisconnected?.(notice)
  return { disconnected: true, visibility, notice }
}
