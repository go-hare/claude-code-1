/**
 * Official --append-subagent-system-prompt /
 * CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT portable helpers.
 *
 * When enabled, Task-tool subagents append an extra system prompt segment
 * (and propagate it to nested subagents). Official gate is env-truthy only
 * when a non-empty append string is also present.
 */

import { isEnvTruthy } from './envUtils.js'

/** Whether the append-subagent feature is enabled by env. */
export function isAppendSubagentPromptEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT)
}

/**
 * Official merge: when not forked (useExactTools) and env enabled and
 * append text present, append to the agent system prompt parts.
 * Fork children (useExactTools) skip this to preserve prompt-cache prefix.
 */
export function mergeAppendSubagentSystemPrompt(input: {
  basePrompt: readonly string[]
  appendSubagentSystemPrompt?: string
  useExactTools?: boolean
  env?: NodeJS.ProcessEnv
}): string[] {
  const base = [...input.basePrompt]
  if (input.useExactTools) return base
  const append = input.appendSubagentSystemPrompt?.trim()
  if (!append) return base
  if (!isAppendSubagentPromptEnabled(input.env ?? process.env)) return base
  return [...base, append]
}

/**
 * When CLI sets --append-subagent-system-prompt, imply the enable env
 * (official: "Implies CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT=1").
 */
export function implyAppendSubagentPromptEnv(
  prompt: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (prompt === undefined || prompt === '') return
  if (env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT === undefined) {
    env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT = '1'
  }
}
