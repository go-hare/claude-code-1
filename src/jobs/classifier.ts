import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AssistantMessage } from '../types/message.js'

/**
 * Classify the job state from the turn's assistant messages and update state.json.
 *
 * Called by stopHooks.ts after each repl_main_thread turn when CLAUDE_JOB_DIR is set.
 * Only the main thread calls this (not subagents).
 *
 * Official equivalent: the transcript classifier that updates state/tempo/detail
 * in the job's state.json after each turn.
 *
 * @param jobDir - Path to the job directory (from CLAUDE_JOB_DIR env)
 * @param assistantMessages - Assistant messages from this turn
 */
export async function classifyAndWriteState(
  jobDir: string,
  assistantMessages: AssistantMessage[],
): Promise<void> {
  const stateFile = join(jobDir, 'state.json')

  let state: Record<string, unknown>
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf-8'))
  } catch {
    return
  }

  const classification = classifyTurn(assistantMessages)

  state.state = classification.state
  state.tempo = classification.tempo
  if (classification.detail !== undefined) {
    state.detail = classification.detail
  }
  state.updatedAt = new Date().toISOString()

  if (classification.state === 'done' || classification.state === 'failed') {
    state.firstTerminalAt = state.firstTerminalAt ?? state.updatedAt
  }

  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
}

interface TurnClassification {
  state: 'working' | 'blocked' | 'done' | 'failed'
  tempo: 'active' | 'idle' | 'blocked'
  detail?: string
}

/**
 * Determine job state from assistant messages in this turn.
 *
 * Logic (matching official classifier):
 * - Has tool_use blocks → working/active (tools still executing)
 * - Has AskUserQuestion tool → blocked (waiting for user input)
 * - stop_reason === 'end_turn' with no pending tools → done
 * - Otherwise → working/active
 */
function classifyTurn(messages: AssistantMessage[]): TurnClassification {
  if (messages.length === 0) {
    return { state: 'working', tempo: 'active' }
  }

  const lastMessage = messages[messages.length - 1]!
  const content = lastMessage.message?.content

  // Extract detail from the last text block
  let detail: string | undefined
  if (Array.isArray(content)) {
    const textBlocks = content.filter(
      (b): b is { type: 'text'; text: string } =>
        typeof b === 'object' && b !== null && 'type' in b && b.type === 'text',
    )
    if (textBlocks.length > 0) {
      const lastText = textBlocks[textBlocks.length - 1]!.text
      // Take last non-empty line, truncated to 120 chars
      const lines = lastText.split('\n').filter(l => l.trim())
      const lastLine = lines[lines.length - 1] ?? ''
      detail = lastLine.slice(0, 120)
    }
  }

  // Check for tool_use blocks
  if (Array.isArray(content)) {
    const toolUseBlocks = content.filter(
      b =>
        typeof b === 'object' &&
        b !== null &&
        'type' in b &&
        (b as unknown as Record<string, unknown>).type === 'tool_use',
    )

    if (toolUseBlocks.length > 0) {
      // Check if any tool is AskUserQuestion (= blocked)
      const isBlocked = toolUseBlocks.some(
        b =>
          (b as unknown as Record<string, unknown>).name === 'AskUserQuestion',
      )
      if (isBlocked) {
        return { state: 'blocked', tempo: 'blocked', detail }
      }
      return { state: 'working', tempo: 'active', detail }
    }
  }

  // No tool_use — check stop_reason
  const stopReason = (lastMessage.message as Record<string, unknown>)
    ?.stop_reason
  if (stopReason === 'end_turn') {
    return { state: 'done', tempo: 'idle', detail }
  }
  if (stopReason === 'max_tokens') {
    return { state: 'working', tempo: 'active', detail }
  }

  return { state: 'working', tempo: 'active', detail }
}
