import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { createStore, type Store } from 'src/state/store.js'
import { getBootstrapSessionHost } from '../sessionHost.js'

export type HookExecutionProgress = {
  hookEvent: HookEvent
  hooks: { command: string; statusMessage?: string }[]
  settled: Set<number>
  agentId?: string
  toolName?: string
}

const stores = new WeakMap<object, Store<HookExecutionProgress[]>>()

/** Gold p1n: progress belongs to the host, across its sessions. */
export function getHookExecutionStore(): Store<HookExecutionProgress[]> {
  const host = getBootstrapSessionHost()
  let store = stores.get(host)
  if (!store) {
    store = createStore<HookExecutionProgress[]>([])
    stores.set(host, store)
  }
  return store
}

/** Gold kxe: settle immutable rows and remove the row on disposal. */
export function trackHookExecution(
  input: Omit<HookExecutionProgress, 'settled'>,
) {
  const store = getHookExecutionStore()
  let row: HookExecutionProgress = { ...input, settled: new Set() }
  store.setState(rows => [...rows, row])
  return {
    settle(index: number) {
      store.setState(rows => {
        const at = rows.indexOf(row)
        if (at < 0 || row.settled.has(index)) return rows
        row = { ...row, settled: new Set(row.settled).add(index) }
        return rows.toSpliced(at, 1, row)
      })
    },
    [Symbol.dispose]() {
      store.setState(rows => {
        const at = rows.indexOf(row)
        return at < 0 ? rows : rows.toSpliced(at, 1)
      })
    },
  }
}
