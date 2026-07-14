/**
 * Official $xu portable subset — kill long-idle main-thread background bash
 * tasks when the runtime emits `memoryPressure` (Bun/JSC).
 *
 * Gate (official): agentId === undefined && interactive && !DISABLE env.
 * Handler skips when task not running / already notified / last interaction
 * within xRg=30min / mainLoopBusy / any active agent-ish tasks (qvt).
 */

import type { TaskStateBase, TaskStatus, TaskType } from '../../Task.js'
import { isTerminalTaskStatus } from '../../Task.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/** Official xRg — 30 minutes of idle interaction before reaping is allowed. */
export const SHELL_PRESSURE_IDLE_MS = 1_800_000

/**
 * Official tVh — task types that block pressure reap while non-terminal.
 * Idle in-process teammates and long-running remote agents are excluded.
 */
const ACTIVE_AGENTISH_TYPES = new Set<TaskType>([
  'local_agent',
  'remote_agent',
  'in_process_teammate',
  'local_workflow',
])

export type ShellPressureTaskLike = Pick<TaskStateBase, 'type' | 'status'> & {
  isIdle?: boolean
  isLongRunning?: boolean
}

export function isBgShellPressureReapDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Official DISABLE_BG_SHELL_PRESSURE_REAP densable.
  try {
    const { isBgShellPressureReapDisabled: densable } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    return densable(env)
  } catch {
    return isEnvTruthy(env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP)
  }
}

/**
 * Official $xu registration gate (minus process listener install).
 * Monitor tasks never register; subagent shells never register.
 */
export function shouldRegisterShellPressureReap(opts: {
  agentId: string | undefined
  kind: string | undefined
  isInteractive: boolean
  disabled?: boolean
}): boolean {
  if (opts.kind === 'monitor') return false
  if (opts.agentId !== undefined) return false
  if (!opts.isInteractive) return false
  if (opts.disabled ?? isBgShellPressureReapDisabled()) return false
  return true
}

/** Official qvt — any non-terminal agent-ish task blocks reaping. */
export function hasActiveAgentishTasks(
  tasks: Record<string, ShellPressureTaskLike | undefined>,
): boolean {
  for (const task of Object.values(tasks)) {
    if (!task) continue
    if (!ACTIVE_AGENTISH_TYPES.has(task.type)) continue
    if (isTerminalTaskStatus(task.status as TaskStatus)) continue
    if (task.type === 'in_process_teammate' && task.isIdle) continue
    if (task.type === 'remote_agent' && task.isLongRunning) continue
    return true
  }
  return false
}

/**
 * Official memoryPressure handler predicate (before telemetry / kill).
 * Returns true when the shell task should be reaped.
 */
export function shouldReapOnMemoryPressure(opts: {
  status: TaskStatus | string | undefined
  notified: boolean | undefined
  lastInteractionTime: number
  now?: number
  mainLoopBusy: boolean
  hasActiveAgentTasks: boolean
  idleMs?: number
}): boolean {
  if (opts.status !== 'running') return false
  if (opts.notified) return false
  const now = opts.now ?? Date.now()
  const idleMs = opts.idleMs ?? SHELL_PRESSURE_IDLE_MS
  if (now - opts.lastInteractionTime < idleMs) return false
  if (opts.mainLoopBusy) return false
  if (opts.hasActiveAgentTasks) return false
  return true
}
