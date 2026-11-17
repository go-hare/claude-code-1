// Pure type + type guard for LocalShellTask state.
// Extracted from LocalShellTask.tsx so non-React consumers (stopTask.ts via
// print.ts) don't pull React/ink into the module graph.

import type { TaskStateBase } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import type { ShellCommand } from '../../utils/ShellCommand.js'
import type { AgentContext } from '../../utils/agentContext.js'

export type BashTaskKind = 'bash' | 'monitor'
export type LocalShellFlavor = 'bash' | 'powershell'

export type LocalShellTaskState = TaskStateBase & {
  type: 'local_bash' // Keep as 'local_bash' for backward compatibility with persisted session state
  command: string
  /** densable `shell` (`jhe` @191205950) — semantic exit-code interpretation. */
  shell?: LocalShellFlavor
  result?: {
    code: number
    interrupted: boolean
  }
  completionStatusSentInAttachment: boolean
  shellCommand: ShellCommand | null
  unregisterCleanup?: () => void
  cleanupTimeoutId?: NodeJS.Timeout
  // Track what we last reported for computing deltas (total lines from TaskOutput)
  lastReportedTotalLines: number
  // Whether the task has been backgrounded (false = foreground running, true = backgrounded)
  isBackgrounded: boolean
  // Agent that spawned this task. Used to kill orphaned bash tasks when the
  // agent exits (see killShellTasksForAgent). Undefined = main thread.
  agentId?: AgentId
  /**
   * densable `caller` — eNr: main-thread shells are `turn`, subagent shells
   * are `agent`. Inner preamble calls use `inner`.
   */
  caller?: 'turn' | 'agent' | 'inner'
  // UI display variant. 'monitor' → shows description instead of command,
  // 'Monitor details' dialog title, distinct status bar pill.
  kind?: BashTaskKind
  /**
   * Official 2.1.247 nsc `isAdopted:!0` — shell rehydrated from a foreground
   * carry-over / adopt.json. ADt/eA skip the `[exited with code …]` footer.
   */
  isAdopted?: boolean
  /**
   * densable `_un` extra — XVe/tNr stamped `backgroundedToDeliverMessage`.
   * K3n reads this when Bash/PowerShell return a backgrounded result.
   */
  backgroundedToDeliverMessage?: boolean
  /** densable plugin turn-abort moved this command to the background. */
  backgroundedByTurnAbort?: boolean
}

/** densable `backgroundTaskId !== undefined && cZe(agentContext)`. */
export function backgroundShellReapedAtFinalResponse(
  taskId: string | undefined,
  context: AgentContext | undefined,
): true | undefined {
  return taskId !== undefined &&
    context?.agentType === 'subagent' &&
    context.isAsync === false
    ? true
    : undefined
}

/** densable `K3n`. */
export function isBackgroundedToDeliverMessage(task: unknown): boolean {
  return isLocalShellTask(task) && task.backgroundedToDeliverMessage === true
}

export function isBackgroundedByTurnAbort(task: unknown): boolean {
  return isLocalShellTask(task) && task.backgroundedByTurnAbort === true
}

export function isLocalShellTask(task: unknown): task is LocalShellTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_bash'
  )
}
