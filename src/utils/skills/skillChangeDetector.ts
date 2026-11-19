import chokidar, { type FSWatcher } from 'chokidar'
import * as platformPath from 'path'
import {
  getAdditionalDirectoriesForClaudeMd,
  getLastInteractionTime,
} from '../../bootstrap/state.js'
import {
  clearCommandMemoizationCaches,
  clearCommandsCache,
  getCommands,
} from '../../commands.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  clearSkillCaches,
  getSkillsPath,
  onDynamicSkillsLoaded,
  refreshMovedDirectorySkills,
} from '../../skills/loadSkillsDir.js'
import { clearAgentDefinitionsCache } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { forgetSentSkillNames, resetSentSkillNames } from '../attachments.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getFsImplementation } from '../fsOperations.js'
import { executeConfigChangeHooks, hasBlockingResult } from '../hooks.js'
import { createSignal } from '../signal.js'
import { sleep } from '../sleep.js'
import {
  filterWatchedModDirs,
  isPluginDirWatchDisabledByEnv,
} from '../plugins/pluginDevMods.js'

/**
 * Time in milliseconds to wait for file writes to stabilize before processing.
 * densable joS = 1000
 */
const FILE_STABILITY_THRESHOLD_MS = 1000

/**
 * Polling interval in milliseconds for checking file stability.
 * densable GoS = 500
 */
const FILE_STABILITY_POLL_INTERVAL_MS = 500

/**
 * Debounce rapid skill change events into a single reload.
 * densable WoS = 300
 */
const RELOAD_DEBOUNCE_MS = 300

/**
 * Active chokidar poll interval.
 * densable VoS = 2000
 */
const POLLING_INTERVAL_MS = 2000

/**
 * Idle chokidar poll interval (session idle).
 * densable zoS = 30000
 */
const IDLE_POLLING_INTERVAL_MS = 30_000

/**
 * Idle threshold: no interaction for this long → switch to idle poll interval.
 * densable KoS = 60000
 */
const IDLE_THRESHOLD_MS = 60_000

/**
 * densable bGa — synthetic path for idle→active wake reloads.
 */
const SKILL_WATCHER_IDLE_WAKE = '<skill-watcher-idle-wake>'

/**
 * How often to evaluate idle/active poll transition.
 * densable YoS = 10000
 */
const IDLE_CHECK_INTERVAL_MS = 10_000

/**
 * densable fOf — always usePolling in official SEA for skill watcher.
 */
const USE_POLLING = true

type Fingerprint = Map<string, string>

type SkillChangeDetectorDeps = {
  stabilityThreshold?: number
  pollInterval?: number
  reloadDebounce?: number
  chokidarInterval?: number
  idleChokidarInterval?: number
  getFingerprint?: () => Promise<Fingerprint>
  now?: () => number
  lastInteractionTime?: () => number
  dirExists?: (dirPath: string) => Promise<boolean>
}

let watcher: FSWatcher | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let idleCheckTimer: ReturnType<typeof setInterval> | null = null
/** #1863: Directories observed removed via `unlinkDir`, mapped to whether they were seen present on the prior poll. */
const missingDirs = new Map<string, boolean>()
let missingDirTimer: ReturnType<typeof setTimeout> | null = null
let watcherHealthy = false
const pendingChangedPaths = new Set<string>()
let initialized = false
let disposed = false
let isIdle = false
let lastFingerprint: Fingerprint | null = null
let watchedPaths: string[] = []
/** densable XoS `_` — generation so a stale rehome cannot replace a newer watch. */
let watchGeneration = 0
let dynamicSkillsCallbackRegistered = false
let unregisterCleanup: (() => void) | null = null
let unregisterDynamicSkills: (() => void) | null = null
let unregisterInvalidation: (() => void) | null = null
const skillsChanged = createSignal()

// densable U7 — external skill-list invalidation (plugin reload, --add-dir, etc.)
const skillInvalidation = createSignal()
export const notifySkillsInvalidated = skillInvalidation.emit

let testOverrides: SkillChangeDetectorDeps | null = null

async function defaultGetFingerprint(): Promise<Fingerprint> {
  // densable JoS: Map of command name → contentHash (prompt) or ""
  const commands = await getCommands(process.cwd())
  const map: Fingerprint = new Map()
  for (const cmd of commands) {
    map.set(cmd.name, cmd.type === 'prompt' ? (cmd.contentHash ?? '') : '')
  }
  return map
}

/**
 * Initialize file watching for skill/command/agent directories.
 * densable XoS().initialize (w)
 */
export async function initialize(): Promise<void> {
  if (initialized || disposed) return
  initialized = true
  watchGeneration++

  // densable: if (!E) E = Tmd(() => { wZ(); l.emit() })
  if (!dynamicSkillsCallbackRegistered) {
    dynamicSkillsCallbackRegistered = true
    unregisterDynamicSkills = onDynamicSkillsLoaded(() => {
      clearCommandMemoizationCaches()
      skillsChanged.emit()
    })
  }

  // densable U7.subscribe(() => l.emit())
  if (!unregisterInvalidation) {
    unregisterInvalidation = skillInvalidation.subscribe(() => {
      skillsChanged.emit()
    })
  }

  const paths = await getWatchablePaths()
  // #1952: In headless sessions, `.claude/skills` mod folders watch by default;
  // setting `CLAUDE_CODE_PLUGIN_DIR_WATCH=0` disables mod-dir watching.
  const filteredPaths = isPluginDirWatchDisabledByEnv()
    ? paths.filter(p => !p.endsWith(`${platformPath.sep}skills`))
    : filterWatchedModDirs(paths, { skillModDirs: paths })
  watchedPaths = filteredPaths
  if (filteredPaths.length === 0) return

  const getFingerprint = testOverrides?.getFingerprint ?? defaultGetFingerprint
  lastFingerprint = await getFingerprint().catch(() => null)

  logForDebugging(
    `Watching for changes in skill/command directories: ${filteredPaths.join(', ')}...`,
  )

  const chokidarInterval =
    testOverrides?.chokidarInterval ?? POLLING_INTERVAL_MS
  watcher = createWatcher(chokidarInterval)

  // densable: if (fOf) p = setInterval(I, YoS)
  idleCheckTimer = setInterval(checkIdleTransition, IDLE_CHECK_INTERVAL_MS)
  idleCheckTimer.unref?.()

  unregisterCleanup = registerCleanup(async () => {
    await dispose()
  })
}

/**
 * Official `ignored` predicate for skill/command chokidar watcher (#1415):
 * ignores non-file/dir/symlink entries, `.git` segments, `~/.claude/skills/.trash`,
 * and regular files not ending in `.md`.
 */
export function shouldIgnoreSkillWatchPath(
  filePath: string,
  stats:
    | { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }
    | undefined,
  userSkillsDir: string = platformPath.join(getClaudeConfigHomeDir(), 'skills'),
): boolean {
  if (
    stats &&
    !stats.isFile() &&
    !stats.isDirectory() &&
    !stats.isSymbolicLink()
  ) {
    return true
  }
  if (filePath.split(/[/\\]/).some(dir => dir === '.git')) return true
  if (
    platformPath
      .relative(userSkillsDir, filePath)
      .split(platformPath.sep)[0] === '.trash'
  ) {
    return true
  }
  if (stats?.isFile()) return !filePath.endsWith('.md')
  return false
}

async function defaultDirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await getFsImplementation().stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function getActivePollInterval(): number {
  return isIdle
    ? (testOverrides?.idleChokidarInterval ?? IDLE_POLLING_INTERVAL_MS)
    : (testOverrides?.chokidarInterval ?? POLLING_INTERVAL_MS)
}

function markRecoveredDir(dirPath: string): void {
  missingDirs.delete(dirPath)
  handleChange(dirPath)
}

/**
 * #1863 (2.1.321): Record a watched directory that was unlinked (e.g. during
 * `git stash` or worktree switch) and poll until it reappears, rebuilding the
 * watcher and triggering a skill/command/agent reload when it comes back.
 */
function handleWatchedDirUnlinked(dirPath: string): boolean {
  const matched = watchedPaths.find(
    p => platformPath.resolve(p) === platformPath.resolve(dirPath),
  )
  if (matched === undefined) {
    return false
  }
  watcherHealthy = false
  missingDirs.set(matched, false)
  scheduleMissingDirPoll()
  return true
}

function scheduleMissingDirPoll(): void {
  if (missingDirTimer) {
    clearTimeout(missingDirTimer)
    missingDirTimer = null
  }
  if (disposed || missingDirs.size === 0) {
    return
  }
  const interval = getActivePollInterval()
  const dirExists = testOverrides?.dirExists ?? defaultDirExists
  const timer = setTimeout(async () => {
    if (missingDirTimer !== timer || disposed) {
      return
    }
    const present = new Set<string>()
    for (const dir of missingDirs.keys()) {
      if (await dirExists(dir)) {
        present.add(dir)
      }
    }
    if (missingDirTimer !== timer || disposed) {
      return
    }
    const watched = watcher?.getWatched() ?? {}
    let needsRebuild = false
    for (const [dir, wasPresent] of [...missingDirs.entries()]) {
      const existsNow = present.has(dir)
      if (existsNow && !(wasPresent && platformPath.resolve(dir) in watched)) {
        needsRebuild = true
      }
      if (wasPresent && existsNow) {
        markRecoveredDir(dir)
      } else {
        missingDirs.set(dir, existsNow)
      }
    }
    if (needsRebuild) {
      if (watcher) {
        void watcher.close().catch(err => {
          logForDebugging(
            `skillChangeDetector: could not close a watcher; went on without closing it: ${errorMessage(err)}`,
            { level: 'warn' },
          )
        })
      }
      watcher = createWatcher(interval)
    } else {
      scheduleMissingDirPoll()
    }
  }, interval)
  timer.unref?.()
  missingDirTimer = timer
}

function createWatcher(interval: number): FSWatcher {
  watcherHealthy = false
  scheduleMissingDirPoll()
  const stabilityThreshold =
    testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS
  const pollInterval =
    testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS
  const userSkillsDir = platformPath.join(getClaudeConfigHomeDir(), 'skills')

  const w = chokidar.watch(watchedPaths, {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval,
    },
    // densable ignored: non-file/dir/symlink; .git; .trash; files not ending in .md
    ignored: (path, stats) =>
      shouldIgnoreSkillWatchPath(path, stats, userSkillsDir),
    ignorePermissionErrors: true,
    usePolling: USE_POLLING,
    interval,
    binaryInterval: interval,
    atomic: true,
  })

  w.on('add', handleChange)
  w.on('change', handleChange)
  w.on('unlink', handleChange)
  let sawUnlinkDir = false
  w.on('unlinkDir', (dirPath: string) => {
    if (handleWatchedDirUnlinked(dirPath)) {
      sawUnlinkDir = true
    }
  })
  w.once('ready', () => {
    const watched = w.getWatched()
    watcherHealthy =
      !sawUnlinkDir &&
      watchedPaths.every(p => platformPath.resolve(p) in watched)
    if (watcherHealthy) {
      for (const dir of [...missingDirs.keys()]) {
        markRecoveredDir(dir)
      }
      if (missingDirTimer) {
        clearTimeout(missingDirTimer)
        missingDirTimer = null
      }
    }
  })
  w.on('error', (err: unknown) => {
    logForDebugging(`[skills] watcher error: ${errorMessage(err)}`, {
      level: 'warn',
    })
  })
  return w
}

/**
 * densable XoS I — idle/active poll interval switch.
 */
function checkIdleTransition(): void {
  if (disposed || !watcher) return
  const now = testOverrides?.now ?? Date.now
  const lastInteraction =
    testOverrides?.lastInteractionTime ?? getLastInteractionTime
  const nextIdle = now() - lastInteraction() > IDLE_THRESHOLD_MS
  if (nextIdle === isIdle) return
  isIdle = nextIdle
  const interval = nextIdle ? IDLE_POLLING_INTERVAL_MS : POLLING_INTERVAL_MS
  logForDebugging(
    `[skills] ${nextIdle ? 'idle' : 'active'} — switching poll interval to ${interval}ms`,
  )
  void watcher.close()
  watcher = createWatcher(interval)
  // densable: if (!P) H(bGa)
  if (!nextIdle) {
    scheduleReload(SKILL_WATCHER_IDLE_WAKE)
  }
}

/**
 * densable XoS `he` — unique paths, first-seen order.
 */
function uniqueWatchPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/**
 * densable XoS `Pe` — after `/cd`, union old + new skill/command/agent dirs
 * and retarget the watcher. No-ops when the new cwd's dirs are already
 * watched (union length unchanged). Does not drop previously watched paths.
 */
export async function rehome(): Promise<void> {
  if (!initialized || disposed) return
  const next = await getWatchablePaths()
  if (disposed) return
  const merged = uniqueWatchPaths([...watchedPaths, ...next])
  if (merged.length === watchedPaths.length) return
  const generation = ++watchGeneration
  watchedPaths = merged
  logForDebugging(
    `[skills] session moved — watching skill/command directories: ${watchedPaths.join(', ')}`,
  )
  if (watcher) void watcher.close()
  watcher = createWatcher(
    isIdle ? IDLE_POLLING_INTERVAL_MS : POLLING_INTERVAL_MS,
  )
  const attached = watcher
  const ready = new Promise<void>(resolve => {
    attached.once('ready', () => resolve())
  })
  await Promise.race([ready, sleep(2000, undefined, { unref: true })])
  if (disposed || generation !== watchGeneration) return
  if (USE_POLLING && idleCheckTimer === null) {
    idleCheckTimer = setInterval(checkIdleTransition, IDLE_CHECK_INTERVAL_MS)
    idleCheckTimer.unref?.()
  }
}

/**
 * densable XoS D — dispose
 */
export function dispose(): Promise<void> {
  disposed = true
  if (unregisterCleanup) {
    unregisterCleanup()
    unregisterCleanup = null
  }
  if (unregisterDynamicSkills) {
    unregisterDynamicSkills()
    unregisterDynamicSkills = null
  }
  if (unregisterInvalidation) {
    unregisterInvalidation()
    unregisterInvalidation = null
  }
  if (idleCheckTimer) {
    clearInterval(idleCheckTimer)
    idleCheckTimer = null
  }
  if (missingDirTimer) {
    clearTimeout(missingDirTimer)
    missingDirTimer = null
  }
  missingDirs.clear()
  watcherHealthy = false
  let closePromise: Promise<void> = Promise.resolve()
  if (watcher) {
    closePromise = watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  pendingChangedPaths.clear()
  skillsChanged.clear()
  // Keep skillInvalidation listeners across dispose only if re-init expected;
  // densable D clears l (skillsChanged) and c() (U7 unsub), not U7 itself.
  return closePromise
}

export const subscribe = skillsChanged.subscribe

/**
 * densable QoS — watchable paths including agents dirs.
 */
async function getWatchablePaths(): Promise<string[]> {
  const fs = getFsImplementation()
  const paths: string[] = []

  async function tryPush(
    path: string | undefined,
    resolve = false,
  ): Promise<void> {
    if (!path) return
    try {
      const absolute = resolve ? platformPath.resolve(path) : path
      await fs.stat(absolute)
      paths.push(absolute)
    } catch {
      // missing — skip
    }
  }

  // User skills / commands / agents (~/.claude/{skills,commands,agents})
  await tryPush(getSkillsPath('userSettings', 'skills'))
  await tryPush(getSkillsPath('userSettings', 'commands'))
  await tryPush(platformPath.join(getClaudeConfigHomeDir(), 'agents'))

  // Project skills / commands / agents (.claude/{skills,commands,agents})
  await tryPush(getSkillsPath('projectSettings', 'skills'), true)
  await tryPush(getSkillsPath('projectSettings', 'commands'), true)
  await tryPush('.claude/agents', true)

  // Additional directories (--add-dir) skills
  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    await tryPush(platformPath.join(dir, '.claude', 'skills'))
  }

  return paths
}

function handleChange(path: string): void {
  logForDebugging(`Detected skill change: ${path}`)
  logEvent('tengu_skill_file_changed', {
    source:
      'chokidar' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  scheduleReload(path)
}

/**
 * densable XoS H — debounce + fingerprint + ConfigChange.
 *
 * densable order after debounce:
 *   xLt(); fingerprint; if null → $2/poe/emit;
 *   if unchanged && idle-wake → poe; return;
 *   $2(); poe(); if unchanged log skip re-announce else oNs(delta)+update fp;
 *   emit always (except idle-wake+unchanged early return).
 */
function scheduleReload(changedPath: string): void {
  pendingChangedPaths.add(changedPath)
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(async () => {
    reloadTimer = null
    const paths = [...pendingChangedPaths]
    pendingChangedPaths.clear()

    const idleWakeOnly =
      paths.length === 1 && paths[0] === SKILL_WATCHER_IDLE_WAKE
    if (!idleWakeOnly) {
      const representative =
        paths.find(p => p !== SKILL_WATCHER_IDLE_WAKE) ?? paths[0]!
      const results = await executeConfigChangeHooks('skills', representative)
      if (hasBlockingResult(results)) {
        logForDebugging(
          `ConfigChange hook blocked skill reload (${paths.length} paths)`,
        )
        return
      }
    }

    // densable xLt — clear skill caches + command memo (ALt) before fingerprint
    // so JoS/getCommands re-reads disk rather than returning stale memoized skills.
    clearSkillCaches()
    clearCommandMemoizationCaches()

    const getFingerprint =
      testOverrides?.getFingerprint ?? defaultGetFingerprint
    const next = await getFingerprint().catch(() => null)

    if (next === null) {
      clearCommandsCache()
      // densable poe ≈ agent cache clear + sent-skill reset
      clearAgentDefinitionsCache()
      resetSentSkillNames()
      skillsChanged.emit()
      return
    }

    const unchanged =
      lastFingerprint !== null &&
      next.size === lastFingerprint.size &&
      [...lastFingerprint].every(([k, v]) => next.get(k) === v)

    // densable: if (q && F) { poe(); return }
    if (unchanged && idleWakeOnly) {
      clearAgentDefinitionsCache()
      resetSentSkillNames()
      return
    }

    // densable always $2() + poe() + hZc/`ke` here, then maybe skip re-announce
    clearCommandsCache()
    clearAgentDefinitionsCache()
    await refreshMovedDirectorySkills().catch(e => {
      logForDebugging(
        `[skills] re-reading the moved directory's skills failed: ${errorMessage(e)}`,
        { level: 'warn' },
      )
    })

    if (unchanged) {
      logForDebugging(
        `[skills] ${paths.length} fs event(s) but skill list unchanged — skipping re-announce`,
      )
      resetSentSkillNames()
    } else {
      if (lastFingerprint !== null) {
        const changedNames = [...lastFingerprint]
          .filter(([k, v]) => next.get(k) !== v)
          .map(([k]) => k)
        if (changedNames.length > 0) {
          forgetSentSkillNames(changedNames)
        } else {
          resetSentSkillNames()
        }
      } else {
        resetSentSkillNames()
      }
      lastFingerprint = next
    }
    skillsChanged.emit()
  }, testOverrides?.reloadDebounce ?? RELOAD_DEBOUNCE_MS)
}

/**
 * densable XoS._checkIdleTransitionForTest
 */
export function _checkIdleTransitionForTest(): void {
  checkIdleTransition()
}

/**
 * #1863 test helper: simulate an `unlinkDir` event on a watched directory.
 */
export function _simulateUnlinkDirForTest(dirPath: string): boolean {
  return handleWatchedDirUnlinked(dirPath)
}

/**
 * #1863 test helper: inspect missingDirs state.
 */
export function _getMissingDirsForTest(): Map<string, boolean> {
  return new Map(missingDirs)
}

/**
 * Reset internal state for testing purposes only.
 */
export async function resetForTesting(
  overrides?: SkillChangeDetectorDeps,
): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  if (idleCheckTimer) {
    clearInterval(idleCheckTimer)
    idleCheckTimer = null
  }
  if (missingDirTimer) {
    clearTimeout(missingDirTimer)
    missingDirTimer = null
  }
  missingDirs.clear()
  watcherHealthy = false
  pendingChangedPaths.clear()
  skillsChanged.clear()
  lastFingerprint = null
  watchedPaths = []
  watchGeneration = 0
  isIdle = false
  initialized = false
  disposed = false
  testOverrides = overrides ?? null
}

export const skillChangeDetector = {
  initialize,
  dispose,
  rehome,
  subscribe,
  resetForTesting,
  _checkIdleTransitionForTest,
  _simulateUnlinkDirForTest,
  _getMissingDirsForTest,
  notifySkillsInvalidated,
}
