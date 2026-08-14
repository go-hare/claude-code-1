import type { Command } from '../commands.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Tool } from '../Tool.js'
import { dedupeToolsByName } from '../Tool.js'
import uniqBy from 'lodash-es/uniqBy.js'

export type SetupTrigger = 'init' | 'maintenance' | null

export type StartupMcpState = {
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
}

export function determineSetupTrigger(options: {
  initOnly: boolean
  init: boolean
  maintenance: boolean
}): SetupTrigger {
  const { initOnly, init, maintenance } = options

  if (initOnly || init) {
    return 'init'
  }
  if (maintenance) {
    return 'maintenance'
  }
  return null
}

export async function runVersionedPluginStartup(options: {
  bareMode: boolean
  isNonInteractiveSession: boolean
  initializeVersionedPlugins: () => Promise<unknown>
  cleanupOrphanedPluginVersionsInBackground: () => Promise<unknown>
  warmGlobExclusions: () => void
  onPluginsInitComplete: () => void
}): Promise<void> {
  const {
    bareMode,
    isNonInteractiveSession,
    initializeVersionedPlugins,
    cleanupOrphanedPluginVersionsInBackground,
    warmGlobExclusions,
    onPluginsInitComplete,
  } = options

  if (bareMode) {
    return
  }

  if (isNonInteractiveSession) {
    await initializeVersionedPlugins()
    onPluginsInitComplete()
    void cleanupOrphanedPluginVersionsInBackground().then(() =>
      warmGlobExclusions(),
    )
    return
  }

  void initializeVersionedPlugins().then(async () => {
    onPluginsInitComplete()
    await cleanupOrphanedPluginVersionsInBackground()
    warmGlobExclusions()
  })
}

export function runSessionStartupSideEffects(options: {
  logContextMetrics: () => void
  logPermissionContext: () => void
  logManagedSettings: () => void
  sessionNameArg?: string
  /** densable Bid only runs when interactive (non -p). Default true. */
  interactive?: boolean
  registerSession: () => Promise<boolean>
  updateSessionName: (
    name: string,
    source?: 'user' | 'collision' | 'derived' | 'auto',
  ) => Promise<unknown> | undefined
  countConcurrentSessions: () => Promise<number>
  onConcurrentSessions: (count: number) => void
  /**
   * densable Bid — optional override (tests). Default imports
   * `runSessionNameStartupUniqueness`.
   */
  runSessionNameStartupUniqueness?: (input: {
    sessionNameArg?: string
    interactive: boolean
  }) => Promise<void>
}): void {
  const {
    logContextMetrics,
    logPermissionContext,
    logManagedSettings,
    sessionNameArg,
    interactive = true,
    registerSession,
    updateSessionName,
    countConcurrentSessions,
    onConcurrentSessions,
  } = options

  logContextMetrics()
  logPermissionContext()
  logManagedSettings()

  void registerSession().then(async registered => {
    if (!registered) return
    // densable Bid: uniqueness for interactive names (CLI --name / existing claim).
    // Falls back to plain updateSessionName when Bid module fails to load.
    try {
      if (options.runSessionNameStartupUniqueness) {
        await options.runSessionNameStartupUniqueness({
          sessionNameArg,
          interactive,
        })
      } else {
        const { runSessionNameStartupUniqueness } = await import(
          '../utils/sessionNameUniqueness.js'
        )
        await runSessionNameStartupUniqueness({
          sessionNameArg,
          interactive,
          // Use injected updateSessionName so callers/tests can observe writes.
          writeName: async (name, source) => {
            await updateSessionName(name, source)
          },
        })
      }
    } catch {
      if (sessionNameArg) {
        void updateSessionName(sessionNameArg, 'user')
      }
    }
    void countConcurrentSessions().then(count => {
      if (count >= 2) {
        onConcurrentSessions(count)
      }
    })
  })
}

export function mergeStartupMcpState(
  local: StartupMcpState,
  claudeai: StartupMcpState,
): StartupMcpState {
  return {
    clients: [...local.clients, ...claudeai.clients],
    // Throw on distinct tools with the same primary name (MCP identity
    // collisions that are the same logical tool still dedupe).
    tools: dedupeToolsByName([...local.tools, ...claudeai.tools]),
    commands: uniqBy([...local.commands, ...claudeai.commands], 'name'),
  }
}

export function createInteractiveStartupMcpMessages<T>(options: {
  mcpPromise: Promise<StartupMcpState>
  onError: (error: unknown) => T
}): Promise<T[]> {
  return options.mcpPromise
    .then(() => [])
    .catch(error => [options.onError(error)])
}

export function runStartupPrefetches(options: {
  bareMode: boolean
  isNonInteractiveSession: boolean
  bgRefreshThrottleMs: number
  lastPrefetched: number
  fastModeKillSwitchEnabled: boolean
  logForDebugging: (message: string) => void
  checkQuotaStatus: () => Promise<unknown>
  onQuotaError: (error: unknown) => void
  fetchBootstrapData: () => Promise<unknown> | undefined
  prefetchPassesEligibility: () => Promise<unknown> | undefined
  prefetchFastModeStatus: () => Promise<unknown> | undefined
  resolveFastModeStatusFromCache: () => void
  saveStartupPrefetchedAt: (timestamp: number) => void
  refreshExampleCommands: () => Promise<unknown> | undefined
  now?: () => number
}): void {
  const {
    bareMode,
    isNonInteractiveSession,
    bgRefreshThrottleMs,
    lastPrefetched,
    fastModeKillSwitchEnabled,
    logForDebugging,
    checkQuotaStatus,
    onQuotaError,
    fetchBootstrapData,
    prefetchPassesEligibility,
    prefetchFastModeStatus,
    resolveFastModeStatusFromCache,
    saveStartupPrefetchedAt,
    refreshExampleCommands,
    now = Date.now,
  } = options

  const currentTime = now()
  const skipStartupPrefetches =
    bareMode ||
    (bgRefreshThrottleMs > 0 &&
      currentTime - lastPrefetched < bgRefreshThrottleMs)

  if (!skipStartupPrefetches) {
    const lastPrefetchedInfo =
      lastPrefetched > 0
        ? ` last ran ${Math.round((currentTime - lastPrefetched) / 1000)}s ago`
        : ''
    logForDebugging(
      `Starting background startup prefetches${lastPrefetchedInfo}`,
    )

    checkQuotaStatus().catch(error => onQuotaError(error))
    void fetchBootstrapData()
    void prefetchPassesEligibility()
    if (!fastModeKillSwitchEnabled) {
      void prefetchFastModeStatus()
    } else {
      resolveFastModeStatusFromCache()
    }
    if (bgRefreshThrottleMs > 0) {
      saveStartupPrefetchedAt(currentTime)
    }
  } else {
    logForDebugging(
      `Skipping startup prefetches, last ran ${Math.round((currentTime - lastPrefetched) / 1000)}s ago`,
    )
    resolveFastModeStatusFromCache()
  }

  if (!isNonInteractiveSession) {
    void refreshExampleCommands()
  }
}
