/**
 * densable MonitorWsTask — Artifact comment monitor websocket task (2.1.239).
 * Source: gold-monitor-ws-create-239 / gold-autoReactArmed-set-239.
 */
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { TaskRegistry } from '../../utils/taskRegistry.js'
import type { AgentId } from '../../types/ids.js'
import {
  bindSupervisorTaskId,
  mI,
  oF,
  registerSupervisor,
  type AutoReactWiring,
} from '../../services/artifactAutoReact/index.js'
import type { AppState } from '../../state/AppState.js'
import {
  addKeepaliveReason,
  monitorKeepaliveReason,
  registerTask,
} from '../../utils/task/framework.js'
import { createTaskRegistry } from '../../utils/taskRegistry.js'

function ensureAutoReactAvailability(): void {
  // densable Lge gate: availability true once MonitorWs product is used.
  // Lazy (not top-level): avoids artifactAutoReact ↔ tasks init cycle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ar =
    require('../../services/artifactAutoReact/index.js') as typeof import('../../services/artifactAutoReact/index.js')
  ar.registerAutoReactAvailability(() => true)
  // Product edge: Qem+Cji+yWt — do not clobber test/localArm overrides.
  if (
    !ar.isArtifactAutoReactProductInstalled() &&
    !ar.isArtifactLiveArmDepsInstalled()
  ) {
    ar.installArtifactAutoReactProduct()
  }
}

export type MonitorWsFrameLive = {
  slug: string
  title?: string
  explicit?: boolean
  watchedSince?: number
  armedVia?: string
  armedAt?: number
}

export type MonitorWsTaskState = TaskStateBase & {
  type: 'monitor_ws'
  url?: string
  timeoutId?: ReturnType<typeof setTimeout>
  ambient?: boolean
  autoReactArmed?: boolean
  autoReactSlug?: string
  frameLive?: MonitorWsFrameLive
  agentId?: AgentId
  abortController?: AbortController
}

export function isMonitorWsTask(task: unknown): task is MonitorWsTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    (task as { type?: string }).type === 'monitor_ws'
  )
}

export type RegisterMonitorWsOpts = {
  description: string
  url?: string
  slug: string
  title?: string
  explicit?: boolean
  armedVia?: string
  ambient?: boolean
  autoReactArmed?: boolean
  autoReactWiring?: AutoReactWiring
  toolUseId?: string
  agentId?: AgentId
  abortController?: AbortController
  getAppState?: () => AppState
}

/**
 * densable monitor_ws register + supervisors.set when auto-react armed.
 */
export function registerMonitorWsTask(
  setAppState: SetAppState,
  opts: RegisterMonitorWsOpts,
): string {
  ensureAutoReactAvailability()
  mI()
  const id = generateTaskId('monitor_ws')
  const armed = opts.autoReactArmed !== false
  const watchedSince = Date.now()
  const frameLive: MonitorWsFrameLive = {
    slug: opts.slug,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.explicit !== undefined ? { explicit: opts.explicit } : {}),
    watchedSince,
    ...(opts.armedVia !== undefined ? { armedVia: opts.armedVia } : {}),
    armedAt: Date.now(),
  }
  const abort = opts.abortController ?? new AbortController()
  const task: MonitorWsTaskState = {
    ...createTaskStateBase(id, 'monitor_ws', opts.description, opts.toolUseId),
    type: 'monitor_ws',
    status: 'running',
    url: opts.url,
    ambient: opts.ambient,
    ...(armed ? { autoReactArmed: true, autoReactSlug: opts.slug } : {}),
    frameLive,
    agentId: opts.agentId,
    abortController: abort,
  }
  registerTask(task, setAppState)
  // densable YP(k, `monitor:${i}`, y) — r always present (YP no-ops if !k)
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
  if (armed) {
    const wiring: AutoReactWiring =
      opts.autoReactWiring ??
      (opts.title !== undefined ? { title: opts.title } : {})
    const supervisor = registerSupervisor({
      slug: opts.slug,
      url: opts.url,
      explicit: opts.explicit,
      armedVia: opts.armedVia,
      autoReactWiring:
        Object.keys(wiring).length > 0 || opts.title !== undefined
          ? {
              ...wiring,
              ...(opts.title !== undefined ? { title: opts.title } : {}),
            }
          : { title: opts.slug },
    })
    bindSupervisorTaskId(supervisor, opts.slug, id)
  }
  return id
}

export function killMonitorWs(
  taskId: string,
  registry: TaskRegistry,
  source: 'user' | 'system' | 'parent' = 'user',
): void {
  // densable eCo.kill → vy(taskId, registry, opts)
  oF(
    taskId,
    registry as unknown as Parameters<typeof oF>[1],
    source === 'system'
      ? {}
      : { userStop: true, taskStop: true, modelOrigin: source === 'parent' },
  )
}

export function killMonitorWsTasksForAgent(
  agentId: AgentId,
  registry: TaskRegistry,
): void {
  for (const task of Object.values(registry.all())) {
    if (
      isMonitorWsTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      killMonitorWs(task.id, registry, 'parent')
    }
  }
}

export const MonitorWsTask: Task = {
  name: 'MonitorWsTask',
  type: 'monitor_ws',
  async kill(taskId, registry, killedBy) {
    killMonitorWs(
      taskId,
      registry,
      killedBy === 'system'
        ? 'system'
        : killedBy === 'parent'
          ? 'parent'
          : 'user',
    )
  },
}
