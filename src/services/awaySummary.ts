/**
 * densable ePt — session recap for away_summary.
 * Gold: deny-all tools, under-40-word prompt, 400-char cap, no memory inject.
 */
import { APIUserAbortError } from '@anthropic-ai/sdk'
import { logForDebugging } from '../utils/debug.js'
import { createUserMessage, extractTextContent } from '../utils/messages.js'
import { getLastCacheSafeParams, runForkedAgent } from '../utils/forkedAgent.js'
import { truncateAtWordBoundary } from '../utils/stringUtils.js'

/** densable f/Hbm=400 */
export const AWAY_SUMMARY_RECAP_MAX_CHARS = 400

const PROMPT_EN =
  'The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.'

export async function generateAwaySummary(
  _messages: readonly unknown[],
  signal: AbortSignal,
): Promise<string | null> {
  const cacheSafeParams = getLastCacheSafeParams()
  if (!cacheSafeParams) {
    logForDebugging('[awaySummary] no CacheSafeParams saved, skipping')
    return null
  }
  if (signal.aborted) return null

  const abortController = new AbortController()
  signal.addEventListener('abort', () => abortController.abort(), {
    once: true,
  })

  try {
    const result = await runForkedAgent({
      promptMessages: [createUserMessage({ content: PROMPT_EN })],
      cacheSafeParams,
      overrides: { abortController },
      canUseTool: async () => ({
        behavior: 'deny',
        message: 'Away summary cannot use tools',
        decisionReason: { type: 'other', reason: 'away_summary' },
      }),
      querySource: 'away_summary',
      forkLabel: 'away_summary',
      skipTranscript: true,
      skipCacheWrite: true,
      maxTurns: 1,
    })
    if (signal.aborted) return null

    const lastAssistant = result.messages
      .slice()
      .reverse()
      .find(m => m.type === 'assistant')
    if (!lastAssistant || lastAssistant.type !== 'assistant') return null
    if (lastAssistant.isApiErrorMessage) return null
    const content = lastAssistant.message?.content
    const text = Array.isArray(content)
      ? extractTextContent(content, ' ')
      : typeof content === 'string'
        ? content
        : null
    const trimmed = text?.trim() || null
    if (!trimmed) return null
    if (trimmed.length > AWAY_SUMMARY_RECAP_MAX_CHARS) {
      const capped = truncateAtWordBoundary(
        trimmed,
        AWAY_SUMMARY_RECAP_MAX_CHARS,
      )
      logForDebugging(
        `[awaySummary] recap capped from ${trimmed.length} to ${capped.length} chars`,
      )
      return capped
    }
    return trimmed
  } catch (err) {
    if (err instanceof APIUserAbortError || signal.aborted) return null
    logForDebugging(`[awaySummary] generation failed: ${err}`)
    return null
  }
}
