import chokidar, { type FSWatcher } from 'chokidar'
import { isAbsolute, join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  executeCwdChangedHooks,
  executeFileChangedHooks,
  type HookOutsideReplResult,
} from '../hooks.js'
import { clearCwdEnvFiles } from '../sessionEnvironment.js'
import { getHooksConfigFromSnapshot } from './hooksConfigSnapshot.js'

let watcher: FSWatcher | null = null
let currentCwd: string
let dynamicWatchPaths: string[] = []
let dynamicWatchPathsSorted: string[] = []
let initialized = false
let hasEnvHooks = false
let notifyCallback: ((text: string, isError: boolean) => void) | null = null

export function setEnvHookNotifier(
  cb: ((text: string, isError: boolean) => void) | null,
): void {
  notifyCallback = cb
}

/**
 * densable J6n — strip Windows long-path / UNC long-path prefixes.
 * Exported for pure unit tests (densable #14).
 */
export function stripWindowsLongPathPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`
  if (path.startsWith('\\\\?\\') && path.length >= 7 && path[5] === ':') {
    return path.slice(4)
  }
  return path
}

/**
 * densable Hm — WSL UNC (`\\wsl$\\…` / `\\wsl.localhost\\…`) is local-ish; keep.
 */
export function isWslUncPath(path: string): boolean {
  return /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(path)
}

/**
 * densable ku — path begins with `//` or `\\`.
 */
export function isUncPath(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

/**
 * densable aHe — remote UNC / unsafe volume watch path to drop.
 * densable FileChanged filters with `!aHe` before chokidar.watch.
 */
export function isRemoteUncWatchPath(path: string): boolean {
  // densable D5l: volume device paths with `..` segments or mixed `/` are unsafe
  const hasDotDotOrSlash = (p: string): boolean =>
    /(^|[\\/])\.{1,2}([\\/]|$)/.test(p) || p.includes('/')

  if (/^\\\\\?\\volume\{/i.test(path)) {
    return hasDotDotOrSlash(path)
  }
  const stripped = stripWindowsLongPathPrefix(path)
  if (stripped !== path && hasDotDotOrSlash(stripped)) {
    return true
  }
  // densable: ku(t) && !Hm(t) — UNC that is not WSL
  return isUncPath(stripped) && !isWslUncPath(stripped)
}

/**
 * densable resolveWatchPaths filter — drop remote UNC, log once if any dropped.
 */
export function filterWatchableFileChangedPaths(paths: string[]): string[] {
  const filtered = paths.filter(p => !isRemoteUncWatchPath(p))
  if (filtered.length !== paths.length) {
    logForDebugging('FileChanged: dropped remote UNC watch path(s)', {
      level: 'warn',
    })
  }
  return filtered
}

export function initializeFileChangedWatcher(cwd: string): void {
  if (initialized) return
  initialized = true
  currentCwd = cwd

  const config = getHooksConfigFromSnapshot()
  hasEnvHooks =
    (config?.CwdChanged?.length ?? 0) > 0 ||
    (config?.FileChanged?.length ?? 0) > 0

  if (hasEnvHooks) {
    registerCleanup(async () => dispose())
  }

  const paths = resolveWatchPaths(config)
  if (paths.length === 0) return

  startWatching(paths)
}

function resolveWatchPaths(
  config?: ReturnType<typeof getHooksConfigFromSnapshot>,
): string[] {
  const matchers = (config ?? getHooksConfigFromSnapshot())?.FileChanged ?? []

  // Matcher field: filenames to watch in cwd, pipe-separated (e.g. ".envrc|.env")
  const staticPaths: string[] = []
  for (const m of matchers) {
    if (!m.matcher) continue
    for (const name of m.matcher.split('|').map(s => s.trim())) {
      if (!name) continue
      staticPaths.push(isAbsolute(name) ? name : join(currentCwd, name))
    }
  }

  // densable: unique + drop remote UNC (aHe)
  return filterWatchableFileChangedPaths([
    ...new Set([...staticPaths, ...dynamicWatchPaths]),
  ])
}

function startWatching(paths: string[]): void {
  logForDebugging(`FileChanged: watching ${paths.length} paths`)
  watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    ignorePermissionErrors: true,
  })
  watcher.on('change', p => handleFileEvent(p, 'change'))
  watcher.on('add', p => handleFileEvent(p, 'add'))
  watcher.on('unlink', p => handleFileEvent(p, 'unlink'))
  // densable #14: unhandled chokidar 'error' crashes process; first event only
  // logs tengu_feature_bad / ok so FS errors during start don't double-count.
  let startOutcomeLogged = false
  watcher.on('error', (err: unknown) => {
    if (!startOutcomeLogged) {
      startOutcomeLogged = true
      logEvent('tengu_feature_bad', {
        feature_name:
          'file_watcher_start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'fs_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    logForDebugging(`FileChanged: watcher error: ${errorMessage(err)}`, {
      level: 'warn',
    })
  })
  watcher.on('ready', () => {
    if (!startOutcomeLogged) {
      startOutcomeLogged = true
      logEvent('tengu_feature_ok', {
        feature_name:
          'file_watcher_start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  })
}

function handleFileEvent(
  path: string,
  event: 'change' | 'add' | 'unlink',
): void {
  logForDebugging(`FileChanged: ${event} ${path}`)
  void executeFileChangedHooks(path, event)
    .then(({ results, watchPaths, systemMessages }) => {
      logEvent('tengu_feature_ok', {
        feature_name:
          'file_watcher_change_detected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      if (watchPaths.length > 0) {
        updateWatchPaths(watchPaths)
      }
      for (const msg of systemMessages) {
        notifyCallback?.(msg, false)
      }
      for (const r of results) {
        if (!r.succeeded && r.output) {
          notifyCallback?.(r.output, true)
        }
      }
    })
    .catch(e => {
      logEvent('tengu_feature_bad', {
        feature_name:
          'file_watcher_change_detected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'hook_exec_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      const msg = errorMessage(e)
      logForDebugging(`FileChanged hook failed: ${msg}`, {
        level: 'error',
      })
      notifyCallback?.(msg, true)
    })
}

export function updateWatchPaths(paths: string[]): void {
  if (!initialized) return
  // densable: store pre-filter dynamic list; resolveWatchPaths re-filters
  const sorted = paths.slice().sort()
  if (
    sorted.length === dynamicWatchPathsSorted.length &&
    sorted.every((p, i) => p === dynamicWatchPathsSorted[i])
  ) {
    return
  }
  dynamicWatchPaths = paths
  dynamicWatchPathsSorted = sorted
  restartWatching()
}

function restartWatching(): void {
  // densable teardown: null watcher ref before close so concurrent error/close
  // cannot double-close or race a fresh watcher.
  const previous = watcher
  watcher = null
  if (previous) {
    void previous.close()
  }
  const paths = resolveWatchPaths()
  if (paths.length > 0) {
    startWatching(paths)
  }
}

export async function onCwdChangedForHooks(
  oldCwd: string,
  newCwd: string,
): Promise<void> {
  if (oldCwd === newCwd) return

  // Re-evaluate from the current snapshot so mid-session hook changes are picked up
  const config = getHooksConfigFromSnapshot()
  const currentHasEnvHooks =
    (config?.CwdChanged?.length ?? 0) > 0 ||
    (config?.FileChanged?.length ?? 0) > 0
  if (!currentHasEnvHooks) return
  currentCwd = newCwd

  await clearCwdEnvFiles()
  const hookResult = await executeCwdChangedHooks(oldCwd, newCwd).catch(e => {
    const msg = errorMessage(e)
    logForDebugging(`CwdChanged hook failed: ${msg}`, {
      level: 'error',
    })
    notifyCallback?.(msg, true)
    return {
      results: [] as HookOutsideReplResult[],
      watchPaths: [] as string[],
      systemMessages: [] as string[],
    }
  })
  dynamicWatchPaths = hookResult.watchPaths
  dynamicWatchPathsSorted = hookResult.watchPaths.slice().sort()
  for (const msg of hookResult.systemMessages) {
    notifyCallback?.(msg, false)
  }
  for (const r of hookResult.results) {
    if (!r.succeeded && r.output) {
      notifyCallback?.(r.output, true)
    }
  }

  // Re-resolve matcher paths against the new cwd
  if (initialized) {
    restartWatching()
  }
}

function dispose(): void {
  const previous = watcher
  watcher = null
  if (previous) {
    void previous.close()
  }
  dynamicWatchPaths = []
  dynamicWatchPathsSorted = []
  initialized = false
  hasEnvHooks = false
  notifyCallback = null
}

export function resetFileChangedWatcherForTesting(): void {
  dispose()
}
