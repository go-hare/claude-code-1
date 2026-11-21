import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import { isAbsolute, join, normalize, sep } from 'path'
import {
  getIsNonInteractiveSession,
  getProjectRoot,
} from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from '../utils/envUtils.js'
import { findCanonicalGitRoot } from '../utils/git.js'
import { sanitizePath } from '../utils/path.js'
import {
  getEnabledSettingSources,
  isSettingSourceEnabled,
} from '../utils/settings/constants.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Whether auto-memory features are enabled (memdir, agent memory, past session search).
 * Enabled by default. Priority chain (first defined wins):
 *   1. CLAUDE_CODE_DISABLE_AUTO_MEMORY env var (1/true → OFF, 0/false → ON)
 *   2. CLAUDE_CODE_SIMPLE (--bare) → OFF
 *   3. CCR without persistent storage → OFF (no CLAUDE_CODE_REMOTE_MEMORY_DIR)
 *   4. autoMemoryEnabled in settings.json (supports project-level opt-out)
 *   5. Default: enabled
 */
export function isAutoMemoryEnabled(): boolean {
  // Official DISABLE_AUTO_MEMORY densable pure env half.
  try {
    const { resolveAutoMemoryEnvOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    const envOverride = resolveAutoMemoryEnvOverride()
    if (envOverride !== null) return envOverride
  } catch {
    const envVal = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    if (isEnvTruthy(envVal)) {
      return false
    }
    if (isEnvDefinedFalsy(envVal)) {
      return true
    }
  }
  // --bare / SIMPLE: prompts.ts already drops the memory section from the
  // system prompt via its SIMPLE early-return; this gate stops the other half
  // (extractMemories turn-end fork, autoDream, /remember, /dream, team sync).
  // Official SIMPLE densable (+ --bare argv).
  if (isBareMode()) {
    return false
  }
  // Official REMOTE densable — remote without memory dir disables auto-memory.
  let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    isRemote = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (isRemote && !process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) {
    return false
  }
  const settings = getInitialSettings()
  if (settings.autoMemoryEnabled !== undefined) {
    return settings.autoMemoryEnabled
  }
  return true
}

/**
 * Whether the extract-memories background agent will run this session.
 *
 * The main agent's prompt always has full save instructions regardless of
 * this gate — when the main agent writes memories, the background agent
 * skips that range (hasMemoryWritesSince in extractMemories.ts); when it
 * doesn't, the background agent catches anything missed.
 *
 * Callers must also gate on feature('EXTRACT_MEMORIES') — that check cannot
 * live inside this helper because feature() only tree-shakes when used
 * directly in an `if` condition.
 */
export function isExtractModeActive(): boolean {
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)) {
    return false
  }
  return (
    !getIsNonInteractiveSession() ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_thimble', false)
  )
}

/**
 * Returns the base directory for persistent memory storage.
 * Resolution order:
 *   1. CLAUDE_CODE_REMOTE_MEMORY_DIR env var (explicit override, set in CCR)
 *   2. ~/.claude (default config home)
 */
export function getMemoryBaseDir(): string {
  if (process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) {
    return process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  }
  return getClaudeConfigHomeDir()
}

const AUTO_MEM_DIRNAME = 'memory'
const AUTO_MEM_ENTRYPOINT_NAME = 'MEMORY.md'

/**
 * Normalize and validate a candidate auto-memory directory path.
 *
 * SECURITY: Rejects paths that would be dangerous as a read-allowlist root
 * or that normalize() doesn't fully resolve:
 * - relative (!isAbsolute): "../foo" — would be interpreted relative to CWD
 * - root/near-root (length < 3): "/" → "" after strip; "/a" too short
 * - Windows drive-root (C: regex): "C:\" → "C:" after strip
 * - UNC paths (\\server\share): network paths — opaque trust boundary
 * - null byte: survives normalize(), can truncate in syscalls
 *
 * Returns the normalized path with exactly one trailing separator,
 * or undefined if the path is unset/empty/rejected.
 */
function validateMemoryPath(
  raw: string | undefined,
  expandTilde: boolean,
): string | undefined {
  if (!raw) {
    return undefined
  }
  let candidate = raw
  // Settings.json paths support ~/ expansion (user-friendly). The env var
  // override does not (it's set programmatically by Cowork/SDK, which should
  // always pass absolute paths). Bare "~", "~/", "~/.", "~/..", etc. are NOT
  // expanded — they would make isAutoMemPath() match all of $HOME or its
  // parent (same class of danger as "/" or "C:\").
  if (
    expandTilde &&
    (candidate.startsWith('~/') || candidate.startsWith('~\\'))
  ) {
    const rest = candidate.slice(2)
    // Reject trivial remainders that would expand to $HOME or an ancestor.
    // normalize('') = '.', normalize('.') = '.', normalize('foo/..') = '.',
    // normalize('..') = '..', normalize('foo/../..') = '..'
    const restNorm = normalize(rest || '.')
    if (restNorm === '.' || restNorm === '..') {
      return undefined
    }
    candidate = join(homedir(), rest)
  }
  // normalize() may preserve a trailing separator; strip before adding
  // exactly one to match the trailing-sep contract of getAutoMemPath()
  const normalized = normalize(candidate).replace(/[/\\]+$/, '')
  if (
    !isAbsolute(normalized) ||
    normalized.length < 3 ||
    /^[A-Za-z]:$/.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('//') ||
    normalized.includes('\0')
  ) {
    return undefined
  }
  return (normalized + sep).normalize('NFC')
}

/**
 * Direct override for the full auto-memory directory path via env var.
 * When set, getAutoMemPath()/getAutoMemEntrypoint() return this path directly
 * instead of computing `{base}/projects/{sanitized-cwd}/memory/`.
 *
 * Used by Cowork to redirect memory to a space-scoped mount where the
 * per-session cwd (which contains the VM process name) would otherwise
 * produce a different project-key for every session.
 */
function getAutoMemPathOverride(): string | undefined {
  return validateMemoryPath(
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE,
    false,
  )
}

const AUTO_MEM_SETTING_SOURCES = [
  'policySettings',
  'flagSettings',
  'localSettings',
  'userSettings',
] as const

export type AutoMemSettingSource = (typeof AUTO_MEM_SETTING_SOURCES)[number]

/**
 * Official 2.1.328 `Qy()` — resolves autoMemoryDirectory and which enabled
 * setting source supplied it (trusted sources only: policy/flag/local/user).
 */
export function getAutoMemPathSettingEntry(): {
  dir: string | undefined
  source: AutoMemSettingSource | undefined
} {
  for (const source of AUTO_MEM_SETTING_SOURCES) {
    if (!isSettingSourceEnabled(source)) {
      continue
    }
    const dir = getSettingsForSource(source)?.autoMemoryDirectory
    if (dir != null) {
      return { dir, source }
    }
  }
  return { dir: undefined, source: undefined }
}

/**
 * Settings.json override for the full auto-memory directory path.
 * Supports ~/ expansion for user convenience.
 *
 * SECURITY: projectSettings (.claude/settings.json committed to the repo) is
 * intentionally excluded — a malicious repo could otherwise set
 * autoMemoryDirectory: "~/.ssh" and gain silent write access to sensitive
 * directories via the filesystem.ts write carve-out (which fires when
 * isAutoMemPath() matches and hasAutoMemPathOverride() is false). This follows
 * the same pattern as hasSkipDangerousModePermissionPrompt() etc.
 */
function getAutoMemPathSetting(): string | undefined {
  return validateMemoryPath(getAutoMemPathSettingEntry().dir, true)
}

/**
 * Official 2.1.328 `Url()` — returns the setting source that supplied the
 * active validated `autoMemoryDirectory`, or undefined when using the env
 * override or default path.
 */
export function getAutoMemPathSettingSource():
  | AutoMemSettingSource
  | undefined {
  if (getAutoMemPathOverride() !== undefined) {
    return undefined
  }
  const entry = getAutoMemPathSettingEntry()
  if (validateMemoryPath(entry.dir, true) === undefined) {
    return undefined
  }
  return entry.source
}

// Official 2.1.328 `Oe` / `Foo()` / `vHt()` (chunk@288398886.js @22541):
// process-level latch once blockReadsOutsideWorkingDirectories is enabled.
let outsideReadBlockLatched = false
const seenGitTrackedLocalSettingsRoots = new Set<string>()

/** Official `Foo()` — latch blockReadsOutsideWorkingDirectories for the process. */
export function latchBlockReadsOutsideWorkingDirectories(): void {
  outsideReadBlockLatched = true
}

/** Official `vHt()` — true once blockReadsOutsideWorkingDirectories is active or latched. */
export function isBlockReadsOutsideWorkingDirectoriesLatched(): boolean {
  if (
    !outsideReadBlockLatched &&
    getEnabledSettingSources().some(
      source =>
        getSettingsForSource(source)?.permissions
          ?.blockReadsOutsideWorkingDirectories === true,
    )
  ) {
    outsideReadBlockLatched = true
  }
  return outsideReadBlockLatched
}

function isFlagBlockFileToolReadsOutsideWorkingDirsActive(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return false
  }
  const flagPerms = getSettingsForSource('flagSettings')?.permissions as
    | { blockFileToolReadsOutsideWorkingDirectories?: boolean }
    | undefined
  return flagPerms?.blockFileToolReadsOutsideWorkingDirectories === true
}

/**
 * Official 2.1.328 `nOn()` (chunk@288385318.js): setting sources whose grants
 * / paths are controlled by the repository (`projectSettings`, plus
 * `localSettings` whenever `.claude/settings.local.json` is git-tracked,
 * indeterminate, or previously observed git-tracked for this project).
 */
export function getRepoScopedSettingSources(): readonly (
  | 'projectSettings'
  | 'localSettings'
)[] {
  const root = getProjectRoot()
  if (!root) {
    return ['projectSettings', 'localSettings']
  }
  let trackedNow = false
  try {
    const { isLocalSettingsGitTracked } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/settings/localSettingsGitTracked.js') as typeof import('../utils/settings/localSettingsGitTracked.js')
    trackedNow = isLocalSettingsGitTracked({ onIndeterminate: 'tracked' })
    if (trackedNow) {
      seenGitTrackedLocalSettingsRoots.add(root)
    }
  } catch {
    // fallback if helper unavailable
  }
  let persistedTracked = false
  try {
    const { getGlobalConfig, getProjectPathForConfig } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/config.js') as typeof import('../utils/config.js')
    persistedTracked =
      (
        getGlobalConfig().projects?.[getProjectPathForConfig()] as
          | { localSettingsSeenGitTracked?: boolean }
          | undefined
      )?.localSettingsSeenGitTracked === true
  } catch {
    // config may not be enabled yet
  }
  return trackedNow ||
    seenGitTrackedLocalSettingsRoots.has(root) ||
    persistedTracked
    ? ['projectSettings', 'localSettings']
    : ['projectSettings']
}

/**
 * Official 2.1.328 `Rge()` (chunk@288398886.js @22541): true when AutoMem
 * (`MEMORY.md`) loading must be held because outside-read blocking is active
 * and the resolved auto-memory location is controlled by a repo-scoped setting
 * source (e.g. git-tracked `localSettings.autoMemoryDirectory`) or conflicts
 * with `--settings` under `blockFileToolReadsOutsideWorkingDirectories`.
 */
export function isAutoMemoryHeldByOutsideReadBlock(context?: {
  blockReadsOutsideWorkingDirectories?: boolean
}): boolean {
  const readBlockActive =
    context?.blockReadsOutsideWorkingDirectories === true ||
    isBlockReadsOutsideWorkingDirectoriesLatched()
  const fileToolReadBlock = isFlagBlockFileToolReadsOutsideWorkingDirsActive()
  if (!readBlockActive && !fileToolReadBlock) {
    return false
  }
  const source = getAutoMemPathSettingSource()
  if (
    source !== undefined &&
    (getRepoScopedSettingSources() as readonly string[]).includes(source)
  ) {
    return true
  }
  if (fileToolReadBlock) {
    const entry = getAutoMemPathSettingEntry()
    const flagDir = getSettingsForSource('flagSettings')?.autoMemoryDirectory
    if (entry.dir !== undefined && flagDir !== entry.dir) {
      return true
    }
  }
  return false
}

export function _resetOutsideReadBlockLatchForTests(): void {
  outsideReadBlockLatched = false
  seenGitTrackedLocalSettingsRoots.clear()
}

/**
 * Check if CLAUDE_COWORK_MEMORY_PATH_OVERRIDE is set to a valid override.
 * Use this as a signal that the SDK caller has explicitly opted into
 * the auto-memory mechanics — e.g. to decide whether to inject the
 * memory prompt when a custom system prompt replaces the default.
 */
export function hasAutoMemPathOverride(): boolean {
  return getAutoMemPathOverride() !== undefined
}

/**
 * Returns the canonical git repo root if available, otherwise falls back to
 * the stable project root. Uses findCanonicalGitRoot so all worktrees of the
 * same repo share one auto-memory directory (anthropics/claude-code#24382).
 */
function getAutoMemBase(): string {
  return findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot()
}

/**
 * Returns the auto-memory directory path.
 *
 * Resolution order:
 *   1. CLAUDE_COWORK_MEMORY_PATH_OVERRIDE env var (full-path override, used by Cowork)
 *   2. autoMemoryDirectory in settings.json (trusted sources only: policy/local/user)
 *   3. <memoryBase>/projects/<sanitized-git-root>/memory/
 *      where memoryBase is resolved by getMemoryBaseDir()
 *
 * Memoized: render-path callers (collapseReadSearchGroups → isAutoManagedMemoryFile)
 * fire per tool-use message per Messages re-render; each miss costs
 * getSettingsForSource × 4 → parseSettingsFile (realpathSync + readFileSync).
 * Keyed on projectRoot so tests that change its mock mid-block recompute;
 * env vars / settings.json / CLAUDE_CONFIG_DIR are session-stable in
 * production and covered by per-test cache.clear.
 */
export const getAutoMemPath = memoize(
  (): string => {
    const override = getAutoMemPathOverride() ?? getAutoMemPathSetting()
    if (override) {
      return override
    }
    const projectsDir = join(getMemoryBaseDir(), 'projects')
    return (
      join(projectsDir, sanitizePath(getAutoMemBase()), AUTO_MEM_DIRNAME) + sep
    ).normalize('NFC')
  },
  () => getProjectRoot(),
)

/**
 * Returns the auto-memory entrypoint (MEMORY.md inside the auto-memory dir).
 * Follows the same resolution order as getAutoMemPath().
 */
export function getAutoMemEntrypoint(): string {
  return join(getAutoMemPath(), AUTO_MEM_ENTRYPOINT_NAME)
}

/**
 * Check if an absolute path is within the auto-memory directory.
 *
 * When CLAUDE_COWORK_MEMORY_PATH_OVERRIDE is set, this matches against the
 * env-var override directory. Note that a true return here does NOT imply
 * write permission in that case — the filesystem.ts write carve-out is gated
 * on !hasAutoMemPathOverride() (it exists to bypass DANGEROUS_DIRECTORIES).
 *
 * The settings.json autoMemoryDirectory DOES get the write carve-out: it's the
 * user's explicit choice from a trusted settings source (projectSettings is
 * excluded — see getAutoMemPathSetting), and hasAutoMemPathOverride() remains
 * false for it.
 */
export function isAutoMemPath(absolutePath: string): boolean {
  // SECURITY: Normalize to prevent path traversal bypasses via .. segments
  const normalizedPath = normalize(absolutePath)
  return normalizedPath.startsWith(getAutoMemPath())
}
