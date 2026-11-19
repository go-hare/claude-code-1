import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'fs/promises'
import { join } from 'path'
import stripAnsi from 'strip-ansi'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '../../bootstrap/state.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import { logForDebugging } from '../../utils/debug.js'
import { isENOENT } from '../../utils/errors.js'
import { getProjectDir } from '../../utils/sessionStoragePortable.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import type { TaskRegistry } from '../../utils/taskRegistry.js'

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
  endingGoesTo?: (kind: string) => void
  newsToConfirm?: Array<() => void>
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
  sidecarSessionId?: string
  sidecarProjectDir?: string
  sidecarWrite?: Promise<unknown>
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
    sidecarSessionId: opts.sidecarSessionId,
    sidecarProjectDir: opts.sidecarProjectDir,
    sidecarWrite: opts.sidecarWrite,
  }
}

export function registerMcpTask(
  setAppState: SetAppState,
  opts: Parameters<typeof createMcpTaskState>[0],
): string {
  const task = createMcpTaskState(opts)
  if (task.protocol === 'sep2663') {
    const sessionId = opts.sidecarSessionId ?? safeGetCurrentSessionId()
    const projectDir = opts.sidecarProjectDir ?? safeResolveSep2663ProjectDir()
    if (sessionId && projectDir) {
      task.sidecarSessionId = sessionId
      task.sidecarProjectDir = projectDir
      task.sidecarWrite = writeSep2663TaskSidecar(
        {
          taskId: task.id,
          serverName: task.serverName,
          toolName: task.toolName,
          mcpTaskId: task.mcpTaskId,
          protocol: 'sep2663',
          ...(task.toolUseId !== undefined
            ? { toolUseId: task.toolUseId }
            : {}),
          ...(task.pollIntervalMs !== undefined
            ? { pollIntervalMs: task.pollIntervalMs }
            : {}),
          ...(task.ttlExpiresAt !== undefined
            ? { ttlExpiresAt: task.ttlExpiresAt }
            : {}),
        },
        { sessionId, projectDir },
      )
    }
  }
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

function scheduleSep2663SidecarRemoval(
  taskId: string,
  protocol: string | undefined,
  sidecarWrite: Promise<unknown> | undefined,
  sidecarSessionId: string | undefined,
  sidecarProjectDir: string | undefined,
): void {
  if (protocol !== 'sep2663') return
  const remove = () => {
    void removeSep2663TaskSidecar(taskId, {
      sessionId: sidecarSessionId,
      projectDir: sidecarProjectDir,
    })
  }
  if (sidecarWrite !== undefined) {
    void Promise.resolve(sidecarWrite)
      .catch(err =>
        logForDebugging(`McpTask sidecarWrite before cleanup: ${String(err)}`),
      )
      .finally(remove)
  } else {
    remove()
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
  let protocol: string | undefined
  let sidecarWrite: Promise<unknown> | undefined
  let sidecarSessionId: string | undefined
  let sidecarProjectDir: string | undefined
  let storedLinks =
    resourceLinks && resourceLinks.length > 0 ? resourceLinks : undefined
  updateTaskState(taskId, setAppState, current => {
    if (!isMcpTask(current) || current.status !== 'running') return current
    changed = true
    toolUseId = current.toolUseId
    description = current.description || description
    protocol = current.protocol
    sidecarWrite = current.sidecarWrite
    sidecarSessionId = current.sidecarSessionId
    sidecarProjectDir = current.sidecarProjectDir
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
    scheduleSep2663SidecarRemoval(
      taskId,
      protocol,
      sidecarWrite,
      sidecarSessionId,
      sidecarProjectDir,
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
  let protocol: string | undefined
  let sidecarWrite: Promise<unknown> | undefined
  let sidecarSessionId: string | undefined
  let sidecarProjectDir: string | undefined
  updateTaskState(taskId, setAppState, current => {
    if (!isMcpTask(current) || current.status !== 'running') return current
    changed = true
    toolUseId = current.toolUseId
    description = current.description || description
    protocol = current.protocol
    sidecarWrite = current.sidecarWrite
    sidecarSessionId = current.sidecarSessionId
    sidecarProjectDir = current.sidecarProjectDir
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
    scheduleSep2663SidecarRemoval(
      taskId,
      protocol,
      sidecarWrite,
      sidecarSessionId,
      sidecarProjectDir,
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
  // SEA 325 `q_s.kill` @317071891: abort controllers + sep2663Cancel first.
  task.abortController?.abort()
  task.driveAbortController?.abort()
  task.sep2663Cancel?.()
  let killed = false
  let endingGoesTo: ((kind: string) => void) | undefined
  registry.update(taskId, current => {
    if (
      !isMcpTask(current) ||
      current.notified ||
      current.status !== 'running'
    ) {
      return current
    }
    killed = true
    endingGoesTo = current.endingGoesTo
    return {
      ...current,
      status: 'killed',
      endTime: Date.now(),
      endingGoesTo: undefined,
      parked: undefined,
      newsToConfirm: undefined,
      notified: true,
      abortController: undefined,
      driveAbortController: undefined,
    }
  })
  if (killed) {
    emitMcpTaskTerminatedSdk(
      taskId,
      'stopped',
      task.description || 'MCP task',
      task.toolUseId,
    )
    try {
      endingGoesTo?.('stopped')
      task.onWorkerWakeOutcome?.({ kind: 'stopped' })
    } catch (err) {
      logForDebugging(
        `McpTask.kill: onWorkerWakeOutcome or endingGoesTo threw, the stop continues: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    try {
      task.newsToConfirm?.forEach(confirm => confirm())
    } catch (err) {
      logForDebugging(
        `McpTask.kill: a confirm of mcp_tasks_changed threw, the stop continues: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (task.protocol === 'sep2663') {
    scheduleSep2663SidecarRemoval(
      taskId,
      task.protocol,
      sidecarWrite,
      task.sidecarSessionId,
      task.sidecarProjectDir,
    )
  } else if (sidecarWrite !== undefined) {
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

/**
 * Official 325 #1717 — SEP-2663 task sidecar metadata persisted for `--resume`
 * restoration so long-running claude.ai connector tasks still report results.
 */
export type Sep2663TaskSidecarMeta = {
  taskId: string
  serverName: string
  toolName: string
  mcpTaskId: string
  protocol?: string
  toolUseId?: string
  pollIntervalMs?: number
  ttlExpiresAt?: number
}

function safeGetCurrentSessionId(): string | undefined {
  try {
    return getSessionId()
  } catch {
    return undefined
  }
}

function safeResolveSep2663ProjectDir(): string | undefined {
  try {
    return getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  } catch {
    return undefined
  }
}

function sanitizeSidecarTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * #1717: Unified directory for persisted SEP-2663 MCP task sidecar metadata:
 * `<projectDir>/<sessionId>/mcp-tasks`, where `<projectDir>` defaults to
 * `getSessionProjectDir() ?? getProjectDir(getOriginalCwd())`.
 */
export function getSep2663TaskSidecarDir(
  sessionId: string,
  projectDir?: string,
): string {
  const baseProjectDir =
    projectDir ?? getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(baseProjectDir, sessionId, 'mcp-tasks')
}

/**
 * #1717: Unified path for a single SEP-2663 MCP task sidecar file:
 * `<projectDir>/<sessionId>/mcp-tasks/mcp-task-<id>.meta.json`.
 */
export function getSep2663TaskSidecarPath(
  taskId: string,
  sessionId: string,
  projectDir?: string,
): string {
  return join(
    getSep2663TaskSidecarDir(sessionId, projectDir),
    `mcp-task-${sanitizeSidecarTaskId(taskId)}.meta.json`,
  )
}

/**
 * #1717: Atomically persist a SEP-2663 MCP task sidecar metadata file.
 * Best-effort: logs debug and returns `undefined` on any filesystem failure.
 */
export async function writeSep2663TaskSidecar(
  meta: Sep2663TaskSidecarMeta,
  opts?: { sessionId?: string; projectDir?: string },
): Promise<string | undefined> {
  const sessionId = opts?.sessionId ?? safeGetCurrentSessionId()
  const projectDir = opts?.projectDir ?? safeResolveSep2663ProjectDir()
  if (!sessionId || !projectDir) {
    return undefined
  }
  const dir = getSep2663TaskSidecarDir(sessionId, projectDir)
  const targetPath = getSep2663TaskSidecarPath(
    meta.taskId,
    sessionId,
    projectDir,
  )
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmpPath, JSON.stringify(meta), 'utf8')
    await rename(tmpPath, targetPath)
    return targetPath
  } catch (err) {
    logForDebugging(
      `writeSep2663TaskSidecar(${meta.taskId}) failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    await unlink(tmpPath).catch(() => {})
    return undefined
  }
}

/**
 * #1717: Remove a persisted SEP-2663 MCP task sidecar file when the task
 * reaches a terminal state (completed / failed / killed). Best-effort.
 */
export async function removeSep2663TaskSidecar(
  taskId: string,
  opts?: { sessionId?: string; projectDir?: string },
): Promise<void> {
  const sessionId = opts?.sessionId ?? safeGetCurrentSessionId()
  const projectDir = opts?.projectDir ?? safeResolveSep2663ProjectDir()
  if (!sessionId || !projectDir) {
    return
  }
  const targetPath = getSep2663TaskSidecarPath(taskId, sessionId, projectDir)
  try {
    await unlink(targetPath)
  } catch (err) {
    if (!isENOENT(err)) {
      logForDebugging(
        `removeSep2663TaskSidecar(${taskId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/**
 * Official 2.1.325 #1717 (`tgt` / `listMcpTaskMetadata`): read persisted
 * SEP-2663 task sidecar metadata files from
 * `<projectDir>/<sessionId>/mcp-tasks/mcp-task-*.meta.json`.
 */
export async function readPersistedSep2663TaskMetas(
  sessionId: string,
  projectDir?: string,
  sidecarDirOverride?: string,
): Promise<Sep2663TaskSidecarMeta[]> {
  const dir =
    sidecarDirOverride ?? getSep2663TaskSidecarDir(sessionId, projectDir)
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const metas: Sep2663TaskSidecarMeta[] = []
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith('mcp-task-') ||
      !entry.name.endsWith('.meta.json')
    ) {
      continue
    }
    try {
      const raw = await readFile(join(dir, entry.name), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') continue
      const rec = parsed as Record<string, unknown>
      if (
        typeof rec.taskId !== 'string' ||
        typeof rec.serverName !== 'string' ||
        typeof rec.toolName !== 'string' ||
        typeof rec.mcpTaskId !== 'string'
      ) {
        continue
      }
      metas.push({
        taskId: rec.taskId,
        serverName: rec.serverName,
        toolName: rec.toolName,
        mcpTaskId: rec.mcpTaskId,
        protocol: typeof rec.protocol === 'string' ? rec.protocol : undefined,
        toolUseId:
          typeof rec.toolUseId === 'string' ? rec.toolUseId : undefined,
        pollIntervalMs:
          typeof rec.pollIntervalMs === 'number'
            ? rec.pollIntervalMs
            : undefined,
        ttlExpiresAt:
          typeof rec.ttlExpiresAt === 'number' ? rec.ttlExpiresAt : undefined,
      })
    } catch (err) {
      logForDebugging(
        `readPersistedSep2663TaskMetas: skipping ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return metas
}

export type RestoredMcpTaskBinding = {
  pollToCompletion: (signal: AbortSignal) => Promise<{
    status: 'completed' | 'failed'
    resultText?: string
    statusMessage?: string
    resourceLinks?: unknown[]
  }>
}

/**
 * Official 325 `restoreSep2663Tasks` (#1717) — re-register persisted SEP-2663
 * MCP tasks on `--resume`, attach each task's poller binding to its server
 * connection, and emit completion/failure notifications when finished.
 */
export async function restoreSep2663Tasks(params: {
  metas: readonly Sep2663TaskSidecarMeta[]
  setAppState: SetAppState
  sidecarSessionId?: string
  sidecarProjectDir?: string
  bindingFactory: (
    meta: Sep2663TaskSidecarMeta,
  ) =>
    | RestoredMcpTaskBinding
    | Promise<RestoredMcpTaskBinding | undefined>
    | undefined
  onNotify?: (notification: {
    taskId: string
    serverName: string
    toolName: string
    status: 'completed' | 'failed'
    resultText?: string
    statusMessage?: string
  }) => void
}): Promise<{ restoredTaskIds: string[]; skippedTaskIds: string[] }> {
  const restoredTaskIds: string[] = []
  const skippedTaskIds: string[] = []

  for (const meta of params.metas) {
    if (meta.protocol !== 'sep2663') {
      skippedTaskIds.push(meta.taskId)
      continue
    }
    let binding: RestoredMcpTaskBinding | undefined
    try {
      binding = await params.bindingFactory(meta)
    } catch (err) {
      logForDebugging(
        `restoreSep2663Tasks: bindingFactory failed for ${meta.taskId}: ${String(err)}`,
      )
      skippedTaskIds.push(meta.taskId)
      continue
    }
    if (!binding) {
      skippedTaskIds.push(meta.taskId)
      continue
    }

    const driveController = new AbortController()
    const task: McpTaskState = {
      ...createTaskStateBase(
        meta.taskId,
        'mcp_task',
        mcpTaskLabel(meta.serverName, meta.toolName),
        meta.toolUseId,
      ),
      type: 'mcp_task',
      status: 'running',
      serverName: meta.serverName,
      toolName: meta.toolName,
      mcpTaskId: meta.mcpTaskId,
      mcpStatus: 'working',
      protocol: 'sep2663',
      pollIntervalMs: meta.pollIntervalMs,
      ttlExpiresAt: meta.ttlExpiresAt,
      driveAbortController: driveController,
      sidecarSessionId: params.sidecarSessionId,
      sidecarProjectDir: params.sidecarProjectDir,
    }
    registerTask(task, params.setAppState)
    restoredTaskIds.push(meta.taskId)

    void binding
      .pollToCompletion(driveController.signal)
      .then(outcome => {
        if (outcome.status === 'completed') {
          const transitioned = completeMcpTask(
            meta.taskId,
            params.setAppState,
            outcome.statusMessage,
            outcome.resourceLinks,
          )
          if (transitioned) {
            params.onNotify?.({
              taskId: meta.taskId,
              serverName: meta.serverName,
              toolName: meta.toolName,
              status: 'completed',
              resultText: outcome.resultText,
            })
          }
        } else {
          const transitioned = failMcpTask(
            meta.taskId,
            params.setAppState,
            outcome.statusMessage,
          )
          if (transitioned) {
            params.onNotify?.({
              taskId: meta.taskId,
              serverName: meta.serverName,
              toolName: meta.toolName,
              status: 'failed',
              statusMessage: outcome.statusMessage,
            })
          }
        }
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err)
        const transitioned = failMcpTask(meta.taskId, params.setAppState, msg)
        if (transitioned) {
          params.onNotify?.({
            taskId: meta.taskId,
            serverName: meta.serverName,
            toolName: meta.toolName,
            status: 'failed',
            statusMessage: msg,
          })
        }
      })
  }

  return { restoredTaskIds, skippedTaskIds }
}
