import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlPermissionRequest,
  SDKControlRequest,
  SDKControlRequestInner,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
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
  /**
   * When true, this client is a pure viewer. Ctrl+C/Escape do NOT send
   * interrupt to the remote agent; 60s reconnect timeout is disabled;
   * session title is never updated. Used by `claude assistant`.
   */
  viewerOnly?: boolean
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
      onMessage: message => this.handleMessage(message),
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
  private handleMessage(
    message:
      | SDKMessage
      | SDKControlRequest
      | SDKControlResponse
      | SDKControlCancelRequest,
  ): void {
    if (message.type === 'control_request') {
      this.handleControlRequest(message as SDKControlRequest)
      return
    }

    // densable: dialog cancel first, then permission; unknown → ignore
    if (message.type === 'control_cancel_request') {
      const { request_id } = message as SDKControlCancelRequest
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
   */
  private handleControlRequest(request: SDKControlRequest): void {
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
