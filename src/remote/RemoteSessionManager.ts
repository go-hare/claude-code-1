import { randomUUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlPermissionRequest,
  SDKControlRequest,
  SDKControlRequestInner,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logEvent } from '../services/analytics/index.js'
import {
  clipServedRequestId,
  isRemoteToolsServedSubtype,
  leftoverServedSendOpts,
  REMOTE_SERVE_REQUEST_ID_CAP,
  type ServedChannelAnswer,
  type ServedChannelPostOutcome,
  type ServedChannelRequest,
  stampServeControlRequest,
  wrapServedResultForChannel,
} from '../services/tools/remoteToolServe.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { jsonStringify } from '../utils/slowOperations.js'
import {
  type RemoteMessageContent,
  sendEventToRemoteSession,
} from '../utils/teleport/api.js'
import {
  SessionsV2Client,
  type SessionsV2ClientCallbacks,
  type SessionsV2ClientOptions,
  type SessionsV2ConnectInfo,
  type SessionsV2DeliveryUpdate,
  type SessionsV2EventPostOutcome,
  type SessionsV2EventSigner,
  type SessionsV2ToolHostEnded,
} from './SessionsV2Client.js'
import {
  SessionsWebSocket,
  type SessionsWebSocketCallbacks,
} from './SessionsWebSocket.js'

/**
 * densable `y5b` — max size of seenControlResponseIds ring before FIFO eviction.
 * Used so redelivered dialog request_ids that were already answered stay skipped.
 */
const SEEN_CONTROL_RESPONSE_ID_CAP = 1000

/** Official `ht` (`chunk@318978761.js @43200`) — undelivered response retry delays. */
const UNDELIVERED_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 45_000] as const
const MAX_UNDELIVERED_RETRY_ATTEMPTS = UNDELIVERED_RETRY_DELAYS_MS.length

/** Official `En` (`chunk@318978761.js`) — timeout for served tool response POSTs. */
const SERVED_TOOL_RESPONSE_TIMEOUT_MS = 120_000

/**
 * Official `qX` — subagent permission requests (non-AskUserQuestion, non-ExitPlanMode)
 * may outlive a main-thread turn end when `subagentRequestsOutliveTheTurn` is enabled.
 */
function isSubagentPermissionRequest(
  req: SDKControlPermissionRequest & { agent_id?: unknown },
): boolean {
  return (
    typeof req.agent_id === 'string' &&
    req.agent_id !== '' &&
    typeof req.tool_name === 'string' &&
    req.tool_name !== 'AskUserQuestion' &&
    req.tool_name !== 'ExitPlanMode'
  )
}

/**
 * Type guard to check if a message is an SDKMessage (not a control message)
 */
function isSDKMessage(
  message:
    | SDKMessage
    | SDKControlRequest
    | SDKControlResponse
    | SDKControlCancelRequest,
): message is SDKMessage {
  return (
    message.type !== 'control_request' &&
    message.type !== 'control_response' &&
    message.type !== 'control_cancel_request'
  )
}

/**
 * Simple permission response for remote sessions.
 * This is a simplified version of PermissionResult for CCR communication.
 */
export type RemotePermissionResponse =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
    }
  | {
      behavior: 'deny'
      message: string
    }

/** densable iSf — host answer for request_user_dialog. */
export type RemoteUserDialogResponse = {
  behavior: 'completed' | 'cancelled'
  result?: unknown
}

export type RemoteResponseKind = 'permission' | 'dialog' | 'hook' | 'tool'
export type RemoteResponseUndeliveredReason = 'undelivered' | 'overtaken'

type UndeliveredResponseEntry = {
  response: SDKControlResponse
  kind: RemoteResponseKind
  uuid: string
  request?: SDKControlPermissionRequest
  failures: number
  inFlight: boolean
  giveUpOnSettle: RemoteResponseUndeliveredReason | null
  timer: ReturnType<typeof setTimeout> | null
  told: boolean
}

export type RemoteSessionConfig = {
  sessionId: string
  getAccessToken: () => string
  orgUuid: string
  /** True if session was created with an initial prompt that's being processed */
  hasInitialPrompt?: boolean
  /** densable `I.initialPromptUuid` — seeded remote prompt id for F$ */
  initialPromptUuid?: string
  /**
   * When true, this client is a pure viewer. Ctrl+C/Escape do NOT send
   * interrupt to the remote agent; 60s reconnect timeout is disabled;
   * session title is never updated. Used by `claude assistant`.
   */
  viewerOnly?: boolean
  /**
   * gold `h.servedTools` — this machine is the announced tool host.
   * Undefined → leftover `wAt` stays null.
   */
  servedTools?: unknown
  /** 2.1.299 #621: open subagent permission/dialog requests carried across attach */
  seedSubagentRequests?: SDKControlRequest[]
  /** 2.1.299 #621: subagent ids asking past a turn end */
  seedAskersPastATurn?: string[]
  /** 2.1.300 #626: keep open subagent permission requests alive across turn end */
  subagentRequestsOutliveTheTurn?: boolean
  /**
   * Official 2.1.328 transport selection: defaults to CCR v2 SSE (`SessionsV2Client`).
   * Set `transport: 'websocket'` or `useLegacyWebSocket: true` to explicitly fall back
   * to the legacy v1 `SessionsWebSocket` transport.
   */
  transport?: 'sse' | 'websocket'
  /** Explicit legacy v1 WebSocket opt-in (equivalent to `transport: 'websocket'`). */
  useLegacyWebSocket?: boolean
  /** Called on HTTP 401 to refresh OAuth credentials before retrying SSE / POST. */
  onAuth401?: (staleBearer: string) => Promise<boolean>
  /** Resume SSE stream from this sequence number (`from_sequence_num` / `Last-Event-ID`). */
  initialSequenceNum?: number
  /** Request `control_only=1` on the SSE stream. */
  controlOnly?: boolean
  /** Keep redialling indefinitely past the 5-attempt reconnect budget. */
  keepStreamRedialling?: boolean
  /**
   * Keep undelivered control responses in memory and automatically retry on reconnect
   * (defaults to `true` on `SessionsV2Client`; pass `false` to disable).
   */
  keepUndeliveredResponses?: boolean
  /** Track in-flight outbound POST requests for `flushSends()`. */
  trackSendsInFlight?: boolean
  /** Optional event signer for device-attested sessions. */
  eventSigner?: SessionsV2EventSigner
  /**
   * Official 2.1.328 `rebindEventSigner` (`chunk@318978761.js @45757`).
   * Invoked when `security_update` raises the tier to `elevated` (and on reconnect
   * after a tier raise). If it returns a new signer function, the active
   * `SessionsV2Client` adopts it immediately.
   */
  rebindEventSigner?: (() => SessionsV2EventSigner | undefined) | (() => void)
  /** Optional overrides forwarded to `SessionsV2Client` (e.g. custom fetch/timers in tests). */
  v2ClientOptions?: Partial<SessionsV2ClientOptions>
}

export type RemoteSessionCallbacks = {
  /** Called when an SDKMessage is received from the session */
  onMessage: (message: SDKMessage) => void
  /** Called when a permission request is received from CCR */
  onPermissionRequest: (
    request: SDKControlPermissionRequest,
    requestId: string,
  ) => void
  /** Called when the server cancels a pending permission request */
  onPermissionCancelled?: (
    requestId: string,
    toolUseId: string | undefined,
  ) => void
  /**
   * densable onUserDialogRequest — request_user_dialog control request.
   * Optional: if absent, unsupported subtype error is returned to the worker
   * (same as any other unknown subtype).
   */
  onUserDialogRequest?: (
    request: Extract<
      SDKControlRequestInner,
      { subtype: 'request_user_dialog' }
    >,
    requestId: string,
  ) => void
  /** densable onUserDialogCancelled */
  onUserDialogCancelled?: (requestId: string) => void
  /** Called when connection is established */
  onConnected?: (info?: SessionsV2ConnectInfo) => void
  /** Called when connection is lost and cannot be restored */
  onDisconnected?: (reason?: string) => void
  /** Called on transient stream drop while reconnect backoff is in progress */
  onReconnecting?: () => void
  /** Official 2.1.328 `onStreamSilent` — liveness timeout fired on SSE stream */
  onStreamSilent?: (info: { suspended: boolean }) => void
  /** densable onCatchUpTruncated — optional */
  onCatchUpTruncated?: () => void
  /** Called on error */
  onError?: (error: Error) => void
  /**
   * gold `onServedChannelRequest` — inbound `Cle` subtypes on this announced
   * machine. Absent → leave unanswered (`not serving tools here`).
   */
  onServedChannelRequest?: (request: ServedChannelRequest) => void
  /** gold `onServedChannelRequestCancelled` */
  onServedChannelRequestCancelled?: (
    requestId: string,
    why: 'worker' | 'disconnected',
  ) => void
  /**
   * gold `onWorkerLive` — first non-replayed worker frame this connection.
   */
  onWorkerLive?: () => void
  /**
   * gold `onWorkerGone` — stream drop (leftover: `disconnect`). Skip
   * `endWorkerStart`.
   */
  onWorkerGone?: () => void
  /** Official 2.1.328 `onDeliveryUpdate` — raw `delivery_update` frame (`PROCESSING`/`PROCESSED`). */
  onDeliveryUpdate?: (update: SessionsV2DeliveryUpdate) => void
  /** Official 2.1.328 `onLineTaken` — delivery status matched `PROCESSING`/`PROCESSED`. */
  onLineTaken?: (eventId: string) => void
  /** Official 2.1.328 `onLineSettled` — delivery status matched `PROCESSED` (return true to suppress `onLineTaken`). */
  onLineSettled?: ((eventId: string) => boolean) | ((eventId: string) => void)
  /** Official 2.1.328 `onWorkerConnectionStatus` — `session_update.connection_status`. */
  onWorkerConnectionStatus?: (status: string) => void
  /** Official 2.1.328 `onToolHostEnded` — `ephemeral_event` with `event_type: 'tool_host_ended'`. */
  onToolHostEnded?: (info: SessionsV2ToolHostEnded) => void
  /** Official 2.1.328 `onSecurityTierRaised` — `security_update` with `security_tier: 'elevated'`. */
  onSecurityTierRaised?: () => void
  /** Official 2.1.328 `onResponseUndelivered` — kept control response gave up or was overtaken. */
  onResponseUndelivered?: (
    requestId: string,
    kind: RemoteResponseKind,
    reason: RemoteResponseUndeliveredReason,
  ) => void
}

function sendOptionsForKind(kind: RemoteResponseKind | null): {
  timeoutMs?: number
} {
  return kind === 'tool' ? { timeoutMs: SERVED_TOOL_RESPONSE_TIMEOUT_MS } : {}
}

/**
 * Manages a remote CCR session.
 *
 * Coordinates:
 * - CCR v2 SSE subscription (`SessionsV2Client`) by default, with legacy
 *   `SessionsWebSocket` fallback when explicitly requested
 * - HTTP POST for sending user messages and control responses to CCR
 * - `undeliveredResponses` retry queue across disconnects/reconnects
 * - Permission request/response flow & dialog redelivery
 */
export class RemoteSessionManager {
  private client: SessionsV2Client | null = null
  private websocket: SessionsWebSocket | null = null
  private pendingPermissionRequests: Map<string, SDKControlPermissionRequest> =
    new Map()
  /** Official `undeliveredResponses` (`chunk@318978761.js @43620`) — retried on timer and reconnect. */
  private undeliveredResponses: Map<string, UndeliveredResponseEntry> =
    new Map()
  private seedRequestsArmed = false
  private securityTierRaiseSeen = false
  private lifetime = new AbortController()
  /** densable pendingDialogRequests — request_ids of open request_user_dialog */
  private pendingDialogRequests: Set<string> = new Set()
  /**
   * densable seenControlResponseIds — request_ids we already answered so
   * pending_user_dialog_requests redelivery does not re-open them.
   */
  private seenControlResponseIds: Set<string> = new Set()
  /**
   * 2.1.292 #233: retiredPermissionRequestIds — permission request_ids
   * already answered or cancelled here so large-transcript replays don't re-arm.
   */
  private retiredPermissionRequestIds: Set<string> = new Set()
  /** Official 2.1.300 (#626): turn-dismissed requests eligible for redelivery reinstatement */
  private reinstatablePermissionRequests: Map<
    string,
    SDKControlPermissionRequest
  > = new Map()
  private reinstatableDialogIds: Set<string> = new Set()
  /**
   * gold `pendingServedRequests` — inbound `Cle` subtypes in hand.
   */
  private pendingServedRequests = new Map<
    string,
    { abort: AbortController; subtype: string }
  >()
  /** gold `settledServedRequestIds` — FIFO via `x` / `Qt`=1000. */
  private settledServedRequestIds: Set<string> = new Set()
  /** gold `markServing` */
  private serving = false
  /**
   * gold `workerSeenThisConnection` — first worker frame this stream.
   * Reset on leftover disconnect (skip `endWorkerStart`).
   */
  private workerSeenThisConnection = false

  constructor(
    private readonly config: RemoteSessionConfig,
    private readonly callbacks: RemoteSessionCallbacks,
  ) {}

  private shouldUseLegacyWebSocket(): boolean {
    return (
      this.config.useLegacyWebSocket === true ||
      this.config.transport === 'websocket'
    )
  }

  private shouldKeepUndeliveredResponses(): boolean {
    return this.config.keepUndeliveredResponses !== false
  }

  private invokeRebindEventSigner(): void {
    try {
      const nextSigner = this.config.rebindEventSigner?.()
      if (typeof nextSigner === 'function') {
        this.client?.setEventSigner(nextSigner)
      }
    } catch (err) {
      logForDebugging(
        `[RemoteSessionManager] rebindEventSigner threw: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }
  }

  private armSeedRequestsIfNeeded(): void {
    if (this.seedRequestsArmed || this.lifetime.signal.aborted) {
      return
    }
    this.seedRequestsArmed = true
    const before = this.pendingPermissionRequests.size
    const seeds = this.config.seedSubagentRequests ?? []
    for (const seed of seeds) {
      try {
        this.handleControlRequest(seed, {})
      } catch (err) {
        logForDebugging(
          `[RemoteSessionManager] seedSubagentRequests handler threw: ${errorMessage(err)}`,
          { level: 'warn' },
        )
      }
    }
    const adopted = this.pendingPermissionRequests.size - before
    if (adopted > 0) {
      logEvent('tengu_remote_subagent_requests_adopted', {
        count: adopted,
        subagents_asking_at_a_turn_end:
          this.config.seedAskersPastATurn?.length ?? 0,
      })
    }
  }

  /**
   * Connect to the remote session via CCR v2 SSE (`SessionsV2Client`) by default,
   * or legacy v1 `SessionsWebSocket` when explicitly requested.
   */
  connect(): void {
    logForDebugging(
      `[RemoteSessionManager] Connecting to session ${this.config.sessionId}`,
    )

    if (this.shouldUseLegacyWebSocket()) {
      const wsCallbacks: SessionsWebSocketCallbacks = {
        onMessage: (message, extras) => this.handleMessage(message, extras),
        onConnected: () => {
          logForDebugging('[RemoteSessionManager] Connected')
          this.workerSeenThisConnection = false
          this.callbacks.onConnected?.()
          this.armSeedRequestsIfNeeded()
        },
        onClose: () => {
          logForDebugging('[RemoteSessionManager] Disconnected')
          this.callbacks.onDisconnected?.()
        },
        onReconnecting: () => {
          this.workerSeenThisConnection = false
          logForDebugging('[RemoteSessionManager] Reconnecting')
          this.callbacks.onReconnecting?.()
        },
        onError: error => {
          logError(error)
          this.callbacks.onError?.(error)
        },
      }

      this.websocket = new SessionsWebSocket(
        this.config.sessionId,
        this.config.orgUuid,
        this.config.getAccessToken,
        wsCallbacks,
      )

      void this.websocket.connect()
      return
    }

    const sseCallbacks: SessionsV2ClientCallbacks = {
      onMessage: (message, extras) => this.handleMessage(message, extras),
      onConnected: info => {
        logForDebugging('[RemoteSessionManager] Connected')
        this.workerSeenThisConnection = false
        if (this.securityTierRaiseSeen) {
          this.invokeRebindEventSigner()
        }
        for (const entry of this.undeliveredResponses.values()) {
          entry.failures = 0
          if (entry.giveUpOnSettle === 'undelivered') {
            entry.giveUpOnSettle = null
          }
        }
        this.resendUndeliveredResponses()
        this.callbacks.onConnected?.(info)
        this.armSeedRequestsIfNeeded()
      },
      onClose: reason => {
        logForDebugging('[RemoteSessionManager] Disconnected')
        if (this.client?.isRevivable()) {
          this.giveUpUndeliveredResponses()
        } else {
          this.dropUndeliveredResponses()
        }
        this.callbacks.onDisconnected?.(reason)
      },
      onReconnecting: () => {
        this.workerSeenThisConnection = false
        logForDebugging('[RemoteSessionManager] Reconnecting')
        this.callbacks.onReconnecting?.()
      },
      onStreamSilent: info => {
        this.callbacks.onStreamSilent?.(info)
      },
      onDeliveryUpdate: ({ eventId, status }) => {
        this.callbacks.onDeliveryUpdate?.({ eventId, status })
        if (/PROCESS(ING|ED)$/i.test(status)) {
          if (
            /PROCESSED$/i.test(status) &&
            this.callbacks.onLineSettled?.(eventId)
          ) {
            return
          }
          this.callbacks.onLineTaken?.(eventId)
        }
      },
      onWorkerConnectionStatus: status => {
        logForDebugging(
          `[RemoteSessionManager] The service reports the worker ${
            status === 'connected' || status === 'disconnected'
              ? status
              : 'in an unknown state'
          }`,
        )
        if (status === 'connected') {
          this.noteWorkerLive()
          this.callbacks.onWorkerConnectionStatus?.(status)
        } else if (status === 'disconnected') {
          this.workerSeenThisConnection = false
          this.callbacks.onWorkerGone?.()
          this.callbacks.onWorkerConnectionStatus?.(status)
        }
      },
      onSecurityTierRaised: () => {
        this.securityTierRaiseSeen = true
        this.invokeRebindEventSigner()
        this.callbacks.onSecurityTierRaised?.()
      },
      onToolHostEnded: info => {
        logForDebugging(
          "[RemoteSessionManager] The service ended this session's connection to a computer serving its tools",
        )
        this.callbacks.onToolHostEnded?.(info)
      },
      onCatchUpTruncated: () => {
        logForDebugging('[RemoteSessionManager] Catch-up truncated')
        this.callbacks.onCatchUpTruncated?.()
      },
      onError: error => {
        logError(error)
        this.callbacks.onError?.(error)
      },
    }

    this.client = new SessionsV2Client(
      this.config.sessionId,
      this.config.orgUuid,
      this.config.getAccessToken,
      sseCallbacks,
      this.config.onAuth401,
      this.config.initialSequenceNum,
      {
        ...this.config.v2ClientOptions,
        trackSends:
          this.config.trackSendsInFlight === true ||
          this.config.v2ClientOptions?.trackSends === true,
        controlOnly:
          this.config.controlOnly === true ||
          this.config.v2ClientOptions?.controlOnly === true,
        eventSigner:
          this.config.eventSigner ?? this.config.v2ClientOptions?.eventSigner,
        keepRedialling: () =>
          this.config.keepStreamRedialling === true ||
          this.serving ||
          this.config.v2ClientOptions?.keepRedialling?.() === true,
      },
    )

    void this.client.connect()
  }

  /**
   * densable handleMessage — control_request / cancel / control_response
   * (answered-elsewhere + dialog redelivery) / result clear / forward SDK.
   */
  /**
   * gold `handleMessage(e,n={})` @206741679 — extras is ye Ne/Lt second arg.
   */
  private handleMessage(
    message:
      | SDKMessage
      | SDKControlRequest
      | SDKControlResponse
      | SDKControlCancelRequest,
    extras: Record<string, unknown> = {},
  ): void {
    // gold `n.source==="worker"&&n.replayed!==!0` then noteWorkerLive
    if (extras.source === 'worker' && extras.replayed !== true) {
      this.noteWorkerLive()
    }
    if (message.type === 'control_request') {
      // gold handleControlRequest(e,n). Leftover also merges fields stamped
      // onto the payload (SSE leftoverDeliver).
      const bag = stampServeControlRequest(
        { type: 'control_request' },
        {
          ...extras,
          ...(message as unknown as Record<string, unknown>),
        },
      )
      this.handleControlRequest(message as SDKControlRequest, bag)
      return
    }

    // densable: dialog cancel first, then permission; unknown → ignore
    if (message.type === 'control_cancel_request') {
      const { request_id } = message as SDKControlCancelRequest
      this.reinstatablePermissionRequests.delete(request_id)
      this.reinstatableDialogIds.delete(request_id)
      const kept = this.undeliveredResponses.get(request_id)
      if (kept?.kind === 'hook' || kept?.kind === 'tool') {
        this.giveUpUndeliveredEntry(kept, 'overtaken')
      } else if (kept) {
        this.dropKeptResponse(kept)
      }
      if (this.retireServedRequest(request_id, 'worker')) {
        return
      }
      if (this.pendingDialogRequests.delete(request_id)) {
        logForDebugging(
          `[RemoteSessionManager] User dialog request cancelled: ${request_id}`,
        )
        this.callbacks.onUserDialogCancelled?.(request_id)
        return
      }
      const pendingRequest = this.pendingPermissionRequests.get(request_id)
      if (!pendingRequest) {
        logForDebugging(
          `[RemoteSessionManager] control_cancel_request for unknown request ${request_id} — nothing pending, ignoring`,
        )
        return
      }
      logForDebugging(
        `[RemoteSessionManager] Permission request cancelled: ${request_id}`,
      )
      this.retirePermissionRequest(request_id)
      this.callbacks.onPermissionCancelled?.(
        request_id,
        pendingRequest.tool_use_id,
      )
      return
    }

    // densable control_response: record seen id; dismiss pending permission/dialog
    // answered elsewhere; re-arm pending_user_dialog_requests redelivery.
    if (message.type === 'control_response') {
      const response = (message as SDKControlResponse).response
      const requestId = response.request_id
      this.recordSeenControlResponseId(requestId)

      const kept = this.undeliveredResponses.get(requestId)
      const msgUuid =
        'uuid' in message ? (message as { uuid?: unknown }).uuid : undefined
      if (
        kept !== undefined &&
        msgUuid === kept.uuid &&
        kept.giveUpOnSettle !== 'overtaken'
      ) {
        this.dropKeptResponse(kept)
      }

      const pendingPerm = this.pendingPermissionRequests.get(requestId)
      if (pendingPerm) {
        this.retirePermissionRequest(requestId)
        logForDebugging(
          `[RemoteSessionManager] Permission request ${requestId} answered elsewhere — dismissing`,
        )
        this.callbacks.onPermissionCancelled?.(
          requestId,
          pendingPerm.tool_use_id,
        )
      } else if (this.pendingDialogRequests.delete(requestId)) {
        logForDebugging(
          `[RemoteSessionManager] User dialog request ${requestId} answered elsewhere — dismissing`,
        )
        this.callbacks.onUserDialogCancelled?.(requestId)
      } else {
        logForDebugging(
          `[RemoteSessionManager] Unmatched control_response ${requestId} (${response.subtype})${
            response.subtype === 'error' ? `: ${response.error}` : ''
          }`,
        )
      }

      // densable redelivery: only request_user_dialog entries; skip already-answered
      const pendingDialogs = (
        response as {
          pending_user_dialog_requests?: SDKControlRequest[]
        }
      ).pending_user_dialog_requests
      if (pendingDialogs) {
        for (const n of pendingDialogs) {
          if (n.request?.subtype !== 'request_user_dialog') continue
          if (this.seenControlResponseIds.has(n.request_id)) {
            logForDebugging(
              `[RemoteSessionManager] Redelivered dialog ${n.request_id} already answered — skipping`,
            )
            continue
          }
          const wasPending = this.pendingDialogRequests.has(n.request_id)
          this.handleControlRequest(n)
          if (!wasPending && this.pendingDialogRequests.has(n.request_id)) {
            logEvent('remote_dialog_redelivery', {})
          }
        }
      }
      return
    }

    // Official 2.1.300 (#626): clear unresolved main-thread permission + dialog prompts
    // on turn result; keep subagent permission requests open when subagentRequestsOutliveTheTurn.
    if (isSDKMessage(message) && message.type === 'result') {
      const allPending = [...this.pendingPermissionRequests]
      const toDismiss =
        this.config.subagentRequestsOutliveTheTurn === true
          ? allPending.filter(([, perm]) => !isSubagentPermissionRequest(perm))
          : allPending
      for (const [requestId, pending] of toDismiss) {
        logForDebugging(
          `[RemoteSessionManager] Turn ended with permission request ${requestId} unresolved — dismissing`,
        )
        this.callbacks.onPermissionCancelled?.(requestId, pending.tool_use_id)
        this.retirePermissionRequest(requestId)
        this.recordReinstatablePermissionRequest(requestId, pending)
      }
      if (allPending.length > 0 && extras.replayed !== true) {
        const fromSubagents = allPending.filter(([, perm]) =>
          isSubagentPermissionRequest(perm),
        ).length
        logEvent('tengu_remote_turn_ended_with_open_permission_requests', {
          from_main_thread: allPending.length - fromSubagents,
          from_subagents: fromSubagents,
          kept_open: allPending.length - toDismiss.length,
        })
      }
      for (const requestId of this.pendingDialogRequests) {
        logForDebugging(
          `[RemoteSessionManager] Turn ended with user dialog request ${requestId} unresolved — dismissing`,
        )
        this.callbacks.onUserDialogCancelled?.(requestId)
        this.recordReinstatableDialogId(requestId)
      }
      this.pendingDialogRequests.clear()
      this.callbacks.onMessage(message)
      return
    }

    if (isSDKMessage(message)) {
      this.callbacks.onMessage(message)
    }
  }

  /** SEA retirePermissionRequest (2.1.292 #233) — delete pending & mark retired. */
  private retirePermissionRequest(requestId: string): void {
    this.pendingPermissionRequests.delete(requestId)
    this.retiredPermissionRequestIds.add(requestId)
  }

  private recordReinstatablePermissionRequest(
    requestId: string,
    perm: SDKControlPermissionRequest,
  ): void {
    this.reinstatablePermissionRequests.set(requestId, perm)
    if (
      this.reinstatablePermissionRequests.size > SEEN_CONTROL_RESPONSE_ID_CAP
    ) {
      const first = this.reinstatablePermissionRequests.keys().next().value
      if (first !== undefined) {
        this.reinstatablePermissionRequests.delete(first)
      }
    }
  }

  private recordReinstatableDialogId(requestId: string): void {
    this.reinstatableDialogIds.add(requestId)
    if (this.reinstatableDialogIds.size > SEEN_CONTROL_RESPONSE_ID_CAP) {
      const first = this.reinstatableDialogIds.values().next().value
      if (first !== undefined) this.reinstatableDialogIds.delete(first)
    }
  }

  /** densable recordSeenControlResponseId — FIFO-capped set (y5b=1000). */
  private recordSeenControlResponseId(requestId: string): void {
    this.seenControlResponseIds.add(requestId)
    if (this.seenControlResponseIds.size > SEEN_CONTROL_RESPONSE_ID_CAP) {
      const first = this.seenControlResponseIds.values().next().value
      if (first !== undefined) this.seenControlResponseIds.delete(first)
    }
  }

  /**
   * densable handleControlRequest — can_use_tool + request_user_dialog.
   * gold @206748501 `(e,{ageMs,attestationStatus,modeStamp,replayed},_)`.
   */
  private handleControlRequest(
    request: SDKControlRequest,
    extras: Record<string, unknown> = {},
  ): void {
    const requestId = request.request_id as string
    const inner = request.request

    if (inner.subtype === 'can_use_tool') {
      const perm = inner as SDKControlPermissionRequest
      if (this.pendingPermissionRequests.has(requestId)) {
        logForDebugging(
          `[RemoteSessionManager] Duplicate permission request ${requestId} — already pending, skipping`,
        )
        return
      }
      if (this.retiredPermissionRequestIds.has(requestId)) {
        const saved = this.reinstatablePermissionRequests.get(requestId)
        if (saved === undefined) {
          logForDebugging(
            `[RemoteSessionManager] Permission request ${requestId} arrived again after it was retired here — not arming it`,
          )
          return
        }
        this.reinstatablePermissionRequests.delete(requestId)
        if (jsonStringify(saved) !== jsonStringify(perm)) {
          logForDebugging(
            `[RemoteSessionManager] Redelivered can_use_tool ${requestId} differs from the request first shown under that id — not arming it`,
            { level: 'warn' },
          )
          return
        }
        this.retiredPermissionRequestIds.delete(requestId)
      }
      logForDebugging(
        `[RemoteSessionManager] Permission request for tool: ${perm.tool_name}`,
      )
      this.pendingPermissionRequests.set(requestId, perm)
      this.callbacks.onPermissionRequest(perm, requestId)
      return
    }

    if (inner.subtype === 'request_user_dialog') {
      if (this.pendingDialogRequests.has(requestId)) {
        logForDebugging(
          `[RemoteSessionManager] Duplicate user dialog request ${requestId} — already pending, skipping`,
        )
        return
      }
      if (!this.callbacks.onUserDialogRequest) {
        logForDebugging(
          `[RemoteSessionManager] Unsupported control request subtype: ${inner.subtype}`,
        )
        const response: SDKControlResponse = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: requestId,
            error: `Unsupported control request subtype: ${inner.subtype}`,
          },
        }
        this.sendControlResponseOverTransport(response, null)
        return
      }
      logForDebugging(
        `[RemoteSessionManager] User dialog request: ${inner.dialog_kind}`,
      )
      this.pendingDialogRequests.add(requestId)
      this.callbacks.onUserDialogRequest(inner, requestId)
      return
    }

    if (isRemoteToolsServedSubtype(inner.subtype)) {
      this.handleServedChannelRequest(request, extras)
      return
    }

    logForDebugging(
      `[RemoteSessionManager] Unsupported control request subtype: ${inner.subtype}`,
    )
    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: `Unsupported control request subtype: ${inner.subtype}`,
      },
    }
    this.sendControlResponseOverTransport(response, null)
  }

  /**
   * gold `if(un(g))` @206751433 — inbound `Cle` subtypes. No callback →
   * leave unanswered. Over-long id, already in hand, or already settled → skip.
   */
  private handleServedChannelRequest(
    request: SDKControlRequest,
    extras: Record<string, unknown> = {},
  ): void {
    const requestId = request.request_id
    const inner = request.request as {
      subtype: string
      [key: string]: unknown
    }
    const onServed = this.callbacks.onServedChannelRequest
    if (!onServed) {
      logForDebugging(
        `[RemoteSessionManager] ${inner.subtype} ${clipServedRequestId(requestId)} — not serving tools here, leaving it unanswered`,
      )
      return
    }
    if (requestId.length > REMOTE_SERVE_REQUEST_ID_CAP) {
      logForDebugging(
        `[RemoteSessionManager] ${inner.subtype} ${clipServedRequestId(requestId)} — an id longer than ${REMOTE_SERVE_REQUEST_ID_CAP} characters, leaving it unanswered`,
      )
      return
    }
    if (
      this.settledServedRequestIds.has(requestId) ||
      this.pendingServedRequests.has(requestId)
    ) {
      logForDebugging(
        `[RemoteSessionManager] ${inner.subtype} ${clipServedRequestId(requestId)} already answered or in hand — skipping`,
      )
      return
    }
    const abort = new AbortController()
    this.pendingServedRequests.set(requestId, {
      abort,
      subtype: inner.subtype,
    })
    onServed({
      requestId,
      subtype: inner.subtype,
      request: inner,
      signal: abort.signal,
      ...(typeof extras.ageMs === 'number' && { ageMs: extras.ageMs }),
      ...(extras.attestationStatus !== undefined && {
        attestationStatus: extras.attestationStatus,
      }),
      ...(extras.modeStamp !== undefined && { modeStamp: extras.modeStamp }),
    })
  }

  /**
   * gold `noteWorkerLive` @206768268
   */
  private noteWorkerLive(): void {
    if (this.workerSeenThisConnection) return
    this.workerSeenThisConnection = true
    this.callbacks.onWorkerLive?.()
  }

  /**
   * gold `reviveStreamForUserSend` @206760063
   */
  private reviveStreamForUserSend(): boolean {
    if (this.client?.reviveAfterExhaustion()) {
      this.callbacks.onReconnecting?.()
      return true
    }
    return false
  }

  // ── Official `undeliveredResponses` queue (chunk@318978761.js @70500-75000) ──

  private sendControlResponseOverTransport(
    response: SDKControlResponse,
    kind: RemoteResponseKind | null,
    originalRequest?: SDKControlPermissionRequest,
    onPosted?: (posted: ServedChannelPostOutcome, replyMs: number) => void,
  ): void {
    if (this.client) {
      const client = this.client
      const startMs = performance.now()
      const wrappedListener =
        onPosted === undefined
          ? undefined
          : (
              outcome: SessionsV2EventPostOutcome,
            ): SessionsV2EventPostOutcome => {
              try {
                const mapped: ServedChannelPostOutcome =
                  outcome.outcome === 'accepted'
                    ? {
                        outcome: 'accepted',
                        signMs: outcome.signMs,
                        postMs: outcome.postMs,
                      }
                    : { outcome: outcome.outcome }
                onPosted(mapped, Math.round(performance.now() - startMs))
              } catch (err) {
                logForDebugging(
                  `[RemoteSessionManager] An answer's post listener threw; the answer's fate is unchanged: ${errorMessage(err)}`,
                  { level: 'warn' },
                )
              }
              return outcome
            }

      if (kind === null || !this.shouldKeepUndeliveredResponses()) {
        const p = client.sendControlResponse(
          response,
          undefined,
          sendOptionsForKind(kind),
        )
        if (wrappedListener) {
          void p.then(wrappedListener)
        }
        return
      }

      const requestId = response.response.request_id
      const entry: UndeliveredResponseEntry = this.undeliveredResponses.get(
        requestId,
      ) ?? {
        response,
        kind,
        uuid: randomUUID(),
        failures: 0,
        inFlight: false,
        giveUpOnSettle: null,
        timer: null,
        told: false,
      }
      entry.response = response
      if (originalRequest !== undefined) {
        entry.request = originalRequest
      }
      this.undeliveredResponses.set(requestId, entry)
      this.postKeptResponse(client, entry, wrappedListener)
      return
    }

    if (this.websocket) {
      this.websocket.sendControlResponse(response)
      if (onPosted) {
        try {
          onPosted({ outcome: 'accepted' }, 0)
        } catch (err) {
          logForDebugging(
            `[RemoteSessionManager] An answer's post listener threw; ` +
              `the answer's fate is unchanged: ${errorMessage(err)}`,
            { level: 'warn' },
          )
        }
      }
    }
  }

  private postKeptResponse(
    client: SessionsV2Client,
    entry: UndeliveredResponseEntry,
    onOutcome?: (
      outcome: SessionsV2EventPostOutcome,
    ) => SessionsV2EventPostOutcome,
  ): void {
    entry.inFlight = true
    const reqPromise = client.sendControlResponse(
      entry.response,
      entry.uuid,
      sendOptionsForKind(entry.kind),
    )
    const chained =
      onOutcome === undefined ? reqPromise : reqPromise.then(onOutcome)
    chained.then(
      outcome => this.settleResponsePost(entry, outcome),
      err => {
        logForDebugging(
          `[RemoteSessionManager] Posting an answer threw: ${errorMessage(err)}`,
          { level: 'warn' },
        )
        this.settleResponsePost(entry, { outcome: 'failed', cause: 'network' })
      },
    )
  }

  private settleResponsePost(
    entry: UndeliveredResponseEntry,
    outcome: SessionsV2EventPostOutcome,
  ): void {
    entry.inFlight = false
    const requestId = entry.response.response.request_id
    if (this.undeliveredResponses.get(requestId) !== entry) {
      return
    }

    if (outcome.outcome === 'accepted') {
      if (entry.giveUpOnSettle === 'overtaken') {
        this.giveUpUndeliveredEntry(entry, 'overtaken')
        return
      }
      this.dropKeptResponse(entry)
      return
    }

    if (entry.giveUpOnSettle !== null) {
      this.giveUpUndeliveredEntry(entry, entry.giveUpOnSettle)
      return
    }

    if (
      outcome.outcome === 'session_inactive' ||
      (outcome.outcome === 'failed' &&
        outcome.cause === 'http' &&
        outcome.status === 404)
    ) {
      this.dropKeptResponse(entry)
      logForDebugging(
        `[RemoteSessionManager] Answer for ${clipServedRequestId(requestId)} has no session to go to; dropped`,
      )
      return
    }

    if (outcome.outcome === 'failed' && outcome.cause === 'closed') {
      if (!this.client?.isRevivable()) {
        this.giveUpUndeliveredEntry(entry, 'undelivered')
      }
      return
    }

    if (
      outcome.outcome === 'failed' &&
      outcome.cause === 'http' &&
      outcome.status !== undefined &&
      outcome.status < 500 &&
      outcome.status !== 408 &&
      outcome.status !== 429
    ) {
      logForDebugging(
        `[RemoteSessionManager] Answer for ${clipServedRequestId(requestId)} was refused by the service (http ${outcome.status}); not re-sending`,
        { level: 'warn' },
      )
      this.giveUpUndeliveredEntry(entry, 'undelivered')
      return
    }

    if (!this.client?.isConnected()) {
      logForDebugging(
        `[RemoteSessionManager] Answer for ${clipServedRequestId(requestId)} did not reach the session while the stream is down; it goes again at reconnect`,
      )
      return
    }

    entry.failures += 1
    if (entry.failures > MAX_UNDELIVERED_RETRY_ATTEMPTS) {
      logForDebugging(
        `[RemoteSessionManager] Answer for ${clipServedRequestId(requestId)} could not be delivered after ${entry.failures} attempts; giving up`,
        { level: 'warn' },
      )
      this.giveUpUndeliveredEntry(entry, 'undelivered')
      return
    }
    this.scheduleResponseResend(entry)
  }

  private dropKeptResponse(entry: UndeliveredResponseEntry): void {
    this.clearResendTimer(entry)
    this.undeliveredResponses.delete(entry.response.response.request_id)
  }

  private giveUpUndeliveredEntry(
    entry: UndeliveredResponseEntry,
    reason: RemoteResponseUndeliveredReason,
  ): void {
    const requestId = entry.response.response.request_id
    if (entry.inFlight) {
      if (entry.giveUpOnSettle !== 'overtaken') {
        entry.giveUpOnSettle = reason
      }
      return
    }
    this.dropKeptResponse(entry)
    if (
      reason === 'undelivered' &&
      (entry.kind === 'dialog' || entry.kind === 'permission')
    ) {
      this.seenControlResponseIds.delete(requestId)
      if (entry.kind === 'permission') {
        if (entry.request !== undefined) {
          this.recordReinstatablePermissionRequest(requestId, entry.request)
        }
      } else {
        this.recordReinstatableDialogId(requestId)
      }
    }
    if (entry.told) return
    entry.told = true
    this.callbacks.onResponseUndelivered?.(requestId, entry.kind, reason)
  }

  private scheduleResponseResend(entry: UndeliveredResponseEntry): void {
    this.clearResendTimer(entry)
    const idx = Math.min(entry.failures, MAX_UNDELIVERED_RETRY_ATTEMPTS) - 1
    const delayMs = UNDELIVERED_RETRY_DELAYS_MS[idx] ?? 45_000
    const requestId = entry.response.response.request_id
    entry.timer = setTimeout(() => {
      const current = this.undeliveredResponses.get(requestId)
      const client = this.client
      if (!current || !client) return
      current.timer = null
      if (!current.inFlight) {
        this.postKeptResponse(client, current)
      }
    }, delayMs)
    entry.timer.unref?.()
  }

  private clearResendTimer(entry: UndeliveredResponseEntry): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
  }

  private resendUndeliveredResponses(): void {
    const client = this.client
    if (!client) return
    for (const entry of this.undeliveredResponses.values()) {
      this.clearResendTimer(entry)
      if (!entry.inFlight) {
        this.postKeptResponse(client, entry)
      }
    }
  }

  private giveUpUndeliveredResponses(): void {
    for (const entry of [...this.undeliveredResponses.values()]) {
      this.giveUpUndeliveredEntry(entry, 'undelivered')
    }
  }

  private dropUndeliveredResponses(): void {
    for (const entry of [...this.undeliveredResponses.values()]) {
      if (entry.giveUpOnSettle === 'overtaken') {
        entry.inFlight = false
        this.giveUpUndeliveredEntry(entry, 'overtaken')
        continue
      }
      this.dropKeptResponse(entry)
    }
  }

  /** Number of control responses currently queued awaiting delivery / retry. */
  getUndeliveredResponseCount(): number {
    return this.undeliveredResponses.size
  }

  /**
   * gold `respondToServedChannelRequest` @206767294
   * gold `sendResponse` @206760163
   * gold `Be` @206773533 via leftoverServedSendOpts
   */
  respondToServedChannelRequest(
    requestId: string,
    answer: ServedChannelAnswer,
    onPosted?: (posted: ServedChannelPostOutcome, replyMs: number) => void,
  ): boolean {
    const pending = this.pendingServedRequests.get(requestId)
    if (!pending) {
      logForDebugging(
        `[RemoteSessionManager] served request ${clipServedRequestId(requestId)} is no longer pending — result not sent`,
      )
      return false
    }
    this.pendingServedRequests.delete(requestId)
    if (!this.client && !this.websocket) return false
    this.recordSeenControlResponseId(requestId)
    this.recordSettledServedRequestId(requestId)
    this.reviveStreamForUserSend()
    // gold `cn(n)` — probe success still wraps
    const wrapped = wrapServedResultForChannel(answer)
    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: wrapped as Record<string, unknown>,
      },
    }
    // gold `r.subtype==="remote_tools_probe"?null:"tool"` then Be(n)
    const responseKind =
      pending.subtype === 'remote_tools_probe' ? null : 'tool'
    void leftoverServedSendOpts(responseKind)
    this.sendControlResponseOverTransport(
      response,
      responseKind,
      undefined,
      onPosted,
    )
    return true
  }

  /** gold `releaseServedChannelRequest` */
  releaseServedChannelRequest(requestId: string): void {
    this.pendingServedRequests.delete(requestId)
  }

  /**
   * gold `retireServedRequest` — worker cancel or stream drop.
   */
  retireServedRequest(
    requestId: string,
    why: 'worker' | 'disconnected',
  ): boolean {
    const pending = this.pendingServedRequests.get(requestId)
    if (!pending) return false
    this.pendingServedRequests.delete(requestId)
    logForDebugging(
      `[RemoteSessionManager] served request ${clipServedRequestId(requestId)} ${
        why === 'worker' ? 'cancelled by the worker' : 'dropped with the stream'
      }`,
    )
    pending.abort.abort()
    this.callbacks.onServedChannelRequestCancelled?.(requestId, why)
    return true
  }

  /** gold `x(this.settledServedRequestIds, e)` — FIFO at 1000. */
  private recordSettledServedRequestId(requestId: string): void {
    this.settledServedRequestIds.add(requestId)
    if (this.settledServedRequestIds.size > SEEN_CONTROL_RESPONSE_ID_CAP) {
      const first = this.settledServedRequestIds.values().next().value
      if (first !== undefined) this.settledServedRequestIds.delete(first)
    }
  }

  /** gold `markServing` */
  markServing(serving: boolean): void {
    this.serving = serving
  }

  isServing(): boolean {
    return this.serving
  }

  /**
   * densable $Ur path — send user message; returns {ok, reason?} (not bare boolean).
   */
  async sendMessage(
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    logForDebugging(
      `[RemoteSessionManager] Sending message to session ${this.config.sessionId}`,
    )
    this.reviveStreamForUserSend()

    const result = await sendEventToRemoteSession(
      this.config.sessionId,
      content,
      opts,
    )

    if (!result.ok) {
      logForDebugging(
        `[RemoteSessionManager] Failed to send message to session ${this.config.sessionId}: ${result.reason}`,
        { level: 'error' },
      )
      logError(
        new Error(
          `[RemoteSessionManager] Failed to send message to session ${this.config.sessionId}: ${result.reason}`,
        ),
      )
    }

    return result
  }

  /**
   * Respond to a permission request from CCR
   */
  respondToPermissionRequest(
    requestId: string,
    result: RemotePermissionResponse,
  ): void {
    const pendingRequest = this.pendingPermissionRequests.get(requestId)
    if (!pendingRequest) {
      logError(
        new Error(
          `[RemoteSessionManager] No pending permission request with ID: ${requestId}`,
        ),
      )
      return
    }

    this.retirePermissionRequest(requestId)
    this.recordSeenControlResponseId(requestId)
    this.reviveStreamForUserSend()

    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: result.behavior,
          ...(result.behavior === 'allow'
            ? { updatedInput: result.updatedInput }
            : { message: result.message }),
        },
      },
    }

    logForDebugging(
      `[RemoteSessionManager] Sending permission response: ${result.behavior}`,
    )

    this.sendControlResponseOverTransport(
      response,
      'permission',
      pendingRequest,
    )
  }

  /**
   * densable respondToUserDialogRequest — answer request_user_dialog and mark seen.
   */
  respondToUserDialogRequest(
    requestId: string,
    result: RemoteUserDialogResponse,
  ): void {
    if (!this.pendingDialogRequests.delete(requestId)) {
      logError(
        new Error(
          `[RemoteSessionManager] No pending user dialog request with ID: ${requestId}`,
        ),
      )
      return
    }
    this.recordSeenControlResponseId(requestId)
    this.reviveStreamForUserSend()
    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: result.behavior,
          ...(result.result !== undefined ? { result: result.result } : {}),
        },
      },
    }
    logForDebugging(
      `[RemoteSessionManager] Sending user dialog response: ${result.behavior}`,
    )
    this.sendControlResponseOverTransport(response, 'dialog')
  }

  /**
   * Check if connected to the remote session
   */
  isConnected(): boolean {
    return this.client?.isConnected() ?? this.websocket?.isConnected() ?? false
  }

  /**
   * Send an interrupt signal to cancel the current request on the remote session
   */
  cancelSession(): void {
    logForDebugging('[RemoteSessionManager] Sending interrupt signal')
    this.reviveStreamForUserSend()
    if (this.client) {
      this.client.sendControlRequest({ subtype: 'interrupt' })
    } else {
      this.websocket?.sendControlRequest({ subtype: 'interrupt' })
    }
  }

  /**
   * Send a control request over the active transport.
   */
  sendControl(request: SDKControlRequestInner): void {
    this.reviveStreamForUserSend()
    if (this.client) {
      this.client.sendControlRequest(request)
    } else {
      this.websocket?.sendControlRequest(request)
    }
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.config.sessionId
  }

  /**
   * Disconnect from the remote session
   */
  disconnect(): void {
    logForDebugging('[RemoteSessionManager] Disconnecting')
    this.lifetime.abort()
    this.client?.close()
    this.client = null
    this.websocket?.close()
    this.websocket = null
    for (const entry of [...this.undeliveredResponses.values()]) {
      this.clearResendTimer(entry)
      if (entry.giveUpOnSettle !== null) {
        entry.inFlight = false
        this.giveUpUndeliveredEntry(entry, entry.giveUpOnSettle)
      }
    }
    this.undeliveredResponses.clear()
    this.pendingPermissionRequests.clear()
    this.pendingDialogRequests.clear()
    for (const requestId of [...this.pendingServedRequests.keys()]) {
      this.retireServedRequest(requestId, 'disconnected')
    }
    // gold `n==="disconnected"`: skip `endWorkerStart`; still reset + gone
    this.workerSeenThisConnection = false
    this.callbacks.onWorkerGone?.()
  }

  /**
   * Force reconnect the active SSE stream (or legacy WebSocket).
   */
  reconnect(): void {
    if (this.client) {
      logForDebugging('[RemoteSessionManager] Reconnecting SSE stream')
      this.client.reconnect()
      return
    }
    logForDebugging('[RemoteSessionManager] Reconnecting WebSocket')
    this.websocket?.reconnect()
  }

  /**
   * Official 2.1.328 `reconnectAfterSuspend` — redial SSE after OS suspend.
   */
  reconnectAfterSuspend(): void {
    this.client?.reconnectAfterSuspend()
  }
}

/**
 * Create a remote session config from OAuth tokens
 */
export function createRemoteSessionConfig(
  sessionId: string,
  getAccessToken: () => string,
  orgUuid: string,
  hasInitialPrompt = false,
  viewerOnly = false,
): RemoteSessionConfig {
  return {
    sessionId,
    getAccessToken,
    orgUuid,
    hasInitialPrompt,
    viewerOnly,
  }
}
