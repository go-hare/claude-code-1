import { randomUUID } from 'crypto'
import type {
  SDKPartialAssistantMessage,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import { decodeJwtExpiry } from '../../bridge/jwtUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import { createAxiosInstance } from '../../utils/proxy.js'
import {
  registerSessionActivityCallback,
  unregisterSessionActivityCallback,
} from '../../utils/sessionActivity.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../../utils/sessionIngressAuth.js'
import type {
  RequiresActionDetails,
  SessionState,
} from '../../utils/sessionState.js'
import { sleep } from '../../utils/sleep.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import {
  RetryableError,
  SerialBatchEventUploader,
} from './SerialBatchEventUploader.js'
import type { SSETransport, StreamClientEvent } from './SSETransport.js'
import { WorkerStateUploader } from './WorkerStateUploader.js'

/** Default interval between heartbeat events (20s; server TTL is 60s). */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000

/**
 * stream_event messages accumulate in a delay buffer for up to this many ms
 * before enqueue. Mirrors HybridTransport's batching window. text_delta
 * events for the same content block accumulate into a single full-so-far
 * snapshot per flush — each emitted event is self-contained so a client
 * connecting mid-stream sees complete text, not a fragment.
 */
const STREAM_EVENT_FLUSH_INTERVAL_MS = 100

/** Hoisted axios validateStatus callback to avoid per-request closure allocation. */
function alwaysValidStatus(): boolean {
  return true
}

export type CCRInitFailReason =
  | 'no_auth_headers'
  | 'missing_epoch'
  | 'worker_register_failed'

/** Thrown by initialize(); carries a typed reason for the diag classifier. */
export class CCRInitError extends Error {
  constructor(readonly reason: CCRInitFailReason) {
    super(`CCRClient init failed: ${reason}`)
  }
}

/**
 * Consecutive 401/403 with a VALID-LOOKING token before giving up. An
 * expired JWT short-circuits this (exits immediately — deterministic,
 * retry is futile). This threshold is for the uncertain case: token's
 * exp is in the future but server says 401 (userauth down, KMS hiccup,
 * clock skew). 10 × 20s heartbeat ≈ 200s to ride it out.
 */
const MAX_CONSECUTIVE_AUTH_FAILURES = 10

type EventPayload = {
  uuid: string
  type: string
  [key: string]: unknown
}

type ClientEvent = {
  payload: EventPayload
  ephemeral?: boolean
}

/**
 * Structural subset of a stream_event carrying a text_delta. Not a narrowing
 * of SDKPartialAssistantMessage — RawMessageStreamEvent's delta is a union and
 * narrowing through two levels defeats the discriminant.
 */
type CoalescedStreamEvent = {
  type: 'stream_event'
  uuid: string
  session_id: string
  parent_tool_use_id: string | null
  event: {
    type: 'content_block_delta'
    index: number
    delta: { type: 'text_delta'; text: string }
  }
}

/**
 * Accumulator state for text_delta coalescing. Keyed by API message ID so
 * lifetime is tied to the assistant message — cleared when the complete
 * SDKAssistantMessage arrives (writeEvent), which is reliable even when
 * abort/error paths skip content_block_stop/message_stop delivery.
 */
export type StreamAccumulatorState = {
  /** API message ID (msg_...) → blocks[blockIndex] → chunk array. */
  byMessage: Map<string, string[][]>
  /**
   * {session_id}:{parent_tool_use_id} → active message ID.
   * content_block_delta events don't carry the message ID (only
   * message_start does), so we track which message is currently streaming
   * for each scope. At most one message streams per scope at a time.
   */
  scopeToMessage: Map<string, string>
}

export function createStreamAccumulator(): StreamAccumulatorState {
  return { byMessage: new Map(), scopeToMessage: new Map() }
}

function scopeKey(m: {
  session_id: string
  parent_tool_use_id?: string | null
}): string {
  return `${m.session_id}:${m.parent_tool_use_id ?? ''}`
}

/**
 * Accumulate text_delta stream_events into full-so-far snapshots per content
 * block. Each flush emits ONE event per touched block containing the FULL
 * accumulated text from the start of the block — a client connecting
 * mid-stream receives a self-contained snapshot, not a fragment.
 *
 * Non-text-delta events pass through unchanged. message_start records the
 * active message ID for the scope; content_block_delta appends chunks;
 * the snapshot event reuses the first text_delta UUID seen for that block in
 * this flush so server-side idempotency remains stable across retries.
 *
 * Cleanup happens in writeEvent when the complete assistant message arrives
 * (reliable), not here on stop events (abort/error paths skip those).
 */
export function accumulateStreamEvents(
  buffer: SDKPartialAssistantMessage[],
  state: StreamAccumulatorState,
): EventPayload[] {
  const out: EventPayload[] = []
  // chunks[] → snapshot already in `out` this flush. Keyed by the chunks
  // array reference (stable per {messageId, index}) so subsequent deltas
  // rewrite the same entry instead of emitting one event per delta.
  const touched = new Map<string[], CoalescedStreamEvent>()
  for (const msg of buffer) {
    const evt = msg.event as Record<string, unknown>
    switch (evt.type) {
      case 'message_start': {
        const id = (evt.message as { id: string }).id
        const prevId = state.scopeToMessage.get(scopeKey(msg))
        if (prevId) state.byMessage.delete(prevId)
        state.scopeToMessage.set(scopeKey(msg), id)
        state.byMessage.set(id, [])
        out.push(msg)
        break
      }
      case 'content_block_delta': {
        const delta = evt.delta as Record<string, unknown>
        if (delta.type !== 'text_delta') {
          out.push(msg)
          break
        }
        const messageId = state.scopeToMessage.get(scopeKey(msg))
        const blocks = messageId ? state.byMessage.get(messageId) : undefined
        if (!blocks) {
          // Delta without a preceding message_start (reconnect mid-stream,
          // or message_start was in a prior buffer that got dropped). Pass
          // through raw — can't produce a full-so-far snapshot without the
          // prior chunks anyway.
          out.push(msg)
          break
        }
        const idx = evt.index as number
        const chunks = (blocks[idx] ??= [])
        chunks.push(delta.text as string)
        const existing = touched.get(chunks)
        if (existing) {
          ;(existing.event as Record<string, unknown>).delta = {
            type: 'text_delta',
            text: chunks.join(''),
          }
          break
        }
        const snapshot: CoalescedStreamEvent = {
          type: 'stream_event',
          uuid: msg.uuid,
          session_id: msg.session_id,
          parent_tool_use_id: msg.parent_tool_use_id,
          event: {
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'text_delta', text: chunks.join('') },
          },
        }
        touched.set(chunks, snapshot)
        out.push(snapshot)
        break
      }
      default:
        out.push(msg)
    }
  }
  return out
}

/**
 * Clear accumulator entries for a completed assistant message. Called from
 * writeEvent when the SDKAssistantMessage arrives — the reliable end-of-stream
 * signal that fires even when abort/interrupt/error skip SSE stop events.
 */
export function clearStreamAccumulatorForMessage(
  state: StreamAccumulatorState,
  assistant: {
    session_id: string
    parent_tool_use_id: string | null
    message: { id: string }
  },
): void {
  state.byMessage.delete(assistant.message.id)
  const scope = scopeKey(assistant)
  if (state.scopeToMessage.get(scope) === assistant.message.id) {
    state.scopeToMessage.delete(scope)
  }
}

type RequestResult =
  | { ok: true; status?: number; data?: unknown }
  | { ok: false; status?: number; data?: unknown; retryAfterMs?: number }

type WorkerEvent = {
  payload: EventPayload
  is_compaction?: boolean
  agent_id?: string
}

export type InternalEvent = {
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  event_metadata?: Record<string, unknown> | null
  is_compaction: boolean
  created_at: string
  agent_id?: string
  /** densable subagent stream field */
  session_agent_id?: string
}

/** densable paginatedGet return for internal-events (Q0a / hydrate). */
export type InternalEventsPage = {
  events: InternalEvent[]
  stats: {
    pageCount: number
    bytesReceived: number | null
    contentEncoding: string
  }
  /**
   * densable: after_event_id was rejected (gate off) or not-found (stale tip);
   * events are a full refetch without the anchor.
   */
  anchorFallback?: 'rejected' | 'not-found'
}

type ListInternalEventsResponse = {
  data: InternalEvent[]
  next_cursor?: string
  error?: { type?: string }
}

type WorkerStateResponse = {
  worker?: {
    external_metadata?: Record<string, unknown>
  }
}

/**
 * Manages the worker lifecycle protocol with CCR v2:
 * - Epoch management: reads worker_epoch from CLAUDE_CODE_WORKER_EPOCH env var
 * - Runtime state reporting: PUT /sessions/{id}/worker
 * - Heartbeat: POST /sessions/{id}/worker/heartbeat for liveness detection
 *
 * All writes go through this.request().
 */
export class CCRClient {
  private workerEpoch = 0
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatJitterFraction: number
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatInFlight = false
  private closed = false
  private consecutiveAuthFailures = 0
  private currentState: SessionState | null = null
  private readonly sessionBaseUrl: string
  private readonly sessionId: string
  private readonly http = createAxiosInstance({ keepAlive: true })

  // stream_event delay buffer — accumulates content deltas for up to
  // STREAM_EVENT_FLUSH_INTERVAL_MS before enqueueing (reduces POST count
  // and enables text_delta coalescing). Mirrors HybridTransport's pattern.
  private streamEventBuffer: SDKPartialAssistantMessage[] = []
  private streamEventTimer: ReturnType<typeof setTimeout> | null = null
  // Full-so-far text accumulator. Persists across flushes so each emitted
  // text_delta event carries the complete text from the start of the block —
  // mid-stream reconnects see a self-contained snapshot. Keyed by API message
  // ID; cleared in writeEvent when the complete assistant message arrives.
  private streamTextAccumulator = createStreamAccumulator()

  private readonly workerState: WorkerStateUploader
  private readonly eventUploader: SerialBatchEventUploader<ClientEvent>
  private readonly internalEventUploader: SerialBatchEventUploader<WorkerEvent>
  private readonly deliveryUploader: SerialBatchEventUploader<{
    eventId: string
    status: 'received' | 'processing' | 'processed'
  }>

  /**
   * densable onInternalBatchAcked — called after a successful internal-events
   * POST so the tip sidecar can advance (updateCCRTipFromAckedBatch / J0a).
   * Fire-and-forget; never blocks the uploader.
   */
  onInternalBatchAcked?: (batch: WorkerEvent[]) => void | Promise<void>

  /**
   * Called when the server returns 409 (a newer worker epoch superseded ours).
   * Default: process.exit(1) — correct for spawn-mode children where the
   * parent bridge re-spawns. In-process callers (replBridge) MUST override
   * this to close gracefully instead; exit would kill the user's REPL.
   */
  /**
   * densable onEpochMismatch(reason) — request-path terminal condition.
   * reason feeds gzp → close code (epoch_conflict→4090, token_expired→4094…).
   */
  private readonly onEpochMismatch: (reason?: string) => never

  /**
   * Auth header source. Defaults to the process-wide session-ingress token
   * (CLAUDE_CODE_SESSION_ACCESS_TOKEN env var). Callers managing multiple
   * concurrent sessions with distinct JWTs MUST inject this — the env-var
   * path is a process global and would stomp across sessions.
   */
  private readonly getAuthHeaders: () => Record<string, string>

  constructor(
    transport: SSETransport,
    sessionUrl: URL,
    opts?: {
      onEpochMismatch?: (reason?: string) => never
      heartbeatIntervalMs?: number
      heartbeatJitterFraction?: number
      /**
       * Per-instance auth header source. Omit to read the process-wide
       * CLAUDE_CODE_SESSION_ACCESS_TOKEN (single-session callers — REPL,
       * daemon). Required for concurrent multi-session callers.
       */
      getAuthHeaders?: () => Record<string, string>
    },
  ) {
    this.onEpochMismatch =
      opts?.onEpochMismatch ??
      ((_reason?: string) => {
        // eslint-disable-next-line custom-rules/no-process-exit
        process.exit(1)
      })
    this.heartbeatIntervalMs =
      opts?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.heartbeatJitterFraction = opts?.heartbeatJitterFraction ?? 0
    this.getAuthHeaders = opts?.getAuthHeaders ?? getSessionIngressAuthHeaders
    // Session URL: https://host/v1/code/sessions/{id}
    if (sessionUrl.protocol !== 'http:' && sessionUrl.protocol !== 'https:') {
      throw new Error(
        `CCRClient: Expected http(s) URL, got ${sessionUrl.protocol}`,
      )
    }
    const pathname = sessionUrl.pathname.replace(/\/$/, '')
    this.sessionBaseUrl = `${sessionUrl.protocol}//${sessionUrl.host}${pathname}`
    // Extract session ID from the URL path (last segment)
    this.sessionId = pathname.split('/').pop() || ''

    this.workerState = new WorkerStateUploader({
      send: body =>
        this.request(
          'put',
          '/worker',
          { worker_epoch: this.workerEpoch, ...body },
          'PUT worker',
        ).then(r => r.ok),
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.eventUploader = new SerialBatchEventUploader<ClientEvent>({
      maxBatchSize: 100,
      maxBatchBytes: 10 * 1024 * 1024,
      // flushStreamEventBuffer() enqueues a full 100ms window of accumulated
      // stream_events in one call. A burst of mixed delta types that don't
      // fold into a single snapshot could exceed the old cap (50) and deadlock
      // on the SerialBatchEventUploader backpressure check. Match
      // HybridTransport's bound — high enough to be memory-only.
      maxQueueSize: 100_000,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/events',
          { worker_epoch: this.workerEpoch, events: batch },
          'client events',
        )
        if (!result.ok) {
          throw new RetryableError(
            'client event POST failed',
            result.retryAfterMs,
          )
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.internalEventUploader = new SerialBatchEventUploader<WorkerEvent>({
      maxBatchSize: 100,
      maxBatchBytes: 10 * 1024 * 1024,
      maxQueueSize: 200,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/internal-events',
          { worker_epoch: this.workerEpoch, events: batch },
          'internal events',
        )
        if (result.ok) {
          // densable: Promise.resolve().then(()=>this.onInternalBatchAcked?.(s))
          void Promise.resolve()
            .then(() => this.onInternalBatchAcked?.(batch))
            .catch(() => {})
          return
        }
        // densable sCt 4xx drop path not fully ported — still retry non-ok.
        throw new RetryableError(
          'internal event POST failed',
          result.retryAfterMs,
        )
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.deliveryUploader = new SerialBatchEventUploader<{
      eventId: string
      status: 'received' | 'processing' | 'processed'
    }>({
      maxBatchSize: 64,
      maxQueueSize: 64,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/events/delivery',
          {
            worker_epoch: this.workerEpoch,
            updates: batch.map(d => ({
              event_id: d.eventId,
              status: d.status,
            })),
          },
          'delivery batch',
        )
        if (!result.ok) {
          throw new RetryableError('delivery POST failed', result.retryAfterMs)
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    // Ack each received client_event so CCR can track delivery status.
    // Wired here (not in initialize()) so the callback is registered the
    // moment new CCRClient() returns — remoteIO must be free to call
    // transport.connect() immediately after without racing the first
    // SSE catch-up frame against an unwired onEventCallback.
    transport.setOnEvent((event: StreamClientEvent) => {
      this.reportDelivery(event.event_id, 'received')
    })
  }

  /**
   * Initialize the session worker:
   * 1. Take worker_epoch from the argument, or fall back to
   *    CLAUDE_CODE_WORKER_EPOCH (set by env-manager / bridge spawner)
   * 2. Report state as 'idle'
   * 3. Start heartbeat timer
   *
   * In-process callers (replBridge) pass the epoch directly — they
   * registered the worker themselves and there is no parent process
   * setting env vars.
   */
  async initialize(epoch?: number): Promise<Record<string, unknown> | null> {
    const startMs = Date.now()
    if (Object.keys(this.getAuthHeaders()).length === 0) {
      throw new CCRInitError('no_auth_headers')
    }
    if (epoch === undefined) {
      // Official WORKER_EPOCH densable pure parse.
      try {
        const { resolveWorkerEpoch } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
        epoch = resolveWorkerEpoch() ?? NaN
      } catch {
        const rawEpoch = process.env.CLAUDE_CODE_WORKER_EPOCH
        epoch = rawEpoch ? parseInt(rawEpoch, 10) : NaN
      }
    }
    if (isNaN(epoch)) {
      throw new CCRInitError('missing_epoch')
    }
    this.workerEpoch = epoch

    // Concurrent with the init PUT — neither depends on the other.
    const restoredPromise = this.getWorkerState()

    const result = await this.request(
      'put',
      '/worker',
      {
        worker_status: 'idle',
        worker_epoch: this.workerEpoch,
        // Clear stale pending_action/task_summary left by a prior
        // worker crash — the in-session clears don't survive process restart.
        external_metadata: {
          pending_action: null,
          task_summary: null,
          automation_state: null,
        },
      },
      'PUT worker (init)',
    )
    if (!result.ok) {
      // 409 → onEpochMismatch may throw, but request() catches it and returns
      // false. Without this check we'd continue to startHeartbeat(), leaking a
      // 20s timer against a dead epoch. Throw so connect()'s rejection handler
      // fires instead of the success path.
      throw new CCRInitError('worker_register_failed')
    }
    this.currentState = 'idle'
    this.startHeartbeat()

    // sessionActivity's refcount-gated timer fires while an API call or tool
    // is in-flight; without a write the container lease can expire mid-wait.
    // v1 wires this in WebSocketTransport per-connection.
    registerSessionActivityCallback(() => {
      void this.writeEvent({ type: 'keep_alive' })
    })

    logForDebugging(`CCRClient: initialized, epoch=${this.workerEpoch}`)
    logForDiagnosticsNoPII('info', 'cli_worker_lifecycle_initialized', {
      epoch: this.workerEpoch,
      duration_ms: Date.now() - startMs,
    })

    // Await the concurrent GET and log state_restored here, after the PUT
    // has succeeded — logging inside getWorkerState() raced: if the GET
    // resolved before the PUT failed, diagnostics showed both init_failed
    // and state_restored for the same session.
    const { metadata, durationMs } = await restoredPromise
    if (!this.closed) {
      logForDiagnosticsNoPII('info', 'cli_worker_state_restored', {
        duration_ms: durationMs,
        had_state: metadata !== null,
      })
    }
    return metadata
  }

  // Control_requests are marked processed and not re-delivered on
  // restart, so read back what the prior worker wrote.
  private async getWorkerState(): Promise<{
    metadata: Record<string, unknown> | null
    durationMs: number
  }> {
    const startMs = Date.now()
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) {
      return { metadata: null, durationMs: 0 }
    }
    const data = await this.getWithRetry<WorkerStateResponse>(
      `${this.sessionBaseUrl}/worker`,
      authHeaders,
      'worker_state',
    )
    return {
      metadata: data?.worker?.external_metadata ?? null,
      durationMs: Date.now() - startMs,
    }
  }

  /**
   * Send an authenticated HTTP request to CCR. Handles auth headers,
   * 409 epoch mismatch, and error logging. Returns { ok: true } on 2xx.
   * On 429, reads Retry-After (integer seconds) so the uploader can honor
   * the server's backoff hint instead of blindly exponentiating.
   *
   * Official working-sync filestore densable: when softFailOn409 is set,
   * 409 is returned instead of process.exit (etag conflict on put).
   */
  private async request(
    method: 'post' | 'put' | 'get',
    path: string,
    body: unknown,
    label: string,
    {
      timeout = 10_000,
      softFailOn409 = false,
      maxBodyLength,
      maxContentLength,
    }: {
      timeout?: number
      softFailOn409?: boolean
      maxBodyLength?: number
      maxContentLength?: number
    } = {},
  ): Promise<RequestResult> {
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) return { ok: false }

    try {
      const config = {
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'User-Agent': getClaudeCodeUserAgent(),
        },
        validateStatus: alwaysValidStatus,
        timeout,
        ...(maxBodyLength !== undefined ? { maxBodyLength } : {}),
        ...(maxContentLength !== undefined ? { maxContentLength } : {}),
      }
      const response =
        method === 'get'
          ? await this.http.get(`${this.sessionBaseUrl}${path}`, config)
          : await this.http[method](
              `${this.sessionBaseUrl}${path}`,
              body,
              config,
            )

      if (response.status >= 200 && response.status < 300) {
        this.consecutiveAuthFailures = 0
        return { ok: true, status: response.status, data: response.data }
      }
      // densable 2.1.218 #36: once closed (worker replaced / shutdown), never
      // re-enter epoch-mismatch / exit paths on in-flight heartbeat responses.
      // Otherwise a late 409 keeps calling onEpochMismatch while the process
      // is already tearing down and desktop/IDE clients retry forever.
      if (this.closed) {
        return {
          ok: false,
          status: response.status,
          data: response.data,
        }
      }
      if (response.status === 409) {
        if (softFailOn409) {
          return { ok: false, status: 409, data: response.data }
        }
        this.handleEpochMismatch()
      }
      if (response.status === 401 || response.status === 403) {
        // A 401 with an expired JWT is deterministic — no retry will
        // ever succeed. Check the token's own exp before burning
        // wall-clock on the threshold loop.
        const tok = getSessionIngressAuthToken()
        const exp = tok ? decodeJwtExpiry(tok) : null
        if (exp !== null && exp * 1000 < Date.now()) {
          logForDebugging(
            `CCRClient: session_token expired (exp=${new Date(exp * 1000).toISOString()}) — no refresh was delivered, exiting`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_worker_token_expired_no_refresh')
          // densable gzp token_expired → 4094
          this.onEpochMismatch('token_expired')
        }
        // Token looks valid but server says 401 — possible server-side
        // blip (userauth down, KMS hiccup). Count toward threshold.
        this.consecutiveAuthFailures++
        if (this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
          logForDebugging(
            `CCRClient: ${this.consecutiveAuthFailures} consecutive auth failures with a valid-looking token — server-side auth unrecoverable, exiting`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_worker_auth_failures_exhausted')
          // densable gzp auth_exhausted → 4094
          this.onEpochMismatch('auth_exhausted')
        }
      }
      logForDebugging(`CCRClient: ${label} returned ${response.status}`, {
        level: 'warn',
      })
      logForDiagnosticsNoPII('warn', 'cli_worker_request_failed', {
        method,
        path,
        status: response.status,
      })
      if (response.status === 429) {
        const raw = response.headers?.['retry-after']
        const seconds = typeof raw === 'string' ? parseInt(raw, 10) : NaN
        if (!isNaN(seconds) && seconds >= 0) {
          return {
            ok: false,
            status: response.status,
            data: response.data,
            retryAfterMs: seconds * 1000,
          }
        }
      }
      return { ok: false, status: response.status, data: response.data }
    } catch (error) {
      logForDebugging(`CCRClient: ${label} failed: ${errorMessage(error)}`, {
        level: 'warn',
      })
      logForDiagnosticsNoPII('warn', 'cli_worker_request_error', {
        method,
        path,
        error_code: getErrnoCode(error),
      })
      return { ok: false }
    }
  }

  /**
   * Official j6o/J2t densable host — authenticated /worker/synced_file put/get.
   * Soft-fails on 409 so filestore etag conflicts don't kill the worker epoch.
   */
  async requestSyncedFile(args: {
    method: 'put' | 'get'
    path: string
    body?: unknown
    timeoutMs?: number
    maxBodyLength?: number
    maxContentLength?: number
  }): Promise<{
    ok: boolean
    reason?: string
    status?: number
    data?: { content?: string; content_sha256?: string }
  }> {
    const result = await this.request(
      args.method,
      args.path,
      args.body,
      `synced_file ${args.method}`,
      {
        timeout: args.timeoutMs ?? 30_000,
        softFailOn409: true,
        maxBodyLength: args.maxBodyLength,
        maxContentLength: args.maxContentLength,
      },
    )
    if (result.ok) {
      return {
        ok: true,
        status: result.status,
        data: result.data as
          | { content?: string; content_sha256?: string }
          | undefined,
      }
    }
    return {
      ok: false,
      status: result.status,
      reason: result.status === 409 ? 'conflict' : 'request_failed',
      data: result.data as
        | { content?: string; content_sha256?: string }
        | undefined,
    }
  }

  /** Report worker state to CCR via PUT /sessions/{id}/worker. */
  reportState(state: SessionState, details?: RequiresActionDetails): void {
    if (state === this.currentState && !details) return
    this.currentState = state
    this.workerState.enqueue({
      worker_status: state,
      requires_action_details: details
        ? {
            tool_name: details.tool_name,
            action_description: details.action_description,
            request_id: details.request_id,
          }
        : null,
    })
  }

  /** Report external metadata to CCR via PUT /worker. */
  reportMetadata(metadata: Record<string, unknown>): void {
    this.workerState.enqueue({ external_metadata: metadata })
  }

  /**
   * Handle epoch mismatch (409 Conflict). A newer CC instance has replaced
   * this one — stop heartbeats then exit immediately.
   * densable 2.1.218 #36: always stopHeartbeat first so a late in-flight
   * response cannot reschedule another POST after we're superseded.
   */
  private handleEpochMismatch(): never {
    this.closed = true
    this.stopHeartbeat()
    logForDebugging('CCRClient: Epoch mismatch (409), shutting down', {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_worker_epoch_mismatch')
    // densable gzp epoch_conflict → 4090 (Ls epoch_stale branch needs cause)
    this.onEpochMismatch('epoch_conflict')
  }

  /** Start periodic heartbeat. densable: no-op if already closed. */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.closed) return
    const schedule = (): void => {
      const jitter =
        this.heartbeatIntervalMs *
        this.heartbeatJitterFraction *
        (2 * Math.random() - 1)
      this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs + jitter)
    }
    const tick = (): void => {
      void this.sendHeartbeat()
      // stopHeartbeat nulls the timer; check after the fire-and-forget send
      // but before rescheduling so close() during sendHeartbeat is honored.
      if (this.heartbeatTimer === null) return
      schedule()
    }
    schedule()
  }

  /** Stop heartbeat timer. */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * densable sendHeartbeat — if closed, stop timer and return (no request).
   * Prevents post-replace heartbeats that get 409 and retry forever (#36).
   */
  private async sendHeartbeat(): Promise<void> {
    if (this.closed) {
      this.stopHeartbeat()
      return
    }
    if (this.heartbeatInFlight) return
    this.heartbeatInFlight = true
    try {
      const result = await this.request(
        'post',
        '/worker/heartbeat',
        { session_id: this.sessionId, worker_epoch: this.workerEpoch },
        'Heartbeat',
        { timeout: 5_000 },
      )
      if (result.ok) {
        logForDebugging('CCRClient: Heartbeat sent')
      }
    } finally {
      this.heartbeatInFlight = false
    }
  }

  /**
   * Write a StdoutMessage as a client event via POST /sessions/{id}/worker/events.
   * These events are visible to frontend clients via the SSE stream.
   * Injects a UUID if missing to ensure server-side idempotency on retry.
   *
   * stream_event messages are held in a 100ms delay buffer and accumulated
   * (text_deltas for the same content block emit a full-so-far snapshot per
   * flush). A non-stream_event write flushes the buffer first so downstream
   * ordering is preserved.
   */
  async writeEvent(message: StdoutMessage): Promise<void> {
    if (message.type === 'stream_event') {
      this.streamEventBuffer.push(message)
      if (!this.streamEventTimer) {
        this.streamEventTimer = setTimeout(
          () => void this.flushStreamEventBuffer(),
          STREAM_EVENT_FLUSH_INTERVAL_MS,
        )
      }
      return
    }
    await this.flushStreamEventBuffer()
    if (message.type === 'assistant') {
      clearStreamAccumulatorForMessage(
        this.streamTextAccumulator,
        message as {
          session_id: string
          parent_tool_use_id: string | null
          message: { id: string }
        },
      )
    }
    await this.eventUploader.enqueue(this.toClientEvent(message))
  }

  /** Wrap a StdoutMessage as a ClientEvent, injecting a UUID if missing. */
  private toClientEvent(message: StdoutMessage): ClientEvent {
    const msg = message as unknown as Record<string, unknown>
    return {
      payload: {
        ...msg,
        uuid: typeof msg.uuid === 'string' ? msg.uuid : randomUUID(),
      } as EventPayload,
    }
  }

  /**
   * Drain the stream_event delay buffer: accumulate text_deltas into
   * full-so-far snapshots, clear the timer, enqueue the resulting events.
   * Called from the timer, from writeEvent on a non-stream message, and from
   * flush(). close() drops the buffer — call flush() first if you need
   * delivery.
   */
  private async flushStreamEventBuffer(): Promise<void> {
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    if (this.streamEventBuffer.length === 0) return
    const buffered = this.streamEventBuffer
    this.streamEventBuffer = []
    const payloads = accumulateStreamEvents(
      buffered,
      this.streamTextAccumulator,
    )
    await this.eventUploader.enqueue(
      payloads.map(payload => ({ payload, ephemeral: true })),
    )
  }

  /**
   * Write an internal worker event via POST /sessions/{id}/worker/internal-events.
   * These events are NOT visible to frontend clients — they store worker-internal
   * state (transcript messages, compaction markers) needed for session resume.
   */
  async writeInternalEvent(
    eventType: string,
    payload: Record<string, unknown>,
    {
      isCompaction = false,
      agentId,
    }: {
      isCompaction?: boolean
      agentId?: string
    } = {},
  ): Promise<void> {
    const event: WorkerEvent = {
      payload: {
        type: eventType,
        ...payload,
        uuid: typeof payload.uuid === 'string' ? payload.uuid : randomUUID(),
      } as EventPayload,
      ...(isCompaction && { is_compaction: true }),
      ...(agentId && { agent_id: agentId }),
    }
    await this.internalEventUploader.enqueue(event)
  }

  /**
   * Flush pending internal events. Call between turns and on shutdown
   * to ensure transcript entries are persisted.
   */
  flushInternalEvents(): Promise<void> {
    return this.internalEventUploader.flush()
  }

  /**
   * Flush pending client events (writeEvent queue). Call before close()
   * when the caller needs delivery confirmation — close() abandons the
   * queue. Resolves once the uploader drains or rejects; returns
   * regardless of whether individual POSTs succeeded (check server state
   * separately if that matters).
   */
  async flush(): Promise<void> {
    await this.flushStreamEventBuffer()
    return this.eventUploader.flush()
  }

  /**
   * densable readInternalEvents(e) — GET /worker/internal-events with optional
   * after_event_id for delta rehydrate (2.1.225 #10).
   */
  async readInternalEvents(
    afterEventId?: string,
  ): Promise<InternalEventsPage | null> {
    return this.paginatedGet(
      '/worker/internal-events',
      {
        limit: '1000',
        ...(afterEventId ? { after_event_id: afterEventId } : {}),
      },
      'internal_events',
    )
  }

  /**
   * densable readSubagentInternalEvents — subagents=true, limit=1000.
   */
  async readSubagentInternalEvents(): Promise<InternalEventsPage | null> {
    return this.paginatedGet(
      '/worker/internal-events',
      { subagents: 'true', limit: '1000' },
      'subagent_events',
    )
  }

  /**
   * densable paginatedGet — multi-page fetch with after_event_id fallback.
   * Returns {events, stats, anchorFallback?} or null on hard failure.
   */
  private async paginatedGet(
    path: string,
    params: Record<string, string>,
    context: string,
  ): Promise<InternalEventsPage | null> {
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) return null

    const allEvents: InternalEvent[] = []
    let cursor: string | undefined
    let pageCount = 0
    let bytesReceived: number | null = 0
    let contentEncoding: string | null = null

    do {
      const url = new URL(`${this.sessionBaseUrl}${path}`)
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
      }
      if (cursor) {
        url.searchParams.set('cursor', cursor)
        // densable: after first page, drop after_event_id (cursor takes over)
        url.searchParams.delete('after_event_id')
      }

      const isAnchorProbe = !cursor && params.after_event_id !== undefined
      let anchorFail: 'rejected' | 'not-found' | undefined

      const page = await this.getWithRetry<ListInternalEventsResponse>(
        url.toString(),
        authHeaders,
        context,
        headers => {
          pageCount++
          contentEncoding ??= headers['content-encoding'] ?? null
          const cl = headers['content-length']
          if (cl != null && bytesReceived !== null) {
            bytesReceived += Number(cl)
          } else {
            bytesReceived = null
          }
        },
        // densable: only the after_event_id anchor probe early-exits on 400 /
        // after_event_id_not_found so paginatedGet can full-refetch. Cursor
        // pages and unanchored reads must keep the normal retry loop.
        (status, errType) => {
          if (!isAnchorProbe) return
          if (status === 400) {
            anchorFail = 'rejected'
            return 'early-exit'
          }
          if (errType === 'after_event_id_not_found') {
            anchorFail = 'not-found'
            return 'early-exit'
          }
        },
      )

      if (!page) {
        if (anchorFail) {
          logForDebugging(
            `CCRClient: after_event_id ${
              anchorFail === 'rejected'
                ? 'rejected by server (gate off)'
                : 'not found (stale anchor)'
            } — refetching without anchor`,
            { level: 'warn' },
          )
          logForDiagnosticsNoPII(
            'warn',
            anchorFail === 'rejected'
              ? 'cli_worker_after_event_id_rejected'
              : 'cli_worker_after_event_id_not_found',
            { context },
          )
          const { after_event_id: _drop, ...rest } = params
          const full = await this.paginatedGet(path, rest, context)
          if (!full) return null
          return { ...full, anchorFallback: anchorFail }
        }
        return null
      }

      allEvents.push(...(page.data ?? []))
      cursor = page.next_cursor
    } while (cursor)

    logForDebugging(
      `CCRClient: Read ${allEvents.length} internal events from ${path}${params.subagents ? ' (subagents)' : ''}`,
    )
    return {
      events: allEvents,
      stats: {
        pageCount,
        bytesReceived,
        contentEncoding: contentEncoding ?? 'none',
      },
    }
  }

  /**
   * Single GET with retry. Optional onOkHeaders / onErrorStatus for densable
   * after_event_id anchor handling.
   *
   * onErrorStatus may return `'early-exit'` to stop retrying immediately
   * (anchor probe 400 / after_event_id_not_found → paginatedGet full refetch).
   * Presence of the callback alone must NOT suppress retries for other pages.
   */
  private async getWithRetry<T>(
    url: string,
    authHeaders: Record<string, string>,
    context: string,
    onOkHeaders?: (headers: Record<string, string | undefined>) => void,
    onErrorStatus?: (
      status: number,
      errType?: string,
    ) => 'early-exit' | undefined,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= 10; attempt++) {
      let response
      try {
        response = await this.http.get<T>(url, {
          headers: {
            ...authHeaders,
            'anthropic-version': '2023-06-01',
            'User-Agent': getClaudeCodeUserAgent(),
          },
          validateStatus: alwaysValidStatus,
          timeout: 30_000,
        })
      } catch (error) {
        logForDebugging(
          `CCRClient: GET ${url} failed (attempt ${attempt}/10): ${errorMessage(error)}`,
          { level: 'warn' },
        )
        if (attempt < 10) {
          const delay =
            Math.min(500 * 2 ** (attempt - 1), 30_000) + Math.random() * 500
          await sleep(delay)
        }
        continue
      }

      if (response.status >= 200 && response.status < 300) {
        onOkHeaders?.(
          response.headers as unknown as Record<string, string | undefined>,
        )
        return response.data
      }
      if (response.status === 409) {
        this.handleEpochMismatch()
      }

      let errType: string | undefined
      try {
        const body = response.data as { error?: { type?: string } } | undefined
        if (typeof body?.error?.type === 'string') {
          errType = body.error.type
        }
      } catch {
        // ignore
      }
      const errorAction = onErrorStatus?.(response.status, errType)

      // densable: only when callback opts in (anchor probe) — do not gate on
      // callback presence alone (every paginated page passes onErrorStatus).
      if (errorAction === 'early-exit') {
        return null
      }

      logForDebugging(
        `CCRClient: GET ${url} returned ${response.status} (attempt ${attempt}/10)`,
        { level: 'warn' },
      )

      if (attempt < 10) {
        const delay =
          Math.min(500 * 2 ** (attempt - 1), 30_000) + Math.random() * 500
        await sleep(delay)
      }
    }

    logForDebugging('CCRClient: GET retries exhausted', { level: 'error' })
    logForDiagnosticsNoPII('error', 'cli_worker_get_retries_exhausted', {
      context,
    })
    return null
  }

  /**
   * Report delivery status for a client-to-worker event.
   * POST /v1/code/sessions/{id}/worker/events/delivery (batch endpoint)
   */
  reportDelivery(
    eventId: string,
    status: 'received' | 'processing' | 'processed',
  ): void {
    void this.deliveryUploader.enqueue({ eventId, status })
  }

  /** Get the current epoch (for external use). */
  getWorkerEpoch(): number {
    return this.workerEpoch
  }

  /** Internal-event queue depth — shutdown-snapshot backpressure signal. */
  get internalEventsPending(): number {
    return this.internalEventUploader.pendingCount
  }

  /** Clean up uploaders and timers. */
  close(): void {
    this.closed = true
    this.stopHeartbeat()
    unregisterSessionActivityCallback()
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    this.streamEventBuffer = []
    this.streamTextAccumulator.byMessage.clear()
    this.streamTextAccumulator.scopeToMessage.clear()
    this.workerState.close()
    this.eventUploader.close()
    this.internalEventUploader.close()
    this.deliveryUploader.close()
  }
}
