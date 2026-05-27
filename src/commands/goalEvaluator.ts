/**
 * Goal condition evaluator — calls a fast model to check if the goal is met.
 */

import { getAnthropicClient } from 'src/services/api/client.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import type { Message } from 'src/types/message.js'

export interface GoalEvalResult {
  ok: boolean
  reason: string
}

const SYSTEM_PROMPT = `You are evaluating a stop-condition in Claude Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Respond ONLY with the JSON object, no other text.`

const MAX_TRANSCRIPT_MESSAGES = 20
const EVALUATOR_MODEL = 'claude-haiku-4-5-20251001'

function buildTranscript(messages: Message[]): string {
  const recent = messages.slice(-MAX_TRANSCRIPT_MESSAGES)
  const lines: string[] = []
  for (const msg of recent) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue
    if (!msg.message) continue
    const role = msg.type === 'user' ? 'User' : 'Assistant'
    const rawContent = msg.message.content
    let content = ''
    if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'text' &&
          'text' in block
        ) {
          content += String((block as { text: string }).text)
        }
      }
    } else if (typeof rawContent === 'string') {
      content = rawContent
    }
    if (content.trim()) {
      lines.push(`[${role}]: ${content.slice(0, 2000)}`)
    }
  }
  return lines.join('\n\n')
}

export async function evaluateGoalCondition(
  condition: string,
  messages: Message[],
  abortSignal?: AbortSignal,
): Promise<GoalEvalResult> {
  const transcript = buildTranscript(messages)
  const userPrompt = `Condition: ${condition}\n\nTranscript:\n${transcript}`

  try {
    const client = await getAnthropicClient({
      maxRetries: 2,
      model: EVALUATOR_MODEL,
      source: 'goal-evaluator',
    })

    const response = await client.messages.create(
      {
        model: EVALUATOR_MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: abortSignal ?? undefined, timeout: 30000 },
    )

    const text =
      response.content[0]?.type === 'text' ? response.content[0].text : ''
    logForDebugging(`[goal] evaluator response: ${text}`)

    const parsed = JSON.parse(text) as GoalEvalResult
    if (typeof parsed.ok !== 'boolean' || typeof parsed.reason !== 'string') {
      return { ok: false, reason: 'evaluator returned invalid format' }
    }
    return parsed
  } catch (e) {
    logError(e as Error)
    logForDebugging(`[goal] evaluator error: ${e}`)
    return { ok: false, reason: `evaluation failed: ${(e as Error).message}` }
  }
}
