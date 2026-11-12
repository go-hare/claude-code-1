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
import {
  type RemoteMessageContent,
  sendEventToRemoteSession,
} from '../utils/teleport/api.js'
import {
  SessionsWebSocket,
  type SessionsWebSocketCallbacks,
} from './SessionsWebSocket.js'

/**
 * densable `y5b` — max size of seenControlResponseIds ring before FIFO eviction.
 * Used so redelivered dialog request_ids that were already answered stay skipped.
 */
const SEEN_CONTROL_RESPONSE_ID_CAP = 1000

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
  onConnected?: () => void
  /** Called when connection is lost and cannot be restored */
  onDisconnected?: () => void
  /** Called on transient WS drop while reconnect backoff is in progress */
  onReconnecting?: () => void
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
}

/**
 * Manages a remote CCR session.
 *
 * Coordinates:
 * - WebSocket subscription for receiving messages from CCR
 * - HTTP POST for sending user messages to CCR
 * - Permission request/response flow
 * - densable 2.1.214 #7: dialog redelivery + answered-elsewhere dismiss
 */
export class RemoteSessionManager {
  private websocket: SessionsWebSocket | null = null
  private pendingPermissionRequests: Map<string, SDKControlPermissionRequest> =
    new Map()
  /** densable pendingDialogRequests — request_ids of open request_user_dialog */
  private pendingDialogRequests: Set<string> = new Set()
  /**
   * densable seenControlResponseIds — request_ids we already answered so
   * pending_user_dialog_requests redelivery does not re-open them.
   */
  private seenControlResponseIds: Set<string> = new Set()
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

  /**
   * Connect to the remote session via WebSocket
   */
  connect(): void {
    logForDebugging(
      `[RemoteSessionManager] Connecting to session ${this.config.sessionId}`,
    )

    const wsCallbacks: SessionsWebSocketCallbacks = {
      onMessage: (message, extras) => this.handleMessage(message, extras),
      onConnected: () => {
        logForDebugging('[RemoteSessionManager] Connected')
        this.callbacks.onConnected?.()
      },
      onClose: () => {
        logForDebugging('[RemoteSessionManager] Disconnected')
        this.callbacks.onDisconnected?.()
      },
      onReconnecting: () => {
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
      this.pendingPermissionRequests.delete(request_id)
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

      const pendingPerm = this.pendingPermissionRequests.get(requestId)
      if (pendingPerm) {
        this.pendingPermissionRequests.delete(requestId)
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

    // densable result: clear unresolved permission + dialog prompts, then forward
    if (isSDKMessage(message) && message.type === 'result') {
      for (const [requestId, pending] of this.pendingPermissionRequests) {
        logForDebugging(
          `[RemoteSessionManager] Turn ended with permission request ${requestId} unresolved — dismissing`,
        )
        this.callbacks.onPermissionCancelled?.(requestId, pending.tool_use_id)
      }
      this.pendingPermissionRequests.clear()
      for (const requestId of this.pendingDialogRequests) {
        logForDebugging(
          `[RemoteSessionManager] Turn ended with user dialog request ${requestId} unresolved — dismissing`,
        )
        this.callbacks.onUserDialogCancelled?.(requestId)
      }
      this.pendingDialogRequests.clear()
      this.callbacks.onMessage(message)
      return
    }

    if (isSDKMessage(message)) {
      this.callbacks.onMessage(message)
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
        // No host handler — densable still parks only when callback exists;
        // without it, report unsupported so the worker does not hang.
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
        this.websocket?.sendControlResponse(response)
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
    this.websocket?.sendControlResponse(response)
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
   * leftover SessionsWebSocket has no `reviveAfterExhaustion` — no-op.
   */
  private reviveStreamForUserSend(): void {
    // gold: this.client?.reviveAfterExhaustion() then onReconnecting
  }

  /**
   * gold `respondToServedChannelRequest` @206767294
   * gold `sendResponse` @206760163 leftover: WS send is void (not a Promise);
   * no undeliveredResponses / keepUndeliveredResponses fleet.
   * gold `Be` @206773533 via leftoverServedSendOpts — leftover WS cannot take
   * timeout, still compute probe vs tool opts.
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
    if (!this.websocket) return false
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
    // leftover sendControlResponse is void — still compute Be opts
    void leftoverServedSendOpts(
      pending.subtype === 'remote_tools_probe' ? null : 'tool',
    )
    this.websocket.sendControlResponse(response)
    try {
      onPosted?.({ outcome: 'accepted' }, 0)
    } catch (err) {
      logForDebugging(
        `[RemoteSessionManager] An answer's post listener threw; ` +
          `the answer's fate is unchanged: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    }
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

    this.pendingPermissionRequests.delete(requestId)

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

    this.websocket?.sendControlResponse(response)
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
    this.websocket?.sendControlResponse(response)
  }

  /**
   * Check if connected to the remote session
   */
  isConnected(): boolean {
    return this.websocket?.isConnected() ?? false
  }

  /**
   * Send an interrupt signal to cancel the current request on the remote session
   */
  cancelSession(): void {
    logForDebugging('[RemoteSessionManager] Sending interrupt signal')
    this.websocket?.sendControlRequest({ subtype: 'interrupt' })
  }

  /**
   * leftover `gPe.postControlRequest` host — wrap existing SessionsWebSocket
   * `sendControlRequest`. Interrupt stays `cancelSession`.
   */
  sendControl(request: SDKControlRequestInner): void {
    this.websocket?.sendControlRequest(request)
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
    this.websocket?.close()
    this.websocket = null
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
   * Force reconnect the WebSocket.
   * Useful when the subscription becomes stale after container shutdown.
   */
  reconnect(): void {
    logForDebugging('[RemoteSessionManager] Reconnecting WebSocket')
    this.websocket?.reconnect()
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
