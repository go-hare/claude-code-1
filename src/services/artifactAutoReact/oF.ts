/**
 * densable oF — stop monitor_ws task + disarm autoReact (quiet path for Prs).
 * Source: gold-oF-239.txt
 */
import { SN } from './gates.js'
import { dollarSo } from './intent.js'
import { Dso } from './supervisors.js'
import { un } from './store.js'

const socketMap = new Map<string, { close: () => void }>()

export const monitorSocketRegistry = {
  get(taskId: string) {
    return socketMap.get(taskId)
  },
  delete(taskId: string) {
    socketMap.delete(taskId)
  },
  set(taskId: string, socket: { close: () => void }) {
    socketMap.set(taskId, socket)
  },
  clear() {
    socketMap.clear()
  },
}

export type OfOptions = {
  quiet?: boolean
  userStop?: boolean
  taskStop?: boolean
  modelOrigin?: boolean
  connectionLost?: boolean
}

type TaskLike = {
  type?: string
  status?: string
  autoReactArmed?: boolean
  autoReactSlug?: string
  frameLive?: { slug?: string }
  abortController?: { abort?: (reason?: unknown) => void } | null
}

type TaskRegistryLike = {
  all: () => Record<string, TaskLike>
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
 * densable oF(taskId, registry, opts)
 * Quiet handoff: disarm + abort/remove task + close monitor socket.
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
  try {
    n?.abortController?.abort?.()
  } catch {
    /* ignore */
  }
  try {
    registry.remove?.(taskId)
  } catch {
    /* ignore */
  }
  const sock = monitorSocketRegistry.get(taskId)
  if (sock) {
    monitorSocketRegistry.delete(taskId)
    try {
      sock.close()
    } catch {
      /* ignore */
    }
  }
  void opts?.quiet
}
