/**
 * Official 2.1.328 CCR v2 SSE client (`class Te` in `chunk@318978761.js @16000-40000`)
 * and incremental SSE frame parser (`kRe` in `chunk@300628859.js`).
 *
 * Transport:
 * - Inbound stream: `GET /v1/code/sessions/{sessionId}/events/stream`
 *   with `from_sequence_num`, `Last-Event-ID`, optional `control_only=1`,
 *   and `X-Trusted-Device-Token` with automatic 403 `untrusted_device` recovery.
 * - Outbound events: `POST /v1/code/sessions/{sessionId}/events`
 *   returning `{ sequence_num }`.
 * - Watchdogs: 45s liveness timeout, 5s wall-clock drift detection for OS suspend,
 *   and `keepRedialling` infinite backoff mode when serving tools/asks.
 */

import { randomUUID } from 'crypto'
import { validateBridgeId } from '../bridge/bridgeApi.js'
import {
  clearTrustedDeviceTokenCache,
  getTrustedDeviceTokenIfGateOn,
  isTrustedDeviceGateEnabled,
  recoverTrustedDeviceTokenAfterUntrusted,
} from '../bridge/trustedDevice.js'
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlRequest,
  SDKControlRequestInner,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import {
  isRemoteToolsServedSubtype,
  normalizeServedAttestationStatus,
} from '../services/tools/remoteToolServe.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage, toError } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { getProxyFetchOptions } from '../utils/proxy.js'
import {
  getActiveSessionFromAls,
  runWithSession,
  type Session,
} from '../utils/sessionRoot.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { getAnthropicClientPlatform } from '../utils/teleport/api.js'
import { getClaudeCodeUserAgent } from '../utils/userAgent.js'

// ── Official 2.1.328 timing & budget constants ──────────────────────────────
// chunk@318978761.js & chunk@318686980.js
export const SESSIONS_V2_CONNECT_TIMEOUT_MS = 30_000
export const SESSIONS_V2_POST_TIMEOUT_MS = 30_000
export const SESSIONS_V2_LIVENESS_TIMEOUT_MS = 45_000
export const SESSIONS_V2_DRIFT_CHECK_INTERVAL_MS = 5_000
export const SESSIONS_V2_RECONNECT_BASE_MS = 1_000
export const SESSIONS_V2_RECONNECT_CAP_MS = 30_000
export const SESSIONS_V2_MAX_RECONNECT_ATTEMPTS = 5
export const SESSIONS_V2_MARK_DOWN_THRESHOLD_MS = 30_000
export const SESSIONS_V2_REPLAY_WINDOW_MS = 2_000
export const SESSIONS_V2_MAX_ISSUED_REQUEST_IDS = 500
/** Maximum single SSE frame byte length (3 MiB) to bound memory on malformed/hostile streams. */
export const SESSIONS_V2_MAX_FRAME_BYTES = 3_145_728
const MAX_ERROR_BODY_BYTES = 4_096
const REMOTE_TOOL_RESULT_TOO_LARGE = 'remote_tool_result_too_large'
const TOOL_HOST_ENDED_EVENT_TYPE = 'tool_host_ended'
const PERMANENT_HTTP_CODES = new Set([401, 403, 404])
const ALLOWED_NON_WORKER_TYPES = new Set(['user', 'env_manager_log'])
const ALLOWED_EPHEMERAL_SYSTEM_SUBTYPES = new Map<string, readonly string[]>([
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

// ── Incremental SSE parser (official `kRe` in chunk@300628859.js) ──────────

export type ParsedSseEvent =
  | {
      kind: 'event'
      event?: string
      id?: string
      data?: string
      retry?: number
    }
  | { kind: 'comment'; text: string }
  | { kind: 'tooLarge' }

export type SseParserState = {
  pendingBytes: number
  fields:
    | {
        kind: 'event'
        event?: string
        id?: string
        data?: string
        retry?: number
      }
    | undefined
  comment: string | undefined
  line: Uint8Array
  lineBytes: number
  skipping: boolean
  afterCarriageReturn: boolean
  pastFirstLine: boolean
}

const EMPTY_UINT8 = new Uint8Array(0)
const SSE_INITIAL_STATE: SseParserState = {
  pendingBytes: 0,
  fields: undefined,
  comment: undefined,
  line: EMPTY_UINT8,
  lineBytes: 0,
  skipping: false,
  afterCarriageReturn: false,
  pastFirstLine: false,
}
const UTF8_DECODER = new TextDecoder()

function concatLine(
  existing: Uint8Array,
  existingLen: number,
  extra: Uint8Array,
): Uint8Array {
  if (existingLen === 0) {
    const copy = new Uint8Array(extra.length)
    copy.set(extra)
    return copy
  }
  const combined = new Uint8Array(existingLen + extra.length)
  combined.set(existing.subarray(0, existingLen), 0)
  combined.set(extra, existingLen)
  return combined
}

/**
 * Official 2.1.328 `kRe` incremental Server-Sent Events byte-chunk parser.
 * Supports LF, CRLF, CR line endings, UTF-8 BOM stripping, comments,
 * multi-line `data:` joining, `id:` NUL filtering, `retry:`, and `maxFrameBytes`.
 */
export function parseSseChunk(
  prevState: SseParserState | undefined,
  chunk: Uint8Array,
  maxFrameBytes: number = Number.POSITIVE_INFINITY,
): { state: SseParserState; events: ParsedSseEvent[] } {
  const events: ParsedSseEvent[] = []
  const state = prevState ?? SSE_INITIAL_STATE
  if (chunk.length === 0) {
    return { state, events }
  }

  let { comment, line, lineBytes, skipping, pastFirstLine } = state
  let fields = state.fields ? { ...state.fields } : undefined
  let pendingBytes = state.pendingBytes - lineBytes
  const startOffset = state.afterCarriageReturn && chunk[0] === 10 ? 1 : 0
  const lastLf = chunk.lastIndexOf(10)
  const endLineIdx =
    (chunk.includes(13, lastLf + 1) ? chunk.lastIndexOf(13) : lastLf) + 1

  if (endLineIdx > startOffset) {
    let slice =
      endLineIdx - startOffset === chunk.length
        ? chunk
        : chunk.subarray(startOffset, endLineIdx)
    let skipEmptyContinuation = skipping && lineBytes > 0
    if (lineBytes > 0 && !skipping) {
      slice = concatLine(line, lineBytes, slice).subarray(
        0,
        lineBytes + slice.length,
      )
    }
    line = EMPTY_UINT8
    lineBytes = 0

    const text = UTF8_DECODER.decode(slice)
    const isAscii = text.length === slice.length
    let nextLf = -1
    let nextCr = -1
    let nextColon = -1
    let charIdx = 0
    let byteIdx = 0

    while (charIdx < text.length) {
      if (nextLf < charIdx) {
        const idx = text.indexOf('\n', charIdx)
        nextLf = idx === -1 ? text.length : idx
      }
      if (nextCr < charIdx) {
        const idx = text.indexOf('\r', charIdx)
        nextCr = idx === -1 ? text.length : idx
      }
      const lineEnd = Math.min(nextLf, nextCr)
      const endByte = isAscii
        ? lineEnd
        : slice.indexOf(text.charCodeAt(lineEnd), byteIdx)
      const lineByteLen = endByte - byteIdx + 1
      const eolLen = lineEnd === nextCr && nextLf === lineEnd + 1 ? 2 : 1

      if (!pastFirstLine && text.charCodeAt(charIdx) === 0xfeff) {
        charIdx++
      }
      pastFirstLine = true

      if (charIdx === lineEnd && !skipEmptyContinuation) {
        if (comment !== undefined) {
          events.push({ kind: 'comment', text: comment })
        }
        if (fields !== undefined) {
          events.push(fields)
        }
        comment = undefined
        fields = undefined
        pendingBytes = 0
        skipping = false
      } else if (!skipping) {
        if (nextColon < charIdx) {
          const idx = text.indexOf(':', charIdx)
          nextColon = idx === -1 ? text.length : idx
        }
        if (pendingBytes + lineByteLen > maxFrameBytes) {
          events.push({ kind: 'tooLarge' })
          fields = undefined
          skipping = true
        } else if (nextColon === charIdx) {
          comment = text.slice(charIdx + 1, lineEnd)
        } else {
          pendingBytes += lineByteLen
          fields ??= { kind: 'event' }
          const fieldName =
            nextColon < lineEnd ? text.slice(charIdx, nextColon) : ''
          const valueStart =
            nextColon < lineEnd
              ? nextColon + (text.charCodeAt(nextColon + 1) === 32 ? 2 : 1)
              : lineEnd
          const value = text.slice(valueStart, lineEnd)
          switch (fieldName) {
            case 'data':
              fields.data =
                fields.data === undefined ? value : `${fields.data}\n${value}`
              break
            case 'event':
              fields.event = value
              break
            case 'id':
              if (!value.includes('\0')) {
                fields.id = value
              }
              break
            case 'retry':
              if (/^[0-9]+$/.test(value)) {
                fields.retry = Number(value)
              }
              break
          }
        }
      }

      skipEmptyContinuation = false
      charIdx = lineEnd + eolLen
      byteIdx = endByte + eolLen
    }
  }

  const tailStart = Math.max(startOffset, endLineIdx)
  const tailLen = chunk.length - tailStart
  if (!skipping && pendingBytes + lineBytes + tailLen > maxFrameBytes) {
    events.push({ kind: 'tooLarge' })
    fields = undefined
    skipping = true
  }
  if (skipping) {
    line = EMPTY_UINT8
  } else if (tailLen > 0) {
    line = concatLine(line, lineBytes, chunk.subarray(tailStart))
  }
  lineBytes += tailLen

  return {
    state: {
      pendingBytes: pendingBytes + lineBytes,
      fields,
      comment,
      line,
      lineBytes,
      skipping,
      afterCarriageReturn: chunk.at(-1) === 13,
      pastFirstLine,
    },
    events,
  }
}

// ── Untrusted-device 403 refusal classification (official `gce`/`Bur`/`wtt`) ─

export type UntrustedDeviceRefusal =
  | { kind: 'token_refused' }
  | { kind: 'signature_wanted'; subReason: string }
  | { kind: 'unrecognized'; subReason: string }

const SNAKE_CASE_REASON = /^[a-z0-9_]{1,64}$/

export function parseUntrustedDeviceRefusal(
  data: unknown,
): UntrustedDeviceRefusal | undefined {
  if (data === null || typeof data !== 'object' || !('error' in data)) {
    return undefined
  }
  const err = (data as { error?: unknown }).error
  if (err === null || typeof err !== 'object') {
    return undefined
  }
  const rec = err as {
    reason?: unknown
    resource?: unknown
    sub_reason?: unknown
  }
  const isUntrusted =
    rec.reason === 'untrusted_device' || rec.resource === 'untrusted_device'
  if (!isUntrusted) {
    return undefined
  }
  const sub = rec.sub_reason
  if (sub === undefined || sub === null || sub === '') {
    return { kind: 'token_refused' }
  }
  if (typeof sub !== 'string') {
    return { kind: 'unrecognized', subReason: `(${typeof sub}, not a string)` }
  }
  switch (sub) {
    case 'bound_unattested':
      return { kind: 'token_refused' }
    case 'served_call_unsigned':
      return { kind: 'signature_wanted', subReason: sub }
    default:
      if (SNAKE_CASE_REASON.test(sub)) {
        return { kind: 'unrecognized', subReason: sub }
      }
      return {
        kind: 'unrecognized',
        subReason: '(string, too long or not snake_case)',
      }
  }
}

/** Official `Bur(e)` — whether SessionsV2Client should attempt device token re-enrollment. */
export function isRecoverableUntrustedRefusal(
  refusal: UntrustedDeviceRefusal,
): boolean {
  return (
    refusal.kind === 'token_refused' ||
    (refusal.kind === 'unrecognized' &&
      refusal.subReason === 'trusted_device_required')
  )
}

/** Official `wtt(e)` — whether Bridge API should attempt enroll_and_retry. */
export function isBridgeEnrollableUntrustedRefusal(
  refusal: UntrustedDeviceRefusal,
): boolean {
  return refusal.kind !== 'signature_wanted'
}

// ── Public types ──────────────────────────────────────────────────────────

export type SessionsV2Message =
  | SDKMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest

export type SessionsV2ConnectInfo = {
  gapMs: number
  driftRedial: boolean
}

export type SessionsV2DeliveryUpdate = {
  eventId: string
  status: string
}

export type SessionsV2ToolHostEnded = {
  workId?: string
  reason?: string
}

export type SessionsV2EventPostOutcome =
  | {
      outcome: 'accepted'
      sequence_num: number
      signMs: number
      postMs: number
    }
  | { outcome: 'session_inactive' }
  | {
      outcome: 'failed'
      cause: 'closed' | 'http' | 'timeout' | 'network'
      status?: number
      tooLarge?: boolean
    }

export type SessionsV2EventSigner = (
  sessionId: string,
  event: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>

export type SessionsV2ClientCallbacks = {
  onMessage: (
    message: SessionsV2Message,
    extras?: Record<string, unknown>,
  ) => void
  onClose?: (reason?: string) => void
  onError?: (error: Error) => void
  onConnected?: (info: SessionsV2ConnectInfo) => void
  onReconnecting?: () => void
  onStreamSilent?: (info: { suspended: boolean }) => void
  onDeliveryUpdate?: (update: SessionsV2DeliveryUpdate) => void
  onWorkerConnectionStatus?: (status: string) => void
  onSecurityTierRaised?: () => void
  onToolHostEnded?: (info: SessionsV2ToolHostEnded) => void
  onCatchUpTruncated?: () => void
  onOwnRequestEchoed?: (
    requestId: string,
    attestation: 'verified' | 'unverified' | 'unknown',
  ) => void
  onStoredControlFrame?: (frame: {
    payload: SessionsV2Message
    source?: string
    sequenceNum?: number
  }) => void
}

export type SessionsV2ClientOptions = {
  trackSends?: boolean
  keepRedialling?: () => boolean
  eventSigner?: SessionsV2EventSigner
  controlOnly?: boolean
  withholdTrustedDeviceToken?: boolean
  /** Override API base URL (defaults to `getOauthConfig().BASE_API_URL`). */
  baseApiUrl?: string
  /** Override fetch implementation (defaults to `globalThis.fetch` + proxy options). */
  fetchFn?: typeof globalThis.fetch
  /** Override trusted-device token reader. */
  getTrustedDeviceToken?: () => Promise<string | undefined> | string | undefined
  /** Override 403 `untrusted_device` re-enrollment recovery callback. */
  recoverTrustedDeviceToken?: (
    previousToken?: string,
  ) => Promise<string | undefined>
  /** Optional timer overrides (for tests). */
  connectTimeoutMs?: number
  livenessTimeoutMs?: number
  driftCheckIntervalMs?: number
  reconnectBaseMs?: number
  reconnectCapMs?: number
}

// ── Internal helpers ──────────────────────────────────────────────────────

type ServiceClock = {
  serviceMs: number
  wallMs: number
  monotonicMs: number
}

type ClientState = 'idle' | 'connecting' | 'connected' | 'closed'
type ClosedCause = 'deliberate' | 'exhausted' | 'permanentHttp' | null

function isSessionsV2Message(value: unknown): value is SessionsV2Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function advanceServiceClock(clock: ServiceClock, floorMs: number): number {
  const wall = Date.now()
  const monotonic = performance.now()
  const estimated =
    clock.serviceMs +
    Math.max(wall - clock.wallMs, monotonic - clock.monotonicMs)
  if (floorMs > estimated) {
    clock.serviceMs = floorMs
    clock.wallMs = wall
    clock.monotonicMs = monotonic
    return floorMs
  }
  return estimated
}

function computeReconnectDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
): number {
  const raw = Number.isFinite(attempt)
    ? Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1))
    : capMs
  const jitter = (Math.random() * 2 - 1) * 0.25 * raw
  return Math.max(0, raw + jitter)
}

function normalizeAttestationOutcome(
  raw: unknown,
): 'verified' | 'unverified' | 'unknown' {
  if (typeof raw !== 'string') return 'unknown'
  const lower = raw.startsWith('DEVICE_ATTESTATION_STATUS_')
    ? raw.slice('DEVICE_ATTESTATION_STATUS_'.length).toLowerCase()
    : raw.toLowerCase()
  switch (lower) {
    case 'verified':
    case 'verified_by_gate':
    case 'verified_keyless_device':
    case 'service_vouched':
      return 'verified'
    case 'absent':
    case 'invalid':
      return 'unverified'
    default:
      return 'unknown'
  }
}

function extractFrameTimingExtras(
  frame: Record<string, unknown>,
  connectedSince: number,
  serviceClock: ServiceClock | undefined,
): Record<string, unknown> {
  const createdAt =
    typeof frame.created_at === 'string' ? Date.parse(frame.created_at) : NaN
  if (Number.isNaN(createdAt)) {
    return { replayed: true }
  }
  return {
    sentAt: createdAt,
    replayed: createdAt < connectedSince + SESSIONS_V2_REPLAY_WINDOW_MS,
    ...(serviceClock !== undefined && {
      ageMs: advanceServiceClock(serviceClock, createdAt) - createdAt,
    }),
  }
}

function extractWorkerAttestationExtras(
  frame: Record<string, unknown>,
): Record<string, unknown> {
  const payload = frame.payload as Record<string, unknown> | undefined
  const req =
    payload?.type === 'control_request'
      ? (payload.request as Record<string, unknown> | undefined)
      : undefined
  const subtype =
    typeof req === 'object' && req !== null && typeof req.subtype === 'string'
      ? req.subtype
      : undefined
  if (
    !(
      subtype === 'hook_callback' ||
      (subtype !== undefined && isRemoteToolsServedSubtype(subtype))
    )
  ) {
    return {}
  }
  const attRaw = frame.device_attestation_status
  const gateRaw =
    payload && Object.hasOwn(payload, 'remote_tool_gate')
      ? payload.remote_tool_gate
      : undefined
  const modeStamp =
    gateRaw === undefined || gateRaw === null
      ? undefined
      : gateRaw === 'caller_reauthored'
        ? 'present'
        : typeof gateRaw === 'string'
          ? gateRaw
          : 'other'
  return {
    ...(attRaw !== undefined &&
      attRaw !== null && {
        attestationStatus: normalizeServedAttestationStatus(
          typeof attRaw === 'string' ? attRaw.toUpperCase() : attRaw,
        ),
      }),
    ...(modeStamp !== undefined && { modeStamp }),
  }
}

function extractAllowedEphemeralSystem(
  payload: Record<string, unknown>,
): SessionsV2Message | null {
  if (payload.type !== 'system' || typeof payload.subtype !== 'string') {
    return null
  }
  const keys = ALLOWED_EPHEMERAL_SYSTEM_SUBTYPES.get(payload.subtype)
  if (!keys) return null
  const out: Record<string, unknown> = {
    type: 'system',
    subtype: payload.subtype,
    uuid: payload.uuid,
    session_id: payload.session_id,
  }
  for (const k of keys) {
    if (k in payload) out[k] = payload[k]
  }
  return out as unknown as SessionsV2Message
}

async function readBoundedJson(res: Response): Promise<unknown> {
  try {
    if (!res.body) {
      const txt = await res.text()
      return txt ? jsonParse(txt.slice(0, MAX_ERROR_BODY_BYTES)) : undefined
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (total < MAX_ERROR_BODY_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        const take = Math.min(value.length, MAX_ERROR_BODY_BYTES - total)
        chunks.push(value.subarray(0, take))
        total += take
      }
    } finally {
      reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (total === 0) return undefined
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      merged.set(c, off)
      off += c.length
    }
    return jsonParse(UTF8_DECODER.decode(merged))
  } catch {
    return undefined
  }
}

function isSessionNotActiveBody(data: unknown): boolean {
  if (data === null || typeof data !== 'object' || !('error' in data)) {
    return false
  }
  const err = (data as { error?: unknown }).error
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { type?: unknown }).type === 'session_not_active'
  )
}

function isTooLargeErrorBody(data: unknown): boolean {
  if (data === undefined) return false
  try {
    return jsonStringify(data).includes(REMOTE_TOOL_RESULT_TOO_LARGE)
  } catch {
    return false
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError'
}

// ── SessionsV2Client (official `class Te`) ────────────────────────────────

export class SessionsV2Client {
  private state: ClientState = 'idle'
  private abortController: AbortController | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private livenessTimer: ReturnType<typeof setTimeout> | null = null
  private driftTimer: ReturnType<typeof setInterval> | null = null
  private closedCause: ClosedCause = null
  private lastDriftCheck = 0
  private lastHealthyAt: number | undefined = undefined
  private downSince: number | undefined = undefined
  private driftRedial = false
  private lastSequenceNum = 0
  private issuedRequestIds = new Set<string>()
  private liveOnlyRequestIds = new Set<string>()
  private ownRequestUuids = new Map<string, string>()
  private answeredToolUseIds = new Set<string>()
  private trustedDeviceToken: Promise<string> | undefined = undefined
  private trackedSends: Set<Promise<unknown>> | null
  private servesSession: () => boolean
  private eventSigner: SessionsV2EventSigner | undefined
  private controlOnly: boolean
  private withholdTrustedDeviceToken: boolean
  private connectedSince = 0
  private resumed = false
  private serviceClock: ServiceClock | undefined = undefined
  private readonly baseApiUrlOverride: string | undefined
  private readonly fetchOverride: typeof globalThis.fetch | undefined
  private readonly getTrustedDeviceTokenOverride:
    | (() => Promise<string | undefined> | string | undefined)
    | undefined
  private readonly recoverTrustedDeviceTokenOverride:
    | ((previousToken?: string) => Promise<string | undefined>)
    | undefined
  private readonly connectTimeoutMs: number
  private readonly livenessTimeoutMs: number
  private readonly driftCheckIntervalMs: number
  private readonly reconnectBaseMs: number
  private readonly reconnectCapMs: number
  private readonly boundSession: Session | undefined

  constructor(
    private readonly sessionId: string,
    private readonly orgUuid: string,
    private readonly getAccessToken: () => string,
    private readonly callbacks: SessionsV2ClientCallbacks,
    private readonly onAuth401?: (staleBearer: string) => Promise<boolean>,
    initialSequenceNum?: number,
    options: SessionsV2ClientOptions = {},
  ) {
    validateBridgeId(sessionId, 'sessionId')
    this.boundSession = getActiveSessionFromAls()
    if (initialSequenceNum !== undefined && initialSequenceNum > 0) {
      this.lastSequenceNum = initialSequenceNum
    }
    this.trackedSends = options.trackSends ? new Set() : null
    this.servesSession = options.keepRedialling ?? (() => false)
    this.eventSigner = options.eventSigner
    this.controlOnly = options.controlOnly === true
    this.withholdTrustedDeviceToken =
      options.withholdTrustedDeviceToken === true
    this.baseApiUrlOverride = options.baseApiUrl
    this.fetchOverride = options.fetchFn
    this.getTrustedDeviceTokenOverride = options.getTrustedDeviceToken
    this.recoverTrustedDeviceTokenOverride = options.recoverTrustedDeviceToken
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? SESSIONS_V2_CONNECT_TIMEOUT_MS
    this.livenessTimeoutMs =
      options.livenessTimeoutMs ?? SESSIONS_V2_LIVENESS_TIMEOUT_MS
    this.driftCheckIntervalMs =
      options.driftCheckIntervalMs ?? SESSIONS_V2_DRIFT_CHECK_INTERVAL_MS
    this.reconnectBaseMs =
      options.reconnectBaseMs ?? SESSIONS_V2_RECONNECT_BASE_MS
    this.reconnectCapMs = options.reconnectCapMs ?? SESSIONS_V2_RECONNECT_CAP_MS
  }

  private runInBoundSession<T>(fn: () => T): T {
    return this.boundSession !== undefined &&
      getActiveSessionFromAls() !== this.boundSession
      ? runWithSession(this.boundSession, fn)
      : fn()
  }

  get keepRedialling(): boolean {
    try {
      return this.runInBoundSession(() => this.servesSession())
    } catch {
      return false
    }
  }

  setEventSigner(signer: SessionsV2EventSigner | undefined): void {
    this.eventSigner = signer
  }

  serviceTimeMs(): number | undefined {
    return this.serviceClock === undefined
      ? undefined
      : advanceServiceClock(this.serviceClock, 0)
  }

  newestSequenceNum(): number {
    return this.lastSequenceNum
  }

  sendsInFlight(): { count: number; settled: Promise<void> } {
    const list = [...(this.trackedSends ?? [])]
    return {
      count: list.length,
      settled: Promise.allSettled(list).then(() => {}),
    }
  }

  async flushSends(timeoutMs: number): Promise<void> {
    const { count, settled } = this.sendsInFlight()
    if (count === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        settled,
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, timeoutMs)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private getBaseApiUrl(): string {
    return (this.baseApiUrlOverride ?? getOauthConfig().BASE_API_URL).replace(
      /\/+$/,
      '',
    )
  }

  private async doFetch(url: string, init: RequestInit): Promise<Response> {
    const reqInit: RequestInit = { ...init, redirect: 'error' }
    if (this.fetchOverride) {
      return this.fetchOverride(url, reqInit)
    }
    const proxyOpts = getProxyFetchOptions({ url })
    return globalThis.fetch(url, { ...proxyOpts, ...reqInit } as RequestInit)
  }

  private loadTrustedDeviceToken(): Promise<string> {
    return this.runInBoundSession(() => {
      if (this.withholdTrustedDeviceToken) {
        return Promise.resolve('')
      }
      let promiseRef: Promise<string> | undefined
      const clearIfSame = (): void => {
        if (this.trustedDeviceToken === promiseRef) {
          this.trustedDeviceToken = undefined
        }
      }
      const promise = (async (): Promise<string> => {
        try {
          const token = this.getTrustedDeviceTokenOverride
            ? ((await this.getTrustedDeviceTokenOverride()) ?? '')
            : ((await getTrustedDeviceTokenIfGateOn()) ?? '')
          if (!token) clearIfSame()
          return token
        } catch (err) {
          clearIfSame()
          logForDebugging(
            `[SessionsV2Client] trusted-device token unavailable, sending no td-v1 header: ${errorMessage(err)}`,
          )
          return ''
        }
      })()
      promiseRef = promise
      return promise
    })
  }

  private rereadTrustedDeviceToken(): void {
    this.runInBoundSession(() => {
      this.trustedDeviceToken = undefined
      if (isTrustedDeviceGateEnabled()) {
        clearTrustedDeviceTokenCache()
      }
    })
  }

  /**
   * Official `recoverTrustedDeviceToken(refusal, sentDeviceToken)`.
   * Re-enrolls the trusted device on 403 `untrusted_device` and updates the
   * cached token so the immediate retry sends the fresh `X-Trusted-Device-Token`.
   */
  async recoverTrustedDeviceToken(
    refusal: UntrustedDeviceRefusal,
    sentDeviceToken: string | undefined,
  ): Promise<boolean> {
    return this.runInBoundSession(async () => {
      try {
        if (this.withholdTrustedDeviceToken) {
          return false
        }
        if (!isRecoverableUntrustedRefusal(refusal)) {
          logForDebugging(
            `[SessionsV2Client] untrusted_device refusal not recoverable (${refusal.kind})`,
            { level: 'warn' },
          )
          this.rereadTrustedDeviceToken()
          return false
        }
        const nextToken = this.recoverTrustedDeviceTokenOverride
          ? await this.recoverTrustedDeviceTokenOverride(
              sentDeviceToken || undefined,
            )
          : await recoverTrustedDeviceTokenAfterUntrusted(
              sentDeviceToken || undefined,
            )
        if (!nextToken) {
          return false
        }
        this.trustedDeviceToken = Promise.resolve(nextToken)
        return true
      } catch (err) {
        logForDebugging(
          `[SessionsV2Client] trusted-device re-enrollment failed: ${errorMessage(err)}`,
        )
        return false
      }
    })
  }

  private safeUserAgent(): string {
    try {
      return getClaudeCodeUserAgent()
    } catch {
      return 'claude-code/0.0.0'
    }
  }

  private async authHeaders(): Promise<{
    headers: Record<string, string>
    bearer: string
    withheld: boolean
  }> {
    this.trustedDeviceToken ??= this.loadTrustedDeviceToken()
    const deviceToken = await this.trustedDeviceToken
    const rawToken = this.runInBoundSession(() => this.getAccessToken())
    const bearer = typeof rawToken === 'string' && rawToken ? rawToken : ''
    const withheld = bearer === ''
    return {
      headers: {
        ...(!withheld && { Authorization: `Bearer ${bearer}` }),
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-client-platform': getAnthropicClientPlatform(),
        'x-organization-uuid': this.orgUuid,
        'User-Agent': this.safeUserAgent(),
        ...(deviceToken ? { 'X-Trusted-Device-Token': deviceToken } : {}),
      },
      bearer,
      withheld,
    }
  }

  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') {
      logForDebugging('[SessionsV2Client] Already connecting/connected')
      return
    }
    if (this.closedCause === 'deliberate') {
      logForDebugging(
        '[SessionsV2Client] Ignoring connect() — deliberately closed',
      )
      return
    }
    this.state = 'connecting'
    this.closedCause = null
    this.connectedSince = Date.now()
    this.resumed = this.lastSequenceNum > 0

    const url = new URL(
      `${this.getBaseApiUrl()}/v1/code/sessions/${this.sessionId}/events/stream`,
    )
    if (this.lastSequenceNum > 0) {
      url.searchParams.set('from_sequence_num', String(this.lastSequenceNum))
    }
    if (this.controlOnly) {
      url.searchParams.set('control_only', '1')
    }

    const controller = new AbortController()
    this.abortController = controller

    let auth: {
      headers: Record<string, string>
      bearer: string
      withheld: boolean
    }
    try {
      auth = await this.authHeaders()
    } catch (err) {
      if (this.abortController !== controller) return
      logForDebugging(
        `[SessionsV2Client] Could not build the stream's credentials: ${errorMessage(err)}`,
        { level: 'error' },
      )
      this.abortController = null
      this.handleStreamEnd()
      return
    }

    if (controller.signal.aborted || this.abortController !== controller) {
      return
    }

    const headers: Record<string, string> = {
      ...auth.headers,
      Accept: 'text/event-stream',
    }
    if (this.lastSequenceNum > 0) {
      headers['Last-Event-ID'] = String(this.lastSequenceNum)
    }

    logForDebugging(
      `[SessionsV2Client] Connecting to ${url.href} (from_sequence_num=${this.lastSequenceNum})`,
    )
    void this.runInBoundSession(() =>
      this.readStream(url, headers, controller, auth.bearer, auth.withheld),
    )
  }

  private async readStream(
    url: URL,
    headers: Record<string, string>,
    controller: AbortController,
    bearer: string,
    withheld: boolean,
  ): Promise<void> {
    let response: Response
    let timedOut = false
    const connectTimer = setTimeout(() => {
      this.runInBoundSession(() => {
        timedOut = true
        controller.abort()
      })
    }, this.connectTimeoutMs)
    connectTimer.unref?.()

    try {
      response = await this.doFetch(url.href, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(connectTimer)
      if (this.abortController !== controller) return
      if (timedOut) {
        logForDebugging(
          `[SessionsV2Client] Connect timed out after ${this.connectTimeoutMs}ms, reconnecting`,
          { level: 'error' },
        )
        this.handleStreamEnd()
        return
      }
      if (controller.signal.aborted) return
      logForDebugging(
        `[SessionsV2Client] Connect error: ${errorMessage(err)}`,
        { level: 'error' },
      )
      this.runInBoundSession(() => {
        this.callbacks.onError?.(toError(err))
      })
      if (this.abortController !== controller) return
      this.handleStreamEnd()
      return
    }

    if (!response.ok || !response.body) {
      logForDebugging(
        `[SessionsV2Client] HTTP ${response.status} on SSE connect`,
        { level: 'error' },
      )
      const body403 =
        response.status === 403 ? await readBoundedJson(response) : undefined
      if (body403 === undefined) {
        await response.body?.cancel().catch(() => {})
      }
      clearTimeout(connectTimer)
      if (this.abortController !== controller) return

      if (response.status === 401 && !withheld && this.onAuth401) {
        logForDebugging('[SessionsV2Client] 401 on SSE connect — refreshing')
        const refreshed = await this.runInBoundSession(() =>
          this.onAuth401!(bearer),
        ).catch(() => false)
        if (this.abortController !== controller) return
        if (
          !refreshed &&
          this.reconnectAttempts >= SESSIONS_V2_MAX_RECONNECT_ATTEMPTS &&
          this.keepRedialling
        ) {
          this.state = 'closed'
          this.closedCause = 'exhausted'
          this.runInBoundSession(() => {
            this.callbacks.onClose?.()
          })
          return
        }
        this.handleStreamEnd()
        return
      }

      const untrusted =
        response.status === 403
          ? parseUntrustedDeviceRefusal(body403)
          : undefined
      if (untrusted !== undefined) {
        const recovered = await this.recoverTrustedDeviceToken(
          untrusted,
          headers['X-Trusted-Device-Token'],
        )
        if (this.abortController !== controller) return
        if (recovered) {
          logForDebugging(
            '[SessionsV2Client] untrusted_device on SSE connect — re-enrolled, reconnecting',
          )
          this.handleStreamEnd()
          return
        }
      }

      if (PERMANENT_HTTP_CODES.has(response.status)) {
        const closeReason =
          untrusted !== undefined
            ? 'untrusted_device'
            : response.status === 403 &&
                body403 !== null &&
                typeof body403 === 'object' &&
                'error' in body403 &&
                typeof (body403 as { error?: { reason?: unknown } }).error
                  ?.reason === 'string'
              ? (body403 as { error: { reason: string } }).error.reason
              : undefined
        this.state = 'closed'
        this.closedCause = 'permanentHttp'
        this.runInBoundSession(() => {
          this.callbacks.onClose?.(closeReason)
        })
        return
      }

      this.handleStreamEnd()
      return
    }

    clearTimeout(connectTimer)
    if (this.abortController !== controller) {
      response.body.cancel().catch(() => {})
      return
    }

    const serverDateMs = Date.parse(response.headers.get('date') ?? '')
    if (Number.isNaN(serverDateMs)) {
      this.serviceClock = undefined
    } else {
      this.connectedSince = serverDateMs
      this.serviceClock = {
        serviceMs: serverDateMs,
        wallMs: Date.now(),
        monotonicMs: performance.now(),
      }
    }

    this.state = 'connected'
    this.reconnectAttempts = 0
    const connectInfo: SessionsV2ConnectInfo = {
      gapMs: this.downSince === undefined ? 0 : Date.now() - this.downSince,
      driftRedial: this.driftRedial,
    }
    this.downSince = undefined
    this.driftRedial = false
    this.resetLivenessTimer()
    this.startDriftWatch()
    logForDebugging('[SessionsV2Client] Connected')
    this.runInBoundSession(() => {
      this.callbacks.onConnected?.(connectInfo)
    })

    const reader = response.body.getReader()
    let parserState: SseParserState | undefined
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (this.abortController !== controller) return
        if (done) break
        const parsed = parseSseChunk(
          parserState,
          value,
          SESSIONS_V2_MAX_FRAME_BYTES,
        )
        parserState = parsed.state
        for (const ev of parsed.events) {
          if (this.abortController !== controller) return
          if (ev.kind === 'tooLarge') {
            logForDebugging(
              `[SessionsV2Client] Dropping oversized SSE frame (> ${SESSIONS_V2_MAX_FRAME_BYTES} bytes)`,
              { level: 'warn' },
            )
            continue
          }
          if (ev.kind === 'event' && !ev.data) continue
          this.resetLivenessTimer()
          if (ev.kind === 'event' && ev.event && ev.data) {
            this.handleFrame(ev.event, ev.id, ev.data)
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      logForDebugging(
        `[SessionsV2Client] Stream read error: ${errorMessage(err)}`,
        { level: 'error' },
      )
    } finally {
      reader.releaseLock()
    }

    if (!controller.signal.aborted && this.abortController === controller) {
      logForDebugging('[SessionsV2Client] Stream ended')
      this.handleStreamEnd()
    }
  }

  handleFrame(eventType: string, id: string | undefined, data: string): void {
    this.runInBoundSession(() => {
      this.handleFrameInBoundSession(eventType, id, data)
    })
  }

  private handleFrameInBoundSession(
    eventType: string,
    id: string | undefined,
    data: string,
  ): void {
    let parsed: unknown
    try {
      parsed = jsonParse(data)
    } catch (err) {
      logError(
        new Error(
          `[SessionsV2Client] Failed to parse ${eventType} frame: ${errorMessage(err)}`,
        ),
      )
      return
    }

    const frame =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}

    switch (eventType) {
      case 'client_event': {
        const seqNum = Number.parseInt(
          id ?? String(frame.sequence_num ?? ''),
          10,
        )
        if (!Number.isNaN(seqNum) && seqNum > this.lastSequenceNum) {
          this.lastSequenceNum = seqNum
        }

        const payload = frame.payload
        if (!isSessionsV2Message(payload)) {
          logForDebugging(
            `[SessionsV2Client] Dropping client_event with no payload.type (event_type=${String(frame.event_type ?? '')})`,
          )
          return
        }

        const source =
          typeof frame.source === 'string' ? frame.source : undefined

        if (payload.type === 'control_response') {
          const resp = (payload as SDKControlResponse).response
          if (
            !resp ||
            typeof resp !== 'object' ||
            typeof resp.request_id !== 'string'
          ) {
            logForDebugging(
              `[SessionsV2Client] Dropping malformed control_response from source=${source ?? 'unknown'}`,
              { level: 'warn' },
            )
            return
          }
        }

        if (payload.type === 'user') {
          const userPayload = payload as {
            parent_tool_use_id?: unknown
            message?: { content?: unknown }
          }
          const content = userPayload.message?.content
          if (!userPayload.parent_tool_use_id && Array.isArray(content)) {
            for (const block of content) {
              if (
                block &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'tool_result' &&
                typeof (block as { tool_use_id?: unknown }).tool_use_id ===
                  'string'
              ) {
                this.answeredToolUseIds.add(
                  (block as { tool_use_id: string }).tool_use_id,
                )
                if (this.answeredToolUseIds.size > 1000) {
                  const first = this.answeredToolUseIds.values().next().value
                  if (first !== undefined) {
                    this.answeredToolUseIds.delete(first)
                  }
                }
              }
            }
          }
        }

        if (
          payload.type === 'control_request' ||
          payload.type === 'control_response'
        ) {
          this.callbacks.onStoredControlFrame?.({
            payload,
            source,
            sequenceNum: Number.isNaN(seqNum) ? undefined : seqNum,
          })
        }

        const baseExtras: Record<string, unknown> = {
          ...(source !== undefined && { source }),
          ...(!Number.isNaN(seqNum) && { sequenceNum: seqNum }),
          ...extractFrameTimingExtras(
            frame,
            this.connectedSince,
            this.serviceClock,
          ),
          ...(this.resumed && { resumed: true }),
          ...(source === 'worker' && extractWorkerAttestationExtras(frame)),
        }

        if (source !== undefined && source !== 'worker') {
          if (payload.type === 'control_response') {
            const resp = (payload as SDKControlResponse).response
            if (this.issuedRequestIds.has(resp.request_id)) {
              logForDebugging(
                `[SessionsV2Client] Dropping control_response for this client's request_id from source=${source} — only the worker may answer our RPCs`,
                { level: 'warn' },
              )
              return
            }
            const respRec = resp as Record<string, unknown>
            if (
              respRec.pending_user_dialog_requests ||
              respRec.pending_permission_requests ||
              respRec.pending_elicitation_requests ||
              'error_code' in respRec
            ) {
              const {
                pending_user_dialog_requests: _d,
                pending_permission_requests: _p,
                pending_elicitation_requests: _e,
                error_code: _ec,
                ...cleanResp
              } = respRec
              this.deliver(
                {
                  ...payload,
                  response: cleanResp,
                } as unknown as SessionsV2Message,
                baseExtras,
              )
              return
            }
          } else if (!ALLOWED_NON_WORKER_TYPES.has(payload.type)) {
            if (
              payload.type === 'control_request' &&
              typeof (payload as SDKControlRequest).request_id === 'string' &&
              this.issuedRequestIds.has(
                (payload as SDKControlRequest).request_id,
              )
            ) {
              const reqId = (payload as SDKControlRequest).request_id
              const payloadUuid =
                'uuid' in payload
                  ? (payload as { uuid?: unknown }).uuid
                  : undefined
              if (
                typeof payloadUuid !== 'string' ||
                payloadUuid !== this.ownRequestUuids.get(reqId)
              ) {
                return
              }
              const att = normalizeAttestationOutcome(
                frame.device_attestation_status,
              )
              if (att === 'unverified') {
                this.rereadTrustedDeviceToken()
              }
              this.callbacks.onOwnRequestEchoed?.(reqId, att)
              return
            }
            logForDebugging(
              `[SessionsV2Client] Dropping ${payload.type} from source=${source}`,
            )
            return
          }
        } else if (payload.type === 'control_response') {
          const reqId = (payload as SDKControlResponse).response.request_id
          this.issuedRequestIds.delete(reqId)
          this.liveOnlyRequestIds.delete(reqId)
          this.ownRequestUuids.delete(reqId)
        }

        this.deliver(payload, baseExtras)
        return
      }

      case 'ephemeral_event': {
        if (frame.event_type === TOOL_HOST_ENDED_EVENT_TYPE) {
          const inner =
            frame.payload !== null && typeof frame.payload === 'object'
              ? (frame.payload as Record<string, unknown>)
              : {}
          try {
            this.callbacks.onToolHostEnded?.({
              workId:
                typeof inner.work_id === 'string' ? inner.work_id : undefined,
              reason:
                typeof inner.reason === 'string' ? inner.reason : undefined,
            })
          } catch (err) {
            logForDebugging(
              `[SessionsV2Client] tool_host_ended handler threw: ${errorMessage(err)}`,
              { level: 'error' },
            )
          }
          return
        }

        const payload = frame.payload
        if (!isSessionsV2Message(payload)) return

        if (
          payload.type === 'control_response' &&
          typeof (payload as SDKControlResponse).response?.request_id ===
            'string' &&
          this.liveOnlyRequestIds.delete(
            (payload as SDKControlResponse).response.request_id,
          )
        ) {
          const reqId = (payload as SDKControlResponse).response.request_id
          this.issuedRequestIds.delete(reqId)
          this.ownRequestUuids.delete(reqId)
          const respRec = (payload as SDKControlResponse).response as Record<
            string,
            unknown
          >
          const {
            pending_user_dialog_requests: _d,
            pending_permission_requests: _p,
            pending_elicitation_requests: _e,
            ...cleanResp
          } = respRec
          this.deliver(
            { ...payload, response: cleanResp } as unknown as SessionsV2Message,
            { source: 'worker' },
          )
          return
        }

        const allowedSys = extractAllowedEphemeralSystem(
          payload as unknown as Record<string, unknown>,
        )
        if (allowedSys) {
          this.deliver(allowedSys, {})
          return
        }

        const rec = payload as unknown as Record<string, unknown>
        if (
          rec.type === 'tool_progress' &&
          rec.heartbeat === true &&
          typeof rec.parent_tool_use_id === 'string' &&
          !this.answeredToolUseIds.has(rec.parent_tool_use_id) &&
          !(
            typeof rec.tool_use_id === 'string' &&
            rec.tool_use_id.startsWith('hook-')
          )
        ) {
          this.deliver(payload, {})
          return
        }

        if (payload.type === 'stream_event') {
          this.deliver(payload, {})
          return
        }
        logForDebugging(
          `[SessionsV2Client] Dropping ${payload.type} on ephemeral channel`,
        )
        return
      }

      case 'catch_up_truncated':
        logForDebugging(
          '[SessionsV2Client] catch_up_truncated — transcript gap',
        )
        this.callbacks.onCatchUpTruncated?.()
        return

      case 'session_update': {
        const status = frame.connection_status
        if (typeof status === 'string') {
          try {
            this.callbacks.onWorkerConnectionStatus?.(status)
          } catch (err) {
            logForDebugging(
              `[SessionsV2Client] worker connection status handler threw: ${errorMessage(err)}`,
              { level: 'error' },
            )
          }
        } else {
          logForDebugging('[SessionsV2Client] Ignoring session_update frame')
        }
        return
      }

      case 'security_update': {
        const tier = frame.security_tier
        logForDebugging(
          `[SessionsV2Client] security_update: tier ${typeof tier === 'string' ? tier : typeof tier}`,
        )
        if (tier === 'elevated') {
          try {
            this.callbacks.onSecurityTierRaised?.()
          } catch (err) {
            logForDebugging(
              `[SessionsV2Client] security tier handler threw: ${errorMessage(err)}`,
              { level: 'error' },
            )
          }
        }
        return
      }

      case 'delivery_update': {
        const eventId = frame.event_id
        const status = frame.status
        if (typeof eventId !== 'string' || typeof status !== 'string') {
          logForDebugging('[SessionsV2Client] Ignoring delivery_update frame')
          return
        }
        try {
          this.callbacks.onDeliveryUpdate?.({ eventId, status })
        } catch (err) {
          logError(
            new Error(
              `[SessionsV2Client] delivery update handler threw: ${errorMessage(err)}`,
            ),
          )
        }
        return
      }

      default:
        logForDebugging(
          `[SessionsV2Client] Unknown SSE event type '${eventType}'`,
          { level: 'warn' },
        )
        return
    }
  }

  private deliver(
    message: SessionsV2Message,
    extras: Record<string, unknown>,
  ): void {
    try {
      this.runInBoundSession(() => {
        this.callbacks.onMessage(message, extras)
      })
    } catch (err) {
      logError(
        new Error(
          `[SessionsV2Client] frame handler threw: ${errorMessage(err)}`,
        ),
      )
    }
  }

  private handleStreamEnd(): void {
    this.markDown()
    this.clearLivenessTimer()
    this.clearDriftWatch()
    if (this.state === 'closed') return
    this.abortController = null

    const budgetExhausted =
      this.reconnectAttempts >= SESSIONS_V2_MAX_RECONNECT_ATTEMPTS
    if (budgetExhausted && !this.keepRedialling) {
      logForDebugging(
        `[SessionsV2Client] Reconnect budget exhausted (${SESSIONS_V2_MAX_RECONNECT_ATTEMPTS}), closing`,
      )
      this.state = 'closed'
      this.closedCause = 'exhausted'
      this.runInBoundSession(() => {
        this.callbacks.onClose?.()
      })
      return
    }

    if (!budgetExhausted) {
      this.reconnectAttempts++
    }
    this.state = 'idle'

    const delayMs = computeReconnectDelayMs(
      budgetExhausted ? Number.POSITIVE_INFINITY : this.reconnectAttempts,
      this.reconnectBaseMs,
      this.reconnectCapMs,
    )
    logForDebugging(
      `[SessionsV2Client] Reconnecting in ${Math.round(delayMs)}ms (attempt ${this.reconnectAttempts}/${this.keepRedialling ? '∞' : SESSIONS_V2_MAX_RECONNECT_ATTEMPTS}, from_sequence_num=${this.lastSequenceNum})`,
    )
    this.reconnectTimer = setTimeout(() => {
      this.runInBoundSession(() => {
        this.reconnectTimer = null
        if (this.state === 'closed') return
        void this.connect()
      })
    }, delayMs)
    this.reconnectTimer.unref?.()

    if (!budgetExhausted) {
      this.runInBoundSession(() => {
        this.callbacks.onReconnecting?.()
      })
    }
  }

  private readonly onLivenessTimeout = (): void => {
    this.runInBoundSession(() => {
      this.livenessTimer = null
      logForDebugging('[SessionsV2Client] Liveness timeout, reconnecting', {
        level: 'warn',
      })
      try {
        const now = Date.now()
        this.callbacks.onStreamSilent?.({
          suspended:
            now - this.lastDriftCheck > this.driftCheckIntervalMs * 2 ||
            now - (this.lastHealthyAt ?? now) >
              this.livenessTimeoutMs + this.driftCheckIntervalMs * 2,
        })
      } catch (err) {
        logError(toError(err))
      }
      this.abortController?.abort()
      this.abortController = null
      this.handleStreamEnd()
    })
  }

  private markDown(): void {
    const now = Date.now()
    this.downSince ??=
      this.lastHealthyAt !== undefined &&
      now - this.lastHealthyAt >= SESSIONS_V2_MARK_DOWN_THRESHOLD_MS
        ? this.lastHealthyAt
        : now
  }

  private resetLivenessTimer(): void {
    this.lastHealthyAt = Date.now()
    this.clearLivenessTimer()
    this.livenessTimer = setTimeout(
      this.onLivenessTimeout,
      this.livenessTimeoutMs,
    )
    this.livenessTimer.unref?.()
  }

  private clearLivenessTimer(): void {
    if (this.livenessTimer !== null) {
      clearTimeout(this.livenessTimer)
      this.livenessTimer = null
    }
  }

  private startDriftWatch(): void {
    this.clearDriftWatch()
    this.lastDriftCheck = Date.now()
    this.driftTimer = setInterval(() => {
      this.runInBoundSession(() => {
        const now = Date.now()
        const elapsed = now - this.lastDriftCheck
        this.lastDriftCheck = now
        if (
          elapsed > this.driftCheckIntervalMs * 2 &&
          this.state === 'connected'
        ) {
          logForDebugging(
            `[SessionsV2Client] Wall-clock drift ${elapsed}ms — reconnecting after suspend`,
          )
          this.reconnectAfterSuspend()
        }
      })
    }, this.driftCheckIntervalMs)
    this.driftTimer.unref?.()
  }

  private clearDriftWatch(): void {
    if (this.driftTimer !== null) {
      clearInterval(this.driftTimer)
      this.driftTimer = null
    }
  }

  private trackSend<T>(promise: Promise<T>): Promise<T> {
    if (this.trackedSends !== null) {
      const tracked = this.trackedSends
      tracked.add(promise)
      const cleanup = (): void => {
        tracked.delete(promise)
      }
      promise.then(cleanup, cleanup)
    }
    return promise
  }

  private async postEventsRaw(
    url: string,
    body: { session_id: string; events: Record<string, unknown>[] },
    headers: Record<string, string>,
    opts: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<
    | { ok: true; sequence_num: number }
    | {
        ok: false
        status: number
        refusal?: UntrustedDeviceRefusal
        inactive: boolean
        tooLarge: boolean
        sentDeviceToken?: string
      }
  > {
    const timeoutMs = opts.timeoutMs ?? SESSIONS_V2_POST_TIMEOUT_MS
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal

    const res = await this.doFetch(url, {
      method: 'POST',
      headers,
      body: jsonStringify(body),
      signal,
    })

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as {
        results?: Array<{ sequence_num?: number | string }>
        sequence_num?: number | string
      }
      const first = json.results?.[0]
      const rawSeq = first?.sequence_num ?? json.sequence_num
      const seq =
        rawSeq !== undefined ? Number.parseInt(String(rawSeq), 10) : NaN
      return { ok: true, sequence_num: Number.isNaN(seq) ? 0 : seq }
    }

    let refusal: UntrustedDeviceRefusal | undefined
    let inactive = false
    let tooLarge = res.status === 413

    if (res.status === 403) {
      refusal = parseUntrustedDeviceRefusal(await readBoundedJson(res))
    } else if (res.status === 409) {
      inactive = isSessionNotActiveBody(await readBoundedJson(res))
    } else if (res.status === 400) {
      tooLarge = isTooLargeErrorBody(await readBoundedJson(res))
    } else {
      await res.body?.cancel().catch(() => {})
    }

    return {
      ok: false,
      status: res.status,
      refusal,
      inactive,
      tooLarge,
      sentDeviceToken: headers['X-Trusted-Device-Token'],
    }
  }

  /**
   * POST a single event to `/v1/code/sessions/{sessionId}/events`.
   * Handles optional event signing, 401 refresh + retry, and 403
   * `untrusted_device` re-enrollment + retry.
   */
  async postEvent(
    event: Record<string, unknown>,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SessionsV2EventPostOutcome> {
    if (this.state === 'closed') {
      logForDebugging('[SessionsV2Client] Cannot send: closed', {
        level: 'warn',
      })
      return { outcome: 'failed', cause: 'closed' }
    }
    const url = `${this.getBaseApiUrl()}/v1/code/sessions/${this.sessionId}/events`
    try {
      const t0 = performance.now()
      const signed = this.eventSigner
        ? await this.runInBoundSession(() =>
            this.eventSigner!(this.sessionId, event),
          )
        : event
      const t1 = performance.now()
      const payload = { session_id: this.sessionId, events: [signed] }
      const { headers, bearer, withheld } = await this.authHeaders()

      let result = await this.postEventsRaw(url, payload, headers, opts)

      if (!result.ok && result.status === 401 && !withheld && this.onAuth401) {
        logForDebugging('[SessionsV2Client] 401 on POST — refreshing + retry')
        if (await this.runInBoundSession(() => this.onAuth401!(bearer))) {
          const refreshedAuth = await this.authHeaders()
          result = await this.postEventsRaw(
            url,
            payload,
            refreshedAuth.headers,
            opts,
          )
        }
      }

      if (
        !result.ok &&
        result.refusal !== undefined &&
        (await this.recoverTrustedDeviceToken(
          result.refusal,
          result.sentDeviceToken,
        ))
      ) {
        logForDebugging(
          '[SessionsV2Client] untrusted_device on POST — re-enrolled, retrying',
        )
        const renewedAuth = await this.authHeaders()
        result = await this.postEventsRaw(
          url,
          payload,
          renewedAuth.headers,
          opts,
        )
      }

      if (!result.ok) {
        logForDebugging(
          `[SessionsV2Client] POST /events returned ${result.status}${result.inactive ? ' (session not active)' : ''}${result.tooLarge ? ' (too large)' : ''}`,
          { level: 'warn' },
        )
        if (result.inactive) {
          return { outcome: 'session_inactive' }
        }
        return {
          outcome: 'failed',
          cause: 'http',
          status: result.status,
          ...(result.tooLarge && { tooLarge: true }),
        }
      }

      return {
        outcome: 'accepted',
        sequence_num: result.sequence_num,
        signMs: Math.round(t1 - t0),
        postMs: Math.round(performance.now() - t1),
      }
    } catch (err) {
      logForDebugging(
        `[SessionsV2Client] POST /events failed: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      return {
        outcome: 'failed',
        cause: isTimeoutError(err) ? 'timeout' : 'network',
      }
    }
  }

  sendEvent(
    event: Record<string, unknown>,
  ): Promise<{ sequence_num: number } | null> {
    return this.trackSend(
      this.postEvent(event).then(res =>
        res.outcome === 'accepted' ? { sequence_num: res.sequence_num } : null,
      ),
    )
  }

  sendControlResponse(
    response: SDKControlResponse,
    uuid: string = randomUUID(),
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SessionsV2EventPostOutcome> {
    logForDebugging('[SessionsV2Client] Sending control_response')
    return this.trackSend(
      this.postEvent(
        { ...(response as unknown as Record<string, unknown>), uuid },
        opts,
      ),
    )
  }

  sendControlRequest(
    request: SDKControlRequestInner,
    onPostFailed?: (requestId: string) => void,
  ): string | null {
    return this.postControlRequest(request, onPostFailed)?.requestId ?? null
  }

  postControlRequest(
    request: SDKControlRequestInner,
    onPostFailed?: (requestId: string) => void,
  ): {
    requestId: string
    posted: Promise<SessionsV2EventPostOutcome>
  } | null {
    if (this.state === 'closed') {
      logForDebugging(
        '[SessionsV2Client] Cannot send control_request: closed',
        { level: 'warn' },
      )
      return null
    }
    const requestId = randomUUID()
    this.issuedRequestIds.add(requestId)
    const reqRec = request as Record<string, unknown>
    if (
      (reqRec.subtype === 'mcp_authenticate' ||
        reqRec.subtype === 'mcp_status' ||
        reqRec.subtype === 'read_file' ||
        reqRec.subtype === 'ui_render') &&
      reqRec.liveReply === true
    ) {
      this.liveOnlyRequestIds.add(requestId)
    }
    if (this.issuedRequestIds.size > SESSIONS_V2_MAX_ISSUED_REQUEST_IDS) {
      const oldest = this.issuedRequestIds.values().next().value
      if (oldest !== undefined) {
        this.issuedRequestIds.delete(oldest)
        this.liveOnlyRequestIds.delete(oldest)
        this.ownRequestUuids.delete(oldest)
      }
    }
    const eventUuid = randomUUID()
    const payload: Record<string, unknown> = {
      type: 'control_request',
      request_id: requestId,
      request,
      uuid: eventUuid,
    }
    this.ownRequestUuids.set(requestId, eventUuid)
    logForDebugging(
      `[SessionsV2Client] Sending control_request: ${request.subtype}`,
    )
    const posted = this.trackSend(
      this.postEvent(payload).then(outcome => {
        if (
          outcome.outcome === 'session_inactive' ||
          (outcome.outcome === 'failed' && outcome.cause === 'http')
        ) {
          this.runInBoundSession(() => {
            onPostFailed?.(requestId)
          })
        }
        return outcome
      }),
    )
    return { requestId, posted }
  }

  sendControlCancelRequest(requestId: string): void {
    if (this.state === 'closed') return
    logForDebugging(
      `[SessionsV2Client] Sending control_cancel_request: ${requestId}`,
    )
    void this.sendEvent({
      type: 'control_cancel_request',
      request_id: requestId,
      uuid: randomUUID(),
    })
  }

  isConnected(): boolean {
    return this.state === 'connected'
  }

  isRevivable(): boolean {
    return this.closedCause === 'exhausted'
  }

  reviveAfterExhaustion(): boolean {
    const rediallingPastBudget =
      this.keepRedialling &&
      this.state === 'idle' &&
      this.reconnectAttempts >= SESSIONS_V2_MAX_RECONNECT_ATTEMPTS &&
      this.reconnectTimer !== null
    if (!rediallingPastBudget && this.closedCause !== 'exhausted') {
      return false
    }
    this.reconnect()
    return true
  }

  close(): void {
    logForDebugging('[SessionsV2Client] Closing')
    this.state = 'closed'
    this.closedCause = 'deliberate'
    this.clearLivenessTimer()
    this.clearDriftWatch()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.abortController?.abort()
    this.abortController = null
  }

  reconnect(): void {
    if (this.closedCause === 'deliberate') {
      logForDebugging(
        '[SessionsV2Client] Ignoring reconnect() — deliberately closed',
      )
      return
    }
    logForDebugging('[SessionsV2Client] Force reconnect')
    this.markDown()
    this.reconnectAttempts = 0
    this.clearLivenessTimer()
    this.clearDriftWatch()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.abortController?.abort()
    this.abortController = null
    this.state = 'idle'
    void this.runInBoundSession(() => this.connect())
  }

  reconnectAfterSuspend(): void {
    if (
      this.state === 'closed' ||
      (this.driftRedial && this.state === 'connecting')
    ) {
      return
    }
    this.driftRedial = true
    this.reconnect()
  }
}
