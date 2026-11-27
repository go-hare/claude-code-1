/**
 * Full API message normalization pipeline (normalizeMessagesForAPI), attachment reordering, and tool-reference sanitization.
 */

import type {
  ContentBlockParam,
  TextBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { feature } from 'bun:bundle'
import last from 'lodash-es/last.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  getImageTooLargeErrorMessage,
  getPdfInvalidErrorMessage,
  getPdfPasswordProtectedErrorMessage,
  getPdfTooLargeErrorMessage,
  getRequestTooLargeErrorMessage,
} from '../../services/api/errors.js'
import { toolMatchesName, type Tools } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  SystemLocalCommandMessage,
  UserMessage,
} from '../../types/message.js'
import { normalizeToolInputForAPI } from '../api.js'
import type { Attachment } from '../attachments.js'
import {
  queuedCommandDeliveryBehindEarlierIds,
  queuedCommandDeliveryDrainIds,
  queuedCommandDeliveryHumanTurnIds,
  spliceBashTaskDelivery,
} from '../bashTaskDelivery.js'
import { logForDebugging } from '../debug.js'
import { validateImagesForAPI } from '../imageValidation.js'
import {
  type ApiSystemMessage,
  createApiSystemMessage,
  demoteOrphanApiSystemMessages,
  extractPureTextFromUserMessages,
  isApiSystemMessage,
  shouldSkipSystemReminderWrap,
  shouldUseMidConversationSystem,
} from '../midConversationSystem.js'
import { normalizeLegacyToolName } from '../permissions/permissionRuleParser.js'
import {
  isSearchExtraToolsEnabledOptimistic,
  isToolReferenceBlock,
} from '../searchExtraTools.js'
import { normalizeAttachmentForAPI } from './attachmentNormalizer.js'
import {
  mergeBatchedToolResults,
  reassembleBatchedToolUses,
} from './batchToolUses.js'
import {
  TOOL_REFERENCE_TURN_BOUNDARY,
  deriveShortMessageId,
  isSyntheticApiErrorMessage,
  wrapInSystemReminder,
} from './constants.js'
import { createUserMessage } from './factories.js'
import {
  type NormalizedApiMessage,
  isToolResultMessage,
  mergeAdjacentUserMessages,
  mergeAssistantMessages,
  mergeUserMessages,
  mergeUserMessagesAndToolResults,
  smooshSystemReminderSiblings,
} from './messageMerging.js'
import { isSystemLocalCommandMessage } from './messageQueries.js'
import { hardenTaskNotificationForApi } from './originFraming.js'
import {
  ensureNonEmptyAssistantContent,
  filterOrphanedThinkingOnlyMessages,
  filterTrailingThinkingFromLastAssistant,
  filterWhitespaceOnlyAssistantMessages,
} from './thinkingFilter.js'

/**
 * Reorders messages so that attachments bubble up until they hit either:
 * - A tool call result (user message with tool_result content)
 * - Any assistant message
 */
export function reorderAttachmentsForAPI(messages: Message[]): Message[] {
  // We build `result` backwards (push) and reverse once at the end — O(N).
  // Using unshift inside the loop would be O(N²).
  const result: Message[] = []
  // Attachments are pushed as we encounter them scanning bottom-up, so
  // this buffer holds them in reverse order (relative to the input array).
  const pendingAttachments: AttachmentMessage[] = []

  // Scan from the bottom up
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!

    if (message.type === 'attachment') {
      // Collect attachment to bubble up
      pendingAttachments.push(message as AttachmentMessage)
    } else {
      // Check if this is a stopping point
      const isStoppingPoint =
        message.type === 'assistant' ||
        (message.type === 'user' &&
          Array.isArray(message.message?.content) &&
          (message.message?.content as Array<{ type: string }>)[0]?.type ===
            'tool_result')

      if (isStoppingPoint && pendingAttachments.length > 0) {
        // Hit a stopping point — attachments stop here (go after the stopping point).
        // pendingAttachments is already reversed; after the final result.reverse()
        // they will appear in original order right after `message`.
        for (let j = 0; j < pendingAttachments.length; j++) {
          result.push(pendingAttachments[j]!)
        }
        result.push(message)
        pendingAttachments.length = 0
      } else {
        // Regular message
        result.push(message)
      }
    }
  }

  // Any remaining attachments bubble all the way to the top.
  for (let j = 0; j < pendingAttachments.length; j++) {
    result.push(pendingAttachments[j]!)
  }

  result.reverse()
  return result
}

/**
 * Strips tool_reference blocks for tools that no longer exist from tool_result content.
 * This handles the case where a session was saved with MCP tools that are no longer
 * available (e.g., MCP server was disconnected, renamed, or removed).
 * Without this filtering, the API rejects with "Tool reference not found in available tools".
 */
function stripUnavailableToolReferencesFromUserMessage(
  message: UserMessage,
  availableToolNames: Set<string>,
): UserMessage {
  const content = message.message.content
  if (!Array.isArray(content)) {
    return message
  }

  // Check if any tool_reference blocks point to unavailable tools
  const hasUnavailableReference = content.some(
    block =>
      block.type === 'tool_result' &&
      Array.isArray(block.content) &&
      block.content.some(c => {
        if (!isToolReferenceBlock(c)) return false
        const toolName = (c as { tool_name?: string }).tool_name
        return (
          toolName && !availableToolNames.has(normalizeLegacyToolName(toolName))
        )
      }),
  )

  if (!hasUnavailableReference) {
    return message
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: content.map(block => {
        if (block.type !== 'tool_result' || !Array.isArray(block.content)) {
          return block
        }

        // Filter out tool_reference blocks for unavailable tools
        const filteredContent = block.content.filter(c => {
          if (!isToolReferenceBlock(c)) return true
          const rawToolName = (c as { tool_name?: string }).tool_name
          if (!rawToolName) return true
          const toolName = normalizeLegacyToolName(rawToolName)
          const isAvailable = availableToolNames.has(toolName)
          if (!isAvailable) {
            logForDebugging(
              `Filtering out tool_reference for unavailable tool: ${toolName}`,
              { level: 'warn' },
            )
          }
          return isAvailable
        })

        // If all content was filtered out, replace with a placeholder
        if (filteredContent.length === 0) {
          return {
            ...block,
            content: [
              {
                type: 'text' as const,
                text: '[Tool references removed - tools no longer available]',
              },
            ],
          }
        }

        return {
          ...block,
          content: filteredContent,
        }
      }),
    },
  }
}

/**
 * Appends a [id:...] message ID tag to the last text block of a user message.
 * Only mutates the API-bound copy, not the stored message.
 * This lets Claude reference message IDs when calling the snip tool.
 */
function appendMessageTagToUserMessage(message: UserMessage): UserMessage {
  if (message.isMeta) {
    return message
  }

  const tag = `\n[id:${deriveShortMessageId(message.uuid)}]`

  const content = message.message.content

  // Handle string content (most common for simple text input)
  if (typeof content === 'string') {
    return {
      ...message,
      message: {
        ...message.message,
        content: content + tag,
      },
    }
  }

  if (!Array.isArray(content) || content.length === 0) {
    return message
  }

  // Find the last text block
  let lastTextIdx = -1
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i]!.type === 'text') {
      lastTextIdx = i
      break
    }
  }
  if (lastTextIdx === -1) {
    return message
  }

  const newContent = [...content]
  const textBlock = newContent[lastTextIdx] as TextBlockParam
  newContent[lastTextIdx] = {
    ...textBlock,
    text: textBlock.text + tag,
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: newContent as typeof content,
    },
  }
}

/**
 * Strips tool_reference blocks from tool_result content in a user message.
 * tool_reference blocks are only valid when the tool search beta is enabled.
 * When tool search is disabled, we need to remove these blocks to avoid API errors.
 */
export function stripToolReferenceBlocksFromUserMessage(
  message: UserMessage,
): UserMessage {
  const content = message.message.content
  if (!Array.isArray(content)) {
    return message
  }

  const hasToolReference = content.some(
    block =>
      block.type === 'tool_result' &&
      Array.isArray(block.content) &&
      block.content.some(isToolReferenceBlock),
  )

  if (!hasToolReference) {
    return message
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: content.map(block => {
        if (block.type !== 'tool_result' || !Array.isArray(block.content)) {
          return block
        }

        // Filter out tool_reference blocks from tool_result content
        const filteredContent = block.content.filter(
          c => !isToolReferenceBlock(c),
        )

        // If all content was tool_reference blocks, replace with a placeholder
        if (filteredContent.length === 0) {
          return {
            ...block,
            content: [
              {
                type: 'text' as const,
                text: '[Tool references removed - tool search not enabled]',
              },
            ],
          }
        }

        return {
          ...block,
          content: filteredContent,
        }
      }),
    },
  }
}

/**
 * Strips the 'caller' field from tool_use blocks in an assistant message.
 * The 'caller' field is only valid when the tool search beta is enabled.
 * When tool search is disabled, we need to remove this field to avoid API errors.
 *
 * NOTE: This function only strips the 'caller' field - it does NOT normalize
 * tool inputs (that's done by normalizeToolInputForAPI in normalizeMessagesForAPI).
 * This is intentional: this helper is used for model-specific post-processing
 * AFTER normalizeMessagesForAPI has already run, so inputs are already normalized.
 */
export function stripCallerFieldFromAssistantMessage(
  message: AssistantMessage,
): AssistantMessage {
  const contentArr = Array.isArray(message.message.content)
    ? message.message.content
    : []
  const hasCallerField = contentArr.some(
    block =>
      typeof block !== 'string' &&
      block.type === 'tool_use' &&
      'caller' in block &&
      block.caller !== null,
  )

  if (!hasCallerField) {
    return message
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: contentArr.map(block => {
        if (typeof block === 'string' || block.type !== 'tool_use') {
          return block
        }
        const toolUse = block as ToolUseBlock
        // Explicitly construct with only standard API fields
        return {
          type: 'tool_use' as const,
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        }
      }),
    },
  }
}

/**
 * Does the content array have a tool_result block whose inner content
 * contains tool_reference (SearchExtraTools loaded tools)?
 */
function contentHasToolReference(
  content: ReadonlyArray<ContentBlockParam>,
): boolean {
  return content.some(
    block =>
      block.type === 'tool_result' &&
      Array.isArray(block.content) &&
      block.content.some(isToolReferenceBlock),
  )
}

/**
 * Ensure all text content in attachment-origin messages carries the
 * <system-reminder> wrapper. This makes the prefix a reliable discriminator
 * for the post-pass smoosh (smooshSystemReminderSiblings) — no need for every
 * normalizeAttachmentForAPI case to remember to wrap.
 *
 * Idempotent: already-wrapped text is unchanged.
 */
function ensureSystemReminderWrap(msg: UserMessage): UserMessage {
  const content = msg.message.content
  if (!content) return msg
  if (typeof content === 'string') {
    if (content.startsWith('<system-reminder>')) return msg
    return {
      ...msg,
      message: { ...msg.message, content: wrapInSystemReminder(content) },
    }
  }
  let changed = false
  const newContent = content.map(b => {
    if (b.type === 'text' && !b.text.startsWith('<system-reminder>')) {
      changed = true
      return { ...b, text: wrapInSystemReminder(b.text) }
    }
    return b
  })
  return changed
    ? { ...msg, message: { ...msg.message, content: newContent } }
    : msg
}

/**
 * Strip non-text blocks from is_error tool_results — the API rejects the
 * combination with "all content must be type text if is_error is true".
 *
 * Read-side guard for transcripts persisted before smooshIntoToolResult
 * learned to filter on is_error. Without this a resumed session with one
 * of these 400s on every call and can't be recovered by /fork. Adjacent
 * text left behind by a stripped image is re-merged.
 */
function sanitizeErrorToolResultContent(
  messages: NormalizedApiMessage[],
): NormalizedApiMessage[] {
  return messages.map(msg => {
    if (msg.type !== 'user') return msg
    const content = msg.message.content
    if (!Array.isArray(content)) return msg

    let changed = false
    const newContent = content.map(b => {
      if (b.type !== 'tool_result' || !b.is_error) return b
      const trContent = b.content
      if (!Array.isArray(trContent)) return b
      if (trContent.every(c => c.type === 'text')) return b
      changed = true
      const texts = trContent.filter(c => c.type === 'text').map(c => c.text)
      const textOnly: TextBlockParam[] =
        texts.length > 0 ? [{ type: 'text', text: texts.join('\n\n') }] : []
      return { ...b, content: textOnly }
    })
    if (!changed) return msg
    return { ...msg, message: { ...msg.message, content: newContent } }
  })
}

/**
 * Move text-block siblings off user messages that contain tool_reference.
 *
 * When a tool_result contains tool_reference, the server expands it to a
 * functions block. Any text siblings appended to that same user message
 * (auto-memory, skill reminders, etc.) create a second human-turn segment
 * right after the functions-close tag — an anomalous pattern the model
 * imprints on. At a later tool-results tail, the model completes the
 * pattern and emits the stop sequence. See #21049 for mechanism and
 * five-arm dose-response.
 *
 * The fix: find the next user message with tool_result content but NO
 * tool_reference, and move the text siblings there. Pure transformation —
 * no state, no side effects. The target message's existing siblings (if any)
 * are preserved; moved blocks append.
 *
 * If no valid target exists (tool_reference message is at/near the tail),
 * siblings stay in place. That's safe: a tail ending in a human turn (with
 * siblings) gets an Assistant: cue before generation; only a tail ending
 * in bare tool output (no siblings) lacks the cue.
 *
 * Idempotent: after moving, the source has no text siblings; second pass
 * finds nothing to move.
 */
function relocateToolReferenceSiblings(
  messages: NormalizedApiMessage[],
): NormalizedApiMessage[] {
  const result = [...messages]

  for (let i = 0; i < result.length; i++) {
    const msg = result[i]!
    if (msg.type !== 'user') continue
    const content = msg.message.content
    if (!Array.isArray(content)) continue
    if (!contentHasToolReference(content)) continue

    const textSiblings = content.filter(b => b.type === 'text')
    if (textSiblings.length === 0) continue

    // Find the next user message with tool_result but no tool_reference.
    // Skip tool_reference-containing targets — moving there would just
    // recreate the problem one position later.
    let targetIdx = -1
    for (let j = i + 1; j < result.length; j++) {
      const cand = result[j]!
      if (cand.type !== 'user') continue
      const cc = cand.message.content
      if (!Array.isArray(cc)) continue
      if (!cc.some(b => b.type === 'tool_result')) continue
      if (contentHasToolReference(cc)) continue
      targetIdx = j
      break
    }

    if (targetIdx === -1) continue // No valid target; leave in place.

    // Strip text from source, append to target.
    result[i] = {
      ...msg,
      message: {
        ...msg.message,
        content: content.filter(b => b.type !== 'text'),
      },
    }
    const target = result[targetIdx] as UserMessage
    result[targetIdx] = {
      ...target,
      message: {
        ...target.message,
        content: [
          ...(target.message.content as ContentBlockParam[]),
          ...textSiblings,
        ],
      },
    }
  }

  return result
}

/**
 * densable eN — normalize for API.
 * When `model` is set and J8t(model), pure-text meta attachments after a user
 * turn become `api_system` (role:system on the wire) instead of isMeta user.
 */
const PROMPT_HOOK_ADDITIONAL_CONTEXT_NAMES = new Set([
  'prompt.submit',
  'prompt.mention',
])

export function isPromptHookAdditionalContextAttachment(
  attachment: Attachment,
): boolean {
  return (
    attachment.type === 'hook_additional_context' &&
    PROMPT_HOOK_ADDITIONAL_CONTEXT_NAMES.has(attachment.hookName)
  )
}

export function normalizeMessagesForAPI(
  messages: Message[],
  tools: Tools = [],
  model?: string,
  options?: { preserveTrailingThinking?: boolean },
): (UserMessage | AssistantMessage | ApiSystemMessage)[] {
  // densable o = r!==void 0 && J8t(r) — mid-conv system inject path
  const midConvEnabled =
    model !== undefined && shouldUseMidConversationSystem({ model })
  // densable i = n!==void 0 && o && FXe(n)
  const skipSystemReminderWrap =
    model !== undefined && midConvEnabled && shouldSkipSystemReminderWrap(model)
  // Build set of available tool names for filtering unavailable tool references
  const availableToolNames = new Set(tools.map(t => t.name))

  // First, reorder attachments to bubble up until they hit a tool result or assistant message
  // Then strip virtual messages — they're display-only (e.g. REPL inner tool
  // calls) and must never reach the API.
  const reorderedMessages = reorderAttachmentsForAPI(messages).filter(
    m => !((m.type === 'user' || m.type === 'assistant') && m.isVirtual),
  )

  // Build a map from error text → which block types to strip from the preceding user message.
  const errorToBlockTypes: Record<string, Set<string>> = {
    [getPdfTooLargeErrorMessage()]: new Set(['document']),
    [getPdfPasswordProtectedErrorMessage()]: new Set(['document']),
    [getPdfInvalidErrorMessage()]: new Set(['document']),
    [getImageTooLargeErrorMessage()]: new Set(['image']),
    [getRequestTooLargeErrorMessage()]: new Set(['document', 'image']),
  }

  // Walk the reordered messages to build a targeted strip map:
  // userMessageUUID → set of block types to strip from that message.
  const stripTargets = new Map<string, Set<string>>()
  for (let i = 0; i < reorderedMessages.length; i++) {
    const msg = reorderedMessages[i]!
    if (!isSyntheticApiErrorMessage(msg)) {
      continue
    }
    // Determine which error this is
    const errorText =
      Array.isArray(msg.message.content) &&
      msg.message.content[0]?.type === 'text'
        ? msg.message.content[0].text
        : undefined
    if (!errorText) {
      continue
    }
    const blockTypesToStrip = errorToBlockTypes[errorText]
    if (!blockTypesToStrip) {
      continue
    }
    // Walk backward to find the nearest preceding isMeta user message
    for (let j = i - 1; j >= 0; j--) {
      const candidate = reorderedMessages[j]!
      if (candidate.type === 'user' && candidate.isMeta) {
        const existing = stripTargets.get(candidate.uuid)
        if (existing) {
          for (const t of blockTypesToStrip) {
            existing.add(t)
          }
        } else {
          stripTargets.set(candidate.uuid, new Set(blockTypesToStrip))
        }
        break
      }
      // Skip over other synthetic error messages or non-meta messages
      if (isSyntheticApiErrorMessage(candidate)) {
        continue
      }
      // Stop if we hit an assistant message or non-meta user message
      break
    }
  }

  const drainDeliveryIds = queuedCommandDeliveryDrainIds(reorderedMessages)
  const humanTurnDeliveryIds =
    queuedCommandDeliveryHumanTurnIds(reorderedMessages)
  const behindEarlierIds =
    queuedCommandDeliveryBehindEarlierIds(reorderedMessages)

  const result: (UserMessage | AssistantMessage | ApiSystemMessage)[] = []
  // densable 2.1.216 LN — linear same-id assistant merge (Map + cursor).
  // Replaces 215 reverse for-loop O(n) per assistant → O(n²) stalls.
  // Segment ends on non-assistant that is not api_system and not tool_result
  // user; those two types are TRANSPARENT (do not clear the map).
  const assistantIdToIndex = new Map<string, number>()
  let mapScanFrom = 0
  const advanceAssistantIdMap = (): void => {
    for (; mapScanFrom < result.length; mapScanFrom++) {
      const y = result[mapScanFrom]!
      if (y.type === 'assistant') {
        assistantIdToIndex.set(y.message.id ?? '', mapScanFrom)
      } else if (y.type !== 'api_system' && !isToolResultMessage(y)) {
        assistantIdToIndex.clear()
      }
      // api_system + tool_result users: transparent — keep map
    }
  }
  // densable w — pure-text meta buffer flushed into api_system after user
  const metaBuffer: string[] = []
  let emittedApiSystem = false
  // densable C — batching_reminder flush marks created/merged api_system ephemeral
  let pendingBatchingReminderEphemeral = false
  const flushMetaBuffer = (): void => {
    if (metaBuffer.length === 0) return
    const text = metaBuffer.join('\n\n')
    metaBuffer.length = 0
    const markEphemeral = pendingBatchingReminderEphemeral
    pendingBatchingReminderEphemeral = false
    const lastMessage = last(result)
    if (isApiSystemMessage(lastMessage)) {
      lastMessage.message.content += `\n\n${text}`
      if (markEphemeral) lastMessage.ephemeral = true
      return
    }
    if (lastMessage?.type === 'user') {
      // densable: last is user → B6n mid-conversation system block
      emittedApiSystem = true
      result.push(createApiSystemMessage(text, markEphemeral || undefined))
      return
    }
    // else → meta user (pre-conversation or after assistant)
    result.push(
      createUserMessage({
        content: skipSystemReminderWrap ? text : wrapInSystemReminder(text),
        isMeta: true,
      }),
    )
  }
  // densable `hr` / `rr` @191342600 — deduplicate by message uuid, gate `report`
  // on `model !== undefined`, and reset `assistantIdToIndex` on `'new_turn'`.
  const splicedDeliveryIds = new Set<string>()
  const trySpliceTaskDelivery = (
    delivery: unknown,
    uuid: string,
    opts: {
      startsTurn: boolean
      inDrainPosition: boolean
      inHumanTurn: boolean
    },
  ): boolean => {
    if (splicedDeliveryIds.has(uuid)) return true
    const spliced = spliceBashTaskDelivery(result, delivery, uuid, {
      ...opts,
      report: model !== undefined,
      behindEarlierMessages: behindEarlierIds.has(uuid),
      flushTail: flushMetaBuffer,
    })
    if (spliced === false) return false
    splicedDeliveryIds.add(uuid)
    if (spliced === 'new_turn') {
      assistantIdToIndex.clear()
      mapScanFrom = result.length
    }
    return true
  }
  reorderedMessages
    .filter(
      (
        _,
      ): _ is
        | UserMessage
        | AssistantMessage
        | AttachmentMessage
        | SystemLocalCommandMessage => {
        if (
          _.type === 'progress' ||
          (_.type === 'system' &&
            (!isSystemLocalCommandMessage(_) || _.isDisplayOnly === true)) ||
          isSyntheticApiErrorMessage(_)
        ) {
          return false
        }
        return true
      },
    )
    .forEach(message => {
      if (!message) return []
      switch (message.type) {
        case 'system': {
          // local_command system messages need to be included as user messages
          // so the model can reference previous command output in later turns
          const userMsg = createUserMessage({
            content: message.content as string | ContentBlockParam[],
            uuid: message.uuid,
            timestamp: message.timestamp as string,
          })
          const lastMessage = last(result)
          if (lastMessage?.type === 'user') {
            result[result.length - 1] = mergeUserMessages(lastMessage, userMsg)
            return
          }
          result.push(userMsg)
          return
        }
        case 'user': {
          // densable KRr — splice GetTask into the API list; skip the
          // notification user row when hosted. Outcomes feed As `_p`.
          let userRow = message
          const delivery =
            'taskDelivery' in userRow ? userRow.taskDelivery : undefined
          if (delivery !== undefined) {
            if (
              trySpliceTaskDelivery(delivery, userRow.uuid, {
                startsTurn: true,
                inDrainPosition: false,
                inHumanTurn: false,
              })
            ) {
              return
            }
            userRow = { ...userRow, taskDelivery: undefined }
          }

          // Merge consecutive user messages because Bedrock doesn't support
          // multiple user messages in a row; 1P API does and merges them
          // into a single user turn

          // densable fXs / $Cn — between-turn API wrap matches mid-turn
          // queued_command tags (system-reminder + NCn). scheduled-trigger
          // stays $Cn only. origin cleared on the API copy (gold `origin:void 0`).
          const hardenedForTaskNotification =
            hardenTaskNotificationForApi(userRow)

          // When tool search is NOT enabled, strip all tool_reference blocks from
          // tool_result content, as these are only valid with the tool search beta.
          // When tool search IS enabled, strip only tool_reference blocks for
          // tools that no longer exist (e.g., MCP server was disconnected).
          let normalizedMessage = hardenedForTaskNotification
          if (!isSearchExtraToolsEnabledOptimistic()) {
            normalizedMessage = stripToolReferenceBlocksFromUserMessage(
              hardenedForTaskNotification,
            )
          } else {
            normalizedMessage = stripUnavailableToolReferencesFromUserMessage(
              hardenedForTaskNotification,
              availableToolNames,
            )
          }

          // Strip document/image blocks from the specific meta user message that
          // preceded a PDF/image/request-too-large error, to prevent re-sending
          // the problematic content on every subsequent API call.
          const typesToStrip = stripTargets.get(normalizedMessage.uuid)
          if (typesToStrip && normalizedMessage.isMeta) {
            const content = normalizedMessage.message.content
            if (Array.isArray(content)) {
              const filtered = content.filter(
                block => !typesToStrip.has(block.type),
              )
              if (filtered.length === 0) {
                // All content blocks were stripped; skip this message entirely
                return
              }
              if (filtered.length < content.length) {
                normalizedMessage = {
                  ...normalizedMessage,
                  message: {
                    ...normalizedMessage.message,
                    content: filtered,
                  },
                }
              }
            }
          }

          // Server renders tool_reference expansion as <functions>...</functions>
          // (same tags as the system prompt's tool block). When this is at the
          // prompt tail, capybara models sample the stop sequence at ~10% (A/B:
          // 21/200 vs 0/200 on v3-prod). A sibling text block inserts a clean
          // "\n\nHuman: ..." turn boundary. Injected here (API-prep) rather than
          // stored in the message so it never renders in the REPL, and is
          // auto-skipped when strip* above removes all tool_reference content.
          // Must be a sibling, NOT inside tool_result.content — mixing text with
          // tool_reference inside the block is a server ValueError.
          // Idempotent: query.ts calls this per-tool-result; the output flows
          // back through here via claude.ts on the next API request. The first
          // pass's sibling gets a \n[id:xxx] suffix from appendMessageTag below,
          // so startsWith matches both bare and tagged forms.
          //
          // Gated OFF when tengu_toolref_defer_j8m is active — that gate
          // enables relocateToolReferenceSiblings in post-processing below,
          // which moves existing siblings to a later non-ref message instead
          // of adding one here. This injection is itself one of the patterns
          // that gets relocated, so skipping it saves a scan. When gate is
          // off, this is the fallback (same as pre-#21049 main).
          if (
            !checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
              'tengu_toolref_defer_j8m',
            )
          ) {
            const contentAfterStrip = normalizedMessage.message.content
            if (
              Array.isArray(contentAfterStrip) &&
              !contentAfterStrip.some(
                b =>
                  b.type === 'text' &&
                  b.text.startsWith(TOOL_REFERENCE_TURN_BOUNDARY),
              ) &&
              contentHasToolReference(contentAfterStrip)
            ) {
              normalizedMessage = {
                ...normalizedMessage,
                message: {
                  ...normalizedMessage.message,
                  content: [
                    ...contentAfterStrip,
                    { type: 'text', text: TOOL_REFERENCE_TURN_BOUNDARY },
                  ],
                },
              }
            }
          }

          // If the last message is also a user message, merge them
          const lastMessage = last(result)
          if (lastMessage?.type === 'user') {
            result[result.length - 1] = mergeUserMessages(
              lastMessage,
              normalizedMessage,
            )
            return
          }

          // Otherwise, add the message normally
          result.push(normalizedMessage)
          return
        }
        case 'assistant': {
          // Normalize tool inputs for API (strip fields like plan from ExitPlanModeV2)
          // When tool search is NOT enabled, we must strip tool_search-specific fields
          // like 'caller' from tool_use blocks, as these are only valid with the
          // tool search beta header
          const searchExtraToolsEnabled = isSearchExtraToolsEnabledOptimistic()
          // densable B=eHr(j.message.content, j.batchToolUses, t) then walk B
          const rawAssistantContent = Array.isArray(message.message.content)
            ? message.message.content
            : []
          const reassembledContent = reassembleBatchedToolUses(
            rawAssistantContent,
            message.batchToolUses,
            tools,
          )
          const normalizedMessage: AssistantMessage = {
            ...message,
            message: {
              ...message.message,
              content: reassembledContent.map(block => {
                if (typeof block === 'string') return block
                if (block.type === 'tool_use') {
                  const toolUseBlk = block as ToolUseBlock
                  const tool = tools.find(t =>
                    toolMatchesName(t, toolUseBlk.name),
                  )
                  const normalizedInput = tool
                    ? normalizeToolInputForAPI(
                        tool,
                        toolUseBlk.input as Record<string, unknown>,
                      )
                    : toolUseBlk.input
                  const canonicalName = tool?.name ?? toolUseBlk.name

                  // When tool search is enabled, preserve all fields including 'caller'
                  if (searchExtraToolsEnabled) {
                    return {
                      ...block,
                      name: canonicalName,
                      input: normalizedInput,
                    }
                  }

                  // When tool search is NOT enabled, strip tool-search-only fields
                  // like 'caller', but preserve other provider metadata attached to
                  // the block (for example Gemini thought signatures on tool_use).
                  const { caller: _caller, ...toolUseRest } =
                    block as ToolUseBlock &
                      Record<string, unknown> & { caller?: unknown }
                  return {
                    ...toolUseRest,
                    type: 'tool_use' as const,
                    id: toolUseBlk.id,
                    name: canonicalName,
                    input: normalizedInput,
                  }
                }
                return block
              }),
            },
          }

          // densable 2.1.216 LN: Map lookup (linear) instead of reverse walk.
          // tool_result users + api_system are transparent; real users clear.
          advanceAssistantIdMap()
          const mergeIdx = assistantIdToIndex.get(
            normalizedMessage.message.id ?? '',
          )
          if (
            mergeIdx !== undefined &&
            result[mergeIdx]?.type === 'assistant'
          ) {
            result[mergeIdx] = mergeAssistantMessages(
              result[mergeIdx] as AssistantMessage,
              normalizedMessage,
            )
            return
          }

          // densable I() — flush meta buffer before a new assistant turn
          flushMetaBuffer()
          result.push(normalizedMessage)
          return
        }
        case 'attachment': {
          // densable KRr drain — attachment.taskDelivery, startsTurn:false.
          const att = message.attachment as Attachment & {
            taskDelivery?: unknown
          }
          if (att.type === 'queued_command' && att.taskDelivery !== undefined) {
            if (
              trySpliceTaskDelivery(att.taskDelivery, message.uuid, {
                startsTurn: false,
                inDrainPosition: drainDeliveryIds.has(message.uuid),
                inHumanTurn: humanTurnDeliveryIds.has(message.uuid),
              })
            ) {
              return
            }
          }
          // densable: D && !o → drop batching_reminder (resume safety)
          const isBatchingReminder =
            message.attachment.type === 'batching_reminder'
          if (isBatchingReminder && !midConvEnabled) {
            return
          }
          const rawAttachmentMessage = normalizeAttachmentForAPI(
            message.attachment as Attachment,
          )
          // densable: l6s(B) on raw B before chair O5s; E.push(i?El(G):G)
          // #1674 (Dyi / QFo): keep prompt.submit / prompt.mention hook_additional_context in user turn
          if (
            midConvEnabled &&
            !isPromptHookAdditionalContextAttachment(
              message.attachment as Attachment,
            )
          ) {
            const pure = extractPureTextFromUserMessages(rawAttachmentMessage)
            if (pure !== null) {
              metaBuffer.push(
                skipSystemReminderWrap ? wrapInSystemReminder(pure) : pure,
              )
              if (isBatchingReminder) pendingBatchingReminderEphemeral = true
              return
            }
          }
          const attachmentMessage = checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
            'tengu_chair_sermon',
          )
            ? rawAttachmentMessage.map(ensureSystemReminderWrap)
            : rawAttachmentMessage

          // If the last message is also a user message, merge them
          const lastMessage = last(result)
          if (lastMessage?.type === 'user') {
            result[result.length - 1] = attachmentMessage.reduce(
              (p, c) => mergeUserMessagesAndToolResults(p, c),
              lastMessage,
            )
            return
          }

          result.push(...attachmentMessage)
          return
        }
      }
    })

  // densable end-of-loop I() flush residual meta buffer
  flushMetaBuffer()

  // Official fG/b6s/pG/S6s walk mixed v (api_system is transparent).
  type NormMsg = NormalizedApiMessage

  // Relocate text siblings off tool_reference messages — prevents the
  // anomalous two-consecutive-human-turns pattern that teaches the model
  // to emit the stop sequence after tool results. See #21049.
  // Runs after merge (siblings are in place) and before ID tagging (so
  // tags reflect final positions). When gate is OFF, this is a noop and
  // the TOOL_REFERENCE_TURN_BOUNDARY injection above serves as fallback.
  const relocated = checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
    'tengu_toolref_defer_j8m',
  )
    ? relocateToolReferenceSiblings(result)
    : result

  // Filter orphaned thinking-only assistant messages (likely introduced by
  // compaction slicing away intervening messages between a failed streaming
  // response and its retry). Without this, consecutive assistant messages with
  // mismatched thinking block signatures cause API 400 errors.
  // Official 2.1.328 (`chunk@294254613.js:5951380-5951460`):
  // `Rl = rXo(Lr, preserveTrailingThinking); ba = Rl.length === Lr.length ? Rl : kTe(Rl)`
  // Dropping an assistant between two users leaves consecutive user messages
  // that must be merged immediately to preserve role alternation.
  const withFilteredOrphans = filterOrphanedThinkingOnlyMessages(
    relocated as Message[],
    options?.preserveTrailingThinking,
  ) as NormMsg[]
  const withMergedOrphans =
    withFilteredOrphans.length === relocated.length
      ? withFilteredOrphans
      : mergeAdjacentUserMessages(withFilteredOrphans)

  // Order matters: strip trailing thinking first, THEN filter whitespace-only
  // messages. The reverse order has a bug: a message like [text("\n\n"), thinking("...")]
  // survives the whitespace filter (has a non-text block), then thinking stripping
  // removes the thinking block, leaving [text("\n\n")] — which the API rejects.
  //
  // These multi-pass normalizations are inherently fragile — each pass can create
  // conditions a prior pass was meant to handle. Consider unifying into a single
  // pass that cleans content, then validates in one shot.
  const withFilteredThinking = filterTrailingThinkingFromLastAssistant(
    withMergedOrphans,
    options?.preserveTrailingThinking,
  )
  const withFilteredWhitespace = filterWhitespaceOnlyAssistantMessages(
    withFilteredThinking as Message[],
  ) as NormMsg[]
  const W = ensureNonEmptyAssistantContent(withFilteredWhitespace)

  // densable tail @217936570:
  //   if (o) H = R ? W5s(W, i) : W
  //   else if (chair_sermon) H = leo(peo(W))
  //   else H = W
  //   let te = $5s(H); return tHr(te, t)
  // R = emittedApiSystem (flush created api_system after a user).
  let H: NormMsg[] = W
  if (midConvEnabled) {
    if (emittedApiSystem) {
      const folded = demoteOrphanApiSystemMessages(W, {
        createUserMeta: content =>
          createUserMessage({ content, isMeta: true }) as NormMsg,
        wrapSystemReminder: wrapInSystemReminder,
        skipSystemReminderWrap,
      })
      // densable W5s: return n ? peo(n) : e
      if (folded !== W) {
        const peo: NormMsg[] = []
        for (const m of folded) {
          const prev = peo.at(-1)
          if (m.type === 'user' && prev?.type === 'user') {
            peo[peo.length - 1] = mergeUserMessages(prev, m)
          } else {
            peo.push(m)
          }
        }
        H = peo
      }
    }
  } else if (
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_chair_sermon')
  ) {
    H = smooshSystemReminderSiblings(mergeAdjacentUserMessages(W))
  }
  const te = sanitizeErrorToolResultContent(H)
  const sanitized = mergeBatchedToolResults(te, tools)

  // Append message ID tags for snip tool visibility (after all merging,
  // so tags always match the surviving message's messageId field).
  // Skip in test mode — tags change message content hashes, breaking
  // VCR fixture lookup. Gate must match SnipTool.isEnabled() — don't
  // inject [id:] tags when the tool isn't available (confuses the model
  // and wastes tokens on every non-meta user message for every ant).
  if (feature('HISTORY_SNIP') && process.env.NODE_ENV !== 'test') {
    const { isSnipRuntimeEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/compact/snipCompact.js') as typeof import('../../services/compact/snipCompact.js')
    if (isSnipRuntimeEnabled()) {
      for (let i = 0; i < sanitized.length; i++) {
        if (sanitized[i]!.type === 'user') {
          sanitized[i] = appendMessageTagToUserMessage(
            sanitized[i] as UserMessage,
          )
        }
      }
    }
  }

  // Validate all images are within API size limits before sending
  validateImagesForAPI(
    sanitized.filter(
      (m): m is UserMessage | AssistantMessage => m.type !== 'api_system',
    ),
  )

  return sanitized
}
