/**
 * Sandbox lifecycle management:
 * - Per-host settings & command-producer hot-reload subscriptions
 * - Multi-host `initialize` (joining peer hosts or owning singleton proxy)
 * - `refreshConfig`, `addSessionAllowedHost`, `ensureInitializedForWrap`,
 *   `cleanupAfterCommand`, and per-host `reset`
 */

import type {
  NetworkHostPattern,
  SandboxAskCallback,
} from '@anthropic-ai/sandbox-runtime'
import { SandboxManager as BaseSandboxManager } from '@anthropic-ai/sandbox-runtime'
import { getCwdState } from '../../../bootstrap/state.js'
import { setSandboxCommandNetworkListsOffered } from '../../../services/codeMode/optIn.js'
import { logForDebugging } from '../../debug.js'
import { errorMessage } from '../../errors.js'
import { getPlatform } from '../../platform.js'
import { subscribeCommandProducerDirsChanged } from '../../plugins/commandProducerDirs.js'
import { hasActiveSessionAls, runWithSession } from '../../sessionHost.js'
import type { Session } from '../../sessionRoot.js'
import { settingsChangeDetector } from '../../settings/changeDetector.js'
import { getSettings_DEPRECATED } from '../../settings/settings.js'
import {
  applySandboxRuntimeConfig,
  failSandboxInitializeAllowlist,
  finishSandboxInitializeAllowlist,
  markInstallsSinceInitializeStarted,
  recordWrapWriteRoots,
  resetSymlinkedDenyScrubState,
  scrubSymlinkedDenyPaths,
  setSandboxInitializationPromise,
} from '../symlinkedDenyScrub.js'
import {
  areWindowsLocalConnectionsOn,
  resolveWindowsBackendChoice,
  willSandboxTlsTerminate,
  windowsSandboxStartStore,
} from '../windowsSandbox.js'
import {
  ensureAtomicWriteStagingDirs,
  ensureBridgeSpawnRootDirForWrap,
} from '../wrapPreflight.js'
import {
  convertToSandboxRuntimeConfig,
  getSrtAllowNestedUsernsEnv,
} from './configConversion.js'
import { SRT_ALLOW_NESTED_USERNS_ENV } from './constants.js'
import {
  baseCheckDependencies,
  baseIsSupportedPlatform,
  isSandboxingEnabled,
  isSandboxRequired,
} from './diagnostics.js'
import {
  cleanupLinuxSandboxPlaceholderFiles,
  detectWorktreeMainRepoPath,
  quarantineUnexpectedGitDirEntries,
  scrubBareGitRepoFiles,
} from './gitDirGuard.js'
import {
  clearProxyOwnerHostState,
  clearProxyOwnerHostStateIfMatches,
  findOtherLiveHostWithInit,
  getLiveSandboxHostStates,
  getSandboxHostState,
  normalizeSandboxSessionHost,
  resolveActiveSandboxAskCallback,
  type SandboxHostState,
  SandboxInitFailedError,
  setProxyOwnerHostState,
  withMergedLiveSessionAllowedHosts,
} from './hostState.js'
import {
  resolveSandboxStrictAllowlist,
  shouldAllowManagedSandboxDomainsOnly,
} from './pathPolicy.js'

function installHostSettingsSubscriptions(hostState: SandboxHostState): void {
  hostState.settingsSubscriptionCleanup?.()
  const runInThisHost = (fn: () => void): void => {
    if (!hostState.sandboxStartedOnce) return
    const targetSession = hostState.sessionRef?.deref()
    if (targetSession) {
      runWithSession(targetSession, fn)
    } else {
      fn()
    }
  }
  const unsubSettings = settingsChangeDetector.subscribe(() => {
    runInThisHost(() => {
      const settings = getSettings_DEPRECATED()
      const nextConfig = convertToSandboxRuntimeConfig(settings)
      const currentPlat = getPlatform()
      if (currentPlat === 'linux' || currentPlat === 'wsl') {
        process.env[SRT_ALLOW_NESTED_USERNS_ENV] =
          getSrtAllowNestedUsernsEnv(settings)[SRT_ALLOW_NESTED_USERNS_ENV]
      }
      applySandboxRuntimeConfig(nextConfig, cfg => {
        BaseSandboxManager.updateConfig(withMergedLiveSessionAllowedHosts(cfg))
      })
      logForDebugging('Sandbox configuration updated from settings change')
    })
  })
  const unsubCommandProducers = subscribeCommandProducerDirsChanged(() => {
    runInThisHost(() => {
      refreshConfig()
    })
  })
  hostState.settingsSubscriptionCleanup = () => {
    unsubSettings()
    unsubCommandProducers()
  }
}

/**
 * Initialize sandbox with log monitoring enabled by default.
 * Both `initializationPromise` and `settingsSubscriptionCleanup` live in the
 * per-SessionHost `sandboxStateByHost` HostSlot so multi-host initialization,
 * settings hot-reload subscriptions, failure recovery, and reset are isolated.
 */
export async function initialize(
  sandboxAskCallback?: SandboxAskCallback,
): Promise<void> {
  const hostState = getSandboxHostState()
  if (sandboxAskCallback !== undefined) {
    hostState.lastSandboxAskCallback = sandboxAskCallback
  }
  if (hostState.forcedInitFailureForTesting !== undefined) {
    hostState.initFailureReason = hostState.forcedInitFailureForTesting
    hostState.initializationPromise = undefined
    return
  }
  // If this host is already initializing or initialized, await its own promise.
  if (hostState.initializationPromise) {
    const pending = hostState.initializationPromise
    await pending
    return
  }

  // Check if sandboxing is enabled in settings
  if (!isSandboxingEnabled()) {
    return
  }

  // If another live SessionHost already initialized (or is initializing) the
  // process-singleton BaseSandboxManager proxy, await it and join this host
  // with its OWN per-host initializationPromise & settingsSubscriptionCleanup.
  const peerHost = findOtherLiveHostWithInit(hostState)
  if (peerHost?.initializationPromise) {
    const peerPromise = peerHost.initializationPromise
    hostState.initFailureReason = undefined
    let joinedOwnPromise: Promise<void> | undefined
    joinedOwnPromise = (async () => {
      await peerPromise
      if (
        peerHost.initializationPromise === peerPromise &&
        peerHost.sandboxStartedOnce &&
        isSandboxingEnabled()
      ) {
        hostState.sandboxWasEnabled = true
        hostState.sandboxStartedOnce = true
        if (sandboxAskCallback !== undefined) {
          hostState.lastSandboxAskCallback = sandboxAskCallback
        }
        if (hostState.worktreeMainRepoPath === undefined) {
          hostState.worktreeMainRepoPath = detectWorktreeMainRepoPath(
            getCwdState(),
          )
        }
        if (getPlatform() === 'windows') {
          windowsSandboxStartStore.markStarted(
            resolveWindowsBackendChoice().backend,
            {
              tlsTerminate: willSandboxTlsTerminate(),
              localConnections: areWindowsLocalConnectionsOn(),
            },
          )
        }
        installHostSettingsSubscriptions(hostState)
        refreshConfig()
        return
      }
      // Peer init failed or was reset before completing; clear and fall through to fresh init.
      if (hostState.initializationPromise === joinedOwnPromise) {
        hostState.initializationPromise = undefined
      }
      await initialize(sandboxAskCallback)
    })()
    hostState.initializationPromise = joinedOwnPromise
    return joinedOwnPromise
  }

  // Always install a delegating callback on the singleton BaseSandboxManager so
  // that if Host A initializes without a callback and Host B later joins with
  // askB, Host B's callback is live. Also enforces allowManagedDomainsOnly +
  // densable 2.1.219 strictAllowlist (deny without prompt).
  const wrappedCallback: SandboxAskCallback = async (
    hostPattern: NetworkHostPattern,
  ) => {
    if (shouldAllowManagedSandboxDomainsOnly()) {
      logForDebugging(
        `[sandbox] Blocked network request to ${hostPattern.host} (allowManagedDomainsOnly)`,
      )
      return false
    }
    if (resolveSandboxStrictAllowlist()) {
      logForDebugging(
        `[sandbox] Blocked network request to ${hostPattern.host} (strictAllowlist)`,
      )
      return false
    }
    const activeAsk = resolveActiveSandboxAskCallback()
    if (!activeAsk) {
      return false
    }
    return activeAsk(hostPattern)
  }

  // Create the initialization promise synchronously (before any await) to prevent
  // race conditions where wrapWithSandbox() is called before the promise is assigned.
  // densable Te().initializationPromise is set before Pa/initialize so ro() &&= n.
  const initToken = {}
  hostState.initFailureReason = undefined
  setProxyOwnerHostState(hostState)
  setSandboxInitializationPromise(initToken)
  hostState.initializationPromise = (async () => {
    try {
      markInstallsSinceInitializeStarted()
      // Resolve worktree main `.git` once (densable WZ). Cached for refreshConfig().
      if (hostState.worktreeMainRepoPath === undefined) {
        hostState.worktreeMainRepoPath = detectWorktreeMainRepoPath(
          getCwdState(),
        )
      }

      // densable windows init: pN(), await fN() before Re.initialize
      if (getPlatform() === 'windows') {
        ensureAtomicWriteStagingDirs()
        await ensureBridgeSpawnRootDirForWrap()
      }

      const settings = getSettings_DEPRECATED()
      const runtimeConfig = convertToSandboxRuntimeConfig(settings)
      const platForInit = getPlatform()
      if (platForInit === 'linux' || platForInit === 'wsl') {
        process.env[SRT_ALLOW_NESTED_USERNS_ENV] =
          getSrtAllowNestedUsernsEnv(settings)[SRT_ALLOW_NESTED_USERNS_ENV]
      }
      const hasNetworkLists =
        (runtimeConfig.network?.allowedDomains?.length ?? 0) > 0 ||
        (runtimeConfig.network?.deniedDomains?.length ?? 0) > 0
      setSandboxCommandNetworkListsOffered(hasNetworkLists)

      // Log monitor is automatically enabled for macOS
      await BaseSandboxManager.initialize(
        withMergedLiveSessionAllowedHosts(runtimeConfig),
        wrappedCallback,
      )
      hostState.sandboxWasEnabled = true
      hostState.sandboxStartedOnce = true
      if (platForInit === 'windows') {
        windowsSandboxStartStore.markStarted(
          resolveWindowsBackendChoice().backend,
          {
            tlsTerminate: willSandboxTlsTerminate(),
            localConnections: areWindowsLocalConnectionsOn(),
          },
        )
      }
      finishSandboxInitializeAllowlist(runtimeConfig)
      // densable FZ — record wrap write roots after init (yN)
      recordWrapWriteRoots(runtimeConfig)

      // Subscribe to settings & command-producer changes scoped to this host
      installHostSettingsSubscriptions(hostState)
    } catch (error) {
      // Clear this host's promise on error so initialization can be retried
      hostState.initializationPromise = undefined
      clearProxyOwnerHostStateIfMatches(hostState)
      setSandboxInitializationPromise(undefined)
      failSandboxInitializeAllowlist()
      hostState.initFailureReason = errorMessage(error)
      if (getPlatform() === 'windows') {
        windowsSandboxStartStore.markInitFailed(hostState.initFailureReason)
      }

      // Log error but don't throw - let sandboxing fail gracefully
      logForDebugging(
        `Failed to initialize sandbox: ${hostState.initFailureReason}`,
      )
    }
  })()

  return hostState.initializationPromise
}

/**
 * Refresh sandbox config from current settings immediately
 * Call this after updating permissions to avoid race conditions
 */
export function refreshConfig(): void {
  if (!isSandboxingEnabled()) return
  applySandboxRuntimeConfig(
    convertToSandboxRuntimeConfig(getSettings_DEPRECATED()),
    cfg => {
      BaseSandboxManager.updateConfig(withMergedLiveSessionAllowedHosts(cfg))
    },
  )
}

/**
 * densable `zvb` / `addSessionAllowedHost` — add host and refreshConfig so
 * convert merges it into allowedDomains.
 */
export function addSessionAllowedHost(host: string): void {
  const normalized = normalizeSandboxSessionHost(host)
  const { sessionAllowedHosts } = getSandboxHostState()
  if (sessionAllowedHosts.has(normalized)) return
  sessionAllowedHosts.add(normalized)
  refreshConfig()
}

/**
 * Reset sandbox state and clear memoized values for the current SessionHost.
 */
export async function reset(): Promise<void> {
  const hostState = getSandboxHostState()
  // Always clean up THIS host's subscriptions and init promise independently
  hostState.settingsSubscriptionCleanup?.()
  hostState.settingsSubscriptionCleanup = undefined
  hostState.initializationPromise = undefined

  hostState.worktreeMainRepoPath = undefined
  hostState.bareGitRepoScrubPaths.length = 0
  hostState.disabledFsDiagnostic = null
  hostState.fsReadConfigMemo = undefined
  resetSymlinkedDenyScrubState()
  // densable mSb drops whole CFd (sessionAllowedHosts with it)
  hostState.sessionAllowedHosts.clear()
  hostState.sandboxStartedOnce = false
  hostState.droppedRepoNetworkAllowancesLogged = false
  hostState.hostedToolContainer = false
  hostState.sandboxDisabledThisSession = false
  hostState.initFailureReason = undefined
  hostState.lastSandboxAskCallback = undefined
  windowsSandboxStartStore.reset()
  setSandboxCommandNetworkListsOffered(false)

  if (hasActiveSessionAls()) {
    const otherStartedHosts = getLiveSandboxHostStates().filter(
      state => state !== hostState && state.sandboxStartedOnce,
    )
    if (otherStartedHosts.length > 0) {
      // Keep proxyOwnerHostStateRef pointing to the host whose ALS owns the
      // running singleton proxy callback until full teardown below, so proxy
      // callbacks firing under the reset owner's captured ALS still fall
      // through to surviving started hosts while unrelated hosts fail closed.
      const survivorSession = otherStartedHosts
        .map(s => s.sessionRef?.deref())
        .find((s): s is Session => s !== undefined)
      if (survivorSession) {
        runWithSession(survivorSession, () => {
          refreshConfig()
        })
      }
      return
    }
  }

  // Clear memoized caches
  baseCheckDependencies.cache.clear?.()
  baseIsSupportedPlatform.cache.clear?.()
  clearProxyOwnerHostState()

  // Reset the base sandbox manager
  return BaseSandboxManager.reset()
}

export function cleanupAfterCommand(): void {
  BaseSandboxManager.cleanupAfterCommand()
  scrubBareGitRepoFiles()
  // Official 2.1.326 #23: remove 0-byte Linux placeholders (e.g. .git/config.lock)
  cleanupLinuxSandboxPlaceholderFiles()
  // Official 2.1.326 #301: set aside unexpected entries planted in .git/
  quarantineUnexpectedGitDirEntries()
  // densable LZ — spare settings.json symlink hops outside write roots
  scrubSymlinkedDenyPaths({
    getConfig: () => BaseSandboxManager.getConfig?.(),
    updateConfig: cfg => {
      BaseSandboxManager.updateConfig(cfg)
      recordWrapWriteRoots(cfg)
    },
  })
}

/**
 * Official 2.1.328 #676 (`ensureInitializedForWrap` @291436447):
 * Verify sandbox initialization completed before wrapping a command.
 * When initialization failed and `sandbox.failIfUnavailable` is not set:
 * - For Claude Code's own internal commands (`keepsSandboxOn !== false`),
 *   refuse the command while keeping the sandbox enabled so the next command
 *   can retry initialization.
 * - For user/model Bash commands (`keepsSandboxOn === false`), disable
 *   sandboxing for the rest of the session and throw `SandboxInitFailedError`
 *   so this command is refused and clearly reports that sandboxing is off.
 */
export async function ensureInitializedForWrap(options?: {
  keepsSandboxOn?: boolean
}): Promise<void> {
  if (!isSandboxingEnabled()) {
    return
  }
  const hostState = getSandboxHostState()
  if (
    (!hostState.initializationPromise ||
      !hostState.sandboxStartedOnce ||
      hostState.forcedInitFailureForTesting !== undefined) &&
    !hostState.sandboxDisabledThisSession
  ) {
    await initialize(hostState.lastSandboxAskCallback)
  }
  const currentInit =
    hostState.forcedInitFailureForTesting !== undefined
      ? undefined
      : hostState.initializationPromise
  if (currentInit) {
    await currentInit
  }
  if (!currentInit || hostState.initializationPromise !== currentInit) {
    const suffix = hostState.initFailureReason
      ? `: ${hostState.initFailureReason}`
      : ''
    if (isSandboxRequired()) {
      throw new SandboxInitFailedError(
        `Sandbox is required but failed to initialize${suffix}. Restart to retry. Running it outside the sandbox (dangerouslyDisableSandbox) is not allowed either.`,
      )
    }
    if (
      options?.keepsSandboxOn !== false &&
      !hostState.sandboxDisabledThisSession
    ) {
      throw new SandboxInitFailedError(
        `Sandbox is enabled but failed to initialize${suffix}. This command of Claude Code's own was not run; the sandbox stays on, and the next command tries to start it again.`,
      )
    }
    hostState.sandboxDisabledThisSession = true
    throw new SandboxInitFailedError(
      `Sandbox is enabled but failed to initialize${suffix}. Sandboxing is disabled for the rest of this session; restart to retry.`,
    )
  }
}
