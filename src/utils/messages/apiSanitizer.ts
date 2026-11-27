/**
 * API message integrity passes: tool-result pairing, invalid/foreign assistant block dropping, and advisor block stripping.
 */

import type {
  ContentBlock,
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getStrictToolResultPairing } from '../../bootstrap/state.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import { isAdvisorBlock } from '../advisor.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import {
  type ApiSystemMessage,
  isApiSystemMessage,
} from '../midConversationSystem.js'
import { isFirstPartyProviderWithFirstPartyBase } from '../model/providers.js'
import { SYNTHETIC_TOOL_RESULT_PLACEHOLDER } from './constants.js'
import { createUserMessage } from './factories.js'
import { smooshSystemReminderSiblings } from './messageMerging.js'

/**
 * Defensive validation: ensure tool_use/tool_result pairing is correct.
 *
 * Handles both directions:
 * - Forward: inserts synthetic error tool_result blocks for tool_use blocks missing results
 * - Reverse: strips orphaned tool_result blocks referencing non-existent tool_use blocks
 *
 * Logs when this activates to help identify the root cause.
 *
 * Strict mode: when getStrictToolResultPairing() is true (HFI opts in at
 * startup), any mismatch throws instead of repairing. For training-data
 * collection, a model response conditioned on synthetic placeholders is
 * tainted — fail the trajectory rather than waste labeler time on a turn
 * that will be rejected at submission anyway.
 */
export function ensureToolResultPairing(
  messages: (UserMessage | AssistantMessage | ApiSystemMessage)[],
): (UserMessage | AssistantMessage | ApiSystemMessage)[] {
  const result: (UserMessage | AssistantMessage | ApiSystemMessage)[] = []
  let repaired = false

  // Cross-message tool_use ID tracking. The per-message seenToolUseIds below
  // only caught duplicates within a single assistant's content array (the
  // normalizeMessagesForAPI-merged case). When two assistants with DIFFERENT
  // message.id carry the same tool_use ID — e.g. orphan handler re-pushed an
  // assistant already present in mutableMessages with a fresh message.id, or
  // normalizeMessagesForAPI's backward walk broke on an intervening user
  // message — the dup lived in separate result entries and the API rejected
  // with "tool_use ids must be unique", deadlocking the session (CC-1212).
  const allSeenToolUseIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!

    // densable: api_system is not part of tool pairing — pass through
    if (isApiSystemMessage(msg)) {
      result.push(msg)
      continue
    }

    if (msg.type !== 'assistant') {
      // A user message with tool_result blocks but NO preceding assistant
      // message in the output has orphaned tool_results. The assistant
      // lookahead below only validates assistant→user adjacency; it never
      // sees user messages at index 0 or user messages preceded by another
      // user. This happens on resume when the transcript starts mid-turn
      // (e.g. messages[0] is a tool_result whose assistant pair was dropped
      // by earlier compaction — API rejects with "messages.0.content:
      // unexpected tool_use_id").
      if (
        msg.type === 'user' &&
        Array.isArray(msg.message.content) &&
        result.at(-1)?.type !== 'assistant'
      ) {
        const stripped = msg.message.content.filter(
          block =>
            !(
              typeof block === 'object' &&
              'type' in block &&
              block.type === 'tool_result'
            ),
        )
        if (stripped.length !== msg.message.content.length) {
          repaired = true
          // If stripping emptied the message and nothing has been pushed yet,
          // keep a placeholder so the payload still starts with a user
          // message (normalizeMessagesForAPI runs before us, so messages[1]
          // is an assistant — dropping messages[0] entirely would yield a
          // payload starting with assistant, a different 400).
          const content =
            stripped.length > 0
              ? stripped
              : result.length === 0
                ? [
                    {
                      type: 'text' as const,
                      text: '[Orphaned tool result removed due to conversation resume]',
                    },
                  ]
                : null
          if (content !== null) {
            result.push({
              ...msg,
              message: { ...msg.message, content },
            })
          }
          continue
        }
      }
      result.push(msg)
      continue
    }

    // Collect server-side tool result IDs (*_tool_result blocks have tool_use_id).
    // Official 2.1.328 `zqi` (`chunk@294254613.js:6074400`): exclude client
    // `tool_result` blocks (`!Nzt(Je)`) so misplaced assistant `tool_result`
    // blocks are never miscounted as server tool results.
    const serverResultIds = new Set<string>()
    const aMsg5 = msg as AssistantMessage
    for (const c of aMsg5.message.content as (
      | ContentBlockParam
      | ContentBlock
    )[]) {
      if (
        typeof c !== 'string' &&
        c.type !== 'tool_result' &&
        'tool_use_id' in c &&
        typeof (c as { tool_use_id: string }).tool_use_id === 'string'
      ) {
        serverResultIds.add((c as { tool_use_id: string }).tool_use_id)
      }
    }

    // Dedupe tool_use blocks by ID. Checks against the cross-message
    // allSeenToolUseIds Set so a duplicate in a LATER assistant (different
    // message.id, not merged by normalizeMessagesForAPI) is also stripped.
    // The per-message seenToolUseIds tracks only THIS assistant's surviving
    // IDs — the orphan/missing-result detection below needs a per-message
    // view, not the cumulative one.
    //
    // Also strip orphaned server-side tool use blocks (server_tool_use,
    // mcp_tool_use) whose result blocks live in the SAME assistant message,
    // and strip misplaced `tool_result` blocks from assistant messages (`zqi`).
    const seenToolUseIds = new Set<string>()
    const assistantContent = Array.isArray(aMsg5.message.content)
      ? aMsg5.message.content
      : []
    // densable ZWr / 2.1.328 zqi: strip dups / orphan server uses / misplaced
    // tool_result; thinking sandwich → `[Tool use removed]` (not a bare drop).
    let assistantContentChanged = false
    const finalContent = assistantContent.flatMap((block, k, all) => {
      if (typeof block === 'string') return [block]
      let strip = false
      if (block.type === 'tool_use') {
        if (allSeenToolUseIds.has((block as ToolUseBlock).id)) {
          strip = true
        } else {
          allSeenToolUseIds.add((block as ToolUseBlock).id)
          seenToolUseIds.add((block as ToolUseBlock).id)
        }
      } else if (
        ((block.type as string) === 'server_tool_use' ||
          (block.type as string) === 'mcp_tool_use') &&
        !serverResultIds.has((block as { id: string }).id)
      ) {
        strip = true
      } else if ((block.type as string) === 'tool_result') {
        strip = true
      }
      if (!strip) return [block]
      repaired = true
      assistantContentChanged = true
      const prev = all[k - 1]
      const next = all[k + 1]
      const prevType =
        prev !== undefined && typeof prev !== 'string' ? prev.type : undefined
      const nextType =
        next !== undefined && typeof next !== 'string' ? next.type : undefined
      return (prevType === 'thinking' || prevType === 'redacted_thinking') &&
        (nextType === 'thinking' || nextType === 'redacted_thinking')
        ? [
            {
              type: 'text' as const,
              text: '[Tool use removed]',
              citations: [],
            },
          ]
        : []
    })

    // If stripping orphaned server tool uses empties the content array,
    // insert a placeholder so the API doesn't reject empty assistant content.
    if (finalContent.length === 0) {
      finalContent.push({
        type: 'text' as const,
        text: '[Tool use interrupted]',
        citations: [],
      })
    }

    const assistantMsg = assistantContentChanged
      ? {
          ...msg,
          message: { ...msg.message, content: finalContent },
        }
      : msg

    result.push(assistantMsg)

    // Collect tool_use IDs from this assistant message
    const toolUseIds = [...seenToolUseIds]

    // Check the next message for matching tool_results. Also track duplicate
    // tool_result blocks (same tool_use_id appearing twice) — for transcripts
    // corrupted before Fix 1 shipped, the orphan handler ran to completion
    // multiple times, producing [asst(X), user(tr_X), asst(X), user(tr_X)] which
    // normalizeMessagesForAPI merges to [asst([X,X]), user([tr_X,tr_X])]. The
    // tool_use dedup above strips the second X; without also stripping the
    // second tr_X, the API rejects with a duplicate-tool_result 400 and the
    // session stays stuck.
    const nextMsg = messages[i + 1]
    const existingToolResultIds = new Set<string>()
    let hasDuplicateToolResults = false

    if (nextMsg?.type === 'user') {
      const content = nextMsg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === 'object' &&
            'type' in block &&
            block.type === 'tool_result'
          ) {
            const trId = (block as ToolResultBlockParam).tool_use_id
            if (existingToolResultIds.has(trId)) {
              hasDuplicateToolResults = true
            }
            existingToolResultIds.add(trId)
          }
        }
      }
    }

    // Find missing tool_result IDs (forward direction: tool_use without tool_result)
    const toolUseIdSet = new Set(toolUseIds)
    const missingIds = toolUseIds.filter(id => !existingToolResultIds.has(id))

    // Find orphaned tool_result IDs (reverse direction: tool_result without tool_use)
    const orphanedIds = [...existingToolResultIds].filter(
      id => !toolUseIdSet.has(id),
    )

    if (
      missingIds.length === 0 &&
      orphanedIds.length === 0 &&
      !hasDuplicateToolResults
    ) {
      continue
    }

    repaired = true

    // Build synthetic error tool_result blocks for missing IDs
    const syntheticBlocks: ToolResultBlockParam[] = missingIds.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
      is_error: true,
    }))

    if (nextMsg?.type === 'user') {
      // Next message is already a user message - patch it
      const nextUserMsg = nextMsg as UserMessage
      let content: (ContentBlockParam | ContentBlock)[] = Array.isArray(
        nextUserMsg.message.content,
      )
        ? (nextUserMsg.message.content as (ContentBlockParam | ContentBlock)[])
        : [
            {
              type: 'text' as const,
              text: (nextUserMsg.message.content as string | undefined) ?? '',
            },
          ]

      // Strip orphaned tool_results and dedupe duplicate tool_result IDs
      if (orphanedIds.length > 0 || hasDuplicateToolResults) {
        const orphanedSet = new Set(orphanedIds)
        const seenTrIds = new Set<string>()
        content = content.filter(block => {
          if (
            typeof block === 'object' &&
            'type' in block &&
            block.type === 'tool_result'
          ) {
            const trId = (block as ToolResultBlockParam).tool_use_id
            if (orphanedSet.has(trId)) return false
            if (seenTrIds.has(trId)) return false
            seenTrIds.add(trId)
          }
          return true
        })
      }

      const patchedContent = [...syntheticBlocks, ...content]

      // If content is now empty after stripping orphans, skip the user message
      if (patchedContent.length > 0) {
        const patchedNext: UserMessage = {
          ...nextUserMsg,
          message: {
            ...nextUserMsg.message,
            content: patchedContent,
          },
        }
        i++
        // Prepending synthetics to existing content can produce a
        // [tool_result, text] sibling the smoosh inside normalize never saw
        // (pairing runs after normalize). Re-smoosh just this one message.
        result.push(
          checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_chair_sermon')
            ? smooshSystemReminderSiblings([patchedNext])[0]!
            : patchedNext,
        )
      } else {
        // Content is empty after stripping orphaned tool_results. We still
        // need a user message here to maintain role alternation — unless the
        // previous result entry is already a user message, in which case
        // inserting another user placeholder creates consecutive-user messages
        // that Anthropic rejects with a misleading "tool_use without
        // tool_result" 400 (CC-1215).
        i++
        if (result.at(-1)?.type === 'user') {
          continue
        }
        result.push(
          createUserMessage({
            content: NO_CONTENT_MESSAGE,
            isMeta: true,
          }),
        )
      }
    } else {
      // No user message follows - insert a synthetic user message (only if missing IDs)
      if (syntheticBlocks.length > 0) {
        result.push(
          createUserMessage({
            content: syntheticBlocks,
            isMeta: true,
          }),
        )
      }
    }
  }

  if (repaired) {
    // Capture diagnostic info to help identify root cause
    const messageTypes = messages.map((m, idx) => {
      if (m.type === 'assistant') {
        const contentArr = Array.isArray(m.message.content)
          ? m.message.content
          : []
        const toolUses = contentArr
          .filter(b => typeof b !== 'string' && b.type === 'tool_use')
          .map(b => (b as ToolUseBlock | ToolUseBlockParam).id)
        const serverToolUses = contentArr
          .filter(
            b =>
              typeof b !== 'string' &&
              ((b.type as string) === 'server_tool_use' ||
                (b.type as string) === 'mcp_tool_use'),
          )
          .map(b => (b as { id: string }).id)
        const misplacedToolResults = contentArr
          .filter(
            b => typeof b !== 'string' && (b.type as string) === 'tool_result',
          )
          .map(b => {
            const id = (b as { tool_use_id?: unknown }).tool_use_id
            return typeof id === 'string' ? id : 'nonconforming'
          })
        const parts = [
          `id=${m.message.id}`,
          `tool_uses=[${toolUses.join(',')}]`,
        ]
        if (serverToolUses.length > 0) {
          parts.push(`server_tool_uses=[${serverToolUses.join(',')}]`)
        }
        if (misplacedToolResults.length > 0) {
          parts.push(
            `misplaced_tool_results=[${misplacedToolResults.join(',')}]`,
          )
        }
        return `[${idx}] assistant(${parts.join(', ')})`
      }
      if (m.type === 'user' && Array.isArray(m.message.content)) {
        const toolResults = m.message.content
          .filter(
            b =>
              typeof b === 'object' && 'type' in b && b.type === 'tool_result',
          )
          .map(b => (b as ToolResultBlockParam).tool_use_id)
        if (toolResults.length > 0) {
          return `[${idx}] user(tool_results=[${toolResults.join(',')}])`
        }
      }
      return `[${idx}] ${m.type}`
    })

    if (getStrictToolResultPairing()) {
      throw new Error(
        `ensureToolResultPairing: tool_use/tool_result pairing mismatch detected (strict mode). ` +
          `Refusing to repair — would inject synthetic placeholders into model context. ` +
          `Message structure: ${messageTypes.join('; ')}. See inc-4977.`,
      )
    }

    logEvent('tengu_tool_result_pairing_repaired', {
      messageCount: messages.length,
      repairedMessageCount: result.length,
      messageTypes: messageTypes.join(
        '; ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logError(
      new Error(
        `ensureToolResultPairing: repaired missing tool_result blocks (${messages.length} -> ${result.length} messages). Message structure: ${messageTypes.join('; ')}`,
      ),
    )
  }

  return result
}

/** Official 2.1.328 `ags`/`lgs` (`chunk@294254613.js:2378730`): Anthropic API server tool names. */
const ANTHROPIC_SERVER_TOOL_NAMES = new Set([
  'advisor',
  'bash_code_execution',
  'code_execution',
  'text_editor_code_execution',
  'tool_search_tool_bm25',
  'tool_search_tool_regex',
  'web_fetch',
  'web_search',
])

/** Official 2.1.328 `dgs`: spacer inserted between adjacent thinking blocks when foreign tool content is dropped. */
export const UNSUPPORTED_TOOL_CONTENT_SPACER =
  '[Unsupported tool content removed]'

/** Official 2.1.328 `Hsn` (`chunk@283835568.js:824`): Anthropic API tool_use.name Unicode code-point limit. */
export const API_TOOL_NAME_MAX_CODE_POINTS = 200

function isKnownAnthropicServerToolName(name: unknown): boolean {
  return typeof name === 'string' && ANTHROPIC_SERVER_TOOL_NAMES.has(name)
}

function isBlockRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isToolResultBlockObj(value: unknown): value is {
  type: 'tool_result'
  tool_use_id?: unknown
} {
  return isBlockRecord(value) && value.type === 'tool_result'
}

function isToolCallBlockObj(value: Record<string, unknown>): boolean {
  const t = value.type
  return t === 'tool_use' || t === 'server_tool_use' || t === 'mcp_tool_use'
}

function isThinkingBlockObj(value: unknown): boolean {
  return (
    isBlockRecord(value) &&
    (value.type === 'thinking' || value.type === 'redacted_thinking')
  )
}

function isUserToolResultMessage(msg: Message): boolean {
  return (
    msg.type === 'user' &&
    Array.isArray(msg.message?.content) &&
    msg.message.content.some(isToolResultBlockObj)
  )
}

/** Official 2.1.328 `rFi`: true if string exceeds `API_TOOL_NAME_MAX_CODE_POINTS` Unicode code points. */
function isOverlongToolName(name: string): boolean {
  if (name.length <= API_TOOL_NAME_MAX_CODE_POINTS) return false
  let count = 0
  for (const _ of name) {
    count++
    if (count > API_TOOL_NAME_MAX_CODE_POINTS) return true
  }
  return false
}

/** Official 2.1.328 `c_o` / `Zi`: truncate overlong tool name to `API_TOOL_NAME_MAX_CODE_POINTS` code points. */
function truncateOverlongToolName(name: unknown): string | undefined {
  if (typeof name !== 'string' || !isOverlongToolName(name)) return undefined
  const chars: string[] = []
  for (const ch of name) {
    if (chars.length >= API_TOOL_NAME_MAX_CODE_POINTS) break
    chars.push(ch)
  }
  return chars.join('')
}

/** Official 2.1.328 `cgs`: fast pre-scan for foreign blocks or overlong tool names. */
function scanApiInvalidAssistantBlocks(messages: readonly Message[]): {
  foreignBlocks: boolean
  overlongToolNames: boolean
} {
  let foreignBlocks = false
  let overlongToolNames = false
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      continue
    }
    for (const block of msg.message.content) {
      if (
        isToolResultBlockObj(block) ||
        (isBlockRecord(block) &&
          block.type === 'server_tool_use' &&
          !isKnownAnthropicServerToolName(block.name))
      ) {
        foreignBlocks = true
      } else if (
        isBlockRecord(block) &&
        block.type === 'tool_use' &&
        typeof block.name === 'string' &&
        isOverlongToolName(block.name)
      ) {
        overlongToolNames = true
      }
      if (foreignBlocks && overlongToolNames) {
        return { foreignBlocks, overlongToolNames }
      }
    }
  }
  return { foreignBlocks, overlongToolNames }
}

/** Official 2.1.328 `pgs`: compute turn-scoped assistant group key `${turn}:${message.id}`. */
function computeAssistantTurnKeys(
  messages: readonly Message[],
): Array<string | undefined> {
  let turn = 0
  return messages.map(msg => {
    if (msg.type === 'assistant') {
      return `${turn}:${String(msg.message?.id)}`
    }
    if (
      (msg.type === 'user' && !isUserToolResultMessage(msg)) ||
      (msg.type === 'system' &&
        (msg as { subtype?: unknown }).subtype === 'local_command')
    ) {
      turn += 1
    }
    return undefined
  })
}

type AssistantBlockResultIndex = {
  byServerResult: Set<string>
  byClientResult: Set<string>
  byAssistantSideResult: Set<string>
  byUserSideResult: Set<string>
}

/** Official 2.1.328 `mgs`: index tool_result / *_tool_result ownership across messages. */
function indexAssistantBlockResults(
  messages: readonly Message[],
  turnKeys: readonly (string | undefined)[],
): AssistantBlockResultIndex {
  const byServerResult = new Set<string>()
  const byClientResult = new Set<string>()
  const byAssistantSideResult = new Set<string>()
  const byUserSideResult = new Set<string>()
  messages.forEach((msg, idx) => {
    if (msg.type === 'user') {
      if (!Array.isArray(msg.message?.content)) return
      for (const block of msg.message.content) {
        if (
          isToolResultBlockObj(block) &&
          typeof block.tool_use_id === 'string'
        ) {
          byUserSideResult.add(block.tool_use_id)
        }
      }
      return
    }
    const turnKey = turnKeys[idx]
    if (
      turnKey === undefined ||
      msg.type !== 'assistant' ||
      !Array.isArray(msg.message?.content)
    ) {
      return
    }
    for (const block of msg.message.content) {
      if (
        isToolResultBlockObj(block) &&
        typeof block.tool_use_id === 'string'
      ) {
        byAssistantSideResult.add(block.tool_use_id)
      }
      if (!isBlockRecord(block) || typeof block.tool_use_id !== 'string') {
        continue
      }
      const key = `${turnKey}\n${block.tool_use_id}`
      if (isToolResultBlockObj(block)) {
        byClientResult.add(key)
      } else if (!isToolCallBlockObj(block)) {
        byServerResult.add(key)
      }
    }
  })
  return {
    byServerResult,
    byClientResult,
    byAssistantSideResult,
    byUserSideResult,
  }
}

/** Official 2.1.328 `ggs`: decide whether an assistant content block is API-invalid. */
function shouldDropForeignAssistantBlock(
  block: unknown,
  turnKey: string,
  index: AssistantBlockResultIndex,
): boolean {
  if (isToolResultBlockObj(block)) return true
  if (!isBlockRecord(block)) return false
  if (block.type === 'tool_use') {
    return (
      typeof block.id === 'string' &&
      index.byAssistantSideResult.has(block.id) &&
      !index.byUserSideResult.has(block.id)
    )
  }
  if (block.type !== 'server_tool_use' && block.type !== 'mcp_tool_use') {
    return false
  }
  const key =
    typeof block.id === 'string' ? `${turnKey}\n${block.id}` : undefined
  if (key !== undefined && index.byServerResult.has(key)) {
    return false
  }
  return (
    (key !== undefined && index.byClientResult.has(key)) ||
    (block.type === 'server_tool_use' &&
      !isKnownAnthropicServerToolName(block.name))
  )
}

/** Official 2.1.328 `hgs`: rewrite assistant content arrays dropping invalid blocks and truncating overlong tool names. */
function rewriteApiInvalidAssistantBlocks(
  messages: readonly Message[],
  dropForeignBlocks: boolean,
): {
  result: Message[]
  removed: number
  spacers: number
  truncated: number
} {
  const turnKeys = computeAssistantTurnKeys(messages)
  const index = indexAssistantBlockResults(messages, turnKeys)
  const groupState = new Map<
    string,
    { lastKeptIsThinking: boolean; removedSince: boolean }
  >()
  let removed = 0
  let spacers = 0
  let truncated = 0

  const result = messages.flatMap((msg, idx) => {
    const turnKey = turnKeys[idx]
    if (
      turnKey === undefined ||
      msg.type !== 'assistant' ||
      !Array.isArray(msg.message?.content)
    ) {
      return [msg]
    }
    const kept: Array<ContentBlockParam | ContentBlock> = []
    let { lastKeptIsThinking, removedSince } = groupState.get(turnKey) ?? {
      lastKeptIsThinking: false,
      removedSince: false,
    }
    let changed = false
    for (const block of msg.message.content) {
      if (
        dropForeignBlocks &&
        shouldDropForeignAssistantBlock(block, turnKey, index)
      ) {
        removed += 1
        removedSince = true
        changed = true
        continue
      }
      if (removedSince && lastKeptIsThinking && isThinkingBlockObj(block)) {
        kept.push({
          type: 'text',
          text: UNSUPPORTED_TOOL_CONTENT_SPACER,
          citations: [],
        })
        spacers += 1
        changed = true
      }
      let nextBlock = block
      if (isBlockRecord(block) && block.type === 'tool_use') {
        const shortened = truncateOverlongToolName(block.name)
        if (shortened !== undefined) {
          nextBlock = { ...block, name: shortened } as ContentBlock
          truncated += 1
          changed = true
        }
      }
      kept.push(nextBlock as ContentBlockParam | ContentBlock)
      lastKeptIsThinking = isThinkingBlockObj(block)
      removedSince = false
    }
    groupState.set(turnKey, { lastKeptIsThinking, removedSince })
    if (!changed) return [msg]
    if (kept.length === 0) return []
    return [
      {
        ...msg,
        message: {
          ...msg.message,
          content: kept,
        },
      } as Message,
    ]
  })

  return { result, removed, spacers, truncated }
}

/**
 * Official 2.1.328 `zct` / `hgs` (`chunk@294254613.js:2379031-2382670`):
 * Drop assistant content blocks that the Anthropic API does not produce or
 * accept (assistant `tool_result`, unknown `server_tool_use`, assistant-only
 * answered `tool_use` with thinking-sandwich `[Unsupported tool content removed]`
 * spacer) on first-party Anthropic sessions, and truncate overlong
 * `tool_use.name` values to 200 Unicode code points on all providers.
 */
export function dropApiInvalidAssistantBlocks(
  messages: Message[],
  options: { site: string; dropForeignBlocks?: boolean } = { site: 'resume' },
): Message[] {
  try {
    const scan = scanApiInvalidAssistantBlocks(messages)
    const shouldDropForeign =
      scan.foreignBlocks &&
      (options.dropForeignBlocks ?? isFirstPartyProviderWithFirstPartyBase())
    if (!shouldDropForeign && !scan.overlongToolNames) {
      return messages
    }
    const { result, removed, spacers, truncated } =
      rewriteApiInvalidAssistantBlocks(messages, shouldDropForeign)
    if (removed === 0 && truncated === 0) {
      return messages
    }
    if (removed > 0) {
      logForDebugging(
        `dropApiInvalidAssistantBlocks: removed ${removed} assistant content ${removed === 1 ? 'block' : 'blocks'} that the Anthropic API does not produce or accept (${spacers} ${spacers === 1 ? 'spacer' : 'spacers'} kept)`,
        { level: 'warn' },
      )
      logEvent('tengu_transcript_api_invalid_blocks_dropped', {
        site: options.site as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        removed,
        spacers,
      })
    }
    if (truncated > 0) {
      logForDebugging(
        `dropApiInvalidAssistantBlocks: cut ${truncated} overlong tool_use ${truncated === 1 ? 'name' : 'names'} to the Anthropic API's ${API_TOOL_NAME_MAX_CODE_POINTS}-character request limit`,
        { level: 'warn' },
      )
      logEvent('tengu_transcript_api_invalid_tool_name_truncated', {
        site: options.site as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        truncated,
      })
    }
    return result
  } catch (err) {
    logForDebugging(
      `dropApiInvalidAssistantBlocks: left the history unchanged after an unexpected transcript shape (${err instanceof Error ? err.message : String(err)})`,
      { level: 'error' },
    )
    return messages
  }
}

/** densable `UD` / `FFe` — assistant message ids whose advisor blocks strip. */
export type AdvisorStripPlan = Set<string>

/**
 * densable `FFe` — union caller plan with UD(messages).
 */
export function mergeAdvisorStripPlans(
  caller: AdvisorStripPlan | undefined,
  derived: AdvisorStripPlan,
): AdvisorStripPlan {
  if (caller === undefined || caller.size === 0) return derived
  if (derived.size === 0) return caller
  return new Set([...caller, ...derived])
}

/**
 * densable `UD` — ids of assistants before the last advisor_stripped marker.
 * Semantic export only — never ship minify `UD`.
 */
export function buildAdvisorStripPlanFromMessages(
  messages: readonly Message[],
): AdvisorStripPlan {
  const marker = messages.findLastIndex(
    msg =>
      msg.type === 'attachment' && msg.attachment?.type === 'advisor_stripped',
  )
  if (marker === -1) return new Set()
  const ids: AdvisorStripPlan = new Set()
  for (let i = 0; i < marker; i++) {
    const msg = messages[i]
    if (msg?.type === 'assistant' && typeof msg.message?.id === 'string') {
      ids.add(msg.message.id)
    }
  }
  return ids
}

/**
 * densable `C_` — strip advisor blocks from assistants listed in the plan.
 */
export function stripAdvisorBlocksFromMessageIds<
  T extends UserMessage | AssistantMessage | ApiSystemMessage,
>(messages: T[], ids: AdvisorStripPlan): T[] {
  if (ids.size === 0) return messages
  let changed = false
  const result = messages.map(msg => {
    if (msg.type === 'api_system' || msg.type !== 'assistant') return msg
    const id = msg.message?.id
    if (typeof id !== 'string' || !ids.has(id)) return msg
    const content = Array.isArray(msg.message.content)
      ? msg.message.content
      : []
    const filtered = content.filter(
      b => typeof b !== 'string' && !isAdvisorBlock(b),
    )
    if (filtered.length === content.length) return msg
    changed = true
    if (
      filtered.length === 0 ||
      filtered.every(
        b =>
          b.type === 'thinking' ||
          b.type === 'redacted_thinking' ||
          (b.type === 'text' && (!b.text || !b.text.trim())),
      )
    ) {
      filtered.push({
        type: 'text' as const,
        text: '[Advisor response]',
        citations: [],
      })
    }
    return { ...msg, message: { ...msg.message, content: filtered } }
  })
  return changed ? result : messages
}

export function stripAdvisorBlocks<
  T extends UserMessage | AssistantMessage | ApiSystemMessage,
>(messages: T[]): T[] {
  let changed = false
  const result = messages.map(msg => {
    // densable: api_system pass-through (not assistant content)
    if (msg.type === 'api_system' || msg.type !== 'assistant') return msg
    const content = Array.isArray(msg.message.content)
      ? msg.message.content
      : []
    const filtered = content.filter(
      b => typeof b !== 'string' && !isAdvisorBlock(b),
    )
    if (filtered.length === content.length) return msg
    changed = true
    if (
      filtered.length === 0 ||
      filtered.every(
        b =>
          b.type === 'thinking' ||
          b.type === 'redacted_thinking' ||
          (b.type === 'text' && (!b.text || !b.text.trim())),
      )
    ) {
      filtered.push({
        type: 'text' as const,
        text: '[Advisor response]',
        citations: [],
      })
    }
    return { ...msg, message: { ...msg.message, content: filtered } }
  })
  return changed ? result : messages
}
