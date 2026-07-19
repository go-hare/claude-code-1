// Core message types for the model provider package.
// Moved from src/types/message.ts to decouple the API layer from the main project.

import type { UUID } from 'crypto'
import type {
  ContentBlockParam,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * Base message type with discriminant `type` field and common properties.
 * Individual message subtypes (UserMessage, AssistantMessage, etc.) extend
 * this with narrower `type` literals and additional fields.
 */
export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'progress'
  | 'grouped_tool_use'
  | 'collapsed_read_search'

/** A single content element inside message.content arrays. */
export type ContentItem = ContentBlockParam | ContentBlock

export type MessageContent = string | ContentBlockParam[] | ContentBlock[]

/**
 * Typed content array — used in narrowed message subtypes so that
 * `message.content[0]` resolves to `ContentItem` instead of
 * `string | ContentBlockParam | ContentBlock`.
 */
export type TypedMessageContent = ContentItem[]

export type Message = {
  type: MessageType
  uuid: UUID
  isMeta?: boolean
  isCompactSummary?: boolean
  toolUseResult?: unknown
  isVisibleInTranscriptOnly?: boolean
  attachment?: {
    type: string
    toolUseID?: string
    [key: string]: unknown
    addedNames: string[]
    addedLines: string[]
    removedNames: string[]
  }
  message?: {
    role?: string
    id?: string
    content?: MessageContent
    usage?: BetaUsage | Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type AssistantMessage = Message & {
  type: 'assistant'
  message: NonNullable<Message['message']>
}
export type AttachmentMessage<T = { type: string; [key: string]: unknown }> =
  Message & { type: 'attachment'; attachment: T }
export type ProgressMessage<T = unknown> = Message & {
  type: 'progress'
  data: T
}
export type SystemLocalCommandMessage = Message & { type: 'system' }
export type SystemMessage = Message & { type: 'system' }
export type UserMessage = Message & {
  type: 'user'
  message: NonNullable<Message['message']>
  imagePasteIds?: number[]
  /**
   * densable toolEndsTurn — tool result requests end-of-turn (no model re-invoke).
   * Never sent to the model; query loop only.
   */
  toolEndsTurn?: boolean
  /**
   * densable mcpMeta — MCP protocol metadata (incl. claude/endTurn) for SDK /
   * end-turn detection. Never sent to the model.
   */
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  /**
   * densable toolDenialKind — why a tool_result was denied (user-rejected,
   * permission-rule, automode-*). Never sent to the model.
   */
  toolDenialKind?:
    | 'user-rejected'
    | 'permission-rule'
    | 'automode-blocked'
    | 'automode-unavailable'
    | 'automode-parsing-error'
  /**
   * densable classifierMetaLines — auto-mode classifier meta (repoVisibility /
   * gitStatus) associated with a single tool_result. Never sent to the model;
   * re-injected into later classifier transcripts before the matching tool_use.
   */
  classifierMetaLines?: string
  /**
   * densable interruptedMessageId — API assistant message id that was in-flight
   * when the user cancelled (user-cancel / remote-cancel). Stamped by dye/Nr
   * via gzr(b_t). Never sent to the model.
   */
  interruptedMessageId?: string
  /**
   * densable promptSource (Nr) — how this user turn was produced
   * (sdk / system / typed / queued / suggestion_accepted). Never sent to the model.
   */
  promptSource?: string
}
export type NormalizedUserMessage = UserMessage
export type RequestStartEvent = { type: string; [key: string]: unknown }
export type StreamEvent = { type: string; [key: string]: unknown }
export type SystemCompactBoundaryMessage = Message & {
  type: 'system'
  compactMetadata: {
    preservedSegment?: {
      headUuid: UUID
      tailUuid: UUID
      anchorUuid: UUID
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}
export type TombstoneMessage = Message
export type ToolUseSummaryMessage = Message
export type MessageOrigin = string
export type CompactMetadata = Record<string, unknown>
export type SystemAPIErrorMessage = Message & { type: 'system' }
export type SystemFileSnapshotMessage = Message & { type: 'system' }
export type NormalizedAssistantMessage<T = unknown> = AssistantMessage
export type NormalizedMessage = Message
export type PartialCompactDirection = string

export type StopHookInfo = {
  command?: string
  durationMs?: number
  [key: string]: unknown
}

export type SystemAgentsKilledMessage = Message & { type: 'system' }
export type SystemApiMetricsMessage = Message & { type: 'system' }
export type SystemAwaySummaryMessage = Message & { type: 'system' }
export type SystemBridgeStatusMessage = Message & { type: 'system' }
export type SystemInformationalMessage = Message & { type: 'system' }
export type SystemMemorySavedMessage = Message & { type: 'system' }
export type SystemMessageLevel = string
export type SystemMicrocompactBoundaryMessage = Message & { type: 'system' }
export type SystemPermissionRetryMessage = Message & { type: 'system' }
export type SystemScheduledTaskFireMessage = Message & { type: 'system' }

export type SystemStopHookSummaryMessage = Message & {
  type: 'system'
  subtype: string
  hookLabel: string
  hookCount: number
  totalDurationMs?: number
  hookInfos: StopHookInfo[]
}

export type SystemTurnDurationMessage = Message & { type: 'system' }

export type GroupedToolUseMessage = Message & {
  type: 'grouped_tool_use'
  toolName: string
  messages: NormalizedAssistantMessage[]
  results: NormalizedUserMessage[]
  displayMessage: NormalizedAssistantMessage | NormalizedUserMessage
}

// CollapsibleMessage is used by the main project's CollapsedReadSearchGroup
export type CollapsibleMessage =
  | AssistantMessage
  | UserMessage
  | GroupedToolUseMessage

export type HookResultMessage = Message
export type SystemThinkingMessage = Message & { type: 'system' }
