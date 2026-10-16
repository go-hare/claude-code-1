/**
 * densable 2.1.289 stop-cascade bag (`be` / `At` / `TD` / `gD` / `dSe` / `tGn` / `db`).
 *
 * Gold: `At = new z(() => new be)`; `TD() = Is(At) = At.of(v.host)`.
 * Semantic names only — never export minify `be|At|TD|gD|dSe|tGn|db|Rs|Fle`.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { getBootstrapSessionHost } from './sessionRoot.js'

/** densable `Rs` — terminal agent task statuses. */
export function isTerminalAgentTaskStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

export type AgentKillLoop = {
  settleCallbacks: Array<() => void>
}

/**
 * densable `be` — per-host stop / kill-loop registry.
 */
export class AgentStopBag {
  liveProcessesByAgentId = new Map<string, unknown>()
  stopPendingAgentIds = new Set<string>()
  everRegisteredTaskIds = new Set<string>()
  loopsByTaskId = new Map<string, AgentKillLoop>()
  pendingEscalationsByTaskId = new Map<
    string,
    { timers: Array<ReturnType<typeof setTimeout>> }
  >()
  inFlightProcessSweeps = new Set<string>()

  reset(): void {
    for (const esc of this.pendingEscalationsByTaskId.values()) {
      for (const t of esc.timers) clearTimeout(t)
    }
    this.pendingEscalationsByTaskId.clear()
    this.inFlightProcessSweeps.clear()
    this.loopsByTaskId.clear()
    this.everRegisteredTaskIds.clear()
    this.liveProcessesByAgentId.clear()
    this.stopPendingAgentIds.clear()
  }

  dispose(): void {
    this.reset()
  }
}

/** densable `z` — WeakMap host → bag. Check `!== undefined`, not truthy. */
class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

const hostBags = new WeakOwnerCache(() => new AgentStopBag())
const bagAls = new AsyncLocalStorage<AgentStopBag>()

/** densable `At.of(host)`. */
export function agentStopBagOf(host: object): AgentStopBag {
  return hostBags.of(host)
}

/** densable `TD` / `Is(At)` — ALS override, else bootstrap host bag. */
export function getAgentStopBag(): AgentStopBag {
  return bagAls.getStore() ?? hostBags.of(getBootstrapSessionHost())
}

export function runWithAgentStopBag<T>(bag: AgentStopBag, fn: () => T): T {
  return bagAls.run(bag, fn)
}

export function resetAgentStopBagForTests(): void {
  getAgentStopBag().reset()
}

/** densable `dSe` */
export function markAgentStopPending(agentId: string): void {
  getAgentStopBag().stopPendingAgentIds.add(agentId)
}

/** densable `tGn` */
export function clearAgentStopPending(agentId: string): void {
  getAgentStopBag().stopPendingAgentIds.delete(agentId)
}

/** densable `gD` */
export function isAgentStopPending(agentId: string): boolean {
  return getAgentStopBag().stopPendingAgentIds.has(agentId)
}

/**
 * densable `db` — kill loop settled (no live loop entry).
 * `true` means settled / no loop; Fle uses `!db(e)`.
 */
export function isAgentKillLoopSettled(agentId: string): boolean {
  return !getAgentStopBag().loopsByTaskId.has(agentId)
}

/** densable register loop entry (T8e fragment). */
export function registerAgentKillLoop(
  agentId: string,
  loop: AgentKillLoop = { settleCallbacks: [] },
): void {
  const bag = getAgentStopBag()
  bag.everRegisteredTaskIds.add(agentId)
  const prior = bag.loopsByTaskId.get(agentId)
  if (prior) {
    bag.loopsByTaskId.delete(agentId)
    for (const cb of prior.settleCallbacks) {
      try {
        cb()
      } catch {
        // densable settle callbacks best-effort
      }
    }
  }
  bag.loopsByTaskId.set(agentId, loop)
}

/** densable settle / clear loop (db becomes true). */
export function settleAgentKillLoop(agentId: string): void {
  const bag = getAgentStopBag()
  const loop = bag.loopsByTaskId.get(agentId)
  if (!loop) return
  bag.loopsByTaskId.delete(agentId)
  for (const cb of loop.settleCallbacks) {
    try {
      cb()
    } catch {
      // best-effort
    }
  }
  clearAgentStopPending(agentId)
}
