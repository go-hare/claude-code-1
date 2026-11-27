/**
 * API content block normalization, thinking signature protobuf decoding, and streaming event handling (handleMessageFromStream).
 */

import type {
  BetaMessage,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ThinkingBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { feature } from 'bun:bundle'
import isObject from 'lodash-es/isObject.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import type { AgentId } from 'src/types/ids.js'
import type { SpinnerMode } from '../../components/Spinner.js'
import { findToolByName, type Tools } from '../../Tool.js'
import { isConnectorTextBlock } from '../../types/connectorText.js'
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
} from '../../types/message.js'
import { normalizeToolInput } from '../api.js'
import { logForDebugging } from '../debug.js'
import { safeParseJSON } from '../json.js'
import { logError } from '../log.js'
import { appendStreamingTextDelta } from '../streamingTextStore.js'
import { coerceNestedStringifiedToolInput } from '../toolInputNestedStringCoerce.js'
import { repairDoubleEscapedUnicode } from '../toolInputUnicodeRepair.js'

/**
 * densable 2.1.234 #9 / SEA `KKn` — heal malformed content blocks from
 * non-streaming fallback (and stream materialization) so missing `text` /
 * `thinking`/`signature` from third-party gateways cannot crash the turn.
 */
export type NormalizeContentFromAPIMeta = {
  requestId?: string
  messageId?: string
}

// Sometimes the API returns empty messages (eg. "\n\n"). We need to filter these out,
// otherwise they will give an API error when we send them to the API next time we call query().
export const UNPARSED_TOOL_INPUT_KEY = '__unparsedToolInput'

export function isUnparsedToolInput(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const entries = Object.entries(value)
  if (entries.length !== 1) return false
  const [key, val] = entries[0]!
  return (
    key === UNPARSED_TOOL_INPUT_KEY &&
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Record<string, unknown>).raw === 'string' &&
    typeof (val as Record<string, unknown>).len === 'number'
  )
}

export function describeUnparsedToolInput(value: unknown): string | null {
  if (!isUnparsedToolInput(value)) return null
  const entry = (value as Record<string, { raw: string; len: number }>)[
    UNPARSED_TOOL_INPUT_KEY
  ]!
  return `input JSON failed to parse — ${entry.len} bytes`
}

function makeUnparsedToolInput(raw: string): Record<string, unknown> {
  return {
    [UNPARSED_TOOL_INPUT_KEY]: {
      raw: raw.slice(0, 2048),
      len: raw.length,
    },
  }
}

export function normalizeContentFromAPI(
  contentBlocks: BetaMessage['content'],
  tools: Tools,
  agentId?: AgentId,
  meta?: NormalizeContentFromAPIMeta,
): BetaMessage['content'] {
  if (!contentBlocks) {
    return []
  }
  const requestIdUnknown = (meta?.requestId ??
    'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const messageIdUnknown = (meta?.messageId ??
    'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  return contentBlocks.flatMap((contentBlock): BetaMessage['content'] => {
    switch (contentBlock.type) {
      case 'tool_use': {
        if (
          typeof contentBlock.input !== 'string' &&
          !isObject(contentBlock.input)
        ) {
          // we stream tool use inputs as strings, but when we fall back, they're objects
          throw new Error('Tool use input must be a string or object')
        }

        // With fine-grained streaming on, we are getting a stringied JSON back from the API.
        // The API has strange behaviour, where it returns nested stringified JSONs, and so
        // we need to recursively parse these. If the top-level value returned from the API is
        // an empty string, this should become an empty object (nested values should be empty string).
        // TODO: This needs patching as recursive fields can still be stringified
        let normalizedInput: unknown
        if (typeof contentBlock.input === 'string') {
          const parsed = safeParseJSON(contentBlock.input)
          if (
            parsed === null &&
            contentBlock.input.trim() !== 'null' &&
            contentBlock.input.length > 0
          ) {
            // TET/FC-v3 diagnostic: the streamed tool input JSON failed to
            // parse. We fall back to {} which means downstream validation
            // sees empty input. The raw prefix goes to debug log only — no
            // PII-tagged proto column exists for it yet.
            // densable KKn also attaches request_id/messageID when available.
            logEvent('tengu_tool_input_json_parse_fail', {
              toolName: sanitizeToolNameForAnalytics(contentBlock.name),
              inputLen: contentBlock.input.length,
              request_id: requestIdUnknown,
              messageID: messageIdUnknown,
            })
            if (process.env.USER_TYPE === 'ant') {
              logForDebugging(
                `tool input JSON parse fail: ${contentBlock.input.slice(0, 200)}`,
                { level: 'warn' },
              )
            }
            normalizedInput = makeUnparsedToolInput(contentBlock.input)
          } else {
            normalizedInput = parsed ?? {}
          }
        } else {
          normalizedInput = contentBlock.input
        }

        // densable Owe: qPy/V5s → jYd/$zr → UYd/Ozr. Arrays skip (SEA !W9).
        // Empty / meta-only JSON Schema properties coerce as "any" so MCP
        // tools that advertise `{}` receive real objects instead of strings.
        if (
          typeof normalizedInput === 'object' &&
          normalizedInput !== null &&
          !Array.isArray(normalizedInput) &&
          !isUnparsedToolInput(normalizedInput)
        ) {
          const tool = findToolByName(tools, contentBlock.name)
          if (tool) {
            try {
              const coerced = coerceNestedStringifiedToolInput(
                normalizedInput as { [key: string]: unknown },
                tool.inputSchema,
                tool.inputJSONSchema,
              )
              const repaired = repairDoubleEscapedUnicode(coerced) as {
                [key: string]: unknown
              }
              normalizedInput = normalizeToolInput(tool, repaired, agentId)
            } catch (error) {
              logError(
                new Error(
                  `Error normalizing tool input (requestId=${meta?.requestId ?? 'unknown'}, messageId=${meta?.messageId ?? 'unknown'}): ${error}`,
                ),
              )
              // Keep the original input if normalization fails
            }
          }
        }

        return [
          {
            ...contentBlock,
            input: normalizedInput,
          },
        ]
      }
      case 'text':
        // densable KKn: drop non-string text (third-party gateways) instead of crashing
        if (typeof contentBlock.text !== 'string') {
          logEvent('tengu_content_block_healed', {
            blockType:
              'text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            action:
              'dropped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            missingText: true,
            request_id: requestIdUnknown,
            messageID: messageIdUnknown,
          })
          return []
        }
        if (contentBlock.text.trim().length === 0) {
          logEvent('tengu_model_whitespace_response', {
            length: contentBlock.text.length,
            request_id: requestIdUnknown,
            messageID: messageIdUnknown,
          })
        }
        // Return the block as-is to preserve exact content for prompt caching.
        // Empty text blocks are handled at the display layer and must not be
        // altered here.
        return [contentBlock]
      case 'thinking': {
        // densable KKn: heal missing thinking/signature rather than throw later
        const hasThinking = typeof contentBlock.thinking === 'string'
        const hasSignature = typeof contentBlock.signature === 'string'
        if (hasThinking && hasSignature) {
          return [contentBlock]
        }
        logEvent('tengu_content_block_healed', {
          blockType:
            'thinking' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          action:
            'healed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          missingThinking: !hasThinking,
          missingSignature: !hasSignature,
          request_id: requestIdUnknown,
          messageID: messageIdUnknown,
        })
        return [
          {
            ...contentBlock,
            thinking: hasThinking ? contentBlock.thinking : '',
            signature: hasSignature ? contentBlock.signature : '',
          },
        ]
      }
      case 'code_execution_tool_result':
      case 'mcp_tool_use':
      case 'mcp_tool_result':
      case 'container_upload':
        // Beta-specific content blocks - pass through as-is
        return [contentBlock]
      case 'server_tool_use':
        if (typeof contentBlock.input === 'string') {
          return [
            {
              ...contentBlock,
              input: (safeParseJSON(contentBlock.input) ?? {}) as {
                [key: string]: unknown
              },
            },
          ]
        }
        return [contentBlock]
      default:
        return [contentBlock]
    }
  })
}

/**
 * 2.1.282 `Pet` — a landed thinking block is narration when its signature
 * decodes to the tag "narration" and the thinking text is non-empty.
 * Stream handling clears the live thinking row for that case instead of
 * leaving an ended timestamp.
 */
export function isNarrationThinkingBlock(block: {
  type?: string
  thinking?: string
  signature?: string
}): boolean {
  if (!block.thinking?.trim()) return false
  return thinkingSignatureTag(block) === 'narration'
}

function thinkingSignatureTag(block: {
  type?: string
  signature?: string
}): string | undefined {
  try {
    if (block.type !== 'thinking' || !block.signature) return undefined
    const decoded = decodeSignatureTag(block.signature)
    return decoded
  } catch {
    return undefined
  }
}

/** 2.1.282 `FEt`: base64 → field 2 bytes → field 1 bytes → field 8 utf8. */
function decodeSignatureTag(signature: string): string | undefined {
  let binary: string
  try {
    binary = atob(signature)
  } catch {
    return undefined
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const field2 = protobufBytesField(bytes, 2)
  if (field2 === undefined) return undefined
  const field1 = protobufBytesField(field2, 1)
  if (field1 === undefined) return undefined
  return protobufUtf8Field(field1, 8)
}

function protobufBytesField(
  bytes: Uint8Array,
  field: number,
): Uint8Array | undefined {
  return walkProtobuf(bytes, field, 'bytes')
}

function protobufUtf8Field(
  bytes: Uint8Array,
  field: number,
): string | undefined {
  const value = walkProtobuf(bytes, field, 'bytes')
  if (value === undefined) return undefined
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(value)
}

function walkProtobuf(
  bytes: Uint8Array,
  field: number,
  want: 'bytes',
): Uint8Array | undefined {
  let found: Uint8Array | undefined
  let offset = 0
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset)
    if (key === undefined) return undefined
    const wire = key.value & 7
    const number = Math.floor(key.value / 8)
    offset = key.next
    if (wire === 2) {
      const len = readVarint(bytes, offset)
      if (len === undefined || len.value > bytes.length - len.next)
        return undefined
      const start = len.next
      const end = start + len.value
      if (number === field) found = bytes.subarray(start, end)
      offset = end
      continue
    }
    if (wire === 0) {
      const v = readVarint(bytes, offset)
      if (v === undefined) return undefined
      offset = v.next
      continue
    }
    if (wire === 1) {
      if (offset + 8 > bytes.length) return undefined
      offset += 8
      continue
    }
    if (wire === 5) {
      if (offset + 4 > bytes.length) return undefined
      offset += 4
      continue
    }
    return undefined
  }
  return want === 'bytes' ? found : undefined
}

function readVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | undefined {
  let value = 0
  let mul = 1
  for (let i = 0; i < 10; i++) {
    const at = offset + i
    if (at >= bytes.length) return undefined
    const byte = bytes[at]!
    value += (byte & 127) * mul
    if ((byte & 128) === 0) return { value, next: at + 1 }
    mul *= 128
  }
  return undefined
}

export type StreamingToolUse = {
  index: number
  contentBlock: BetaToolUseBlock
  unparsedToolInput: string
}

export type StreamingThinking = {
  thinking: string
  isStreaming: boolean
  streamingEndedAt?: number
}

/**
 * densable qQs onApiMetrics lifecycle (start / thinking_progress / end).
 * Legacy `{ ttftMs }` still accepted for call sites that only track TTFT.
 */
export type StreamApiMetricsEvent =
  | { type: 'start'; ttftMs: number; messageId?: string }
  | { type: 'content_block_start' }
  | { type: 'thinking_progress'; estimatedTokensDelta: number }
  | { type: 'thinking_signature'; chars: number }
  | { type: 'end'; outputTokens: number }
  | { ttftMs: number; messageId?: string }

/**
 * Handles messages from a stream, updating response length for deltas and appending completed messages
 */
export type StreamMessageDisplayTransform = {
  begin: (apiMessageId: string) => void
  delta: (text: string) => void
  entryLanded: (message: AssistantMessage) => void
  finalize: () => void
}

/** densable QueryEvent refusal_continuation (yEt onRefusalContinuation) */
export type RefusalContinuationStreamEvent = {
  type: 'refusal_continuation'
  phase: 'begin' | 'end'
  salvageText?: string
  join?: 'exact' | 'soft'
  replacesUuids?: string[]
}

/**
 * densable yEt control-bus handlers (non-stream_event fan-out).
 * Callbacks are optional; unhandled control types are dropped (not onMessage).
 */
export type StreamYEtHandlers = {
  onNotification?: (notification: unknown) => void
  onExpandedView?: (expandedView: unknown) => void
  onPostTurnSummary?: (value: unknown) => void
  onActiveGoal?: (value: unknown) => void
  onInProgressToolUseIDs?: (op: {
    action?: string
    ids?: string[]
    [k: string]: unknown
  }) => void
  onConversationReset?: (newConversationId: string) => void
  onHintClears?: (event: unknown) => void
  onInterruptibleToolInProgress?: (inProgress: boolean) => void
  onOSNotification?: (event: unknown) => void
  onCommandLifecycle?: (uuid: string, state: string) => void
}

/** densable Ula — estimate tokens from thinking text when API omits estimated_tokens */
export function estimateThinkingTokensFromText(text: string): number {
  return Math.ceil(text.length / 4)
}

/** densable gmn — signature char weight for thinking_signature metrics */
export function thinkingSignatureMetricChars(length: number): number {
  return Math.round(length * 0.75)
}

/** densable ATb — output_tokens from message_delta event */
export function extractMessageDeltaOutputTokens(event: unknown): number | null {
  if (typeof event !== 'object' || event === null) return null
  const usage = (event as { usage?: { output_tokens?: unknown } }).usage
  const n = usage?.output_tokens
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * densable yEt control types that must not fall through to onMessage.
 * (refusal_continuation / tombstone / tool_use_summary handled separately.)
 */
const YET_CONTROL_TYPES = new Set([
  'notification',
  'set_expanded_view',
  'post_turn_summary',
  'active_goal',
  'set_in_progress_tool_use_ids',
  'conversation_reset',
  'hint_clears',
  'query_model_change',
  'interruptible_tool_in_progress',
  'api_metrics',
  'os_notification',
  'open_message_selector',
  'apply_flag_settings',
  'command_lifecycle',
  // densable query-level control events that may reach the consumer
  'server_fallback',
  'refusal_no_fallback',
  'fallback_request',
  'spinner_mode',
])

/**
 * Gold ff: live ● preview is text only. Keyed by onStreamingText so a
 * background subagent stream cannot clobber the REPL preview bag.
 * Thinking-as-text_delta (proxy / OpenAI-compat) must not first-paint 字.
 */
const openStreamPreviewBlock = new WeakMap<
  (f: (current: string | null) => string | null) => void,
  string
>()

function setOpenStreamPreviewBlock(
  onStreamingText:
    | ((f: (current: string | null) => string | null) => void)
    | undefined,
  type: string | undefined,
): void {
  if (!onStreamingText) return
  if (type === undefined) openStreamPreviewBlock.delete(onStreamingText)
  else openStreamPreviewBlock.set(onStreamingText, type)
}

function isOpenThinkingPreviewBlock(
  onStreamingText:
    | ((f: (current: string | null) => string | null) => void)
    | undefined,
): boolean {
  if (!onStreamingText) return false
  const t = openStreamPreviewBlock.get(onStreamingText)
  return t === 'thinking' || t === 'redacted_thinking'
}

export function handleMessageFromStream(
  message:
    | Message
    | TombstoneMessage
    | StreamEvent
    | RequestStartEvent
    | ToolUseSummaryMessage
    | RefusalContinuationStreamEvent
    | { type: string; [k: string]: unknown },
  onMessage: (message: Message) => void,
  /** densable onUpdateLength — char count delta (not the string itself) */
  onUpdateLength: (deltaChars: number) => void,
  onSetStreamMode: (mode: SpinnerMode) => void,
  onStreamingToolUses: (
    f: (streamingToolUse: StreamingToolUse[]) => StreamingToolUse[],
  ) => void,
  onTombstone?: (message: Message) => void,
  onStreamingThinking?: (
    f: (current: StreamingThinking | null) => StreamingThinking | null,
  ) => void,
  onApiMetrics?: (metrics: StreamApiMetricsEvent) => void,
  onStreamingText?: (f: (current: string | null) => string | null) => void,
  /** densable displayTransform (wth) — MessageDisplay hook pipeline */
  displayTransform?: StreamMessageDisplayTransform,
  /** densable yEt onRefusalContinuation → setSalvage + hG */
  onRefusalContinuation?: (event: RefusalContinuationStreamEvent) => void,
  /** densable r — subagent flag for message_delta usage-missing telemetry */
  streamContext?: { isSubagent?: boolean },
  /** densable yEt remaining control-surface callbacks */
  yEtHandlers?: StreamYEtHandlers,
  /** densable `authoringProgressSurface` — REPL FLr V. */
  authoringProgressSurface?: boolean,
): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const workshop =
    authoringProgressSurface === true
      ? (require('../../services/artifactAutoReact/authoringProgress.js') as typeof import('../../services/artifactAutoReact/authoringProgress.js'))
      : undefined
  /* eslint-enable @typescript-eslint/no-require-imports */
  if (
    message.type !== 'stream_event' &&
    message.type !== 'stream_request_start'
  ) {
    // densable yEt: refusal_continuation is control-only (not added to messages)
    if (message.type === 'refusal_continuation') {
      onRefusalContinuation?.(message as RefusalContinuationStreamEvent)
      return
    }
    // Handle tombstone messages - remove the targeted message instead of adding
    if (message.type === 'tombstone') {
      onTombstone?.((message as TombstoneMessage).message as unknown as Message)
      return
    }
    // Tool use summary messages are SDK-only, ignore them in stream handling
    if (message.type === 'tool_use_summary') {
      return
    }
    // densable yEt control bus (before assistant / onMessage fallthrough)
    if (YET_CONTROL_TYPES.has(message.type)) {
      const m = message as { type: string; [k: string]: unknown }
      switch (m.type) {
        case 'notification':
          yEtHandlers?.onNotification?.(m.notification)
          return
        case 'set_expanded_view':
          yEtHandlers?.onExpandedView?.(m.expandedView)
          return
        case 'post_turn_summary':
          yEtHandlers?.onPostTurnSummary?.(m.value)
          return
        case 'active_goal':
          yEtHandlers?.onActiveGoal?.(m.value)
          return
        case 'set_in_progress_tool_use_ids':
          yEtHandlers?.onInProgressToolUseIDs?.(
            (m.op ?? {}) as {
              action?: string
              ids?: string[]
              [k: string]: unknown
            },
          )
          return
        case 'conversation_reset':
          if (typeof m.newConversationId === 'string') {
            yEtHandlers?.onConversationReset?.(m.newConversationId)
          }
          return
        case 'hint_clears':
          yEtHandlers?.onHintClears?.(m)
          return
        case 'query_model_change':
          // densable: return without fan-out
          return
        case 'interruptible_tool_in_progress':
          yEtHandlers?.onInterruptibleToolInProgress?.(m.inProgress === true)
          return
        case 'api_metrics':
          // densable yEt: i?.(e.event) — reuse onApiMetrics
          if (m.event !== undefined) {
            onApiMetrics?.(m.event as StreamApiMetricsEvent)
          }
          return
        case 'os_notification':
          yEtHandlers?.onOSNotification?.(m)
          return
        case 'open_message_selector':
        case 'apply_flag_settings':
          return
        case 'command_lifecycle':
          if (typeof m.uuid === 'string' && typeof m.state === 'string') {
            yEtHandlers?.onCommandLifecycle?.(m.uuid, m.state)
          }
          return
        case 'server_fallback':
        case 'refusal_no_fallback':
        case 'fallback_request':
          // query-level events normally consumed before handleMessageFromStream;
          // if they leak, drop (do not onMessage)
          return
        case 'spinner_mode':
          if (typeof m.mode === 'string') {
            onSetStreamMode(m.mode as SpinnerMode)
          }
          return
        default:
          return
      }
    }
    setOpenStreamPreviewBlock(onStreamingText, undefined)
    // Capture complete thinking blocks for real-time display in transcript mode
    if (message.type === 'assistant') {
      const assistMsg = message as Message
      const contentArr = Array.isArray(assistMsg.message?.content)
        ? assistMsg.message.content
        : []
      const thinkingBlock = contentArr.find(
        block => typeof block !== 'string' && block.type === 'thinking',
      )
      if (
        thinkingBlock &&
        typeof thinkingBlock !== 'string' &&
        thinkingBlock.type === 'thinking'
      ) {
        const tb = thinkingBlock as ThinkingBlock
        // 2.1.282 Pet: narration clears the live row; otherwise stamp ended.
        if (isNarrationThinkingBlock(tb)) {
          onStreamingThinking?.(() => null)
        } else {
          onStreamingThinking?.(() => ({
            thinking: tb.thinking,
            isStreaming: false,
            streamingEndedAt: Date.now(),
          }))
        }
      }
      // densable yEt: displayTransform.entryLanded before clear + onMessage
      displayTransform?.entryLanded(message as AssistantMessage)
    }
    // Clear streaming text NOW so the render can switch displayedMessages
    // from deferredMessages to messages in the same batch, making the
    // transition from streaming text → final message atomic (no gap, no duplication).
    onStreamingText?.(() => null)
    onMessage(message as Message)
    return
  }

  if (message.type === 'stream_request_start') {
    onSetStreamMode('requesting')
    setOpenStreamPreviewBlock(onStreamingText, undefined)
    return
  }

  // At this point, message is a stream event with an `event` property
  const streamMsg = message as {
    type: string
    event: {
      type: string
      content_block: {
        type: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }
      index: number
      delta: {
        type: string
        text: string
        partial_json: string
        thinking: string
      }
      [key: string]: unknown
    }
    ttftMs?: number
    [key: string]: unknown
  }

  // 2.1.282 Koe: a ping event does not move the spinner.
  if (streamMsg.event.type === 'ping') return

  if (streamMsg.event.type === 'message_start') {
    if (streamMsg.ttftMs != null) {
      const msgId = (
        streamMsg.event as {
          message?: { id?: string }
        }
      ).message?.id
      // densable qQs: onApiMetrics({type:"start", ttftMs, messageId})
      onApiMetrics?.({
        type: 'start',
        ttftMs: streamMsg.ttftMs,
        ...(msgId ? { messageId: msgId } : {}),
      })
    }
    // densable qQs: clear tool list only when non-empty
    onStreamingToolUses(d => (d.length > 0 ? [] : d))
    workshop?.resetAuthoringProgress()
    // densable qQs: clear streaming text only when non-null (avoid no-op churn)
    onStreamingText?.(d => (d !== null ? null : d))
    setOpenStreamPreviewBlock(onStreamingText, undefined)
    // densable qQs: displayTransform.begin(message.id)
    const msgId = (
      streamMsg.event as {
        message?: { id?: string }
      }
    ).message?.id
    if (msgId) displayTransform?.begin(msgId)
  }

  if (streamMsg.event.type === 'message_stop') {
    // densable qQs: finalize before mode flip
    displayTransform?.finalize()
    onSetStreamMode('tool-use')
    onStreamingToolUses(() => [])
    workshop?.resetAuthoringProgress()
    setOpenStreamPreviewBlock(onStreamingText, undefined)
    return
  }

  switch (streamMsg.event.type) {
    case 'content_block_start':
      // densable qQs: content_block_start metrics + clear streaming text
      onApiMetrics?.({ type: 'content_block_start' })
      onStreamingText?.(() => null)
      setOpenStreamPreviewBlock(
        onStreamingText,
        streamMsg.event.content_block.type,
      )
      if (
        feature('CONNECTOR_TEXT') &&
        isConnectorTextBlock(streamMsg.event.content_block)
      ) {
        onSetStreamMode('responding')
        return
      }
      switch (streamMsg.event.content_block.type) {
        case 'thinking':
        case 'redacted_thinking':
          onSetStreamMode('thinking')
          return
        case 'text':
          onSetStreamMode('responding')
          return
        case 'tool_use': {
          // densable qQs: CTb=32768 size gate, TTb=256 cap, same-index replace
          onSetStreamMode('tool-input')
          const contentBlock = streamMsg.event.content_block as BetaToolUseBlock
          const index = streamMsg.event.index
          try {
            if (JSON.stringify(contentBlock).length > 32768) return
          } catch {
            return
          }
          if (typeof contentBlock.name !== 'string') return
          onStreamingToolUses(_ => {
            const existing = _.findIndex(t => t.index === index)
            // 2.1.282 replaces the same index with the new block as-is.
            const next = {
              index,
              contentBlock,
              unparsedToolInput: '',
            }
            if (existing !== -1) {
              const copy = _.slice()
              copy[existing] = next
              return copy
            }
            if (_.length >= 256) return _
            return [..._, next]
          })
          workshop?.onToolUseStart(index, contentBlock.name)
          return
        }
        case 'server_tool_use':
        case 'web_search_tool_result':
        case 'code_execution_tool_result':
        case 'mcp_tool_use':
        case 'mcp_tool_result':
        case 'container_upload':
        case 'web_fetch_tool_result':
        case 'bash_code_execution_tool_result':
        case 'text_editor_code_execution_tool_result':
        case 'tool_search_tool_result':
        case 'compaction':
          onSetStreamMode('tool-input')
          return
      }
      return
    case 'content_block_delta':
      switch (streamMsg.event.delta.type) {
        case 'text_delta': {
          const deltaText = streamMsg.event.delta.text
          // densable qQs: onUpdateLength(d.length) — char count, not string
          onUpdateLength(deltaText.length)
          // Gold ff: thinking never feeds the live ● preview. Proxies that
          // emit thinking as text_delta after content_block_start(thinking)
          // would first-paint 字 then collapse to Thought for.
          if (isOpenThinkingPreviewBlock(onStreamingText)) {
            return
          }
          // densable MLp=1e6 — appendStreamingTextDelta
          onStreamingText?.(text => appendStreamingTextDelta(text, deltaText))
          // densable qQs: displayTransform.delta
          displayTransform?.delta(deltaText)
          return
        }
        case 'input_json_delta': {
          // 2.1.282: length only. Partial JSON is not accumulated here.
          const delta = streamMsg.event.delta.partial_json
          onUpdateLength(delta.length)
          workshop?.onInputJsonDelta(streamMsg.event.index, delta)
          return
        }
        case 'thinking_delta': {
          // densable qQs: never onUpdateLength; thinking_progress via onApiMetrics
          const d = streamMsg.event.delta as {
            type: string
            estimated_tokens?: unknown
            thinking?: unknown
          }
          if (
            'estimated_tokens' in d &&
            typeof d.estimated_tokens === 'number'
          ) {
            onApiMetrics?.({
              type: 'thinking_progress',
              estimatedTokensDelta: d.estimated_tokens,
            })
          } else if (
            'thinking' in d &&
            typeof d.thinking === 'string' &&
            d.thinking.length > 0
          ) {
            onApiMetrics?.({
              type: 'thinking_progress',
              estimatedTokensDelta: estimateThinkingTokensFromText(d.thinking),
            })
          }
          return
        }
        case 'signature_delta': {
          // densable: thinking_signature metrics only; never onUpdateLength
          const sig = (streamMsg.event.delta as { signature?: string })
            .signature
          if (typeof sig === 'string') {
            onApiMetrics?.({
              type: 'thinking_signature',
              chars: thinkingSignatureMetricChars(sig.length),
            })
          }
          return
        }
        default:
          return
      }
    case 'content_block_stop':
      workshop?.onToolUseStop(streamMsg.event.index)
      return
    case 'message_delta': {
      onSetStreamMode('responding')
      // densable ATb → onApiMetrics({type:"end", outputTokens})
      const outputTokens = extractMessageDeltaOutputTokens(streamMsg.event)
      if (outputTokens != null) {
        onApiMetrics?.({ type: 'end', outputTokens })
      } else {
        logEvent('tengu_message_delta_usage_missing', {
          is_subagent: streamContext?.isSubagent === true,
        })
      }
      return
    }
    default:
      onSetStreamMode('responding')
      return
  }
}
