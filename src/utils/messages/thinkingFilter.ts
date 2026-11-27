/**
 * Thinking block filtering, whitespace-only assistant message filtering, non-empty content enforcement, and signature stripping.
 */

import type {
  BetaContentBlock,
  BetaRedactedThinkingBlock,
  BetaThinkingBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlock,
  ContentBlockParam,
  RedactedThinkingBlock,
  RedactedThinkingBlockParam,
  ThinkingBlock,
  ThinkingBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { feature } from 'bun:bundle'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import { isConnectorTextBlock } from '../../types/connectorText.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import { isSyntheticApiErrorMessage } from './constants.js'
import {
  type NormalizedApiMessage,
  mergeUserMessages,
} from './messageMerging.js'

type ThinkingBlockType =
  | ThinkingBlock
  | RedactedThinkingBlock
  | ThinkingBlockParam
  | RedactedThinkingBlockParam
  | BetaThinkingBlock
  | BetaRedactedThinkingBlock

function isThinkingBlock(
  block: ContentBlockParam | ContentBlock | BetaContentBlock,
): block is ThinkingBlockType {
  return block.type === 'thinking' || block.type === 'redacted_thinking'
}

/**
 * Filter trailing thinking blocks from the last message if it's an assistant message.
 * The API doesn't allow assistant messages to end with thinking/redacted_thinking blocks.
 */
export function filterTrailingThinkingFromLastAssistant(
  messages: NormalizedApiMessage[],
  preserveTrailingThinking = false,
): NormalizedApiMessage[] {
  const lastMessage = messages.at(-1)
  if (!lastMessage || lastMessage.type !== 'assistant') {
    // Last message is not assistant, nothing to filter
    return messages
  }

  const content = lastMessage.message.content
  if (!Array.isArray(content)) return messages
  const lastBlock = content.at(-1)
  if (
    !lastBlock ||
    typeof lastBlock === 'string' ||
    !isThinkingBlock(lastBlock)
  ) {
    return messages
  }
  if (preserveTrailingThinking) {
    return messages
  }

  // Find last non-thinking block
  let lastValidIndex = content.length - 1
  while (lastValidIndex >= 0) {
    const block = content[lastValidIndex]
    if (!block || typeof block === 'string' || !isThinkingBlock(block)) {
      break
    }
    lastValidIndex--
  }

  logEvent('tengu_filtered_trailing_thinking_block', {
    messageUUID:
      lastMessage.uuid as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    blocksRemoved: content.length - lastValidIndex - 1,
    remainingBlocks: lastValidIndex + 1,
  })

  // Insert placeholder if all blocks were thinking
  const filteredContent =
    lastValidIndex < 0
      ? [{ type: 'text' as const, text: '[No message content]', citations: [] }]
      : content.slice(0, lastValidIndex + 1)

  const result = [...messages]
  result[messages.length - 1] = {
    ...lastMessage,
    message: {
      ...lastMessage.message,
      content: filteredContent,
    },
  }
  return result
}

const EMPTY_TEXT_REMOVED_PLACEHOLDER = '[Empty text removed]'

/**
 * Official 2.1.328 `A9e` (`chunk@294254613.js:6064800`):
 * Check if an assistant message has only whitespace / placeholder text content
 * (optionally preceded by leading `thinking` / `redacted_thinking` blocks).
 * Returns false for pure thinking-only arrays (must contain at least one text block)
 * and false if any substantive text or non-text block (like `tool_use`) is present.
 */
function hasOnlyWhitespaceTextContent(
  content: Array<{ type: string; text?: string }>,
): boolean {
  let hasTextBlock = false
  for (const block of content) {
    if (
      !hasTextBlock &&
      (block.type === 'thinking' || block.type === 'redacted_thinking')
    ) {
      continue
    }
    if (block.type !== 'text') {
      return false
    }
    const trimmed = block.text?.trim()
    if (
      trimmed !== undefined &&
      trimmed !== '' &&
      trimmed !== NO_CONTENT_MESSAGE &&
      trimmed !== EMPTY_TEXT_REMOVED_PLACEHOLDER
    ) {
      return false
    }
    hasTextBlock = true
  }
  return hasTextBlock
}

/**
 * Official 2.1.328 `NBe` (`chunk@283138841.js:60253`):
 * True when an assistant content block carries substantive non-thinking content
 * (any non-text block such as `tool_use`, or non-whitespace/non-placeholder text).
 */
function isSubstantiveAssistantBlock(block: {
  type: string
  text?: string
}): boolean {
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return false
  }
  if (block.type !== 'text') {
    return true
  }
  const trimmed = (block.text ?? '').trim()
  return (
    trimmed !== '' &&
    trimmed !== NO_CONTENT_MESSAGE &&
    trimmed !== EMPTY_TEXT_REMOVED_PLACEHOLDER
  )
}

/**
 * Official 2.1.328 `J3o` (`chunk@294254613.js:6065140`):
 * Collect `message.id`s of assistant messages that carry at least one
 * substantive block (`tool_use`, real text, etc.) across any split sibling row.
 */
function getSubstantiveAssistantMessageIds(
  messages: readonly Message[],
): Set<string> {
  const protectedIds = new Set<string>()
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.message?.id) continue
    const content = msg.message.content
    if (!Array.isArray(content)) continue
    if (
      (content as Array<{ type: string; text?: string }>).some(
        isSubstantiveAssistantBlock,
      )
    ) {
      protectedIds.add(msg.message.id as string)
    }
  }
  return protectedIds
}

/**
 * Official 2.1.328 `Z3o` (`chunk@294254613.js:6065700`):
 * Filter out assistant messages with only whitespace-only / placeholder text
 * content (including `[thinking, "\n\n"]`), while protecting split assistant
 * rows whose `message.id` also carries substantive content (`J3o`).
 */
export function filterWhitespaceOnlyAssistantMessages(
  messages: (UserMessage | AssistantMessage)[],
  options?: { mergeAdjacentUsers?: boolean },
): (UserMessage | AssistantMessage)[]

export function filterWhitespaceOnlyAssistantMessages(
  messages: Message[],
  options?: { mergeAdjacentUsers?: boolean },
): Message[]

export function filterWhitespaceOnlyAssistantMessages(
  messages: Message[],
  options: { mergeAdjacentUsers?: boolean } = {},
): Message[] {
  let candidateFound = false
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content) || content.length === 0) continue
    if (
      hasOnlyWhitespaceTextContent(
        content as Array<{ type: string; text?: string }>,
      )
    ) {
      candidateFound = true
      break
    }
  }
  if (!candidateFound) {
    return messages
  }

  const protectedIds = getSubstantiveAssistantMessageIds(messages)
  let hasChanges = false

  const filtered = messages.filter(message => {
    if (message.type !== 'assistant') {
      return true
    }
    if (message.message?.id && protectedIds.has(message.message.id as string)) {
      return true
    }

    const content = message.message?.content
    if (!Array.isArray(content) || content.length === 0) {
      return true
    }

    if (
      hasOnlyWhitespaceTextContent(
        content as Array<{ type: string; text?: string }>,
      )
    ) {
      hasChanges = true
      logEvent('tengu_filtered_whitespace_only_assistant', {
        messageUUID:
          message.uuid as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return false
    }

    return true
  })

  if (!hasChanges) {
    return messages
  }

  if (options.mergeAdjacentUsers === false) {
    return filtered
  }

  // Removing assistant messages may leave adjacent user messages that need
  // merging (the API requires alternating user/assistant roles). Never merge
  // across `interruptedByShutdown` boundaries (official `Z3o`).
  const merged: Message[] = []
  for (const message of filtered) {
    const prev = merged.at(-1)
    if (
      message.type === 'user' &&
      prev?.type === 'user' &&
      !(message as UserMessage).interruptedByShutdown &&
      !(prev as UserMessage).interruptedByShutdown
    ) {
      merged[merged.length - 1] = mergeUserMessages(
        prev as UserMessage,
        message as UserMessage,
      ) // lvalue
    } else {
      merged.push(message)
    }
  }
  return merged
}

/**
 * Ensure all non-final assistant messages have non-empty content.
 *
 * The API requires "all messages must have non-empty content except for the
 * optional final assistant message". This can happen when the model returns
 * an empty content array.
 *
 * For non-final assistant messages with empty content, we insert a placeholder.
 * The final assistant message is left as-is since it's allowed to be empty (for prefill).
 *
 * Note: Whitespace-only text content is handled separately by filterWhitespaceOnlyAssistantMessages.
 */
export function ensureNonEmptyAssistantContent(
  messages: NormalizedApiMessage[],
): NormalizedApiMessage[] {
  if (messages.length === 0) {
    return messages
  }

  let hasChanges = false
  const result = messages.map((message, index) => {
    // Skip non-assistant messages
    if (message.type !== 'assistant') {
      return message
    }

    // Skip the final message (allowed to be empty for prefill)
    if (index === messages.length - 1) {
      return message
    }

    // Check if content is empty
    const content = message.message.content
    if (Array.isArray(content) && content.length === 0) {
      hasChanges = true
      logEvent('tengu_fixed_empty_assistant_content', {
        messageUUID:
          message.uuid as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        messageIndex: index,
      })

      return {
        ...message,
        message: {
          ...message.message,
          content: [
            { type: 'text' as const, text: NO_CONTENT_MESSAGE, citations: [] },
          ],
        },
      }
    }

    return message
  })

  return hasChanges ? result : messages
}

/**
 * Filter orphaned thinking-only assistant messages.
 *
 * During streaming, each content block is yielded as a separate message with the same
 * message.id. When messages are loaded for resume, interleaved user messages or attachments
 * can prevent proper merging by message.id, leaving orphaned assistant messages that contain
 * only thinking blocks. These cause "thinking blocks cannot be modified" API errors.
 *
 * A thinking-only message is "orphaned" if there is NO other assistant message with the
 * same message.id that contains non-thinking content (text, tool_use, etc). If such a
 * message exists, the thinking block will be merged with it in normalizeMessagesForAPI().
 */
const TRANSPARENT_THINKING_FILTER_ATTACHMENT_TYPES = new Set([
  'thinking_drop',
  'tool_results_cut',
  'credential_org',
  'tool_offer_record',
  'prompt_snapshot',
  'prompt_render_point',
  'whole_texts_withdrawn',
  'deferred_tools_record',
])

/**
 * Official 2.1.328 `Uf` (`chunk@283138841.js:60416`): non-conversational rows
 * skipped when looking ahead/behind in `filterOrphanedThinkingOnlyMessages`.
 */
function isTransparentForThinkingFilter(msg: Message): boolean {
  if ((msg.type as string) === 'api_system') return false
  if (msg.type === 'progress') return true
  if (msg.type === 'system') {
    const sys = msg as { subtype?: unknown; isDisplayOnly?: unknown }
    return sys.subtype !== 'local_command' || sys.isDisplayOnly === true
  }
  if (
    (msg.type === 'user' || msg.type === 'assistant') &&
    (msg as { isVirtual?: unknown }).isVirtual === true
  ) {
    return true
  }
  if (isSyntheticApiErrorMessage(msg)) {
    return true
  }
  if (msg.type === 'attachment') {
    const attType = (msg.attachment as { type?: unknown } | undefined)?.type
    return (
      typeof attType === 'string' &&
      TRANSPARENT_THINKING_FILTER_ATTACHMENT_TYPES.has(attType)
    )
  }
  return false
}

/**
 * Official 2.1.328 `oXo` (`chunk@294254613.js:6068173`): thinking-only assistant
 * row containing at least one unsigned `thinking` block.
 */
function isUnsignedThinkingOnlyAssistant(msg: Message): boolean {
  if (msg.type !== 'assistant') return false
  const content = msg.message?.content
  if (!Array.isArray(content) || content.length === 0) return false
  const blocks = content as Array<{ type: string; signature?: unknown }>
  return (
    blocks.every(
      b => b.type === 'thinking' || b.type === 'redacted_thinking',
    ) && blocks.some(b => b.type === 'thinking' && !b.signature)
  )
}

/**
 * Official 2.1.328 `Dze`: assistant message abandoned by a stream retry or
 * holding only unsigned thinking blocks.
 */
function isAbandonedOrUnsignedThinking(msg: Message): boolean {
  return (
    (msg.type === 'assistant' &&
      (msg.message as { abandonedByStreamRetry?: unknown } | undefined)
        ?.abandonedByStreamRetry === true) ||
    isUnsignedThinkingOnlyAssistant(msg)
  )
}

function collectAssistantMessageIdsWithNonThinkingContent(
  messages: readonly Message[],
): Set<string> {
  const ids = new Set<string>()
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.message?.id) continue
    const content = msg.message.content
    if (
      Array.isArray(content) &&
      (content as Array<{ type: string }>).some(
        b => b.type !== 'thinking' && b.type !== 'redacted_thinking',
      )
    ) {
      ids.add(msg.message.id as string)
    }
  }
  return ids
}

/**
 * Official 2.1.328 `rXo` (`chunk@294254613.js:6068500`):
 * Filter orphaned thinking-only assistant messages.
 *
 * Handles:
 * - Same-`message.id` sibling with non-thinking content (`Nqi`)
 * - `preserveTrailingThinking` (keeps last live thinking-only message unless
 *   abandoned by stream retry or carrying unsigned thinking blocks)
 * - `resumedFromIncompleteThinking === true` continuation bridging (skipping
 *   transparent & abandoned/unsigned rows, refusing to bridge into an
 *   unprotected whitespace-only assistant row)
 * - `abandonedByStreamRetry === true` and unsigned thinking blocks (`Dze`/`oXo`)
 */
export function filterOrphanedThinkingOnlyMessages(
  messages: (UserMessage | AssistantMessage)[],
  preserveTrailingThinking?: boolean,
): (UserMessage | AssistantMessage)[]

export function filterOrphanedThinkingOnlyMessages(
  messages: Message[],
  preserveTrailingThinking?: boolean,
): Message[]

export function filterOrphanedThinkingOnlyMessages(
  messages: Message[],
  preserveTrailingThinking = false,
): Message[] {
  let messageIdsWithNonThinking: Set<string> | undefined
  let substantiveAssistantIds: Set<string> | undefined
  const keep: boolean[] = []

  let lastLiveIdx = messages.length - 1
  while (
    lastLiveIdx >= 0 &&
    (isTransparentForThinkingFilter(messages[lastLiveIdx]!) ||
      isAbandonedOrUnsignedThinking(messages[lastLiveIdx]!))
  ) {
    lastLiveIdx--
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    const content = msg.type === 'assistant' ? msg.message?.content : undefined
    if (
      msg.type !== 'assistant' ||
      !Array.isArray(content) ||
      content.length === 0 ||
      (content as Array<{ type: string }>).some(
        block =>
          block.type !== 'thinking' && block.type !== 'redacted_thinking',
      )
    ) {
      keep[i] = true
      continue
    }

    let nextIdx = i + 1
    while (
      nextIdx < messages.length &&
      (isTransparentForThinkingFilter(messages[nextIdx]!) ||
        isAbandonedOrUnsignedThinking(messages[nextIdx]!))
    ) {
      nextIdx++
    }
    const nextMsg = messages[nextIdx]

    const hasSiblingWithContent =
      msg.message?.id !== undefined &&
      (messageIdsWithNonThinking ??=
        collectAssistantMessageIdsWithNonThinkingContent(messages)).has(
        msg.message.id as string,
      )

    const isPreservedTrailing = preserveTrailingThinking && i === lastLiveIdx

    const bridgesToResumedAssistant =
      nextMsg?.type === 'assistant' &&
      (nextMsg as { resumedFromIncompleteThinking?: unknown })
        .resumedFromIncompleteThinking === true &&
      keep[nextIdx] === true &&
      !(
        Array.isArray(nextMsg.message?.content) &&
        hasOnlyWhitespaceTextContent(
          nextMsg.message.content as Array<{ type: string; text?: string }>,
        ) &&
        !(
          nextMsg.message?.id !== undefined &&
          (substantiveAssistantIds ??=
            getSubstantiveAssistantMessageIds(messages)).has(
            nextMsg.message.id as string,
          )
        )
      ) &&
      !isAbandonedOrUnsignedThinking(msg)

    keep[i] =
      hasSiblingWithContent || isPreservedTrailing || bridgesToResumedAssistant
  }

  let filtered: Message[] | undefined
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.type !== 'assistant' || keep[i]) {
      filtered?.push(msg)
      continue
    }
    const content = msg.message?.content
    logEvent('tengu_filtered_orphaned_thinking_message', {
      messageUUID:
        msg.uuid as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageId: msg.message
        ?.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      blockCount: Array.isArray(content) ? content.length : 0,
    })
    if (!filtered) {
      filtered = messages.slice(0, i)
    }
  }

  return filtered ?? messages
}

/**
 * Official 2.1.328 `C4` (`chunk@294254613.js:6065295`):
 * Iterate `filterOrphanedThinkingOnlyMessages` (`rXo`) +
 * `filterWhitespaceOnlyAssistantMessages(..., { mergeAdjacentUsers: false })`
 * (`Z3o`) to a fixpoint so cascading orphans exposed by whitespace removal
 * (or vice versa) are fully eliminated.
 */
export function filterOrphanedThinkingAndWhitespaceMessages(
  messages: Message[],
  preserveTrailingThinking = false,
): Message[] {
  let current = messages
  for (;;) {
    const next = filterWhitespaceOnlyAssistantMessages(
      filterOrphanedThinkingOnlyMessages(current, preserveTrailingThinking),
      { mergeAdjacentUsers: false },
    )
    if (next.length === current.length) {
      return current
    }
    current = next
  }
}

/**
 * Strip signature-bearing blocks (thinking, redacted_thinking, connector_text)
 * from all assistant messages. Their signatures are bound to the API key that
 * generated them; after a credential change (e.g. /login) they're invalid and
 * the API rejects them with a 400.
 */
export function stripSignatureBlocks(messages: Message[]): Message[] {
  let changed = false
  const result = messages.map(msg => {
    if (msg.type !== 'assistant') return msg

    const content = (msg as AssistantMessage).message.content
    if (!Array.isArray(content)) return msg

    const filtered = content.filter(block => {
      if (isThinkingBlock(block)) return false
      if (feature('CONNECTOR_TEXT')) {
        if (isConnectorTextBlock(block)) return false
      }
      return true
    })
    if (filtered.length === content.length) return msg

    // Strip to [] even for thinking-only messages. Streaming yields each
    // content block as a separate same-id AssistantMessage (claude.ts:2150),
    // so a thinking-only singleton here is usually a split sibling that
    // mergeAssistantMessages (2232) rejoins with its text/tool_use partner.
    // If we returned the original message, the stale signature would survive
    // the merge. Empty content is absorbed by merge; true orphans are handled
    // by the empty-content placeholder path in normalizeMessagesForAPI.

    changed = true
    return {
      ...msg,
      message: { ...msg.message, content: filtered },
    } as typeof msg
  })

  return changed ? result : messages
}
