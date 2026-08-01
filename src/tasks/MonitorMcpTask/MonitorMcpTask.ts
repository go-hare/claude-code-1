// Background task entry for MCP resource monitoring.
// Tracks a long-running subscription to an MCP server resource so the
// otherwise-invisible stream is visible in the footer pill and Shift+Down
// dialog. Follows the DreamTask pattern: pure UI surfacing via the existing
// task registry.

import type { AppState } from '../../state/AppState.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  addKeepaliveReason,
  monitorKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
} from '../../utils/task/framework.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  /** The MCP server name being monitored. */
  serverName: string
  /** The resource URI being subscribed to. */
  resourceUri: string
  /** The shell command used to drive monitoring (if any). */
  command?: string
  /** Agent that spawned this task. Used to kill orphaned tasks on agent exit. */
  agentId?: AgentId
  /** Abort controller to cancel the subscription. */
  abortController?: AbortController
}

export function isMonitorMcpTask(task: unknown): task is MonitorMcpTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'monitor_mcp'
  )
}

export function registerMonitorMcpTask(
  setAppState: SetAppState,
  opts: {
    description: string
    serverName: string
    resourceUri: string
    command?: string
    toolUseId?: string
    agentId?: AgentId
    abortController?: AbortController
  },
): string {
  const id = generateTaskId('monitor_mcp')
  const task: MonitorMcpTaskState = {
    ...createTaskStateBase(id, 'monitor_mcp', opts.description, opts.toolUseId),
    type: 'monitor_mcp',
    status: 'running',
    serverName: opts.serverName,
    resourceUri: opts.resourceUri,
    command: opts.command,
    agentId: opts.agentId,
    abortController: opts.abortController,
  }
  registerTask(task, setAppState)
  // densable: Gge(c, `monitor:${u}`, registry) after register
  if (opts.agentId) {
    addKeepaliveReason(opts.agentId, monitorKeepaliveReason(id), setAppState)
  }
  return id
}

function detachMonitorKeepalive(
  taskId: string,
  agentId: AgentId | undefined,
  setAppState: SetAppState,
): void {
  if (!agentId) return
  removeKeepaliveReason(agentId, monitorKeepaliveReason(taskId), setAppState)
}

function emitMonitorTerminatedSdk(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  summary: string,
  toolUseId?: string,
): void {
  // densable Host bookend — monitor has no model XML path; SDK alone closes Jp.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js')
    emitTaskTerminatedSdk(taskId, status, { toolUseId, summary })
  } catch {
    // best-effort
  }
}

export function completeMonitorMcpTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description = 'Monitor'
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    agentId = task.agentId
    toolUseId = task.toolUseId
    description = task.description || description
    return {
      ...task,
      status: 'completed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  // densable: tB(c, `monitor:${taskId}`) on finish
  detachMonitorKeepalive(taskId, agentId, setAppState)
  emitMonitorTerminatedSdk(
    taskId,
    'completed',
    `Monitor "${description}" completed`,
    toolUseId,
  )
}

export function failMonitorMcpTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description = 'Monitor'
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    agentId = task.agentId
    toolUseId = task.toolUseId
    description = task.description || description
    return {
      ...task,
      status: 'failed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  detachMonitorKeepalive(taskId, agentId, setAppState)
  emitMonitorTerminatedSdk(
    taskId,
    'failed',
    `Monitor "${description}" failed`,
    toolUseId,
  )
}

export function killMonitorMcp(taskId: string, setAppState: SetAppState): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description = 'Monitor'
  let killed = false
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    agentId = task.agentId
    toolUseId = task.toolUseId
    description = task.description || description
    killed = true
    task.abortController?.abort()
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  if (killed) {
    detachMonitorKeepalive(taskId, agentId, setAppState)
    emitMonitorTerminatedSdk(
      taskId,
      'stopped',
      `Monitor "${description}" was stopped`,
      toolUseId,
    )
  }
}

/**
 * Kill all running monitor_mcp tasks spawned by a given agent.
 * Called from runAgent.ts finally block so subscriptions don't outlive
 * the agent that started them.
 */
export function killMonitorMcpTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppState,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (
      isMonitorMcpTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killMonitorMcpTasksForAgent: killing orphaned monitor task ${taskId} (agent ${agentId} exiting)`,
      )
      killMonitorMcp(taskId, setAppState)
    }
  }
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',

  async kill(taskId, setAppState) {
    killMonitorMcp(taskId, setAppState)
  },
}
