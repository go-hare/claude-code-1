import stripAnsi from 'strip-ansi'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import type { TaskRegistry } from '../../utils/taskRegistry.js'
import { logForDebugging } from '../../utils/debug.js'

export type McpTaskState = TaskStateBase & {
  type: 'mcp_task'
  serverName: string
  toolName: string
  mcpTaskId: string
  mcpStatus: string
  statusMessage?: string
  pollIntervalMs?: number
  abortController?: AbortController
  protocol?: string
  driveAbortController?: AbortController
  ttlExpiresAt?: number
  parked?: unknown
  sidecarSessionId?: string
  sidecarProjectDir?: string
  sidecarWrite?: Promise<unknown>
  sep2663Cancel?: () => void
  onWorkerWakeOutcome?: (outcome: { kind: string }) => void
  terminal?: {
    summary?: string
    resource_links?: unknown[]
  }
}

export function isMcpTask(task: unknown): task is McpTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'mcp_task'
  )
}

const MCP_LABEL_CAP = 200
const MCP_LABEL_CONTROL_RE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Variation_Selector}]+/gu

/** densable `Ru` @207413711 — strip ANSI + controls/bidi, single-line, cap 200. */
function sanitizeMcpLabelPart(value: string | undefined): string {
  if (!value) return ''
  const cleaned = stripAnsi(value)
    .replace(MCP_LABEL_CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return ''
  if (cleaned.length <= MCP_LABEL_CAP) return cleaned
  let end = MCP_LABEL_CAP
  const prevCode = cleaned.charCodeAt(end - 1)
  if (prevCode >= 0xd800 && prevCode <= 0xdbff) end--
  return cleaned.slice(0, end)
}

/** densable `dj` @214308403 — sanitized `server/tool` label. */
export function mcpTaskLabel(serverName: string, toolName: string): string {
  return `${sanitizeMcpLabelPart(serverName)}/${sanitizeMcpLabelPart(toolName)}`
}

/** densable `VOt` — running mcp_task state. */
export function createMcpTaskState(opts: {
  serverName: string
  toolName: string
  mcpTaskId?: string
  toolUseId?: string
  pollIntervalMs?: number
  abortController?: AbortController
  protocol?: string
  driveAbortController?: AbortController
  ttlExpiresAt?: number
}): McpTaskState {
  const id = generateTaskId('mcp_task')
  return {
    ...createTaskStateBase(
      id,
      'mcp_task',
      mcpTaskLabel(opts.serverName, opts.toolName),
      opts.toolUseId,
    ),
    type: 'mcp_task',
    status: 'running',
    serverName: opts.serverName,
    toolName: opts.toolName,
    mcpTaskId: opts.mcpTaskId ?? id,
    mcpStatus: 'working',
    pollIntervalMs: opts.pollIntervalMs,
    abortController: opts.abortController,
    protocol: opts.protocol,
    driveAbortController: opts.driveAbortController,
    ttlExpiresAt: opts.ttlExpiresAt,
  }
}

export function registerMcpTask(
  setAppState: SetAppState,
  opts: Parameters<typeof createMcpTaskState>[0],
): string {
  const task = createMcpTaskState(opts)
  registerTask(task, setAppState)
  return task.id
}

function emitMcpTaskTerminatedSdk(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  summary: string,
  toolUseId?: string,
  resourceLinks?: unknown[],
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js')
    emitTaskTerminatedSdk(taskId, status, {
      toolUseId,
      summary,
      ...(resourceLinks && resourceLinks.length > 0 ? { resourceLinks } : {}),
    })
  } catch {
    // best-effort
  }
}

/** densable MCP_TASK.kill */
export function completeMcpTask(
  taskId: string,
  setAppState: SetAppState,
  statusMessage?: string,
  resourceLinks?: unknown[],
): boolean {
  let changed = false
  let toolUseId: string | undefined
  let description = 'MCP task'
  let storedLinks =
    resourceLinks && resourceLinks.length > 0 ? resourceLinks : undefined
  updateTaskState(taskId, setAppState, current => {
    if (!isMcpTask(current) || current.status !== 'running') return current
    changed = true
    toolUseId = current.toolUseId
    description = current.description || description
    storedLinks ??= current.terminal?.resource_links
    return {
      ...current,
      status: 'completed',
      mcpStatus: 'done',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      ...(statusMessage !== undefined ? { statusMessage } : {}),
      ...(storedLinks && storedLinks.length > 0
        ? { terminal: { ...current.terminal, resource_links: storedLinks } }
        : {}),
    }
  })
  if (changed) {
    emitMcpTaskTerminatedSdk(
      taskId,
      'completed',
      statusMessage ?? description,
      toolUseId,
      storedLinks,
    )
  }
  return changed
}

export function failMcpTask(
  taskId: string,
  setAppState: SetAppState,
  statusMessage?: string,
): boolean {
  let changed = false
  let toolUseId: string | undefined
  let description = 'MCP task'
  updateTaskState(taskId, setAppState, current => {
    if (!isMcpTask(current) || current.status !== 'running') return current
    changed = true
    toolUseId = current.toolUseId
    description = current.description || description
    const summary = statusMessage ?? description
    return {
      ...current,
      status: 'failed',
      mcpStatus: 'failed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      ...(statusMessage !== undefined ? { statusMessage } : {}),
      terminal: {
        ...current.terminal,
        summary,
      },
    }
  })
  if (changed) {
    emitMcpTaskTerminatedSdk(
      taskId,
      'failed',
      statusMessage ?? description,
      toolUseId,
    )
  }
  return changed
}

export async function killMcpTask(
  taskId: string,
  registry: TaskRegistry,
): Promise<void> {
  const task = registry.get(taskId)
  if (!isMcpTask(task)) return
  const sidecarWrite = task.sidecarWrite
  let killed = false
  registry.update(taskId, current => {
    if (
      !isMcpTask(current) ||
      current.notified ||
      current.status !== 'running'
    ) {
      return current
    }
    killed = true
    return {
      ...current,
      status: 'killed',
      endTime: Date.now(),
      parked: undefined,
      notified: true,
      abortController: undefined,
      driveAbortController: undefined,
    }
  })
  // densable @212118667: abort controllers + sep2663Cancel run unconditionally
  // even when `notified` was already true, while registry status is already
  // `'killed'` for `mcpAutoBackground` abort listeners when transitioning from running.
  task.abortController?.abort()
  task.driveAbortController?.abort()
  task.sep2663Cancel?.()
  if (killed) {
    emitMcpTaskTerminatedSdk(
      taskId,
      'stopped',
      task.description || 'MCP task',
      task.toolUseId,
    )
    try {
      task.onWorkerWakeOutcome?.({ kind: 'stopped' })
    } catch (err) {
      logForDebugging(
        `McpTask.kill: onWorkerWakeOutcome threw, the stop continues: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (sidecarWrite !== undefined) {
    void Promise.resolve(sidecarWrite).catch(err =>
      logForDebugging(`McpTask.kill sidecarWrite: ${String(err)}`),
    )
  }
}

/** densable `{name:"MCP Task", type:"mcp_task", kill}`. */
export const McpTask: Task = {
  name: 'MCP Task',
  type: 'mcp_task',
  async kill(taskId, registry) {
    await killMcpTask(taskId, registry)
  },
}
