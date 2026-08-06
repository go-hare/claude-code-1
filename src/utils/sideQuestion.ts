/**
 * Side Question ("/btw") feature - allows asking quick questions without
 * interrupting the main agent context.
 *
 * Uses runForkedAgent to leverage prompt caching from the parent context
 * while keeping the side question response separate from main conversation.
 *
 * densable 2.1.212: in-memory btw history ring (lNt / Scn / VI_=20) so bare
 * `/btw` reopens the last panel and later side questions can thread prior Q&A.
 */

import { formatAPIError } from '@ant/model-provider'
import { EMPTY_USAGE, type NonNullableUsage } from '@ant/model-provider'
import type { Message, SystemAPIErrorMessage } from '../types/message.js'
import {
  createAbortController,
  createChildAbortController,
} from './abortController.js'
import { isAbortError } from './errors.js'
import { type CacheSafeParams, runForkedAgent } from './forkedAgent.js'
import {
  createAssistantMessage,
  createUserMessage,
  extractTextContent,
} from './messages.js'

// Pattern to detect "/btw" at start of input (case-insensitive, word boundary)
const BTW_PATTERN = /^\/btw\b/gi

/** densable VI_ — max retained {question,response} pairs. */
const BTW_HISTORY_MAX = 20

export type BtwHistoryEntry = {
  question: string
  response: string
}

export type BtwHistoryState = {
  history: BtwHistoryEntry[]
}

/** densable Abp */
export function createBtwHistoryState(): BtwHistoryState {
  return { history: [] }
}

let globalBtwHistory: BtwHistoryState = createBtwHistoryState()

/** densable qI_ */
export function _setGlobalBtwHistoryStateForTesting(
  state: BtwHistoryState,
): void {
  globalBtwHistory = state
}

/** densable lNt / getBtwHistory */
export function getBtwHistory(): BtwHistoryEntry[] {
  return globalBtwHistory.history
}

/** densable zI_ / clearBtwHistory */
export function clearBtwHistory(): void {
  globalBtwHistory.history = []
}

/** densable zOo / resetBtwHistory — replace ring (e.g. clear-with-keep-current). */
export function resetBtwHistory(entries: BtwHistoryEntry[]): void {
  globalBtwHistory.history = entries
}

/** densable Scn / appendBtwHistory */
export function appendBtwHistory(question: string, response: string): void {
  globalBtwHistory.history = [
    ...globalBtwHistory.history,
    { question, response },
  ].slice(-BTW_HISTORY_MAX)
}

/**
 * Find positions of "/btw" keyword at the start of text for highlighting.
 * Similar to findThinkingTriggerPositions in thinking.ts.
 * densable P9s.
 */
export function findBtwTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(BTW_PATTERN)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

export type SideQuestionResult = {
  response: string | null
  /** densable synthetic — tool-fallback / API-error display strings are not real answers. */
  synthetic?: boolean
  usage: NonNullableUsage
  aborted?: boolean
}

export type SideQuestionRetryInfo = {
  retryAttempt: number
  maxRetries: number
  retryInMs: number
  status?: number
}

/**
 * Run a side question using a forked agent.
 * Shares the parent's prompt cache — no thinking override, no cache write.
 * All tools are blocked and we cap at 1 turn.
 *
 * densable xhr: optional parentController, onRetry, threadHistory (default true).
 * On real (non-synthetic) success, appends to btw history when threadHistory.
 */
export async function runSideQuestion({
  question,
  cacheSafeParams,
  parentController,
  onRetry,
  threadHistory = true,
}: {
  question: string
  cacheSafeParams: CacheSafeParams
  parentController?: AbortController
  onRetry?: (info: SideQuestionRetryInfo) => void
  /** densable o — when true, prefix prior Q&A pairs and append on success. */
  threadHistory?: boolean
}): Promise<SideQuestionResult> {
  // Wrap the question with instructions to answer without tools
  const wrappedQuestion = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${question}`

  // densable: M5(parent) or Oc() — child linked to parent when provided
  const abortController = parentController
    ? createChildAbortController(parentController)
    : createAbortController()

  // densable: thread prior Q&A as user/assistant pairs before the new question
  const historyMessages: Message[] = threadHistory
    ? globalBtwHistory.history.flatMap(entry => [
        createUserMessage({ content: entry.question }),
        createAssistantMessage({ content: entry.response }),
      ])
    : []

  try {
    const agentResult = await runForkedAgent({
      promptMessages: [
        ...historyMessages,
        createUserMessage({ content: wrappedQuestion }),
      ],
      // Do NOT override thinkingConfig — thinking is part of the API cache key,
      // and diverging from the main thread's config busts the prompt cache.
      // Adaptive thinking on a quick Q&A has negligible overhead.
      cacheSafeParams,
      canUseTool: async () => ({
        behavior: 'deny' as const,
        message: 'Side questions cannot use tools',
        decisionReason: { type: 'other' as const, reason: 'side_question' },
      }),
      querySource: 'side_question',
      forkLabel: 'side_question',
      maxTurns: 1, // Single turn only - no tool use loops
      // No future request shares this suffix; skip writing cache entries.
      skipCacheWrite: true,
      skipTranscript: true,
      overrides: { abortController },
      onMessage: onRetry
        ? message => {
            if (
              message.type === 'system' &&
              'subtype' in message &&
              message.subtype === 'api_error' &&
              'retryAttempt' in message
            ) {
              const m = message as SystemAPIErrorMessage & {
                retryAttempt?: number
                maxRetries?: number
                retryInMs?: number
              }
              if (
                typeof m.retryAttempt === 'number' &&
                typeof m.maxRetries === 'number' &&
                typeof m.retryInMs === 'number'
              ) {
                const status =
                  m.error &&
                  typeof m.error === 'object' &&
                  'status' in m.error &&
                  typeof (m.error as { status?: unknown }).status === 'number'
                    ? (m.error as { status: number }).status
                    : undefined
                onRetry({
                  retryAttempt: m.retryAttempt,
                  maxRetries: m.maxRetries,
                  retryInMs: m.retryInMs,
                  status,
                })
              }
            }
          }
        : undefined,
    })

    const { response, synthetic } = extractSideQuestionResponse(
      agentResult.messages,
    )
    // densable: if (o && c && !u) Scn(e, c)
    if (threadHistory && response && !synthetic) {
      appendBtwHistory(question, response)
    }
    return {
      response,
      synthetic,
      usage: agentResult.totalUsage,
    }
  } catch (err) {
    if (isAbortError(err) || abortController.signal.aborted) {
      return {
        response: null,
        synthetic: false,
        usage: EMPTY_USAGE,
        aborted: true,
      }
    }
    throw err
  }
}

/**
 * Extract a display string from forked agent messages.
 *
 * densable KI_ returns `{response, synthetic}`.
 *
 * IMPORTANT: claude.ts yields one AssistantMessage PER CONTENT BLOCK, not one
 * per API response. With adaptive thinking enabled (inherited from the main
 * thread to preserve the cache key), a thinking response arrives as:
 *   messages[0] = assistant { content: [thinking_block] }
 *   messages[1] = assistant { content: [text_block] }
 *
 * The old code used `.find(m => m.type === 'assistant')` which grabbed the
 * first (thinking-only) message, found no text block, and returned null →
 * "No response received". Repos with large context (many skills, big CLAUDE.md)
 * trigger thinking more often, which is why this reproduced in the monorepo
 * but not here.
 *
 * Secondary failure modes also surfaced as "No response received":
 *   - Model attempts tool_use → content = [thinking, tool_use], no text.
 *     Rare — the system-reminder usually prevents this, but handled here.
 *   - API error exhausts retries → query yields system api_error + user
 *     interruption, no assistant message at all.
 */
function extractSideQuestionResponse(messages: Message[]): {
  response: string | null
  synthetic: boolean
} {
  // Flatten all assistant content blocks across the per-block messages.
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant'
      ? (m.message!.content as unknown as Array<{
          type: string
          [key: string]: unknown
        }>)
      : [],
  )

  if (assistantBlocks.length > 0) {
    // Concatenate all text blocks (there's normally at most one, but be safe).
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    if (text) return { response: text, synthetic: false }

    // No text — check if the model tried to call a tool despite instructions.
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use')
    if (toolUse) {
      const toolName =
        'name' in toolUse
          ? (toolUse as unknown as { name: string }).name
          : 'a tool'
      return {
        response: `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`,
        synthetic: true,
      }
    }
  }

  // No assistant content — likely API error exhausted retries. Surface the
  // first system api_error message so the user sees what happened.
  const apiErr = messages.find(
    (m): m is SystemAPIErrorMessage =>
      m.type === 'system' && 'subtype' in m && m.subtype === 'api_error',
  )
  if (apiErr) {
    return {
      response: `(API error: ${formatAPIError(apiErr.error as Parameters<typeof formatAPIError>[0])})`,
      synthetic: true,
    }
  }

  return { response: null, synthetic: false }
}
