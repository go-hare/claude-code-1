/**
 * UI message reordering, hook attachment tracking, tool-use/tool-result ID extraction, and incremental MessageLookups indexing.
 */

import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import { count } from '../array.js'
import type {
  HookAttachment,
  HookPermissionDecisionAttachment,
} from '../attachments.js'

// Hook attachments that have a hookName field (excludes HookPermissionDecisionAttachment)
type HookAttachmentWithName = Exclude<
  HookAttachment,
  HookPermissionDecisionAttachment
>

type ToolUseRequestMessage = NormalizedAssistantMessage & {
  message: { content: [ToolUseBlock] }
}

export function isToolUseRequestMessage(
  message: Message,
): message is ToolUseRequestMessage {
  return (
    message.type === 'assistant' &&
    // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
    Array.isArray(message.message?.content) &&
    (message.message?.content as Array<{ type: string }>).some(
      _ => _.type === 'tool_use',
    )
  )
}

type ToolUseResultMessage = NormalizedUserMessage & {
  message: { content: [ToolResultBlockParam] }
}

export function isToolUseResultMessage(
  message: Message,
): message is ToolUseResultMessage {
  return (
    message.type === 'user' &&
    ((Array.isArray(message.message?.content) &&
      (message.message?.content as Array<{ type: string }>)[0]?.type ===
        'tool_result') ||
      Boolean(message.toolUseResult))
  )
}

// Re-order, to move result messages to be after their tool use messages
export function reorderMessagesInUI(
  messages: (
    | NormalizedUserMessage
    | NormalizedAssistantMessage
    | AttachmentMessage
    | SystemMessage
  )[],
  syntheticStreamingToolUseMessages: NormalizedAssistantMessage[],
): (
  | NormalizedUserMessage
  | NormalizedAssistantMessage
  | AttachmentMessage
  | SystemMessage
)[] {
  // Maps tool use ID to its related messages
  const toolUseGroups = new Map<
    string,
    {
      toolUse: ToolUseRequestMessage | null
      preHooks: AttachmentMessage[]
      toolResult: NormalizedUserMessage | null
      postHooks: AttachmentMessage[]
    }
  >()

  // First pass: group messages by tool use ID
  for (const message of messages) {
    // Handle tool use messages
    if (isToolUseRequestMessage(message)) {
      const toolUseID = message.message.content[0]?.id
      if (toolUseID) {
        if (!toolUseGroups.has(toolUseID)) {
          toolUseGroups.set(toolUseID, {
            toolUse: null,
            preHooks: [],
            toolResult: null,
            postHooks: [],
          })
        }
        toolUseGroups.get(toolUseID)!.toolUse = message
      }
      continue
    }

    // Handle pre-tool-use hooks
    if (
      isHookAttachmentMessage(message) &&
      message.attachment.hookEvent === 'PreToolUse'
    ) {
      const toolUseID = message.attachment.toolUseID
      if (!toolUseGroups.has(toolUseID)) {
        toolUseGroups.set(toolUseID, {
          toolUse: null,
          preHooks: [],
          toolResult: null,
          postHooks: [],
        })
      }
      toolUseGroups.get(toolUseID)!.preHooks.push(message)
      continue
    }

    // Handle tool results
    if (
      message.type === 'user' &&
      Array.isArray(message.message.content) &&
      message.message.content[0]?.type === 'tool_result'
    ) {
      const toolUseID = (message.message.content[0] as ToolResultBlockParam)
        .tool_use_id
      if (!toolUseGroups.has(toolUseID)) {
        toolUseGroups.set(toolUseID, {
          toolUse: null,
          preHooks: [],
          toolResult: null,
          postHooks: [],
        })
      }
      toolUseGroups.get(toolUseID)!.toolResult = message
      continue
    }

    // Handle post-tool-use hooks
    if (
      isHookAttachmentMessage(message) &&
      message.attachment.hookEvent === 'PostToolUse'
    ) {
      const toolUseID = message.attachment.toolUseID
      if (!toolUseGroups.has(toolUseID)) {
        toolUseGroups.set(toolUseID, {
          toolUse: null,
          preHooks: [],
          toolResult: null,
          postHooks: [],
        })
      }
      toolUseGroups.get(toolUseID)!.postHooks.push(message)
    }
  }

  // Second pass: reconstruct the message list in the correct order
  const result: (
    | NormalizedUserMessage
    | NormalizedAssistantMessage
    | AttachmentMessage
    | SystemMessage
  )[] = []
  const processedToolUses = new Set<string>()

  for (const message of messages) {
    // Check if this is a tool use
    if (isToolUseRequestMessage(message)) {
      const toolUseID = message.message.content[0]?.id
      if (toolUseID && !processedToolUses.has(toolUseID)) {
        processedToolUses.add(toolUseID)
        const group = toolUseGroups.get(toolUseID)
        if (group && group.toolUse) {
          // Output in order: tool use, pre hooks, tool result, post hooks
          result.push(group.toolUse)
          result.push(...group.preHooks)
          if (group.toolResult) {
            result.push(group.toolResult)
          }
          result.push(...group.postHooks)
        }
      }
      continue
    }

    // Check if this message is part of a tool use group
    if (
      isHookAttachmentMessage(message) &&
      (message.attachment.hookEvent === 'PreToolUse' ||
        message.attachment.hookEvent === 'PostToolUse')
    ) {
      // Skip - already handled in tool use groups
      continue
    }

    if (
      message.type === 'user' &&
      Array.isArray(message.message.content) &&
      message.message.content[0]?.type === 'tool_result'
    ) {
      // Skip - already handled in tool use groups
      continue
    }

    // Handle api error messages (only keep the last one)
    if (message.type === 'system' && message.subtype === 'api_error') {
      const last = result.at(-1)
      if (last?.type === 'system' && last.subtype === 'api_error') {
        result[result.length - 1] = message
      } else {
        result.push(message)
      }
      continue
    }

    // Add standalone messages
    result.push(message)
  }

  // Add synthetic streaming tool use messages
  for (const message of syntheticStreamingToolUseMessages) {
    result.push(message)
  }

  // Filter to keep only the last api error message
  const last = result.at(-1)
  return result.filter(
    _ => _.type !== 'system' || _.subtype !== 'api_error' || _ === last,
  )
}

function isHookAttachmentMessage(
  message: Message,
): message is AttachmentMessage<HookAttachment> {
  return (
    message.type === 'attachment' &&
    (message.attachment?.type === 'hook_blocking_error' ||
      message.attachment?.type === 'hook_cancelled' ||
      message.attachment?.type === 'hook_error_during_execution' ||
      message.attachment?.type === 'hook_non_blocking_error' ||
      message.attachment?.type === 'hook_success' ||
      message.attachment?.type === 'hook_system_message' ||
      message.attachment?.type === 'hook_additional_context' ||
      message.attachment?.type === 'hook_stopped_continuation' ||
      message.attachment?.type === 'hook_deferred_tool')
  )
}

function getInProgressHookCount(
  messages: NormalizedMessage[],
  toolUseID: string,
  hookEvent: HookEvent,
): number {
  return count(
    messages,
    _ =>
      _.type === 'progress' &&
      (_.data as { type: string; hookEvent: HookEvent }).type ===
        'hook_progress' &&
      (_.data as { type: string; hookEvent: HookEvent }).hookEvent ===
        hookEvent &&
      _.parentToolUseID === toolUseID,
  )
}

function getResolvedHookCount(
  messages: NormalizedMessage[],
  toolUseID: string,
  hookEvent: HookEvent,
): number {
  // Count unique hook names, since a single hook can produce multiple
  // attachment messages (e.g., hook_success + hook_additional_context)
  const uniqueHookNames = new Set(
    messages
      .filter(
        (_): _ is AttachmentMessage<HookAttachmentWithName> =>
          isHookAttachmentMessage(_) &&
          _.attachment.toolUseID === toolUseID &&
          _.attachment.hookEvent === hookEvent,
      )
      .map(_ => _.attachment.hookName),
  )
  return uniqueHookNames.size
}

export function hasUnresolvedHooks(
  messages: NormalizedMessage[],
  toolUseID: string,
  hookEvent: HookEvent,
) {
  const inProgressHookCount = getInProgressHookCount(
    messages,
    toolUseID,
    hookEvent,
  )
  const resolvedHookCount = getResolvedHookCount(messages, toolUseID, hookEvent)

  if (inProgressHookCount > resolvedHookCount) {
    return true
  }

  return false
}

export function getToolResultIDs(normalizedMessages: NormalizedMessage[]): {
  [toolUseID: string]: boolean
} {
  return Object.fromEntries(
    normalizedMessages.flatMap(_ =>
      _.type === 'user' &&
      Array.isArray(_.message?.content) &&
      (_.message?.content as Array<{ type: string }>)[0]?.type === 'tool_result'
        ? [
            [
              (
                (
                  _.message?.content as Array<{ type: string }>
                )[0] as ToolResultBlockParam
              ).tool_use_id,
              (
                (
                  _.message?.content as Array<{ type: string }>
                )[0] as ToolResultBlockParam
              ).is_error ?? false,
            ],
          ]
        : ([] as [string, boolean][]),
    ),
  )
}

export function getSiblingToolUseIDs(
  message: NormalizedMessage,
  messages: Message[],
): Set<string> {
  const toolUseID = getToolUseID(message)
  if (!toolUseID) {
    return new Set()
  }

  const unnormalizedMessage = messages.find(
    (_): _ is AssistantMessage =>
      _.type === 'assistant' &&
      Array.isArray(_.message?.content) &&
      (_.message?.content as Array<{ type: string; id?: string }>).some(
        block => block.type === 'tool_use' && block.id === toolUseID,
      ),
  )
  if (!unnormalizedMessage) {
    return new Set()
  }

  const messageID = unnormalizedMessage.message.id
  const siblingMessages = messages.filter(
    (_): _ is AssistantMessage =>
      _.type === 'assistant' && _.message?.id === messageID,
  )

  return new Set(
    siblingMessages.flatMap(_ =>
      Array.isArray(_.message?.content)
        ? (_.message?.content as Array<{ type: string; id?: string }>)
            .filter(_ => _.type === 'tool_use')
            .map(_ => _.id!)
        : [],
    ),
  )
}

export type MessageLookups = {
  siblingToolUseIDs: Map<string, Set<string>>
  progressMessagesByToolUseID: Map<string, ProgressMessage[]>
  inProgressHookCounts: Map<string, Map<HookEvent, number>>
  resolvedHookNames: Map<string, Map<HookEvent, Set<string>>>
  resolvedHookCounts: Map<string, Map<HookEvent, number>>
  /** Maps tool_use_id to the user message containing its tool_result */
  toolResultByToolUseID: Map<string, NormalizedMessage>
  /** Maps tool_use_id to the ToolUseBlockParam */
  toolUseByToolUseID: Map<string, ToolUseBlockParam>
  /** Maps API message.id to the uuid of its first text block (densable Uy) */
  firstTextBlockUuidByMessageID: Map<string, string>
  /** Total count of normalized messages (for truncation indicator text) */
  normalizedMessageCount: number
  /** Set of tool use IDs that have a corresponding tool_result */
  resolvedToolUseIDs: Set<string>
  /** Set of tool use IDs that have an errored tool_result */
  erroredToolUseIDs: Set<string>
}

const TOOL_USE_IDS_BY_MESSAGE_ID = new WeakMap<
  MessageLookups,
  Map<string, Set<string>>
>()

/**
 * Build pre-computed lookups for efficient O(1) access to message relationships.
 * Call once per render, then use the lookups for all messages.
 *
 * This avoids O(n²) behavior from calling getProgressMessagesForMessage,
 * getSiblingToolUseIDs, and hasUnresolvedHooks for each message.
 */
export function buildMessageLookups(
  normalizedMessages: NormalizedMessage[],
  messages: Message[],
): MessageLookups {
  // First pass: group assistant messages by ID and collect all tool use IDs per message
  const toolUseIDsByMessageID = new Map<string, Set<string>>()
  const toolUseIDToMessageID = new Map<string, string>()
  const toolUseByToolUseID = new Map<string, ToolUseBlockParam>()
  for (const msg of messages) {
    if (msg.type === 'assistant') {
      const aMsg = msg as AssistantMessage
      const id = aMsg.message.id!
      let toolUseIDs = toolUseIDsByMessageID.get(id)
      if (!toolUseIDs) {
        toolUseIDs = new Set()
        toolUseIDsByMessageID.set(id, toolUseIDs)
      }
      if (Array.isArray(aMsg.message.content)) {
        for (const content of aMsg.message.content) {
          if (typeof content !== 'string' && content.type === 'tool_use') {
            const toolUseContent = content as ToolUseBlock
            toolUseIDs.add(toolUseContent.id)
            toolUseIDToMessageID.set(toolUseContent.id, id)
            toolUseByToolUseID.set(
              toolUseContent.id,
              content as ToolUseBlockParam,
            )
          }
        }
      }
    }
  }

  // Build sibling lookup - each tool use ID maps to all sibling tool use IDs
  const siblingToolUseIDs = new Map<string, Set<string>>()
  for (const [toolUseID, messageID] of toolUseIDToMessageID) {
    siblingToolUseIDs.set(toolUseID, toolUseIDsByMessageID.get(messageID)!)
  }

  // Single pass over normalizedMessages to build progress, hook, and tool result lookups
  const progressMessagesByToolUseID = new Map<string, ProgressMessage[]>()
  const inProgressHookCounts = new Map<string, Map<HookEvent, number>>()
  // Track unique hook names per (toolUseID, hookEvent) to match getResolvedHookCount behavior.
  // A single hook can produce multiple attachment messages (e.g., hook_success + hook_additional_context),
  // so we deduplicate by hookName.
  const resolvedHookNames = new Map<string, Map<HookEvent, Set<string>>>()
  const toolResultByToolUseID = new Map<string, NormalizedMessage>()
  const firstTextBlockUuidByMessageID = new Map<string, string>()
  // Track resolved/errored tool use IDs (replaces separate useMemos in Messages.tsx)
  const resolvedToolUseIDs = new Set<string>()
  const erroredToolUseIDs = new Set<string>()

  for (const msg of normalizedMessages) {
    if (msg.type === 'progress') {
      // Build progress messages lookup
      const toolUseID = msg.parentToolUseID as string
      const existing = progressMessagesByToolUseID.get(toolUseID)
      if (existing) {
        existing.push(msg as ProgressMessage)
      } else {
        progressMessagesByToolUseID.set(toolUseID, [msg as ProgressMessage])
      }

      // Count in-progress hooks
      const progressData = msg.data as { type: string; hookEvent: HookEvent }
      if (progressData.type === 'hook_progress') {
        const hookEvent = progressData.hookEvent
        let byHookEvent = inProgressHookCounts.get(toolUseID)
        if (!byHookEvent) {
          byHookEvent = new Map()
          inProgressHookCounts.set(toolUseID, byHookEvent)
        }
        byHookEvent.set(hookEvent, (byHookEvent.get(hookEvent) ?? 0) + 1)
      }
    }

    // Build tool result lookup and resolved/errored sets
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const content of msg.message?.content ?? []) {
        if (typeof content !== 'string' && content.type === 'tool_result') {
          const tr = content as ToolResultBlockParam
          toolResultByToolUseID.set(tr.tool_use_id, msg)
          resolvedToolUseIDs.add(tr.tool_use_id)
          if (tr.is_error) {
            erroredToolUseIDs.add(tr.tool_use_id)
          }
        }
      }
    }

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      const apiMessageId = msg.message?.id
      for (const content of msg.message?.content ?? []) {
        if (typeof content === 'string') continue
        if (
          content.type === 'text' &&
          apiMessageId &&
          !firstTextBlockUuidByMessageID.has(apiMessageId)
        ) {
          firstTextBlockUuidByMessageID.set(apiMessageId, msg.uuid)
        }
        // Track all server-side *_tool_result blocks (advisor, web_search,
        // code_execution, mcp, etc.) — any block with tool_use_id is a result.
        if (
          'tool_use_id' in content &&
          typeof (content as { tool_use_id: string }).tool_use_id === 'string'
        ) {
          resolvedToolUseIDs.add(
            (content as { tool_use_id: string }).tool_use_id,
          )
        }
        if ((content.type as string) === 'advisor_tool_result') {
          const result = content as {
            tool_use_id: string
            content: { type: string }
          }
          if (result.content.type === 'advisor_tool_result_error') {
            erroredToolUseIDs.add(result.tool_use_id)
          }
        }
      }
    }

    // Count resolved hooks (deduplicate by hookName)
    if (isHookAttachmentMessage(msg)) {
      const toolUseID = msg.attachment.toolUseID
      const hookEvent = msg.attachment.hookEvent
      const hookName = (msg.attachment as HookAttachmentWithName).hookName
      if (hookName !== undefined) {
        let byHookEvent = resolvedHookNames.get(toolUseID)
        if (!byHookEvent) {
          byHookEvent = new Map()
          resolvedHookNames.set(toolUseID, byHookEvent)
        }
        let names = byHookEvent.get(hookEvent)
        if (!names) {
          names = new Set()
          byHookEvent.set(hookEvent, names)
        }
        names.add(hookName)
      }
    }
  }

  // Convert resolved hook name sets to counts
  const resolvedHookCounts = new Map<string, Map<HookEvent, number>>()
  for (const [toolUseID, byHookEvent] of resolvedHookNames) {
    const countMap = new Map<HookEvent, number>()
    for (const [hookEvent, names] of byHookEvent) {
      countMap.set(hookEvent, names.size)
    }
    resolvedHookCounts.set(toolUseID, countMap)
  }

  // Mark orphaned server_tool_use / mcp_tool_use blocks (no matching
  // result) as errored so the UI shows them as failed instead of
  // perpetually spinning.
  const lastMsg = messages.at(-1)
  const lastAssistantMsgId =
    lastMsg?.type === 'assistant' ? lastMsg.message?.id : undefined
  for (const msg of normalizedMessages) {
    if (msg.type !== 'assistant') continue
    const aMsg = msg as AssistantMessage
    // Skip blocks from the last original message if it's an assistant,
    // since it may still be in progress.
    if (aMsg.message.id === lastAssistantMsgId) continue
    if (!Array.isArray(aMsg.message.content)) continue
    for (const content of aMsg.message.content) {
      if (
        typeof content !== 'string' &&
        ((content.type as string) === 'server_tool_use' ||
          (content.type as string) === 'mcp_tool_use') &&
        !resolvedToolUseIDs.has((content as { id: string }).id)
      ) {
        const id = (content as { id: string }).id
        resolvedToolUseIDs.add(id)
        erroredToolUseIDs.add(id)
      }
    }
  }

  const result: MessageLookups = {
    siblingToolUseIDs,
    progressMessagesByToolUseID,
    inProgressHookCounts,
    resolvedHookNames,
    resolvedHookCounts,
    toolResultByToolUseID,
    toolUseByToolUseID,
    firstTextBlockUuidByMessageID,
    normalizedMessageCount: normalizedMessages.length,
    resolvedToolUseIDs,
    erroredToolUseIDs,
  }
  TOOL_USE_IDS_BY_MESSAGE_ID.set(result, toolUseIDsByMessageID)
  return result
}

export type UpdateMessageLookupsOptions = {
  /** Prior normalizedMessages snapshot to verify strict append-only prefix. */
  previousNormalizedMessages?: readonly NormalizedMessage[]
  /** Prior shown messages snapshot to detect mid-array reordering (e.g. reorderMessagesInUI). */
  previousMessages?: readonly Message[]
}

/**
 * Incrementally update lookups by processing only newly appended messages.
 * Never mutates `existing` or any of its Maps/Sets/arrays in place — clones
 * modified collections on write and returns a new `MessageLookups` object
 * reference when updates occur (returns `existing` when unchanged, or `null`
 * when a full rebuild is required due to truncation, reordering, or progress
 * tick replacement).
 */
export function updateMessageLookupsIncremental(
  existing: MessageLookups,
  previousNormalizedCount: number,
  previousMessageCount: number,
  normalizedMessages: NormalizedMessage[],
  messages: Message[],
  options?: UpdateMessageLookupsOptions,
): MessageLookups | null {
  // Safety check: only handle append-only case
  if (
    normalizedMessages.length < previousNormalizedCount ||
    messages.length < previousMessageCount
  ) {
    return null
  }

  // Verify strict append-only prefix when prior arrays are supplied (detects
  // mid-array insertions/reordering from reorderMessagesInUI or compaction).
  if (options?.previousNormalizedMessages !== undefined) {
    const prevNorm = options.previousNormalizedMessages
    if (prevNorm.length < previousNormalizedCount) return null
    for (let i = 0; i < previousNormalizedCount; i++) {
      if (prevNorm[i] !== normalizedMessages[i]) return null
    }
  }
  if (options?.previousMessages !== undefined) {
    const prevMsgs = options.previousMessages
    if (prevMsgs.length < previousMessageCount) return null
    for (let i = 0; i < previousMessageCount; i++) {
      if (prevMsgs[i] !== messages[i]) return null
    }
  }

  // No new messages — nothing to do, UNLESS the trailing message is a
  // progress tick. REPL.tsx replaces ephemeral progress (Bash/PowerShell/MCP)
  // in-place to bound the messages array — same length, but the trailing
  // progress is a fresh tick. Returning `existing` here would leave
  // progressMessagesByToolUseID stuck on the first tick and elapsed-time
  // displays (ShellProgressMessage) would freeze. Force a full rebuild so
  // the fresh tick propagates.
  if (
    normalizedMessages.length === previousNormalizedCount &&
    messages.length === previousMessageCount
  ) {
    const lastNormalized = normalizedMessages[normalizedMessages.length - 1]
    if (lastNormalized && lastNormalized.type === 'progress') {
      return null
    }
    return existing
  }

  // Copy-on-write handles so `existing` and its nested Maps/Sets/arrays are
  // never mutated in place (safe under React 19 concurrent/deferred renders).
  let siblingToolUseIDs = existing.siblingToolUseIDs
  let progressMessagesByToolUseID = existing.progressMessagesByToolUseID
  let inProgressHookCounts = existing.inProgressHookCounts
  let resolvedHookNames = existing.resolvedHookNames
  let resolvedHookCounts = existing.resolvedHookCounts
  let toolResultByToolUseID = existing.toolResultByToolUseID
  let toolUseByToolUseID = existing.toolUseByToolUseID
  let firstTextBlockUuidByMessageID = existing.firstTextBlockUuidByMessageID
  let resolvedToolUseIDs = existing.resolvedToolUseIDs
  let erroredToolUseIDs = existing.erroredToolUseIDs

  const baseToolUseIDsByMessageID = TOOL_USE_IDS_BY_MESSAGE_ID.get(existing)
  let toolUseIDsByMessageID: Map<string, Set<string>> | undefined =
    baseToolUseIDsByMessageID
  const clonedProgressArrays = new Set<string>()
  const clonedInProgressHookMaps = new Set<string>()
  const clonedResolvedHookNameMaps = new Set<string>()
  const clonedResolvedHookCountMaps = new Set<string>()
  const clonedSiblingSetsByMessageId = new Set<string>()

  const ensureToolUseIDsByMessageID = (): Map<string, Set<string>> => {
    if (toolUseIDsByMessageID === undefined) {
      // Fallback when `existing` was not created via buildMessageLookups:
      // reconstruct messageId -> toolUseIDs from the prior prefix.
      const seeded = new Map<string, Set<string>>()
      const prefixEnd = Math.min(previousMessageCount, messages.length)
      for (let j = 0; j < prefixEnd; j++) {
        const prevMsg = messages[j]
        if (prevMsg?.type !== 'assistant') continue
        const aPrev = prevMsg as AssistantMessage
        const apiId = aPrev.message?.id
        if (!apiId || !Array.isArray(aPrev.message.content)) continue
        for (const content of aPrev.message.content) {
          if (typeof content !== 'string' && content.type === 'tool_use') {
            const tuId = (content as ToolUseBlock).id
            let set = seeded.get(apiId)
            if (!set) {
              set = new Set()
              seeded.set(apiId, set)
            }
            set.add(tuId)
          }
        }
      }
      toolUseIDsByMessageID = seeded
      return seeded
    }
    if (toolUseIDsByMessageID === baseToolUseIDsByMessageID) {
      toolUseIDsByMessageID = new Map(baseToolUseIDsByMessageID)
    }
    return toolUseIDsByMessageID
  }

  const writableSiblingToolUseIDs = (): Map<string, Set<string>> => {
    if (siblingToolUseIDs === existing.siblingToolUseIDs) {
      siblingToolUseIDs = new Map(existing.siblingToolUseIDs)
    }
    return siblingToolUseIDs
  }
  const writableToolUseByToolUseID = (): Map<string, ToolUseBlockParam> => {
    if (toolUseByToolUseID === existing.toolUseByToolUseID) {
      toolUseByToolUseID = new Map(existing.toolUseByToolUseID)
    }
    return toolUseByToolUseID
  }
  const writableProgressByToolUseID = (): Map<string, ProgressMessage[]> => {
    if (progressMessagesByToolUseID === existing.progressMessagesByToolUseID) {
      progressMessagesByToolUseID = new Map(
        existing.progressMessagesByToolUseID,
      )
    }
    return progressMessagesByToolUseID
  }
  const writableInProgressHookCounts = (): Map<
    string,
    Map<HookEvent, number>
  > => {
    if (inProgressHookCounts === existing.inProgressHookCounts) {
      inProgressHookCounts = new Map(existing.inProgressHookCounts)
    }
    return inProgressHookCounts
  }
  const writableResolvedHookNames = (): Map<
    string,
    Map<HookEvent, Set<string>>
  > => {
    if (resolvedHookNames === existing.resolvedHookNames) {
      resolvedHookNames = new Map(existing.resolvedHookNames)
    }
    return resolvedHookNames
  }
  const writableResolvedHookCounts = (): Map<
    string,
    Map<HookEvent, number>
  > => {
    if (resolvedHookCounts === existing.resolvedHookCounts) {
      resolvedHookCounts = new Map(existing.resolvedHookCounts)
    }
    return resolvedHookCounts
  }
  const writableToolResultByToolUseID = (): Map<string, NormalizedMessage> => {
    if (toolResultByToolUseID === existing.toolResultByToolUseID) {
      toolResultByToolUseID = new Map(existing.toolResultByToolUseID)
    }
    return toolResultByToolUseID
  }
  const writableFirstTextUuid = (): Map<string, string> => {
    if (
      firstTextBlockUuidByMessageID === existing.firstTextBlockUuidByMessageID
    ) {
      firstTextBlockUuidByMessageID = new Map(
        existing.firstTextBlockUuidByMessageID,
      )
    }
    return firstTextBlockUuidByMessageID
  }
  const writableResolvedToolUseIDs = (): Set<string> => {
    if (resolvedToolUseIDs === existing.resolvedToolUseIDs) {
      resolvedToolUseIDs = new Set(existing.resolvedToolUseIDs)
    }
    return resolvedToolUseIDs
  }
  const writableErroredToolUseIDs = (): Set<string> => {
    if (erroredToolUseIDs === existing.erroredToolUseIDs) {
      erroredToolUseIDs = new Set(existing.erroredToolUseIDs)
    }
    return erroredToolUseIDs
  }

  // Process new messages entries (pass 1: assistant tool_use blocks)
  const newMessageStart = previousMessageCount
  for (let i = newMessageStart; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.type === 'assistant') {
      const aMsg = msg as AssistantMessage
      const apiMessageId = aMsg.message.id!
      if (Array.isArray(aMsg.message.content)) {
        const newToolUseIDs: string[] = []
        for (const content of aMsg.message.content) {
          if (typeof content !== 'string' && content.type === 'tool_use') {
            const toolUseContent = content as ToolUseBlock
            // A tool_use already registered in `existing` appearing at or past
            // `previousMessageCount` means `messages` was reordered (not
            // append-only) — fall back to a full rebuild so sibling sets and
            // ordering stay exact.
            if (existing.toolUseByToolUseID.has(toolUseContent.id)) {
              return null
            }
            newToolUseIDs.push(toolUseContent.id)
            writableToolUseByToolUseID().set(
              toolUseContent.id,
              content as ToolUseBlockParam,
            )
          }
        }
        if (newToolUseIDs.length > 0) {
          // Merge with any sibling tool_use IDs already recorded for this
          // API message ID (across earlier normalized messages sharing the
          // same `aMsg.message.id`) without mutating the previous Set.
          const byMsgId = ensureToolUseIDsByMessageID()
          let mergedSiblings = byMsgId.get(apiMessageId)
          if (
            mergedSiblings === undefined ||
            !clonedSiblingSetsByMessageId.has(apiMessageId)
          ) {
            mergedSiblings = new Set(mergedSiblings)
            byMsgId.set(apiMessageId, mergedSiblings)
            clonedSiblingSetsByMessageId.add(apiMessageId)
          }
          for (const toolUseID of newToolUseIDs) {
            mergedSiblings.add(toolUseID)
          }
          const sibMap = writableSiblingToolUseIDs()
          for (const toolUseID of mergedSiblings) {
            sibMap.set(toolUseID, mergedSiblings)
          }
        }
      }
    }
  }

  // Process new normalizedMessages entries (pass 2: progress, hooks, tool results)
  const newNormalizedStart = previousNormalizedCount
  for (let i = newNormalizedStart; i < normalizedMessages.length; i++) {
    const msg = normalizedMessages[i]!

    if (msg.type === 'progress') {
      const toolUseID = msg.parentToolUseID as string
      const progressMap = writableProgressByToolUseID()
      const existingProgress = progressMap.get(toolUseID)
      if (existingProgress) {
        if (clonedProgressArrays.has(toolUseID)) {
          existingProgress.push(msg as ProgressMessage)
        } else {
          progressMap.set(toolUseID, [
            ...existingProgress,
            msg as ProgressMessage,
          ])
          clonedProgressArrays.add(toolUseID)
        }
      } else {
        progressMap.set(toolUseID, [msg as ProgressMessage])
        clonedProgressArrays.add(toolUseID)
      }

      const progressData = msg.data as { type: string; hookEvent: HookEvent }
      if (progressData.type === 'hook_progress') {
        const hookEvent = progressData.hookEvent
        const inProgMap = writableInProgressHookCounts()
        let byHookEvent = inProgMap.get(toolUseID)
        if (!byHookEvent) {
          byHookEvent = new Map()
          inProgMap.set(toolUseID, byHookEvent)
          clonedInProgressHookMaps.add(toolUseID)
        } else if (!clonedInProgressHookMaps.has(toolUseID)) {
          byHookEvent = new Map(byHookEvent)
          inProgMap.set(toolUseID, byHookEvent)
          clonedInProgressHookMaps.add(toolUseID)
        }
        byHookEvent.set(hookEvent, (byHookEvent.get(hookEvent) ?? 0) + 1)
      }
    }

    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const content of msg.message?.content ?? []) {
        if (typeof content !== 'string' && content.type === 'tool_result') {
          const tr = content as ToolResultBlockParam
          writableToolResultByToolUseID().set(tr.tool_use_id, msg)
          writableResolvedToolUseIDs().add(tr.tool_use_id)
          if (tr.is_error) {
            writableErroredToolUseIDs().add(tr.tool_use_id)
          }
        }
      }
    }

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      const apiMessageId = msg.message?.id
      for (const content of msg.message?.content ?? []) {
        if (typeof content === 'string') continue
        if (
          content.type === 'text' &&
          apiMessageId &&
          !firstTextBlockUuidByMessageID.has(apiMessageId)
        ) {
          writableFirstTextUuid().set(apiMessageId, msg.uuid)
        }
        if (
          'tool_use_id' in content &&
          typeof (content as { tool_use_id: string }).tool_use_id === 'string'
        ) {
          writableResolvedToolUseIDs().add(
            (content as { tool_use_id: string }).tool_use_id,
          )
        }
        if ((content.type as string) === 'advisor_tool_result') {
          const result = content as {
            tool_use_id: string
            content: { type: string }
          }
          if (result.content.type === 'advisor_tool_result_error') {
            writableErroredToolUseIDs().add(result.tool_use_id)
          }
        }
      }
    }

    if (isHookAttachmentMessage(msg)) {
      const toolUseID = msg.attachment.toolUseID
      const hookEvent = msg.attachment.hookEvent
      const hookName = (msg.attachment as HookAttachmentWithName).hookName
      if (hookName !== undefined) {
        const prevByHookNames = resolvedHookNames.get(toolUseID)
        const prevNames = prevByHookNames?.get(hookEvent)
        if (!prevNames?.has(hookName)) {
          const namesOuter = writableResolvedHookNames()
          let byHookNames = namesOuter.get(toolUseID)
          if (!byHookNames) {
            byHookNames = new Map()
            namesOuter.set(toolUseID, byHookNames)
            clonedResolvedHookNameMaps.add(toolUseID)
          } else if (!clonedResolvedHookNameMaps.has(toolUseID)) {
            byHookNames = new Map(byHookNames)
            namesOuter.set(toolUseID, byHookNames)
            clonedResolvedHookNameMaps.add(toolUseID)
          }
          const nextNames = new Set(byHookNames.get(hookEvent))
          nextNames.add(hookName)
          byHookNames.set(hookEvent, nextNames)

          const countsOuter = writableResolvedHookCounts()
          let byHookEvent = countsOuter.get(toolUseID)
          if (!byHookEvent) {
            byHookEvent = new Map()
            countsOuter.set(toolUseID, byHookEvent)
            clonedResolvedHookCountMaps.add(toolUseID)
          } else if (!clonedResolvedHookCountMaps.has(toolUseID)) {
            byHookEvent = new Map(byHookEvent)
            countsOuter.set(toolUseID, byHookEvent)
            clonedResolvedHookCountMaps.add(toolUseID)
          }
          byHookEvent.set(hookEvent, nextNames.size)
        }
      }
    }
  }

  // Mark orphaned server_tool_use / mcp_tool_use blocks as errored.
  // Only scan the new normalizedMessages since the previous count —
  // existing entries were already checked by a prior full build.
  const lastMsg = messages.at(-1)
  const lastAssistantMsgId =
    lastMsg?.type === 'assistant' ? lastMsg.message?.id : undefined
  for (let i = newNormalizedStart; i < normalizedMessages.length; i++) {
    const msg = normalizedMessages[i]!
    if (msg.type !== 'assistant') continue
    const aMsg = msg as AssistantMessage
    if (aMsg.message.id === lastAssistantMsgId) continue
    if (!Array.isArray(aMsg.message.content)) continue
    for (const content of aMsg.message.content) {
      if (
        typeof content !== 'string' &&
        ((content.type as string) === 'server_tool_use' ||
          (content.type as string) === 'mcp_tool_use') &&
        !resolvedToolUseIDs.has((content as { id: string }).id)
      ) {
        const id = (content as { id: string }).id
        writableResolvedToolUseIDs().add(id)
        writableErroredToolUseIDs().add(id)
      }
    }
  }

  const next: MessageLookups = {
    siblingToolUseIDs,
    progressMessagesByToolUseID,
    inProgressHookCounts,
    resolvedHookNames,
    resolvedHookCounts,
    toolResultByToolUseID,
    toolUseByToolUseID,
    firstTextBlockUuidByMessageID,
    normalizedMessageCount: normalizedMessages.length,
    resolvedToolUseIDs,
    erroredToolUseIDs,
  }
  if (toolUseIDsByMessageID !== undefined) {
    TOOL_USE_IDS_BY_MESSAGE_ID.set(next, toolUseIDsByMessageID)
  }
  return next
}

/**
 * Compute a lightweight structural fingerprint for buildMessageLookups caching.
 * Only captures information that affects lookup results (types, IDs, counts),
 * not content. Returns an empty string when the arrays are structurally empty.
 *
 * O(n) but allocates only a string — much cheaper than the 8 Maps/Sets that
 * buildMessageLookups creates on every call.
 */
export function computeMessageStructureKey(
  normalizedMessages: NormalizedMessage[],
  messages: Message[],
): string {
  const parts: string[] = [
    String(normalizedMessages.length),
    '|',
    String(messages.length),
  ]
  for (const msg of messages) {
    parts.push(msg.type[0])
    if (msg.type === 'assistant') {
      const aMsg = msg as AssistantMessage
      const content = aMsg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block !== 'string' && block.type === 'tool_use') {
            parts.push('t', (block as ToolUseBlock).id)
          }
        }
      }
    } else if (msg.type === 'user') {
      const content = (msg as UserMessage).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block !== 'string' && block.type === 'tool_result') {
            parts.push('r', (block as ToolResultBlockParam).tool_use_id)
          }
        }
      }
    }
  }
  for (const msg of normalizedMessages) {
    if (msg.type === 'progress') {
      const pMsg = msg as ProgressMessage
      // Include uuid so ephemeral progress tick replacements
      // (Bash/PowerShell/MCP) invalidate the lookups cache. Without this,
      // REPL.tsx's in-place tick replacement (same parentToolUseID, same
      // length) yields an identical key, lookups cache the first tick
      // forever, and ShellProgressMessage's elapsed time freezes.
      parts.push('p', pMsg.parentToolUseID as string, pMsg.uuid)
    }
  }
  return parts.join(',')
}

/** Empty lookups for static rendering contexts that don't need real lookups. */
export const EMPTY_LOOKUPS: MessageLookups = {
  siblingToolUseIDs: new Map(),
  progressMessagesByToolUseID: new Map(),
  inProgressHookCounts: new Map(),
  resolvedHookNames: new Map(),
  resolvedHookCounts: new Map(),
  toolResultByToolUseID: new Map(),
  toolUseByToolUseID: new Map(),
  firstTextBlockUuidByMessageID: new Map(),
  normalizedMessageCount: 0,
  resolvedToolUseIDs: new Set(),
  erroredToolUseIDs: new Set(),
}

/**
 * Shared empty Set singleton. Reused on bail-out paths to avoid allocating
 * a fresh Set per message per render. Mutation is prevented at compile time
 * by the ReadonlySet<string> type — Object.freeze here is convention only
 * (it freezes own properties, not Set internal state).
 * All consumers are read-only (iteration / .has / .size).
 */
export const EMPTY_STRING_SET: ReadonlySet<string> = Object.freeze(
  new Set<string>(),
)

/**
 * Build lookups from subagent/skill progress messages so child tool uses
 * render with correct resolved/in-progress/queued state.
 *
 * Each progress message must have a `message` field of type
 * `AssistantMessage | NormalizedUserMessage`.
 */
export function buildSubagentLookups(
  messages: { message: AssistantMessage | NormalizedUserMessage }[],
): { lookups: MessageLookups; inProgressToolUseIDs: Set<string> } {
  const toolUseByToolUseID = new Map<string, ToolUseBlockParam>()
  const resolvedToolUseIDs = new Set<string>()
  const toolResultByToolUseID = new Map<
    string,
    NormalizedUserMessage & { type: 'user' }
  >()

  for (const { message: msg } of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.message.content)) {
      for (const content of msg.message.content) {
        if (typeof content !== 'string' && content.type === 'tool_use') {
          toolUseByToolUseID.set(
            (content as ToolUseBlock).id,
            content as ToolUseBlockParam,
          )
        }
      }
    } else if (msg.type === 'user' && Array.isArray(msg.message.content)) {
      for (const content of msg.message.content) {
        if (typeof content !== 'string' && content.type === 'tool_result') {
          const tr = content as ToolResultBlockParam
          resolvedToolUseIDs.add(tr.tool_use_id)
          toolResultByToolUseID.set(tr.tool_use_id, msg)
        }
      }
    }
  }

  const inProgressToolUseIDs = new Set<string>()
  for (const id of toolUseByToolUseID.keys()) {
    if (!resolvedToolUseIDs.has(id)) {
      inProgressToolUseIDs.add(id)
    }
  }

  return {
    lookups: {
      ...EMPTY_LOOKUPS,
      toolUseByToolUseID,
      resolvedToolUseIDs,
      toolResultByToolUseID,
    },
    inProgressToolUseIDs,
  }
}

/**
 * Get sibling tool use IDs using pre-computed lookup. O(1).
 */
export function getSiblingToolUseIDsFromLookup(
  message: NormalizedMessage,
  lookups: MessageLookups,
): ReadonlySet<string> {
  const toolUseID = getToolUseID(message)
  if (!toolUseID) {
    return EMPTY_STRING_SET
  }
  return lookups.siblingToolUseIDs.get(toolUseID) ?? EMPTY_STRING_SET
}

/**
 * Get progress messages for a message using pre-computed lookup. O(1).
 */
export function getProgressMessagesFromLookup(
  message: NormalizedMessage,
  lookups: MessageLookups,
): ProgressMessage[] {
  const toolUseID = getToolUseID(message)
  if (!toolUseID) {
    return []
  }
  return lookups.progressMessagesByToolUseID.get(toolUseID) ?? []
}

/**
 * Check for unresolved hooks using pre-computed lookup. O(1).
 */
export function hasUnresolvedHooksFromLookup(
  toolUseID: string,
  hookEvent: HookEvent,
  lookups: MessageLookups,
): boolean {
  const inProgressCount =
    lookups.inProgressHookCounts.get(toolUseID)?.get(hookEvent) ?? 0
  const resolvedCount =
    lookups.resolvedHookCounts.get(toolUseID)?.get(hookEvent) ?? 0
  return inProgressCount > resolvedCount
}

export function getToolUseIDs(
  normalizedMessages: NormalizedMessage[],
): Set<string> {
  return new Set(
    normalizedMessages
      .filter(
        (_): _ is NormalizedAssistantMessage<BetaToolUseBlock> =>
          _.type === 'assistant' &&
          Array.isArray(_.message?.content) &&
          (_.message?.content as Array<{ type: string }>)[0]?.type ===
            'tool_use',
      )
      .map(_ => (_.message?.content as Array<BetaToolUseBlock>)[0].id),
  )
}

export function getToolUseID(message: NormalizedMessage): string | null {
  switch (message.type) {
    case 'attachment':
      if (isHookAttachmentMessage(message)) {
        return message.attachment.toolUseID ?? null
      }
      return null
    case 'assistant': {
      const aContent = Array.isArray(message.message?.content)
        ? message.message?.content
        : []
      const firstBlock = aContent![0]
      if (
        !firstBlock ||
        typeof firstBlock === 'string' ||
        firstBlock.type !== 'tool_use'
      ) {
        return null
      }
      return (firstBlock as ToolUseBlock).id
    }
    case 'user': {
      if (message.sourceToolUseID) {
        return message.sourceToolUseID as string
      }
      const uContent = Array.isArray(message.message?.content)
        ? message.message?.content
        : []
      const firstUBlock = uContent![0]
      if (
        !firstUBlock ||
        typeof firstUBlock === 'string' ||
        firstUBlock.type !== 'tool_result'
      ) {
        return null
      }
      return (firstUBlock as ToolResultBlockParam).tool_use_id
    }
    case 'progress':
      return message.toolUseID as string
    case 'system':
      return (message.subtype as string) === 'informational'
        ? ((message.toolUseID as string) ?? null)
        : null
    default:
      return null
  }
}
