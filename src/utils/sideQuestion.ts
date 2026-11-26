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
import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'

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

const fallbackSideQuestionSession = { root: {} as object }
const btwHistorySlotBySession = new RootSessionSlot<{ state: BtwHistoryState }>(
  () => ({ state: createBtwHistoryState() }),
)

function getBtwHistorySlot(): { state: BtwHistoryState } {
  try {
    const session = getBootstrapSession()
    if (session?.root) return btwHistorySlotBySession.of(session)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return btwHistorySlotBySession.of(fallbackSideQuestionSession)
}

/** densable qI_ */
export function _setGlobalBtwHistoryStateForTesting(
  state: BtwHistoryState,
): void {
  getBtwHistorySlot().state = state
}

/** densable lNt / getBtwHistory */
export function getBtwHistory(): BtwHistoryEntry[] {
  return getBtwHistorySlot().state.history
}

/** densable zI_ / clearBtwHistory */
export function clearBtwHistory(): void {
  getBtwHistorySlot().state.history = []
}

/** densable zOo / resetBtwHistory — replace ring (e.g. clear-with-keep-current). */
export function resetBtwHistory(entries: BtwHistoryEntry[]): void {
  getBtwHistorySlot().state.history = entries
}

/** densable Scn / appendBtwHistory */
export function appendBtwHistory(question: string, response: string): void {
  const slot = getBtwHistorySlot()
  slot.state.history = [...slot.state.history, { question, response }].slice(
    -BTW_HISTORY_MAX,
  )
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
- Do NOT write tool calls or tool output as text (for example invoke or function_calls XML blocks) - nothing you write here is executed; if answering would need reading files, running commands, or searching, say that can't be checked from a side question and suggest asking in the main conversation
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
    ? getBtwHistory().flatMap(entry => [
        createUserMessage({ content: entry.question }),
        createAssistantMessage({ content: entry.response }),
      ])
    : []

  const promptMessages: Message[] = [
    ...historyMessages,
    createUserMessage({ content: wrappedQuestion }),
  ]

  // Official 2.1.323 (#2075): track UUIDs already in the parent conversation and
  // prompt prefix so any preserved/replayed parent assistant replies are excluded
  // from the side-question answer.
  const inputMessageUuids = new Set<string>([
    ...cacheSafeParams.forkContextMessages.map(m => m.uuid),
    ...promptMessages.map(m => m.uuid),
  ])

  try {
    const agentResult = await runForkedAgent({
      promptMessages,
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

    const newMessages = filterNewSideQuestionMessages(
      agentResult.messages,
      inputMessageUuids,
    )
    const { response, synthetic } = extractSideQuestionResponse(newMessages)
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
/**
 * Official 2.1.323 (#2075): drop any messages whose UUID already existed in the
 * parent conversation or prompt prefix so earlier replies cannot leak into `/btw`
 * answers (e.g. via preserved compaction messages).
 */
export function filterNewSideQuestionMessages(
  messages: readonly Message[],
  inputMessageUuids: ReadonlySet<string>,
): Message[] {
  if (inputMessageUuids.size === 0) return [...messages]
  return messages.filter(m => !inputMessageUuids.has(m.uuid))
}

const INLINE_TOOL_CALL_MARKUP_RE = /<(?:antml:)?(?:function_calls|invoke)\b/i

/**
 * Official 2.1.326 #161 (`EPs`): detect fake tool-call XML written as plain text
 * when the model tries to invoke tools in a toolless `/btw` side question.
 */
export function hasInlineToolCallMarkup(text: string): boolean {
  return INLINE_TOOL_CALL_MARKUP_RE.test(text)
}

function formatToolAttemptNotice(toolName: string): string {
  return `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`
}

export function extractSideQuestionResponse(messages: Message[]): {
  response: string | null
  synthetic: boolean
} {
  // Official 2.1.323 Wl (#2075): flatten non-API-error assistant content blocks.
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant' && !m.isApiErrorMessage
      ? (m.message!.content as unknown as Array<{
          type: string
          [key: string]: unknown
        }>)
      : [],
  )
  const apiErrAssistant = messages.find(
    m => m.type === 'assistant' && m.isApiErrorMessage === true,
  )

  if (assistantBlocks.length > 0) {
    // Concatenate all text blocks (there's normally at most one, but be safe).
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use')
    const toolName =
      toolUse && 'name' in toolUse && typeof toolUse.name === 'string'
        ? toolUse.name
        : 'a tool'

    // Official 2.1.326 #161 (anthropics/claude-code#90314): when the model emits
    // a lead-in like "Let me check that file." AND a tool_use block (or inline
    // tool-call markup), append a notice so the user isn't left with a dangling
    // lead-in.
    if (text) {
      const notices: string[] = []
      if (hasInlineToolCallMarkup(text)) {
        notices.push(
          '(Side questions cannot run tools. Ask in the main conversation if checking files or running commands is needed.)',
        )
      }
      if (toolUse) {
        notices.push(formatToolAttemptNotice(toolName))
      }
      if (apiErrAssistant) {
        notices.push('(The reply was cut short by an API error.)')
      }
      return {
        response: [text, ...notices].join('\n\n'),
        synthetic: false,
      }
    }

    // No text — check if the model tried to call a tool despite instructions.
    if (toolUse) {
      return {
        response: formatToolAttemptNotice(toolName),
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
