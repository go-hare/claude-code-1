import { APIUserAbortError } from '@anthropic-ai/sdk'
import { logForDebugging } from '../utils/debug.js'
import { createUserMessage, extractTextContent } from '../utils/messages.js'
import { getSmallFastModel } from '../utils/model/model.js'
import { getResolvedLanguage } from '../utils/language.js'
import { getLastCacheSafeParams, runForkedAgent } from '../utils/forkedAgent.js'
import { createAutoMemCanUseTool } from './extractMemories/extractMemories.js'
import { getAutoMemPath } from '../memdir/paths.js'
import { getSessionMemoryContent } from './SessionMemory/sessionMemoryUtils.js'

// Recap only needs recent context — truncate to avoid "prompt too long" on
// large sessions. 30 messages ≈ ~15 exchanges, plenty for "where we left off."
const RECENT_MESSAGE_WINDOW = 30

const PROMPT_EN =
  'The user stepped away and is coming back. Write exactly 1-3 short sentences. Start by stating the high-level task — what they are building or debugging, not implementation details. Next: the concrete next step. Skip status reports and commit recaps.'

const PROMPT_ZH =
  '用户离开后回来了。用中文写 1-3 句话。先说明用户在做什么（高层目标，不是实现细节），然后说明下一步具体操作。不要写状态报告或提交总结。'

function buildAwaySummaryPrompt(memory: string | null): string {
  const memoryBlock = memory
    ? `Session memory (broader context):\n${memory}\n\n`
    : ''
  const prompt = getResolvedLanguage() === 'zh' ? PROMPT_ZH : PROMPT_EN
  return `${memoryBlock}${prompt}`
}

/**
 * Generates a short session recap for the "while you were away" card.
 * Uses runForkedAgent with the parent's CacheSafeParams to share prompt cache.
 * Returns null when no turn has completed yet (no CacheSafeParams saved),
 * when aborted, or on error.
 */
export async function generateAwaySummary(
  _messages: readonly unknown[],
  signal: AbortSignal,
): Promise<string | null> {
  const cacheSafeParams = getLastCacheSafeParams()
  if (!cacheSafeParams) {
    logForDebugging('[awaySummary] no CacheSafeParams saved, skipping')
    return null
  }

  if (signal.aborted) {
    return null
  }

  try {
    const memory = await getSessionMemoryContent()
    const recentMessages = cacheSafeParams.forkContextMessages.slice(
      -RECENT_MESSAGE_WINDOW,
    )
    const userPrompt = buildAwaySummaryPrompt(memory)

    const model = getSmallFastModel()
    const overriddenCacheSafeParams = {
      ...cacheSafeParams,
      forkContextMessages: recentMessages,
      toolUseContext: {
        ...cacheSafeParams.toolUseContext,
        options: {
          ...cacheSafeParams.toolUseContext.options,
          model,
        },
      },
    }

    const canUseTool = createAutoMemCanUseTool(getAutoMemPath())

    const result = await runForkedAgent({
      promptMessages: [createUserMessage({ content: userPrompt })],
      cacheSafeParams: overriddenCacheSafeParams,
      canUseTool,
      querySource: 'away_summary',
      forkLabel: 'away_summary',
      skipTranscript: true,
      skipCacheWrite: true,
      maxTurns: 1,
    })

    if (signal.aborted) {
      return null
    }

    // Extract text from the last assistant message
    const lastAssistant = result.messages
      .slice()
      .reverse()
      .find(m => m.type === 'assistant')
    if (!lastAssistant || lastAssistant.type !== 'assistant') {
      return null
    }
    const content = lastAssistant.message?.content
    const text = Array.isArray(content)
      ? extractTextContent(content, ' ')
      : typeof content === 'string'
        ? content
        : null
    return text?.trim() || null
  } catch (err) {
    if (err instanceof APIUserAbortError || signal.aborted) {
      return null
    }
    logForDebugging(`[awaySummary] generation failed: ${err}`)
    return null
  }
}
