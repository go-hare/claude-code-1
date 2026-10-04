/**
 * densable 2.1.283 leftover `tn.attach` default `new gPe` wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `class gPe` @202087858
 *   leftover `tn.attach` @202385551 `w=e.createManager?e.createManager(v,h):new gPe(v,h)`
 *
 * Default path wraps existing `RemoteSessionManager` (gold `gPe` host).
 * leftover `releaseHeldSends`/`flushSends`/`addSendGate`/`postControlRequest`
 * wrap onto that host + a local send-gate / held-send ledger.
 * leftover `sendBehindGates` @202102201 registers `heldSends` with gold
 * `chainedSends` / `lastHeld` / parallel-gate race. leftover `flushSends`
 * wraps SessionsV2 `rt(Promise.allSettled(sendsInFlight), timeout)`. leftover
 * SessionsV2 POST `/v1/code/sessions/{id}/events` wraps existing
 * `sendPayloadToRemoteSession`. leftover `readStream` @202071152 GET
 * `/events/stream` uses leftover `Sbt` wrap (`LeftoverSseFrameBuffer`) with
 * leftover `u`/`m`/`h` delimiters. leftover `handleFrame` routes `client_event` /
 * `ephemeral_event` / `catch_up_truncated`. leftover `zt`/`Bt` send-gate
 * adapter + leftover `Be` first-defined-gate. leftover `class ue` connect
 * wraps leftover `gy`/`Xle` (`getTrustedDeviceTokenIfGateOn` /
 * `recoverTrustedDeviceTokenAfterUntrusted`) behind leftover `Wd`. NEVER
 * `export class gPe`. NEVER `export class Sbt`. NEVER `export function zt`.
 * NEVER `export class ue`. No Far key store.
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { extractBridge403Resource } from '../bridge/codeSessionApi.js'
import { extractErrorDetail } from '../bridge/debugUtils.js'
import {
  getTrustedDeviceTokenIfGateOn,
  recoverTrustedDeviceTokenAfterUntrusted,
} from '../bridge/trustedDevice.js'
import { getOauthConfig } from '../constants/oauth.js'
import {
  BASH_INPUT_TAG,
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../constants/xml.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage, isAbortError } from '../utils/errors.js'
import { jsonParse } from '../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../utils/userAgent.js'
import { RemoteSessionManager } from '../remote/RemoteSessionManager.js'
import {
  getAnthropicClientPlatform,
  sendPayloadToRemoteSession,
  TRUSTED_DEVICE_TOKEN_HEADER,
  type SendRemoteEventResult,
} from '../utils/teleport/api.js'
import { isViolinWoodEnabled } from './violinWood.js'
import { normalizeDeviceAttestationStatus } from './leftoverTulip.js'
import type { HeadlessWorkerManager } from './leftoverHeadlessWorker.js'

/** leftover `Oe` @202086500 — postControlRequest not connected. */
export const REMOTE_CONTROL_CLOSED = {
  outcome: 'failed',
  cause: 'closed',
} as const

/** leftover `Kt` @202086539 — releaseHeldSends default timeout. */
const RELEASE_HELD_SENDS_TIMEOUT_MS = 1500
/** leftover SessionsV2 `Te` @202066183 — SSE connect timeout. */
const CLOUD_EVENTS_STREAM_CONNECT_TIMEOUT_MS = 30_000
/** leftover SessionsV2 `_t` @202066183 — permanent SSE HTTP codes. */
const CLOUD_EVENTS_STREAM_PERMANENT_HTTP = new Set([401, 403, 404])
/** leftover SessionsV2 `mt` @199844669 — reconnect base delay. */
const CLOUD_EVENTS_RECONNECT_BASE_MS = 1000
/** leftover SessionsV2 `Ce` @199844677 — reconnect max delay. */
const CLOUD_EVENTS_RECONNECT_MAX_MS = 30_000
/** leftover SessionsV2 `K` @199844685 — reconnect budget. */
const CLOUD_EVENTS_RECONNECT_BUDGET = 5
/** leftover SessionsV2 `vt` @199844690 — liveness timeout. */
const CLOUD_EVENTS_LIVENESS_MS = 45_000
/** leftover SessionsV2 `Ee` @199844699 — wall-clock drift interval. */
const CLOUD_EVENTS_DRIFT_MS = 5_000

export type HeadlessHeldSend = {
  messageUuid?: string
  release: (exiting: boolean, final: boolean) => void
  withheldOnRelease: () => boolean
  posted: Promise<unknown>
  issuedYet: () => boolean
  withdraw: () => void
}

export type HeadlessSendGate = {
  gate: (item: unknown) => Promise<unknown>
  onRelease: string
  onExit: string
}

export type HeadlessReleaseHeldSendsResult = {
  unsent: number
  refused: unknown[]
  unconfirmed: number
  stillHeld: number
}

export type HeadlessRemoteManager = HeadlessWorkerManager & {
  connect?: () => void
  disconnect: () => void
  reconnect?: () => void
  releaseHeldSends: (
    timeoutMs?: number,
    opts?: { exiting?: boolean; final?: boolean; keepWithheld?: boolean },
  ) => Promise<HeadlessReleaseHeldSendsResult>
  flushSends: (timeoutMs: number) => Promise<unknown>
  sendControlRequest?: (
    request: { subtype: string },
    opts?: { signal?: AbortSignal; background?: boolean; timeoutMs?: number },
  ) => Promise<unknown>
  addSendGate?: (
    gate: (item: unknown) => Promise<unknown>,
    opts?: { onRelease?: string; onExit?: string },
  ) => () => void
  sendBehindGates?: (
    send: () => Promise<unknown>,
    opts?: { messageUuid?: string; submittedAtMs?: number },
  ) => Promise<unknown>
  heldSendCount?: () => number
  chainedSendCount?: () => number
}

export type HeadlessRemoteManagerConfig = {
  sessionId?: string
  getAccessToken?: () => string | Promise<string>
  orgUuid?: string
  initialPromptUuid?: string
}

export type HeadlessRemoteManagerCallbacks = {
  onConnected?: () => void
  onDisconnected?: (code?: unknown) => void
  onReconnecting?: () => void
  onCatchUpTruncated?: () => void
  onError?: (err: { message: string }) => void
}

/**
 * leftover `tn.attach` default `new gPe` — wrap existing RemoteSessionManager.
 * Missing orgUuid / getAccessToken → no-socket stub (tests / no-engine attach).
 */
export function createHeadlessRemoteManager(
  opts: HeadlessRemoteManagerConfig,
  callbacks: HeadlessRemoteManagerCallbacks = {},
): HeadlessRemoteManager {
  const stub = emptyHeadlessManager()
  const orgUuid = opts.orgUuid
  const getAccessToken = opts.getAccessToken
  const sessionId = opts.sessionId
  if (
    orgUuid === undefined ||
    getAccessToken === undefined ||
    sessionId === undefined
  ) {
    return stub
  }
  const host = new RemoteSessionManager(
    {
      sessionId,
      getAccessToken: () => {
        const token = getAccessToken()
        return typeof token === 'string' ? token : ''
      },
      orgUuid,
      hasInitialPrompt: opts.initialPromptUuid !== undefined,
      initialPromptUuid: opts.initialPromptUuid,
    },
    {
      onMessage: () => {},
      onPermissionRequest: () => {},
      onConnected: () => callbacks.onConnected?.(),
      onDisconnected: () => callbacks.onDisconnected?.(),
      onReconnecting: () => callbacks.onReconnecting?.(),
      onCatchUpTruncated: () => callbacks.onCatchUpTruncated?.(),
      onError: err => callbacks.onError?.(err),
    },
  )
  return wrapRemoteSessionManager(host)
}

/** leftover `tn.attach` no-engine stub — previous default when gPe host cannot start. */
export function emptyHeadlessManager(): HeadlessRemoteManager {
  return createHeadlessManagerLedger()
}

export function wrapRemoteSessionManager(
  host: RemoteSessionManager,
): HeadlessRemoteManager {
  return createHeadlessManagerLedger(host)
}

/**
 * leftover SessionsV2 `postEvents` @202070700 — wrap existing KLc
 * `sendPayloadToRemoteSession` (POST `/v1/code/sessions/{id}/events`).
 */
export function postCloudSessionEvents(
  sessionId: string,
  payload: Record<string, unknown>,
): Promise<SendRemoteEventResult> {
  return sendPayloadToRemoteSession(
    sessionId,
    payload,
    '[SessionsV2Client] POST /events',
  )
}

/**
 * leftover SessionsV2 connect URL @202068810
 * `${BASE}/v1/code/sessions/${id}/events/stream`
 */
export function cloudSessionEventsStreamUrl(
  sessionId: string,
  opts?: { fromSequenceNum?: number; controlOnly?: boolean },
): string {
  const url = new URL(
    `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/events/stream`,
  )
  if (opts?.fromSequenceNum !== undefined && opts.fromSequenceNum > 0) {
    url.searchParams.set('from_sequence_num', String(opts.fromSequenceNum))
  }
  if (opts?.controlOnly === true) {
    url.searchParams.set('control_only', '1')
  }
  return url.href
}

export type CloudEventsStreamFrame = {
  event?: string
  id?: string
  data?: string
}

export type CloudSessionStreamState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closed'

/**
 * leftover SessionsV2Client `ue` reconnect / liveness / drift / deliver
 * controller. No second WebSocket class. NEVER `export class ue`.
 */
export type CloudSessionStreamController = {
  state: CloudSessionStreamState
  lastSequenceNum: number
  reconnectAttempts: number
  exhaustedBudget: boolean
  keepRedialling: boolean
  connect: () => void
  reconnect: () => void
  close: () => void
  isConnected: () => boolean
  isRevivable: () => boolean
  reviveAfterExhaustion: () => boolean
  resetLivenessTimer: () => void
  clearLivenessTimer: () => void
  startDriftWatch: () => void
  clearDriftWatch: () => void
  handleStreamEnd: () => void
}

export type CloudEventsStreamSeams = {
  fetch?: typeof fetch
  getAccessToken?: () => string | Promise<string>
  onAuth401?: (token: string) => Promise<boolean>
  onConnected?: () => void
  onReconnecting?: () => void
  onClose?: (reason?: unknown) => void
  onError?: (err: Error) => void
  onFrame?: (frame: CloudEventsStreamFrame) => void
  onDeliver?: (
    payload: Record<string, unknown>,
    meta: Record<string, unknown>,
  ) => void
  onCatchUpTruncated?: () => void
  onToolHostEnded?: (e: { workId?: string; reason?: string }) => void
  onWorkerConnectionStatus?: (status: string) => void
  onSecurityTierRaised?: () => void
  onOwnRequestEchoed?: (
    requestId: string,
    proof: 'verified' | 'unverified' | 'unknown',
  ) => void
  renewDeviceProof?: () => void
  recoverTrustedDeviceToken?: (sentToken?: string) => Promise<boolean>
  frameState?: CloudSessionHandleFrameState
  connectTimeoutMs?: number
  stream?: Pick<
    CloudSessionStreamController,
    'resetLivenessTimer' | 'handleStreamEnd'
  > &
    Partial<
      Pick<CloudSessionStreamController, 'reconnectAttempts' | 'keepRedialling'>
    >
}

/**
 * leftover `deliver` @199856946
 * `if(!dpn((s)=>this.callbacks.onMessage(s,n),e,"SessionsV2Client"))
 *    p("remote_connect","remote_connect_frame_handler_threw")`
 */
export function leftoverDeliverCloudSessionFrame(
  seams: CloudEventsStreamSeams,
  payload: Record<string, unknown>,
  meta: Record<string, unknown>,
): boolean {
  try {
    seams.onDeliver?.(payload, meta)
    return true
  } catch (err) {
    logForDebugging(
      `[SessionsV2Client] frame handler threw: ${errorMessage(err)}`,
      { level: 'error' },
    )
    logEvent('remote_connect', {
      reason: analyticsReason('remote_connect_frame_handler_threw'),
    })
    return false
  }
}

export type CloudSessionStreamSeams = {
  connect: () => void
  keepRedialling?: () => boolean
  onClose?: () => void
  onReconnecting?: () => void
  now?: () => number
}

/**
 * leftover SessionsV2Client `ue` reconnect / liveness / drift.
 * `mt=1000,Ce=30000,K=5,vt=45000,Ee=5000`. NEVER `export class ue`.
 */
export function createCloudSessionStreamController(
  seams: CloudSessionStreamSeams,
): CloudSessionStreamController {
  let state: CloudSessionStreamState = 'idle'
  let reconnectAttempts = 0
  let exhaustedBudget = false
  let rediallingPastBudget = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let livenessTimer: ReturnType<typeof setTimeout> | null = null
  let driftTimer: ReturnType<typeof setInterval> | null = null
  let lastDriftCheck = 0
  const lastSequenceNum = { value: 0 }
  const now = () => seams.now?.() ?? Date.now()
  const keepRedialling = () => {
    try {
      return seams.keepRedialling?.() === true
    } catch {
      return false
    }
  }
  const controller: CloudSessionStreamController = {
    get state() {
      return state
    },
    set state(next) {
      state = next
    },
    get lastSequenceNum() {
      return lastSequenceNum.value
    },
    set lastSequenceNum(n) {
      lastSequenceNum.value = n
    },
    get reconnectAttempts() {
      return reconnectAttempts
    },
    get exhaustedBudget() {
      return exhaustedBudget
    },
    get keepRedialling() {
      return keepRedialling()
    },
    connect() {
      if (state === 'connecting' || state === 'connected') {
        logForDebugging('[SessionsV2Client] Already connecting/connected')
        return
      }
      state = 'connecting'
      seams.connect()
    },
    reconnect() {
      logForDebugging('[SessionsV2Client] Force reconnect')
      reconnectAttempts = 0
      exhaustedBudget = false
      controller.clearLivenessTimer()
      controller.clearDriftWatch()
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      state = 'idle'
      controller.connect()
    },
    close() {
      logForDebugging('[SessionsV2Client] Closing')
      state = 'closed'
      exhaustedBudget = false
      controller.clearLivenessTimer()
      controller.clearDriftWatch()
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    },
    isConnected() {
      return state === 'connected'
    },
    isRevivable() {
      return state === 'closed' && exhaustedBudget
    },
    reviveAfterExhaustion() {
      if (
        !(
          keepRedialling() &&
          state === 'idle' &&
          reconnectAttempts >= CLOUD_EVENTS_RECONNECT_BUDGET &&
          reconnectTimer !== null
        ) &&
        (state !== 'closed' || !exhaustedBudget)
      ) {
        return false
      }
      logEvent('remote_connect', {
        reason: analyticsReason('remote_connect_revived_by_user_send'),
      })
      controller.reconnect()
      return true
    },
    resetLivenessTimer() {
      controller.clearLivenessTimer()
      livenessTimer = setTimeout(() => {
        livenessTimer = null
        logForDebugging('[SessionsV2Client] Liveness timeout, reconnecting', {
          level: 'warn',
        })
        controller.handleStreamEnd()
      }, CLOUD_EVENTS_LIVENESS_MS)
    },
    clearLivenessTimer() {
      if (livenessTimer) {
        clearTimeout(livenessTimer)
        livenessTimer = null
      }
    },
    startDriftWatch() {
      controller.clearDriftWatch()
      lastDriftCheck = now()
      driftTimer = setInterval(() => {
        const e = now()
        const n = e - lastDriftCheck
        lastDriftCheck = e
        if (n > CLOUD_EVENTS_DRIFT_MS * 2 && state === 'connected') {
          logForDebugging(
            `[SessionsV2Client] Wall-clock drift ${n}ms — reconnecting after suspend`,
          )
          controller.reconnect()
        }
      }, CLOUD_EVENTS_DRIFT_MS)
      driftTimer.unref?.()
    },
    clearDriftWatch() {
      if (driftTimer) {
        clearInterval(driftTimer)
        driftTimer = null
      }
    },
    handleStreamEnd() {
      controller.clearLivenessTimer()
      controller.clearDriftWatch()
      if (state === 'closed') return
      const e = reconnectAttempts >= CLOUD_EVENTS_RECONNECT_BUDGET
      if (e && !keepRedialling()) {
        logForDebugging(
          `[SessionsV2Client] Reconnect budget exhausted (${CLOUD_EVENTS_RECONNECT_BUDGET}), closing`,
        )
        logEvent('remote_connect', {
          reason: analyticsReason('remote_connect_reconnect_exhausted'),
        })
        state = 'closed'
        exhaustedBudget = true
        seams.onClose?.()
        return
      }
      if (!e) reconnectAttempts++
      else if (!rediallingPastBudget) {
        rediallingPastBudget = true
        logEvent('remote_connect', {
          reason: analyticsReason('remote_connect_redialling_past_budget'),
        })
      }
      state = 'idle'
      const n = e
        ? CLOUD_EVENTS_RECONNECT_MAX_MS
        : Math.min(
            CLOUD_EVENTS_RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1),
            CLOUD_EVENTS_RECONNECT_MAX_MS,
          )
      logForDebugging(
        `[SessionsV2Client] Reconnecting in ${n}ms (attempt ${reconnectAttempts}/${keepRedialling() ? '∞' : CLOUD_EVENTS_RECONNECT_BUDGET}, from_sequence_num=${lastSequenceNum.value})`,
      )
      if (!e) seams.onReconnecting?.()
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        controller.connect()
      }, n)
    },
  }
  return controller
}

/** leftover `p` @195682000 — TextDecoder stream opt. */
const SSE_DECODE_STREAM = { stream: true } as const

/**
 * leftover `u` @195682346
 * LF=1, CR=1, CRLF=2, CR-at-end=-1 (incomplete), else 0.
 */
export function leftoverSseNewlineWidth(n: string, t: number): number {
  const e = n.charCodeAt(t)
  if (e === 10) return 1
  if (e === 13) {
    if (t + 1 >= n.length) return -1
    return n.charCodeAt(t + 1) === 10 ? 2 : 1
  }
  return 0
}

/**
 * leftover `m` @195682502 — next blank-line delimiter from `t`.
 * `{contentEnd, afterDelim}` or null if incomplete.
 */
export function leftoverSseFindFrameDelim(
  n: string,
  t: number,
): { contentEnd: number; afterDelim: number } | null {
  let e = t
  while (e < n.length) {
    const i = leftoverSseNewlineWidth(n, e)
    if (i === 0) {
      e++
      continue
    }
    if (i === -1) return null
    const r = e + i
    if (r >= n.length) return null
    const s = leftoverSseNewlineWidth(n, r)
    if (s === -1) return null
    if (s > 0) return { contentEnd: e, afterDelim: r + s }
    e = r
  }
  return null
}

/**
 * leftover `h` @195682753 — parse one SSE block (`event`/`id`/`data`).
 * Host twin of `parseSSEFrames` field parse for a single delimited block.
 */
export function leftoverParseSseBlock(
  n: string,
): CloudEventsStreamFrame | null {
  if (!/\S/.test(n)) return null
  const t: CloudEventsStreamFrame = {}
  let e = false
  for (const i of n.split(/\r\n|\r|\n/)) {
    if (i.startsWith(':')) {
      e = true
      continue
    }
    const r = i.indexOf(':')
    if (r === -1) continue
    const s = i.slice(0, r)
    const a = i[r + 1] === ' ' ? i.slice(r + 2) : i.slice(r + 1)
    switch (s) {
      case 'event':
        t.event = a
        break
      case 'id':
        t.id = a
        break
      case 'data':
        t.data = t.data ? `${t.data}\n${a}` : a
        break
    }
  }
  return t.data || e ? t : null
}

/**
 * leftover `class Sbt` @195682933 wrap. Gold `class Sbt` accepts
 * string | bytes via TextDecoder + leftover `m`/`h` drain.
 * NEVER `export class Sbt`.
 */
export class LeftoverSseFrameBuffer {
  private decoder = new TextDecoder()
  private pending = ''

  push(chunk: string | Uint8Array): CloudEventsStreamFrame[] {
    const text =
      typeof chunk === 'string'
        ? chunk
        : this.decoder.decode(chunk, SSE_DECODE_STREAM)
    if (!text) return []
    return this.drain(text)
  }

  flush(): CloudEventsStreamFrame[] {
    const tail = this.decoder.decode()
    if (tail) this.pending += tail
    const last = leftoverParseSseBlock(this.pending)
    this.pending = ''
    return last ? [last] : []
  }

  private drain(text: string): CloudEventsStreamFrame[] {
    const joined = this.pending + text
    const frames: CloudEventsStreamFrame[] = []
    let pos = 0
    for (;;) {
      const delim = leftoverSseFindFrameDelim(joined, pos)
      if (!delim) break
      const block = leftoverParseSseBlock(joined.slice(pos, delim.contentEnd))
      if (block) frames.push(block)
      pos = delim.afterDelim
    }
    this.pending = joined.slice(pos)
    return frames
  }
}

/** leftover `wSn` @199842331 */
const WORKER_OR_PASSTHROUGH_PAYLOAD_TYPES = new Set(['user', 'env_manager_log'])

/** leftover `Et` @199846040 */
const TOOL_HOST_ENDED_EVENT = 'tool_host_ended'

/** leftover `bbe` @200244346 — remote-tools subtypes that stamp attestation. */
const REMOTE_TOOL_ATTESTATION_SUBTYPES = [
  'remote_tool_call',
  'remote_plumbing_call',
  'remote_tools_probe',
  'remote_tools_reannounce',
] as const

/** leftover `yt` @199844759 */
const DEVICE_PROOF_GRADE: Record<string, 'verified' | 'unverified'> = {
  verified: 'verified',
  verified_by_gate: 'verified',
  verified_keyless_device: 'verified',
  service_vouched: 'verified',
  absent: 'unverified',
  invalid: 'unverified',
}

/** leftover `pt` @199842370 — ephemeral system subtype keep-keys. */
const EPHEMERAL_SYSTEM_KEEP_KEYS = new Map<string, readonly string[]>([
  [
    'thinking_tokens',
    ['estimated_tokens', 'estimated_tokens_delta', 'user_message_uuid'],
  ],
  [
    'post_turn_summary',
    ['summarizes_uuid', 'status_category', 'status_detail', 'needs_action'],
  ],
  ['task_summary', ['detail']],
  ['commands_changed', ['commands']],
])

export type CloudSessionHandleFrameState = {
  lastSequenceNum: number
  issuedRequestIds: Set<string>
  ownRequestUuids: Map<string, string>
  connectedSince: number
}

export type CloudSessionHandleFrameResult = {
  kind: 'deliver' | 'drop' | 'echo' | 'control' | 'ignore'
  payload?: Record<string, unknown>
  meta?: Record<string, unknown>
}

function isTypedPayload(
  e: unknown,
): e is Record<string, unknown> & { type: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'type' in e &&
    typeof (e as { type: unknown }).type === 'string'
  )
}

/** leftover `Re` subset — worker-output-shaped user text. Host xml tags only. */
function isWorkerOutputShapedText(e: string): boolean {
  return (
    e.startsWith(`<${BASH_STDOUT_TAG}`) ||
    e.startsWith(`<${BASH_STDERR_TAG}`) ||
    e.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}`) ||
    e.startsWith(`<${LOCAL_COMMAND_STDERR_TAG}`) ||
    e.includes(`<${BASH_INPUT_TAG}>`)
  )
}

/**
 * leftover `fPe` @199843546 — worker-output-shaped user frame.
 */
function isWorkerOutputShapedUser(e: Record<string, unknown>): boolean {
  if (e.tool_use_result !== undefined) return true
  const message = e.message
  if (typeof message !== 'object' || message === null) return false
  const n = (message as { content?: unknown }).content
  if (typeof n === 'string') return isWorkerOutputShapedText(n)
  return (
    Array.isArray(n) &&
    n.some(s => {
      if (typeof s !== 'object' || s === null || !('type' in s)) return false
      const row = s as { type?: unknown; text?: unknown }
      return (
        row.type === 'tool_result' ||
        (row.type === 'text' &&
          typeof row.text === 'string' &&
          isWorkerOutputShapedText(row.text))
      )
    })
  )
}

/**
 * leftover `xXe` @199843839 — malformed user content array.
 */
function isMalformedUserContent(e: Record<string, unknown>): boolean {
  const message = e.message
  if (typeof message !== 'object' || message === null) return false
  const n = (message as { content?: unknown }).content
  return (
    Array.isArray(n) &&
    !n.every(
      s =>
        typeof s === 'object' &&
        s !== null &&
        ((s as { type?: unknown }).type !== 'text' ||
          typeof (s as { text?: unknown }).text === 'string'),
    )
  )
}

/**
 * leftover `we` @199842628 — unwrap ephemeral system subtype keep-keys.
 */
function unwrapEphemeralSystem(
  e: Record<string, unknown>,
): Record<string, unknown> | null {
  const n = e.subtype
  if (e.type !== 'system' || typeof n !== 'string') return null
  const s = EPHEMERAL_SYSTEM_KEEP_KEYS.get(n)
  if (!s) return null
  const r: Record<string, unknown> = {
    type: 'system',
    subtype: n,
    uuid: e.uuid,
    session_id: e.session_id,
  }
  for (const a of s) {
    if (a in e) r[a] = e[a]
  }
  return r
}

/**
 * leftover `re` subset — stream_event.event must be a typed object.
 */
function isTypedStreamEvent(e: unknown): boolean {
  if (!isTypedPayload(e)) return false
  switch (e.type) {
    case 'message_start':
    case 'content_block_start':
    case 'content_block_delta':
    case 'content_block_stop':
    case 'message_delta':
    case 'message_stop':
      return true
    default:
      return false
  }
}

/**
 * leftover `Rt` @199844987
 * `DEVICE_ATTESTATION_STATUS_` slice + yt map.
 */
function gradeDeviceProof(e: unknown): 'verified' | 'unverified' | 'unknown' {
  if (typeof e !== 'string') return 'unknown'
  const n = e.startsWith('DEVICE_ATTESTATION_STATUS_')
    ? e.slice('DEVICE_ATTESTATION_STATUS_'.length).toLowerCase()
    : e.toLowerCase()
  return DEVICE_PROOF_GRADE[n] ?? 'unknown'
}

function clipLogToken(e: unknown): string {
  return String(e)
    .slice(0, 64)
    .replace(/[^\x20-\x7e]/g, '?')
}

/**
 * leftover `Me` @199845154 — replayed / sentAt / ageMs. ageMs omitted (no
 * gold serviceClock host).
 */
function replayMeta(
  e: Record<string, unknown>,
  connectedSince: number,
): Record<string, unknown> {
  const r =
    typeof e.created_at === 'string' ? Date.parse(e.created_at) : Number.NaN
  if (Number.isNaN(r)) return { replayed: true }
  return { sentAt: r, replayed: r < connectedSince }
}

/**
 * leftover `kt` @199845344 — hook_callback / remote-tools subtypes stamp
 * leftover `uFe` attestation. Wraps existing `normalizeDeviceAttestationStatus`.
 */
function workerAttestationMeta(
  e: Record<string, unknown>,
): Record<string, unknown> {
  const payload = e.payload
  if (!isTypedPayload(payload) || payload.type !== 'control_request') {
    return {}
  }
  const n = payload.request
  const s =
    typeof n === 'object' && n !== null && 'subtype' in n
      ? (n as { subtype?: unknown }).subtype
      : undefined
  const r = e.device_attestation_status
  if (
    !(
      s === 'hook_callback' ||
      (typeof s === 'string' &&
        (REMOTE_TOOL_ATTESTATION_SUBTYPES as readonly string[]).includes(s))
    )
  ) {
    return {}
  }
  const h = payload.remote_tool_gate
  const g =
    h === undefined || h === null
      ? undefined
      : h === 'caller_reauthored'
        ? 'present'
        : 'other'
  return {
    ...(r !== undefined &&
      r !== null && {
        attestationStatus: normalizeDeviceAttestationStatus(
          typeof r === 'string' ? r.toUpperCase() : r,
        ),
      }),
    ...(g !== undefined && { modeStamp: g }),
  }
}

/**
 * leftover `handleFrame` @199852425. Routes leftover `Sbt` frames. leftover
 * `deliver` wraps `onDeliver`. No second WebSocket class. NEVER invent gold
 * `class ue` fetch loop.
 */
export function handleCloudSessionFrame(
  event: string,
  id: string | undefined,
  data: string,
  seams: CloudEventsStreamSeams = {},
): CloudSessionHandleFrameResult {
  const state = seams.frameState
  let r: unknown
  try {
    r = jsonParse(data)
  } catch (a) {
    logForDebugging(
      `[SessionsV2Client] Failed to parse ${event} frame: ${errorMessage(a)}`,
      { level: 'error' },
    )
    logEvent('remote_connect', {
      reason: analyticsReason('remote_connect_frame_parse_failed'),
    })
    return { kind: 'drop' }
  }
  switch (event) {
    case 'client_event': {
      const a = r as Record<string, unknown>
      const h = parseInt(id ?? String(a.sequence_num), 10)
      if (!Number.isNaN(h) && state && h > state.lastSequenceNum) {
        state.lastSequenceNum = h
      }
      if (!isTypedPayload(a.payload)) {
        logForDebugging(
          `[SessionsV2Client] Dropping client_event with no payload.type (event_type=${a.event_type})`,
        )
        return { kind: 'drop' }
      }
      const payload = a.payload
      if (payload.type === 'control_response') {
        const g = payload.response
        if (
          !g ||
          typeof g !== 'object' ||
          typeof (g as { request_id?: unknown }).request_id !== 'string'
        ) {
          logForDebugging(
            `[SessionsV2Client] Dropping malformed control_response from source=${a.source}`,
            { level: 'warn' },
          )
          return { kind: 'drop' }
        }
      }
      if (payload.type === 'user') {
        if (a.source !== 'worker' && isWorkerOutputShapedUser(payload)) {
          logForDebugging(
            `[SessionsV2Client] Dropping worker-output-shaped user frame from source=${a.source} — only the worker produces tool results and execution output`,
            { level: 'warn' },
          )
          return { kind: 'drop' }
        }
        if (isMalformedUserContent(payload)) {
          logForDebugging(
            `[SessionsV2Client] Dropping user frame with malformed content from source=${a.source}`,
            { level: 'warn' },
          )
          return { kind: 'drop' }
        }
      }
      if (a.source !== 'worker') {
        if (payload.type === 'control_response') {
          const response = payload.response as {
            request_id: string
            pending_user_dialog_requests?: unknown
            pending_permission_requests?: unknown
          }
          if (state?.issuedRequestIds.has(response.request_id)) {
            logForDebugging(
              `[SessionsV2Client] Dropping control_response for this client's request_id from source=${a.source} — only the worker may answer our RPCs`,
              { level: 'warn' },
            )
            return { kind: 'drop' }
          }
          if (
            response.pending_user_dialog_requests ||
            response.pending_permission_requests
          ) {
            logForDebugging(
              `[SessionsV2Client] Stripping prompt-redelivery fields from control_response with source=${a.source}`,
            )
            const {
              pending_user_dialog_requests: _g,
              pending_permission_requests: _v,
              ...y
            } = response
            const delivered = { ...payload, response: y }
            const meta = {
              source: a.source,
              ...replayMeta(a, state?.connectedSince ?? 0),
            }
            leftoverDeliverCloudSessionFrame(seams, delivered, meta)
            return { kind: 'deliver', payload: delivered, meta }
          }
        } else if (!WORKER_OR_PASSTHROUGH_PAYLOAD_TYPES.has(payload.type)) {
          if (
            payload.type === 'control_request' &&
            typeof payload.request_id === 'string' &&
            state?.issuedRequestIds.has(payload.request_id)
          ) {
            const g = 'uuid' in payload ? payload.uuid : undefined
            if (
              typeof g !== 'string' ||
              g !== state.ownRequestUuids.get(payload.request_id)
            ) {
              logForDebugging(
                `[SessionsV2Client] A copy of own request ${clipLogToken(payload.request_id)} from source=${clipLogToken(a.source)} under another event uuid — ignored`,
              )
              return { kind: 'drop' }
            }
            const v = gradeDeviceProof(a.device_attestation_status)
            logForDebugging(
              `[SessionsV2Client] Own request ${clipLogToken(payload.request_id)} echoed from source=${clipLogToken(a.source)}: device proof ${clipLogToken(a.device_attestation_status)} (${v})`,
            )
            if (v === 'unverified') seams.renewDeviceProof?.()
            seams.onOwnRequestEchoed?.(payload.request_id, v)
            return { kind: 'echo' }
          }
          logForDebugging(
            `[SessionsV2Client] Dropping ${payload.type} from source=${a.source}`,
          )
          return { kind: 'drop' }
        }
      } else if (payload.type === 'control_response') {
        const requestId = (payload.response as { request_id?: string })
          .request_id
        if (typeof requestId === 'string') {
          state?.issuedRequestIds.delete(requestId)
          state?.ownRequestUuids.delete(requestId)
        }
      }
      const meta = {
        source: a.source,
        ...replayMeta(a, state?.connectedSince ?? 0),
        ...(a.source === 'worker' ? workerAttestationMeta(a) : {}),
      }
      leftoverDeliverCloudSessionFrame(seams, payload, meta)
      return { kind: 'deliver', payload, meta }
    }
    case 'ephemeral_event': {
      const a = r as Record<string, unknown>
      if (a?.event_type === TOOL_HOST_ENDED_EVENT) {
        const g =
          typeof a.payload === 'object' && a.payload !== null
            ? (a.payload as Record<string, unknown>)
            : {}
        const v = g.work_id
        const y = g.reason
        try {
          seams.onToolHostEnded?.({
            workId: typeof v === 'string' ? v : undefined,
            reason: typeof y === 'string' ? y : undefined,
          })
        } catch (w) {
          logForDebugging(
            `[SessionsV2Client] tool_host_ended handler threw: ${errorMessage(w)}`,
            { level: 'error' },
          )
        }
        return { kind: 'control' }
      }
      if (isTypedPayload(a.payload)) {
        const g = unwrapEphemeralSystem(a.payload)
        if (g && isTypedPayload(g)) {
          leftoverDeliverCloudSessionFrame(seams, g, {})
          return { kind: 'deliver', payload: g, meta: {} }
        }
        if (a.payload.type !== 'stream_event') {
          logForDebugging(
            `[SessionsV2Client] Dropping ${a.payload.type} on ephemeral channel`,
          )
          return { kind: 'drop' }
        }
        if (!isTypedStreamEvent(a.payload.event)) {
          logForDebugging(
            '[SessionsV2Client] Dropping malformed stream_event on ephemeral channel',
            { level: 'warn' },
          )
          return { kind: 'drop' }
        }
        leftoverDeliverCloudSessionFrame(seams, a.payload, {})
        return { kind: 'deliver', payload: a.payload, meta: {} }
      }
      return { kind: 'drop' }
    }
    case 'catch_up_truncated':
      logForDebugging('[SessionsV2Client] catch_up_truncated — transcript gap')
      logEvent('remote_connect', {
        reason: analyticsReason('remote_catch_up_truncated'),
      })
      seams.onCatchUpTruncated?.()
      return { kind: 'control' }
    case 'session_update': {
      const a = (r as { connection_status?: unknown } | undefined)
        ?.connection_status
      if (typeof a === 'string') {
        try {
          seams.onWorkerConnectionStatus?.(a)
        } catch (h) {
          logForDebugging(
            `[SessionsV2Client] worker connection status handler threw: ${errorMessage(h)}`,
            { level: 'error' },
          )
        }
      } else {
        logForDebugging('[SessionsV2Client] Ignoring session_update frame')
      }
      return { kind: 'control' }
    }
    case 'security_update': {
      const a = (r as { security_tier?: unknown } | undefined)?.security_tier
      logForDebugging(
        `[SessionsV2Client] security_update: tier ${typeof a === 'string' ? clipLogToken(a) : typeof a}`,
      )
      if (a === 'elevated') {
        try {
          seams.onSecurityTierRaised?.()
        } catch (h) {
          logForDebugging(
            `[SessionsV2Client] security tier handler threw: ${errorMessage(h)}`,
            { level: 'error' },
          )
        }
      }
      return { kind: 'control' }
    }
    case 'delivery_update':
      logForDebugging(`[SessionsV2Client] Ignoring ${event} frame`)
      return { kind: 'ignore' }
    default:
      logForDebugging(`[SessionsV2Client] Unknown SSE event type '${event}'`, {
        level: 'warn',
      })
      return { kind: 'ignore' }
  }
}

/**
 * leftover `Bt` @199899933
 * `typeof e==="object"&&e!==null&&e.go===!1&&typeof e.reason==="string"`
 */
export function isSendGateWithhold(e: unknown): e is {
  go: false
  reason: string
} {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { go?: unknown }).go === false &&
    typeof (e as { reason?: unknown }).reason === 'string'
  )
}

/**
 * leftover `zt` @199899723. Gate throw → warn, message goes anyway.
 * Only `{go:false, reason:string}` withholds. NEVER `export function zt`.
 */
export function runSendGate(
  gate: (item: unknown) => Promise<unknown>,
  item: unknown,
): Promise<unknown> {
  const s = (r: unknown) => {
    logForDebugging(
      `[RemoteSessionManager] send gate failed, message goes anyway: ${errorMessage(r)}`,
      { level: 'warn' },
    )
  }
  try {
    return gate(item).then(r => (isSendGateWithhold(r) ? r : undefined), s)
  } catch (r) {
    return Promise.resolve(s(r))
  }
}

/**
 * leftover `Fe` @199899999
 * `{ok:!1,reason:e.reason,withheld:!0}`
 */
export function wrapSendGateWithheld(e: { reason: string }): {
  ok: false
  reason: string
  withheld: true
} {
  return { ok: false, reason: e.reason, withheld: true }
}

function analyticsReason(
  reason: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * leftover SessionsV2 `readStream` @202071152
 * GET `/events/stream` with `Accept: text/event-stream`. CALL leftover `Sbt`
 * wrap (`u`/`m`/`h`). No second WebSocket class.
 */
export async function readCloudSessionEventsStream(
  href: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  seams: CloudEventsStreamSeams = {},
): Promise<void> {
  const doFetch = seams.fetch ?? fetch
  const timeoutMs =
    seams.connectTimeoutMs ?? CLOUD_EVENTS_STREAM_CONNECT_TIMEOUT_MS
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const requestHeaders = { ...headers, Accept: 'text/event-stream' }
  let response: Response
  try {
    response = await doFetch(href, {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (timedOut) {
      logForDebugging(
        `[SessionsV2Client] Connect timed out after ${timeoutMs}ms, reconnecting`,
        { level: 'error' },
      )
      logEvent('remote_connect', {
        reason: analyticsReason('remote_connect_timeout'),
      })
      return
    }
    if (signal.aborted || controller.signal.aborted) return
    logForDebugging(`[SessionsV2Client] Connect error: ${errorMessage(err)}`, {
      level: 'error',
    })
    logEvent('remote_connect', {
      reason: analyticsReason('remote_connect_request_failed'),
    })
    seams.onError?.(err instanceof Error ? err : new Error(errorMessage(err)))
    return
  }
  if (!response.ok || response.body === null) {
    logForDebugging(
      `[SessionsV2Client] HTTP ${response.status} on SSE connect`,
      { level: 'error' },
    )
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (response.status === 401 && seams.onAuth401) {
      logForDebugging('[SessionsV2Client] 401 on SSE connect — refreshing')
      logEvent('remote_connect', {
        reason: analyticsReason('remote_connect_auth_401'),
      })
      const token = seams.getAccessToken ? await seams.getAccessToken() : ''
      const refreshed = await seams.onAuth401(token)
      if (signal.aborted || controller.signal.aborted) return
      if (
        !refreshed &&
        (seams.stream?.reconnectAttempts ?? 0) >=
          CLOUD_EVENTS_RECONNECT_BUDGET &&
        seams.stream?.keepRedialling === true
      ) {
        logEvent('remote_connect', {
          reason: analyticsReason('remote_connect_reconnect_exhausted'),
        })
        seams.onClose?.()
        return
      }
      seams.stream?.handleStreamEnd()
      return
    }
    if (response.status === 403) {
      let body: unknown
      try {
        body = await response.clone().json()
      } catch {
        body = undefined
      }
      const reason = extractBridge403Resource(body, extractErrorDetail(body))
      if (reason === 'untrusted_device') {
        const sent = requestHeaders[TRUSTED_DEVICE_TOKEN_HEADER]
        const recovered = await seams.recoverTrustedDeviceToken?.(sent)
        if (recovered) {
          logForDebugging(
            '[SessionsV2Client] untrusted_device on SSE connect — re-enrolled, reconnecting',
          )
          logEvent('remote_connect', {
            reason: analyticsReason('remote_connect_untrusted_device'),
          })
          seams.stream?.handleStreamEnd()
          return
        }
      }
    }
    if (CLOUD_EVENTS_STREAM_PERMANENT_HTTP.has(response.status)) {
      logEvent('remote_connect', {
        reason: analyticsReason('remote_connect_permanent_failure'),
      })
      seams.onClose?.()
      return
    }
    logEvent('remote_connect', {
      reason: analyticsReason('remote_connect_http_error'),
    })
    return
  }
  clearTimeout(timer)
  logForDebugging('[SessionsV2Client] Connected')
  logEvent('remote_connect', { reason: analyticsReason('ok') })
  seams.onConnected?.()
  seams.stream?.resetLivenessTimer()
  const reader = response.body.getReader()
  const buffer = new LeftoverSseFrameBuffer()
  const emit = (frame: CloudEventsStreamFrame) => {
    // leftover `readStream`: `for (T of y.push(b)) if (this.resetLivenessTimer(), T.event&&T.data) handleFrame`
    seams.stream?.resetLivenessTimer()
    if (!(frame.event && frame.data)) return
    seams.onFrame?.(frame)
    handleCloudSessionFrame(frame.event, frame.id, frame.data, seams)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      for (const frame of buffer.push(value)) emit(frame)
    }
    for (const frame of buffer.flush()) emit(frame)
  } catch (err) {
    if (signal.aborted || controller.signal.aborted) return
    logForDebugging(
      `[SessionsV2Client] Stream read error: ${errorMessage(err)}`,
      { level: 'error' },
    )
    logEvent('remote_connect', {
      reason: analyticsReason('remote_connect_stream_error'),
    })
  } finally {
    reader.releaseLock()
    signal.removeEventListener('abort', onAbort)
  }
  if (!signal.aborted && !controller.signal.aborted) {
    logForDebugging('[SessionsV2Client] Stream ended')
    seams.stream?.handleStreamEnd()
  }
}

export type CloudSessionEventsClientConfig = {
  sessionId: string
  orgUuid: string
  getAccessToken: () => string | Promise<string>
  fromSequenceNum?: number
  controlOnly?: boolean
  keepRedialling?: () => boolean
  authHeaders?: () => Promise<Record<string, string>>
}

/**
 * leftover SessionsV2Client `class ue` @199846147 connect loop.
 * `async connect()` builds `/events/stream` URL + `Accept: text/event-stream`
 * + `Last-Event-ID`, then CALL leftover `readStream`. leftover
 * `loadTrustedDeviceToken` / `authHeaders` wrap existing `gy` (`getTrustedDeviceTokenIfGateOn`)
 * behind leftover `Wd` (`isViolinWoodEnabled`). leftover `recoverTrustedDeviceToken`
 * wraps leftover `Xle`. NEVER `export class ue`. No Far key store.
 */
export function createCloudSessionEventsClient(
  config: CloudSessionEventsClientConfig,
  callbacks: CloudEventsStreamSeams = {},
): CloudSessionStreamController {
  let abort: AbortController | null = null
  let trustedDeviceToken: Promise<string> | undefined
  const loadTrustedDeviceToken = (): Promise<string> => {
    let e: Promise<string> | undefined
    const n = () => {
      if (trustedDeviceToken === e) trustedDeviceToken = undefined
    }
    const s = (async () => {
      try {
        const r = (await isViolinWoodEnabled())
          ? ((await getTrustedDeviceTokenIfGateOn()) ?? '')
          : ''
        if (!r) n()
        return r
      } catch (err) {
        n()
        logForDebugging(
          `[SessionsV2Client] trusted-device token unavailable, sending no td-v1 header: ${errorMessage(err)}`,
        )
        return ''
      }
    })()
    e = s
    return s
  }
  const recoverTrustedDeviceToken = async (sent?: string): Promise<boolean> => {
    try {
      if (!(await isViolinWoodEnabled())) return false
      const n = await recoverTrustedDeviceTokenAfterUntrusted(sent)
      if (!n) return false
      trustedDeviceToken = Promise.resolve(n)
      return true
    } catch (err) {
      logForDebugging(
        `[SessionsV2Client] trusted-device re-enrollment failed: ${errorMessage(err)}`,
      )
      return false
    }
  }
  const defaultAuthHeaders = async (): Promise<Record<string, string>> => {
    const e = await (trustedDeviceToken ??= loadTrustedDeviceToken())
    const token = await config.getAccessToken()
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-client-platform': getAnthropicClientPlatform(),
      'x-organization-uuid': config.orgUuid,
      'User-Agent': getClaudeCodeUserAgent(),
      ...(e ? { [TRUSTED_DEVICE_TOKEN_HEADER]: e } : {}),
    }
  }
  const doConnect = () => {
    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal
    const href = cloudSessionEventsStreamUrl(config.sessionId, {
      fromSequenceNum: controller.lastSequenceNum || config.fromSequenceNum,
      controlOnly: config.controlOnly,
    })
    void (async () => {
      let headers: Record<string, string>
      try {
        headers = config.authHeaders
          ? await config.authHeaders()
          : await defaultAuthHeaders()
      } catch (err) {
        if (signal.aborted) return
        logForDebugging(
          `[SessionsV2Client] Could not build the stream's credentials: ${errorMessage(err)}`,
          { level: 'error' },
        )
        controller.handleStreamEnd()
        return
      }
      if (signal.aborted) return
      if (controller.lastSequenceNum > 0) {
        headers['Last-Event-ID'] = String(controller.lastSequenceNum)
      }
      logForDebugging(
        `[SessionsV2Client] Connecting to ${href} (from_sequence_num=${controller.lastSequenceNum})`,
      )
      await readCloudSessionEventsStream(href, headers, signal, {
        ...callbacks,
        getAccessToken: config.getAccessToken,
        recoverTrustedDeviceToken:
          callbacks.recoverTrustedDeviceToken ?? recoverTrustedDeviceToken,
        stream: controller,
        frameState: {
          lastSequenceNum: controller.lastSequenceNum,
          issuedRequestIds: new Set(),
          ownRequestUuids: new Map(),
          connectedSince: Date.now(),
        },
        onConnected: () => {
          controller.state = 'connected'
          controller.startDriftWatch()
          callbacks.onConnected?.()
        },
        onClose: reason => {
          callbacks.onClose?.(reason)
        },
      })
    })()
  }
  const controller = createCloudSessionStreamController({
    connect: doConnect,
    keepRedialling: config.keepRedialling,
    onClose: () => callbacks.onClose?.(),
    onReconnecting: () => callbacks.onReconnecting?.(),
  })
  const close = controller.close.bind(controller)
  controller.close = () => {
    abort?.abort()
    abort = null
    close()
  }
  return controller
}

/**
 * leftover `gPe` send-gate / held-send / postControlRequest BODY wrap.
 * Host methods that exist on RemoteSessionManager are forwarded.
 * Held-send ledger + sendGates are local (gold `this.heldSends` / `this.sendGates`).
 */
function createHeadlessManagerLedger(
  host?: RemoteSessionManager,
): HeadlessRemoteManager {
  const heldSends = new Set<HeadlessHeldSend>()
  const sendGates = new Set<HeadlessSendGate>()
  const sendsInFlight = new Set<Promise<unknown>>()
  let exitFlushRequested = false
  let chainedSends = 0
  let lastHeld: { issued: Promise<unknown>; posted: Promise<unknown> } = {
    issued: Promise.resolve(),
    posted: Promise.resolve(),
  }

  const manager: HeadlessRemoteManager = {
    connect: () => host?.connect(),
    disconnect: () => host?.disconnect(),
    reconnect: () => host?.reconnect(),
    async releaseHeldSends(
      timeoutMs = RELEASE_HELD_SENDS_TIMEOUT_MS,
      opts: { exiting?: boolean; final?: boolean; keepWithheld?: boolean } = {},
    ) {
      const n = opts.exiting === true
      const s = opts.final === true
      const r = opts.keepWithheld === true
      if (n) exitFlushRequested = true
      const a = [...heldSends].filter(g => !(r && g.withheldOnRelease()))
      a.forEach(g => g.release(n, s))
      const h: Array<{ kind: string; reason?: unknown }> = a.map(() => ({
        kind: 'waiting',
      }))
      await Promise.race([
        Promise.allSettled(
          a.map((g, v) =>
            g.posted.then(
              () => {
                h[v] = { kind: 'ok' }
              },
              () => {
                h[v] = { kind: 'unconfirmed' }
              },
            ),
          ),
        ),
        new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
      ])
      a.forEach((g, v) => {
        if (h[v]?.kind !== 'waiting') return
        if (g.issuedYet()) h[v] = { kind: 'unconfirmed' }
        else if (s) {
          g.withdraw()
          h[v] = { kind: 'unsent' }
        }
      })
      return {
        unsent: h.filter(g => g.kind === 'unsent').length,
        refused: h.flatMap(g => (g.kind === 'refused' ? [g.reason] : [])),
        unconfirmed: h.filter(g => g.kind === 'unconfirmed').length,
        stillHeld: h.filter(g => g.kind === 'waiting').length,
      }
    },
    async flushSends(timeoutMs: number) {
      if (sendsInFlight.size === 0) return
      await Promise.race([
        Promise.allSettled([...sendsInFlight]),
        new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
      ])
    },
    async sendBehindGates(send, opts = {}) {
      chainedSends += 1
      let exiting = false
      let final = false
      let issued = false
      let withheld: unknown
      let releaseResolve = () => {}
      const released = new Promise<void>(resolve => {
        releaseResolve = resolve
      })
      let withdrawResolve = () => {}
      const withdrawn = new Promise<void>(resolve => {
        withdrawResolve = resolve
      })
      const gates = [...sendGates]
      const bag = {
        messageUuid: opts.messageUuid,
        submittedAtMs: opts.submittedAtMs,
        released,
        withdrawn,
        exiting: () => exiting,
        final: () => final,
      }
      const gatePromises = gates.map(gate => runSendGate(gate.gate, bag))
      const firstDefinedGate = new Promise<unknown>(resolve => {
        for (const pending of gatePromises) {
          void pending.then(value => {
            if (value !== undefined) resolve(value)
          })
        }
      })
      const withheldRace =
        gates.length === 0
          ? Promise.resolve(undefined)
          : Promise.race([
              Promise.all(gatePromises).then(rows =>
                rows.find(row => row !== undefined),
              ),
              firstDefinedGate,
              released.then(() => undefined),
              withdrawn.then(() => 'withdrawn' as unknown),
            ])
      const prev = lastHeld
      let issuedResolve = () => {}
      const issuedP = new Promise<void>(resolve => {
        issuedResolve = resolve
      })
      const posted = withheldRace.then(async reason => {
        withheld = reason
        if (isSendGateWithhold(reason)) return wrapSendGateWithheld(reason)
        if (reason !== undefined) return reason
        await Promise.race([prev.posted, released.then(() => prev.issued)])
        issued = true
        issuedResolve()
        return send()
      })
      lastHeld = {
        issued: issuedP,
        posted: posted.then(
          () => {},
          () => {},
        ),
      }
      const tracked = posted.finally(() => {
        sendsInFlight.delete(tracked)
      })
      sendsInFlight.add(tracked)
      const item: HeadlessHeldSend = {
        messageUuid: opts.messageUuid,
        release: (ex, fin) => {
          exiting = ex
          final = fin
          releaseResolve()
        },
        withheldOnRelease: () => withheld !== undefined,
        posted: tracked,
        issuedYet: () => issued,
        withdraw: () => {
          withdrawResolve()
        },
      }
      heldSends.add(item)
      try {
        return await tracked
      } finally {
        chainedSends -= 1
        heldSends.delete(item)
      }
    },
    heldSendCount: () => heldSends.size,
    chainedSendCount: () => chainedSends,
    postControlRequest(request, opts) {
      const { promise: posted, resolve } = Promise.withResolvers<
        { outcome: string; cause?: string } | { outcome: 'accepted' }
      >()
      const response = (async () => {
        try {
          if (opts?.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }
          if (host === undefined) {
            resolve({ outcome: 'accepted' })
            return {}
          }
          if (!host.isConnected()) {
            throw new Error('[RemoteSessionManager] Cannot send: not connected')
          }
          if (request.subtype === 'interrupt') host.cancelSession()
          else
            host.sendControl(
              request as Parameters<RemoteSessionManager['sendControl']>[0],
            )
          resolve({ outcome: 'accepted' })
          return {}
        } catch (err) {
          if (isAbortError(err)) resolve(REMOTE_CONTROL_CLOSED)
          else {
            logForDebugging('[RemoteSessionManager] Cannot send: not connected')
            resolve(REMOTE_CONTROL_CLOSED)
          }
          return REMOTE_CONTROL_CLOSED
        }
      })()
      return { posted, response }
    },
    sendControlRequest: async (request, opts) =>
      manager.postControlRequest(request as never, opts).response,
    addSendGate(gate, opts = {}) {
      const s: HeadlessSendGate = {
        gate,
        onRelease: opts.onRelease ?? 'send',
        onExit: opts.onExit ?? 'as_release',
      }
      sendGates.add(s)
      return () => {
        sendGates.delete(s)
      }
    },
  }
  void exitFlushRequested
  return manager
}
