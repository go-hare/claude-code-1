import chokidar, { type FSWatcher } from 'chokidar'
import { watch as watchDirectory, type FSWatcher as DirectoryWatcher } from 'fs'
import { readdir, realpath, stat } from 'fs/promises'
import * as platformPath from 'path'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  type ConfigChangeSource,
  executeConfigChangeHooks,
  hasBlockingResult,
} from '../hooks.js'
import { createSignal } from '../signal.js'
import { SETTING_SOURCES, type SettingSource } from './constants.js'
import {
  probeNativeFileWatching,
  type FileWatchVerdict,
} from './fsWatchProbe.js'
import { clearInternalWrites, consumeInternalWrite } from './internalWrites.js'
import { getManagedSettingsDropInDir } from './managedPath.js'
import {
  getHkcuSettings,
  getMdmSettings,
  refreshMdmSettings,
  setMdmSettingsCache,
} from './mdm/settings.js'
import { getSettingsFilePathForSource } from './settings.js'
import { resetSettingsCache } from './settingsCache.js'

const FILE_STABILITY_THRESHOLD_MS = 1000
const FILE_STABILITY_POLL_INTERVAL_MS = 500
const INTERNAL_WRITE_WINDOW_MS = 5000
const DELETION_GRACE_MS =
  FILE_STABILITY_THRESHOLD_MS + FILE_STABILITY_POLL_INTERVAL_MS + 200
const WATCH_POLL_INTERVAL_MS = 2000
const MDM_POLL_INTERVAL_MS = 30 * 60 * 1000

let watcher: FSWatcher | null = null
let initialized = false
let disposed = false
// Never reuse a generation: asynchronous callbacks may outlive dispose/reset.
let watchGeneration = 0
let lifecycleGeneration = 0
let polling = false
let probing = false
let watchStartedAt: number | undefined
let catchUpSince: number | undefined
let mdmTimer: ReturnType<typeof setInterval> | undefined
let mdmSnapshot: string | undefined
let mdmRefreshing = false
let resolveReady: (() => void) | undefined
const pendingDeletions = new Map<string, ReturnType<typeof setTimeout>>()
let pendingDirs = new Set<string>()
const appearedDirs = new Set<string>()
const creationWatchers = new Map<string, { close(): void }>()
let directoryCheckTimer: ReturnType<typeof setInterval> | undefined
let realpathToCanonical = new Map<string, string>()
const closingWatchers = new Set<Promise<void>>()
let unregisterCleanup: (() => void) | undefined

export type SettingsChangeExtra = {
  prevCwd?: string
  trustFlip?: boolean
}
const settingsChanged =
  createSignal<[source: SettingSource, extra?: SettingsChangeExtra]>()

type TimingOverrides = {
  stabilityThreshold?: number
  pollInterval?: number
  deletionGrace?: number
  watchPollInterval?: number
  mdmPollInterval?: number
  fsWatchProbe?: () => Promise<FileWatchVerdict>
}
let testOverrides: TimingOverrides | null = null

type WatchTargets = {
  dirs: string[]
  settingsFiles: Set<string>
  pendingDirs: Set<string>
  dropInDir: string | null
  realpathToCanonical: Map<string, string>
}

function stabilityThreshold(): number {
  return testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS
}
function watchPollInterval(): number {
  return testOverrides?.watchPollInterval ?? WATCH_POLL_INTERVAL_MS
}
function deletionGrace(): number {
  const grace = testOverrides?.deletionGrace ?? DELETION_GRACE_MS
  return polling
    ? Math.max(grace, watchPollInterval() + stabilityThreshold() + 200)
    : grace
}
function closeWatcher(previous: FSWatcher): void {
  const closing = previous.close().catch(() => {})
  closingWatchers.add(closing)
  void closing.finally(() => closingWatchers.delete(closing))
}
function closeCreationWatchers(): void {
  if (directoryCheckTimer) clearInterval(directoryCheckTimer)
  directoryCheckTimer = undefined
  for (const w of creationWatchers.values()) w.close()
  creationWatchers.clear()
}

/** Official dVr.si — retarget, preserve directories discovered during rehome,
 * and backfill edits made before the replacement watcher's ready event. */
function attachWatchTargets(targets: WatchTargets, generation: number): void {
  if (disposed || generation !== watchGeneration) return
  const lifecycle = lifecycleGeneration
  const { dirs, settingsFiles, dropInDir } = targets
  realpathToCanonical = targets.realpathToCanonical
  for (const dir of pendingDirs) {
    if (!targets.pendingDirs.has(dir)) appearedDirs.add(dir)
  }
  pendingDirs = targets.pendingDirs
  watchStartedAt ??= Date.now()
  const previous = watcher
  watcher = null
  if (previous) closeWatcher(previous)
  resolveReady?.()
  resolveReady = undefined
  closeCreationWatchers()
  for (const dir of pendingDirs) watchForDirectory(dir)
  if (dirs.length === 0) {
    void catchUp(settingsFiles, Promise.resolve(), generation, lifecycle)
    if (!polling && pendingDirs.size > 0) probeNativeWatcher(lifecycle)
    return
  }
  const usesPolling = polling
  logForDebugging(
    `Watching for changes in setting files ${[...settingsFiles].join(', ')}...${dropInDir ? ` and drop-in directory ${dropInDir}` : ''}${usesPolling ? ` (polling every ${watchPollInterval()}ms)` : ''}`,
  )
  const current = chokidar.watch(dirs, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: stabilityThreshold(),
      pollInterval:
        testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS,
    },
    ignored: (path, stats) => {
      if (stats && !stats.isFile() && !stats.isDirectory()) return true
      if (path.split(/[/\\]/).some(dir => dir === '.git')) return true
      if (!stats || stats.isDirectory()) return false
      const normalized = platformPath.normalize(path)
      if (settingsFiles.has(normalized)) return false
      if (
        dropInDir &&
        platformPath.dirname(normalized) === dropInDir &&
        normalized.endsWith('.json')
      )
        return false
      return true
    },
    ignorePermissionErrors: true,
    ...(usesPolling
      ? {
          usePolling: true,
          interval: watchPollInterval(),
          binaryInterval: watchPollInterval(),
        }
      : { usePolling: false }),
    atomic: true,
  })
  watcher = current
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
    current.once('ready', resolve)
  })
  const isCurrent = () => !disposed && generation === watchGeneration
  current.on('change', path => {
    if (isCurrent()) handleChange(path)
  })
  current.on('unlink', path => {
    if (!isCurrent()) return
    // FSEvents may stop observing the old inode after unlink/atomic save.
    if (process.platform === 'darwin') current.add(platformPath.dirname(path))
    handleDelete(path)
  })
  current.on('add', path => {
    if (isCurrent()) handleAdd(path)
  })
  current.on('error', (err: unknown) => {
    if (!isCurrent()) return
    logForDebugging(`[settings] watcher error: ${errorMessage(err)}`, {
      level: 'warn',
    })
    if (!usesPolling) handleNativeWatchError(err)
  })
  void catchUp(settingsFiles, ready, generation, lifecycle)
  if (!usesPolling) probeNativeWatcher(lifecycle)
}

/** Official tc/ii/Nr: a silent or refused native watcher must fall back. */
function probeNativeWatcher(lifecycle: number): void {
  if (probing || polling || disposed) return
  probing = true
  void (testOverrides?.fsWatchProbe ?? probeNativeFileWatching)()
    .then(verdict => {
      if (disposed || lifecycle !== lifecycleGeneration) return
      probing = false
      if (verdict === 'silent' || verdict === 'refused') {
        switchToPolling(`fs_watch_${verdict}`)
      }
    })
    .catch(err => {
      if (disposed || lifecycle !== lifecycleGeneration) return
      probing = false
      logForDebugging(`[settings] watcher probe error: ${errorMessage(err)}`, {
        level: 'warn',
      })
    })
}
function handleNativeWatchError(err: unknown): void {
  if (!err || typeof err !== 'object') return
  const { code, syscall } = err as { code?: unknown; syscall?: unknown }
  if (
    (code === 'EMFILE' || code === 'ENFILE' || code === 'ENOSPC') &&
    (syscall === undefined || syscall === 'watch')
  )
    switchToPolling(`fs_watch_refused_late_${code.toLowerCase()}`)
}
function switchToPolling(reason: string): void {
  if (polling || disposed) return
  polling = true
  catchUpSince = (watchStartedAt ?? Date.now()) - 2000
  logForDebugging(
    `[settings] native file watching is not delivering events on this host (${reason}); polling settings files every ${watchPollInterval()}ms instead`,
    { level: 'warn' },
  )
  void rebuildWatchTargets()
}

/** Official ai/sc — wait for quiet files before replaying missed changes. */
async function catchUp(
  files: Set<string>,
  ready: Promise<void>,
  generation: number,
  lifecycle: number,
): Promise<void> {
  if (appearedDirs.size === 0 && catchUpSince === undefined) return
  await ready
  if (
    disposed ||
    generation !== watchGeneration ||
    lifecycle !== lifecycleGeneration
  )
    return
  // A replacement watcher may supersede this one before ready. Only the
  // current generation may consume pending catch-up work.
  const appeared = new Set(appearedDirs)
  const since = catchUpSince
  const candidates = new Set(files)
  const dropInDir = platformPath.normalize(getManagedSettingsDropInDir())
  if (appeared.has(dropInDir) || since !== undefined) {
    // Drop-ins have dynamic names. The pre-watch snapshot can be empty even
    // though files arrive before ready and are suppressed by ignoreInitial.
    // Enumerate again only after the replacement watcher has finished scanning.
    try {
      for (const name of await readdir(dropInDir)) {
        if (name.endsWith('.json'))
          candidates.add(platformPath.join(dropInDir, name))
      }
    } catch {
      // The directory can disappear again while the watcher is starting.
    }
  }
  await Promise.all(
    [...candidates]
      .filter(
        path => since !== undefined || appeared.has(platformPath.dirname(path)),
      )
      .map(async path => {
        try {
          let before = await stat(path)
          while (!disposed && generation === watchGeneration) {
            await new Promise(resolve =>
              setTimeout(resolve, stabilityThreshold()),
            )
            const after = await stat(path)
            if (
              disposed ||
              generation !== watchGeneration ||
              lifecycle !== lifecycleGeneration
            )
              return
            if (
              before.size === after.size &&
              before.mtimeMs === after.mtimeMs
            ) {
              if (
                after.isFile() &&
                (appeared.has(platformPath.dirname(path)) ||
                  (since !== undefined && after.mtimeMs >= since))
              )
                handleChange(path)
              return
            }
            before = after
          }
        } catch {
          // The file may disappear while waiting for stability.
        }
      }),
  )
  if (
    !disposed &&
    generation === watchGeneration &&
    lifecycle === lifecycleGeneration
  ) {
    for (const dir of appeared) appearedDirs.delete(dir)
    if (catchUpSince === since) catchUpSince = undefined
  }
}

function watchForDirectory(dir: string): void {
  // The private-file probe cannot attest delivery on every watched parent.
  // If a creation event is missed after the immediate absence check, native
  // mode otherwise has no way to discover this directory for the whole session.
  // Keep one unref'd recovery timer only while directories are pending.
  if (!directoryCheckTimer) {
    directoryCheckTimer = setInterval(() => {
      for (const pending of pendingDirs) void checkDirectory(pending)
    }, watchPollInterval())
    directoryCheckTimer.unref()
  }
  if (!polling) {
    const parent = platformPath.dirname(dir)
    if (!creationWatchers.has(parent)) {
      try {
        const w: DirectoryWatcher = watchDirectory(parent, (_event, name) => {
          for (const pending of pendingDirs) {
            if (
              platformPath.dirname(pending) === parent &&
              (name === null || name === platformPath.basename(pending))
            ) {
              void checkDirectory(pending)
            }
          }
        })
        w.on('error', err => {
          logForDebugging(
            `[settings] creation watcher error: ${errorMessage(err)}`,
            { level: 'warn' },
          )
          handleNativeWatchError(err)
        })
        creationWatchers.set(parent, w)
      } catch (err) {
        logForDebugging(
          `[settings] cannot watch ${parent}: ${errorMessage(err)}`,
          { level: 'warn' },
        )
        handleNativeWatchError(err)
      }
    }
  }
  void checkDirectory(dir)
}
async function checkDirectory(dir: string): Promise<void> {
  const lifecycle = lifecycleGeneration
  try {
    if (!(await stat(dir)).isDirectory()) return
  } catch {
    return
  }
  if (disposed || lifecycle !== lifecycleGeneration || !pendingDirs.delete(dir))
    return
  appearedDirs.add(dir)
  logForDebugging(`Settings directory ${dir} appeared; watching it`)
  await rebuildWatchTargets()
}
async function rebuildWatchTargets(): Promise<void> {
  const generation = ++watchGeneration
  const targets = await getWatchTargets()
  attachWatchTargets(targets, generation)
}

export async function initialize(): Promise<void> {
  if (getIsRemoteMode() || initialized || disposed) return
  initialized = true
  lifecycleGeneration++
  unregisterCleanup = registerCleanup(dispose)
  startMdmPolling()
  await rebuildWatchTargets()
}

export async function rehome(): Promise<void> {
  if (!initialized || disposed || getIsRemoteMode()) return
  for (const [path, timer] of pendingDeletions) {
    if (getSourceForPath(path) === undefined) {
      clearTimeout(timer)
      pendingDeletions.delete(path)
    }
  }
  await rebuildWatchTargets()
}

export async function dispose(): Promise<void> {
  disposed = true
  lifecycleGeneration++
  watchGeneration++
  unregisterCleanup?.()
  unregisterCleanup = undefined
  if (mdmTimer) clearInterval(mdmTimer)
  mdmTimer = undefined
  mdmSnapshot = undefined
  for (const timer of pendingDeletions.values()) clearTimeout(timer)
  pendingDeletions.clear()
  closeCreationWatchers()
  pendingDirs.clear()
  appearedDirs.clear()
  realpathToCanonical.clear()
  resolveReady?.()
  resolveReady = undefined
  clearInternalWrites()
  settingsChanged.clear()
  const previous = watcher
  watcher = null
  if (previous) closeWatcher(previous)
  await Promise.all(closingWatchers)
}

export const subscribe = settingsChanged.subscribe

/** Official Zi: watch existing directories even when their settings are absent;
 * watch a missing directory's parent until it appears. */
async function getWatchTargets(): Promise<WatchTargets> {
  const byDir = new Map<string, Set<string>>()
  const dirs = new Set<string>()
  const missing = new Set<string>()
  const aliases = new Map<string, string>()
  const files: string[] = []
  for (const source of SETTING_SOURCES) {
    if (source === 'flagSettings') continue
    const path = getSettingsFilePathForSource(source)
    if (path) files.push(platformPath.normalize(path))
  }
  const addFile = (dir: string, path: string) => {
    if (!byDir.has(dir)) byDir.set(dir, new Set())
    byDir.get(dir)!.add(path)
  }
  for (const path of files) {
    const dir = platformPath.dirname(path)
    addFile(dir, path)
    if (!dirs.has(dir) && !missing.has(dir)) {
      try {
        if ((await stat(dir)).isDirectory()) dirs.add(dir)
      } catch {
        try {
          if ((await stat(platformPath.dirname(dir))).isDirectory())
            missing.add(dir)
        } catch {
          /* No existing parent to watch. */
        }
      }
    }
    try {
      const target = platformPath.normalize(await realpath(path))
      const realDir = await realpath(dir)
      if (
        target === path ||
        platformPath.join(realDir, platformPath.basename(path)) === target
      )
        continue
      const targetDir = platformPath.dirname(target)
      const alias =
        targetDir === realDir
          ? platformPath.join(dir, platformPath.basename(target))
          : target
      if (files.includes(alias)) continue
      aliases.set(alias, path)
      addFile(platformPath.dirname(alias), alias)
      dirs.add(platformPath.dirname(alias))
    } catch {
      /* Missing files have no symlink target yet. */
    }
  }
  const settingsFiles = new Set<string>()
  for (const dir of dirs) {
    for (const file of byDir.get(dir) ?? []) settingsFiles.add(file)
  }
  const dropInDir = platformPath.normalize(getManagedSettingsDropInDir())
  let watchedDropIn: string | null = null
  try {
    if ((await stat(dropInDir)).isDirectory()) {
      dirs.add(dropInDir)
      watchedDropIn = dropInDir
      for (const name of await readdir(dropInDir)) {
        if (name.endsWith('.json'))
          settingsFiles.add(platformPath.join(dropInDir, name))
      }
    }
  } catch {
    try {
      if ((await stat(platformPath.dirname(dropInDir))).isDirectory())
        missing.add(dropInDir)
    } catch {
      /* Managed settings may not be installed on this machine. */
    }
  }
  return {
    dirs: [...dirs],
    settingsFiles,
    pendingDirs: missing,
    dropInDir: watchedDropIn,
    realpathToCanonical: aliases,
  }
}

function settingSourceToConfigChangeSource(
  source: SettingSource,
): ConfigChangeSource {
  switch (source) {
    case 'userSettings':
      return 'user_settings'
    case 'projectSettings':
      return 'project_settings'
    case 'localSettings':
      return 'local_settings'
    case 'flagSettings':
    case 'policySettings':
      return 'policy_settings'
  }
}
function canonicalPath(path: string): string {
  const normalized = platformPath.normalize(path)
  return realpathToCanonical.get(normalized) ?? normalized
}
function handleChange(path: string): void {
  if (disposed) return
  const canonical = canonicalPath(path)
  const source = getSourceForPath(canonical)
  if (!source) return
  const pending = pendingDeletions.get(canonical)
  if (pending) {
    clearTimeout(pending)
    pendingDeletions.delete(canonical)
  }
  if (consumeInternalWrite(canonical, INTERNAL_WRITE_WINDOW_MS)) return
  logForDebugging(`Detected change to ${canonical}`)
  applyExternalChange(source, canonical)
}
function handleAdd(path: string): void {
  handleChange(path)
}
function handleDelete(path: string): void {
  if (disposed) return
  const canonical = canonicalPath(path)
  const source = getSourceForPath(canonical)
  if (!source || pendingDeletions.has(canonical)) return
  logForDebugging(`Detected deletion of ${canonical}`)
  pendingDeletions.set(
    canonical,
    setTimeout(() => {
      pendingDeletions.delete(canonical)
      applyExternalChange(source, canonical)
    }, deletionGrace()),
  )
}
function applyExternalChange(source: SettingSource, path: string): void {
  const lifecycle = lifecycleGeneration
  void executeConfigChangeHooks(settingSourceToConfigChangeSource(source), path)
    .then(results => {
      if (disposed || lifecycle !== lifecycleGeneration) return
      if (hasBlockingResult(results)) {
        logForDebugging(`ConfigChange hook blocked change to ${path}`)
        return
      }
      fanOut(source)
    })
    .catch(err => {
      logForDebugging(`[settings] ConfigChange failed: ${errorMessage(err)}`, {
        level: 'warn',
      })
    })
}
function getSourceForPath(path: string): SettingSource | undefined {
  const normalized = platformPath.normalize(path)
  if (
    platformPath.dirname(normalized) ===
      platformPath.normalize(getManagedSettingsDropInDir()) &&
    normalized.endsWith('.json')
  )
    return 'policySettings'
  return SETTING_SOURCES.find(
    source => getSettingsFilePathForSource(source) === normalized,
  )
}

/** Official fc: refresh both OS policy caches before invalidating merged state.
 * Remote org policy remains deliberately outside this local watcher. */
function startMdmPolling(): void {
  mdmSnapshot = JSON.stringify({
    mdm: getMdmSettings(),
    hkcu: getHkcuSettings(),
  })
  const lifecycle = lifecycleGeneration
  mdmTimer = setInterval(() => {
    if (disposed || mdmRefreshing) return
    mdmRefreshing = true
    void refreshMdmSettings()
      .then(({ mdm, hkcu }) => {
        if (disposed || lifecycle !== lifecycleGeneration) return
        setMdmSettingsCache(mdm, hkcu)
        const snapshot = JSON.stringify({ mdm, hkcu })
        if (snapshot !== mdmSnapshot) {
          mdmSnapshot = snapshot
          logForDebugging('Detected MDM settings change via poll')
          fanOut('policySettings')
        }
      })
      .catch(err => {
        logForDebugging(`MDM poll error: ${errorMessage(err)}`)
      })
      .finally(() => {
        if (lifecycle === lifecycleGeneration) mdmRefreshing = false
      })
  }, testOverrides?.mdmPollInterval ?? MDM_POLL_INTERVAL_MS)
  mdmTimer.unref()
}

function fanOut(source: SettingSource, extra?: SettingsChangeExtra): void {
  resetSettingsCache()
  try {
    settingsChanged.emit(source, extra)
  } catch (err) {
    logForDebugging(`[settings] subscriber failed: ${errorMessage(err)}`, {
      level: 'warn',
    })
  }
}
export function notifyChange(
  source: SettingSource,
  extra?: SettingsChangeExtra,
): void {
  logForDebugging(`Programmatic settings change notification for ${source}`)
  fanOut(source, extra)
}

export async function resetForTesting(
  overrides?: TimingOverrides,
): Promise<void> {
  await dispose()
  initialized = false
  disposed = false
  polling = false
  probing = false
  watchStartedAt = undefined
  catchUpSince = undefined
  mdmRefreshing = false
  testOverrides = overrides ?? null
}
export const settingsChangeDetector = {
  initialize,
  dispose,
  rehome,
  subscribe,
  notifyChange,
  resetForTesting,
}
