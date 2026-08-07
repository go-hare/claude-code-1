/**
 * densable 2.1.217 #20 — `--max-budget-usd` stops background subagents.
 *
 * densable symbols:
 * - `Hrr(e)` → budget reached when e !== undefined && nS() >= e
 * - `$am(e,t)` → budget reached AND some running bg haltable non-observer task
 * - `iSe(e)` → local_agent && !observer | local_workflow
 * - `mT(e)` → isBackgroundTask (running|pending, not isBackgrounded===false)
 * - `bk(e)` → isObserverAgentTask
 * - `tcr({taskRegistry,setAppState})` → stamp + kill running observers / bg haltable
 * - AgentTool L(): `Hrr(maxBudgetUsd)` → throw subagent_budget_exhausted
 */

import { getTotalCost } from 'src/cost-tracker.js'
import type { AppState } from 'src/state/AppState.js'
import {
  isLocalAgentTask,
  isObserverAgentTask,
  markAgentStoppedByUser,
  type LocalAgentTaskState,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { stopTask } from 'src/tasks/stopTask.js'
import { isBackgroundTask } from 'src/tasks/types.js'
import type { TaskState } from 'src/tasks/types.js'
import { logEvent } from 'src/services/analytics/index.js'
import { logForDebugging } from 'src/utils/debug.js'
import { emitTaskTerminatedSdk } from 'src/utils/sdkEventQueue.js'

/** densable Hrr */
export function isMaxBudgetUsdReached(
  maxBudgetUsd: number | undefined,
): boolean {
  return maxBudgetUsd !== undefined && getTotalCost() >= maxBudgetUsd
}

/**
 * densable iSe — tasks that budget halt will stop (non-observer agents + workflows).
 * Observers are handled separately in tcr when already running.
 */
export function isBudgetHaltableTask(task: TaskState): boolean {
  if (task.type === 'local_agent') {
    return !isObserverAgentTask(task)
  }
  return task.type === 'local_workflow'
}

/**
 * densable $am(e, t):
 *   if (!Hrr(e)) return false
 *   return t.some(r =>
 *     r.status === "running" && mT(r) && iSe(r) && !bk(r) && !r.stoppedByUser)
 */
export function shouldHaltBackgroundAgentsForBudget(
  maxBudgetUsd: number | undefined,
  tasks: readonly TaskState[],
): boolean {
  if (!isMaxBudgetUsdReached(maxBudgetUsd)) return false
  return tasks.some(task => {
    if (task.status !== 'running') return false
    if (!isBackgroundTask(task)) return false
    if (!isBudgetHaltableTask(task)) return false
    if (isObserverAgentTask(task)) return false
    if (isLocalAgentTask(task) && (task as LocalAgentTaskState).stoppedByUser) {
      return false
    }
    return true
  })
}

/** densable AgentTool budget deny copy */
export function formatSubagentBudgetExhaustedMessage(
  maxBudgetUsd: number,
): string {
  const spent = getTotalCost()
  return `Budget limit reached ($${spent.toFixed(2)} spent of the $${maxBudgetUsd} maximum). New agents cannot be started. Complete the remaining work directly with your tools, or wrap up with the results you already have.`
}

/** densable print stderr line */
export function formatPrintBudgetHaltStderr(maxBudgetUsd: number): string {
  const spent = getTotalCost()
  return `Budget limit reached ($${spent.toFixed(2)} of $${maxBudgetUsd}); stopping background agents.\n`
}

export function formatPrintBudgetHaltDebug(maxBudgetUsd: number): string {
  return `print budget halt: total cost ${getTotalCost()} reached --max-budget-usd ${maxBudgetUsd}; stopping background agents`
}

type HaltContext = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}

/**
 * densable tcr — halt running observers and running bg-haltable tasks.
 * Non-observer: stamp stoppedByUser (Pxe/hAe) then kill system.
 * local_agent non-observer: emit stopped SDK event after kill.
 */
export async function haltBackgroundAgentsForBudget(
  tasks: Record<string, TaskState>,
  ctx: HaltContext,
): Promise<number> {
  let halted = 0
  for (const task of Object.values(tasks)) {
    // Capture id/description before type-predicate branches (isObserverAgentTask
    // is typed as `t is LocalAgentTaskState`, so !predicate excludes all agents).
    const taskId = task.id
    const taskDescription = task.description
    const toolUseId =
      'toolUseId' in task && typeof task.toolUseId === 'string'
        ? task.toolUseId
        : undefined
    const isObserver = isObserverAgentTask(task)
    const isLocalAgent = isLocalAgentTask(task)
    const runningObserver = isObserver && task.status === 'running'
    const runningHaltableBg =
      task.status === 'running' &&
      isBackgroundTask(task) &&
      isBudgetHaltableTask(task)
    if (!runningObserver && !runningHaltableBg) continue

    // densable Pxe/hAe — stamp stoppedByUser on non-observer agents before kill
    if (isLocalAgent && !isObserver) {
      markAgentStoppedByUser(taskId, ctx.setAppState)
    }

    try {
      await stopTask(taskId, {
        getAppState: ctx.getAppState,
        setAppState: ctx.setAppState,
        // densable kill(..., "system")
        source: 'system',
        killedBy: 'system',
      })
      halted += 1
      if (isLocalAgent && !isObserver) {
        emitTaskTerminatedSdk(taskId, 'stopped', {
          toolUseId,
          summary: taskDescription,
        })
      }
    } catch (err) {
      logForDebugging(
        `budget halt: failed to stop task ${taskId}: ${String(err)}`,
      )
    }
  }
  if (halted > 0) {
    logEvent('print_budget_halt', {})
  }
  return halted
}
