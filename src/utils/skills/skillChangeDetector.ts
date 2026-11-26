import { clearAgentDefinitionsCache } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
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
import { forgetSentSkillNames, resetSentSkillNames } from '../attachments.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { executeConfigChangeHooks, hasBlockingResult } from '../hooks.js'
import {
  filterWatchedModDirs,
  isPluginDirWatchDisabledByEnv,
} from '../plugins/pluginDevMods.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
  runWithSession,
} from '../sessionHost.js'
import type { Session } from '../sessionRoot.js'
import { createSignal, type Signal } from '../signal.js'
import { sleep } from '../sleep.js'

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

type HostSkillChangeDetectorState = {
  watcher: FSWatcher | null
  /** Official 2.1.326 #129: parent-directory watcher for not-yet-created `.claude/{skills,commands,agents}` folders. */
  parentWatcher: FSWatcher | null
  watchedParentDirs: string[]
  reloadTimer: ReturnType<typeof setTimeout> | null
  idleCheckTimer: ReturnType<typeof setInterval> | null
  /** #1863: Directories observed removed via `unlinkDir`, mapped to whether they were seen present on the prior poll. */
  missingDirs: Map<string, boolean>
  missingDirTimer: ReturnType<typeof setTimeout> | null
  watcherHealthy: boolean
  pendingChangedPaths: Set<string>
  initialized: boolean
  disposed: boolean
  isIdle: boolean
  lastFingerprint: Fingerprint | null
  watchedPaths: string[]
  /** densable XoS `_` — generation so a stale rehome cannot replace a newer watch. */
  watchGeneration: number
  dynamicSkillsCallbackRegistered: boolean
  unregisterCleanup: (() => void) | null
  unregisterDynamicSkills: (() => void) | null
  unregisterInvalidation: (() => void) | null
  skillsChanged: Signal
  // densable U7 — external skill-list invalidation (plugin reload, --add-dir, etc.)
  skillInvalidation: Signal
  testOverrides: SkillChangeDetectorDeps | null
  sessionRef: WeakRef<Session> | null
}

const hostSkillChangeDetectorSlot = new HostSlot<HostSkillChangeDetectorState>(
  () => ({
    watcher: null,
    parentWatcher: null,
    watchedParentDirs: [],
    reloadTimer: null,
    idleCheckTimer: null,
    missingDirs: new Map(),
    missingDirTimer: null,
    watcherHealthy: false,
    pendingChangedPaths: new Set(),
    initialized: false,
    disposed: false,
    isIdle: false,
    lastFingerprint: null,
    watchedPaths: [],
    watchGeneration: 0,
    dynamicSkillsCallbackRegistered: false,
    unregisterCleanup: null,
    unregisterDynamicSkills: null,
    unregisterInvalidation: null,
    skillsChanged: createSignal(),
    skillInvalidation: createSignal(),
    testOverrides: null,
    sessionRef: null,
  }),
)

function getHostSkillChangeDetectorState(): HostSkillChangeDetectorState {
  return hostSkillChangeDetectorSlot.of(getBootstrapSessionHost())
}

function resolveDetectorCwd(): string {
  return hasActiveSessionAls() ? getCwd() : process.cwd()
}

function captureRootSessionRef(state: HostSkillChangeDetectorState): void {
  const currentSession = getBootstrapSession()
  state.sessionRef = new WeakRef(currentSession.root ?? currentSession)
}

function runInStateSession(
  state: HostSkillChangeDetectorState,
  fn: () => void,
): void {
  const targetSession = state.sessionRef?.deref()
  if (!targetSession) {
    void disposeState(state)
    return
  }
  runWithSession(targetSession, fn)
}

function registerWeakSkillWatcherCleanup(
  state: HostSkillChangeDetectorState,
): () => void {
  const stateRef = new WeakRef(state)
  return registerCleanup(async () => {
    const target = stateRef.deref()
    if (target) {
      await disposeState(target)
    }
  })
}

export function notifySkillsInvalidated(): void {
  getHostSkillChangeDetectorState().skillInvalidation.emit()
}

async function defaultGetFingerprint(): Promise<Fingerprint> {
  // densable JoS: Map of command name → contentHash (prompt) or ""
  const commands = await getCommands(getCwd())
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
  const state = getHostSkillChangeDetectorState()
  if (state.initialized || state.disposed) return
  state.initialized = true
  state.watchGeneration++
  captureRootSessionRef(state)

  // densable: if (!E) E = Tmd(() => { wZ(); l.emit() })
  if (!state.dynamicSkillsCallbackRegistered) {
    state.dynamicSkillsCallbackRegistered = true
    state.unregisterDynamicSkills = onDynamicSkillsLoaded(() => {
      clearCommandMemoizationCaches()
      state.skillsChanged.emit()
    })
  }

  // densable U7.subscribe(() => l.emit())
  if (!state.unregisterInvalidation) {
    state.unregisterInvalidation = state.skillInvalidation.subscribe(() => {
      state.skillsChanged.emit()
    })
  }

  const paths = await getWatchablePaths()
  // #1952: In headless sessions, `.claude/skills` mod folders watch by default;
  // setting `CLAUDE_CODE_PLUGIN_DIR_WATCH=0` disables mod-dir watching.
  const filteredPaths = isPluginDirWatchDisabledByEnv()
    ? paths.filter(p => !p.endsWith(`${platformPath.sep}skills`))
    : filterWatchedModDirs(paths, { skillModDirs: paths })
  state.watchedPaths = filteredPaths

  const getFingerprint =
    state.testOverrides?.getFingerprint ?? defaultGetFingerprint
  state.lastFingerprint = await getFingerprint().catch(() => null)

  const chokidarInterval =
    state.testOverrides?.chokidarInterval ?? POLLING_INTERVAL_MS

  if (filteredPaths.length > 0) {
    logForDebugging(
      `Watching for changes in skill/command directories: ${filteredPaths.join(', ')}...`,
    )
    state.watcher = createWatcher(state, chokidarInterval)
  }

  // Official 2.1.326 #129: watch parent directories of any candidate
  // `.claude/{skills,commands,agents}` folders that do not exist yet, so the
  // first skill, command, or agent created during a session is discovered right away.
  await refreshParentWatcher(state, chokidarInterval)

  // densable: if (fOf) p = setInterval(I, YoS)
  state.idleCheckTimer = setInterval(() => {
    runInStateSession(state, () => {
      checkIdleTransition(state)
      void discoverNewlyCreatedSkillDirs()
    })
  }, IDLE_CHECK_INTERVAL_MS)
  state.idleCheckTimer.unref?.()

  state.unregisterCleanup = registerWeakSkillWatcherCleanup(state)
}

/**
 * Official `ignored` predicate for skill/command chokidar watcher (#1415):
 * ignores non-file/dir/symlink entries, `.git` segments, `~/.claude/skills/.trash`,
 * and regular files not ending in `.md`.
 */
export function shouldIgnoreSkillWatchPath(
  path: string,
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
  if (path.split(/[/\\]/).some(dir => dir === '.git')) return true
  if (
    platformPath.relative(userSkillsDir, path).split(platformPath.sep)[0] ===
    '.trash'
  ) {
    return true
  }
  if (stats?.isFile()) return !path.endsWith('.md')
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

function getActivePollInterval(state: HostSkillChangeDetectorState): number {
  return state.isIdle
    ? (state.testOverrides?.idleChokidarInterval ?? IDLE_POLLING_INTERVAL_MS)
    : (state.testOverrides?.chokidarInterval ?? POLLING_INTERVAL_MS)
}

function markRecoveredDir(
  state: HostSkillChangeDetectorState,
  dirPath: string,
): void {
  state.missingDirs.delete(dirPath)
  handleChange(state, dirPath)
}

/**
 * #1863 (2.1.321): Record a watched directory that was unlinked (e.g. during
 * `git stash` or worktree switch) and poll until it reappears, rebuilding the
 * watcher and triggering a skill/command/agent reload when it comes back.
 */
function handleWatchedDirUnlinked(
  state: HostSkillChangeDetectorState,
  dirPath: string,
): boolean {
  const matched = state.watchedPaths.find(
    p => platformPath.resolve(p) === platformPath.resolve(dirPath),
  )
  if (matched === undefined) {
    return false
  }
  state.watcherHealthy = false
  state.missingDirs.set(matched, false)
  scheduleMissingDirPoll(state)
  return true
}

function scheduleMissingDirPoll(state: HostSkillChangeDetectorState): void {
  if (state.missingDirTimer) {
    clearTimeout(state.missingDirTimer)
    state.missingDirTimer = null
  }
  if (state.disposed || state.missingDirs.size === 0) {
    return
  }
  captureRootSessionRef(state)
  const interval = getActivePollInterval(state)
  const dirExists = state.testOverrides?.dirExists ?? defaultDirExists
  const timer = setTimeout(() => {
    runInStateSession(state, () => {
      void (async () => {
        if (state.missingDirTimer !== timer || state.disposed) {
          return
        }
        const present = new Set<string>()
        for (const dir of state.missingDirs.keys()) {
          if (await dirExists(dir)) {
            present.add(dir)
          }
        }
        if (state.missingDirTimer !== timer || state.disposed) {
          return
        }
        const watched = state.watcher?.getWatched() ?? {}
        let needsRebuild = false
        for (const [dir, wasPresent] of [...state.missingDirs.entries()]) {
          const existsNow = present.has(dir)
          if (
            existsNow &&
            !(wasPresent && platformPath.resolve(dir) in watched)
          ) {
            needsRebuild = true
          }
          if (wasPresent && existsNow) {
            markRecoveredDir(state, dir)
          } else {
            state.missingDirs.set(dir, existsNow)
          }
        }
        if (needsRebuild) {
          if (state.watcher) {
            void state.watcher.close().catch(err => {
              logForDebugging(
                `skillChangeDetector: could not close a watcher; went on without closing it: ${errorMessage(err)}`,
                { level: 'warn' },
              )
            })
          }
          state.watcher = createWatcher(state, interval)
        } else {
          scheduleMissingDirPoll(state)
        }
      })()
    })
  }, interval)
  timer.unref?.()
  state.missingDirTimer = timer
}

function createWatcher(
  state: HostSkillChangeDetectorState,
  interval: number,
): FSWatcher {
  captureRootSessionRef(state)
  state.watcherHealthy = false
  scheduleMissingDirPoll(state)
  const stabilityThreshold =
    state.testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS
  const pollInterval =
    state.testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS
  const userSkillsDir = platformPath.join(getClaudeConfigHomeDir(), 'skills')

  const w = chokidar.watch(state.watchedPaths, {
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

  w.on('add', p => runInStateSession(state, () => handleChange(state, p)))
  w.on('change', p => runInStateSession(state, () => handleChange(state, p)))
  w.on('unlink', p => runInStateSession(state, () => handleChange(state, p)))
  let sawUnlinkDir = false
  w.on('unlinkDir', (dirPath: string) => {
    runInStateSession(state, () => {
      if (handleWatchedDirUnlinked(state, dirPath)) {
        sawUnlinkDir = true
      }
    })
  })
  w.once('ready', () => {
    runInStateSession(state, () => {
      const watched = w.getWatched()
      state.watcherHealthy =
        !sawUnlinkDir &&
        state.watchedPaths.every(p => platformPath.resolve(p) in watched)
      if (state.watcherHealthy) {
        for (const dir of [...state.missingDirs.keys()]) {
          markRecoveredDir(state, dir)
        }
        if (state.missingDirTimer) {
          clearTimeout(state.missingDirTimer)
          state.missingDirTimer = null
        }
      }
    })
  })
  w.on('error', (err: unknown) => {
    runInStateSession(state, () => {
      logForDebugging(`[skills] watcher error: ${errorMessage(err)}`, {
        level: 'warn',
      })
    })
  })
  return w
}

/**
 * densable XoS I — idle/active poll interval switch.
 */
function checkIdleTransition(state: HostSkillChangeDetectorState): void {
  if (state.disposed || !state.watcher) return
  const now = state.testOverrides?.now ?? Date.now
  const lastInteraction =
    state.testOverrides?.lastInteractionTime ?? getLastInteractionTime
  const nextIdle = now() - lastInteraction() > IDLE_THRESHOLD_MS
  if (nextIdle === state.isIdle) return
  state.isIdle = nextIdle
  const interval = nextIdle ? IDLE_POLLING_INTERVAL_MS : POLLING_INTERVAL_MS
  logForDebugging(
    `[skills] ${nextIdle ? 'idle' : 'active'} — switching poll interval to ${interval}ms`,
  )
  void state.watcher.close()
  state.watcher = createWatcher(state, interval)
  // densable: if (!P) H(bGa)
  if (!nextIdle) {
    scheduleReload(state, SKILL_WATCHER_IDLE_WAKE)
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
  const state = getHostSkillChangeDetectorState()
  if (!state.initialized || state.disposed) return
  captureRootSessionRef(state)
  const next = await getWatchablePaths()
  if (state.disposed) return
  const merged = uniqueWatchPaths([...state.watchedPaths, ...next])
  const interval = getActivePollInterval(state)
  await refreshParentWatcher(state, interval)
  if (merged.length === state.watchedPaths.length) return
  const generation = ++state.watchGeneration
  state.watchedPaths = merged
  logForDebugging(
    `[skills] session moved — watching skill/command directories: ${state.watchedPaths.join(', ')}`,
  )
  if (state.watcher) void state.watcher.close()
  state.watcher = createWatcher(state, interval)
  const attached = state.watcher
  const ready = new Promise<void>(resolve => {
    attached.once('ready', () => resolve())
  })
  await Promise.race([ready, sleep(2000, undefined, { unref: true })])
  if (state.disposed || generation !== state.watchGeneration) return
  if (USE_POLLING && state.idleCheckTimer === null) {
    state.idleCheckTimer = setInterval(() => {
      runInStateSession(state, () => {
        checkIdleTransition(state)
      })
    }, IDLE_CHECK_INTERVAL_MS)
    state.idleCheckTimer.unref?.()
  }
}

function disposeState(state: HostSkillChangeDetectorState): Promise<void> {
  state.disposed = true
  if (state.unregisterCleanup) {
    state.unregisterCleanup()
    state.unregisterCleanup = null
  }
  if (state.unregisterDynamicSkills) {
    state.unregisterDynamicSkills()
    state.unregisterDynamicSkills = null
  }
  state.dynamicSkillsCallbackRegistered = false
  if (state.unregisterInvalidation) {
    state.unregisterInvalidation()
    state.unregisterInvalidation = null
  }
  if (state.idleCheckTimer) {
    clearInterval(state.idleCheckTimer)
    state.idleCheckTimer = null
  }
  if (state.missingDirTimer) {
    clearTimeout(state.missingDirTimer)
    state.missingDirTimer = null
  }
  state.missingDirs.clear()
  state.watcherHealthy = false
  let closePromise: Promise<void> = Promise.resolve()
  if (state.watcher) {
    closePromise = state.watcher.close()
    state.watcher = null
  }
  if (state.parentWatcher) {
    const parentClose = state.parentWatcher.close().catch(() => undefined)
    state.parentWatcher = null
    state.watchedParentDirs = []
    closePromise = Promise.all([closePromise, parentClose]).then(
      () => undefined,
    )
  }
  if (state.reloadTimer) {
    clearTimeout(state.reloadTimer)
    state.reloadTimer = null
  }
  state.pendingChangedPaths.clear()
  state.skillsChanged.clear()
  state.sessionRef = null
  // Keep skillInvalidation listeners across dispose only if re-init expected;
  // densable D clears l (skillsChanged) and c() (U7 unsub), not U7 itself.
  return closePromise
}

/**
 * densable XoS D — dispose
 */
export function dispose(): Promise<void> {
  return disposeState(getHostSkillChangeDetectorState())
}

export function subscribe(listener: () => void): () => void {
  return getHostSkillChangeDetectorState().skillsChanged.subscribe(listener)
}

/**
 * Official 2.1.326 #129: return all candidate skill/command/agent directories
 * (whether or not they currently exist on disk).
 */
export function getCandidateSkillDirs(): string[] {
  const cwd = resolveDetectorCwd()
  const candidates: string[] = []
  const pushResolved = (p: string | undefined, shouldResolve = false) => {
    if (!p) return
    candidates.push(shouldResolve ? platformPath.resolve(cwd, p) : p)
  }

  pushResolved(getSkillsPath('userSettings', 'skills'))
  pushResolved(getSkillsPath('userSettings', 'commands'))
  pushResolved(platformPath.join(getClaudeConfigHomeDir(), 'agents'))

  pushResolved(getSkillsPath('projectSettings', 'skills'), true)
  pushResolved(getSkillsPath('projectSettings', 'commands'), true)
  pushResolved('.claude/agents', true)

  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    pushResolved(platformPath.join(dir, '.claude', 'skills'), true)
  }

  const unique = uniqueWatchPaths(candidates)
  return isPluginDirWatchDisabledByEnv()
    ? unique.filter(p => !p.endsWith(`${platformPath.sep}skills`))
    : unique
}

/**
 * Official 2.1.326 #129: compute the nearest existing parent directories for
 * candidate `.claude/{skills,commands,agents}` folders that do not exist yet.
 */
export async function getWatchableParentDirs(
  candidates: readonly string[] = getCandidateSkillDirs(),
  existingWatched: readonly string[] = getHostSkillChangeDetectorState()
    .watchedPaths,
): Promise<{ missingTargets: string[]; parentDirs: string[] }> {
  const state = getHostSkillChangeDetectorState()
  const cwd = resolveDetectorCwd()
  const dirExists = state.testOverrides?.dirExists ?? defaultDirExists
  const watchedSet = new Set(
    existingWatched.map(p => platformPath.resolve(cwd, p)),
  )
  const missingTargets: string[] = []
  const parentDirs: string[] = []

  for (const target of candidates) {
    const resolvedTarget = platformPath.resolve(cwd, target)
    if (watchedSet.has(resolvedTarget)) continue
    if (await dirExists(resolvedTarget)) continue
    missingTargets.push(resolvedTarget)

    // Walk up at most 2 levels (.claude/skills -> .claude -> project root)
    let parent = platformPath.dirname(resolvedTarget)
    for (let depth = 0; depth < 2; depth++) {
      if (await dirExists(parent)) {
        parentDirs.push(parent)
        break
      }
      const nextParent = platformPath.dirname(parent)
      if (nextParent === parent) break
      parent = nextParent
    }
  }

  return {
    missingTargets,
    parentDirs: uniqueWatchPaths(parentDirs),
  }
}

async function refreshParentWatcher(
  state: HostSkillChangeDetectorState,
  interval: number,
): Promise<void> {
  if (state.disposed) return
  captureRootSessionRef(state)
  const { missingTargets, parentDirs } = await getWatchableParentDirs()
  if (state.disposed) return

  const sameParents =
    parentDirs.length === state.watchedParentDirs.length &&
    parentDirs.every((d, idx) => d === state.watchedParentDirs[idx])
  if (
    sameParents &&
    (parentDirs.length === 0 || state.parentWatcher !== null)
  ) {
    return
  }

  if (state.parentWatcher) {
    const old = state.parentWatcher
    state.parentWatcher = null
    void old.close().catch(() => undefined)
  }
  state.watchedParentDirs = parentDirs
  if (parentDirs.length === 0 || missingTargets.length === 0) {
    return
  }

  const targetPrefixes = missingTargets.map(t => ({
    target: t,
    claudeDir: platformPath.dirname(t),
  }))

  const isRelevantParentEvent = (changedPath: string): boolean => {
    const resolved = platformPath.resolve(changedPath)
    return targetPrefixes.some(
      ({ target, claudeDir }) =>
        resolved === claudeDir ||
        resolved === target ||
        resolved.startsWith(`${target}${platformPath.sep}`),
    )
  }

  const pw = chokidar.watch(parentDirs, {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
    ignored: (filePath, stats) => {
      if (
        stats &&
        !stats.isFile() &&
        !stats.isDirectory() &&
        !stats.isSymbolicLink()
      ) {
        return true
      }
      if (filePath.split(/[/\\]/).some(dir => dir === '.git')) return true
      const resolved = platformPath.resolve(filePath)
      if (parentDirs.includes(resolved)) return false
      // Only descend into `.claude` and its skills/commands/agents children
      const matches = targetPrefixes.some(
        ({ target, claudeDir }) =>
          resolved === claudeDir ||
          resolved === target ||
          resolved.startsWith(`${target}${platformPath.sep}`),
      )
      if (!matches) return true
      if (stats?.isFile()) return !filePath.endsWith('.md')
      return false
    },
    ignorePermissionErrors: true,
    usePolling: USE_POLLING,
    interval,
    binaryInterval: interval,
    atomic: true,
  })

  const onParentActivity = (changedPath: string) => {
    if (!isRelevantParentEvent(changedPath)) return
    runInStateSession(state, () => {
      void discoverNewlyCreatedSkillDirs(changedPath)
    })
  }
  pw.on('addDir', onParentActivity)
  pw.on('add', onParentActivity)
  pw.on('error', (err: unknown) => {
    runInStateSession(state, () => {
      logForDebugging(`[skills] parent watcher error: ${errorMessage(err)}`, {
        level: 'warn',
      })
    })
  })
  state.parentWatcher = pw
}

/**
 * Official 2.1.326 #129 (`De`): check for newly created skill/command/agent
 * directories, attach the main watcher to them, and immediately trigger a
 * reload so the first skill/command/agent created in a session is found right away.
 */
export async function discoverNewlyCreatedSkillDirs(
  triggerPath?: string,
): Promise<string[]> {
  const state = getHostSkillChangeDetectorState()
  if (!state.initialized || state.disposed) return []
  const nextRaw = await getWatchablePaths()
  if (state.disposed) return []
  const nextFiltered = isPluginDirWatchDisabledByEnv()
    ? nextRaw.filter(p => !p.endsWith(`${platformPath.sep}skills`))
    : filterWatchedModDirs(nextRaw, { skillModDirs: nextRaw })
  const existingSet = new Set(
    state.watchedPaths.map(p => platformPath.resolve(p)),
  )
  const newlyFound = nextFiltered.filter(
    p => !existingSet.has(platformPath.resolve(p)),
  )
  if (newlyFound.length === 0) {
    // Still refresh parent watcher in case `.claude/` itself was just created
    if (triggerPath) {
      await refreshParentWatcher(state, getActivePollInterval(state))
    }
    return []
  }

  const generation = ++state.watchGeneration
  state.watchedPaths = uniqueWatchPaths([...state.watchedPaths, ...newlyFound])
  logForDebugging(
    `[skills] now watching newly created skill/command directories: ${newlyFound.join(', ')}`,
  )
  if (state.watcher) {
    const old = state.watcher
    void old.close().catch(() => undefined)
  }
  const interval = getActivePollInterval(state)
  state.watcher = createWatcher(state, interval)
  const attached = state.watcher
  const ready = new Promise<void>(resolve => {
    attached.once('ready', () => resolve())
  })
  await Promise.race([ready, sleep(2000, undefined, { unref: true })])
  if (state.disposed || generation !== state.watchGeneration) return newlyFound

  await refreshParentWatcher(state, interval)
  for (const dir of newlyFound) {
    handleChange(state, triggerPath ?? dir)
  }
  return newlyFound
}

/**
 * densable QoS — watchable paths including agents dirs.
 */
async function getWatchablePaths(): Promise<string[]> {
  const fs = getFsImplementation()
  const cwd = resolveDetectorCwd()
  const paths: string[] = []

  async function tryPush(
    path: string | undefined,
    resolve = false,
  ): Promise<void> {
    if (!path) return
    try {
      const absolute = resolve ? platformPath.resolve(cwd, path) : path
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

function handleChange(state: HostSkillChangeDetectorState, path: string): void {
  logForDebugging(`Detected skill change: ${path}`)
  logEvent('tengu_skill_file_changed', {
    source:
      'chokidar' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  scheduleReload(state, path)
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
async function runScheduledReload(
  state: HostSkillChangeDetectorState,
): Promise<void> {
  state.reloadTimer = null
  const paths = [...state.pendingChangedPaths]
  state.pendingChangedPaths.clear()

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
    state.testOverrides?.getFingerprint ?? defaultGetFingerprint
  const next = await getFingerprint().catch(() => null)

  if (next === null) {
    clearCommandsCache()
    // densable poe ≈ agent cache clear + sent-skill reset
    clearAgentDefinitionsCache()
    resetSentSkillNames()
    state.skillsChanged.emit()
    return
  }

  const unchanged =
    state.lastFingerprint !== null &&
    next.size === state.lastFingerprint.size &&
    [...state.lastFingerprint].every(([k, v]) => next.get(k) === v)

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
    if (state.lastFingerprint !== null) {
      const changedNames = [...state.lastFingerprint]
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
    state.lastFingerprint = next
  }
  state.skillsChanged.emit()
}

function scheduleReload(
  state: HostSkillChangeDetectorState,
  changedPath: string,
): void {
  captureRootSessionRef(state)
  state.pendingChangedPaths.add(changedPath)
  if (state.reloadTimer) clearTimeout(state.reloadTimer)
  state.reloadTimer = setTimeout(() => {
    runInStateSession(state, () => {
      void runScheduledReload(state)
    })
  }, state.testOverrides?.reloadDebounce ?? RELOAD_DEBOUNCE_MS)
}

/**
 * densable XoS._checkIdleTransitionForTest
 */
export function _checkIdleTransitionForTest(): void {
  checkIdleTransition(getHostSkillChangeDetectorState())
}

/**
 * #1863 test helper: simulate an `unlinkDir` event on a watched directory.
 */
export function _simulateUnlinkDirForTest(dirPath: string): boolean {
  return handleWatchedDirUnlinked(getHostSkillChangeDetectorState(), dirPath)
}

/**
 * #1863 test helper: inspect missingDirs state.
 */
export function _getMissingDirsForTest(): Map<string, boolean> {
  return new Map(getHostSkillChangeDetectorState().missingDirs)
}

/**
 * Reset internal state for testing purposes only.
 */
export async function resetForTesting(
  overrides?: SkillChangeDetectorDeps,
): Promise<void> {
  const state = getHostSkillChangeDetectorState()
  if (state.unregisterCleanup) {
    state.unregisterCleanup()
    state.unregisterCleanup = null
  }
  if (state.unregisterDynamicSkills) {
    state.unregisterDynamicSkills()
    state.unregisterDynamicSkills = null
  }
  state.dynamicSkillsCallbackRegistered = false
  if (state.unregisterInvalidation) {
    state.unregisterInvalidation()
    state.unregisterInvalidation = null
  }
  if (state.watcher) {
    await state.watcher.close()
    state.watcher = null
  }
  if (state.parentWatcher) {
    await state.parentWatcher.close()
    state.parentWatcher = null
  }
  state.watchedParentDirs = []
  if (state.reloadTimer) {
    clearTimeout(state.reloadTimer)
    state.reloadTimer = null
  }
  if (state.idleCheckTimer) {
    clearInterval(state.idleCheckTimer)
    state.idleCheckTimer = null
  }
  if (state.missingDirTimer) {
    clearTimeout(state.missingDirTimer)
    state.missingDirTimer = null
  }
  state.missingDirs.clear()
  state.watcherHealthy = false
  state.pendingChangedPaths.clear()
  state.skillsChanged.clear()
  state.lastFingerprint = null
  state.watchedPaths = []
  state.watchGeneration = 0
  state.isIdle = false
  state.initialized = false
  state.disposed = false
  state.sessionRef = null
  state.testOverrides = overrides ?? null
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
