/**
 * densable oF — stop monitor_ws task + disarm autoReact (quiet path for Prs).
 * Source: gold-oF-239.txt
 */
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'
import { SN } from './gates.js'
import { dollarSo } from './intent.js'
import { Dso } from './supervisors.js'
import { un } from './store.js'

const socketMapByHost = new HostSlot(
  () => new Map<string, { close: () => void }>(),
)

function getSocketMap(): Map<string, { close: () => void }> {
  return socketMapByHost.of(getBootstrapSessionHost())
}

export const monitorSocketRegistry = {
  get(taskId: string) {
    return getSocketMap().get(taskId)
  },
  delete(taskId: string) {
    getSocketMap().delete(taskId)
  },
  set(taskId: string, socket: { close: () => void }) {
    getSocketMap().set(taskId, socket)
  },
  clear() {
    getSocketMap().clear()
  },
}

export type OfOptions = {
  quiet?: boolean
  userStop?: boolean
  taskStop?: boolean
  modelOrigin?: boolean
  connectionLost?: boolean
  endedAs?: {
    status: 'completed' | 'failed' | 'killed'
    summary?: string
  }
}

type TaskLike = {
  type?: string
  status?: string
  description?: string
  toolUseId?: string
  agentId?: string
  timeoutId?: ReturnType<typeof setTimeout>
  autoReactArmed?: boolean
  autoReactSlug?: string
  frameLive?: { slug?: string }
  abortController?: { abort?: (reason?: unknown) => void } | null
}

type TaskRegistryLike = {
  all: () => Record<string, TaskLike>
  update?:
    | ((
        id: string,
        updater: (task: Record<string, unknown>) => Record<string, unknown>,
      ) => void)
    | (<T extends TaskLike = TaskLike>(
        id: string,
        updater: (task: T) => T,
      ) => void)
  remove?: (id: string) => void
}

/** densable lEt / lvl / Jro subset — mark slug stopped + Dso. */
function deliberateStopSlug(slug: string): void {
  const { wakes, durable } = un()
  if (!wakes.stoppedSlugs.has(slug)) {
    wakes.stoppedSlugs.add(slug)
    wakes.sweptSlugs.add(slug)
  }
  durable.stopLatches.confirmStop(slug)
  dollarSo(slug)
  Dso([slug])
}

/**
 * densable vy / P (`oF(taskId, registry, opts)`)
 * Disarms autoReact if applicable, transitions running monitor_ws task to
 * terminal state (`killed` by default, never deleted from registry), closes
 * registered socket, releases keepalive, and emits `[Monitor stopped]` when
 * `!opts?.quiet` plus SDK `stopped` bookend.
 */
export function oF(
  taskId: string,
  registry: TaskRegistryLike,
  opts?: OfOptions,
): void {
  const n = registry.all()[taskId]
  if (n && n.type === 'monitor_ws' && n.autoReactArmed === true) {
    const slug = n.autoReactSlug ?? n.frameLive?.slug
    if (typeof slug === 'string' && slug.length > 0) {
      if (opts?.connectionLost !== true) deliberateStopSlug(slug)
      else if (!SN(slug)) deliberateStopSlug(slug)
    }
  }
  if (
    opts?.userStop === true &&
    n?.type === 'monitor_ws' &&
    n.frameLive?.slug
  ) {
    deliberateStopSlug(n.frameLive.slug)
  }

  let description: string | undefined
  let toolUseId: string | undefined
  let agentId: string | undefined
  if (registry.update) {
    const updateTask = registry.update as (
      id: string,
      updater: (task: TaskLike) => TaskLike,
    ) => void
    updateTask(taskId, s => {
      if (s.status !== 'running') return s
      description = s.description
      toolUseId = s.toolUseId
      agentId = s.agentId
      if (s.timeoutId !== undefined) clearTimeout(s.timeoutId)
      return {
        ...s,
        status: opts?.endedAs?.status ?? 'killed',
        endTime: Date.now(),
        timeoutId: undefined,
        notified: true,
        terminal: {
          summary: opts?.endedAs?.summary ?? s.description,
        },
      }
    })
  } else if (n && n.status === 'running') {
    description = n.description
    toolUseId = n.toolUseId
    agentId = n.agentId
  }

  // Invalidate socket ownership and abort after terminal state is stamped.
  const sock = monitorSocketRegistry.get(taskId)
  monitorSocketRegistry.delete(taskId)
  try {
    n?.abortController?.abort?.()
  } catch {
    /* ignore */
  }
  if (sock) {
    try {
      sock.close()
    } catch {
      /* ignore */
    }
  }

  if (agentId && registry.update) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { monitorKeepaliveReason, removeKeepaliveReason } =
        require('../../utils/task/framework.js') as typeof import('../../utils/task/framework.js')
      removeKeepaliveReason(
        agentId as never,
        monitorKeepaliveReason(taskId),
        registry as never,
      )
    } catch {
      /* optional */
    }
  }

  if (description !== undefined) {
    if (!opts?.quiet) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { notifyMonitorStreamEvent } =
          require('../../utils/monitorStreamNotify.js') as typeof import('../../utils/monitorStreamNotify.js')
        notifyMonitorStreamEvent(description, '[Monitor stopped]', taskId, {
          isHousekeeping: true,
          agentId,
        })
      } catch {
        /* best-effort */
      }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitTaskTerminatedSdk } =
        require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js')
      const sdkStatus =
        opts?.endedAs?.status === 'completed' ||
        opts?.endedAs?.status === 'failed'
          ? opts.endedAs.status
          : 'stopped'
      emitTaskTerminatedSdk(taskId, sdkStatus, {
        toolUseId,
        summary: opts?.endedAs?.summary ?? description,
      })
    } catch {
      /* best-effort */
    }
  }
}
