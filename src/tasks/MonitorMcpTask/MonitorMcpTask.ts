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
import {
  createTaskRegistry,
  type TaskRegistry,
} from '../../utils/taskRegistry.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  /** densable T2t `r.server` — MCP server name. */
  server: string
  /** densable T2t `r.tool` — resource/tool label shown as `server · tool`. */
  tool: string
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
  /**
   * densable 2.1.289 — MCP tool-result resource_link blocks collected on
   * auto-bg complete; forwarded on the task_notification bookend.
   */
  terminal?: {
    resource_links?: unknown[]
  }
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
    getAppState?: () => AppState
  },
): string {
  const id = generateTaskId('monitor_mcp')
  const task: MonitorMcpTaskState = {
    ...createTaskStateBase(id, 'monitor_mcp', opts.description, opts.toolUseId),
    type: 'monitor_mcp',
    status: 'running',
    server: opts.serverName,
    tool: opts.resourceUri,
    serverName: opts.serverName,
    resourceUri: opts.resourceUri,
    command: opts.command,
    agentId: opts.agentId,
    abortController: opts.abortController,
  }
  registerTask(task, setAppState)
  // densable YP(c, `monitor:${u}`, Xm) after register — r always present.
  // getAppState stays optional for non-owner register; Gge requires Xm.
  if (opts.agentId) {
    const getAppState = opts.getAppState
    if (!getAppState) {
      throw new TypeError('getAppState is required to attach monitor keepalive')
    }
    addKeepaliveReason(
      opts.agentId,
      monitorKeepaliveReason(id),
      createTaskRegistry(getAppState, setAppState),
    )
  }
  return id
}

function detachMonitorKeepalive(
  taskId: string,
  agentId: AgentId | undefined,
  registry: TaskRegistry,
): void {
  // densable hx(e,n,r): if(!e)return; r is always Xm. Skip when we never attached.
  if (!agentId) return
  removeKeepaliveReason(agentId, monitorKeepaliveReason(taskId), registry)
}

function emitMonitorTerminatedSdk(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  summary: string,
  toolUseId?: string,
  resourceLinks?: unknown[],
): void {
  // densable Host bookend — monitor has no model XML path; SDK alone closes Jp.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js')
    emitTaskTerminatedSdk(taskId, status, {
      toolUseId,
      summary,
      resourceLinks,
    })
  } catch {
    // best-effort
  }
}

export function completeMonitorMcpTask(
  taskId: string,
  setAppState: SetAppState,
  opts?: {
    resourceLinks?: unknown[]
    getAppState?: () => AppState
  },
): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description = 'Monitor'
  let changed = false
  let resourceLinks = opts?.resourceLinks
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    changed = true
    agentId = task.agentId
    toolUseId = task.toolUseId
    description = task.description || description
    const stored =
      resourceLinks && resourceLinks.length > 0
        ? resourceLinks
        : task.terminal?.resource_links
    resourceLinks = stored
    return {
      ...task,
      status: 'completed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      terminal:
        stored && stored.length > 0
          ? { ...task.terminal, resource_links: stored }
          : task.terminal,
    }
  })
  if (!changed) return
  // densable hx(c, `monitor:${taskId}`, Xm). Skip only when Gge never attached.
  if (agentId && opts?.getAppState) {
    detachMonitorKeepalive(
      taskId,
      agentId,
      createTaskRegistry(opts.getAppState, setAppState),
    )
  }
  emitMonitorTerminatedSdk(
    taskId,
    'completed',
    `Monitor "${description}" completed`,
    toolUseId,
    resourceLinks && resourceLinks.length > 0 ? resourceLinks : undefined,
  )
}

export function failMonitorMcpTask(
  taskId: string,
  setAppState: SetAppState,
  getAppState?: () => AppState,
): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description = 'Monitor'
  let changed = false
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    changed = true
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
  if (!changed) return
  if (agentId && getAppState) {
    detachMonitorKeepalive(
      taskId,
      agentId,
      createTaskRegistry(getAppState, setAppState),
    )
  }
  emitMonitorTerminatedSdk(
    taskId,
    'failed',
    `Monitor "${description}" failed`,
    toolUseId,
  )
}

export function killMonitorMcp(taskId: string, registry: TaskRegistry): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description = 'Monitor'
  let killed = false
  let abortController: AbortController | undefined
  registry.update<MonitorMcpTaskState>(taskId, task => {
    if (task.status !== 'running') return task
    agentId = task.agentId
    toolUseId = task.toolUseId
    description = task.description || description
    killed = true
    abortController = task.abortController
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  if (killed) {
    abortController?.abort()
    detachMonitorKeepalive(taskId, agentId, registry)
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
      killMonitorMcp(taskId, createTaskRegistry(getAppState, setAppState))
    }
  }
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',

  async kill(taskId, registry) {
    killMonitorMcp(taskId, registry)
  },
}
