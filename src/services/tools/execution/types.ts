/**
 * Shared types, symbols, constants, and tiny pure helpers for tool execution.
 */

import type { HookProgress } from '../../../types/hooks.js'
import type { Message, ProgressMessage } from '../../../types/message.js'
import type {
  ToolProgress,
  ToolProgressData,
  ToolUseContext,
} from '../../../Tool.js'

export const RUN_TOOL_USE_HANDLES_DETACH: unique symbol = Symbol.for(
  'claude.runToolUseHandlesDetach',
)

/** Minimum total hook duration (ms) to show inline timing summary */
export const HOOK_TIMING_DISPLAY_THRESHOLD_MS = 500

/**
 * Log a debug warning when hooks/permission-decision block for this long.
 * Matches BashTool's PROGRESS_THRESHOLD_MS — the collapsed view feels stuck past this.
 */
export const SLOW_PHASE_LOG_THRESHOLD_MS = 2000

/** Official 2.1.328 `xMe` — pre-call skipped message after `permission-stop`. */
export const PERMISSION_STOP_SKIPPED_MESSAGE =
  '[Tool call skipped: the turn was stopped before this call ran, by the check whose denial is on another call in this batch. Nothing refused this call and it had no effects; re-run it if still needed.]'

export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
  /** #1894: Context/permission layers emitted by tools (consumed by StreamingToolExecutor). */
  contextLayers?: {
    toolUseID: string
    layers: NonNullable<ToolUseContext['permissionLayers']>
  }
  toolDuration?: {
    toolName: string
    durationMs: number
  }
}

/**
 * densable `jR` @184467129 — `"type" in e`. Tool onProgress may enqueue a
 * control event (`set_expanded_view`, `set_in_progress_tool_use_ids`) that is
 * not a `{message}` update. Gold `ve`: `if(ze.type!=="progress") ye.enqueue(ze)`.
 */
export type ToolBridgeEvent = {
  type: string
  [key: string]: unknown
}

const TOOL_BRIDGE_TYPES = new Set([
  'set_expanded_view',
  'set_in_progress_tool_use_ids',
])

export function isToolBridgeEvent(update: object): update is ToolBridgeEvent {
  if (!('type' in update) || 'message' in update) return false
  const type = (update as { type: unknown }).type
  return typeof type === 'string' && TOOL_BRIDGE_TYPES.has(type)
}

export type OnToolProgressFn = (
  progress:
    | ToolProgress<ToolProgressData>
    | ProgressMessage<HookProgress>
    | ToolBridgeEvent,
) => void

export type McpServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sdk'
  | 'sse-ide'
  | 'ws-ide'
  | 'claudeai-proxy'
  | undefined

export type ToolDenialKind =
  | 'user-rejected'
  | 'permission-rule'
  | 'cancelled'
  | 'interrupted'
  | 'automode-blocked'
  | 'automode-unavailable'
  | 'automode-parsing-error'

export type NotLoadedMcpToolFamily =
  | 'browser'
  | 'computer_use'
  | 'simulator'
  | 'linked_computer'
  | 'plugin'

export type ToolCallCoreCapture = {
  output?: { value: unknown }
  synthesizedOutput?: { value: unknown }
  hookSynthesized?: {
    rawResult: unknown
    rawText: string | undefined
    priorRun: { messages: MessageUpdateLazy[] } | undefined
    undelivered: MessageUpdateLazy[]
  }
  lastCoreInput?: Record<string, unknown>
  detached?: boolean
  durationMs?: number
  isReadOnly?: boolean
  /** densable DVt `e.deny` — tool.call wrap deny, not permission Error:. */
  deny?: string
  /** densable Iyo `rL(e.context)` */
  context?: string[]
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isEmptyRecord(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
}

export function getNextImagePasteId(messages: Message[]): number {
  let maxId = 0
  for (const message of messages) {
    if (message.type === 'user' && message.imagePasteIds) {
      for (const id of message.imagePasteIds as number[]) {
        if (id > maxId) maxId = id
      }
    }
  }
  return maxId + 1
}
