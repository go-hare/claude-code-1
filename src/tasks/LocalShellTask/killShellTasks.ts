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
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'
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

/** SEA `PKt = 1500` — backstop wait before SIGKILL on exit (#810). */
export const SHELL_KILL_BACKSTOP_MS = 1500

export type LiveShellKillHandle = {
  status: string
  kill: () => void
  pid?: number
  result?: Promise<unknown>
}

type KillShellTasksHostState = {
  liveShellCommands: Set<LiveShellKillHandle>
  pendingKillBackstops: Set<Promise<void>>
}

const killShellTasksStateByHost = new HostSlot<KillShellTasksHostState>(() => ({
  liveShellCommands: new Set<LiveShellKillHandle>(),
  pendingKillBackstops: new Set<Promise<void>>(),
}))

function getKillShellTasksHostState(): KillShellTasksHostState {
  return killShellTasksStateByHost.of(getBootstrapSessionHost())
}

export function registerLiveShellCommand(
  handle: LiveShellKillHandle,
): () => void {
  const { liveShellCommands } = getKillShellTasksHostState()
  liveShellCommands.add(handle)
  return () => {
    liveShellCommands.delete(handle)
  }
}

function trackKillBackstop(
  handle: LiveShellKillHandle,
  state: KillShellTasksHostState,
): void {
  if (!handle.result && handle.pid === undefined) return
  const p = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = handle.result
      ? handle.result.then(
          () => true,
          () => true,
        )
      : Promise.resolve(false)
    const timedOut = new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), SHELL_KILL_BACKSTOP_MS)
      timer.unref?.()
    })
    const didSettle = await Promise.race([settled, timedOut])
    if (timer) clearTimeout(timer)
    if (!didSettle && handle.pid !== undefined) {
      try {
        process.kill(handle.pid, 'SIGKILL')
      } catch {
        // Process already exited
      }
    }
  })()
  state.pendingKillBackstops.add(p)
  void p.finally(() => {
    state.pendingKillBackstops.delete(p)
  })
}

/** SEA `rkr()` — kill all running live shell commands at shutdown (#810). */
export function killLiveShellCommands(): void {
  const state = killShellTasksStateByHost.peek(getBootstrapSessionHost())
  if (!state) return
  for (const cmd of Array.from(state.liveShellCommands)) {
    if (cmd.status === 'running' || cmd.status === 'backgrounded') {
      try {
        cmd.kill()
        trackKillBackstop(cmd, state)
      } catch (error) {
        logError(error)
      }
    }
  }
}

/** SEA `Htn()` — wait for pending shell kill backstops to settle (#810). */
export async function awaitPendingShellKillBackstops(): Promise<void> {
  const state = killShellTasksStateByHost.peek(getBootstrapSessionHost())
  if (!state) return
  await Promise.allSettled(Array.from(state.pendingKillBackstops))
}

/** Testing-only: clear live shell command & backstop sets. */
export function _resetLiveShellKillStateForTesting(): void {
  const state = killShellTasksStateByHost.peek(getBootstrapSessionHost())
  if (!state) return
  state.liveShellCommands.clear()
  state.pendingKillBackstops.clear()
}

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
