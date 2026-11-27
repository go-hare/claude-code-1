/**
 * Lazy feature-gated module loaders and shared prompt constants for headless print mode.
 */
import { feature } from 'bun:bundle'

// Dead code elimination: conditional imports
/* eslint-disable @typescript-eslint/no-require-imports */
// Lazy accessor — top-level require() can yield an incomplete ESM namespace
// under Bun (empty keys); calling `.isCoordinatorMode` then throws in REPL.
export type CoordinatorModeModule =
  typeof import('../../coordinator/coordinatorMode.js')
let coordinatorModeModuleCache: CoordinatorModeModule | undefined
export function getCoordinatorModeModule(): CoordinatorModeModule | null {
  if (!feature('COORDINATOR_MODE')) return null
  if (coordinatorModeModuleCache !== undefined) {
    return coordinatorModeModuleCache
  }
  const mod =
    require('../../coordinator/coordinatorMode.js') as CoordinatorModeModule
  // Incomplete circular-init namespace — do not cache; retry on later calls.
  if (
    typeof mod?.isCoordinatorMode !== 'function' ||
    typeof mod?.matchSessionMode !== 'function'
  ) {
    return null
  }
  coordinatorModeModuleCache = mod
  return mod
}
export const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../../proactive/index.js') as typeof import('../../proactive/index.js'))
    : null
export const cronSchedulerModule =
  require('../../utils/cronScheduler.js') as typeof import('../../utils/cronScheduler.js')
export const cronJitterConfigModule =
  require('../../utils/cronJitterConfig.js') as typeof import('../../utils/cronJitterConfig.js')
export const cronGate =
  require('@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js')
export const extractMemoriesModule = feature('EXTRACT_MEMORIES')
  ? (require('../../services/extractMemories/extractMemories.js') as typeof import('../../services/extractMemories/extractMemories.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

export const SHUTDOWN_TEAM_PROMPT = `<system-reminder>
You are running in non-interactive mode and cannot return a response to the user until your team is shut down.

You MUST shut down your team before preparing your final response:
1. Use requestShutdown to ask each team member to shut down gracefully
2. Wait for shutdown approvals
3. Use the cleanup operation to clean up the team
4. Only then provide your final response to the user

The user cannot receive your response until the team is completely shut down.
</system-reminder>

Shut down your team and prepare your final response for the user.`
