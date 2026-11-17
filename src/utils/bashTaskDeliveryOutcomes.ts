/**
 * densable `Qn().bashTaskDeliveryOutcomes` — GetTask splice result per messageId.
 * As `_p` paints the delivery suffix iff
 * `taskDelivery !== undefined && get(messageId) !== "no_host"`.
 * Unset (KRr has not reported) is hosted — same as gold `Map.get === undefined`.
 *
 * Gold `Qn()` is host-keyed (`dx.of(U().host)`). The bag follows
 * sessionBackgroundGates: WeakMap(host) + fallback for tests.
 */
import type { Message } from '../types/message.js'
import type { TaskRegistry } from './taskRegistry.js'

export type BashTaskDeliveryOutcome = 'spliced' | 'no_host' | 'unparseable'

/** densable `eg` — synthetic GetTask tool name in the delivery suffix. */
export const GET_TASK_TOOL_NAME = 'GetTask'

/** densable `e_` — snapshot LRU cap. */
const SNAPSHOT_CAP = 200
/** densable `ux` — GetTask-per-response LRU cap. */
const GETS_BY_RESPONSE_CAP = 64

export type BashTaskSnapshotEntry = {
  snapshot: unknown
  agentId?: string
  fetched: boolean
}

/**
 * Queue / snapshot / withdraw owner id. Main-thread callers omit agentId;
 * densable `n??Ve()` / `mi()` so `undefined === mi()` cannot miss.
 */
function bashTaskOwnerAgentId(agentId?: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMainThreadAgentId } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  return agentId ?? getMainThreadAgentId()
}

function messagesHaveGetTaskResult(
  messages: readonly Message[] | undefined,
  taskId: string,
): boolean {
  if (!messages) return false
  const calls = new Set<string>()
  for (const msg of messages) {
    const content = msg.message?.content
    if (msg.type !== 'assistant' || !Array.isArray(content)) continue
    for (const block of content) {
      if (
        block.type === 'tool_use' &&
        block.name === GET_TASK_TOOL_NAME &&
        block.input !== null &&
        typeof block.input === 'object' &&
        'taskId' in block.input &&
        block.input.taskId === taskId
      ) {
        calls.add(block.id)
      }
    }
  }
  return messages.some(msg => {
    const content = msg.message?.content
    return (
      msg.type === 'user' &&
      Array.isArray(content) &&
      content.some(
        block =>
          block.type === 'tool_result' &&
          !block.is_error &&
          calls.has(block.tool_use_id),
      )
    )
  })
}

function registryHasGetTaskResult(
  taskRegistry: TaskRegistry | undefined,
  taskId: string,
  ownerId: string,
): boolean {
  return (
    messagesHaveGetTaskResult(
      taskRegistry?.getTranscript(ownerId)?.messages,
      taskId,
    ) ||
    messagesHaveGetTaskResult(
      taskRegistry?.getTranscript(taskId)?.messages,
      taskId,
    )
  )
}

export function hasPairedGetTaskResult(
  taskId: string,
  agentId?: string,
  taskRegistry?: TaskRegistry,
  getMessages?: () => readonly Message[],
): boolean {
  const ownerId = bashTaskOwnerAgentId(agentId)
  return (
    messagesHaveGetTaskResult(getMessages?.(), taskId) ||
    registryHasGetTaskResult(taskRegistry, taskId, ownerId)
  )
}

class WeakOwnerCache<T> {
  #factory: () => T
  #map = new WeakMap<object, T>()
  constructor(factory: () => T) {
    this.#factory = factory
  }
  of(host: object): T {
    const existing = this.#map.get(host)
    if (existing !== undefined) return existing
    const created = this.#factory()
    this.#map.set(host, created)
    return created
  }
}

export class BashTaskDeliveryBag {
  bashTaskDeliveryOutcomes = new Map<string, BashTaskDeliveryOutcome>()
  reportedBashTaskDeliveries = new Set<string>()
  bashTaskSnapshots = new Map<string, BashTaskSnapshotEntry>()
  bashTaskGetCounts = new Map<string, number>()
  bashTaskGetsByResponse = new Map<
    string,
    Map<string, { count: number; statusKey: string }>
  >()
  withdrawShellNotification:
    | ((
        taskId: string,
        agentId?: string,
        taskRegistry?: TaskRegistry,
        getMessages?: () => readonly Message[],
      ) => (() => void) | undefined)
    | undefined

  rememberBashTaskSnapshot(
    taskId: string,
    snapshot: unknown,
    agentId?: string,
  ): void {
    this.bashTaskSnapshots.delete(taskId)
    this.bashTaskSnapshots.set(taskId, {
      snapshot,
      agentId,
      fetched: false,
    })
    if (this.bashTaskSnapshots.size > SNAPSHOT_CAP) {
      const first = this.bashTaskSnapshots.keys().next().value
      if (first !== undefined) this.bashTaskSnapshots.delete(first)
    }
  }

  countBashTaskGet(taskId: string): number {
    const n = (this.bashTaskGetCounts.get(taskId) ?? 0) + 1
    this.bashTaskGetCounts.delete(taskId)
    this.bashTaskGetCounts.set(taskId, n)
    if (this.bashTaskGetCounts.size > SNAPSHOT_CAP) {
      const first = this.bashTaskGetCounts.keys().next().value
      if (first !== undefined) this.bashTaskGetCounts.delete(first)
    }
    return n
  }

  countBashTaskGetInResponse(
    responseId: string,
    taskId: string,
    statusKey: string,
  ): number {
    const perTask =
      this.bashTaskGetsByResponse.get(responseId) ??
      new Map<string, { count: number; statusKey: string }>()
    this.bashTaskGetsByResponse.delete(responseId)
    this.bashTaskGetsByResponse.set(responseId, perTask)
    if (this.bashTaskGetsByResponse.size > GETS_BY_RESPONSE_CAP) {
      const first = this.bashTaskGetsByResponse.keys().next().value
      if (first !== undefined) this.bashTaskGetsByResponse.delete(first)
    }
    const prev = perTask.get(taskId)
    const count = prev?.statusKey === statusKey ? prev.count + 1 : 1
    perTask.set(taskId, { count, statusKey })
    return count
  }

  markBashTaskSnapshotFetched(taskId: string): void {
    const n = this.bashTaskSnapshots.get(taskId)
    if (n) this.bashTaskSnapshots.set(taskId, { ...n, fetched: true })
  }

  unmarkBashTaskSnapshotFetched(taskId: string): void {
    const n = this.bashTaskSnapshots.get(taskId)
    if (n && n.fetched) {
      this.bashTaskSnapshots.set(taskId, { ...n, fetched: false })
    }
  }

  reset(): void {
    this.bashTaskDeliveryOutcomes.clear()
    this.reportedBashTaskDeliveries.clear()
    this.bashTaskSnapshots.clear()
    this.bashTaskGetCounts.clear()
    this.bashTaskGetsByResponse.clear()
    this.withdrawShellNotification = undefined
  }
}

const bags = new WeakOwnerCache(() => new BashTaskDeliveryBag())
let testFallback: BashTaskDeliveryBag | undefined

export function getBashTaskDeliveryBag(): BashTaskDeliveryBag {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBootstrapSessionHost } =
      require('./sessionRoot.js') as typeof import('./sessionRoot.js')
    return bags.of(getBootstrapSessionHost())
  } catch {
    return (testFallback ??= new BashTaskDeliveryBag())
  }
}

/** densable `Qn().bashTaskDeliveryOutcomes` live map. */
export function bashTaskDeliveryOutcomes(): Map<
  string,
  BashTaskDeliveryOutcome
> {
  return getBashTaskDeliveryBag().bashTaskDeliveryOutcomes
}

/** densable `Qn().reportedBashTaskDeliveries`. */
export function reportedBashTaskDeliveries(): Set<string> {
  return getBashTaskDeliveryBag().reportedBashTaskDeliveries
}

export function setBashTaskDeliveryOutcome(
  messageId: string,
  outcome: BashTaskDeliveryOutcome,
): void {
  getBashTaskDeliveryBag().bashTaskDeliveryOutcomes.set(messageId, outcome)
}

export function isBashTaskDeliveryHosted(
  messageId: string | undefined,
): boolean {
  if (messageId === undefined) return true
  return (
    getBashTaskDeliveryBag().bashTaskDeliveryOutcomes.get(messageId) !==
    'no_host'
  )
}

export function rememberBashTaskSnapshot(
  taskId: string,
  snapshot: unknown,
  agentId?: string,
): void {
  getBashTaskDeliveryBag().rememberBashTaskSnapshot(taskId, snapshot, agentId)
}

/**
 * densable `zo` / `uNe` — raw `agentId` (`undefined` on main thread) is stored;
 * main-thread callers (`agentId === undefined`) may inspect evicted subagent
 * snapshots, while subagents match only `n.agentId === agentId`.
 */
export function lookupBashTaskSnapshot(
  taskId: string,
  agentId?: string,
): BashTaskSnapshotEntry | undefined {
  const n = getBashTaskDeliveryBag().bashTaskSnapshots.get(taskId)
  if (!n) return undefined
  let caller = agentId
  if (caller !== undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getMainThreadAgentId } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      if (caller === getMainThreadAgentId()) caller = undefined
    } catch {
      // ignore
    }
  }
  if (caller !== undefined && n.agentId !== caller) {
    return undefined
  }
  return n
}

/** densable `Rvr` — drop queued bash notifications once GetTask fetched. */
export function withdrawQueuedBashTaskNotification(
  taskId: string,
  agentId?: string,
  taskRegistry?: TaskRegistry,
  getMessages?: () => readonly Message[],
): (() => void) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCommandQueue, consume, enqueuePendingNotification } =
      require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
    const s = bashTaskOwnerAgentId(agentId)
    const hits = getCommandQueue().filter(
      cmd =>
        cmd.mode === 'task-notification' &&
        cmd.taskId === taskId &&
        bashTaskOwnerAgentId(cmd.agentId) === s &&
        cmd.taskDelivery !== undefined,
    )
    if (hits.length === 0) return
    consume(hits, { reason: 'delivered_as_tool_result' })
    const reason = `bash:${taskId}`
    const registry = taskRegistry
    if (agentId !== undefined && registry) {
      try {
        // densable `hx` — drop keepalive `bash:${taskId}` on the owner agent.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { removeKeepaliveReason } =
          require('./task/framework.js') as typeof import('./task/framework.js')
        removeKeepaliveReason(agentId, reason, registry)
      } catch {
        // optional
      }
    }
    let restored = false
    return () => {
      if (restored) return
      restored = true
      // A pending tool_use is not delivery: only skip restore if a paired,
      // non-error GetTask tool_result has already entered messages/transcript.
      if (hasPairedGetTaskResult(taskId, agentId, registry, getMessages)) return
      if (agentId !== undefined && registry) {
        try {
          // densable `YP` — rebind keepalive on abort restore.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { addKeepaliveReason } =
            require('./task/framework.js') as typeof import('./task/framework.js')
          addKeepaliveReason(agentId, reason, registry)
        } catch {
          // optional
        }
      }
      for (const cmd of hits) {
        try {
          enqueuePendingNotification(cmd)
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // queue module optional in tests
  }
}

export function resetBashTaskDeliveryForTests(): void {
  getBashTaskDeliveryBag().reset()
}
