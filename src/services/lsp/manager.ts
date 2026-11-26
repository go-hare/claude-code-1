import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
} from '../../utils/sessionHost.js'
import {
  createLSPServerManager,
  type LSPServerManager,
} from './LSPServerManager.js'
import { registerLSPNotificationHandlers } from './passiveFeedback.js'

/**
 * Initialization state of the LSP server manager
 */
type InitializationState = 'not-started' | 'pending' | 'success' | 'failed'

/**
 * Per-host LSP state (`HostSlot` on `getBootstrapSessionHost()` in official 2.1.331):
 * - `lspManagerInstance`: LSPServerManager instance for this host
 * - `initializationState` / `initializationError` / `initializationGeneration` / `initializationPromise`
 * - `everConnectedLatch`: sticky latch (`hasEverConnected` / GUr) per host so mid-session
 *   reconnect does not flip toolSchemasChanged → tengu_prompt_cache_break.
 */
type LspHostState = {
  lspManagerInstance: LSPServerManager | undefined
  initializationState: InitializationState
  initializationError: Error | undefined
  initializationGeneration: number
  initializationPromise: Promise<void> | undefined
  everConnectedLatch: boolean
}

const fallbackLspHost: object = {}

function getActiveLspHost(): object {
  try {
    const host = getBootstrapSessionHost()
    if (
      host !== null &&
      (typeof host === 'object' || typeof host === 'function')
    ) {
      return host
    }
  } catch {
    // Fall back when sessionHost is mocked in tests
  }
  return fallbackLspHost
}

const liveLspStates = new Set<WeakRef<LspHostState>>()

const lspHostSlot = new HostSlot<LspHostState>(() => {
  if (liveLspStates.size > 64) {
    for (const ref of liveLspStates) {
      if (ref.deref() === undefined) {
        liveLspStates.delete(ref)
      }
    }
  }
  const state: LspHostState = {
    lspManagerInstance: undefined,
    initializationState: 'not-started',
    initializationError: undefined,
    initializationGeneration: 0,
    initializationPromise: undefined,
    everConnectedLatch: false,
  }
  liveLspStates.add(new WeakRef(state))
  return state
})

function getLspHostState(): LspHostState {
  return lspHostSlot.of(getActiveLspHost())
}

/**
 * Get the host's LSP server manager instance.
 * Returns undefined if not yet initialized, initialization failed, or still pending.
 *
 * Callers should check for undefined and handle gracefully, as initialization happens
 * asynchronously during Claude Code startup. Use getInitializationStatus() to
 * distinguish between pending, failed, and not-started states.
 */
export function getLspServerManager(): LSPServerManager | undefined {
  const state = getLspHostState()
  // Don't return a broken instance if initialization failed
  if (state.initializationState === 'failed') {
    return undefined
  }
  return state.lspManagerInstance
}

/**
 * Get the current initialization status of the LSP server manager.
 *
 * @returns Status object with current state and error (if failed)
 */
export function getInitializationStatus():
  | { status: 'not-started' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'failed'; error: Error } {
  const state = getLspHostState()
  if (state.initializationState === 'failed') {
    return {
      status: 'failed',
      error: state.initializationError || new Error('Initialization failed'),
    }
  }
  if (state.initializationState === 'not-started') {
    return { status: 'not-started' }
  }
  if (state.initializationState === 'pending') {
    return { status: 'pending' }
  }
  return { status: 'success' }
}

/**
 * Check whether at least one language server is connected and healthy (live).
 * densable SEA `isConnected` / ZMA — not used for LSPTool.isEnabled.
 */
export function isLspConnected(): boolean {
  const state = getLspHostState()
  if (state.initializationState === 'failed') return false
  const manager = getLspServerManager()
  if (!manager) return false
  const servers = manager.getAllServers()
  if (servers.size === 0) return false
  for (const server of servers.values()) {
    if (server.state !== 'error') return true
  }
  return false
}

/**
 * Sticky ever-connected latch (densable SEA `hasEverConnected` / GUr).
 * Latches true the first time isLspConnected() is true. Clears when init
 * completes with zero servers and no config load failure (densable 243 #28).
 */
export function hasEverConnected(): boolean {
  const state = getLspHostState()
  if (!state.everConnectedLatch && isLspConnected()) {
    state.everConnectedLatch = true
  }
  return state.everConnectedLatch
}

/**
 * densable SEA `lpT`: defer LSP tool only while init is still pending/not-started
 * and we have never seen a connected server. Once hasEverConnected latches,
 * never defer for init (avoids schema churn / prompt-cache break).
 */
export function shouldDeferLspTool(tool: { isLsp?: boolean }): boolean {
  if (!('isLsp' in tool) || !tool.isLsp) {
    return false
  }
  if (hasEverConnected()) {
    return false
  }
  const status = getInitializationStatus()
  return status.status === 'pending' || status.status === 'not-started'
}

/**
 * Test-only: clear host state + sticky latch so *235* unit tests can start fresh.
 * densable SEA has no reset; host-lifetime latch is the product behavior.
 */
export function resetLspManagerForTests(): void {
  const state = getLspHostState()
  state.lspManagerInstance = undefined
  state.initializationState = 'not-started'
  state.initializationError = undefined
  state.initializationPromise = undefined
  state.initializationGeneration++
  state.everConnectedLatch = false
}

/**
 * Test-only: install a fake manager / init status for latch + defer coverage.
 */
export function setLspManagerForTests(opts: {
  manager?: LSPServerManager | undefined
  status?: InitializationState
  error?: Error
}): void {
  const state = getLspHostState()
  if ('manager' in opts) {
    state.lspManagerInstance = opts.manager
  }
  if (opts.status !== undefined) {
    state.initializationState = opts.status
    if (opts.status !== 'failed') {
      state.initializationError = undefined
    } else if (opts.error) {
      state.initializationError = opts.error
    }
  }
}

/**
 * Wait for LSP server manager initialization to complete.
 *
 * Returns immediately if initialization has already completed (success or failure).
 * If initialization is pending, waits for it to complete.
 * If initialization hasn't started, returns immediately.
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function waitForInitialization(): Promise<void> {
  const state = getLspHostState()
  // If already initialized or failed, return immediately
  if (
    state.initializationState === 'success' ||
    state.initializationState === 'failed'
  ) {
    return
  }

  // If pending and we have a promise, wait for it
  if (state.initializationState === 'pending' && state.initializationPromise) {
    await state.initializationPromise
  }

  // If not started, return immediately (nothing to wait for)
}

/**
 * Initialize the LSP server manager for the active SessionHost.
 *
 * This function is called during Claude Code startup. It synchronously creates
 * the manager instance, then starts async initialization (loading LSP configs)
 * in the background without blocking the startup process.
 *
 * Safe to call multiple times - will only initialize once (idempotent).
 * However, if initialization previously failed, calling again will retry.
 */
export function initializeLspServerManager(): void {
  // --bare / SIMPLE: no LSP. LSP is for editor integration (diagnostics,
  // hover, go-to-def in the REPL). Scripted -p calls have no use for it.
  if (isBareMode()) {
    return
  }
  logForDebugging('[LSP MANAGER] initializeLspServerManager() called')

  const state = getLspHostState()

  // Skip if already initialized or currently initializing
  if (
    state.lspManagerInstance !== undefined &&
    state.initializationState !== 'failed'
  ) {
    logForDebugging(
      '[LSP MANAGER] Already initialized or initializing, skipping',
    )
    return
  }

  // Reset state for retry if previous initialization failed
  if (state.initializationState === 'failed') {
    state.lspManagerInstance = undefined
    state.initializationError = undefined
  }

  // Create the manager instance and mark as pending
  const manager = createLSPServerManager()
  state.lspManagerInstance = manager
  state.initializationState = 'pending'
  logForDebugging('[LSP MANAGER] Created manager instance, state=pending')

  // Increment generation to invalidate any pending initializations
  const currentGeneration = ++state.initializationGeneration
  logForDebugging(
    `[LSP MANAGER] Starting async initialization (generation ${currentGeneration})`,
  )

  // Start initialization asynchronously without blocking
  // Store the promise so callers can await it via waitForInitialization()
  state.initializationPromise = manager
    .initialize()
    .then(() => {
      // Only update state if this is still the current initialization
      if (currentGeneration === state.initializationGeneration) {
        state.initializationState = 'success'
        logForDebugging('LSP server manager initialized successfully')

        // densable 243 #28: clear sticky latch when reinit finds zero servers
        // without a config load failure (LSP tool may drop after last plugin off).
        if (
          state.lspManagerInstance &&
          state.lspManagerInstance.getAllServers().size === 0 &&
          !state.lspManagerInstance.didLastConfigLoadFail()
        ) {
          state.everConnectedLatch = false
        }

        // Register passive notification handlers for diagnostics
        if (state.lspManagerInstance) {
          registerLSPNotificationHandlers(state.lspManagerInstance)
        }
      }
    })
    .catch((error: unknown) => {
      // Only update state if this is still the current initialization
      if (currentGeneration === state.initializationGeneration) {
        state.initializationState = 'failed'
        state.initializationError = error as Error
        // Clear the instance since it's not usable
        state.lspManagerInstance = undefined

        logError(error as Error)
        logForDebugging(
          `Failed to initialize LSP server manager: ${errorMessage(error)}`,
        )
      }
    })
}

/**
 * Force re-initialization of the LSP server manager, even after a prior
 * successful init. Called from refreshActivePlugins() after plugin caches
 * are cleared, so newly-loaded plugin LSP servers are picked up.
 */
export function reinitializeLspServerManager(): void {
  const state = getLspHostState()
  if (state.initializationState === 'not-started') {
    // initializeLspServerManager() was never called (e.g. headless subcommand
    // path). Don't start it now.
    return
  }

  logForDebugging('[LSP MANAGER] reinitializeLspServerManager() called')

  // Best-effort shutdown of any running servers on the old instance so
  // /reload-plugins doesn't leak child processes. Fire-and-forget: the
  // primary use case (issue #15521) has 0 servers so this is usually a no-op.
  if (state.lspManagerInstance) {
    void state.lspManagerInstance.shutdown().catch(err => {
      logForDebugging(
        `[LSP MANAGER] old instance shutdown during reinit failed: ${errorMessage(err)}`,
      )
    })
  }

  // Force the idempotence check in initializeLspServerManager() to fall
  // through. Generation counter handles invalidating any in-flight init.
  state.lspManagerInstance = undefined
  state.initializationState = 'not-started'
  state.initializationError = undefined

  initializeLspServerManager()
}

async function shutdownSingleLspHostState(state: LspHostState): Promise<void> {
  const instance = state.lspManagerInstance
  if (instance === undefined) {
    return
  }

  try {
    await instance.shutdown()
    logForDebugging('LSP server manager shut down successfully')
  } catch (error: unknown) {
    logError(error as Error)
    logForDebugging(
      `Failed to shutdown LSP server manager: ${errorMessage(error)}`,
    )
  } finally {
    // Always clear state even if shutdown failed
    state.lspManagerInstance = undefined
    state.initializationState = 'not-started'
    state.initializationError = undefined
    state.initializationPromise = undefined
    // Increment generation to invalidate any pending initializations
    state.initializationGeneration++
  }
}

/**
 * Shutdown the LSP server manager and clean up resources.
 *
 * Inside an active ALS session (`hasActiveSessionAls()`), shuts down only that
 * host's LSP server manager so concurrent hosts stay alive. Outside ALS (e.g.
 * process-exit cleanup), shuts down every live host's LSP server manager tracked
 * via `Set<WeakRef<LspHostState>>` so no child LSP processes leak on exit.
 */
export async function shutdownLspServerManager(): Promise<void> {
  if (hasActiveSessionAls()) {
    await shutdownSingleLspHostState(getLspHostState())
    return
  }

  const targets = new Set<LspHostState>([getLspHostState()])
  for (const ref of liveLspStates) {
    const derefed = ref.deref()
    if (derefed === undefined) {
      liveLspStates.delete(ref)
    } else {
      targets.add(derefed)
    }
  }
  await Promise.all([...targets].map(s => shutdownSingleLspHostState(s)))
}
