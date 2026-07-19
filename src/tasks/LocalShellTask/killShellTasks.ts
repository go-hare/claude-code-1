// Pure (non-React) kill helpers for LocalShellTask.
// Extracted so runAgent.ts can kill agent-scoped bash tasks without pulling
// React/Ink into its module graph (same rationale as guards.ts).

import type { AppState } from '../../state/AppState.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { dequeueAllMatching } from '../../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import {
  bashKeepaliveReason,
  monitorKeepaliveReason,
  removeKeepaliveReason,
  updateTaskState,
} from '../../utils/task/framework.js'
import { isLocalShellTask } from './guards.js'

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

/**
 * densable jLe portable — kill running local shell, stamp notified, drop
 * shellCommand, and when the task was not yet notified emit lf("stopped").
 * c7c once-gate in emitTaskTerminatedSdk de-dupes with stopTask / _Xi lf.
 */
export function killTask(taskId: string, setAppState: SetAppStateFn): void {
  let owner: string | undefined
  let kind: 'bash' | 'monitor' | undefined
  let killed = false
  let wasNotified = false
  let toolUseId: string | undefined
  let description: string | undefined
  updateTaskState(taskId, setAppState, task => {
    if ((task as any).status !== 'running' || !isLocalShellTask(task)) {
      return task
    }

    killed = true
    wasNotified = task.notified === true
    owner = task.agentId
    kind = task.kind
    toolUseId = task.toolUseId
    description = task.description

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
  // densable jLe: if(r&&!n) lf(e,"stopped",{toolUseId,summary:description})
  if (killed && !wasNotified) {
    emitTaskTerminatedSdk(taskId, 'stopped', {
      toolUseId,
      summary: description,
    })
  }
  // Official tB(i, `bash:${e}` / `monitor:${e}`) on kill cleanup.
  if (killed && owner) {
    const reason =
      kind === 'monitor'
        ? monitorKeepaliveReason(taskId)
        : bashKeepaliveReason(taskId)
    removeKeepaliveReason(owner, reason, setAppState)
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
      killTask(taskId, setAppState)
    }
  }
  // Purge any queued notifications addressed to this agent — its query loop
  // has exited and won't drain them. killTask fires 'killed' notifications
  // asynchronously; drop the ones already queued and any that land later sit
  // harmlessly (no consumer matches a dead agentId).
  dequeueAllMatching(cmd => cmd.agentId === agentId)
}
