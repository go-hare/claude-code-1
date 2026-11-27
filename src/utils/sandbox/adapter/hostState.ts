/**
 * Per-SessionHost sandbox state (`HostSlot<SandboxHostState>`), proxy-owner
 * tracking (`proxyOwnerHostStateRef`), and multi-host ask-callback resolution.
 *
 * Preserves all Stage-1 HostSlot isolation invariants:
 * - `initializationPromise` and `settingsSubscriptionCleanup` live inside
 *   `SandboxHostState` (zero process-global init state).
 * - `proxyOwnerHostStateRef` tracks which host's ALS owns the singleton proxy
 *   callback so surviving started hosts continue receiving prompts if the
 *   initial owner resets, while unrelated hosts fail closed.
 */

import type {
  FsReadRestrictionConfig,
  SandboxAskCallback,
  SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import { isIP } from 'node:net'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
} from '../../sessionHost.js'
import type { Session } from '../../sessionRoot.js'
import {
  type DisabledFsDiagnosticLists,
  type GitDirSnapshotEntry,
  RELAUNCH_SANDBOX_HOLD_ENV,
  type SandboxRootMoveHold,
} from './constants.js'
import { shouldAllowManagedSandboxDomainsOnly } from './pathPolicy.js'

function readInitialSandboxRootMoveHold(): SandboxRootMoveHold | undefined {
  const raw = process.env[RELAUNCH_SANDBOX_HOLD_ENV]
  if (!raw) return undefined
  delete process.env[RELAUNCH_SANDBOX_HOLD_ENV]
  const parts = raw.split(',')
  return {
    isStrict: parts.includes('isStrict'),
    isStrictByFailedRead: parts.includes('isStrictByFailedRead'),
    isRequired: parts.includes('isRequired'),
    isAutoAllowOff: parts.includes('isAutoAllowOff'),
  }
}

export type SandboxHostState = {
  disabledFsDiagnostic: DisabledFsDiagnosticLists | null
  sessionAllowedHosts: Set<string>
  droppedRepoNetworkAllowancesLogged: boolean
  worktreeMainRepoPath: string | null | undefined
  bareGitRepoScrubPaths: string[]
  sandboxWasEnabled: boolean
  isHeldOnByFailedSettingsRead: boolean
  sandboxStartedOnce: boolean
  hostedToolContainer: boolean
  sandboxDisabledThisSession: boolean
  initFailureReason: string | undefined
  forcedInitFailureForTesting: string | undefined
  lastSandboxAskCallback: SandboxAskCallback | undefined
  sandboxRootMoveHold: SandboxRootMoveHold | undefined
  fsReadConfigMemo:
    | { cfg: unknown; result: FsReadRestrictionConfig }
    | undefined
  createdLinuxPlaceholderFiles: Set<string>
  placeholderCleanupRegistered: boolean
  gitDirSnapshotsBeforeWrap: Map<string, GitDirSnapshotEntry>
  initializationPromise: Promise<void> | undefined
  settingsSubscriptionCleanup: (() => void) | undefined
  sessionRef?: WeakRef<Session>
}

const liveSandboxHostStates = new Set<WeakRef<SandboxHostState>>()

// Host whose ALS initialized the shared BaseSandboxManager proxy server.
// Proxy callbacks run in that host's captured ALS, so if it resets (or joined
// without an ask callback), we must fall through to surviving started hosts
// instead of permanently failing closed for them.
let proxyOwnerHostStateRef: WeakRef<SandboxHostState> | undefined

export function setProxyOwnerHostState(hostState: SandboxHostState): void {
  proxyOwnerHostStateRef = new WeakRef(hostState)
}

export function clearProxyOwnerHostStateIfMatches(
  hostState: SandboxHostState,
): void {
  if (proxyOwnerHostStateRef?.deref() === hostState) {
    proxyOwnerHostStateRef = undefined
  }
}

export function clearProxyOwnerHostState(): void {
  proxyOwnerHostStateRef = undefined
}

function pruneDeadSandboxHostStates(): void {
  for (const ref of liveSandboxHostStates) {
    if (ref.deref() === undefined) {
      liveSandboxHostStates.delete(ref)
    }
  }
}

export function getLiveSandboxHostStates(): SandboxHostState[] {
  const live: SandboxHostState[] = []
  for (const ref of liveSandboxHostStates) {
    const state = ref.deref()
    if (state === undefined) {
      liveSandboxHostStates.delete(ref)
    } else {
      live.push(state)
    }
  }
  return live
}

export function hasMultipleStartedSandboxHosts(): boolean {
  let startedCount = 0
  for (const state of getLiveSandboxHostStates()) {
    if (state.sandboxStartedOnce) {
      startedCount++
      if (startedCount > 1) return true
    }
  }
  return false
}

export function findOtherLiveHostWithInit(
  exclude: SandboxHostState,
): SandboxHostState | undefined {
  for (const state of getLiveSandboxHostStates()) {
    if (state !== exclude && state.initializationPromise !== undefined) {
      return state
    }
  }
  return undefined
}

const sandboxStateByHost = new HostSlot<SandboxHostState>(() => {
  const initialHold = !hasActiveSessionAls()
    ? readInitialSandboxRootMoveHold()
    : undefined
  const state: SandboxHostState = {
    disabledFsDiagnostic: null,
    sessionAllowedHosts: new Set<string>(),
    droppedRepoNetworkAllowancesLogged: false,
    worktreeMainRepoPath: undefined,
    bareGitRepoScrubPaths: [],
    sandboxWasEnabled: false,
    isHeldOnByFailedSettingsRead: false,
    sandboxStartedOnce: false,
    hostedToolContainer: false,
    sandboxDisabledThisSession: false,
    initFailureReason: undefined,
    forcedInitFailureForTesting: undefined,
    lastSandboxAskCallback: undefined,
    sandboxRootMoveHold: initialHold,
    fsReadConfigMemo: undefined,
    createdLinuxPlaceholderFiles: new Set<string>(),
    placeholderCleanupRegistered: false,
    gitDirSnapshotsBeforeWrap: new Map<string, GitDirSnapshotEntry>(),
    initializationPromise: undefined,
    settingsSubscriptionCleanup: undefined,
    sessionRef: new WeakRef(getBootstrapSession().root),
  }
  if (liveSandboxHostStates.size > 64) {
    pruneDeadSandboxHostStates()
  }
  liveSandboxHostStates.add(new WeakRef(state))
  return state
})

export function getSandboxHostState(): SandboxHostState {
  const state = sandboxStateByHost.of(getBootstrapSessionHost())
  if (state.sessionRef?.deref() === undefined) {
    state.sessionRef = new WeakRef(getBootstrapSession().root)
  }
  return state
}

/**
 * Merge `sessionAllowedHosts` across all live `SandboxHostState` instances when
 * syncing config into the process-singleton `BaseSandboxManager`, so one host's
 * `addSessionAllowedHost()` / `refreshConfig()` never drops another live host's
 * allowed domains. Skipped under `allowManagedDomainsOnly`.
 */
export function withMergedLiveSessionAllowedHosts(
  cfg: SandboxRuntimeConfig,
): SandboxRuntimeConfig {
  if (shouldAllowManagedSandboxDomainsOnly()) {
    return cfg
  }
  const baseAllowed = cfg.network?.allowedDomains ?? []
  const merged = new Set<string>(baseAllowed)
  let added = false
  for (const state of getLiveSandboxHostStates()) {
    for (const host of state.sessionAllowedHosts) {
      if (!merged.has(host)) {
        merged.add(host)
        added = true
      }
    }
  }
  if (!added) {
    return cfg
  }
  return {
    ...cfg,
    network: {
      ...cfg.network,
      allowedDomains: [...merged],
    },
  }
}

export function resolveActiveSandboxAskCallback():
  | SandboxAskCallback
  | undefined {
  const currentState = getSandboxHostState()
  if (currentState.lastSandboxAskCallback) {
    return currentState.lastSandboxAskCallback
  }
  if (
    hasActiveSessionAls() &&
    currentState !== proxyOwnerHostStateRef?.deref()
  ) {
    return undefined
  }
  for (const state of getLiveSandboxHostStates()) {
    if (state.sandboxStartedOnce && state.lastSandboxAskCallback) {
      return state.lastSandboxAskCallback
    }
  }
  return undefined
}

/** densable `KXt` — bracket bare IPv6 for domain list / rule content. */
export function normalizeSandboxSessionHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

/** Test helper — densable session bag contents. */
export function getSessionAllowedHosts(): ReadonlySet<string> {
  return getSandboxHostState().sessionAllowedHosts
}

/** Test helper — clear densable session host bag without full reset. */
export function clearSessionAllowedHostsForTests(): void {
  getSandboxHostState().sessionAllowedHosts.clear()
}

/** Test helper — inspect per-host sandbox ask callback. */
export function getLastSandboxAskCallbackForTests():
  | SandboxAskCallback
  | undefined {
  return getSandboxHostState().lastSandboxAskCallback
}

/** Test/diagnostic access to last convert dual-facade stash. */
export function getDisabledFsDiagnosticLists(): DisabledFsDiagnosticLists | null {
  return getSandboxHostState().disabledFsDiagnostic
}

// Official 2.1.323 #2017 (`Da` / `cV`) + 2.1.325 #2374 + 2.1.328 #676 + 2.1.331:
// Per-host sandbox state lives in `sandboxStateByHost` (`HostSlot` on
// `getBootstrapSessionHost()`), so concurrent hosts never bleed session state.
export class SandboxInitFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxInitFailedError'
  }
}

export function _resetSandboxHeldStateForTesting(): void {
  const hostState = getSandboxHostState()
  hostState.sandboxWasEnabled = false
  hostState.isHeldOnByFailedSettingsRead = false
  hostState.sandboxStartedOnce = false
  hostState.hostedToolContainer = false
  hostState.sandboxDisabledThisSession = false
  hostState.initFailureReason = undefined
  hostState.forcedInitFailureForTesting = undefined
  hostState.lastSandboxAskCallback = undefined
  hostState.fsReadConfigMemo = undefined
}

export function isSandboxDisabledThisSession(): boolean {
  return getSandboxHostState().sandboxDisabledThisSession
}

export function getSandboxInitFailureReason(): string | undefined {
  return getSandboxHostState().initFailureReason
}

export function _setSandboxInitFailureForTesting(
  reason: string | undefined,
): void {
  const hostState = getSandboxHostState()
  hostState.forcedInitFailureForTesting = reason
  hostState.initFailureReason = reason
  if (reason !== undefined) {
    hostState.initializationPromise = undefined
  }
}

export function markHostedToolContainer(value = true): void {
  getSandboxHostState().hostedToolContainer = value
}

export function getSandboxRootMoveHold(): SandboxRootMoveHold | undefined {
  return getSandboxHostState().sandboxRootMoveHold
}

export function clearSandboxRootMoveHold(): void {
  getSandboxHostState().sandboxRootMoveHold = undefined
}

export function serializeSandboxRootMoveHoldEnv(): Record<string, string> {
  const hold = getSandboxHostState().sandboxRootMoveHold
  if (!hold) return {}
  const flags = [
    'on',
    ...Object.entries(hold)
      .filter(([, v]) => v)
      .map(([k]) => k),
  ]
  return { [RELAUNCH_SANDBOX_HOLD_ENV]: flags.join(',') }
}

/** Whether sandbox initialization completed at least once in this session. */
export function hasSandboxStartedOnce(): boolean {
  return getSandboxHostState().sandboxStartedOnce
}

export function clearFsReadConfigMemoForTests(): void {
  getSandboxHostState().fsReadConfigMemo = undefined
}
