// Pure (non-React) kill helpers for LocalShellTask.
// Extracted so runAgent.ts can kill agent-scoped bash tasks without pulling
// React/Ink into its module graph (same rationale as guards.ts).

import type { AppState } from '../../state/AppState.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { dequeueAllMatching } from '../../utils/messageQueueManager.js'
import {
  appendTaskOutput,
  evictTaskOutput,
  getTaskOutputPath,
} from '../../utils/task/diskOutput.js'
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import {
  createTaskRegistry,
  type TaskRegistry,
} from '../../utils/taskRegistry.js'
import {
  formatLocalShellExitFooter,
  shouldAppendLocalShellExitFooter,
} from './exitFooter.js'
import {
  bashKeepaliveReason,
  monitorKeepaliveReason,
  removeKeepaliveReason,
} from '../../utils/task/framework.js'
import { isLocalShellTask, type LocalShellTaskState } from './guards.js'
import {
  buildBashTaskDeliverySnapshot,
  isBashTaskGetDeliveryEnabled,
} from '../../utils/bashTaskDelivery.js'
import { rememberBashTaskSnapshot } from '../../utils/bashTaskDeliveryOutcomes.js'

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

/** densable `zN(e,n)` — n is Xm/taskRegistry. */
export function killTask(taskId: string, registry: TaskRegistry): void {
  // densable jLe does not tB itself — bXi releaseBgCap does on result.settle.
  // Local still detaches here so owner KA is not stuck if result never fires
  // (process already dead / kill races). removeKeepalive is idempotent.
  let ownerAgentId: string | undefined
  let kind: 'bash' | 'monitor' | undefined
  let wasNotified = false
  let writeKilledFooter = false
  let killedTask: LocalShellTaskState | undefined
  registry.update(taskId, task => {
    if (!isLocalShellTask(task) || task.status !== 'running') {
      return task
    }

    try {
      logForDebugging(`LocalShellTask ${taskId} kill requested`)
      task.shellCommand?.kill()
      task.shellCommand?.cleanup()
    } catch (error) {
      logError(error)
    }

    task.unregisterCleanup?.()
    if (task.cleanupTimeoutId) {
      clearTimeout(task.cleanupTimeoutId)
    }

    wasNotified = task.notified
    killedTask = task
    ownerAgentId = task.agentId
    kind = task.kind
    // Official zN: if(r&&!s){if(!r.isAdopted)IPe(e,`\n[killed]\n`);Di(e,"stopped",...)}
    writeKilledFooter = !wasNotified && shouldAppendLocalShellExitFooter(task)

    return {
      ...task,
      status: 'killed',
      notified: true,
      shellCommand: null,
      unregisterCleanup: undefined,
      cleanupTimeoutId: undefined,
      endTime: Date.now(),
    }
  })
  if (killedTask && !wasNotified) {
    if (writeKilledFooter) {
      appendTaskOutput(taskId, formatLocalShellExitFooter('killed', undefined))
    }
    emitTaskTerminatedSdk(taskId, 'stopped', {
      toolUseId: killedTask.toolUseId,
      summary: killedTask.description,
      outputFile: getTaskOutputPath(taskId),
    })
  }
  // TaskStop marks notified before the result callback. Retain the terminal
  // GetTask snapshot here only when `!wasNotified` (`zN` @191163780), so
  // `memory_pressure` / `deadline` snapshots recorded before `killTask` keep
  // their `stopCause`.
  if (
    killedTask &&
    !wasNotified &&
    kind !== 'monitor' &&
    isBashTaskGetDeliveryEnabled()
  ) {
    rememberBashTaskSnapshot(
      taskId,
      buildBashTaskDeliverySnapshot({
        taskId,
        outcome: 'killed',
        exitCode: undefined,
        startTime: killedTask.startTime,
        endTime: Date.now(),
        outputFile: getTaskOutputPath(taskId),
      }),
      killedTask.agentId,
    )
  }
  if (ownerAgentId) {
    const reason =
      kind === 'monitor'
        ? monitorKeepaliveReason(taskId)
        : bashKeepaliveReason(taskId)
    removeKeepaliveReason(ownerAgentId, reason, registry)
  }
  void evictTaskOutput(taskId)
}

/**
 * Kill all running bash tasks spawned by a given agent.
 * Called from runAgent.ts finally block so background processes don't outlive
 * the agent that started them (prevents 10-day fake-logs.sh zombies).
 */
export function killShellTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppStateFn,
): void {
  const registry = createTaskRegistry(getAppState, setAppState)
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (
      isLocalShellTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killShellTasksForAgent: killing orphaned shell task ${taskId} (agent ${agentId} exiting)`,
      )
      killTask(taskId, registry)
    }
  }
  // Purge any queued notifications addressed to this agent — its query loop
  // has exited and won't drain them. killTask fires 'killed' notifications
  // asynchronously; drop the ones already queued and any that land later sit
  // harmlessly (no consumer matches a dead agentId).
  dequeueAllMatching(cmd => cmd.agentId === agentId)
}
