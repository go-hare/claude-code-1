/**
 * densable storageV5 public API (2.1.246).
 *
 *   createLocalFsBackend     hb @207543077
 *   tryCreateV5Backend       qb / G6c — Po() then return (no backend)
 *   tryCreateLocalV5Backend  qF / H6c — Po() then hb({configHome, globalConfigFile})
 *   pinStorageV5FromEnv      UF / E6c
 *   recordHoverRestDecision  Ub / F6c
 *   pinStorageV5             v / eH
 */

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getGlobalClaudeFile, seedGlobalClaudeFile } from '../env.js'
import { registerPinnedStorageV5Reader } from '../disklessGuards.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import {
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
  ofDefaultHost,
} from '../sessionHost.js'
import { createHoverRestBackend } from './createHoverRestBackend.js'
import {
  createLocalFsBackend,
  type CreateLocalFsBackendOptions,
  type StorageV5,
} from './createLocalFsBackend.js'
import { registerPluginUsageStorageV5 } from '../plugins/pluginUsagePending.js'
import {
  isHoverRestOn,
  pinHoverRest,
  type HoverRestPinResult,
} from './hoverRestPin.js'

export {
  createHoverRestBackend,
  type HoverRestBackendOptions,
} from './createHoverRestBackend.js'
export {
  createLocalFsBackend,
  type CreateLocalFsBackendOptions,
  type StorageV5,
  type StorageV5Result,
  type StorageV5ScopeKind,
} from './createLocalFsBackend.js'
export {
  createMemoryStorageV5Backend,
  type CreateMemoryStorageV5BackendOptions,
  type MemoryStorageV5,
} from './createMemoryBackend.js'
export {
  isHoverRestOn,
  resetHoverRestPinForTests,
} from './hoverRestPin.js'
export {
  CREDENTIALS_STORE_HANDLE,
  credentialsStoreFor,
  getPinnedCredentials,
  pinCredentialsStore,
  resetPinnedCredentialsForTests,
  sessionServicesFor,
  tryCreateCredentialsStore,
} from './credentialsStore.js'

const pinnedStorageV5HostSlot = new HostSlot<{
  hasOverride: boolean
  lastPinned: StorageV5 | undefined
}>(() => ({
  hasOverride: false,
  lastPinned: undefined,
}))

function getPinnedStorageV5State(): {
  hasOverride: boolean
  lastPinned: StorageV5 | undefined
} {
  return pinnedStorageV5HostSlot.of(getBootstrapSessionHost())
}

/**
 * densable Ub — pin CLAUDE_CODE_HOVER_REST / tengu_hover_rest.
 * Non-boolean is treated as off.
 */
export function recordHoverRestDecision(value: unknown): HoverRestPinResult {
  if (typeof value !== 'boolean') {
    logForDebugging(
      `tengu_hover_rest served a ${typeof value}, not a boolean; treating it as off`,
      { level: 'warn' },
    )
  }
  const result = pinHoverRest(value === true)
  if (result === 'conflict') {
    logForDebugging(
      `tengu_hover_rest read ${String(value)} at a second pin in this process; keeping the first decision`,
      { level: 'warn' },
    )
  }
  return result
}

const externalStorageV5FactoryHostSlot = new HostSlot<{
  hasOverride: boolean
  factory: (() => StorageV5 | undefined) | undefined
}>(() => ({
  hasOverride: false,
  factory: undefined,
}))

/**
 * Register a pluggable external `StorageV5` factory on the active `SessionHost`
 * (used by `tryCreateV5Backend()` when hover-rest is enabled, with fallback to
 * the default host's factory). Pass `undefined` to clear the host override.
 */
export function registerExternalStorageV5Factory(
  factory: (() => StorageV5 | undefined) | undefined,
): void {
  const slot = externalStorageV5FactoryHostSlot.of(getBootstrapSessionHost())
  slot.hasOverride = true
  slot.factory = factory
}

function getEffectiveExternalStorageV5Factory():
  | (() => StorageV5 | undefined)
  | undefined {
  const own = externalStorageV5FactoryHostSlot.peek(getBootstrapSessionHost())
  if (own?.hasOverride) {
    return own.factory
  }
  if (hasActiveSessionAls()) {
    return undefined
  }
  return ofDefaultHost(externalStorageV5FactoryHostSlot).factory
}

/**
 * densable qb / tryCreateV5Backend. Uses registered external factory if present;
 * else auto-instantiates `createHoverRestBackend` when `CLAUDE_CODE_HOVER_REST_URL`
 * is set; otherwise returns undefined after `isHoverRestOn()` check.
 */
export function tryCreateV5Backend(): StorageV5 | undefined {
  if (!isHoverRestOn()) return
  const factory = getEffectiveExternalStorageV5Factory()
  if (factory) {
    return factory()
  }
  const hoverRestUrl = process.env.CLAUDE_CODE_HOVER_REST_URL?.trim()
  if (hoverRestUrl) {
    try {
      return createHoverRestBackend({
        baseUrl: hoverRestUrl,
        authToken: process.env.CLAUDE_CODE_HOVER_REST_TOKEN,
      })
    } catch (error) {
      logForDebugging(
        `tryCreateV5Backend: failed to construct hover REST backend: ${String(error)}`,
        { level: 'warn' },
      )
      return undefined
    }
  }
  return undefined
}

export type TryCreateLocalV5BackendOptions = {
  globalConfigFile?: string
  hostFilesServe?: unknown
}

/**
 * densable leftover `qF` @207548851 / tryCreateLocalV5Backend.
 * Official outcome: `logFeatureOk("storage_v5_backend")` /
 * `logFeatureSad("storage_v5_backend","fell_back")`.
 */
export function tryCreateLocalV5Backend(
  options: TryCreateLocalV5BackendOptions = {},
): StorageV5 | undefined {
  if (!isHoverRestOn()) return
  let backend: StorageV5 | undefined
  try {
    if (options.globalConfigFile !== undefined) {
      const t = seedGlobalClaudeFile(options.globalConfigFile)
      if (t !== 'seeded') {
        logForDebugging(
          t === 'conflict'
            ? `global config file already resolved to ${getGlobalClaudeFile()} before the host handed ${options.globalConfigFile}; keeping the first answer`
            : 'global config file already resolved to the handed path before the host handed it; keeping that first answer',
          { level: t === 'conflict' ? 'warn' : 'debug' },
        )
      }
    }
    backend = createLocalFsBackend({
      configHome: getClaudeConfigHomeDir(),
      globalConfigFile: getGlobalClaudeFile(),
      ...(options.hostFilesServe !== undefined && {
        hostFilesServe: options.hostFilesServe,
      }),
    })
  } catch (error) {
    logError(
      error instanceof Error
        ? error
        : new Error(
            'v5 storage backend construction failed; this process falls back to legacy storage',
          ),
    )
    logForDebugging(
      'v5 storage backend construction failed; this process falls back to legacy storage',
      { level: 'error' },
    )
  }
  try {
    if (backend !== undefined) {
      logEvent('tengu_feature_ok', {
        feature_name:
          'storage_v5_backend' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      logEvent('tengu_feature_sad', {
        feature_name:
          'storage_v5_backend' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'fell_back' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch (error) {
    logForDebugging(
      `storage_v5_backend outcome event not recorded: ${String(error)}`,
      { level: 'warn' },
    )
  }
  return backend
}

export type StorageV5EnvPin = {
  backend?: StorageV5
  configHome: string
}

/**
 * densable UF / pinStorageV5FromEnv.
 */
export function pinStorageV5FromEnv(
  createBackend: () => StorageV5 | undefined = tryCreateV5Backend,
): StorageV5EnvPin | undefined {
  const raw = process.env.CLAUDE_CODE_HOVER_REST
  if (raw === undefined) return
  if (recordHoverRestDecision(isEnvTruthy(raw)) !== 'pinned') return
  return {
    backend: isHoverRestOn() ? createBackend() : undefined,
    configHome: getClaudeConfigHomeDir(),
  }
}

/**
 * densable v / pinStorageV5.
 */
export function pinStorageV5(
  snapshot?: StorageV5EnvPin,
): StorageV5 | undefined {
  recordHoverRestDecision(
    process.env.CLAUDE_CODE_HOVER_REST !== undefined
      ? isEnvTruthy(process.env.CLAUDE_CODE_HOVER_REST)
      : false,
  )
  let result: StorageV5 | undefined
  if (snapshot === undefined) {
    result = isHoverRestOn() ? tryCreateV5Backend() : undefined
  } else {
    const backend = isHoverRestOn() ? snapshot.backend : undefined
    if (backend === undefined) {
      result = undefined
    } else if (snapshot.configHome !== getClaudeConfigHomeDir()) {
      logForDebugging(
        `CLAUDE_CONFIG_DIR now names ${getClaudeConfigHomeDir()}, not ${snapshot.configHome} where the v5 storage backend was built at start-up; not handing it on, so this process keeps today's direct file access`,
        { level: 'warn' },
      )
      result = undefined
    } else {
      result = backend
    }
  }
  const state = getPinnedStorageV5State()
  state.hasOverride = true
  state.lastPinned = result
  registerPluginUsageStorageV5(result)
  return result
}

/**
 * Directly attach a host-provided `StorageV5` backend (e.g., `createMemoryStorageV5Backend()`
 * or a remote REST/DB adapter) to the active `SessionHost` without mutating
 * `CLAUDE_CODE_HOVER_REST`.
 */
export function pinInjectedStorageV5(
  backend: StorageV5 | undefined,
): StorageV5 | undefined {
  const state = getPinnedStorageV5State()
  state.hasOverride = true
  state.lastPinned = backend
  registerPluginUsageStorageV5(backend)
  return backend
}

export function getPinnedStorageV5(): StorageV5 | undefined {
  const own = pinnedStorageV5HostSlot.peek(getBootstrapSessionHost())
  if (own?.hasOverride) {
    return own.lastPinned
  }
  if (hasActiveSessionAls()) {
    return undefined
  }
  return ofDefaultHost(pinnedStorageV5HostSlot).lastPinned
}

registerPinnedStorageV5Reader(getPinnedStorageV5)

export function resetPinnedStorageV5ForTests(): void {
  const host = getBootstrapSessionHost()
  const slot = pinnedStorageV5HostSlot.peek(host)
  if (slot) {
    slot.hasOverride = false
    slot.lastPinned = undefined
  }
  const factorySlot = externalStorageV5FactoryHostSlot.peek(host)
  if (factorySlot) {
    factorySlot.hasOverride = false
    factorySlot.factory = undefined
  }
}
