/**
 * Official coordinator env gates (portable):
 * CLAUDE_CODE_COORDINATOR_EXTRA_TOOLS / COORDINATOR_PROPAGATE_NESTED_MEMORY
 */

import { isEnvTruthy } from './envUtils.js'

export function getCoordinatorExtraTools(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.CLAUDE_CODE_COORDINATOR_EXTRA_TOOLS ?? ''
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export function shouldPropagateNestedMemory(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_COORDINATOR_PROPAGATE_NESTED_MEMORY)
}
