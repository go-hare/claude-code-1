import { randomBytes } from 'crypto'
import type { AppState } from './state/AppState.js'
import type { AgentId } from './types/ids.js'
import { getTaskOutputPath } from './utils/task/diskOutput.js'
import type { TaskRegistry } from './utils/taskRegistry.js'

export type TaskType =
  | 'local_bash'
  | 'local_agent'
  | 'remote_agent'
  | 'in_process_teammate'
  | 'local_workflow'
  | 'monitor_mcp'
  | 'mcp_task'
  | 'monitor_ws'
  | 'dream'
  | 'auto_mode_scan'

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  // Official workflow pause (zit/xao/ess). Not terminal (UE excludes paused).
  | 'paused'

/**
 * True when a task is in a terminal state and will not transition further.
 * Used to guard against injecting messages into dead teammates, evicting
 * finished tasks from AppState, and orphan-cleanup paths.
 * Official UE: completed | failed | killed — paused is intentionally excluded.
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

export type TaskHandle = {
  taskId: string
  cleanup?: () => void
}

export type SetAppState = (f: (prev: AppState) => AppState) => void

export type TaskContext = {
  abortController: AbortController
  getAppState: () => AppState
  setAppState: SetAppState
}

// Base fields shared by all task states
export type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  totalPausedMs?: number
  outputFile: string
  outputOffset: number
  notified: boolean
}

export type LocalShellSpawnInput = {
  command: string
  description: string
  timeout?: number
  toolUseId?: string
  agentId?: AgentId
  /**
   * densable `KMt` `innerCall===!0` — nested-in-tool bash (skill prompt
   * expansion). Stamps `caller: "inner"`.
   */
  innerCall?: boolean
  /** UI display variant: description-as-label, dialog title, status bar pill. */
  kind?: 'bash' | 'monitor'
  /** densable `shell` (`jhe` @191205950) — semantic exit-code interpretation. */
  shell?: 'bash' | 'powershell'
}

// densable LocalAgentTask.kill(e,t,r,n) → XV(e,t,n): t=registry, n=killedBy.
export type TaskKilledBy = 'user' | 'parent' | 'system'

// What getTaskByType dispatches for: kill. spawn/render were never
// called polymorphically (removed in #22546). Gold kill 2nd arg is Xm.
export type Task = {
  name: string
  type: TaskType
  kill(
    taskId: string,
    registry: TaskRegistry,
    killedBy?: TaskKilledBy,
  ): Promise<void>
}

// Task ID prefixes
const TASK_ID_PREFIXES: Record<string, string> = {
  local_bash: 'b', // Keep as 'b' for backward compatibility
  local_agent: 'a',
  remote_agent: 'r',
  in_process_teammate: 't',
  local_workflow: 'w',
  monitor_mcp: 'm',
  mcp_task: 'k',
  // densable MonitorWsTask / Kam — Artifact comment monitor
  monitor_ws: 'c',
  dream: 'd',
  // densable oyg auto_mode_scan:"e"
  auto_mode_scan: 'e',
}

// Get task ID prefix
function getTaskIdPrefix(type: TaskType): string {
  return TASK_ID_PREFIXES[type] ?? 'x'
}

// Case-insensitive-safe alphabet (digits + lowercase) for task IDs.
// 36^8 ≈ 2.8 trillion combinations, sufficient to resist brute-force symlink attacks.
const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function generateTaskId(type: TaskType): string {
  const prefix = getTaskIdPrefix(type)
  const bytes = randomBytes(8)
  let id = prefix
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length]
  }
  return id
}

export function createTaskStateBase(
  id: string,
  type: TaskType,
  description: string,
  toolUseId?: string,
): TaskStateBase {
  return {
    id,
    type,
    status: 'pending',
    description,
    toolUseId,
    startTime: Date.now(),
    outputFile: getTaskOutputPath(id),
    outputOffset: 0,
    notified: false,
  }
}
