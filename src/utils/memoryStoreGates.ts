/**
 * Official team-memory store env gates (portable):
 * CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE / DISABLE_MEMORY_PERIODIC_RESYNC
 */

import { isEnvTruthy } from './envUtils.js'

export function isMemoryBulkInflateDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE)
}

export function isMemoryPeriodicResyncDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_MEMORY_PERIODIC_RESYNC)
}
