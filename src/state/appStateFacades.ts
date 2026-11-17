import type { MCPServerConnection } from '../services/mcp/types.js'
import type { AppState, AppStateStore } from './AppStateStore.js'
import { type SliceStore, sliceStore, updateAppState } from './store.js'

/**
 * Official `BVe` @197250334 — MCP connections slice facade mounted by `<AppStateProvider />`.
 */
export class McpConnectionsFacade {
  readonly #slice: SliceStore<AppState['mcp']>

  constructor(slice: SliceStore<AppState['mcp']>) {
    this.#slice = slice
  }

  static over(
    store: Pick<AppStateStore, 'getState' | 'setState'>,
  ): McpConnectionsFacade {
    return new McpConnectionsFacade(
      sliceStore(store.getState, store.setState, 'mcp'),
    )
  }

  get(): AppState['mcp'] {
    return this.#slice.get()
  }

  markNeedsAuth(serverName: string): void {
    this.#slice.set(prev => {
      let changed = false
      const clients = prev.clients.map(client => {
        if (client.name !== serverName || client.type === 'needs-auth') {
          return client
        }
        changed = true
        return {
          ...client,
          type: 'needs-auth' as const,
        } as MCPServerConnection
      })
      return changed ? { ...prev, clients } : prev
    })
  }

  addPendingServers(pending: MCPServerConnection[]): void {
    if (pending.length === 0) return
    this.#slice.set(prev => {
      const existing = new Set(prev.clients.map(c => c.name))
      const toAdd = pending.filter(c => !existing.has(c.name))
      if (toAdd.length === 0) return prev
      return {
        ...prev,
        clients: [...prev.clients, ...toAdd],
      }
    })
  }

  /**
   * Official `BVe.reconcileConfiguredServers` @197250334 — exclude stale
   * servers, append pending/disabled new configs, and mark clientsInitialized.
   */
  reconcileConfiguredServers(
    reconcile: (mcp: AppState['mcp']) => {
      stale: MCPServerConnection[]
      mcpWithoutStale: Partial<AppState['mcp']> &
        Pick<AppState['mcp'], 'clients'>
      newClients: MCPServerConnection[]
    },
    onStale: (stale: MCPServerConnection[]) => void,
  ): void {
    let staleClients: MCPServerConnection[] = []
    this.#slice.set(prev => {
      const { stale, mcpWithoutStale, newClients } = reconcile(prev)
      staleClients = stale
      if (newClients.length === 0 && stale.length === 0) {
        if (prev.clientsInitialized) return prev
        return { ...prev, clientsInitialized: true }
      }
      return {
        ...prev,
        ...mcpWithoutStale,
        clientsInitialized: true,
        clients: [...mcpWithoutStale.clients, ...newClients],
      }
    })
    if (staleClients.length > 0) {
      onStale(staleClients)
    }
  }

  /**
   * Official `BVe.adoptServer` @197250334 — replace an existing client by name
   * or append when `opts.appendIfAbsent` is true.
   */
  adoptServer(
    name: string,
    client: MCPServerConnection,
    opts?: { appendIfAbsent?: boolean },
  ): void {
    this.#slice.set(prev => {
      const idx = prev.clients.findIndex(c => c.name === name)
      if (idx >= 0) {
        const next = [...prev.clients]
        next[idx] = client
        return { ...prev, clients: next }
      }
      if (opts?.appendIfAbsent === true) {
        return { ...prev, clients: [...prev.clients, client] }
      }
      return prev
    })
  }
}

function pluginErrorKey(err: AppState['plugins']['errors'][number]): string {
  const plugin = 'plugin' in err && err.plugin ? err.plugin : ''
  const reason =
    'error' in err && typeof err.error === 'string' ? err.error : ''
  return `${err.type}:${err.source}:${plugin}:${reason}`
}

/**
 * Official `N6` @197282218 — Active plugins slice facade mounted by `<AppStateProvider />`.
 */
export class ActivePluginsFacade {
  readonly #getState: AppStateStore['getState']
  readonly #updateState: ReturnType<typeof updateAppState<AppState>>

  constructor(store: Pick<AppStateStore, 'getState' | 'setState'>) {
    this.#getState = store.getState
    this.#updateState = updateAppState(store.setState)
  }

  static over(
    store: Pick<AppStateStore, 'getState' | 'setState'>,
  ): ActivePluginsFacade {
    return new ActivePluginsFacade(store)
  }

  get(): AppState['plugins'] {
    return this.#getState().plugins
  }

  #update(updater: (prev: AppState['plugins']) => AppState['plugins']): void {
    this.#updateState(state => {
      const next = updater(state.plugins)
      return next === state.plugins ? state : { ...state, plugins: next }
    })
  }

  addErrors(errors: AppState['plugins']['errors']): void {
    if (errors.length === 0) return
    this.#update(prev => {
      const existing = new Set(prev.errors.map(pluginErrorKey))
      const novel = errors.filter(e => !existing.has(pluginErrorKey(e)))
      if (novel.length === 0) return prev
      return { ...prev, errors: [...prev.errors, ...novel] }
    })
  }

  markNeedsRefresh(): void {
    this.#update(prev =>
      prev.needsRefresh ? prev : { ...prev, needsRefresh: true },
    )
  }

  setPendingMarketplaces(names: string[]): void {
    this.#update(prev => ({
      ...prev,
      installationStatus: {
        ...prev.installationStatus,
        marketplaces: names.map(name => ({ name, status: 'pending' as const })),
      },
    }))
  }

  clearMarketplaceState(marketplaceName: string): void {
    this.#update(prev => ({
      ...prev,
      errors: prev.errors.filter(
        e => !('marketplace' in e && e.marketplace === marketplaceName),
      ),
      installationStatus: {
        ...prev.installationStatus,
        marketplaces: prev.installationStatus.marketplaces.filter(
          m => m.name !== marketplaceName,
        ),
      },
    }))
  }
}
