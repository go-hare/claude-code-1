/**
 * Official CLAUDE_CODE_ENABLE_MORNING_BRIEF / MORNING_BRIEF_PROMPT portable.
 */

import { isEnvTruthy } from './envUtils.js'

export function isMorningBriefEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_MORNING_BRIEF)
}

export function getMorningBriefPromptOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const p = env.CLAUDE_CODE_MORNING_BRIEF_PROMPT
  if (p === undefined || p === '') return undefined
  return p
}
