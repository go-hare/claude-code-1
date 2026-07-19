import type {
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  SDKUserMessage,
} from '../entrypoints/agentSdkTypes.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemMessage,
} from '../types/message.js'
import stripAnsi from 'strip-ansi'
import { logForDebugging } from '../utils/debug.js'
import { isSystemVisibleOrigin } from '../utils/messagePredicates.js'
import { fromSDKCompactMetadata } from '../utils/messages/mappers.js'
import {
  createAssistantMessage,
  createUserMessage,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
} from '../utils/messages.js'

/** densable zi — strip ANSI from remote/SDK display strings. */
function densableZi(value: unknown): string {
  if (typeof value !== 'string') return value == null ? '' : String(value)
  return stripAnsi(value)
}

/**
 * Converts SDKMessage from CCR to REPL Message types.
 *
 * The CCR backend sends SDK-format messages via WebSocket. The REPL expects
 * internal Message types for rendering. This adapter bridges the two.
 */

/**
 * Convert an SDKAssistantMessage to an AssistantMessage.
 * densable pIb: timestamp from SDK when present; stamp isApiErrorMessage from
 * is_api_error_message (behavior only — no analytics).
 */
function convertAssistantMessage(msg: SDKAssistantMessage): AssistantMessage {
  const sdk = msg as SDKAssistantMessage & {
    timestamp?: string
    is_api_error_message?: boolean
  }
  return {
    type: 'assistant',
    message: msg.message!,
    uuid: msg.uuid!,
    requestId: undefined,
    timestamp: sdk.timestamp ?? new Date().toISOString(),
    error: msg.error,
    ...(sdk.is_api_error_message ? { isApiErrorMessage: true as const } : {}),
  }
}

/**
 * Convert an SDKPartialAssistantMessage (streaming) to a StreamEvent.
 * densable fIb: pass through event + optional ttftMs from ttft_ms.
 */
function convertStreamEvent(msg: SDKPartialAssistantMessage): StreamEvent {
  const sdk = msg as SDKPartialAssistantMessage & { ttft_ms?: number }
  return {
    type: 'stream_event',
    event: msg.event,
    ...(sdk.ttft_ms !== undefined ? { ttftMs: sdk.ttft_ms } : {}),
  }
}

/**
 * Convert an SDKResultMessage to a SystemMessage.
 * densable mIb: strip `[ede_diagnostic]` error lines; if none remain after filter
 * return null (caller ignores). Success content is unused by convertSDKMessage
 * (success subtype short-circuits to ignored) but kept for parity with mIb.
 */
function convertResultMessage(msg: SDKResultMessage): SystemMessage | null {
  if (msg.subtype === 'success') {
    return {
      type: 'system',
      subtype: 'informational',
      content: 'Session completed successfully',
      level: 'info',
      uuid: msg.uuid!,
      timestamp: new Date().toISOString(),
    }
  }
  const errors = (msg.errors ?? []).filter(
    e => !e.startsWith('[ede_diagnostic]'),
  )
  if (errors.length === 0) {
    return null
  }
  return {
    type: 'system',
    subtype: 'informational',
    content: densableZi(errors.join(', ')),
    level: 'warning',
    uuid: msg.uuid!,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Convert an SDKSystemMessage (init) to a SystemMessage
 */
function convertInitMessage(msg: SDKSystemMessage): SystemMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content: `Remote session initialized (model: ${msg.model})`,
    level: 'info',
    uuid: msg.uuid!,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Convert an SDKStatusMessage to a SystemMessage
 */
function convertStatusMessage(msg: SDKStatusMessage): SystemMessage | null {
  if (!msg.status) {
    return null
  }

  return {
    type: 'system',
    subtype: 'informational',
    content:
      msg.status === 'compacting'
        ? 'Compacting conversation…'
        : `Status: ${densableZi(msg.status)}`,
    level: 'info',
    uuid: msg.uuid!,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Convert an SDKToolProgressMessage to a SystemMessage.
 * We use a system message instead of ProgressMessage since the Progress type
 * is a complex union that requires tool-specific data we don't have from CCR.
 */
function convertToolProgressMessage(
  msg: SDKToolProgressMessage,
): SystemMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content: `Tool ${densableZi(msg.tool_name)} running for ${msg.elapsed_time_seconds}s…`,
    level: 'info',
    uuid: msg.uuid!,
    timestamp: new Date().toISOString(),
    toolUseID: msg.tool_use_id,
  }
}

/**
 * Convert an SDKCompactBoundaryMessage to a SystemMessage
 */
function convertCompactBoundaryMessage(
  msg: SDKCompactBoundaryMessage,
): SystemMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    level: 'info',
    uuid: msg.uuid!,
    timestamp: new Date().toISOString(),
    compactMetadata: fromSDKCompactMetadata(msg.compact_metadata),
  }
}

/**
 * Result of converting an SDKMessage
 */
export type ConvertedMessage =
  | { type: 'message'; message: Message }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'ignored' }

type ConvertOptions = {
  /** Convert user messages containing tool_result content blocks into UserMessages.
   * Used by direct connect mode where tool results come from the remote server
   * and need to be rendered locally. CCR mode ignores user messages since they
   * are handled differently. */
  convertToolResults?: boolean
  /**
   * Convert user text messages into UserMessages for display. Used when
   * converting historical events where user-typed messages need to be shown.
   * In live WS mode these are already added locally by the REPL so they're
   * ignored by default.
   */
  convertUserTextMessages?: boolean
}

/**
 * Convert an SDKMessage to REPL message format
 */
export function convertSDKMessage(
  msg: SDKMessage,
  opts?: ConvertOptions,
): ConvertedMessage {
  switch (msg.type) {
    case 'assistant':
      return {
        type: 'message',
        message: convertAssistantMessage(msg as SDKAssistantMessage),
      }

    case 'user': {
      const userMsg = msg as SDKUserMessage
      const content = userMsg.message?.content
      // Tool result messages from the remote server need to be converted so
      // they render and collapse like local tool results. Detect via content
      // shape (tool_result blocks) — parent_tool_use_id is NOT reliable: the
      // agent-side normalizeMessage() hardcodes it to null for top-level
      // tool results, so it can't distinguish tool results from prompt echoes.
      const isToolResult =
        Array.isArray(content) && content.some(b => b.type === 'tool_result')
      if (opts?.convertToolResults && isToolResult) {
        return {
          type: 'message',
          message: createUserMessage({
            content,
            toolUseResult: userMsg.tool_use_result,
            uuid: userMsg.uuid,
            timestamp: userMsg.timestamp,
          }),
        }
      }
      // densable Nke order after tool_result convert:
      // parent_tool_use_id → ignored; isSynthetic && !Ace(origin) → ignored;
      // convertUserTextMessages OR interrupt text (DV/kH) → convert.
      if (userMsg.parent_tool_use_id) {
        return { type: 'ignored' }
      }
      const origin = (
        userMsg as {
          origin?: { kind?: string; senderTaskId?: string } | null
        }
      ).origin
      if (
        (userMsg as { isSynthetic?: boolean }).isSynthetic === true &&
        !isSystemVisibleOrigin(origin)
      ) {
        return { type: 'ignored' }
      }
      const isInterruptText =
        content === INTERRUPT_MESSAGE ||
        (Array.isArray(content) &&
          content.some(
            b =>
              b.type === 'text' &&
              (b.text === INTERRUPT_MESSAGE ||
                b.text === INTERRUPT_MESSAGE_FOR_TOOL_USE),
          ))
      // When converting historical events, user-typed messages need to be
      // rendered (they weren't added locally by the REPL). Skip tool_results
      // here — already handled above. densable also always converts interrupt
      // placeholders even without convertUserTextMessages.
      if (
        (opts?.convertUserTextMessages || isInterruptText) &&
        !isToolResult
      ) {
        if (typeof content === 'string' || Array.isArray(content)) {
          return {
            type: 'message',
            message: createUserMessage({
              content,
              toolUseResult: userMsg.tool_use_result,
              uuid: userMsg.uuid,
              timestamp: userMsg.timestamp,
            }),
          }
        }
      }
      // User-typed messages (string content) are already added locally by REPL.
      // In CCR mode, all user messages are ignored (tool results handled differently).
      return { type: 'ignored' }
    }

    case 'stream_event':
      return {
        type: 'stream_event',
        event: convertStreamEvent(msg as SDKPartialAssistantMessage),
      }

    case 'result': {
      // densable Nke: success → ignored; error mIb may return null when only
      // [ede_diagnostic] lines remain after filter.
      if ((msg as SDKResultMessage).subtype === 'success') {
        return { type: 'ignored' }
      }
      const resultMsg = convertResultMessage(msg as SDKResultMessage)
      return resultMsg
        ? { type: 'message', message: resultMsg }
        : { type: 'ignored' }
    }

    case 'system': {
      const sysMsg = msg as SDKSystemMessage
      if (sysMsg.subtype === 'init') {
        return { type: 'message', message: convertInitMessage(sysMsg) }
      }
      if (sysMsg.subtype === 'status') {
        // densable Nke: status=requesting → stream_request_start (spinner mode).
        const status = (msg as SDKStatusMessage).status
        if (status === 'requesting') {
          return {
            type: 'stream_event',
            event: { type: 'stream_request_start' },
          }
        }
        const statusMsg = convertStatusMessage(msg as SDKStatusMessage)
        return statusMsg
          ? { type: 'message', message: statusMsg }
          : { type: 'ignored' }
      }
      if (sysMsg.subtype === 'compact_boundary') {
        return {
          type: 'message',
          message: convertCompactBoundaryMessage(
            msg as SDKCompactBoundaryMessage,
          ),
        }
      }
      // densable Nke system extras (behavior only):
      // informational / permission_denied / local_command_output /
      // model_refusal_fallback / model_refusal_no_fallback (gty refused uuid).
      if (sysMsg.subtype === 'informational') {
        const info = sysMsg as SDKSystemMessage & {
          content?: string
          level?: string
          tool_use_id?: string
          prevent_continuation?: boolean
        }
        return {
          type: 'message',
          message: {
            type: 'system',
            subtype: 'informational',
            content: densableZi(info.content),
            level: (info.level as SystemMessage['level']) ?? 'info',
            isMeta: false,
            uuid: info.uuid!,
            timestamp: new Date().toISOString(),
            ...(info.tool_use_id ? { toolUseID: info.tool_use_id } : {}),
            ...(info.prevent_continuation
              ? { preventContinuation: info.prevent_continuation }
              : {}),
          } as SystemMessage,
        }
      }
      if (sysMsg.subtype === 'permission_denied') {
        // densable: under convertToolResults, permission_denied is ignored
        // (direct-connect tool path renders denials elsewhere).
        if (opts?.convertToolResults) {
          return { type: 'ignored' }
        }
        const denied = sysMsg as SDKSystemMessage & {
          tool_name?: string
          decision_reason?: string
          decision_reason_type?: string
          tool_use_id?: string
        }
        const reason = denied.decision_reason
          ? ` — ${densableZi(denied.decision_reason)}`
          : denied.decision_reason_type
            ? ` (${densableZi(denied.decision_reason_type)})`
            : ''
        return {
          type: 'message',
          message: {
            type: 'system',
            subtype: 'informational',
            content: densableZi(
              `Permission denied: ${denied.tool_name ?? ''}${reason}`,
            ),
            level: 'warning',
            uuid: denied.uuid!,
            timestamp: new Date().toISOString(),
            toolUseID: denied.tool_use_id,
          } as SystemMessage,
        }
      }
      if (
        sysMsg.subtype === 'model_refusal_fallback' ||
        sysMsg.subtype === 'model_refusal_no_fallback'
      ) {
        // densable gty #172 — preserve refused_user_message_uuid / retracted ids
        // for rewind/edit-and-retry consumers.
        const ref = sysMsg as SDKSystemMessage & {
          content?: string
          trigger?: string
          direction?: string
          original_model?: string
          fallback_model?: string
          request_id?: string | null
          api_refusal_category?: string | null
          api_refusal_explanation?: string | null
          refused_user_message_uuid?: string | null
          retracted_message_uuids?: string[]
        }
        return {
          type: 'message',
          message: {
            type: 'system',
            subtype: sysMsg.subtype,
            content: densableZi(ref.content) ?? '',
            level: 'warning',
            isMeta: false,
            uuid: ref.uuid!,
            timestamp: new Date().toISOString(),
            ...(ref.trigger !== undefined ? { trigger: ref.trigger } : {}),
            ...(ref.direction !== undefined
              ? { direction: ref.direction }
              : {}),
            ...(ref.original_model !== undefined
              ? { originalModel: ref.original_model }
              : {}),
            ...(ref.fallback_model !== undefined
              ? { fallbackModel: ref.fallback_model }
              : {}),
            ...(ref.request_id !== undefined
              ? { requestId: ref.request_id }
              : {}),
            ...(ref.api_refusal_category !== undefined
              ? { apiRefusalCategory: ref.api_refusal_category }
              : {}),
            ...(ref.api_refusal_explanation !== undefined
              ? { apiRefusalExplanation: ref.api_refusal_explanation }
              : {}),
            refusedUserMessageUuid: ref.refused_user_message_uuid ?? null,
            ...(ref.retracted_message_uuids !== undefined
              ? { retractedMessageUuids: ref.retracted_message_uuids }
              : {}),
          } as SystemMessage,
        }
      }
      if (sysMsg.subtype === 'local_command_output') {
        // densable XC: XC({content:zi(e.content), uuid:()=>e.uuid})
        // pDd uses the same uuid factory for outer uuid + message.id.
        const loc = sysMsg as SDKSystemMessage & { content?: string }
        const synthetic = createAssistantMessage({
          content: densableZi(loc.content),
          ...(loc.uuid
            ? { uuid: () => loc.uuid as string }
            : {}),
        })
        return { type: 'message', message: synthetic }
      }
      // hook_response and other subtypes
      logForDebugging(
        `[sdkMessageAdapter] Ignoring system message subtype: ${sysMsg.subtype}`,
      )
      return { type: 'ignored' }
    }

    case 'tool_progress':
      return {
        type: 'message',
        message: convertToolProgressMessage(msg as SDKToolProgressMessage),
      }

    case 'auth_status':
      // Auth status is handled separately, not converted to a display message
      logForDebugging('[sdkMessageAdapter] Ignoring auth_status message')
      return { type: 'ignored' }

    case 'tool_use_summary':
      // Tool use summaries are SDK-only events, not displayed in REPL
      logForDebugging('[sdkMessageAdapter] Ignoring tool_use_summary message')
      return { type: 'ignored' }

    case 'rate_limit_event':
      // Rate limit events are SDK-only events, not displayed in REPL
      logForDebugging('[sdkMessageAdapter] Ignoring rate_limit_event message')
      return { type: 'ignored' }

    case 'task_state':
      // Bridge-only task snapshots are consumed by the web panel, not REPL UIs.
      logForDebugging('[sdkMessageAdapter] Ignoring task_state message')
      return { type: 'ignored' }

    default: {
      // Gracefully ignore unknown message types. The backend may send new
      // types before the client is updated; logging helps with debugging
      // without crashing or losing the session.
      logForDebugging(
        `[sdkMessageAdapter] Unknown message type: ${(msg as { type: string }).type}`,
      )
      return { type: 'ignored' }
    }
  }
}

/**
 * Check if an SDKMessage indicates the session has ended
 */
export function isSessionEndMessage(msg: SDKMessage): boolean {
  return msg.type === 'result'
}

/**
 * Check if an SDKResultMessage indicates success
 */
export function isSuccessResult(msg: SDKResultMessage): boolean {
  return msg.subtype === 'success'
}
