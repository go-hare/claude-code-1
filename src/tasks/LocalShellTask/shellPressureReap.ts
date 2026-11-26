/**
 * Official $xu / eqo / c1o (`chunk@294254613.js @5721000-5730800`) — kill
 * long-idle main-thread background bash tasks when the runtime emits
 * `memoryPressure` at `level === 'critical'` and host memory is scarce.
 *
 * Gate (official): agentId === undefined && interactive && !DISABLE env.
 * Handler skips when:
 *   1. pressure level !== 'critical'
 *   2. task not running / already notified / not backgrounded
 *   3. last interaction within 30min (h1o = 1_800_000)
 *   4. mainLoopBusy (a turn is running)
 *   5. any active agent-ish tasks (s9)
 *   6. anti-churn: started within 30min (lUi = 1_800_000) of an earlier pressure
 *      reap with no terminal input since
 *   7. host memory is not scarce (c1o: MemAvailable < 10% && < 4 GiB on Linux/WSL)
 */

import { readFileSync } from 'fs'
import type { TaskStateBase, TaskStatus, TaskType } from '../../Task.js'
import { isTerminalTaskStatus } from '../../Task.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getPlatform, type Platform } from '../../utils/platform.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionHost.js'

/** Official h1o — 30 minutes of idle interaction before reaping is allowed. */
export const SHELL_PRESSURE_IDLE_MS = 1_800_000
/** Official lUi — 30-minute anti-churn window after an earlier pressure reap. */
export const SHELL_PRESSURE_ANTI_CHURN_MS = 1_800_000
/** Official iUi — 10-minute throttle for repeated skip-reason debug logs. */
export const SHELL_PRESSURE_SKIP_LOG_THROTTLE_MS = 600_000
/** Official d1o — scarce threshold ratio (10% of MemTotal). */
export const HOST_MEM_SCARCE_RATIO = 0.1
/** Official u1o — scarce threshold absolute ceiling (4 GiB). */
export const HOST_MEM_SCARCE_GIB = 4

export type HostMemoryScarcity = {
  scarce: boolean
  detail: string
}

const lastPressureReapAtSlot = new RootSessionSlot<{ ts: number }>(() => ({
  ts: 0,
}))

export function getLastPressureReapAt(): number {
  return lastPressureReapAtSlot.of(getBootstrapSession()).ts
}

export function setLastPressureReapAt(ts: number): void {
  lastPressureReapAtSlot.of(getBootstrapSession()).ts = ts
}

export function resetLastPressureReapAtForTests(): void {
  lastPressureReapAtSlot.of(getBootstrapSession()).ts = 0
}

/**
 * Official `c1o()` (`chunk@294254613.js @5721100`):
 * Verify host memory is actually scarce before reaping a background shell.
 * On macOS/Windows the kernel memoryPressure verdict is trusted as-is.
 * On Linux/WSL, checks `/proc/meminfo` (`MemAvailable < 10%` of `MemTotal`
 * AND `MemAvailable < 4 GiB`).
 */
export function checkHostMemoryScarce(opts?: {
  platform?: Platform
  readMeminfo?: () => string
}): HostMemoryScarcity {
  const plat = opts?.platform ?? getPlatform()
  if (plat !== 'linux' && plat !== 'wsl') {
    return { scarce: true, detail: `${plat}: kernel verdict taken as is` }
  }
  let raw: string
  try {
    raw = opts?.readMeminfo
      ? opts.readMeminfo()
      : readFileSync('/proc/meminfo', 'utf8')
  } catch (err) {
    return {
      scarce: false,
      detail: `/proc/meminfo unreadable (${getErrnoCode(err) ?? 'unknown error'})`,
    }
  }
  const totalKb = Number(/^MemTotal:\s+(\d+) kB$/m.exec(raw)?.[1])
  const availKb = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(raw)?.[1])
  if (!(totalKb > 0) || Number.isNaN(availKb)) {
    return { scarce: false, detail: '/proc/meminfo unparseable' }
  }
  const scarce =
    availKb / totalKb < HOST_MEM_SCARCE_RATIO &&
    availKb < HOST_MEM_SCARCE_GIB * 1024 * 1024
  return {
    scarce,
    detail: `MemAvailable ${availKb} kB of ${totalKb} kB; scarce is under ${Math.round(HOST_MEM_SCARCE_RATIO * 100)}% and under ${HOST_MEM_SCARCE_GIB} GiB`,
  }
}

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

export type MemoryPressureReapDecision =
  | { shouldReap: true; memoryDetail: string }
  | { shouldReap: false; skipReason?: string; memoryDetail?: string }

/**
 * Official `eqo` memoryPressure evaluator (`chunk@294254613.js @5729800-5730800`):
 * Strictly requires `level === 'critical'`, idle >= 30m, no running turn, no
 * delegated agents, 30m anti-churn since `lastPressureReapAt` without terminal
 * input, AND scarce host memory (`checkHostMemoryScarce`).
 */
export function evaluateMemoryPressureReap(opts: {
  level: unknown
  status: TaskStatus | string | undefined
  notified: boolean | undefined
  shellCommandStatus?: string
  lastInteractionTime: number
  now?: number
  mainLoopBusy: boolean
  hasActiveAgentTasks: boolean
  lastPressureReapAt?: number
  taskStartTime?: number
  idleMs?: number
  antiChurnMs?: number
  checkHostMemory?: () => HostMemoryScarcity
}): MemoryPressureReapDecision {
  if (opts.status !== 'running' || opts.notified) {
    return { shouldReap: false }
  }
  if (
    opts.shellCommandStatus !== undefined &&
    opts.shellCommandStatus !== 'backgrounded'
  ) {
    return { shouldReap: false }
  }
  const now = opts.now ?? Date.now()
  const idleMs = opts.idleMs ?? SHELL_PRESSURE_IDLE_MS
  const antiChurnMs = opts.antiChurnMs ?? SHELL_PRESSURE_ANTI_CHURN_MS
  const lastReap = opts.lastPressureReapAt ?? getLastPressureReapAt()

  if (opts.level !== 'critical') {
    return {
      shouldReap: false,
      skipReason: `pressure level ${String(opts.level)} is not critical`,
    }
  }
  if (now - opts.lastInteractionTime < idleMs) {
    return {
      shouldReap: false,
      skipReason: `session active in the last ${idleMs / 60_000}m`,
    }
  }
  if (opts.mainLoopBusy) {
    return { shouldReap: false, skipReason: 'a turn is running' }
  }
  if (opts.hasActiveAgentTasks) {
    return { shouldReap: false, skipReason: 'delegated agents are running' }
  }
  if (
    opts.taskStartTime !== undefined &&
    lastReap > opts.lastInteractionTime &&
    opts.taskStartTime > lastReap &&
    opts.taskStartTime - lastReap < antiChurnMs
  ) {
    return {
      shouldReap: false,
      skipReason:
        'started soon after an earlier pressure reap, no input at the terminal since',
    }
  }
  const mem = opts.checkHostMemory
    ? opts.checkHostMemory()
    : checkHostMemoryScarce()
  if (!mem.scarce) {
    return {
      shouldReap: false,
      skipReason: 'host memory is not scarce',
      memoryDetail: mem.detail,
    }
  }
  return { shouldReap: true, memoryDetail: mem.detail }
}

/**
 * Official memoryPressure handler predicate (before telemetry / kill).
 * Returns true when the shell task should be reaped.
 */
export function shouldReapOnMemoryPressure(opts: {
  level?: unknown
  status: TaskStatus | string | undefined
  notified: boolean | undefined
  lastInteractionTime: number
  now?: number
  mainLoopBusy: boolean
  hasActiveAgentTasks: boolean
  lastPressureReapAt?: number
  taskStartTime?: number
  idleMs?: number
  antiChurnMs?: number
  hostMemoryScarce?: boolean
}): boolean {
  const effectiveLevel = 'level' in opts ? opts.level : 'critical'
  const decision = evaluateMemoryPressureReap({
    level: effectiveLevel,
    status: opts.status,
    notified: opts.notified,
    lastInteractionTime: opts.lastInteractionTime,
    now: opts.now,
    mainLoopBusy: opts.mainLoopBusy,
    hasActiveAgentTasks: opts.hasActiveAgentTasks,
    lastPressureReapAt: opts.lastPressureReapAt,
    taskStartTime: opts.taskStartTime,
    idleMs: opts.idleMs,
    antiChurnMs: opts.antiChurnMs,
    checkHostMemory:
      opts.hostMemoryScarce !== undefined
        ? () => ({
            scarce: opts.hostMemoryScarce === true,
            detail: opts.hostMemoryScarce ? 'scarce' : 'not scarce',
          })
        : () => ({ scarce: true, detail: 'assumed scarce' }),
  })
  return decision.shouldReap
}
