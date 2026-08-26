import { feature } from 'bun:bundle'
import type { ElicitResult, JSONRPCMessage } from 'src/services/mcp/types.js'
import { randomUUID } from 'crypto'
import type { AssistantMessage } from 'src//types/message.js'
import type {
  HookInput,
  HookJSONOutput,
  PermissionUpdate as SDKPermissionUpdate,
  SDKMessage,
  SDKUserMessage,
} from 'src/entrypoints/agentSdkTypes.js'
import {
  SDKControlElicitationResponseSchema,
  SDKControlHostAuthTokenRefreshResponseSchema,
  SDKControlOauthTokenRefreshResponseSchema,
  SDKControlRequestUserDialogResponseSchema,
} from 'src/entrypoints/sdk/controlSchemas.js'
import { DEFAULT_SDK_AUTH_REFRESH_CONTROL_TIMEOUT_MS } from 'src/utils/residualFinalEnvGates.js'
import {
  buildUserDialogRequiresActionDetails,
  resolveUserDialogParkTimeoutMs,
  type UserDialogResponse,
} from 'src/utils/userDialog.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
  StdinMessage,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import type { PermissionUpdate as InternalPermissionUpdate } from 'src/types/permissions.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import { type HookCallback, hookJSONOutputSchema } from 'src/types/hooks.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import {
  AbortError,
  ControlStreamClosedError,
  isAbortError,
} from 'src/utils/errors.js'
import {
  type Output as PermissionToolOutput,
  permissionPromptToolResultToPermissionDecision,
  outputSchema as permissionToolOutputSchema,
} from 'src/utils/permissions/PermissionPromptToolResultSchema.js'
import {
  canUseToolAbortedDenyReason,
  canUseToolInvalidResultDenyReason,
  canUseToolRequestFailedDenyReason,
  PERMISSION_RESULT_SHAPE_HINT,
  permissionStreamClosedDenyReason,
  TOOL_PERMISSION_STREAM_CLOSED_REASON,
} from 'src/utils/permissions/permissionDecisionReasons.js'
import type {
  PermissionDecision,
  PermissionDecisionReason,
} from 'src/utils/permissions/PermissionResult.js'
import {
  hasPermissionsToUseTool,
  stripWholeToolGrantsForAsk,
} from 'src/utils/permissions/permissions.js'
import { writeToStdout } from 'src/utils/process.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { z } from 'zod/v4'
import { notifyCommandLifecycle } from '../utils/commandLifecycle.js'
import { normalizeControlMessageKeys } from '../utils/controlMessageCompat.js'
import { executePermissionRequestHooks } from '../utils/hooks.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
} from '../utils/permissions/PermissionUpdate.js'
import {
  notifyNestedPromptBlocking,
  notifyNestedPromptUnblocking,
  notifySessionStateChanged,
  republishPendingAction,
  reteeWaitingOnUser,
  type RequiresActionDetails,
  type RestoredWorkerState,
} from '../utils/sessionState.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { jsonParse } from '../utils/slowOperations.js'
import { Stream } from '../utils/stream.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { ndjsonSafeStringify } from './ndjsonSafeStringify.js'

/** densable TM0 — keys allowed on a plain nested-user unwrap envelope. */
const PLAIN_NESTED_USER_KEYS = new Set([
  'type',
  'message',
  'uuid',
  'session_id',
  'parent_tool_use_id',
  'timestamp',
])

type NestedUserRepairOutcome =
  | 'dropped'
  | 'unwrap_refused'
  | 'repair_disabled'
  | 'repaired'

type NestedUserUnwrap = {
  inner: { role: 'user'; content: string | unknown[] }
  plain: boolean
}

/** densable wM0 — envelope entry is a known SDK user-message field (or default flag). */
function isPlainNestedUserEntry([key, value]: [string, unknown]): boolean {
  return (
    PLAIN_NESTED_USER_KEYS.has(key) ||
    (key === 'isSynthetic' && value === false) ||
    (key === 'shouldQuery' && value === true)
  )
}

/**
 * densable EM0 — one-level unwrap of `{message:{role:"user",content}}` nested
 * inside the user-message payload. Returns undefined when the shape is not
 * a nested user envelope.
 */
export function tryUnwrapNestedUserMessage(
  payload: unknown,
): NestedUserUnwrap | undefined {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('message' in payload)
  ) {
    return undefined
  }
  const inner = (payload as { message: unknown }).message
  if (
    typeof inner !== 'object' ||
    inner === null ||
    !('role' in inner) ||
    (inner as { role: unknown }).role !== 'user' ||
    !('content' in inner)
  ) {
    return undefined
  }
  const content = (inner as { content: unknown }).content
  if (typeof content !== 'string' && !Array.isArray(content)) {
    return undefined
  }
  const rec = payload as Record<string, unknown>
  const plain =
    (!('type' in rec) || rec.type === 'user') &&
    Object.entries(rec).every(isPlainNestedUserEntry)
  return {
    inner: inner as { role: 'user'; content: string | unknown[] },
    plain,
  }
}

/**
 * Synthetic tool name used when forwarding sandbox network permission
 * requests via the can_use_tool control_request protocol. SDK hosts
 * see this as a normal tool permission prompt.
 */
export const SANDBOX_NETWORK_ACCESS_TOOL_NAME = 'SandboxNetworkAccess'

function serializeDecisionReason(
  reason: PermissionDecisionReason | undefined,
): string | undefined {
  if (!reason) {
    return undefined
  }

  if (
    (feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) &&
    reason.type === 'classifier'
  ) {
    return reason.reason
  }
  switch (reason.type) {
    case 'rule':
    case 'mode':
    case 'subcommandResults':
    case 'permissionPromptTool':
      return undefined
    case 'hook':
    case 'asyncAgent':
    case 'sandboxOverride':
    case 'workingDir':
    case 'safetyCheck':
    case 'other':
      return reason.reason
  }
}

function buildRequiresActionDetails(
  tool: Tool,
  input: Record<string, unknown>,
  toolUseID: string,
  requestId: string,
): RequiresActionDetails {
  // Per-tool summary methods may throw on malformed input; permission
  // handling must not break because of a bad description.
  let description: string
  try {
    description =
      tool.getActivityDescription?.(input) ??
      tool.getToolUseSummary?.(input) ??
      tool.userFacingName(input)
  } catch {
    description = tool.name
  }
  return {
    tool_name: tool.name,
    action_description: description,
    tool_use_id: toolUseID,
    request_id: requestId,
    input,
  }
}

type PendingRequest<T> = {
  resolve: (result: T) => void
  reject: (error: unknown) => void
  schema?: z.Schema
  request: SDKControlRequest
}

/**
 * Provides a structured way to read and write SDK messages from stdio,
 * capturing the SDK protocol.
 */
// Maximum number of resolved tool_use IDs to track. Once exceeded, the oldest
// entry is evicted. This bounds memory in very long sessions while keeping
// enough history to catch duplicate control_response deliveries.
const MAX_RESOLVED_TOOL_USE_IDS = 1000

export class StructuredIO {
  readonly structuredInput: AsyncGenerator<StdinMessage | SDKMessage>
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>()

  // CCR worker GET {external, internal}; null when the transport
  // doesn't restore. Assigned by RemoteIO.
  restoredWorkerState: Promise<RestoredWorkerState> = Promise.resolve(null)

  private inputClosed = false
  private unexpectedResponseCallback?: (
    response: SDKControlResponse,
  ) => Promise<void>

  // Tracks tool_use IDs that have been resolved through the normal permission
  // flow (or aborted by a hook). When a duplicate control_response arrives
  // after the original was already handled, this Set prevents the orphan
  // handler from re-processing it — which would push duplicate assistant
  // messages into mutableMessages and cause a 400 "tool_use ids must be unique"
  // error from the API.
  private readonly resolvedToolUseIds = new Set<string>()
  private prependedLines: string[] = []
  private onControlRequestSent?: (request: SDKControlRequest) => void
  private onControlRequestResolved?: (requestId: string) => void

  /**
   * Official onUserDialogParked — fired when a request_user_dialog parks
   * requires_action details for host UIs.
   */
  onUserDialogParked?: (details: RequiresActionDetails) => void

  /**
   * Official publishedPendingActionDetails — request_id → details for
   * concurrent parks; republishSurvivingPendingAction re-emits survivors.
   */
  private readonly publishedPendingActionDetails = new Map<
    string,
    RequiresActionDetails
  >()

  /**
   * Official timedOutUserDialogs — request_ids cancelled by W1n timer so
   * finally does not reteeWaitingOnUser for the timed-out park.
   */
  private readonly timedOutUserDialogs = new Map<
    string,
    { dialogKind: string; timedOutAt: number }
  >()

  // sendRequest() and print.ts both enqueue here; the drain loop is the
  // only writer. Prevents control_request from overtaking queued stream_events.
  readonly outbound = new Stream<StdoutMessage>()

  constructor(
    private readonly input: AsyncIterable<string>,
    private readonly replayUserMessages?: boolean,
  ) {
    this.input = input
    this.structuredInput = this.read()
  }

  /**
   * densable YPo.isRemoteTransport — false on local StructuredIO; RemoteIO
   * overrides to true. Remote transports drop/repair malformed frames instead
   * of process.exit.
   */
  isRemoteTransport(): boolean {
    return false
  }

  /**
   * densable retireDroppedFrame — close command_lifecycle for a dropped inbound
   * uuid so the host does not wait on a frame that will never yield.
   */
  private retireDroppedFrame(uuid: unknown): void {
    if (typeof uuid === 'string' && uuid.length > 0) {
      notifyCommandLifecycle(uuid, 'completed')
    }
  }

  /**
   * Records a tool_use ID as resolved so that late/duplicate control_response
   * messages for the same tool are ignored by the orphan handler.
   */
  private trackResolvedToolUseId(request: SDKControlRequest): void {
    const inner = request.request as { subtype?: string; tool_use_id?: string }
    if (inner.subtype === 'can_use_tool') {
      this.resolvedToolUseIds.add(inner.tool_use_id as string)
      if (this.resolvedToolUseIds.size > MAX_RESOLVED_TOOL_USE_IDS) {
        // Evict the oldest entry (Sets iterate in insertion order)
        const first = this.resolvedToolUseIds.values().next().value
        if (first !== undefined) {
          this.resolvedToolUseIds.delete(first)
        }
      }
    }
  }

  /** Flush pending internal events. No-op for non-remote IO. Overridden by RemoteIO. */
  flushInternalEvents(): Promise<void> {
    return Promise.resolve()
  }

  /** Internal-event queue depth. Overridden by RemoteIO; zero otherwise. */
  get internalEventsPending(): number {
    return 0
  }

  /**
   * Queue a user turn to be yielded before the next message from this.input.
   * Works before iteration starts and mid-stream — read() re-checks
   * prependedLines between each yielded message.
   */
  prependUserMessage(content: string): void {
    this.prependedLines.push(
      jsonStringify({
        type: 'user',
        content,
        uuid: '',
        session_id: '',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      } satisfies SDKUserMessage) + '\n',
    )
  }

  private async *read() {
    let content = ''

    // Called once before for-await (an empty this.input otherwise skips the
    // loop body entirely), then again per block. prependedLines re-check is
    // inside the while so a prepend pushed between two messages in the SAME
    // block still lands first.
    const splitAndProcess = async function* (this: StructuredIO) {
      for (;;) {
        if (this.prependedLines.length > 0) {
          content = this.prependedLines.join('') + content
          this.prependedLines = []
        }
        const newline = content.indexOf('\n')
        if (newline === -1) break
        const line = content.slice(0, newline)
        content = content.slice(newline + 1)
        const message = await this.processLine(line)
        if (message) {
          logForDiagnosticsNoPII('info', 'cli_stdin_message_parsed', {
            type: message.type,
          })
          yield message
        }
      }
    }.bind(this)

    yield* splitAndProcess()

    for await (const block of this.input) {
      content += block
      yield* splitAndProcess()
    }
    if (content) {
      const message = await this.processLine(content)
      if (message) {
        yield message
      }
    }
    this.inputClosed = true
    for (const request of this.pendingRequests.values()) {
      // densable jS: stream closed ≠ user interrupt — telemetry maps to config
      // (permissionStreamClosed), not user_reject / user_abort.
      request.reject(
        new ControlStreamClosedError(TOOL_PERMISSION_STREAM_CLOSED_REASON),
      )
    }
  }

  getPendingPermissionRequests() {
    return Array.from(this.pendingRequests.values())
      .map(entry => entry.request)
      .filter(
        pr => (pr.request as { subtype?: string }).subtype === 'can_use_tool',
      )
  }

  /**
   * Official getPendingUserDialogRequests — pending request_user_dialog parks.
   */
  getPendingUserDialogRequests() {
    return Array.from(this.pendingRequests.values())
      .map(entry => entry.request)
      .filter(
        pr =>
          (pr.request as { subtype?: string }).subtype ===
          'request_user_dialog',
      )
  }

  /**
   * Official republishSurvivingPendingAction — after one park resolves, re-emit
   * the remaining pending_action so host UIs stay blocked on the survivor.
   */
  republishSurvivingPendingAction(): void {
    let survivor: RequiresActionDetails | undefined
    for (const [requestId, details] of this.publishedPendingActionDetails) {
      if (this.pendingRequests.has(requestId)) {
        survivor = details
        break
      }
    }
    if (!survivor) return
    republishPendingAction(survivor)
  }

  /**
   * Official cancelPendingUserDialogs — cancel all parks of a given dialog_kind
   * with reason telemetry (queued_at_park, etc.).
   */
  cancelPendingUserDialogs(dialogKind: string, _reason: string): number {
    let cancelled = 0
    for (const { request } of Array.from(this.pendingRequests.values())) {
      const inner = request.request as {
        subtype?: string
        dialog_kind?: string
      }
      if (
        inner.subtype !== 'request_user_dialog' ||
        inner.dialog_kind !== dialogKind
      ) {
        continue
      }
      this.injectControlResponse({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
          response: { behavior: 'cancelled' },
        },
      })
      cancelled += 1
    }
    return cancelled
  }

  setUnexpectedResponseCallback(
    callback: (response: SDKControlResponse) => Promise<void>,
  ): void {
    this.unexpectedResponseCallback = callback
  }

  /**
   * Official ignoresErrorShapedDialogResponse — error control_response for a
   * parked request_user_dialog is not a human choice; keep the dialog parked.
   */
  ignoresErrorShapedDialogResponse(
    pending: PendingRequest<unknown>,
    responseInner: {
      subtype?: string
      request_id?: string
      error?: string
    },
  ): boolean {
    if (responseInner.subtype !== 'error') return false
    const subtype = (pending.request.request as { subtype?: string }).subtype
    if (subtype !== 'request_user_dialog') return false
    logForDebugging(
      `Ignoring error-shaped control_response for parked request_user_dialog request_id=${responseInner.request_id} — not a human choice; dialog stays parked (error: ${responseInner.error ?? ''})`,
    )
    return true
  }

  /**
   * Inject a control_response message to resolve a pending permission request.
   * Used by the bridge to feed permission responses from claude.ai into the
   * SDK permission flow.
   *
   * Also sends a control_cancel_request to the SDK consumer so its canUseTool
   * callback is aborted via the signal — otherwise the callback hangs.
   */
  injectControlResponse(response: SDKControlResponse): void {
    const responseInner = response.response as
      | {
          request_id?: string
          subtype?: string
          error?: string
          response?: unknown
        }
      | undefined
    const requestId = responseInner?.request_id
    if (!requestId) return
    const request = this.pendingRequests.get(requestId as string)
    if (!request) return
    if (this.ignoresErrorShapedDialogResponse(request, responseInner)) {
      return
    }
    this.trackResolvedToolUseId(request.request)
    this.pendingRequests.delete(requestId as string)
    // Cancel the SDK consumer's canUseTool callback — the bridge won.
    void this.write({
      type: 'control_cancel_request',
      request_id: requestId,
    })
    if (responseInner.subtype === 'error') {
      request.reject(new Error(responseInner.error as string))
    } else {
      const result = responseInner.response
      if (request.schema) {
        try {
          request.resolve(request.schema.parse(result))
        } catch (error) {
          request.reject(error)
        }
      } else {
        request.resolve({})
      }
    }
  }

  /**
   * Register a callback invoked whenever a can_use_tool control_request
   * is written to stdout. Used by the bridge to forward permission
   * requests to claude.ai.
   */
  setOnControlRequestSent(
    callback: ((request: SDKControlRequest) => void) | undefined,
  ): void {
    this.onControlRequestSent = callback
  }

  /**
   * Register a callback invoked when a can_use_tool control_response arrives
   * from the SDK consumer (via stdin). Used by the bridge to cancel the
   * stale permission prompt on claude.ai when the SDK consumer wins the race.
   */
  setOnControlRequestResolved(
    callback: ((requestId: string) => void) | undefined,
  ): void {
    this.onControlRequestResolved = callback
  }

  private async processLine(
    line: string,
  ): Promise<StdinMessage | SDKMessage | undefined> {
    // Skip empty lines (e.g. from double newlines in piped stdin)
    if (!line) {
      return undefined
    }
    try {
      const message = normalizeControlMessageKeys(jsonParse(line)) as
        | StdinMessage
        | SDKMessage
      if (message.type === 'keep_alive') {
        // Silently ignore keep-alive messages
        return undefined
      }
      if (message.type === 'update_environment_variables') {
        // Apply environment variable updates directly to process.env.
        // Used by bridge session runner for auth token refresh
        // (CLAUDE_CODE_SESSION_ACCESS_TOKEN) which must be readable
        // by the REPL process itself, not just child Bash commands.
        const variables = message.variables ?? {}
        const keys = Object.keys(variables)
        for (const [key, value] of Object.entries(variables)) {
          process.env[key] = value
        }
        logForDebugging(
          `[structuredIO] applied update_environment_variables: ${keys.join(', ')}`,
        )
        return undefined
      }
      if (message.type === 'control_response') {
        // Close lifecycle for every control_response, including duplicates
        // and orphans — orphans don't yield to print.ts's main loop, so this
        // is the only path that sees them. uuid is server-injected into the
        // payload.
        const uuid =
          'uuid' in message && typeof message.uuid === 'string'
            ? message.uuid
            : undefined
        if (uuid) {
          notifyCommandLifecycle(uuid, 'completed')
        }
        const resp = message.response as {
          request_id: string
          subtype: string
          response?: Record<string, unknown>
          error?: string
        }
        const request = this.pendingRequests.get(resp.request_id)
        if (!request) {
          // Check if this tool_use was already resolved through the normal
          // permission flow. Duplicate control_response deliveries (e.g. from
          // WebSocket reconnects) arrive after the original was handled, and
          // re-processing them would push duplicate assistant messages into
          // the conversation, causing API 400 errors.
          const responsePayload =
            resp.subtype === 'success' ? resp.response : undefined
          const toolUseID = responsePayload?.toolUseID
          if (
            typeof toolUseID === 'string' &&
            this.resolvedToolUseIds.has(toolUseID)
          ) {
            logForDebugging(
              `Ignoring duplicate control_response for already-resolved toolUseID=${toolUseID} request_id=${resp.request_id}`,
            )
            return undefined
          }
          if (this.unexpectedResponseCallback) {
            await this.unexpectedResponseCallback(
              message as SDKControlResponse & { uuid?: string },
            )
          }
          return undefined // Ignore responses for requests we don't know about
        }
        // Official ignoresErrorShapedDialogResponse — keep request_user_dialog
        // parked on error-shaped responses (not a human choice). Must run
        // before delete so the dialog stays in pendingRequests.
        if (
          resp.subtype === 'error' &&
          this.ignoresErrorShapedDialogResponse(request, {
            subtype: 'error',
            request_id: resp.request_id,
            error: resp.error,
          })
        ) {
          return undefined
        }
        this.trackResolvedToolUseId(request.request)
        this.pendingRequests.delete(resp.request_id)
        // Notify the bridge when the SDK consumer resolves a can_use_tool
        // request, so it can cancel the stale permission prompt on claude.ai.
        if (
          (request.request.request as { subtype?: string }).subtype ===
            'can_use_tool' &&
          this.onControlRequestResolved
        ) {
          this.onControlRequestResolved(resp.request_id)
        }

        if (resp.subtype === 'error') {
          request.reject(new Error(resp.error ?? 'Unknown error'))
          return undefined
        }
        const result = resp.response
        if (request.schema) {
          try {
            request.resolve(request.schema.parse(result))
          } catch (error) {
            request.reject(error)
          }
        } else {
          request.resolve({})
        }
        // Propagate control responses when replay is enabled
        if (this.replayUserMessages) {
          return message
        }
        return undefined
      }
      if (
        message.type !== 'user' &&
        message.type !== 'control_request' &&
        message.type !== 'assistant' &&
        message.type !== 'system'
      ) {
        logForDebugging(`Ignoring unknown message type: ${message.type}`, {
          level: 'warn',
        })
        this.retireDroppedFrame(
          typeof message === 'object' && message !== null && 'uuid' in message
            ? (message as { uuid?: unknown }).uuid
            : undefined,
        )
        return undefined
      }
      if (message.type === 'control_request') {
        if (this.isRemoteTransport()) {
          const request = (message as { request?: unknown }).request
          const missing =
            typeof request !== 'object' ||
            request === null ||
            Array.isArray(request)
          if (
            missing ||
            !('subtype' in request) ||
            typeof (request as { subtype?: unknown }).subtype !== 'string'
          ) {
            logEvent('tengu_sdk_malformed_input', {
              message_type:
                'control_request' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              reason: (missing
                ? 'missing_request'
                : 'subtype_not_string') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              transport:
                'remote' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              outcome:
                'dropped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            logForDebugging(
              'Dropping control_request: missing request object or non-string subtype',
              { level: 'warn' },
            )
            this.retireDroppedFrame(
              'uuid' in message
                ? (message as { uuid?: unknown }).uuid
                : undefined,
            )
            return undefined
          }
        } else if (!message.request) {
          exitWithMessage(`Error: Missing request on control_request`)
        }
        return message
      }
      if (message.type === 'assistant' || message.type === 'system') {
        return message
      }
      if (
        (message as { message?: { role?: string } }).message?.role !== 'user'
      ) {
        if (!this.isRemoteTransport()) {
          exitWithMessage(
            `Error: Expected message role 'user', got '${(message as { message?: { role?: string } }).message?.role}'`,
          )
        }
        const unwrap = tryUnwrapNestedUserMessage(
          (message as { message?: unknown }).message,
        )
        const outcome: NestedUserRepairOutcome =
          unwrap === undefined
            ? 'dropped'
            : !unwrap.plain
              ? 'unwrap_refused'
              : isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_NESTED_USER_REPAIR)
                ? 'repair_disabled'
                : 'repaired'
        logEvent('tengu_sdk_malformed_input', {
          message_type:
            'user' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          reason:
            'invalid_message_role' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          transport:
            'remote' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          outcome:
            outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        logForDiagnosticsNoPII('warn', 'cli_malformed_user_message', {
          outcome,
        })
        if (unwrap === undefined || outcome !== 'repaired') {
          const inner = (message as { message?: unknown }).message
          const role =
            inner && typeof inner === 'object' && 'role' in inner
              ? (inner as { role?: unknown }).role
              : undefined
          const got =
            inner === undefined || inner === null
              ? 'no message'
              : typeof inner !== 'object'
                ? 'a non-object message'
                : role === undefined
                  ? 'no role'
                  : `a role of JSON type ${role === null ? 'null' : Array.isArray(role) ? 'array' : typeof role}`
          logForDebugging(
            `Dropping malformed user message (${outcome}): expected message role 'user', got ${got}`,
            { level: 'warn' },
          )
          this.retireDroppedFrame(
            'uuid' in message
              ? (message as { uuid?: unknown }).uuid
              : undefined,
          )
          return undefined
        }
        ;(message as { message: unknown }).message = unwrap.inner
        logForDebugging('Repaired a nested user message (one level)')
      }
      return message
    } catch (error) {
      console.error(`Error parsing streaming input line: ${line}: ${error}`)
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(1)
    }
  }

  async write(message: StdoutMessage): Promise<void> {
    writeToStdout(ndjsonSafeStringify(message) + '\n')
  }

  private async sendRequest<Response>(
    request: SDKControlRequest['request'],
    schema: z.Schema,
    signal?: AbortSignal,
    requestId: string = randomUUID(),
  ): Promise<Response> {
    const message: SDKControlRequest = {
      type: 'control_request',
      request_id: requestId,
      request,
    }
    if (this.inputClosed) {
      throw new Error('Stream closed')
    }
    if (signal?.aborted) {
      throw new Error('Request aborted')
    }
    this.outbound.enqueue(message)
    if (
      (request as { subtype?: string }).subtype === 'can_use_tool' &&
      this.onControlRequestSent
    ) {
      this.onControlRequestSent(message)
    }
    const aborted = () => {
      this.outbound.enqueue({
        type: 'control_cancel_request',
        request_id: requestId,
      })
      // Immediately reject the outstanding promise, without
      // waiting for the host to acknowledge the cancellation.
      const request = this.pendingRequests.get(requestId)
      if (request) {
        // Track the tool_use ID as resolved before rejecting, so that a
        // late response from the host is ignored by the orphan handler.
        this.trackResolvedToolUseId(request.request)
        request.reject(new AbortError())
      }
    }
    if (signal) {
      signal.addEventListener('abort', aborted, {
        once: true,
      })
    }
    try {
      return await new Promise<Response>((resolve, reject) => {
        this.pendingRequests.set(requestId, {
          request: {
            type: 'control_request',
            request_id: requestId,
            request,
          },
          resolve: result => {
            resolve(result as Response)
          },
          reject,
          schema,
        })
      })
    } finally {
      if (signal) {
        signal.removeEventListener('abort', aborted)
      }
      this.pendingRequests.delete(requestId)
    }
  }

  createCanUseTool(
    onPermissionPrompt?: (details: RequiresActionDetails) => void,
  ): CanUseToolFn {
    return async (
      tool: Tool,
      input: { [key: string]: unknown },
      toolUseContext: ToolUseContext,
      assistantMessage: AssistantMessage,
      toolUseID: string,
      forceDecision?: PermissionDecision,
    ): Promise<PermissionDecision> => {
      const mainPermissionResult =
        forceDecision ??
        (await hasPermissionsToUseTool(
          tool,
          input,
          toolUseContext,
          assistantMessage,
          toolUseID,
        ))
      // If the tool is allowed or denied, return the result
      if (
        mainPermissionResult.behavior === 'allow' ||
        mainPermissionResult.behavior === 'deny'
      ) {
        return mainPermissionResult
      }

      // Run PermissionRequest hooks in parallel with the SDK permission
      // prompt.  In the terminal CLI, hooks race against the interactive
      // prompt so that e.g. a hook with --delay 20 doesn't block the UI.
      // We need the same behavior here: the SDK host (VS Code, etc.) shows
      // its permission dialog immediately while hooks run in the background.
      // Whichever resolves first wins; the loser is cancelled/ignored.

      // AbortController used to cancel the SDK request if a hook decides first
      const hookAbortController = new AbortController()
      const parentSignal = toolUseContext.abortController.signal
      // Forward parent abort to our local controller
      const onParentAbort = () => hookAbortController.abort()
      parentSignal.addEventListener('abort', onParentAbort, { once: true })

      try {
        // Start the hook evaluation (runs in background)
        const hookPromise = executePermissionRequestHooksForSDK(
          tool.name,
          toolUseID,
          input,
          toolUseContext,
          mainPermissionResult.suggestions,
          tool,
          mainPermissionResult.suppressAlwaysAllowRule === true,
        ).then(decision => ({ source: 'hook' as const, decision }))

        // Start the SDK permission prompt immediately (don't wait for hooks)
        const requestId = randomUUID()
        const details = buildRequiresActionDetails(
          tool,
          input,
          toolUseID,
          requestId,
        )
        this.publishedPendingActionDetails.set(requestId, details)
        // Official Imn: nested agent permission parks block waitingOnUser.
        const nestedAgentId = toolUseContext.agentId
        let nestedBlocked = false
        if (nestedAgentId !== undefined) {
          nestedBlocked = true
          notifyNestedPromptBlocking(nestedAgentId)
        }
        onPermissionPrompt?.(details)
        try {
          const sdkPromise = this.sendRequest<PermissionToolOutput>(
            {
              subtype: 'can_use_tool',
              tool_name: tool.name,
              input,
              permission_suggestions: mainPermissionResult.suggestions,
              blocked_path: mainPermissionResult.blockedPath,
              decision_reason: serializeDecisionReason(
                mainPermissionResult.decisionReason,
              ),
              tool_use_id: toolUseID,
              agent_id: toolUseContext.agentId,
              // densable 2.1.235 #12 egress — omit when unset (|| void 0).
              suppress_always_allow_rule:
                mainPermissionResult.suppressAlwaysAllowRule || undefined,
            },
            permissionToolOutputSchema(),
            hookAbortController.signal,
            requestId,
          ).then(result => ({ source: 'sdk' as const, result }))

          // Race: hook completion vs SDK prompt response.
          // The hook promise always resolves (never rejects), returning
          // undefined if no hook made a decision.
          const winner = await Promise.race([hookPromise, sdkPromise])

          if (winner.source === 'hook') {
            if (winner.decision) {
              // Hook decided — abort the pending SDK request.
              // Suppress the expected AbortError rejection from sdkPromise.
              sdkPromise.catch(() => {})
              hookAbortController.abort()
              return winner.decision
            }
            // Hook passed through (no decision) — wait for the SDK prompt
            const sdkResult = await sdkPromise
            return permissionPromptToolResultToPermissionDecision(
              sdkResult.result,
              tool,
              input,
              toolUseContext,
              {
                askSuppressesAlwaysAllowRule:
                  mainPermissionResult.suppressAlwaysAllowRule === true,
              },
            )
          }

          // SDK prompt responded first — use its result (hook still running
          // in background but its result will be ignored)
          return permissionPromptToolResultToPermissionDecision(
            winner.result,
            tool,
            input,
            toolUseContext,
            {
              askSuppressesAlwaysAllowRule:
                mainPermissionResult.suppressAlwaysAllowRule === true,
            },
          )
        } finally {
          if (nestedBlocked && nestedAgentId !== undefined) {
            notifyNestedPromptUnblocking(nestedAgentId)
          }
          this.publishedPendingActionDetails.delete(requestId)
        }
      } catch (error) {
        // densable createCanUseTool catch — do NOT wrap as permissionPromptTool
        // (that would OTel as user_reject). Classify:
        //   ZodError → canUseToolInvalidResult (config)
        //   ControlStreamClosedError → permissionStreamClosed (config)
        //   AbortError + parent aborted → user_abort
        //   else → canUseToolRequestFailed (config)
        let message = `Tool permission request failed: ${error}`
        let decisionReason: PermissionDecisionReason =
          canUseToolRequestFailedDenyReason
        if (
          error instanceof Error &&
          (error.name === 'ZodError' ||
            // zod v4 may use ZodError class name
            error.constructor?.name === 'ZodError')
        ) {
          logForDebugging(
            `canUseTool returned a schema-invalid permission result for ${tool.name}: ${error.message.slice(0, 2000)}`,
            { level: 'error' },
          )
          message = `The canUseTool callback returned an invalid permission result. ${PERMISSION_RESULT_SHAPE_HINT}`
          decisionReason = canUseToolInvalidResultDenyReason
        } else if (error instanceof ControlStreamClosedError) {
          decisionReason = permissionStreamClosedDenyReason
        } else if (isAbortError(error) && parentSignal.aborted) {
          message = 'Tool permission request aborted'
          decisionReason = canUseToolAbortedDenyReason
        }
        return {
          behavior: 'deny',
          message,
          toolUseID,
          decisionReason,
        }
      } finally {
        // Only transition back to 'running' if no other permission prompts
        // are pending (concurrent tool execution can have multiple in-flight).
        if (
          this.getPendingPermissionRequests().length === 0 &&
          this.getPendingUserDialogRequests().length === 0
        ) {
          notifySessionStateChanged('running')
        } else {
          reteeWaitingOnUser()
          this.republishSurvivingPendingAction()
        }
        parentSignal.removeEventListener('abort', onParentAbort)
      }
    }
  }

  createHookCallback(callbackId: string, timeout?: number): HookCallback {
    return {
      type: 'callback',
      timeout,
      callback: async (
        input: HookInput,
        toolUseID: string | null,
        abort: AbortSignal | undefined,
      ): Promise<HookJSONOutput> => {
        try {
          const result = await this.sendRequest<HookJSONOutput>(
            {
              subtype: 'hook_callback',
              callback_id: callbackId,
              input: input as any,
              tool_use_id: toolUseID || undefined,
            },
            hookJSONOutputSchema(),
            abort,
          )
          return result
        } catch (error) {
          console.error(`Error in hook callback ${callbackId}:`, error)
          return {}
        }
      },
    }
  }

  /**
   * Sends an elicitation request to the SDK consumer and returns the response.
   */
  async handleElicitation(
    serverName: string,
    message: string,
    requestedSchema?: Record<string, unknown>,
    signal?: AbortSignal,
    mode?: 'form' | 'url',
    url?: string,
    elicitationId?: string,
  ): Promise<ElicitResult> {
    try {
      const result = await this.sendRequest<ElicitResult>(
        {
          subtype: 'elicitation',
          mcp_server_name: serverName,
          message,
          mode,
          url,
          elicitation_id: elicitationId,
          requested_schema: requestedSchema,
        },
        SDKControlElicitationResponseSchema(),
        signal,
      )
      return result
    } catch {
      return { action: 'cancel' as const }
    }
  }

  /**
   * Official requestOAuthTokenRefresh — control_request subtype
   * oauth_token_refresh; response accessToken (nullable). Timeout 30s (fNb).
   */
  async requestOAuthTokenRefresh(): Promise<string | null> {
    const result = await this.sendRequest<{ accessToken: string | null }>(
      { subtype: 'oauth_token_refresh' },
      SDKControlOauthTokenRefreshResponseSchema(),
      AbortSignal.timeout(DEFAULT_SDK_AUTH_REFRESH_CONTROL_TIMEOUT_MS),
    )
    return result.accessToken
  }

  /**
   * Official requestHostAuthTokenRefresh — control_request subtype
   * host_auth_token_refresh; response authToken (nullable). Default 30s (mNb).
   */
  async requestHostAuthTokenRefresh(
    timeoutMs: number = DEFAULT_SDK_AUTH_REFRESH_CONTROL_TIMEOUT_MS,
  ): Promise<string | null> {
    const result = await this.sendRequest<{ authToken: string | null }>(
      { subtype: 'host_auth_token_refresh' },
      SDKControlHostAuthTokenRefreshResponseSchema(),
      AbortSignal.timeout(timeoutMs),
    )
    return result.authToken
  }

  /**
   * Official requestUserDialog densable consumer — park a host-rendered
   * dialog via control_request subtype request_user_dialog.
   *
   * - Publishes requires_action details (dialog:kind)
   * - Optional W1n timeout injects cancelled
   * - On settle: clear published details; retee/republish survivors
   */
  async requestUserDialog(
    dialogKind: string,
    payload: unknown,
    options?: {
      signal?: AbortSignal
      toolUseId?: string
    },
  ): Promise<UserDialogResponse> {
    const requestId = randomUUID()
    const details = buildUserDialogRequiresActionDetails(
      dialogKind,
      payload,
      requestId,
      options?.toolUseId,
    )
    this.publishedPendingActionDetails.set(requestId, details)
    notifySessionStateChanged('requires_action', details)
    this.onUserDialogParked?.(details)

    const timeoutMs = resolveUserDialogParkTimeoutMs()
    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!this.pendingRequests.has(requestId)) return
        this.timedOutUserDialogs.set(requestId, {
          dialogKind,
          timedOutAt: Date.now(),
        })
        this.injectControlResponse({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'cancelled' },
          },
        })
      }, timeoutMs)
      timer.unref?.()
    }

    try {
      return await this.sendRequest<UserDialogResponse>(
        {
          subtype: 'request_user_dialog',
          dialog_kind: dialogKind,
          payload,
          tool_use_id: options?.toolUseId,
        },
        SDKControlRequestUserDialogResponseSchema(),
        options?.signal,
        requestId,
      )
    } catch {
      return { behavior: 'cancelled' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      this.publishedPendingActionDetails.delete(requestId)
      if (
        this.getPendingUserDialogRequests().length === 0 &&
        this.getPendingPermissionRequests().length === 0
      ) {
        notifySessionStateChanged('running')
      } else {
        if (!this.timedOutUserDialogs.has(requestId)) {
          reteeWaitingOnUser()
        }
        this.republishSurvivingPendingAction()
      }
    }
  }

  /**
   * Creates a SandboxAskCallback that forwards sandbox network permission
   * requests to the SDK host as can_use_tool control_requests.
   *
   * This piggybacks on the existing can_use_tool protocol with a synthetic
   * tool name so that SDK hosts (VS Code, CCR, etc.) can prompt the user
   * for network access without requiring a new protocol subtype.
   */
  createSandboxAskCallback(): (hostPattern: {
    host: string
    port?: number
  }) => Promise<boolean> {
    // densable: dedupe concurrent same-host asks; on allow → addSessionAllowedHost
    const inFlight = new Map<string, Promise<boolean>>()
    const askOne = async (host: string): Promise<boolean> => {
      try {
        const result = await this.sendRequest<PermissionToolOutput>(
          {
            subtype: 'can_use_tool',
            tool_name: SANDBOX_NETWORK_ACCESS_TOOL_NAME,
            input: { host },
            tool_use_id: randomUUID(),
            description: `Allow network connection to ${host}?`,
          },
          permissionToolOutputSchema(),
        )
        if (result.behavior !== 'allow') return false
        const { SandboxManager } = await import(
          '../utils/sandbox/sandbox-adapter.js'
        )
        SandboxManager.addSessionAllowedHost(host)
        return true
      } catch {
        // If the request fails (stream closed, abort, etc.), deny the connection
        return false
      }
    }
    return (hostPattern): Promise<boolean> => {
      const host = hostPattern.host
      const existing = inFlight.get(host)
      if (existing) return existing
      const promise = askOne(host).finally(() => {
        inFlight.delete(host)
      })
      inFlight.set(host, promise)
      return promise
    }
  }

  /**
   * Sends an MCP message to an SDK server and waits for the response
   */
  async sendMcpMessage(
    serverName: string,
    message: JSONRPCMessage,
  ): Promise<JSONRPCMessage> {
    const response = await this.sendRequest<{ mcp_response: JSONRPCMessage }>(
      {
        subtype: 'mcp_message',
        server_name: serverName,
        message,
      },
      z.object({
        mcp_response: z.any() as z.Schema<JSONRPCMessage>,
      }),
    )
    return response.mcp_response
  }
}

function exitWithMessage(message: string): never {
  console.error(message)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

/**
 * Execute PermissionRequest hooks and return a decision if one is made.
 * Returns undefined if no hook made a decision.
 */
async function executePermissionRequestHooksForSDK(
  toolName: string,
  toolUseID: string,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  suggestions: InternalPermissionUpdate[] | undefined,
  tool: Tool,
  askSuppressesAlwaysAllowRule = false,
): Promise<PermissionDecision | undefined> {
  const appState = toolUseContext.getAppState()
  const permissionMode = appState.toolPermissionContext.mode

  // Iterate directly over the generator instead of using `all`
  const hookGenerator = executePermissionRequestHooks(
    toolName,
    toolUseID,
    input,
    toolUseContext,
    permissionMode,
    suggestions as unknown as SDKPermissionUpdate[] | undefined,
    toolUseContext.abortController.signal,
  )

  for await (const hookResult of hookGenerator) {
    if (
      hookResult.permissionRequestResult &&
      (hookResult.permissionRequestResult.behavior === 'allow' ||
        hookResult.permissionRequestResult.behavior === 'deny')
    ) {
      const decision = hookResult.permissionRequestResult
      if (decision.behavior === 'allow') {
        const finalInput = decision.updatedInput || input

        // Apply permission updates if provided by hook ("always allow")
        const permissionUpdates = (decision.updatedPermissions ??
          []) as unknown as InternalPermissionUpdate[]
        if (permissionUpdates.length > 0) {
          // densable 2.1.235 #12 — strip bare whole-tool allows on SDK hook allow.
          const shouldStrip =
            tool.suppressesAlwaysAllowRule?.(finalInput) === true ||
            askSuppressesAlwaysAllowRule
          const updatesToPersist = shouldStrip
            ? stripWholeToolGrantsForAsk(
                permissionUpdates,
                tool,
                toolUseContext.getAppState().toolPermissionContext,
              )
            : permissionUpdates
          if (updatesToPersist.length > 0) {
            persistPermissionUpdates(updatesToPersist)
            const currentAppState = toolUseContext.getAppState()
            const updatedContext = applyPermissionUpdates(
              currentAppState.toolPermissionContext,
              updatesToPersist,
            )
            // Update permission context via setAppState
            toolUseContext.setAppState(prev => {
              if (prev.toolPermissionContext === updatedContext) return prev
              return { ...prev, toolPermissionContext: updatedContext }
            })
          }
        }

        return {
          behavior: 'allow',
          updatedInput: finalInput,
          userModified: false,
          decisionReason: {
            type: 'hook',
            hookName: 'PermissionRequest',
          },
        }
      } else {
        // Hook denied the permission
        return {
          behavior: 'deny',
          message:
            decision.message || 'Permission denied by PermissionRequest hook',
          decisionReason: {
            type: 'hook',
            hookName: 'PermissionRequest',
          },
        }
      }
    }
  }

  return undefined
}
