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
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import {
  createLocalFsBackend,
  type CreateLocalFsBackendOptions,
  type StorageV5,
} from './createLocalFsBackend.js'
import {
  isHoverRestOn,
  pinHoverRest,
  type HoverRestPinResult,
} from './hoverRestPin.js'

export {
  createLocalFsBackend,
  type CreateLocalFsBackendOptions,
  type StorageV5,
  type StorageV5Result,
  type StorageV5ScopeKind,
} from './createLocalFsBackend.js'
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

let lastPinned: StorageV5 | undefined

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

/**
 * densable qb / tryCreateV5Backend. Official body is empty after Po().
 */
export function tryCreateV5Backend(): StorageV5 | undefined {
  if (!isHoverRestOn()) return
  return
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
  lastPinned = result
  return result
}

export function getPinnedStorageV5(): StorageV5 | undefined {
  return lastPinned
}

export function resetPinnedStorageV5ForTests(): void {
  lastPinned = undefined
}
