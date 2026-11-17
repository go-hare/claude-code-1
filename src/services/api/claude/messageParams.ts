import type {
  BetaContentBlockParam,
  BetaMessageParam as MessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { feature } from 'bun:bundle'
import type { QuerySource } from 'src/constants/querySource.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isConnectorTextBlock } from '../../../types/connectorText.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../types/message.js'
import { insertBlockAfterToolResults } from '../../../utils/contentArray.js'
import {
  type ApiSystemMessage,
  isApiSystemMessage,
  shouldCacheControlOnApiSystem,
} from '../../../utils/midConversationSystem.js'
import type { PromptCacheTtl } from '../../../utils/promptCacheTtl.js'
import { logEvent } from '../../analytics/index.js'
import { pinCacheEdits } from '../../compact/microCompact.js'
import { getCacheControl } from './promptCaching.js'

/** densable DWT — last assistant message.id with requestId and not API error. */
export function lastAssistantMessageId(
  messages: Message[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.type !== 'assistant') continue
    const assistant = msg as AssistantMessage
    if (!assistant.requestId || assistant.isApiErrorMessage) continue
    const id = assistant.message?.id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return undefined
}

/**
 * Deriving this from the message array (rather than global state) ensures each
 * query chain (main thread, subagent, teammate) tracks its own request chain
 * independently, and rollback/undo naturally updates the value.
 */
export function getPreviousRequestIdFromMessages(
  messages: Message[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && msg.requestId) {
      return msg.requestId as string
    }
  }
  return undefined
}

export function userMessageToMessageParam(
  message: UserMessage,
  addCache = false,
  enablePromptCaching: boolean,
  querySource?: QuerySource,
  agentCacheTtlOverride?: PromptCacheTtl,
): MessageParam {
  if (addCache) {
    if (typeof message.message!.content === 'string') {
      return {
        role: 'user',
        content: [
          {
            type: 'text',
            text: message.message!.content,
            ...(enablePromptCaching && {
              cache_control: getCacheControl({
                querySource,
                agentCacheTtlOverride,
              }),
            }),
          },
        ],
      }
    } else {
      return {
        role: 'user',
        content: message.message!.content!.map((_, i) => ({
          ..._,
          ...(i === message.message!.content!.length - 1
            ? enablePromptCaching
              ? {
                  cache_control: getCacheControl({
                    querySource,
                    agentCacheTtlOverride,
                  }),
                }
              : {}
            : {}),
        })),
      }
    }
  }
  // Clone array content to prevent in-place mutations (e.g., insertCacheEditsBlock's
  // splice) from contaminating the original message. Without cloning, multiple calls
  // to addCacheBreakpoints share the same array and each splices in duplicate cache_edits.
  return {
    role: 'user',
    content: (Array.isArray(message.message!.content)
      ? [...message.message!.content]
      : message.message!
          .content) as import('@anthropic-ai/sdk/resources/beta/messages/messages.js').BetaContentBlockParam[],
  }
}

export function assistantMessageToMessageParam(
  message: AssistantMessage,
  addCache = false,
  enablePromptCaching: boolean,
  querySource?: QuerySource,
  agentCacheTtlOverride?: PromptCacheTtl,
): MessageParam {
  if (addCache) {
    if (typeof message.message!.content === 'string') {
      return {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: message.message!.content,
            ...(enablePromptCaching && {
              cache_control: getCacheControl({
                querySource,
                agentCacheTtlOverride,
              }),
            }),
          },
        ],
      }
    } else {
      return {
        role: 'assistant',
        content: message.message!.content!.map((_, i) => {
          const contentBlock = stripGeminiProviderMetadata(_)
          return {
            ...contentBlock,
            ...(i === message.message!.content!.length - 1 &&
            contentBlock.type !== 'thinking' &&
            contentBlock.type !== 'redacted_thinking' &&
            (feature('CONNECTOR_TEXT')
              ? !isConnectorTextBlock(contentBlock)
              : true)
              ? enablePromptCaching
                ? {
                    cache_control: getCacheControl({
                      querySource,
                      agentCacheTtlOverride,
                    }),
                  }
                : {}
              : {}),
          }
        }),
      }
    }
  }
  return {
    role: 'assistant',
    content:
      typeof message.message!.content === 'string'
        ? message.message!.content
        : (message.message!.content!.map(
            stripGeminiProviderMetadata,
          ) as BetaContentBlockParam[]),
  }
}

function stripGeminiProviderMetadata<T extends BetaContentBlockParam | string>(
  contentBlock: T,
): T {
  if (
    typeof contentBlock === 'string' ||
    !('_geminiThoughtSignature' in (contentBlock as object))
  ) {
    return contentBlock
  }

  const obj = contentBlock as unknown as Record<string, unknown>
  const { _geminiThoughtSignature: _unusedGeminiThoughtSignature, ...rest } =
    obj
  return rest as unknown as T
}

/**
 * Append a `<system-reminder>` text block to the last user message in the
 * batch instead of creating a standalone user message.
 *
 * Why this exists — bug background:
 * A standalone SR-only user message at the end of the request triggers a
 * known bare-ack failure mode: the model emits a single "OK" / "Got it."
 * because the last user-role turn carries no real user text, just an
 * instruction-shaped reminder. Wrapping the reminder onto a real user turn
 * keeps the conversation from ever ending on a "fake" user message.
 *
 * Behavior:
 * - Tail is a user message → append the SR text as a content block.
 *   - String content: hoist to a 2-block array (original text + SR block).
 *   - Array content: append the SR block. If the array contains a
 *     tool_result, smooshSystemReminderSiblings (utils/messages.ts) will
 *     later fold this SR text into that tool_result. Otherwise it lands
 *     as a sibling text block on the same user turn. Either way, it is
 *     not a turn of its own.
 * - Tail is an assistant message (e.g. mid tool_use) or list is empty →
 *   skip. The next user turn will re-enter the inject branch and attach
 *   correctly.
 */
export function appendSystemReminderToLastUserMessage(
  messages: (UserMessage | AssistantMessage)[],
  srText: string,
): (UserMessage | AssistantMessage)[] {
  const lastIdx = messages.length - 1
  const last = lastIdx >= 0 ? messages[lastIdx] : undefined
  if (!last || last.message.role !== 'user') return messages
  const existing = last.message.content
  const srBlock: TextBlockParam = { type: 'text', text: srText }
  const newContent: ContentBlockParam[] = Array.isArray(existing)
    ? [...(existing as ContentBlockParam[]), srBlock]
    : [{ type: 'text', text: existing ?? '' }, srBlock]
  return [
    ...messages.slice(0, lastIdx),
    {
      ...last,
      message: { ...last.message, content: newContent },
    },
  ]
}

function isToolResultBlock(
  block: unknown,
): block is { type: 'tool_result'; tool_use_id: string } {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as { type: string }).type === 'tool_result' &&
    'tool_use_id' in block
  )
}

type CachedMCEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

type CachedMCPinnedEdits = {
  userMessageIndex: number
  block: CachedMCEditsBlock
}

// Exported for testing cache_reference placement constraints
export function addCacheBreakpoints(
  messages: (UserMessage | AssistantMessage | ApiSystemMessage)[],
  enablePromptCaching: boolean,
  querySource?: QuerySource,
  useCachedMC = false,
  newCacheEdits?: CachedMCEditsBlock | null,
  pinnedEdits?: CachedMCPinnedEdits[],
  skipCacheWrite = false,
  agentCacheTtlOverride?: PromptCacheTtl,
): MessageParam[] {
  // densable Jdy / SEA eDT canMarkApiSystem: prefer cache_control on trailing
  // nonempty api_system when !demote && !dje() && provider/base-URL eligible.
  const allowApiSystemCache = shouldCacheControlOnApiSystem()

  const isCacheableAssistant = (m: (typeof messages)[number]): boolean => {
    if (m.type !== 'assistant') return true
    const v = m.message.content
    if (typeof v === 'string') return true
    const last = Array.isArray(v) ? v.at(-1) : undefined
    return (
      last !== undefined &&
      last.type !== 'thinking' &&
      last.type !== 'redacted_thinking'
    )
  }
  const findCacheableIndex = (from: number): number => {
    let v = from
    while (
      v >= 0 &&
      (isApiSystemMessage(messages[v]!) || !isCacheableAssistant(messages[v]!))
    ) {
      v--
    }
    return v
  }
  let markerIndex = findCacheableIndex(messages.length - 1)
  if (skipCacheWrite) {
    markerIndex = findCacheableIndex(markerIndex - 1)
  }
  const last = messages[messages.length - 1]
  const trailingApiSystem =
    last !== undefined &&
    isApiSystemMessage(last) &&
    typeof last.message.content === 'string' &&
    last.message.content.trim() !== ''
  // densable: c && t && !n && l>=0 && p → prefer last index (api_system)
  if (
    allowApiSystemCache &&
    enablePromptCaching &&
    !skipCacheWrite &&
    markerIndex >= 0 &&
    trailingApiSystem
  ) {
    markerIndex = messages.length - 1
  }

  logEvent('tengu_api_cache_breakpoints', {
    totalMessageCount: messages.length,
    cachingEnabled: enablePromptCaching,
    skipCacheWrite,
  })

  const result = messages.map((msg, index) => {
    const addCache = index === markerIndex
    if (isApiSystemMessage(msg)) {
      // densable: role:"system" + optional cache_control on text block
      const text = msg.message.content
      if (addCache && enablePromptCaching && allowApiSystemCache) {
        return {
          role: 'system' as const,
          content: [
            {
              type: 'text' as const,
              text,
              cache_control: getCacheControl({
                querySource,
                agentCacheTtlOverride,
              }),
            },
          ],
        } as unknown as MessageParam
      }
      return {
        role: 'system' as const,
        content: text || [],
      } as unknown as MessageParam
    }
    if (msg.type === 'user') {
      return userMessageToMessageParam(
        msg,
        addCache,
        enablePromptCaching,
        querySource,
        agentCacheTtlOverride,
      )
    }
    return assistantMessageToMessageParam(
      msg,
      addCache,
      enablePromptCaching,
      querySource,
      agentCacheTtlOverride,
    )
  })

  if (!useCachedMC) {
    return result
  }

  // Track all cache_references being deleted to prevent duplicates across blocks.
  const seenDeleteRefs = new Set<string>()

  // Helper to deduplicate a cache_edits block against already-seen deletions
  const deduplicateEdits = (block: CachedMCEditsBlock): CachedMCEditsBlock => {
    const uniqueEdits = block.edits.filter(edit => {
      if (seenDeleteRefs.has(edit.cache_reference)) {
        return false
      }
      seenDeleteRefs.add(edit.cache_reference)
      return true
    })
    return { ...block, edits: uniqueEdits }
  }

  // Re-insert all previously-pinned cache_edits at their original positions
  for (const pinned of pinnedEdits ?? []) {
    const msg = result[pinned.userMessageIndex]
    if (msg && msg.role === 'user') {
      if (!Array.isArray(msg.content)) {
        msg.content = [{ type: 'text', text: msg.content as string }]
      }
      const dedupedBlock = deduplicateEdits(pinned.block)
      if (dedupedBlock.edits.length > 0) {
        insertBlockAfterToolResults(msg.content, dedupedBlock)
      }
    }
  }

  // Insert new cache_edits into the last user message and pin them
  if (newCacheEdits && result.length > 0) {
    const dedupedNewEdits = deduplicateEdits(newCacheEdits)
    if (dedupedNewEdits.edits.length > 0) {
      for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i]
        if (msg && msg.role === 'user') {
          if (!Array.isArray(msg.content)) {
            msg.content = [{ type: 'text', text: msg.content as string }]
          }
          insertBlockAfterToolResults(msg.content, dedupedNewEdits)
          // Pin so this block is re-sent at the same position in future calls
          pinCacheEdits(i, newCacheEdits as any)

          logForDebugging(
            `Added cache_edits block with ${dedupedNewEdits.edits.length} deletion(s) to message[${i}]: ${dedupedNewEdits.edits.map(e => e.cache_reference).join(', ')}`,
          )
          break
        }
      }
    }
  }

  // Add cache_reference to tool_result blocks that are within the cached prefix.
  // Must be done AFTER cache_edits insertion since that modifies content arrays.
  // Note: this code only runs when useCachedMC=true (early return at line ~3202).
  if (enablePromptCaching) {
    // Find the last message containing a cache_control marker
    let lastCCMsg = -1
    for (let i = 0; i < result.length; i++) {
      const msg = result[i]!
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === 'object' && 'cache_control' in block) {
            lastCCMsg = i
          }
        }
      }
    }

    // Add cache_reference to tool_result blocks that are strictly before
    // the last cache_control marker. The API requires cache_reference to
    // appear "before or on" the last cache_control — we use strict "before"
    // to avoid edge cases where cache_edits splicing shifts block indices.
    //
    // Create new objects instead of mutating in-place to avoid contaminating
    // blocks reused by secondary queries that use models without cache_editing support.
    if (lastCCMsg >= 0) {
      for (let i = 0; i < lastCCMsg; i++) {
        const msg = result[i]!
        if (msg.role !== 'user' || !Array.isArray(msg.content)) {
          continue
        }
        let cloned = false
        for (let j = 0; j < msg.content.length; j++) {
          const block = msg.content[j]
          if (block && isToolResultBlock(block)) {
            if (!cloned) {
              msg.content = [...msg.content]
              cloned = true
            }
            msg.content[j] = Object.assign({}, block, {
              cache_reference: block.tool_use_id,
            })
          }
        }
      }
    }
  }

  return result
}
