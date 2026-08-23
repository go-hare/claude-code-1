/**
 * Shared transport-layer helpers for bridge message handling.
 *
 * Extracted from replBridge.ts so both the env-based core (initBridgeCore)
 * and the env-less core (initEnvLessBridgeCore) can use the same ingress
 * parsing, control-request handling, and echo-dedup machinery.
 *
 * Everything here is pure — no closure over bridge-specific state. All
 * collaborators (transport, sessionId, UUID sets, callbacks) are passed
 * as params.
 */

import { randomUUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { SDKResultSuccess } from '../entrypoints/sdk/coreTypes.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../services/analytics/index.js'
import { EMPTY_USAGE } from '@ant/model-provider'
import type { Message } from '../types/message.js'
import { normalizeControlMessageKeys } from '../utils/controlMessageCompat.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { rcLog } from './rcDebugLog.js'
import { stripDisplayTagsAllowEmpty } from '../utils/displayTags.js'
import { errorMessage } from '../utils/errors.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import { jsonParse } from '../utils/slowOperations.js'
import type { ReplBridgeTransport } from './replBridgeTransport.js'
import {
  BASH_INPUT_TAG,
  CHANNEL_MESSAGE_TAG,
  CROSS_SESSION_MESSAGE_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  REMOTE_REVIEW_PROGRESS_TAG,
  REMOTE_REVIEW_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,
  ULTRAPLAN_TAG,
} from '../constants/xml.js'

// ─── Type guards ─────────────────────────────────────────────────────────────

/** Type predicate for parsed WebSocket messages. SDKMessage is a
 *  discriminated union on `type` — validating the discriminant is
 *  sufficient for the predicate; callers narrow further via the union. */
export function isSDKMessage(value: unknown): value is SDKMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

/** Type predicate for control_response messages from the server. */
export function isSDKControlResponse(
  value: unknown,
): value is SDKControlResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'control_response' &&
    'response' in value
  )
}

/** Type predicate for control_request messages from the server. */
export function isSDKControlRequest(
  value: unknown,
): value is SDKControlRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'control_request' &&
    'request_id' in value &&
    'request' in value
  )
}

/**
 * densable O7 — queued_command origin is human / auto-continuation / unset.
 */
export function isBridgeQueuedCommandOriginEligible(
  origin: { kind?: string } | undefined,
): boolean {
  return (
    origin === undefined ||
    origin.kind === 'human' ||
    origin.kind === 'auto-continuation'
  )
}

/**
 * densable SOt — messages forwarded to the bridge transport.
 * Virtual user/assistant are display-only. Attachments: hook_system_message
 * always; queued_command when prompt + !isMeta + O7 origin. System:
 * local_command, plus compact_boundary (no tip bridgeStateFramesGate → true).
 */
export function isEligibleBridgeMessage(m: Message): boolean {
  if ((m.type === 'user' || m.type === 'assistant') && m.isVirtual) {
    return false
  }
  if (m.type === 'attachment') {
    const attachment = m.attachment as
      | {
          type?: string
          commandMode?: string
          isMeta?: boolean
          origin?: { kind?: string }
        }
      | undefined
    if (attachment?.type === 'hook_system_message') return true
    return (
      attachment?.type === 'queued_command' &&
      attachment.commandMode === 'prompt' &&
      !attachment.isMeta &&
      isBridgeQueuedCommandOriginEligible(attachment.origin)
    )
  }
  return (
    m.type === 'user' ||
    m.type === 'assistant' ||
    (m.type === 'system' &&
      (m.subtype === 'local_command' || m.subtype === 'compact_boundary'))
  )
}

/**
 * Extract title-worthy text from a Message for onUserMessage. Returns
 * undefined for messages that shouldn't title the session: non-user, meta
 * (nudges), tool results, compact summaries, non-human origins (task
 * notifications, channel messages), or pure display-tag content
 * (<ide_opened_file>, <session-start-hook>, etc.).
 *
 * Synthetic interrupts ([Request interrupted by user]) are NOT filtered here —
 * isSyntheticMessage lives in messages.ts (heavy import, pulls command
 * registry). The initialMessages path in initReplBridge checks it; the
 * writeMessages path reaching an interrupt as the *first* message is
 * implausible (an interrupt implies a prior prompt already flowed through).
 */
export function extractTitleText(m: Message): string | undefined {
  if (m.type !== 'user' || m.isMeta || m.toolUseResult || m.isCompactSummary)
    return undefined
  if (m.origin && (m.origin as { kind?: string }).kind !== 'human')
    return undefined
  const content = m.message!.content
  let raw: string | undefined
  if (typeof content === 'string') {
    raw = content
  } else {
    for (const block of content ?? []) {
      if (block.type === 'text') {
        raw = block.text
        break
      }
    }
  }
  if (!raw) return undefined
  const clean = stripDisplayTagsAllowEmpty(raw)
  return clean || undefined
}

const SYSTEM_REMINDER_TAG = 'system-reminder'
const XML_BLOCK_PATTERN = /\s*<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/gy
const RUNNING_STATE_META_TAGS = new Set([
  BASH_INPUT_TAG,
  CHANNEL_MESSAGE_TAG,
  CROSS_SESSION_MESSAGE_TAG,
  REMOTE_REVIEW_PROGRESS_TAG,
  REMOTE_REVIEW_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,
  ULTRAPLAN_TAG,
])

function extractUserMessageText(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (
        block,
      ): block is {
        type: 'text'
        text: string
      } =>
        !!block &&
        typeof block === 'object' &&
        block.type === 'text' &&
        typeof block.text === 'string',
    )
    .map(block => block.text)
    .join('')
}

function getEnvelopeTagNames(text: string): string[] | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  XML_BLOCK_PATTERN.lastIndex = 0
  const tags: string[] = []
  while (XML_BLOCK_PATTERN.lastIndex < trimmed.length) {
    const match = XML_BLOCK_PATTERN.exec(trimmed)
    if (!match) return null
    tags.push(match[1]!)
  }
  return tags.length > 0 ? tags : null
}

/**
 * Remote Control uses user messages to infer "a turn is actively running" in
 * places where the server does not derive that state for us. Hidden local
 * slash-command scaffolding (for example `<local-command-caveat>` and pure
 * `<system-reminder>` wrappers from `/proactive`) should not flip the session
 * back to running after the command has already completed.
 */
export function shouldReportRunningForMessage(message: Message): boolean {
  if (message.type !== 'user') return false
  if (message.isVisibleInTranscriptOnly) return false
  if (message.toolUseResult !== undefined) return true
  if (!message.isMeta) return true

  const tags = getEnvelopeTagNames(extractUserMessageText(message))
  if (!tags) return true

  return tags.some(
    tag =>
      tag !== LOCAL_COMMAND_CAVEAT_TAG &&
      tag !== SYSTEM_REMINDER_TAG &&
      RUNNING_STATE_META_TAGS.has(tag),
  )
}

export function shouldReportRunningForMessages(
  messages: readonly Message[],
): boolean {
  return messages.some(shouldReportRunningForMessage)
}

// ─── Ingress routing ─────────────────────────────────────────────────────────

/**
 * Parse an ingress WebSocket message and route it to the appropriate handler.
 * Ignores messages whose UUID is in recentPostedUUIDs (echoes of what we sent)
 * or in recentInboundUUIDs (re-deliveries we've already forwarded — e.g.
 * server replayed history after a transport swap lost the seq-num cursor).
 */
export function handleIngressMessage(
  data: string,
  recentPostedUUIDs: BoundedUUIDSet,
  recentInboundUUIDs: BoundedUUIDSet,
  onInboundMessage: ((msg: SDKMessage) => void | Promise<void>) | undefined,
  onPermissionResponse?: ((response: SDKControlResponse) => void) | undefined,
  onControlRequest?: ((request: SDKControlRequest) => void) | undefined,
): void {
  try {
    const parsed: unknown = normalizeControlMessageKeys(jsonParse(data))

    // control_response is not an SDKMessage — check before the type guard
    if (isSDKControlResponse(parsed)) {
      logForDebugging('[bridge:repl] Ingress message type=control_response')
      onPermissionResponse?.(parsed)
      return
    }

    // control_request from the server (initialize, set_model, can_use_tool).
    // Must respond promptly or the server kills the WS (~10-14s timeout).
    if (isSDKControlRequest(parsed)) {
      logForDebugging(
        `[bridge:repl] Inbound control_request subtype=${(parsed.request as { subtype?: string }).subtype}`,
      )
      onControlRequest?.(parsed)
      return
    }

    if (!isSDKMessage(parsed)) return

    // Check for UUID to detect echoes of our own messages
    const uuid =
      'uuid' in parsed && typeof parsed.uuid === 'string'
        ? parsed.uuid
        : undefined

    if (uuid && recentPostedUUIDs.has(uuid)) {
      logForDebugging(
        `[bridge:repl] Ignoring echo: type=${parsed.type} uuid=${uuid}`,
      )
      return
    }

    // Defensive dedup: drop inbound prompts we've already forwarded. The
    // SSE seq-num carryover (lastTransportSequenceNum) is the primary fix
    // for history-replay; this catches edge cases where that negotiation
    // fails (server ignores from_sequence_num, transport died before
    // receiving any frames, etc).
    if (uuid && recentInboundUUIDs.has(uuid)) {
      logForDebugging(
        `[bridge:repl] Ignoring re-delivered inbound: type=${parsed.type} uuid=${uuid}`,
      )
      return
    }

    logForDebugging(
      `[bridge:repl] Ingress message type=${parsed.type}${uuid ? ` uuid=${uuid}` : ''}`,
    )

    if (parsed.type === 'user') {
      if (uuid) recentInboundUUIDs.add(uuid)
      logEvent('tengu_bridge_message_received', {
        is_repl: true,
      })
      // Fire-and-forget — handler may be async (attachment resolution).
      void onInboundMessage?.(parsed)
    } else {
      logForDebugging(
        `[bridge:repl] Ignoring non-user inbound message: type=${parsed.type}`,
      )
    }
  } catch (err) {
    logForDebugging(
      `[bridge:repl] Failed to parse ingress message: ${errorMessage(err)}`,
    )
  }
}

// ─── Server-initiated control requests ───────────────────────────────────────

export type ServerControlRequestHandlers = {
  transport: ReplBridgeTransport | null
  sessionId: string
  /**
   * When true, all mutable requests (interrupt, set_model, set_permission_mode,
   * set_max_thinking_tokens, set_mcp_permission_mode_override) reply with an
   * error instead of false-success.
   * initialize still replies success — the server kills the connection otherwise.
   * Used by the outbound-only bridge mode and the SDK's /bridge subpath so claude.ai sees a
   * proper error instead of "action succeeded but nothing happened locally".
   */
  outboundOnly?: boolean
  onInterrupt?: () => void
  /**
   * densable 2.1.238 #19 — control field onStopTask. Host maps to
   * stopTask(..., source:"user"). Async; UHr writes the control_response.
   */
  onStopTask?: (taskId: string) => Promise<unknown>
  /**
   * densable 2.1.238 Zkd `p?.(e.request.model??void 0)`.
   * Return `{ok:false}` to emit an error control_response; void / `{ok:true}`
   * is success (`if (M && !M.ok)`).
   */
  onSetModel?: (
    model: string | undefined,
  ) => void | { ok: true } | { ok: false; error: string }
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  /**
   * Official 2.1.x: per-MCP-server tighten-only mode pin. Callback owns
   * parse/auto-gate/state (same bootstrap-isolation pattern as
   * onSetPermissionMode). `mode` is the raw control-channel value
   * (`'default' | 'auto' | null` or rejected string).
   */
  onSetMcpPermissionModeOverride?: (
    serverName: string,
    mode: string | null,
  ) => { ok: true; warning?: string } | { ok: false; error: string }
}

const OUTBOUND_ONLY_ERROR =
  'This session is outbound-only. Enable Remote Control locally to allow inbound control.'

/**
 * densable UHr — async stop_task control_response. Must return from the
 * switch so the sync write at the end of handleServerControlRequest is skipped.
 */
function replyStopTaskAsync(
  request: SDKControlRequest,
  transport: ReplBridgeTransport,
  sessionId: string,
  result: Promise<unknown>,
): void {
  void result
    .then(
      payload =>
        ({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: request.request_id,
            response:
              payload && typeof payload === 'object' && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)
                : {},
          },
        }) satisfies SDKControlResponse,
    )
    .catch(
      err =>
        ({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: errorMessage(err),
          },
        }) satisfies SDKControlResponse,
    )
    .then(response => {
      const event = { ...response, session_id: sessionId }
      void transport.write(event)
      const resultSubtype = response.response.subtype
      rcLog(
        `control_response: subtype=stop_task` +
          ` request_id=${request.request_id}` +
          ` result=${resultSubtype}`,
      )
      logForDebugging(
        `[bridge:repl] Sent control_response for stop_task request_id=${request.request_id} result=${resultSubtype}`,
      )
    })
}

/**
 * Respond to inbound control_request messages from the server. The server
 * sends these for session lifecycle events (initialize, set_model) and
 * for turn-level coordination (interrupt, set_max_thinking_tokens). If we
 * don't respond, the server hangs and kills the WS after ~10-14s.
 *
 * Previously a closure inside initBridgeCore's onWorkReceived; now takes
 * collaborators as params so both cores can use it.
 */
export function handleServerControlRequest(
  request: SDKControlRequest,
  handlers: ServerControlRequestHandlers,
): void {
  const {
    transport,
    sessionId,
    outboundOnly,
    onInterrupt,
    onStopTask,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onSetMcpPermissionModeOverride,
  } = handlers
  if (!transport) {
    logForDebugging(
      '[bridge:repl] Cannot respond to control_request: transport not configured',
    )
    return
  }

  let response: SDKControlResponse

  // Outbound-only: reply error for mutable requests so claude.ai doesn't show
  // false success. initialize must still succeed (server kills the connection
  // if it doesn't — see comment above).
  const req = request.request as {
    subtype: string
    model?: unknown
    max_thinking_tokens?: number | null
    mode?: string
    [key: string]: unknown
  }
  if (outboundOnly && req.subtype !== 'initialize') {
    response = {
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: request.request_id,
        error: OUTBOUND_ONLY_ERROR,
      },
    }
    const event = { ...response, session_id: sessionId }
    void transport.write(event)
    logForDebugging(
      `[bridge:repl] Rejected ${req.subtype} (outbound-only) request_id=${request.request_id}`,
    )
    return
  }

  switch (req.subtype) {
    case 'initialize':
      // Respond with minimal capabilities — the REPL handles
      // commands, models, and account info itself.
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
          response: {
            commands: [],
            output_style: 'normal',
            available_output_styles: ['normal'],
            models: [],
            account: {},
            pid: process.pid,
          },
        },
      }
      break

    case 'set_model': {
      // densable Zkd: non-string (except null/undefined) → invalid_model_type;
      // callback `{ok:false}` → error control_response; else success.
      const requested = req.model
      if (requested != null && typeof requested !== 'string') {
        logEvent('tengu_feature_bad', {
          feature_name:
            'model_switch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code:
            'invalid_model_type' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: 'set_model: model must be a string',
          },
        }
        break
      }
      const verdict = onSetModel?.(
        typeof requested === 'string' ? requested : undefined,
      )
      if (verdict && !verdict.ok) {
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: verdict.error,
          },
        }
      } else {
        response = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: request.request_id,
          },
        }
      }
      break
    }

    case 'set_max_thinking_tokens':
      onSetMaxThinkingTokens?.(req.max_thinking_tokens ?? null)
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

    case 'set_permission_mode': {
      // The callback returns a policy verdict so we can send an error
      // control_response without importing isAutoModeGateEnabled /
      // isBypassPermissionsModeDisabled here (bootstrap-isolation). If no
      // callback is registered (daemon context, which doesn't wire this —
      // see daemonBridge.ts), return an error verdict rather than a silent
      // false-success: the mode is never actually applied in that context,
      // so success would lie to the client.
      const verdict = onSetPermissionMode?.(req.mode as PermissionMode) ?? {
        ok: false,
        error:
          'set_permission_mode is not supported in this context (onSetPermissionMode callback not registered)',
      }
      if (verdict.ok) {
        response = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: request.request_id,
          },
        }
      } else {
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: (verdict as { ok: false; error: string }).error,
          },
        }
      }
      break
    }

    case 'interrupt':
      onInterrupt?.()
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

    case 'stop_task': {
      const taskId = req.task_id
      if (typeof taskId !== 'string') {
        logForDiagnosticsNoPII('info', 'task_stop_user', {
          invalid_task_id: true,
        })
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: 'stop_task: task_id must be a string',
          },
        }
        break
      }
      if (!onStopTask) {
        logForDiagnosticsNoPII('info', 'task_stop_user', {
          not_supported: true,
        })
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error:
              'stop_task is not supported in this context (callback not registered)',
          },
        }
        break
      }
      replyStopTaskAsync(request, transport, sessionId, onStopTask(taskId))
      return
    }

    case 'set_mcp_permission_mode_override': {
      // Official 2.1.x tighten-only per-server pin (print.ts snt / WDu).
      const serverName =
        typeof req.serverName === 'string' ? req.serverName : ''
      const mode = req.mode === undefined ? null : (req.mode as string | null)
      if (!serverName) {
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error:
              'set_mcp_permission_mode_override requires a non-empty serverName',
          },
        }
        break
      }
      const verdict = onSetMcpPermissionModeOverride?.(serverName, mode) ?? {
        ok: false,
        error:
          'set_mcp_permission_mode_override is not supported in this context (onSetMcpPermissionModeOverride callback not registered)',
      }
      if (verdict.ok) {
        response = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: request.request_id,
            ...(verdict.warning
              ? { response: { warning: verdict.warning } }
              : {}),
          },
        }
      } else {
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: (verdict as { ok: false; error: string }).error,
          },
        }
      }
      break
    }

    default:
      // Unknown subtype — respond with error so the server doesn't
      // hang waiting for a reply that never comes.
      response = {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: request.request_id,
          error: `REPL bridge does not handle control_request subtype: ${req.subtype}`,
        },
      }
  }

  const event = { ...response, session_id: sessionId }
  void transport.write(event)
  rcLog(
    `control_response: subtype=${req.subtype}` +
      ` request_id=${request.request_id}` +
      ` result=${(response.response as { subtype?: string }).subtype}`,
  )
  logForDebugging(
    `[bridge:repl] Sent control_response for ${req.subtype} request_id=${request.request_id} result=${(response.response as { subtype?: string }).subtype}`,
  )
}

// ─── Result message (for session archival on teardown) ───────────────────────

/**
 * Build a minimal `SDKResultSuccess` message for session archival.
 * The server needs this event before a WS close to trigger archival.
 */
export function makeResultMessage(sessionId: string): SDKResultSuccess {
  return {
    type: 'result_success',
    subtype: 'success',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 0,
    result: '',
    stop_reason: null,
    total_cost_usd: 0,
    usage: { ...EMPTY_USAGE },
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
    uuid: randomUUID(),
  }
}

/**
 * densable mzu(e,t) — host-exit reason before result on teardown.
 * Written when teardown({ reason }) is set (useReplBridge host_exit / disable).
 */
export function makeWorkerShuttingDownMessage(
  sessionId: string,
  reason: string,
): {
  type: 'system'
  subtype: 'worker_shutting_down'
  reason: string
  session_id: string
  uuid: string
} {
  return {
    type: 'system',
    subtype: 'worker_shutting_down',
    reason,
    session_id: sessionId,
    uuid: randomUUID(),
  }
}

// ─── BoundedUUIDSet (echo-dedup ring buffer) ─────────────────────────────────

/**
 * FIFO-bounded set backed by a circular buffer. Evicts the oldest entry
 * when capacity is reached, keeping memory usage constant at O(capacity).
 *
 * Messages are added in chronological order, so evicted entries are always
 * the oldest. The caller relies on external ordering (the hook's
 * lastWrittenIndexRef) as the primary dedup — this set is a secondary
 * safety net for echo filtering and race-condition dedup.
 */
export class BoundedUUIDSet {
  private readonly capacity: number
  private readonly ring: (string | undefined)[]
  private readonly set = new Set<string>()
  private writeIdx = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.ring = new Array<string | undefined>(capacity)
  }

  add(uuid: string): void {
    if (this.set.has(uuid)) return
    // Evict the entry at the current write position (if occupied)
    const evicted = this.ring[this.writeIdx]
    if (evicted !== undefined) {
      this.set.delete(evicted)
    }
    this.ring[this.writeIdx] = uuid
    this.set.add(uuid)
    this.writeIdx = (this.writeIdx + 1) % this.capacity
  }

  has(uuid: string): boolean {
    return this.set.has(uuid)
  }

  clear(): void {
    this.set.clear()
    this.ring.fill(undefined)
    this.writeIdx = 0
  }
}
