import { feature } from 'bun:bundle'
import chalk from 'chalk'
import { spawnSync } from 'child_process'
import { constants as fsConstants } from 'fs'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
  symlink,
  utimes,
} from 'fs/promises'
import ignore from 'ignore'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
  win32,
} from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { saveCurrentProjectConfig } from './config.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode, isENOENT } from './errors.js'
import { filterCompilableIgnorePatterns } from './ignorePatterns.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from './execFileNoThrow.js'
import {
  registerWorktreeSessionProvider,
  scrubGitEnvForWorktree,
} from './worktreeGitIsolation.js'
import { parseGitConfigValue } from './git/gitConfigParser.js'
import {
  getCommonDir,
  readWorktreeGitDir,
  readWorktreeHeadSha,
  resolveGitDir,
  resolveRef,
} from './git/gitFilesystem.js'
import {
  findCanonicalGitRoot,
  findGitRoot,
  getBranch,
  getDefaultBranch,
  gitExe,
} from './git.js'
import {
  assertIsolationWorktreeAllowed,
  liveLaunchDirs,
} from './isolationWorktreePin.js'
import {
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
  hasWorktreeCreateHook,
  hasWorktreeRemoveHook,
} from './hooks.js'
import {
  containsPathTraversal,
  hasPathDotSegment,
  isNetworkUncPath,
  isNtObjectNamespacePathNormalized,
  isWindowsDeviceNamespacePath,
} from './path.js'
import { containsVulnerableUncPath } from './shell/readOnlyCommandValidation.js'
import { getPlatform } from './platform.js'
import {
  getInitialSettings,
  getRelativeSettingsFilePathForSource,
} from './settings/settings.js'
import { sleep } from './sleep.js'
import { isInITerm2 } from './swarm/backends/detection.js'
import {
  buildProcessStartIdentityFields,
  isProcessGone,
  isProcessRunning,
  ownProcStartAsync,
  processLstartMatches,
} from './genericProcessUtils.js'

const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/
const MAX_WORKTREE_SLUG_LENGTH = 64

/** densable Ijr / Mjr / Ojr — marker that we enabled worktreeConfig. */
const ENABLED_WORKTREE_CONFIG_KEY = 'claude.enabledWorktreeConfigExtension'
/** densable ijr — BMs per-sweep unlock cap. */
const STALE_LOCK_RELEASE_CAP = 50
/** densable NMs — git no longer recognizes the worktree. */
const WORKTREE_NOT_REGISTERED =
  /is not a working tree|validation failed|not a git repository: .*[\\/]\.git[\\/]worktrees[\\/]/
/** densable xne — W7 expectedResolvedPath mismatch. */
export const WORKTREE_RESOLUTION_CHANGED =
  'resolution changed since ownership verification'
/** densable Pjr — Ane/W7 hook refuse when the dir still has files. */
export const WORKTREE_UNVERIFIABLE_FILES =
  'has files but no repository to verify them against'
/** densable xjr — M4 refused. */
export const WORKTREE_UNREMOVABLE_REPARSE =
  'unremovable reparse point in the worktree'
/** densable IHt / xAt — same sentinel eq() returns. */
const WORKTREE_UNVERIFIED_ANCESTRY = '\0unverified-ancestry'

/**
 * Official 2.1.207: sparse linked worktrees need extensions.worktreeConfig.
 * Ensure it is true in the main repo before sparse-checkout set.
 */
export async function ensureExtensionsWorktreeConfig(
  repoRoot: string,
): Promise<void> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--local', '--get', 'extensions.worktreeConfig'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
  if (code === 0 && stdout.trim() === 'true') {
    return
  }
  await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--local', 'extensions.worktreeConfig', 'true'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
  // densable Ojr — Mne only restores when we marked that we enabled it.
  await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--local', ENABLED_WORKTREE_CONFIG_KEY, 'true'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
}

/**
 * Official 2.1.207: after the last sparsePaths worktree is removed, unset
 * extensions.worktreeConfig so go-git tools (tea, etc.) are not broken.
 * Only runs when no other worktree under `.claude/worktrees/` remains.
 */
/**
 * Parse `git worktree list --porcelain` and decide whether any Claude linked
 * worktree remains after `removedWorktreePath` is gone.
 */
export function hasRemainingClaudeLinkedWorktrees(
  porcelainStdout: string,
  removedWorktreePath: string,
  claudeWorktreesMarker: string = join('.claude', 'worktrees'),
): boolean {
  const remaining = porcelainStdout
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(path => path.length > 0 && path !== removedWorktreePath)
  return remaining.some(path => path.includes(claudeWorktreesMarker))
}

export async function maybeRestoreExtensionsWorktreeConfig(
  repoRoot: string,
  removedWorktreePath: string,
): Promise<void> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['worktree', 'list', '--porcelain'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
  if (code !== 0) {
    return
  }
  if (hasRemainingClaudeLinkedWorktrees(stdout, removedWorktreePath)) {
    return
  }

  const { code: unsetCode, stderr: unsetErr } = await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--local', '--unset-all', 'extensions.worktreeConfig'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
  if (unsetCode === 0) {
    logForDebugging(
      `Restored extensions.worktreeConfig in ${repoRoot} after removing its last linked worktree`,
    )
  } else if (
    unsetErr &&
    !/unset|not found|key does not exist/i.test(unsetErr)
  ) {
    logForDebugging(
      `Could not restore extensions.worktreeConfig for ${repoRoot}: ${unsetErr}`,
      { level: 'warn' },
    )
  }
}

/**
 * Validates a worktree slug to prevent path traversal and directory escape.
 *
 * The slug is joined into `.claude/worktrees/<slug>` via path.join, which
 * normalizes `..` segments — so `../../../target` would escape the worktrees
 * directory. Similarly, an absolute path (leading `/` or `C:\`) would discard
 * the prefix entirely.
 *
 * Forward slashes are allowed for nesting (e.g. `asm/feature-foo`); each
 * segment is validated independently against the allowlist, so `.` / `..`
 * segments and drive-spec characters are still rejected.
 *
 * Throws synchronously — callers rely on this running before any side effects
 * (git commands, hook execution, chdir).
 */
export function validateWorktreeSlug(slug: string): void {
  if (slug.length > MAX_WORKTREE_SLUG_LENGTH) {
    throw new Error(
      `Invalid worktree name: must be ${MAX_WORKTREE_SLUG_LENGTH} characters or fewer (got ${slug.length})`,
    )
  }
  // Leading or trailing `/` would make path.join produce an absolute path
  // or a dangling segment. Splitting and validating each segment rejects
  // both (empty segments fail the regex) while allowing `user/feature`.
  for (const segment of slug.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new Error(
        `Invalid worktree name "${slug}": must not contain "." or ".." path segments`,
      )
    }
    if (!VALID_WORKTREE_SLUG_SEGMENT.test(segment)) {
      throw new Error(
        `Invalid worktree name "${slug}": each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      )
    }
  }
}

// Helper function to create directories recursively
async function mkdirRecursive(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

/**
 * Symlinks directories from the main repository to avoid duplication.
 * This prevents disk bloat from duplicating node_modules and other large directories.
 *
 * @param repoRootPath - Path to the main repository root
 * @param worktreePath - Path to the worktree directory
 * @param dirsToSymlink - Array of directory names to symlink (e.g., ['node_modules'])
 */
async function symlinkDirectories(
  repoRootPath: string,
  worktreePath: string,
  dirsToSymlink: string[],
): Promise<void> {
  for (const dir of dirsToSymlink) {
    // Validate directory doesn't escape repository boundaries
    if (containsPathTraversal(dir)) {
      logForDebugging(
        `Skipping symlink for "${dir}": path traversal detected`,
        { level: 'warn' },
      )
      continue
    }

    const sourcePath = join(repoRootPath, dir)
    const destPath = join(worktreePath, dir)

    try {
      await symlink(sourcePath, destPath, 'dir')
      logForDebugging(
        `Symlinked ${dir} from main repository to worktree to avoid disk bloat`,
      )
    } catch (error) {
      const code = getErrnoCode(error)
      // ENOENT: source doesn't exist yet (expected - skip silently)
      // EEXIST: destination already exists (expected - skip silently)
      if (code !== 'ENOENT' && code !== 'EEXIST') {
        // Unexpected error (e.g., permission denied, unsupported platform)
        logForDebugging(
          `Failed to symlink ${dir} (${code ?? 'unknown'}): ${errorMessage(error)}`,
          { level: 'warn' },
        )
      }
    }
  }
}

export type WorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  originalBranch?: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
  /**
   * densable `enteredExisting` — guest / enter into an existing tree.
   * Owner sessions that successfully `Cjr` leave this unset; guests set `true`
   * so keep/exit must not `releaseOwnWorktreeLock`.
   */
  enteredExisting?: boolean
  /** How long worktree creation took (unset when resuming an existing worktree). */
  creationDurationMs?: number
  /** True if git sparse-checkout was applied via settings.worktree.sparsePaths. */
  usedSparsePaths?: boolean
}

let currentWorktreeSession: WorktreeSession | null = null

export function getCurrentWorktreeSession(): WorktreeSession | null {
  return currentWorktreeSession
}

// densable 2.1.216: shell shared-checkout guard reads session via provider
// (avoids worktree ↔ worktreeGitIsolation circular import).
registerWorktreeSessionProvider(() => currentWorktreeSession)

/**
 * Official 2.1.207: classify a path as a Claude-managed linked worktree
 * under `<repo>/.claude/worktrees/…` of the current repository (or a nested
 * repo on first entry). Managed paths may be entered without an extra
 * confirmation; other paths require a safetyCheck ask.
 */
export async function classifyManagedClaudeWorktree(
  rawPath: string,
  cwd: string = getCwd(),
): Promise<{ managed: true; targetReal: string } | { managed: false }> {
  const targetAbs = resolve(cwd, rawPath)
  let targetReal: string
  try {
    await access(targetAbs, fsConstants.F_OK)
    targetReal = await realpath(targetAbs)
  } catch {
    return { managed: false }
  }

  const repoRoot = findCanonicalGitRoot(cwd) ?? findGitRoot(cwd)
  if (!repoRoot) {
    return { managed: false }
  }

  let managedRoot: string
  try {
    managedRoot = await realpath(join(repoRoot, '.claude', 'worktrees'))
  } catch {
    return { managed: false }
  }

  const prefix = managedRoot.endsWith(sep) ? managedRoot : managedRoot + sep
  if (targetReal === managedRoot || !targetReal.startsWith(prefix)) {
    return { managed: false }
  }

  // Confirm git sees it as a linked worktree of this repo.
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['worktree', 'list', '--porcelain'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
  if (code !== 0) {
    return { managed: false }
  }
  const registered = stdout
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
  const isRegistered = registered.some(p => {
    try {
      // Compare realpaths loosely: list may already be real.
      return p === targetReal || resolve(p) === targetReal
    } catch {
      return p === targetReal
    }
  })
  if (!isRegistered) {
    return { managed: false }
  }

  return { managed: true, targetReal }
}

/**
 * Enter an existing worktree directory without creating a new one.
 * Does not run create/sparse setup — only session state + chdir are owned
 * by the EnterWorktree tool after this returns.
 */
export async function enterExistingWorktreeSession(
  worktreePath: string,
  sessionId: string,
): Promise<WorktreeSession> {
  const originalCwd = getCwd()
  const prev = getCurrentWorktreeSession()
  const preEnter = prev?.originalCwd ?? originalCwd
  let extraRoot: string | undefined =
    findCanonicalGitRoot(worktreePath) ?? undefined
  try {
    const preRoot = findCanonicalGitRoot(preEnter)
    if (preRoot !== null && extraRoot) {
      const [preReal, extraReal] = await Promise.all([
        realpath(preRoot),
        realpath(extraRoot),
      ])
      if (preReal === extraReal) extraRoot = undefined
    }
  } catch {
    // keep extraRoot
  }
  // densable 2.1.238 ODt before session bind
  await assertIsolationWorktreeAllowed(
    worktreePath,
    [],
    liveLaunchDirs(preEnter, extraRoot),
  )
  // densable $fr @216889824 — release owned lock when switching trees.
  if (prev && !prev.enteredExisting && !prev.hookBased) {
    const prevReal = await realpath(prev.worktreePath).catch(
      () => prev.worktreePath,
    )
    if (worktreePath !== prevReal) {
      await releaseOwnWorktreeLock(
        prev.worktreePath,
        resolveWorktreeLockGitRoot(prev.originalCwd, prev.worktreePath),
      )
    }
  }
  const { stdout: branchOut } = await execFileNoThrowWithCwd(
    gitExe(),
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  const worktreeBranch = branchOut.trim() || undefined
  const { stdout: headOut } = await execFileNoThrowWithCwd(
    gitExe(),
    ['rev-parse', 'HEAD'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  const worktreeName = basename(worktreePath)

  currentWorktreeSession = {
    originalCwd,
    worktreePath,
    worktreeName,
    worktreeBranch,
    originalHeadCommit: headOut.trim() || undefined,
    sessionId,
    enteredExisting: true,
  }

  saveCurrentProjectConfig(current => ({
    ...current,
    activeWorktreeSession: currentWorktreeSession ?? undefined,
  }))

  return currentWorktreeSession
}

/**
 * Restore the worktree session on --resume. The caller must have already
 * verified the directory exists (via process.chdir) and set the bootstrap
 * state (cwd, originalCwd).
 */
export function restoreWorktreeSession(session: WorktreeSession | null): void {
  currentWorktreeSession = session
}

export function generateTmuxSessionName(
  repoPath: string,
  branch: string,
): string {
  const repoName = basename(repoPath)
  const combined = `${repoName}_${branch}`
  return combined.replace(/[/.]/g, '_')
}

type WorktreeCreateResult =
  | {
      worktreePath: string
      worktreeBranch: string
      headCommit: string
      existed: true
      refreshed?: true
    }
  | {
      worktreePath: string
      worktreeBranch: string
      headCommit: string
      baseBranch: string
      existed: false
    }

// Env vars to prevent git/SSH from prompting for credentials (which hangs the CLI).
// GIT_TERMINAL_PROMPT=0 prevents git from opening /dev/tty for credential prompts.
// GIT_ASKPASS='' disables askpass GUI programs.
// stdin: 'ignore' closes stdin so interactive prompts can't block.
const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
}

/**
 * densable 2.1.216 XB — every git subprocess for worktree lifecycle must scrub
 * GIT_DIR / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_INDEX_FILE so a polluted parent
 * env cannot retarget the shared checkout. Extra overrides apply last (XB).
 */
function gitWorktreeEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return scrubGitEnvForWorktree({ ...GIT_NO_PROMPT_ENV, ...extra })
}

// Re-export densable XB for callers outside this module.
export { scrubGitEnvForWorktree } from './worktreeGitIsolation.js'

function worktreesDir(repoRoot: string): string {
  return join(repoRoot, '.claude', 'worktrees')
}

/**
 * densable 2.1.212 `xqi(repoRoot, worktreePath)`:
 * Before creating a worktree, lstat `.claude`, `.claude/worktrees`, and the
 * target path. ENOENT is fine (not created yet). Any other lstat failure or a
 * symbolic link is fatal — a repository-committed symlink at those locations
 * can redirect `git worktree add` outside the repository.
 *
 * Telemetry reasons match densable `me("git_worktree_create", …)` event names.
 */
export async function assertWorktreeCreatePathsNotSymlinked(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  const candidates = [
    join(repoRoot, '.claude'),
    worktreesDir(repoRoot),
    worktreePath,
  ]
  for (const path of candidates) {
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(path)
    } catch (err) {
      if (isENOENT(err)) {
        continue
      }
      // densable: me("git_worktree_create", "git_worktree_create_lstat_failed")
      logEvent('git_worktree_create_lstat_failed', {})
      throw new Error(
        `Cannot create worktree: failed to lstat ${path}: ${errorMessage(err)}`,
      )
    }
    if (st.isSymbolicLink()) {
      // densable: me("git_worktree_create", "git_worktree_create_symlink_rejected")
      logEvent('git_worktree_create_symlink_rejected', {})
      throw new Error(
        `Cannot create worktree: ${path} is a symlink. A repository-committed symlink at .claude, .claude/worktrees, or .claude/worktrees/<name> could redirect worktree creation outside the repository. Remove the symlink and retry.`,
      )
    }
  }
}

/**
 * densable post-`git worktree add` containment check: realpath(worktreePath)
 * must still be the expected location. Catches races / residual redirects
 * after the pre-create xqi guard.
 */
function worktreePathsEqual(a: string, b: string): boolean {
  if (a === b) {
    return true
  }
  // Windows: drive-letter / 8.3 short-name casing only.
  return process.platform === 'win32' && a.toLowerCase() === b.toLowerCase()
}

export async function assertWorktreeCreateContainment(
  worktreePath: string,
): Promise<void> {
  const expected = resolve(worktreePath)
  let real: string
  try {
    real = await realpath(worktreePath)
  } catch {
    // densable: me("git_worktree_create", "git_worktree_create_realpath_failed")
    logEvent('git_worktree_create_realpath_failed', {})
    throw new Error(
      `Cannot create worktree: failed to verify containment of ${worktreePath}. The path no longer resolves, so the checkout may have been written outside the repository — check ~/.claude/skills and other sensitive locations for unexpected content.`,
    )
  }
  if (worktreePathsEqual(real, expected)) {
    return
  }
  // Windows 8.3 short paths: resolve(path) may keep ADMINI~1 while realpath
  // expands to Administrator — re-realpath the expected string when possible.
  try {
    const expectedReal = await realpath(expected)
    if (worktreePathsEqual(real, expectedReal)) {
      return
    }
  } catch {
    // expected no longer resolves independently — fall through to reject
  }
  // densable: me("git_worktree_create", "git_worktree_create_containment_failed")
  logEvent('git_worktree_create_containment_failed', {})
  throw new Error(
    `Cannot create worktree: ${worktreePath} resolved to ${real}, which is not the expected worktree location ${expected}`,
  )
}

/**
 * densable EHt/CHt arm — readlink(worktree) EINVAL/ENOENT → unlink `.git`.
 * Used when M4 refuses `git worktree remove` on a create-fail leftover.
 */
async function unlinkDanglingWorktreeGitPointer(
  worktreePath: string,
): Promise<void> {
  const dangling = await readlink(worktreePath).then(
    () => false,
    (error: unknown) => getErrnoCode(error) === 'EINVAL' || isENOENT(error),
  )
  if (dangling) {
    await unlink(join(worktreePath, '.git')).catch(() => {})
  }
}

/**
 * densable create-fail teardown: M4 → `worktree remove --force` [+ prune];
 * else EHt EINVAL/ENOENT → CHt `.git`. Sparse also runs Mne afterwards.
 */
async function teardownFailedWorktreeCreate(
  worktreePath: string,
  repoRoot: string,
  opts?: { prune?: boolean; restoreConfig?: boolean },
): Promise<void> {
  if (await isWorktreePathRemovable(worktreePath)) {
    await execFileNoThrowWithCwd(
      gitExe(),
      ['worktree', 'remove', '--force', worktreePath],
      { cwd: repoRoot, env: gitWorktreeEnv() },
    )
    if (opts?.prune) {
      await execFileNoThrowWithCwd(gitExe(), ['worktree', 'prune'], {
        cwd: repoRoot,
        env: gitWorktreeEnv(),
      })
    }
  } else {
    await unlinkDanglingWorktreeGitPointer(worktreePath)
  }
  if (opts?.restoreConfig) {
    await restoreWorktreeConfigExtension(repoRoot)
  }
}

// Flatten nested slugs (`user/feature` → `user+feature`) for both the branch
// name and the directory path. Nesting in either location is unsafe:
//   - git refs: `worktree-user` (file) vs `worktree-user/feature` (needs dir)
//     is a D/F conflict that git rejects.
//   - directory: `.claude/worktrees/user/feature/` lives inside the `user`
//     worktree; `git worktree remove` on the parent deletes children with
//     uncommitted work.
// `+` is valid in git branch names and filesystem paths but NOT in the
// slug-segment allowlist ([a-zA-Z0-9._-]), so the mapping is injective.
function flattenSlug(slug: string): string {
  return slug.replaceAll('/', '+')
}

export function worktreeBranchName(slug: string): string {
  return `worktree-${flattenSlug(slug)}`
}

function worktreePathFor(repoRoot: string, slug: string): string {
  return join(worktreesDir(repoRoot), flattenSlug(slug))
}

/**
 * densable `DXi` foreign-repo guard (2.1.216 #9):
 * When resuming an existing worktree dir, compare the parent of its
 * `gitdir:` pointer against `<repoGitDir>/worktrees` by **dev+ino**
 * (not string path). A leftover directory from another project's
 * worktree with the same slug must not be silently resumed.
 *
 * densable gold:
 *   me("git_worktree_create","git_worktree_resume_foreign_repo")
 *   "The worktree directory at ${n} belongs to a different repository
 *    (registered under ${dirname(gitdir)}, expected under ${S}).
 *    Remove that directory or choose a different worktree name."
 */
export async function assertWorktreeNotForeignRepo(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  const worktreeGitDir = await readWorktreeGitDir(worktreePath)
  const repoGitDir = await resolveGitDir(repoRoot)
  if (!worktreeGitDir || !repoGitDir) {
    return
  }
  const expectedWorktreesDir = join(repoGitDir, 'worktrees')
  const registeredParent = dirname(worktreeGitDir)
  let registeredStat: Awaited<ReturnType<typeof stat>> | null
  let expectedStat: Awaited<ReturnType<typeof stat>> | 'enoent' | null
  try {
    ;[registeredStat, expectedStat] = await Promise.all([
      stat(registeredParent).catch(() => null),
      stat(expectedWorktreesDir).catch(err =>
        isENOENT(err) ? ('enoent' as const) : null,
      ),
    ])
  } catch {
    return
  }
  // densable: both stats present and (expected enoent OR dev/ino mismatch) → foreign
  if (
    registeredStat !== null &&
    expectedStat !== null &&
    (expectedStat === 'enoent' ||
      registeredStat.dev !== expectedStat.dev ||
      registeredStat.ino !== expectedStat.ino)
  ) {
    logEvent('git_worktree_resume_foreign_repo', {})
    throw new Error(
      `The worktree directory at ${worktreePath} belongs to a different repository (registered under ${registeredParent}, expected under ${expectedWorktreesDir}). Remove that directory or choose a different worktree name.`,
    )
  }
}

/**
 * Creates a new git worktree for the given slug, or resumes it if it already exists.
 * Named worktrees reuse the same path across invocations, so the existence check
 * prevents unconditionally running `git fetch` (which can hang waiting for credentials)
 * on every resume.
 */
async function getOrCreateWorktree(
  repoRoot: string,
  slug: string,
  options?: { prNumber?: number },
): Promise<WorktreeCreateResult> {
  const worktreePath = worktreePathFor(repoRoot, slug)
  const worktreeBranch = worktreeBranchName(slug)

  // Fast resume path: if the worktree already exists skip fetch and creation.
  // Read the .git pointer file directly (no subprocess, no upward walk) — a
  // subprocess `rev-parse HEAD` burns ~15ms on spawn overhead even for a 2ms
  // task, and the await yield lets background spawnSyncs pile on (seen at 55ms).
  const existingHead = await readWorktreeHeadSha(worktreePath)
  if (existingHead) {
    // densable 2.1.216 #9: refuse leftover worktree from another repository
    await assertWorktreeNotForeignRepo(repoRoot, worktreePath)
    // densable 2.1.238 ODt: refuse core.worktree redirect / checkout-above
    await assertIsolationWorktreeAllowed(
      worktreePath,
      [],
      liveLaunchDirs(getCwd(), repoRoot),
    )
    // densable zHt: s = fromHead ?? (!prNumber && baseRef==="head")
    const fromHead =
      !options?.prNumber && getInitialSettings().worktree?.baseRef === 'head'
    const baseline = await readWorktreeBaseline(worktreePath)
    if (!fromHead && !options?.prNumber) {
      const resetTo = await resetResumedWorktreeIfFullyUpstream(
        repoRoot,
        worktreePath,
        worktreeBranch,
        existingHead,
        baseline,
      )
      if (resetTo) {
        return {
          worktreePath,
          worktreeBranch,
          headCommit: resetTo,
          existed: true,
          refreshed: true,
        }
      }
    }
    return {
      worktreePath,
      worktreeBranch,
      headCommit: baseline ?? existingHead,
      existed: true,
    }
  }

  // densable 2.1.212 xqi: refuse symlink at .claude / worktrees / target
  // before any mkdir or `git worktree add` that could follow it out of tree.
  await assertWorktreeCreatePathsNotSymlinked(repoRoot, worktreePath)

  // New worktree: fetch base branch then add
  await mkdir(worktreesDir(repoRoot), { recursive: true })

  const fetchEnv = gitWorktreeEnv()

  let baseBranch: string
  let baseSha: string | null = null
  if (options?.prNumber) {
    // densable 2.1.233 #1: provider-aware fetch refs (NEr/Hod/Oxr).
    // gitlab → merge-requests only; github → pull only; other → [pull, mr].
    const fetchSpecs = await resolvePrFetchSpecs(repoRoot, options.prNumber)
    let lastErr = ''
    let fetched = false
    for (const spec of fetchSpecs) {
      const { code: prFetchCode, stderr: prFetchStderr } =
        await execFileNoThrowWithCwd(gitExe(), ['fetch', 'origin', spec], {
          cwd: repoRoot,
          stdin: 'ignore',
          env: fetchEnv,
        })
      if (prFetchCode === 0) {
        fetched = true
        break
      }
      lastErr = prFetchStderr.trim()
    }
    if (!fetched) {
      throw new Error(
        `Failed to fetch PR/MR #${options.prNumber}: ${lastErr || 'it may not exist, the fetch may have timed out, or the repository may not have a remote named "origin"'}`,
      )
    }
    baseBranch = 'FETCH_HEAD'
  } else {
    // If origin/<branch> already exists locally, skip fetch. In large repos
    // (210k files, 16M objects) fetch burns ~6-8s on a local commit-graph
    // scan before even hitting the network. A slightly stale base is fine —
    // the user can pull in the worktree if they want latest.
    // resolveRef reads the loose/packed ref directly; when it succeeds we
    // already have the SHA, so the later rev-parse is skipped entirely.
    const [defaultBranch, gitDir] = await Promise.all([
      getDefaultBranch(),
      resolveGitDir(repoRoot),
    ])
    const originRef = `origin/${defaultBranch}`
    const originSha = gitDir
      ? await resolveRef(gitDir, `refs/remotes/origin/${defaultBranch}`)
      : null
    if (originSha) {
      baseBranch = originRef
      baseSha = originSha
    } else {
      const { code: fetchCode } = await execFileNoThrowWithCwd(
        gitExe(),
        ['fetch', 'origin', defaultBranch],
        { cwd: repoRoot, stdin: 'ignore', env: fetchEnv },
      )
      baseBranch = fetchCode === 0 ? originRef : 'HEAD'
    }
  }

  // For the fetch/PR-fetch paths we still need the SHA — the fs-only resolveRef
  // above only covers the "origin/<branch> already exists locally" case.
  if (!baseSha) {
    const { stdout, code: shaCode } = await execFileNoThrowWithCwd(
      gitExe(),
      ['rev-parse', baseBranch],
      { cwd: repoRoot, env: gitWorktreeEnv() },
    )
    if (shaCode !== 0) {
      throw new Error(
        `Failed to resolve base branch "${baseBranch}": git rev-parse failed`,
      )
    }
    baseSha = stdout.trim()
  }

  const sparsePaths = getInitialSettings().worktree?.sparsePaths
  const addArgs = ['worktree', 'add']
  if (sparsePaths?.length) {
    addArgs.push('--no-checkout')
  }
  // -B (not -b): reset any orphan branch left behind by a removed worktree dir.
  // Saves a `git branch -D` subprocess (~15ms spawn overhead) on every create.
  addArgs.push('-B', worktreeBranch, worktreePath, baseBranch)

  const { code: createCode, stderr: createStderr } =
    await execFileNoThrowWithCwd(gitExe(), addArgs, {
      cwd: repoRoot,
      env: gitWorktreeEnv(),
    })
  if (createCode !== 0) {
    // densable: me("git_worktree_create", "git_worktree_create_add_failed")
    logEvent('git_worktree_create_add_failed', {})
    // densable PHt → M4 remove / else EHt+CHt `.git`
    if (await readWorktreeHeadSha(worktreePath)) {
      await teardownFailedWorktreeCreate(worktreePath, repoRoot)
    }
    throw new Error(`Failed to create worktree: ${createStderr}`)
  }

  // densable: post-add realpath containment (defense in depth after xqi)
  // Official `g`: M4 remove+prune, else unlink `.git`, then rethrow.
  try {
    await assertWorktreeCreateContainment(worktreePath)
  } catch (error) {
    await teardownFailedWorktreeCreate(worktreePath, repoRoot, { prune: true })
    throw error
  }

  if (sparsePaths?.length) {
    // Linked sparse worktrees require extensions.worktreeConfig=true in the
    // main repo. Official 2.1.207: set it when missing so sparse-checkout
    // works, and clear it after the last sparse worktree is removed (go-git
    // tools like tea break if the key is left behind).
    await ensureExtensionsWorktreeConfig(repoRoot)
    // If sparse-checkout or checkout fail after --no-checkout, the worktree
    // is registered and HEAD is set but the working tree is empty. Next run's
    // fast-resume (rev-parse HEAD) would succeed and present a broken worktree
    // as "resumed". Tear it down before propagating the error.
    // densable `h`: M4 remove (no prune) else unlink `.git`; then Mne.
    const tearDown = async (msg: string): Promise<never> => {
      await teardownFailedWorktreeCreate(worktreePath, repoRoot, {
        restoreConfig: true,
      })
      throw new Error(msg)
    }
    const { code: sparseCode, stderr: sparseErr } =
      await execFileNoThrowWithCwd(
        gitExe(),
        ['sparse-checkout', 'set', '--cone', '--', ...sparsePaths],
        { cwd: worktreePath, env: gitWorktreeEnv() },
      )
    if (sparseCode !== 0) {
      await tearDown(`Failed to configure sparse-checkout: ${sparseErr}`)
    }
    const { code: coCode, stderr: coErr } = await execFileNoThrowWithCwd(
      gitExe(),
      ['checkout', 'HEAD'],
      { cwd: worktreePath, env: gitWorktreeEnv() },
    )
    if (coCode !== 0) {
      await tearDown(`Failed to checkout sparse worktree: ${coErr}`)
    }
  }

  // densable vjr(r,u) — CLAUDE_BASE in the worktree git admin dir.
  await writeWorktreeBaseline(worktreePath, baseSha)
  return {
    worktreePath,
    worktreeBranch,
    headCommit: baseSha,
    baseBranch,
    existed: false,
  }
}

/**
 * Copy gitignored files specified in .worktreeinclude from base repo to worktree.
 *
 * Only copies files that are BOTH:
 * 1. Matched by patterns in .worktreeinclude (uses .gitignore syntax)
 * 2. Gitignored (not tracked by git)
 *
 * Uses `git ls-files --others --ignored --exclude-standard --directory` to list
 * gitignored entries with fully-ignored dirs collapsed to single entries (so large
 * build outputs like node_modules/ don't force a full tree walk), then filters
 * against .worktreeinclude patterns in-process using the `ignore` library. If a
 * .worktreeinclude pattern explicitly targets a path inside a collapsed directory,
 * that directory is expanded with a second scoped `ls-files` call.
 */
// densable 2.1.239 Cs — first path segment before sep.
function firstPathSegment(s: string, sep: string): string {
  const i = s.indexOf(sep)
  return i === -1 ? s : s.slice(0, i)
}

// densable 2.1.239 — expand a --directory collapsed gitignored dir when a
// .worktreeinclude pattern names it (literal / anchored glob / globstar first
// segment) or ignore() already matches the dir.
export function shouldExpandCollapsedWorktreeIncludeDir(
  dir: string,
  patterns: string[],
  matcher: { ignores: (path: string) => boolean },
): boolean {
  if (
    patterns.some(p => {
      const normalized = p.startsWith('/') ? p.slice(1) : p
      if (normalized.startsWith(dir)) return true
      const globIdx = normalized.search(/[*?[]/)
      if (globIdx > 0) {
        const literalPrefix = normalized.slice(0, globIdx)
        if (dir.startsWith(literalPrefix)) return true
      }
      let rest = normalized
      while (rest.startsWith('**/')) rest = rest.slice(3)
      if (rest !== normalized) {
        const head = firstPathSegment(rest, '/')
        const headGlob = head.search(/[*?[]/)
        const needle = (headGlob === -1 ? head : head.slice(0, headGlob))
          .replace(/\\/g, '')
          .toLowerCase()
        if (needle.length > 0) {
          const segs = dir
            .slice(0, -1)
            .split('/')
            .map(s => s.toLowerCase())
          if (
            headGlob === -1
              ? segs.includes(needle)
              : segs.some(s => s.startsWith(needle))
          ) {
            return true
          }
        }
      }
      return false
    })
  ) {
    return true
  }
  return matcher.ignores(dir.slice(0, -1)) || matcher.ignores(dir)
}

export async function copyWorktreeIncludeFiles(
  repoRoot: string,
  worktreePath: string,
): Promise<string[]> {
  let includeContent: string
  try {
    includeContent = await readFile(join(repoRoot, '.worktreeinclude'), 'utf-8')
  } catch {
    return []
  }

  const patterns = filterCompilableIgnorePatterns(
    includeContent
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')),
    'worktreeinclude',
  )
  if (patterns.length === 0) {
    return []
  }

  // Single pass with --directory: collapses fully-gitignored dirs (node_modules/,
  // .turbo/, etc.) into single entries instead of listing every file inside.
  // In a large repo this cuts ~500k entries/~7s down to ~hundreds of entries/~100ms.
  const gitignored = await execFileNoThrowWithCwd(
    gitExe(),
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd: repoRoot, env: gitWorktreeEnv() },
  )
  if (gitignored.code !== 0 || !gitignored.stdout.trim()) {
    return []
  }

  const entries = gitignored.stdout.trim().split('\n').filter(Boolean)
  // Official 2.1.207: only compilable patterns enter `ignore()` (bad bracket
  // globs etc. are dropped with a warn rather than throwing).
  const matcher = ignore().add(patterns)

  // --directory emits collapsed dirs with a trailing slash; everything else is
  // an individual file.
  const collapsedDirs = entries.filter(e => e.endsWith('/'))
  const files = entries.filter(e => !e.endsWith('/') && matcher.ignores(e))

  // Edge case: a .worktreeinclude pattern targets a path inside a collapsed dir
  // (e.g. pattern `config/secrets/api.key` when all of `config/secrets/` is
  // gitignored with no tracked siblings). Expand only dirs where a pattern has
  // that dir as its explicit path prefix, an anchored glob's literal prefix,
  // a globstar whose first literal segment lands in the dir (2.1.239), or the
  // dir itself matches a pattern.
  const dirsToExpand = collapsedDirs.filter(dir =>
    shouldExpandCollapsedWorktreeIncludeDir(dir, patterns, matcher),
  )
  if (dirsToExpand.length > 0) {
    const expanded = await execFileNoThrowWithCwd(
      gitExe(),
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        ...dirsToExpand,
      ],
      { cwd: repoRoot, env: gitWorktreeEnv() },
    )
    if (expanded.code === 0 && expanded.stdout.trim()) {
      for (const f of expanded.stdout.trim().split('\n').filter(Boolean)) {
        if (matcher.ignores(f)) {
          files.push(f)
        }
      }
    }
  }
  const copied: string[] = []

  for (const relativePath of files) {
    const srcPath = join(repoRoot, relativePath)
    const destPath = join(worktreePath, relativePath)
    try {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
      copied.push(relativePath)
    } catch (e: unknown) {
      logForDebugging(
        `Failed to copy ${relativePath} to worktree: ${(e as Error).message}`,
        { level: 'warn' },
      )
    }
  }

  if (copied.length > 0) {
    logForDebugging(
      `Copied ${copied.length} files from .worktreeinclude: ${copied.join(', ')}`,
    )
  }

  return copied
}

/**
 * Post-creation setup for a newly created worktree.
 * Propagates settings.local.json, configures git hooks, and symlinks directories.
 */
async function performPostCreationSetup(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  // Copy settings.local.json to the worktree's .claude directory
  // This propagates local settings (which may contain secrets) to the worktree
  const localSettingsRelativePath =
    getRelativeSettingsFilePathForSource('localSettings')
  const sourceSettingsLocal = join(repoRoot, localSettingsRelativePath)
  try {
    const destSettingsLocal = join(worktreePath, localSettingsRelativePath)
    await mkdirRecursive(dirname(destSettingsLocal))
    await copyFile(sourceSettingsLocal, destSettingsLocal)
    logForDebugging(
      `Copied settings.local.json to worktree: ${destSettingsLocal}`,
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logForDebugging(
        `Failed to copy settings.local.json: ${(e as Error).message}`,
        { level: 'warn' },
      )
    }
  }

  // Configure the worktree to use hooks from the main repository
  // This solves issues with .husky and other git hooks that use relative paths
  const huskyPath = join(repoRoot, '.husky')
  const gitHooksPath = join(repoRoot, '.git', 'hooks')
  let hooksPath: string | null = null
  for (const candidatePath of [huskyPath, gitHooksPath]) {
    try {
      const s = await stat(candidatePath)
      if (s.isDirectory()) {
        hooksPath = candidatePath
        break
      }
    } catch {
      // Path doesn't exist or can't be accessed
    }
  }
  if (hooksPath) {
    // `git config` (no --worktree flag) writes to the main repo's .git/config,
    // shared by all worktrees. Once set, every subsequent worktree create is a
    // no-op — skip the subprocess (~14ms spawn) when the value already matches.
    const gitDir = await resolveGitDir(repoRoot)
    const configDir = gitDir ? ((await getCommonDir(gitDir)) ?? gitDir) : null
    const existing = configDir
      ? await parseGitConfigValue(configDir, 'core', null, 'hooksPath')
      : null
    if (existing !== hooksPath) {
      const { code: configCode, stderr: configError } =
        await execFileNoThrowWithCwd(
          gitExe(),
          ['config', 'core.hooksPath', hooksPath],
          { cwd: worktreePath, env: gitWorktreeEnv() },
        )
      if (configCode === 0) {
        logForDebugging(
          `Configured worktree to use hooks from main repository: ${hooksPath}`,
        )
      } else {
        logForDebugging(`Failed to configure hooks path: ${configError}`, {
          level: 'error',
        })
      }
    }
  }

  // Symlink directories to avoid disk bloat (opt-in via settings)
  const settings = getInitialSettings()
  const dirsToSymlink = settings.worktree?.symlinkDirectories ?? []
  if (dirsToSymlink.length > 0) {
    await symlinkDirectories(repoRoot, worktreePath, dirsToSymlink)
  }

  // Copy gitignored files specified in .worktreeinclude (best-effort)
  await copyWorktreeIncludeFiles(repoRoot, worktreePath)

  // The core.hooksPath config-set above is fragile: husky's prepare script
  // (`git config core.hooksPath .husky`) runs on every `bun install` and
  // resets the SHARED .git/config value back to relative, causing each
  // worktree to resolve to its OWN .husky/ again. The attribution hook
  // file isn't tracked (it's in .git/info/exclude), so fresh worktrees
  // don't have it. Install it directly into the worktree's .husky/ —
  // husky won't delete it (husky install is additive-only), and for
  // non-husky repos this resolves to the shared .git/hooks/ (idempotent).
  //
  // Pass the worktree-local .husky explicitly: getHooksDir would return
  // the absolute core.hooksPath we just set above (main repo's .husky),
  // not the worktree's — `git rev-parse --git-path hooks` echoes the config
  // value verbatim when it's absolute.
  if (feature('COMMIT_ATTRIBUTION')) {
    const worktreeHooksDir =
      hooksPath === huskyPath ? join(worktreePath, '.husky') : undefined
    void import('./postCommitAttribution.js')
      .then(m =>
        m
          .installPrepareCommitMsgHook(worktreePath, worktreeHooksDir)
          .catch(error => {
            logForDebugging(
              `Failed to install attribution hook in worktree: ${error}`,
            )
          }),
      )
      .catch(error => {
        // Dynamic import() itself rejected (module load failure). The inner
        // .catch above only handles installPrepareCommitMsgHook rejection —
        // without this outer handler an import failure would surface as an
        // unhandled promise rejection.
        logForDebugging(`Failed to load postCommitAttribution module: ${error}`)
      })
  }
}

/**
 * densable 2.1.233 `tVo` / `rVo` / `Npb` — PR/MR URL parse for --worktree.
 *
 * Accepts:
 * - GitHub / GHE: `…/owner/repo/pull/123`
 * - GitLab: `…/group/project/-/merge_requests/123` (nested groups ok)
 * - Bitbucket: `…/owner/repo/pull-requests/123`
 * - `#N` / `!N` short forms
 */
export type CodeChangeProvider =
  | 'github'
  | 'github-enterprise'
  | 'gitlab'
  | 'bitbucket'

export type ParsedCodeChangeRef = {
  prNumber: number
  prUrl: string
  prRepository: string
  provider: CodeChangeProvider
}

/** densable tVo — capture repo path + number from PR/MR URLs */
const CODE_CHANGE_URL_RE =
  /https?:\/\/[^/\s"]+\/([^\s"]+?)\/(?:pull|pull-requests|-\/merge_requests)\/(\d+)/i

/** densable Npb */
export function codeChangeProviderFromUrl(url: string): CodeChangeProvider {
  if (url.includes('/-/merge_requests/')) return 'gitlab'
  if (url.includes('/pull-requests/')) return 'bitbucket'
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
  } catch {
    return 'github-enterprise'
  }
  return 'github-enterprise'
}

/**
 * densable Hod — extract hostname from a git remote URL (https or scp-like).
 * Returns null for file:// / invalid.
 */
export function gitRemoteHostname(remoteUrl: string): string | null {
  const t = remoteUrl.trim()
  if (!t || t.startsWith('file:')) return null
  if (t.includes('://')) {
    try {
      return new URL(t).hostname || null
    } catch {
      return null
    }
  }
  // scp-like: git@host:owner/repo
  const m = /^(?:[^@:/]+@)?([^:/]+):/.exec(t)
  return m?.[1] ?? null
}

/**
 * densable Oxr / dm — forge kind from hostname (not full URL path).
 * github.com (+ www.) → github; gitlab.com → gitlab; bitbucket.org → bitbucket.
 */
export function codeChangeProviderFromHostname(
  hostname: string | null | undefined,
): 'github' | 'gitlab' | 'bitbucket' | 'other' {
  if (!hostname) return 'other'
  let t = hostname.toLowerCase()
  while (t.startsWith('www.')) t = t.slice(4)
  // densable dm(e) — github.com and common GH enterprise-looking hosts treated as github for fetch ref
  if (t === 'github.com' || t.endsWith('.github.com')) return 'github'
  if (t === 'gitlab.com' || t.endsWith('.gitlab.com')) return 'gitlab'
  if (t === 'bitbucket.org' || t.endsWith('.bitbucket.org')) return 'bitbucket'
  // many self-hosted still use github-style pull/ refs; densable "other" tries both
  return 'other'
}

/**
 * densable worktree PR fetch ref list:
 *   gitlab → [merge-requests/N/head]
 *   github → [pull/N/head]
 *   other  → [pull/N/head, merge-requests/N/head]
 *
 * densable does not try bitbucket pull-requests/from in this path.
 */
export function prFetchSpecsForProvider(
  provider: 'github' | 'gitlab' | 'bitbucket' | 'other',
  prNumber: number,
): string[] {
  const pull = `pull/${prNumber}/head`
  const mr = `merge-requests/${prNumber}/head`
  if (provider === 'gitlab') return [mr]
  if (provider === 'github') return [pull]
  // other (and bitbucket in densable) try github then gitlab shapes
  return [pull, mr]
}

/**
 * densable NEr + Oxr — resolve origin URL at repoRoot and pick fetch specs.
 */
export async function resolvePrFetchSpecs(
  repoRoot: string,
  prNumber: number,
): Promise<string[]> {
  const { code, stdout } = await execFileNoThrowWithCwd(
    gitExe(),
    ['remote', 'get-url', 'origin'],
    { cwd: repoRoot, preserveOutputOnError: false, env: gitWorktreeEnv() },
  )
  let remoteUrl: string | null =
    code === 0 && stdout.trim() ? stdout.trim() : null
  if (!remoteUrl) {
    // densable NEr: fall back to first named remote
    const listed = await execFileNoThrowWithCwd(gitExe(), ['remote'], {
      cwd: repoRoot,
      preserveOutputOnError: false,
      env: gitWorktreeEnv(),
    })
    const first =
      listed.code === 0
        ? listed.stdout
            .trim()
            .split(/\r?\n/)
            .map(s => s.trim())
            .find(Boolean)
        : undefined
    if (first) {
      const u = await execFileNoThrowWithCwd(
        gitExe(),
        ['remote', 'get-url', first],
        { cwd: repoRoot, preserveOutputOnError: false, env: gitWorktreeEnv() },
      )
      if (u.code === 0 && u.stdout.trim()) remoteUrl = u.stdout.trim()
    }
  }
  const host = remoteUrl ? gitRemoteHostname(remoteUrl) : null
  const provider = codeChangeProviderFromHostname(host)
  return prFetchSpecsForProvider(provider, prNumber)
}

/** densable rVo — full parse from a URL string */
export function parseCodeChangeUrl(input: string): ParsedCodeChangeRef | null {
  const t = input.match(CODE_CHANGE_URL_RE)
  if (t?.[1] && t?.[2]) {
    return {
      prNumber: parseInt(t[2], 10),
      prUrl: t[0],
      prRepository: t[1],
      provider: codeChangeProviderFromUrl(t[0]),
    }
  }
  return null
}

/**
 * Parses a PR/MR reference from a string for --worktree.
 * Returns the PR/MR number or null if the string is not a recognized reference.
 */
export function parsePRReference(input: string): number | null {
  const fromUrl = parseCodeChangeUrl(input.trim())
  if (fromUrl) return fromUrl.prNumber

  // GitHub-style PR URL (strict path: owner/repo/pull/N only)
  const urlMatch = input.match(
    /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)\/?(?:[?#].*)?$/i,
  )
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10)
  }

  // #N (GitHub) or !N (GitLab MR shorthand)
  const shortMatch = input.match(/^[#!](\d+)$/)
  if (shortMatch?.[1]) {
    return parseInt(shortMatch[1], 10)
  }

  return null
}

/** densable identifier prefix for agents display: GitLab uses !N, else #N */
export function codeChangeNumberPrefix(
  provider: CodeChangeProvider,
): '!' | '#' {
  return provider === 'gitlab' ? '!' : '#'
}

export async function isTmuxAvailable(): Promise<boolean> {
  const { code } = await execFileNoThrow('tmux', ['-V'])
  return code === 0
}

export function getTmuxInstallInstructions(): string {
  const platform = getPlatform()
  switch (platform) {
    case 'macos':
      return 'Install tmux with: brew install tmux'
    case 'linux':
    case 'wsl':
      return 'Install tmux with: sudo apt install tmux (Debian/Ubuntu) or sudo dnf install tmux (Fedora/RHEL)'
    case 'windows':
      return 'tmux is not natively available on Windows. Consider using WSL or Cygwin.'
    default:
      return 'Install tmux using your system package manager.'
  }
}

export async function createTmuxSessionForWorktree(
  sessionName: string,
  worktreePath: string,
): Promise<{ created: boolean; error?: string }> {
  const { code, stderr } = await execFileNoThrow('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    worktreePath,
  ])

  if (code !== 0) {
    return { created: false, error: stderr }
  }

  return { created: true }
}

export async function killTmuxSession(sessionName: string): Promise<boolean> {
  const { code } = await execFileNoThrow('tmux', [
    'kill-session',
    '-t',
    sessionName,
  ])
  return code === 0
}

export async function createWorktreeForSession(
  sessionId: string,
  slug: string,
  tmuxSessionName?: string,
  options?: { prNumber?: number },
): Promise<WorktreeSession> {
  // Must run before the hook branch below — hooks receive the raw slug as an
  // argument, and the git branch builds a path from it via path.join.
  validateWorktreeSlug(slug)

  const originalCwd = getCwd()

  // Assemble locally first. SEA EZn: ODt(s.worktreePath) then rwe(s).
  // Do not assign the process-global session before the pin check — a
  // refuse must leave getCurrentWorktreeSession() unchanged. Disk orphan
  // on ODt fail is also SEA; do not invent cleanup.
  let session: WorktreeSession
  if (hasWorktreeCreateHook()) {
    const hookResult = await executeWorktreeCreateHook(slug)
    logForDebugging(
      `Created hook-based worktree at: ${hookResult.worktreePath}`,
    )

    session = {
      originalCwd,
      worktreePath: hookResult.worktreePath,
      worktreeName: slug,
      sessionId,
      tmuxSessionName,
      hookBased: true,
    }
  } else {
    // Fall back to git worktree
    const gitRoot = findGitRoot(getCwd())
    if (!gitRoot) {
      throw new Error(
        'Cannot create a worktree: not in a git repository and no WorktreeCreate hooks are configured. ' +
          'Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.',
      )
    }

    const originalBranch = await getBranch()

    const createStart = Date.now()
    const { worktreePath, worktreeBranch, headCommit, existed } =
      await getOrCreateWorktree(gitRoot, slug, options)

    let creationDurationMs: number | undefined
    if (existed) {
      logForDebugging(`Resuming existing worktree at: ${worktreePath}`)
    } else {
      logForDebugging(
        `Created worktree at: ${worktreePath} on branch: ${worktreeBranch}`,
      )
      await performPostCreationSetup(gitRoot, worktreePath)
      creationDurationMs = Date.now() - createStart
    }

    // densable Cjr @216884155 — write `git worktree lock` after create/resume.
    const locked = await lockClaudeWorktree(
      worktreePath,
      gitRoot,
      slug,
      'session',
    )
    session = {
      originalCwd,
      worktreePath,
      worktreeName: slug,
      worktreeBranch,
      originalBranch,
      originalHeadCommit: headCommit,
      sessionId,
      tmuxSessionName,
      creationDurationMs,
      enteredExisting: locked ? undefined : true,
      usedSparsePaths:
        (getInitialSettings().worktree?.sparsePaths?.length ?? 0) > 0,
    }
  }

  await assertIsolationWorktreeAllowed(
    session.worktreePath,
    [],
    liveLaunchDirs(originalCwd, findCanonicalGitRoot(originalCwd)),
  )

  currentWorktreeSession = session
  saveCurrentProjectConfig(current => ({
    ...current,
    activeWorktreeSession: session,
  }))

  return session
}

export async function keepWorktree(): Promise<void> {
  if (!currentWorktreeSession) {
    return
  }

  try {
    const session = currentWorktreeSession
    const { worktreePath, originalCwd, worktreeBranch } = session
    // densable qHt(originalCwd, worktreePath) — unlock cwd for Ejr.
    const lockGitRoot = resolveWorktreeLockGitRoot(originalCwd, worktreePath)

    // Change back to original directory first (densable oK(s) uses qHt root).
    try {
      process.chdir(lockGitRoot)
    } catch (error) {
      logForDebugging(
        `Could not chdir to original directory while keeping worktree: ${error}`,
      )
      process.chdir(originalCwd)
    }

    // densable Qfr / Ejr — release our lock when we owned it (!enteredExisting && !hook).
    if (!session.enteredExisting && !session.hookBased) {
      await releaseOwnWorktreeLock(worktreePath, lockGitRoot)
    }

    // Clear the session but keep the worktree intact
    currentWorktreeSession = null

    // Update config
    saveCurrentProjectConfig(current => ({
      ...current,
      activeWorktreeSession: undefined,
    }))

    logForDebugging(
      `Linked worktree preserved at: ${worktreePath}${worktreeBranch ? ` on branch: ${worktreeBranch}` : ''}`,
    )
    logForDebugging(
      `You can continue working there by running: cd ${worktreePath}`,
    )
  } catch (error) {
    logForDebugging(`Error keeping worktree: ${error}`, {
      level: 'error',
    })
  }
}

function clearActiveWorktreeSession(): void {
  currentWorktreeSession = null
  saveCurrentProjectConfig(current => ({
    ...current,
    activeWorktreeSession: undefined,
  }))
}

/**
 * densable Ajr @216896631 — `git branch -D --end-of-options`.
 * emr: `{logSuccess:true}`. W7: `{errorLabel}` only (no success log).
 */
async function deleteWorktreeBranch(
  cwd: string,
  branch: string,
  opts?: { logSuccess?: boolean; errorLabel?: string },
): Promise<boolean> {
  const { code, stderr } = await execFileNoThrowWithCwd(
    gitExe(),
    ['branch', '-D', '--end-of-options', branch],
    { cwd, env: gitWorktreeEnv() },
  )
  if (code !== 0) {
    logForDebugging(
      `${opts?.errorLabel ?? 'Could not delete worktree branch'}: ${stderr}`,
      { level: 'error' },
    )
    return false
  }
  if (opts?.logSuccess) {
    logForDebugging(`Deleted worktree branch: ${branch}`)
  }
  return true
}

/**
 * densable emr @216891333.
 * Returns false when the worktree was kept. Official `!n` → true.
 */
export async function cleanupWorktree(persist?: {
  storageV5?: unknown
  credentials?: unknown
}): Promise<boolean> {
  if (!currentWorktreeSession) {
    return true
  }

  try {
    const { worktreePath, originalCwd, worktreeBranch, hookBased } =
      currentWorktreeSession
    const gitRoot = findCanonicalGitRoot(originalCwd) ?? originalCwd

    process.chdir(originalCwd)

    let hookRemoved = false
    if (hookBased) {
      hookRemoved = await executeWorktreeRemoveHook(worktreePath, persist)
      if (hookRemoved) {
        logForDebugging(`Removed hook-based worktree at: ${worktreePath}`)
      } else if (hasWorktreeRemoveHook()) {
        logForDebugging(
          `WorktreeRemove hook did not remove worktree, kept at: ${worktreePath}`,
          { level: 'warn' },
        )
        clearActiveWorktreeSession()
        return false
      } else {
        logForDebugging(
          `No WorktreeRemove hook configured; falling back to git worktree remove for: ${worktreePath}`,
        )
      }
    }

    if (!hookRemoved) {
      try {
        const lockReason = await porcelainLockReason(worktreePath, gitRoot)
        if (!canReapDespiteLock(lockReason)) {
          logForDebugging(
            `cleanupWorktree: kept ${worktreePath} — locked by another live Claude Code process, or with a reason we did not write (${lockReason || 'no reason'})`,
            { level: 'warn' },
          )
          clearActiveWorktreeSession()
          return false
        }
        await unlockAgentWorktree(worktreePath, gitRoot)
        let skipReparse = false
        if (hookBased && getPlatform() === 'windows') {
          const listed = await listPorcelainWorktrees(gitRoot).catch(() => null)
          if (listed != null) {
            skipReparse = true
            const here = await realpath(worktreePath).catch(() => worktreePath)
            for (const row of listed) {
              if (
                here ===
                (await realpath(row.worktreePath).catch(() => row.worktreePath))
              ) {
                skipReparse = false
                break
              }
            }
          }
        }
        if (!skipReparse && !(await isWorktreePathRemovable(worktreePath))) {
          logForDebugging(
            `Kept linked worktree — unremovable reparse point in ${worktreePath}`,
            { level: 'warn' },
          )
          clearActiveWorktreeSession()
          return false
        }
        const { code: removeCode, stderr: removeError } =
          await execFileNoThrowWithCwd(
            gitExe(),
            ['worktree', 'remove', '--force', worktreePath],
            { cwd: gitRoot, env: gitWorktreeEnv() },
          )
        if (removeCode !== 0) {
          const stillThere = await lstat(worktreePath).then(
            () => true,
            () => false,
          )
          if (stillThere) {
            logForDebugging(
              `Failed to remove linked worktree, kept ${worktreePath}: ${removeError.trim()}`,
              { level: 'warn' },
            )
            clearActiveWorktreeSession()
            return false
          }
        }
        logForDebugging(`Removed linked worktree at: ${worktreePath}`)
        await restoreWorktreeConfigExtension(gitRoot)
      } catch (error) {
        const stillThere = await lstat(worktreePath).then(
          () => true,
          () => false,
        )
        if (stillThere) {
          logForDebugging(
            `cleanupWorktree: kept ${worktreePath} — cannot read the worktree registry to verify lock ownership (${errorMessage(error)})`,
            { level: 'warn' },
          )
          clearActiveWorktreeSession()
          return false
        }
        logForDebugging(
          `cleanupWorktree: worktree registry unreadable and ${worktreePath} is already gone (${errorMessage(error)}); continuing to the already-removed path`,
        )
      }
    }

    clearActiveWorktreeSession()

    // densable Ajr({logSuccess:!0}) — git-based only, after session clear
    if (!hookBased && worktreeBranch) {
      await sleep(100)
      await deleteWorktreeBranch(gitRoot, worktreeBranch, { logSuccess: true })
    }

    logForDebugging('Linked worktree cleaned up completely')
    return true
  } catch (error) {
    logForDebugging(`Error cleaning up worktree: ${error}`, {
      level: 'error',
    })
    return false
  }
}

/**
 * Create a lightweight worktree for a subagent.
 * Reuses getOrCreateWorktree/performPostCreationSetup but does NOT touch
 * global session state (currentWorktreeSession, process.chdir, project config).
 * Falls back to hook-based creation if not in a git repository.
 */
export async function createAgentWorktree(slug: string): Promise<{
  worktreePath: string
  worktreeBranch?: string
  headCommit?: string
  gitRoot?: string
  hookBased?: boolean
}> {
  validateWorktreeSlug(slug)

  const fromCwd = getCwd()

  // Try hook-based worktree creation first (allows user-configured VCS)
  if (hasWorktreeCreateHook()) {
    const hookResult = await executeWorktreeCreateHook(slug)
    logForDebugging(
      `Created hook-based agent worktree at: ${hookResult.worktreePath}`,
    )
    await assertIsolationWorktreeAllowed(
      hookResult.worktreePath,
      [],
      liveLaunchDirs(fromCwd),
    )

    return { worktreePath: hookResult.worktreePath, hookBased: true }
  }

  // Fall back to git worktree
  // findCanonicalGitRoot (not findGitRoot) so agent worktrees always land in
  // the main repo's .claude/worktrees/ even when spawned from inside a session
  // worktree — otherwise they nest at <worktree>/.claude/worktrees/ and the
  // periodic cleanup (which scans the canonical root) never finds them.
  const gitRoot = findCanonicalGitRoot(getCwd())
  if (!gitRoot) {
    throw new Error(
      'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured. ' +
        'Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.',
    )
  }

  const { worktreePath, worktreeBranch, headCommit, existed } =
    await getOrCreateWorktree(gitRoot, slug)

  if (!existed) {
    logForDebugging(
      `Created agent worktree at: ${worktreePath} on branch: ${worktreeBranch}`,
    )
    await performPostCreationSetup(gitRoot, worktreePath)
  } else {
    // Bump mtime so the periodic stale-worktree cleanup doesn't consider this
    // worktree stale — the fast-resume path is read-only and leaves the original
    // creation-time mtime intact, which can be past the 30-day cutoff.
    const now = new Date()
    await utimes(worktreePath, now, now)
    logForDebugging(`Resuming existing agent worktree at: ${worktreePath}`)
  }

  // densable Cjr @216895517 — agents always take the lock (kind=agent).
  await lockClaudeWorktree(worktreePath, gitRoot, slug, 'agent')

  await assertIsolationWorktreeAllowed(
    worktreePath,
    [],
    liveLaunchDirs(fromCwd, gitRoot),
  )

  return { worktreePath, worktreeBranch, headCommit, gitRoot }
}

/**
 * densable p / Rtb / ef @207666xxx — Turkish-i / long-s fold for M4 and Xy.
 */
function foldWorktreePathCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u017F/g, 's')
}

/**
 * densable Xy — case-fold on windows/macos for $Xe relative retry.
 */
function foldWorktreePathCompare(value: string): string {
  const platform = getPlatform()
  return platform === 'windows' || platform === 'macos'
    ? foldWorktreePathCase(value)
    : value
}

/**
 * densable ie — UNC host, or null for device-ns that is not `\\?\UNC\`.
 */
function worktreeUncHost(path: string): string | null {
  if (/^[\\/]{2}[?.][\\/](?!unc[\\/])/i.test(path)) return null
  return (
    path
      .match(/^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)/i)?.[1]
      ?.replace(/[A-Z]/g, c => c.toLowerCase()) ?? null
  )
}

/**
 * densable P — UNC `//`/`\\` or NT `\??\`.
 */
function isWorktreeUncOrNtObject(path: string): boolean {
  return /^[\\/]{2}/.test(path) || isNtObjectNamespacePathNormalized(path)
}

/**
 * densable ae — UNC/NT path that is device/NT/dotted, or a different host than cwd.
 */
function isWorktreeUncForeignToCwd(path: string, cwd: string): boolean {
  if (!isWorktreeUncOrNtObject(path)) return false
  if (
    isWindowsDeviceNamespacePath(path) ||
    isNtObjectNamespacePathNormalized(path)
  ) {
    return true
  }
  if (hasPathDotSegment(path)) return true
  const host = worktreeUncHost(path)
  return host === null || host !== worktreeUncHost(cwd)
}

/**
 * densable $o / MXe. Official `J`/`N` stubs are false/null, so only ae arms run.
 */
function isWorktreePathNetworkRelativeToCwd(
  path: string,
  cwd: string,
): boolean {
  const resolved = resolve(cwd, path)
  return (
    isWorktreeUncForeignToCwd(path, cwd) ||
    isWorktreeUncForeignToCwd(resolved, cwd)
  )
}

/**
 * densable Ine — Windows `//`/`\\` prefix after win32.normalize.
 */
function isWindowsUncPrefix(path: string): boolean {
  return getPlatform() === 'windows' && /^[\\/]{2}/.test(path)
}

/**
 * densable xXe @216885408 — `Ine(win32.normalize)||Ip(n,true)||MXe(e,cwd)`.
 * Ip is containsVulnerableUncPath (official kr / sI).
 */
function isWorktreeNetworkPath(path: string, cwd: string): boolean {
  const normalized = win32.normalize(path)
  return (
    isWindowsUncPrefix(normalized) ||
    containsVulnerableUncPath(normalized, true) ||
    isWorktreePathNetworkRelativeToCwd(path, cwd)
  )
}

/**
 * densable w @207665954 — try unlink/rmdir a Windows reparse; recurse children.
 * true = unremovable (M4 then false).
 */
async function tryRemoveReparsePointBeforeRemoval(
  path: string,
  expected: string | null,
): Promise<boolean> {
  try {
    await unlink(path)
    logForDebugging(`[worktree] unlinked reparse point before removal: ${path}`)
    return false
  } catch {
    // not a file-like reparse
  }
  try {
    await rmdir(path)
    logForDebugging(
      `[worktree] removed reparse point or empty directory before removal: ${path}`,
    )
    return false
  } catch (error) {
    if (isENOENT(error)) return false
    if (getErrnoCode(error) !== 'ENOTEMPTY') {
      const kind = await readlink(path).then(
        () => 'link' as const,
        (readError: unknown) =>
          getErrnoCode(readError) === 'EINVAL' || isENOENT(readError)
            ? ('not-link' as const)
            : ('unknown' as const),
      )
      const resolved =
        kind !== 'not-link' || expected === null
          ? null
          : await realpath(path)
              .then(value => foldWorktreePathCase(value))
              .catch(() => null)
      if (
        resolved === null ||
        (resolved !== expected && !resolved.startsWith(expected + sep))
      ) {
        logForDebugging(
          `[worktree] refusing to enumerate unremovable entry before removal: ${path}`,
          { level: 'warn' },
        )
        return true
      }
    }
  }
  const entries = await readdir(path, { withFileTypes: true }).catch(error =>
    isENOENT(error) ? [] : null,
  )
  if (entries === null) {
    logForDebugging(
      `[worktree] could not enumerate ${path} before removal; not certifying`,
      { level: 'warn' },
    )
    return true
  }
  let unremovable = false
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.isDirectory()) {
      unremovable =
        (await tryRemoveReparsePointBeforeRemoval(
          join(path, entry.name),
          expected,
        )) || unremovable
    }
  }
  return unremovable
}

/**
 * densable M4 / Stb / j @207666760.
 * Non-Windows → true. Windows → !w(path, fold(join(realpath(parent), basename))).
 *
 * Reads as a predicate but MUTATES on Windows: it unlinks/rmdirs reparse points
 * and empty directories under `path` so the `git worktree remove --force` that
 * follows can succeed. Only call it once removal is already decided — both
 * current callers do (cleanupWorktree has unlocked by then; the other is
 * create-failure teardown). A `false` return means teardown is incomplete, not
 * that the worktree is untouched.
 */
export async function isWorktreePathRemovable(path: string): Promise<boolean> {
  if (getPlatform() !== 'windows') return true
  const parentReal = await realpath(dirname(path)).catch(() => null)
  return !(await tryRemoveReparsePointBeforeRemoval(
    path,
    parentReal === null
      ? null
      : foldWorktreePathCase(join(parentReal, basename(path))),
  ))
}

/**
 * densable $Xe @216866269 — walk relative components from root; first symlink
 * or unreadable component. Jc is identity. Null = no symlink on the suffix
 * (or relative escapes the root).
 */
export async function findWorktreePathSymlinkComponent(
  worktreePath: string,
  root: string,
): Promise<{ component: string; kind: 'symlink' | 'unverifiable' } | null> {
  if (hasPathDotSegment(worktreePath) || hasPathDotSegment(root)) {
    return { component: worktreePath, kind: 'unverifiable' }
  }
  const isBadRelative = (rel: string): boolean =>
    !rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  let rel = relative(root, worktreePath)
  if (isBadRelative(rel)) {
    rel = relative(
      foldWorktreePathCompare(root),
      foldWorktreePathCompare(worktreePath),
    )
    if (isBadRelative(rel)) return null
  }
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part)
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(cursor)
    } catch (error) {
      if (isENOENT(error)) return null
      return { component: cursor, kind: 'unverifiable' }
    }
    if (st.isSymbolicLink()) {
      return { component: cursor, kind: 'symlink' }
    }
  }
  return null
}

/**
 * densable si / Ea @206556923 — git root still has `.git` (cache heal on ENOENT).
 * Returns the root string or null (official `===null` test).
 */
export async function resolveGitRootIfPresent(
  path: string,
): Promise<string | null> {
  const root = findGitRoot(path)
  if (root === null) return null
  try {
    await lstat(join(root, '.git'))
    return root
  } catch (error) {
    if (!isENOENT(error) && getErrnoCode(error) !== 'ENOTDIR') return root
    findGitRoot.cache.delete(path)
    return findGitRoot(path)
  }
}

/**
 * densable si / cjr — git root still has a `.git` (cache heal on ENOENT).
 */
async function stillResolvesToRepository(path: string): Promise<boolean> {
  return (await resolveGitRootIfPresent(path)) !== null
}

/**
 * densable Kb(yt(), path, {surfaceNetworkRaw, anchor}). Dynamic import
 * avoids worktree ↔ bgIsolationContainment load cycle.
 */
async function resolveWorktreeAncestry(
  path: string,
  cwd: string,
): Promise<string | undefined> {
  const { eq, getEqFs } = await import('./bgIsolationContainment.js')
  return eq(getEqFs(), path, { surfaceNetworkRaw: true, anchor: cwd })
}

function refuseNoRootRemoval(
  worktreePath: string,
  reason: string,
): RemoveAgentWorktreeResult {
  logForDebugging(
    `removeAgentWorktree: refused no-root removal of ${worktreePath} — ${reason}`,
    { level: 'warn' },
  )
  return { outcome: 'failed', errorSummary: reason }
}

function removedNoRoot(
  reason: string,
  extras?: { hookBased?: boolean; alreadyGone?: boolean },
): RemoveAgentWorktreeResult {
  logEvent('tengu_worktree_removed', {
    source:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    changed_files: 0,
    commits: 0,
    ...(extras?.hookBased ? { hook_based: true } : { no_root: 1 }),
    ...(extras?.alreadyGone ? { already_gone: 1 } : {}),
  })
  return { outcome: 'removed' }
}

/**
 * densable Ane @216896913 — no-root (or hook-path safety fail) removal.
 */
export async function removeAgentWorktreeWithoutGitRoot(
  worktreePath: string,
  reason: string,
  expectedResolvedPath?: string,
  hookManaged?: boolean,
): Promise<RemoveAgentWorktreeResult> {
  if (!isAbsolute(worktreePath)) {
    return refuseNoRootRemoval(worktreePath, 'path is not absolute')
  }
  const cwd = getCwd()
  const isNetwork = (value: string): boolean =>
    isWorktreeNetworkPath(value, cwd)
  if (isNetwork(worktreePath)) {
    return refuseNoRootRemoval(worktreePath, 'network path (UNC or automount)')
  }
  if (hasPathDotSegment(worktreePath)) {
    return refuseNoRootRemoval(worktreePath, 'unverifiable symlinked ancestor')
  }
  const landed = await resolveWorktreeAncestry(worktreePath, cwd)
  if (landed === WORKTREE_UNVERIFIED_ANCESTRY) {
    return refuseNoRootRemoval(worktreePath, 'unverifiable symlinked ancestor')
  }
  if (landed !== undefined && isNetwork(landed)) {
    return refuseNoRootRemoval(worktreePath, 'network path (UNC or automount)')
  }
  if (landed !== undefined && hasPathDotSegment(landed)) {
    return refuseNoRootRemoval(worktreePath, 'unverifiable symlinked ancestor')
  }
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(worktreePath)
  } catch (error) {
    if (!isENOENT(error) && getErrnoCode(error) !== 'ENOTDIR') {
      return refuseNoRootRemoval(
        worktreePath,
        `cannot stat the directory (${getErrnoCode(error) ?? 'unknown error'})`,
      )
    }
    logForDebugging(
      hookManaged
        ? `removeAgentWorktree: ${worktreePath} already gone — nothing left to remove (hook-managed)`
        : `removeAgentWorktree: ${worktreePath} already gone and no git root resolves — nothing left to remove`,
    )
    return removedNoRoot(
      reason,
      hookManaged
        ? { alreadyGone: true, hookBased: true }
        : { alreadyGone: true },
    )
  }
  if (!st.isDirectory()) {
    return refuseNoRootRemoval(worktreePath, 'not a directory')
  }
  const canonical = await realpath(worktreePath).catch(() => null)
  if (canonical === null) {
    return refuseNoRootRemoval(worktreePath, 'could not canonicalize the path')
  }
  if (isNetwork(canonical)) {
    return refuseNoRootRemoval(worktreePath, 'network path (UNC or automount)')
  }
  if (
    expectedResolvedPath !== undefined &&
    canonical !== expectedResolvedPath
  ) {
    return refuseNoRootRemoval(worktreePath, WORKTREE_RESOLUTION_CHANGED)
  }
  const parent = dirname(canonical)
  if (
    parent === canonical ||
    basename(parent) !== 'worktrees' ||
    basename(dirname(parent)) !== '.claude'
  ) {
    return refuseNoRootRemoval(
      worktreePath,
      'not directly under a .claude/worktrees directory',
    )
  }
  if (await stillResolvesToRepository(canonical)) {
    return refuseNoRootRemoval(worktreePath, 'still resolves to a repository')
  }
  const entries = await readdir(canonical).catch(() => null)
  if (entries === null) {
    return refuseNoRootRemoval(worktreePath, 'unreadable directory')
  }
  if (entries.length > 0 && reason !== 'job_delete_force') {
    logForDebugging(
      `removeAgentWorktree: kept rootless ${worktreePath} — ${entries.length} unverifiable file(s); only an explicit discard may remove them`,
      { level: 'warn' },
    )
    logEvent('tengu_worktree_removed', {
      source:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      changed_files: 0,
      commits: 0,
      no_root: 1,
      aborted: 1,
    })
    return {
      outcome: 'failed',
      errorSummary: WORKTREE_UNVERIFIABLE_FILES,
      needsForce: true,
    }
  }
  if ((await realpath(canonical).catch(() => null)) !== canonical) {
    return refuseNoRootRemoval(worktreePath, WORKTREE_RESOLUTION_CHANGED)
  }
  if (!(await isWorktreePathRemovable(canonical))) {
    logForDebugging(
      `removeAgentWorktree: aborted ${reason} removal — unremovable reparse point in ${worktreePath}`,
      { level: 'warn' },
    )
    return {
      outcome: 'failed',
      errorSummary: WORKTREE_UNREMOVABLE_REPARSE,
    }
  }
  if (
    (await realpath(canonical).catch(error =>
      isENOENT(error) ? canonical : null,
    )) !== canonical
  ) {
    return refuseNoRootRemoval(worktreePath, WORKTREE_RESOLUTION_CHANGED)
  }
  await rm(canonical, { recursive: true, force: true })
  logForDebugging(`Removed agent worktree with no git root at: ${worktreePath}`)
  return removedNoRoot(reason)
}

/** densable W7 return. Slu/blu treat anything except `failed` as success. */
export type RemoveAgentWorktreeResult = {
  outcome: 'failed' | 'removed' | 'left_in_place'
  errorSummary?: string
  needsForce?: boolean
}

/**
 * densable W7 @216899222.
 * `reason` default `"unknown"`. Slu `"job_retention_sweep"`, blu `"stale_cleanup"`,
 * deleteJob `"job_delete"` / `"job_delete_force"`.
 */
export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
  hookBased?: boolean,
  reason = 'unknown',
  expectedResolvedPath?: string,
  extra?: string,
  persist?: { storageV5?: unknown; credentials?: unknown },
): Promise<RemoveAgentWorktreeResult> {
  if (hookBased) {
    if (
      !isAbsolute(worktreePath) ||
      hasPathDotSegment(worktreePath) ||
      isWorktreeNetworkPath(worktreePath, getCwd())
    ) {
      return removeAgentWorktreeWithoutGitRoot(
        worktreePath,
        reason,
        expectedResolvedPath,
        true,
      )
    }
    let hookPath = worktreePath
    if (expectedResolvedPath !== undefined) {
      const cwd = getCwd()
      const landed = await resolveWorktreeAncestry(worktreePath, cwd)
      if (
        landed === WORKTREE_UNVERIFIED_ANCESTRY ||
        (landed !== undefined &&
          (isWorktreeNetworkPath(landed, cwd) || hasPathDotSegment(landed)))
      ) {
        return removeAgentWorktreeWithoutGitRoot(
          worktreePath,
          reason,
          expectedResolvedPath,
          true,
        )
      }
      let st: Awaited<ReturnType<typeof lstat>>
      try {
        st = await lstat(worktreePath)
      } catch (error) {
        if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') {
          return removeAgentWorktreeWithoutGitRoot(
            worktreePath,
            reason,
            expectedResolvedPath,
            true,
          )
        }
        return {
          outcome: 'failed',
          errorSummary: `cannot stat the worktree path (${getErrnoCode(error) ?? 'unknown error'})`,
        }
      }
      if (st.isSymbolicLink()) {
        logForDebugging(
          `removeAgentWorktree: refused hook removal of ${worktreePath} — stored worktree path is a symlink`,
          { level: 'warn' },
        )
        return {
          outcome: 'failed',
          errorSummary:
            'the stored worktree path is a symlink — remove the link itself to clear this session',
        }
      }
      for (const root of new Set(
        [gitRoot, extra].filter((value): value is string => Boolean(value)),
      )) {
        const component = await findWorktreePathSymlinkComponent(
          worktreePath,
          root,
        )
        if (component) {
          logForDebugging(
            `removeAgentWorktree: refused hook removal of ${worktreePath} — ${component.kind} at ${component.component}`,
            { level: 'warn' },
          )
          return {
            outcome: 'failed',
            errorSummary:
              component.kind === 'symlink'
                ? 'a component of the stored worktree path is a symlink — remove the worktree at its resolved location (or the link, if the worktree is already gone), then retry'
                : 'a component of the stored worktree path could not be verified — check its permissions, then retry',
          }
        }
      }
      if (reason !== 'job_delete_force') {
        const entries = await readdir(worktreePath).catch(() => null)
        if (entries === null) {
          return { outcome: 'failed', errorSummary: 'unreadable directory' }
        }
        if (entries.length > 0) {
          logForDebugging(
            `removeAgentWorktree: kept hook worktree ${worktreePath} — ${entries.length} unverifiable file(s); only an explicit discard may dispatch the remove hook`,
            { level: 'warn' },
          )
          logEvent('tengu_worktree_removed', {
            source:
              reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            changed_files: 0,
            commits: 0,
            hook_based: true,
            aborted: 1,
          })
          return {
            outcome: 'failed',
            errorSummary: WORKTREE_UNVERIFIABLE_FILES,
            needsForce: true,
          }
        }
      }
      let resolved: string
      try {
        resolved = await realpath(worktreePath)
      } catch (error) {
        if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') {
          return removeAgentWorktreeWithoutGitRoot(
            worktreePath,
            reason,
            expectedResolvedPath,
            true,
          )
        }
        return {
          outcome: 'failed',
          errorSummary: `cannot resolve the worktree path (${getErrnoCode(error) ?? 'unknown error'})`,
        }
      }
      if (resolved !== expectedResolvedPath) {
        logForDebugging(
          `removeAgentWorktree: refused hook removal of ${worktreePath} — ${WORKTREE_RESOLUTION_CHANGED}`,
          { level: 'warn' },
        )
        return {
          outcome: 'failed',
          errorSummary: WORKTREE_RESOLUTION_CHANGED,
        }
      }
      if (isWorktreeNetworkPath(resolved, cwd)) {
        return removeAgentWorktreeWithoutGitRoot(
          worktreePath,
          reason,
          expectedResolvedPath,
          true,
        )
      }
      hookPath = expectedResolvedPath
    }
    if (await executeWorktreeRemoveHook(hookPath, persist)) {
      logEvent('tengu_worktree_removed', {
        source:
          reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        changed_files: 0,
        commits: 0,
        hook_based: true,
      })
      logForDebugging(`Removed hook-based agent worktree at: ${worktreePath}`)
      return { outcome: 'removed' }
    }
    logForDebugging(
      `WorktreeRemove hook did not remove agent worktree, left at: ${worktreePath}`,
      { level: 'warn' },
    )
    return {
      outcome: 'failed',
      errorSummary: 'WorktreeRemove hook failed',
    }
  }

  if (!gitRoot) {
    return removeAgentWorktreeWithoutGitRoot(
      worktreePath,
      reason,
      expectedResolvedPath,
    )
  }

  const status = await execFileNoThrowWithCwd(
    gitExe(),
    ['status', '--porcelain'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  let changedFiles =
    status.code === 0 && status.stdout.trim()
      ? status.stdout.trim().split('\n').length
      : 0
  if (changedFiles > 0 && (await isWorktreeToplevelElsewhere(worktreePath))) {
    changedFiles = 0
  }
  if (
    changedFiles > 0 &&
    reason !== 'exit_tool' &&
    reason !== 'exit_dialog' &&
    reason !== 'job_delete_force'
  ) {
    logForDebugging(
      `removeAgentWorktree: aborted ${reason} removal — ${changedFiles} changed file(s) would be lost, kept ${worktreePath}`,
      { level: 'warn' },
    )
    logEvent('tengu_worktree_removed', {
      source:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      changed_files: changedFiles,
      commits: 0,
      aborted: 1,
    })
    return {
      outcome: 'failed',
      errorSummary: `${changedFiles} changed file(s) would be lost`,
    }
  }

  let alreadyGone = false
  if (expectedResolvedPath !== undefined) {
    const resolved = await realpath(worktreePath).catch((error: unknown) => {
      if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') return null
      return undefined
    })
    // null = already gone (official `d=!0`, skip reparse). mismatch → xne.
    if (resolved === null) {
      alreadyGone = true
    } else if (resolved === undefined || resolved !== expectedResolvedPath) {
      return {
        outcome: 'failed',
        errorSummary: WORKTREE_RESOLUTION_CHANGED,
      }
    }
  }

  if (!alreadyGone && !(await isWorktreePathRemovable(worktreePath))) {
    logForDebugging(
      `removeAgentWorktree: aborted ${reason} removal — unremovable reparse point in ${worktreePath}`,
      { level: 'warn' },
    )
    return {
      outcome: 'failed',
      errorSummary: WORKTREE_UNREMOVABLE_REPARSE,
    }
  }

  let checkedOutBranch: string | null = null
  if (worktreeBranch) {
    const symbolic = await execFileNoThrowWithCwd(
      gitExe(),
      ['symbolic-ref', '--short', '-q', 'HEAD'],
      { cwd: worktreePath, env: gitWorktreeEnv() },
    )
    checkedOutBranch = symbolic.code === 0 ? symbolic.stdout.trim() : null
  }

  await unlockAgentWorktree(worktreePath, gitRoot)

  const { code: removeCode, stderr: removeError } =
    await execFileNoThrowWithCwd(
      gitExe(),
      ['worktree', 'remove', '--force', worktreePath],
      { cwd: gitRoot, env: gitWorktreeEnv({ LC_ALL: 'C' }) },
    )

  const stillExists = await lstat(worktreePath).then(
    () => true,
    () => false,
  )
  if (removeCode !== 0 && stillExists) {
    if (WORKTREE_NOT_REGISTERED.test(removeError)) {
      const prune = await execFileNoThrowWithCwd(
        gitExe(),
        ['worktree', 'prune'],
        { cwd: gitRoot, env: gitWorktreeEnv() },
      )
      const pruned = prune.code === 0
      await restoreWorktreeConfigExtension(gitRoot)
      logForDebugging(
        pruned
          ? `removeAgentWorktree: git no longer recognizes ${worktreePath} (${removeError.trim()}) — pruned the stale registration, left the directory in place`
          : `removeAgentWorktree: git no longer recognizes ${worktreePath} (${removeError.trim()}) — registration already unreachable; prune from ${gitRoot} failed (${prune.stderr.trim()}), left the directory in place`,
        { level: 'warn' },
      )
      logEvent('tengu_worktree_removed', {
        source:
          reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        changed_files: changedFiles,
        commits: 0,
        left_in_place: 1,
        ...(pruned ? { deregistered_stale: 1 } : {}),
      })
      return { outcome: 'left_in_place' }
    }
    logForDebugging(
      `removeAgentWorktree: git worktree remove failed, kept ${worktreePath}: ${removeError.trim()}`,
      { level: 'warn' },
    )
    const summary = removeError.trim().replace(/^(fatal|error|warning):\s*/, '')
    return {
      outcome: 'failed',
      ...(summary ? { errorSummary: summary } : {}),
    }
  }

  logForDebugging(`Removed agent worktree at: ${worktreePath}`)
  await restoreWorktreeConfigExtension(gitRoot)
  logEvent('tengu_worktree_removed', {
    source:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    changed_files: changedFiles,
    commits: 0,
  })
  if (!worktreeBranch) {
    return { outcome: 'removed' }
  }
  if (checkedOutBranch !== worktreeBranch) {
    logForDebugging(
      `removeAgentWorktree: kept branch ${worktreeBranch} — not the checked-out branch (${checkedOutBranch ?? 'detached or dir gone'}), so no safety check ever verified it`,
    )
    return { outcome: 'removed' }
  }
  await deleteWorktreeBranch(gitRoot, worktreeBranch, {
    errorLabel: 'Could not delete agent worktree branch',
  })
  return { outcome: 'removed' }
}

/** densable BHt — creation marker in the per-worktree git admin dir. */
export const CLAUDE_BASE = 'CLAUDE_BASE'

/** densable fH — lock reason we wrote (`claude agent|session … (pid N)`). */
const CLAUDE_WORKTREE_LOCK_REASON =
  /^claude (?:agent|session) .{1,255} \(pid (\d{1,10})(?: start (.{1,255}))?\)$/

/** densable ljr — object id written by vjr (rev-parse SHA). */
function isWorktreeBaselineSha(value: string): boolean {
  return /^[0-9a-f]{12,64}$/.test(value)
}

/**
 * densable Cwe — per-worktree gitdir from `<worktree>/.git` pointer.
 * Official refusals before resolve: symlink `.git` (OHt), network-relative
 * gitdir (MXe), and dot-segment in the raw pointer (DHt). Local OGr
 * `readWorktreeGitDir` is the resolve-only half — do not call it alone here.
 */
async function resolveWorktreeGitAdminDir(
  worktreePath: string,
): Promise<string | null> {
  try {
    const pointerPath = join(worktreePath, '.git')
    if ((await lstat(pointerPath)).isSymbolicLink()) {
      return null
    }
    const ptr = (await readFile(pointerPath, 'utf-8')).trim()
    if (!ptr.startsWith('gitdir:')) {
      return null
    }
    const raw = ptr.slice('gitdir:'.length).trim()
    if (isWorktreePathNetworkRelativeToCwd(raw, worktreePath)) {
      return null
    }
    if (hasPathDotSegment(raw)) {
      return null
    }
    return resolve(worktreePath, raw)
  } catch {
    return null
  }
}

/**
 * densable vjr — write CLAUDE_BASE into the worktree git admin dir.
 */
export async function writeWorktreeBaseline(
  worktreePath: string,
  headCommit: string,
): Promise<void> {
  const gitDir = await resolveWorktreeGitAdminDir(worktreePath)
  if (!gitDir) {
    logForDebugging(
      `[worktree] cannot write baseline: gitdir unresolvable for ${worktreePath}`,
    )
    return
  }
  try {
    await writeFile(join(gitDir, CLAUDE_BASE), headCommit, 'utf-8')
  } catch (error) {
    logForDebugging(
      `[worktree] failed to write baseline to ${gitDir}: ${errorMessage(error)}`,
    )
  }
}

/**
 * densable jHt — read CLAUDE_BASE; null if missing or not an object id.
 */
export async function readWorktreeBaseline(
  worktreePath: string,
): Promise<string | null> {
  const gitDir = await resolveWorktreeGitAdminDir(worktreePath)
  if (!gitDir) {
    return null
  }
  try {
    const value = (await readFile(join(gitDir, CLAUDE_BASE), 'utf-8')).trim()
    return isWorktreeBaselineSha(value) ? value : null
  } catch {
    return null
  }
}

/**
 * densable Rjr @216895771 — `rev-parse --show-toplevel` is not this
 * worktree (or a Windows case-fold of it). W7 then treats porcelain as
 * not this tree's dirt. LMs treats the same case as gitError.
 */
export async function isWorktreeToplevelElsewhere(
  worktreePath: string,
): Promise<boolean> {
  const top = await execFileNoThrowWithCwd(
    gitExe(),
    ['rev-parse', '--show-toplevel'],
    { cwd: worktreePath, env: gitWorktreeEnv({ LC_ALL: 'C' }) },
  )
  const toplevel = top.stdout.trim()
  if (top.code !== 0 || !toplevel) return false
  const topReal = resolve(await realpath(toplevel).catch(() => toplevel))
  const hereReal = resolve(
    await realpath(worktreePath).catch(() => worktreePath),
  )
  if (topReal === hereReal) return false
  return process.platform === 'win32'
    ? topReal.toLowerCase() !== hereReal.toLowerCase()
    : true
}

/** densable CMs — git root of the worktree, else originCwd. */
export function resolveJobWorktreeGitRoot(
  worktreePath: string,
  originCwd: string | undefined,
): string | null {
  const fromPath =
    findCanonicalGitRoot(worktreePath) ?? findGitRoot(worktreePath)
  if (fromPath && isWorktreeUnderClaudeWorktrees(worktreePath, fromPath)) {
    return fromPath
  }
  const fromOrigin = originCwd
    ? (findCanonicalGitRoot(originCwd) ?? findGitRoot(originCwd))
    : null
  return fromOrigin ?? fromPath
}

/** densable Sjr — dirname(worktree) === `<repo>/.claude/worktrees`. */
function isWorktreeUnderClaudeWorktrees(
  worktreePath: string,
  gitRoot: string,
): boolean {
  return resolve(dirname(worktreePath)) === resolve(worktreesDir(gitRoot))
}

type PorcelainWorktree = {
  worktreePath: string
  lockReason?: string
}

/** densable mH — `git worktree list --porcelain`. */
export async function listPorcelainWorktrees(
  gitRoot: string,
): Promise<PorcelainWorktree[]> {
  const { code, stdout, stderr } = await execFileNoThrowWithCwd(
    gitExe(),
    ['worktree', 'list', '--porcelain'],
    { cwd: gitRoot, timeout: 10_000, env: gitWorktreeEnv() },
  )
  if (code !== 0) {
    throw new Error(
      `\`git -C ${gitRoot} worktree list\` failed: ${stderr.trim() || `exit ${code}`}`,
    )
  }
  const rows: PorcelainWorktree[] = []
  let current: PorcelainWorktree | null = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) rows.push(current)
      current = { worktreePath: line.slice('worktree '.length) }
    } else if (current && (line === 'locked' || line.startsWith('locked '))) {
      current.lockReason = line.slice('locked'.length).trim()
    }
  }
  if (current) rows.push(current)
  return rows
}

/**
 * densable Tjr — lock pid is some other live process.
 * `n===process.pid || !j_(n)` → false.
 */
function isForeignLiveWorktreeLock(lockReason: string): boolean {
  const match = lockReason.match(CLAUDE_WORKTREE_LOCK_REASON)
  if (!match) return false
  const pid = Number(match[1])
  if (pid === process.pid || !isProcessRunning(pid)) return false
  return true
}

/**
 * densable WHt — foreign live lock whose start token still matches.
 * `n!==process.pid && j_(n) && await WF(n, t[2])`.
 */
async function isForeignLiveWorktreeLockWithStart(
  lockReason: string | undefined,
): Promise<boolean> {
  const match = lockReason?.match(CLAUDE_WORKTREE_LOCK_REASON)
  if (!match) return false
  const pid = Number(match[1])
  return (
    pid !== process.pid &&
    isProcessRunning(pid) &&
    (await processLstartMatches(pid, match[2]))
  )
}

/**
 * densable One — ok to remove: no lock, or our/dead `fH` lock.
 * Unknown lock reason → false (keep).
 */
export function canReapDespiteLock(lockReason: string | undefined): boolean {
  if (lockReason === undefined) return true
  if (!CLAUDE_WORKTREE_LOCK_REASON.test(lockReason)) return false
  return !isForeignLiveWorktreeLock(lockReason)
}

/**
 * densable vwe — refuse network / device / traversal paths in BMs/Mne.
 * Official `Ine(normalize)||Ip(t,true)||Hs(e)`; local hosts are the path.ts
 * equivalents already landed for those checks.
 */
function isRefusedWorktreeSweepPath(worktreePath: string): boolean {
  const normalized = normalize(worktreePath)
  return (
    containsPathTraversal(normalized) ||
    isNetworkUncPath(normalized) ||
    isWindowsDeviceNamespacePath(worktreePath) ||
    isNtObjectNamespacePathNormalized(worktreePath)
  )
}

/** densable ajr — fH lock whose pid is gone (`$ee`, not `!j_`). */
function isDeadClaudeWorktreeLock(lockReason: string | undefined): boolean {
  if (lockReason === undefined || lockReason.length > 512) return false
  const match = lockReason.match(CLAUDE_WORKTREE_LOCK_REASON)
  if (!match) return false
  return isProcessGone(Number(match[1]))
}

/** densable ylu / claudeWorktreeLockPid — parse Claude lock pid from porcelain. */
export function parseClaudeWorktreeLockPid(
  lockReason: string | undefined,
): number | null {
  const match = lockReason?.match(CLAUDE_WORKTREE_LOCK_REASON)
  if (!match) return null
  return Number(match[1])
}

/** densable ylu — export-table alias of parseClaudeWorktreeLockPid. */
export const claudeWorktreeLockPid = parseClaudeWorktreeLockPid

function worktreePathIdentityKey(worktreePath: string): string {
  const resolved = resolve(worktreePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * densable qHt @216890812 — git root for unlock/lock when leaving a session.
 * Official: `if (!sK(originalCwd)) return originalCwd; return d6(worktree) ?? bMs()`.
 */
function resolveWorktreeLockGitRoot(
  originalCwd: string,
  worktreePath: string,
): string {
  if (
    findCanonicalGitRoot(originalCwd) === null &&
    findGitRoot(originalCwd) === null
  ) {
    return originalCwd
  }
  return (
    findCanonicalGitRoot(worktreePath) ??
    findGitRoot(worktreePath) ??
    originalCwd
  )
}

/**
 * densable Cjr @216881038 / lockAgentWorktree — `git worktree lock --reason`.
 * Returns true when this process owns (or re-took) the lock; false → guest.
 */
async function lockClaudeWorktree(
  worktreePath: string,
  gitRoot: string,
  name: string,
  kind: 'session' | 'agent',
): Promise<boolean> {
  try {
    // densable HF(await ZC()).procStart — only `.procStart` (not procStartFt).
    const procStart = buildProcessStartIdentityFields(
      await ownProcStartAsync(),
    ).procStart
    const reason = procStart
      ? `claude ${kind} ${name} (pid ${process.pid} start ${procStart})`
      : `claude ${kind} ${name} (pid ${process.pid})`
    const tryLock = () =>
      execFileNoThrowWithCwd(
        gitExe(),
        ['worktree', 'lock', '--reason', reason, worktreePath],
        { cwd: gitRoot, env: gitWorktreeEnv() },
      )
    const first = await tryLock()
    if (first.code === 0) return true
    let existing: string | undefined
    try {
      existing = await porcelainLockReason(worktreePath, gitRoot)
    } catch (error) {
      logForDebugging(
        `[worktree] failed to lock ${kind} worktree ${worktreePath} and could not read the registry (${errorMessage(error)}); treating this session as a guest`,
      )
      return false
    }
    if (existing === undefined) {
      // Lock failed and porcelain shows no lock — do not claim ownership
      // (would unlock on exit via releaseOwnWorktreeLock / enteredExisting).
      logForDebugging(
        `[worktree] failed to lock ${kind} worktree ${worktreePath}: ${first.stderr.trim()}; treating this session as a guest`,
      )
      return false
    }
    if (
      !CLAUDE_WORKTREE_LOCK_REASON.test(existing) ||
      isForeignLiveWorktreeLock(existing)
    ) {
      logForDebugging(
        `[worktree] ${worktreePath} is already locked (${existing || 'no reason'}); leaving the existing lock in place — this session is a guest, not the owner`,
      )
      return false
    }
    if (
      Number(existing.match(CLAUDE_WORKTREE_LOCK_REASON)?.[1]) === process.pid
    ) {
      return true
    }
    await unlockAgentWorktree(worktreePath, gitRoot)
    const second = await tryLock()
    if (second.code !== 0) {
      logForDebugging(
        `[worktree] failed to re-lock ${kind} worktree ${worktreePath} after clearing a stale lock: ${second.stderr.trim()}; treating this session as a guest`,
      )
      return false
    }
    return true
  } catch (error) {
    logForDebugging(
      `[worktree] failed to lock ${kind} worktree ${worktreePath}: ${errorMessage(error)}; treating this session as a guest`,
    )
    return false
  }
}

/**
 * densable Ejr / releaseOwnWorktreeLock @216880667.
 * Unlock when One/canReapDespiteLock says the porcelain lock is ours or dead.
 */
export async function releaseOwnWorktreeLock(
  worktreePath: string,
  gitRoot: string,
): Promise<void> {
  try {
    if (canReapDespiteLock(await porcelainLockReason(worktreePath, gitRoot))) {
      await unlockAgentWorktree(worktreePath, gitRoot)
    }
  } catch (error) {
    logForDebugging(
      `[worktree] left the lock on ${worktreePath} — cannot read the worktree registry to verify ownership (${errorMessage(error)})`,
    )
  }
}

/** densable One / mayReleaseWorktreeLock — export alias of canReapDespiteLock. */
export async function mayReleaseWorktreeLock(
  lockReason: string | undefined,
): Promise<boolean> {
  return canReapDespiteLock(lockReason)
}

/** densable OI / unlockAgentWorktree. */
export async function unlockAgentWorktree(
  worktreePath: string,
  gitRoot: string,
): Promise<void> {
  await execFileNoThrowWithCwd(gitExe(), ['worktree', 'unlock', worktreePath], {
    cwd: gitRoot,
    env: gitWorktreeEnv(),
  })
}

/**
 * densable BMs / releaseStaleClaudeWorktreeLocks @216908202.
 * blu starts with `await BMs(t)`.
 */
export async function releaseStaleClaudeWorktreeLocks(
  gitRoot: string,
): Promise<number> {
  const listed = await listPorcelainWorktrees(gitRoot).catch(
    (error: unknown) => {
      logForDebugging(
        `releaseStaleClaudeWorktreeLocks: skipped — cannot read the worktree registry for ${gitRoot} (${errorMessage(error)})`,
      )
      return [] as PorcelainWorktree[]
    },
  )
  const currentPath = currentWorktreeSession?.worktreePath
  const currentKey =
    currentPath === undefined
      ? undefined
      : worktreePathIdentityKey(
          await realpath(currentPath).catch(() => currentPath),
        )
  let attempted = 0
  for (const row of listed) {
    if (
      currentKey !== undefined &&
      worktreePathIdentityKey(row.worktreePath) === currentKey
    ) {
      continue
    }
    if (isRefusedWorktreeSweepPath(row.worktreePath)) continue
    if (!isDeadClaudeWorktreeLock(row.lockReason)) continue
    const hasGit = await lstat(join(row.worktreePath, '.git')).then(
      () => true,
      () => false,
    )
    if (!hasGit) continue
    if (attempted >= STALE_LOCK_RELEASE_CAP) {
      logForDebugging(
        `releaseStaleClaudeWorktreeLocks: per-sweep cap of ${STALE_LOCK_RELEASE_CAP} reached for ${gitRoot}; remaining stale locks will be reconciled on later sweeps`,
      )
      break
    }
    let resolved: string
    try {
      resolved = await realpath(row.worktreePath)
    } catch {
      continue
    }
    if (isRefusedWorktreeSweepPath(resolved)) continue
    if (
      currentKey !== undefined &&
      worktreePathIdentityKey(resolved) === currentKey
    ) {
      continue
    }
    const reread = await listPorcelainWorktrees(gitRoot).catch(
      (error: unknown) => {
        logForDebugging(
          `releaseStaleClaudeWorktreeLocks: kept ${row.worktreePath} — cannot re-read the worktree registry at release time (${errorMessage(error)})`,
        )
        return [] as PorcelainWorktree[]
      },
    )
    const live = reread.find(item => item.worktreePath === row.worktreePath)
    if (
      !isDeadClaudeWorktreeLock(live?.lockReason) ||
      !canReapDespiteLock(live?.lockReason)
    ) {
      continue
    }
    await unlockAgentWorktree(row.worktreePath, gitRoot)
    attempted++
  }
  if (attempted > 0) {
    logForDebugging(
      `releaseStaleClaudeWorktreeLocks: attempted release of ${attempted} stale liveness lock(s) in ${gitRoot}`,
    )
    logEvent('tengu_worktree_stale_lock_released', { attempted })
  }
  return attempted
}

/**
 * densable Mne / restoreWorktreeConfigExtension @216904043.
 * blu: readdir fail → `return await Mne(t),0`; end → `return await Mne(t),a`.
 * W7 also calls Mne after remove / left_in_place.
 */
export async function restoreWorktreeConfigExtension(
  gitRoot: string,
): Promise<void> {
  try {
    const gitDir = await resolveGitDir(gitRoot)
    const common = gitDir ? ((await getCommonDir(gitDir)) ?? gitDir) : null
    if (!common) return
    const marker = await execFileNoThrowWithCwd(
      gitExe(),
      ['config', '--local', '--get', ENABLED_WORKTREE_CONFIG_KEY],
      { cwd: gitRoot, env: gitWorktreeEnv() },
    )
    if (marker.code !== 0) return
    try {
      if ((await lstat(join(common, 'config.worktree'))).size > 0) return
    } catch (error) {
      if (!isENOENT(error) && getErrnoCode(error) !== 'ENOTDIR') return
    }
    let remaining = 0
    for (const row of await listPorcelainWorktrees(gitRoot)) {
      if (isRefusedWorktreeSweepPath(row.worktreePath)) {
        remaining++
        continue
      }
      const missing = await lstat(row.worktreePath).then(
        () => false,
        (error: unknown) =>
          isENOENT(error) || getErrnoCode(error) === 'ENOTDIR',
      )
      if (missing && canReapDespiteLock(row.lockReason)) continue
      remaining++
    }
    if (remaining > 1) return
    const unset = await execFileNoThrowWithCwd(
      gitExe(),
      ['config', '--local', '--unset-all', 'extensions.worktreeConfig'],
      { cwd: gitRoot, env: gitWorktreeEnv() },
    )
    if (unset.code !== 0 && unset.code !== 5) return
    await execFileNoThrowWithCwd(
      gitExe(),
      ['config', '--local', '--unset-all', ENABLED_WORKTREE_CONFIG_KEY],
      { cwd: gitRoot, env: gitWorktreeEnv() },
    )
    logForDebugging(
      `Restored extensions.worktreeConfig in ${gitRoot} after removing its last linked worktree`,
    )
  } catch (error) {
    logForDebugging(
      `Could not restore extensions.worktreeConfig for ${gitRoot}: ${errorMessage(error)}`,
      { level: 'warn' },
    )
  }
}

/**
 * densable Dne — porcelain lockReason for this worktree path (realpath).
 */
async function porcelainLockReason(
  worktreePath: string,
  gitRoot: string,
): Promise<string | undefined> {
  const realWorktree = await realpath(worktreePath).catch(() => worktreePath)
  for (const row of await listPorcelainWorktrees(gitRoot)) {
    const realRow = await realpath(row.worktreePath).catch(
      () => row.worktreePath,
    )
    if (realWorktree === realRow) return row.lockReason
  }
  return undefined
}

/**
 * densable GHt — origin HEAD ref, else first of origin/main|master that exists.
 */
async function resolveOriginHeadRef(gitRoot: string): Promise<string | null> {
  const symbolic = await execFileNoThrowWithCwd(
    gitExe(),
    ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'],
    { cwd: gitRoot, env: gitWorktreeEnv() },
  )
  if (symbolic.code === 0 && symbolic.stdout.trim()) {
    return symbolic.stdout.trim()
  }
  for (const ref of ['origin/main', 'origin/master']) {
    const verified = await execFileNoThrowWithCwd(
      gitExe(),
      ['rev-parse', '--verify', '-q', ref],
      { cwd: gitRoot, env: gitWorktreeEnv() },
    )
    if (verified.code === 0) return ref
  }
  return null
}

/**
 * densable $jr — upstream track is `gone` and no unique cherry commits vs origin.
 */
async function isUpstreamGoneWithNoUniqueCommits(
  worktreePath: string,
  originHeadRef: string,
): Promise<boolean> {
  const head = await execFileNoThrowWithCwd(
    gitExe(),
    ['symbolic-ref', '-q', 'HEAD'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  const ref = head.stdout.trim()
  if (head.code !== 0 || !ref) return false
  const track = await execFileNoThrowWithCwd(
    gitExe(),
    ['for-each-ref', '--format=%(upstream:track,nobracket)', ref],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  if (track.code !== 0 || track.stdout.trim() !== 'gone') return false
  const cherry = await execFileNoThrowWithCwd(
    gitExe(),
    [
      'rev-list',
      '--cherry-pick',
      '--right-only',
      '--no-merges',
      '--max-count=1',
      `${originHeadRef}...HEAD`,
    ],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  return cherry.code === 0 && cherry.stdout.trim().length === 0
}

/**
 * densable UMs — no unique commits, HEAD===CLAUDE_BASE, or `$jr`.
 */
async function isJobWorktreeFullyUpstream(
  worktreePath: string,
  originHeadRef: string | null,
): Promise<boolean> {
  const unique = await execFileNoThrowWithCwd(
    gitExe(),
    ['rev-list', '--max-count=1', 'HEAD', '--not', '--remotes'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  if (unique.code !== 0) return false
  if (unique.stdout.trim().length === 0) return true
  const [head, baseline] = await Promise.all([
    execFileNoThrowWithCwd(gitExe(), ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      env: gitWorktreeEnv(),
    }),
    readWorktreeBaseline(worktreePath),
  ])
  if (head.code === 0 && baseline !== null && head.stdout.trim() === baseline) {
    return true
  }
  return (
    originHeadRef !== null &&
    (await isUpstreamGoneWithNoUniqueCommits(worktreePath, originHeadRef))
  )
}

/** densable Ljr — clean porcelain, then UMs. */
async function isJobWorktreeSafeToReap(
  worktreePath: string,
  originHeadRef: string | null,
): Promise<boolean> {
  const status = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'status', '--porcelain'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  if (status.code !== 0 || status.stdout.trim().length > 0) {
    return false
  }
  return isJobWorktreeFullyUpstream(worktreePath, originHeadRef)
}

/**
 * densable xMs @216867314 — reset a resumed worktree to origin when
 * previous work is fully upstream. vjr after reset.
 */
export async function resetResumedWorktreeIfFullyUpstream(
  gitRoot: string,
  worktreePath: string,
  worktreeBranch: string,
  currentHead: string,
  baseline: string | null,
): Promise<string | null> {
  const [defaultBranch, gitDir] = await Promise.all([
    getDefaultBranch(),
    resolveGitDir(gitRoot),
  ])
  const branch =
    defaultBranch && !defaultBranch.startsWith('-') ? defaultBranch : null
  const originSha =
    branch && gitDir
      ? await resolveRef(gitDir, `refs/remotes/origin/${branch}`)
      : null
  if (!originSha || originSha === currentHead) return null
  const symbolic = await execFileNoThrowWithCwd(
    gitExe(),
    ['symbolic-ref', '--short', '-q', 'HEAD'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  if (symbolic.code !== 0 || symbolic.stdout.trim() !== worktreeBranch) {
    return null
  }
  const status = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'status', '--porcelain'],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  if (status.code !== 0 || status.stdout.trim().length > 0) return null
  if (!(baseline !== null && currentHead === baseline)) {
    const originHead = await resolveOriginHeadRef(gitRoot)
    if (
      originHead === null ||
      !(await isUpstreamGoneWithNoUniqueCommits(worktreePath, originHead))
    ) {
      return null
    }
  }
  try {
    if (
      await isForeignLiveWorktreeLockWithStart(
        await porcelainLockReason(worktreePath, gitRoot),
      )
    ) {
      return null
    }
  } catch {
    return null
  }
  const reset = await execFileNoThrowWithCwd(
    gitExe(),
    ['reset', '--hard', originSha],
    { cwd: worktreePath, env: gitWorktreeEnv() },
  )
  if (reset.code !== 0) return null
  await writeWorktreeBaseline(worktreePath, originSha)
  logForDebugging(
    `[worktree] reset resumed worktree ${worktreePath} to ${originSha} — its previous work was fully upstream`,
  )
  return originSha
}

export type ReapJobWorktreeInput = {
  worktreePath: string
  worktreeBranch?: string
  originCwd?: string
  hookBased?: boolean
  cutoff: Date
}

/**
 * densable Slu / `reapJobWorktreeIfSafe` @216907170.
 * hookBased → false. jHt===null → keep (user / pre-marker worktree).
 * W7 reason `job_retention_sweep`. Do not call from cleanupStaleAgentWorktrees.
 */
export async function reapJobWorktreeIfSafe(
  input: ReapJobWorktreeInput,
): Promise<boolean> {
  const { worktreePath, worktreeBranch, originCwd, hookBased, cutoff } = input
  if (hookBased) return false
  const gitRoot = resolveJobWorktreeGitRoot(worktreePath, originCwd)
  if (!gitRoot || !isWorktreeUnderClaudeWorktrees(worktreePath, gitRoot)) {
    return false
  }
  let mtimeMs: number
  try {
    mtimeMs = (await stat(worktreePath)).mtimeMs
  } catch {
    return false
  }
  if (mtimeMs >= cutoff.getTime()) return false
  if ((await readWorktreeBaseline(worktreePath)) === null) {
    logForDebugging(
      `reapJobWorktreeIfSafe: kept ${worktreePath} — no Claude Code creation marker (${CLAUDE_BASE}) in its git admin dir, so Claude Code did not create it; not ours to remove`,
      { level: 'warn' },
    )
    return false
  }
  const realWorktree = await realpath(worktreePath).catch(() => worktreePath)
  const currentPath = currentWorktreeSession?.worktreePath
  if (currentPath) {
    const realCurrent = await realpath(currentPath).catch(() => currentPath)
    if (realWorktree === realCurrent) return false
  }
  // An unreadable registry must not read as "no lock found": canReapDespiteLock
  // returns true for an undefined reason, so falling through would drop the lock
  // check entirely and reap a worktree a live process still holds. Every other
  // uncertain branch in this function keeps the worktree, so this one does too.
  // (releaseStaleClaudeWorktreeLocks can degrade to [] because there an empty
  // list means "release nothing", which is the safe direction.)
  let listed: PorcelainWorktree[]
  try {
    listed = await listPorcelainWorktrees(gitRoot)
  } catch (error) {
    logForDebugging(
      `reapJobWorktreeIfSafe: kept ${worktreePath} — cannot read the worktree registry for ${gitRoot}, so a live lock cannot be ruled out (${errorMessage(error)})`,
      { level: 'warn' },
    )
    return false
  }
  let matched: PorcelainWorktree | undefined
  for (const row of listed) {
    const realRow = await realpath(row.worktreePath).catch(
      () => row.worktreePath,
    )
    if (realWorktree === realRow) {
      matched = row
      break
    }
  }
  if (!canReapDespiteLock(matched?.lockReason)) {
    logForDebugging(
      `reapJobWorktreeIfSafe: kept ${worktreePath} — locked by a live Claude Code process, or with a reason we did not write (${matched?.lockReason})`,
    )
    return false
  }
  if (
    !(await isJobWorktreeSafeToReap(
      worktreePath,
      await resolveOriginHeadRef(gitRoot),
    ))
  ) {
    return false
  }
  return (
    (
      await removeAgentWorktree(
        worktreePath,
        worktreeBranch,
        gitRoot,
        false,
        'job_retention_sweep',
      )
    ).outcome !== 'failed'
  )
}

/**
 * Slug patterns for throwaway worktrees created by AgentTool
 * (`agent-a<16hex>` / leftover `agent-a<7hex>` from earlyAgentId.slice(0,8)),
 * workflow engine isolation:'worktree' (`wf_<8hex>-<3hex>-<n>` derived from
 * sha256(runId:agentId) in claudeCodeBackend — taskId is `w`+base36, not a
 * UUID, so the slug cannot embed runId directly and is hashed to satisfy this
 * hex pattern), bridgeMain (`bridge-<safeFilenameId>`), template jobs
 * (`job-<name>-<8hex>`), and bg isolation (`bg-<name>-<8hex>`). These leak
 * when the parent process is killed (Ctrl+C, ESC, crash) before their
 * in-process cleanup runs. Exact-shape patterns avoid sweeping user-named
 * EnterWorktree slugs like `wf-myfeature`.
 */
const EPHEMERAL_WORKTREE_PATTERNS = [
  // densable 2.1.246 FMs — 16-hex AgentTool slug (newer) before the 7-hex
  // leftover from earlyAgentId.slice(0,8).
  /^agent-a[0-9a-f]{16}$/,
  /^agent-a[0-9a-f]{7}$/,
  /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/,
  // Legacy wf-<idx> slugs from before workflowRunId disambiguation — kept so
  // the 30-day sweep still cleans up worktrees leaked by older builds.
  /^wf-\d+$/,
  // Real bridge slugs are `bridge-${safeFilenameId(sessionId)}`.
  /^bridge-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/,
  // Template job worktrees: job-<templateName>-<8hex>. Prefix distinguishes
  // from user-named EnterWorktree slugs that happen to end in 8 hex.
  /^job-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/,
  // densable 2.1.246 FMs — bg-<name>-<8hex> isolation worktrees.
  /^bg-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/,
]

/**
 * Remove stale agent/workflow worktrees older than cutoffDate.
 *
 * Safety (densable blu):
 * - Only touches slugs matching ephemeral patterns (never user-named worktrees)
 * - Skips the current session's worktree
 * - BMs: release stale dead-pid Claude locks first
 * - Ljr: clean porcelain (no `-uno`) then UMs (including `$jr`)
 * - One/Dne: keep if locked by a live Claude Code process, or a reason we
 *   did not write. Porcelain-registry read failure keeps the worktree.
 * - W7 reason `"stale_cleanup"`. Mne on readdir-fail and after the sweep.
 *   Official blu does not call Slu.
 *
 * `git worktree remove --force` handles both the directory and git's internal
 * worktree tracking. If git doesn't recognize the path as a worktree (orphaned
 * dir), it's left in place — a later readdir finding it stale again is harmless.
 */
export async function cleanupStaleAgentWorktrees(
  cutoffDate: Date,
): Promise<number> {
  const gitRoot = findCanonicalGitRoot(getCwd())
  if (!gitRoot) {
    return 0
  }

  await releaseStaleClaudeWorktreeLocks(gitRoot)

  const dir = worktreesDir(gitRoot)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    await restoreWorktreeConfigExtension(gitRoot)
    return 0
  }

  const cutoffMs = cutoffDate.getTime()
  const currentPath = currentWorktreeSession?.worktreePath
  const originHeadRef = await resolveOriginHeadRef(gitRoot)
  let removed = 0

  for (const slug of entries) {
    if (!EPHEMERAL_WORKTREE_PATTERNS.some(p => p.test(slug))) {
      continue
    }

    const worktreePath = join(dir, slug)
    if (currentPath === worktreePath) {
      continue
    }

    let mtimeMs: number
    try {
      mtimeMs = (await stat(worktreePath)).mtimeMs
    } catch {
      continue
    }
    if (mtimeMs >= cutoffMs) {
      continue
    }

    if (!(await isJobWorktreeSafeToReap(worktreePath, originHeadRef))) {
      continue
    }
    try {
      if (
        !canReapDespiteLock(await porcelainLockReason(worktreePath, gitRoot))
      ) {
        logForDebugging(
          `cleanupStaleAgentWorktrees: kept ${worktreePath} — locked by a live Claude Code process, or with a reason we did not write`,
        )
        continue
      }
    } catch (error) {
      logForDebugging(
        `cleanupStaleAgentWorktrees: kept ${worktreePath} — cannot read the worktree registry to verify lock ownership (${errorMessage(error)})`,
      )
      continue
    }

    if (
      (
        await removeAgentWorktree(
          worktreePath,
          worktreeBranchName(slug),
          gitRoot,
          false,
          'stale_cleanup',
        )
      ).outcome !== 'failed'
    ) {
      removed++
    }
  }

  if (removed > 0) {
    await execFileNoThrowWithCwd(gitExe(), ['worktree', 'prune'], {
      cwd: gitRoot,
      env: gitWorktreeEnv(),
    })
    logForDebugging(
      `cleanupStaleAgentWorktrees: removed ${removed} stale worktree(s)`,
    )
  }
  await restoreWorktreeConfigExtension(gitRoot)
  return removed
}

/**
 * Check whether a worktree has uncommitted changes or new commits since creation.
 * Returns true if there are uncommitted changes (dirty working tree), if commits
 * were made on the worktree branch since `headCommit`, or if git commands fail
 * — callers use this to decide whether to remove a worktree, so fail-closed.
 */
export async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean> {
  const { code: statusCode, stdout: statusOutput } =
    await execFileNoThrowWithCwd(gitExe(), ['status', '--porcelain'], {
      cwd: worktreePath,
      env: gitWorktreeEnv(),
    })
  if (statusCode !== 0) {
    return true
  }
  if (statusOutput.trim().length > 0) {
    return true
  }

  const { code: revListCode, stdout: revListOutput } =
    await execFileNoThrowWithCwd(
      gitExe(),
      ['rev-list', '--count', `${headCommit}..HEAD`],
      { cwd: worktreePath, env: gitWorktreeEnv() },
    )
  if (revListCode !== 0) {
    return true
  }
  if (parseInt(revListOutput.trim(), 10) > 0) {
    return true
  }

  return false
}

/**
 * Fast-path handler for --worktree --tmux.
 * Creates the worktree and execs into tmux running Claude inside.
 * This is called early in cli.tsx before loading the full CLI.
 */
export async function execIntoTmuxWorktree(args: string[]): Promise<{
  handled: boolean
  error?: string
}> {
  // Check platform - tmux doesn't work on Windows
  if (process.platform === 'win32') {
    return {
      handled: false,
      error: 'Error: --tmux is not supported on Windows',
    }
  }

  // Check if tmux is available
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf-8' })
  if (tmuxCheck.status !== 0) {
    const installHint =
      process.platform === 'darwin'
        ? 'Install tmux with: brew install tmux'
        : 'Install tmux with: sudo apt install tmux'
    return {
      handled: false,
      error: `Error: tmux is not installed. ${installHint}`,
    }
  }

  // Parse worktree name and tmux mode from args
  let worktreeName: string | undefined
  let forceClassicTmux = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '-w' || arg === '--worktree') {
      // Check if next arg exists and isn't another flag
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        worktreeName = next
      }
    } else if (arg.startsWith('--worktree=')) {
      worktreeName = arg.slice('--worktree='.length)
    } else if (arg === '--tmux=classic') {
      forceClassicTmux = true
    }
  }

  // Check if worktree name is a PR reference
  let prNumber: number | null = null
  if (worktreeName) {
    prNumber = parsePRReference(worktreeName)
    if (prNumber !== null) {
      worktreeName = `pr-${prNumber}`
    }
  }

  // Generate a slug if no name provided
  if (!worktreeName) {
    const adjectives = ['swift', 'bright', 'calm', 'keen', 'bold']
    const nouns = ['fox', 'owl', 'elm', 'oak', 'ray']
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
    const noun = nouns[Math.floor(Math.random() * nouns.length)]
    const suffix = Math.random().toString(36).slice(2, 6)
    worktreeName = `${adj}-${noun}-${suffix}`
  }

  // worktreeName is joined into worktreeDir via path.join below; apply the
  // same allowlist used by the in-session worktree tool so the constraint
  // holds uniformly regardless of entry point.
  try {
    validateWorktreeSlug(worktreeName)
  } catch (e) {
    return {
      handled: false,
      error: `Error: ${(e as Error).message}`,
    }
  }

  // Mirror createWorktreeForSession(): hook takes precedence over git so the
  // WorktreeCreate hook substitutes the VCS backend for this fast-path too
  // (anthropics/claude-code#39281). Git path below runs only when no hook.
  let worktreeDir: string
  let repoName: string
  if (hasWorktreeCreateHook()) {
    try {
      const hookResult = await executeWorktreeCreateHook(worktreeName)
      worktreeDir = hookResult.worktreePath
    } catch (error) {
      return {
        handled: false,
        error: `Error: ${errorMessage(error)}`,
      }
    }
    repoName = basename(findCanonicalGitRoot(getCwd()) ?? getCwd())
    try {
      await assertIsolationWorktreeAllowed(
        worktreeDir,
        [],
        liveLaunchDirs(getCwd(), findCanonicalGitRoot(getCwd())),
      )
    } catch (error) {
      return {
        handled: false,
        error: `Error: ${errorMessage(error)}`,
      }
    }
    console.log(`Using worktree via hook: ${worktreeDir}`)
  } else {
    // Get main git repo root (resolves through worktrees)
    const repoRoot = findCanonicalGitRoot(getCwd())
    if (!repoRoot) {
      return {
        handled: false,
        error: 'Error: --worktree requires a git repository',
      }
    }

    repoName = basename(repoRoot)
    worktreeDir = worktreePathFor(repoRoot, worktreeName)

    // Create or resume worktree
    try {
      const result = await getOrCreateWorktree(
        repoRoot,
        worktreeName,
        prNumber !== null ? { prNumber } : undefined,
      )
      if (!result.existed) {
        console.log(
          `Created worktree: ${worktreeDir} (based on ${(result as any).baseBranch})`,
        )
        await performPostCreationSetup(repoRoot, worktreeDir)
      }
      await assertIsolationWorktreeAllowed(
        worktreeDir,
        [],
        liveLaunchDirs(getCwd(), repoRoot),
      )
    } catch (error) {
      return {
        handled: false,
        error: `Error: ${errorMessage(error)}`,
      }
    }
  }

  // Sanitize for tmux session name (replace / and . with _)
  const tmuxSessionName =
    `${repoName}_${worktreeBranchName(worktreeName)}`.replace(/[/.]/g, '_')

  // Build new args without --tmux and --worktree (we're already in the worktree)
  const newArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '--tmux' || arg === '--tmux=classic') continue
    if (arg === '-w' || arg === '--worktree') {
      // Skip the flag and its value if present
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        i++ // Skip the value too
      }
      continue
    }
    if (arg.startsWith('--worktree=')) continue
    newArgs.push(arg)
  }

  // Get tmux prefix for user guidance
  let tmuxPrefix = 'C-b' // default
  const prefixResult = spawnSync('tmux', ['show-options', '-g', 'prefix'], {
    encoding: 'utf-8',
  })
  if (prefixResult.status === 0 && prefixResult.stdout) {
    const match = prefixResult.stdout.match(/prefix\s+(\S+)/)
    if (match?.[1]) {
      tmuxPrefix = match[1]
    }
  }

  // Check if tmux prefix conflicts with Claude keybindings
  // Claude binds: ctrl+b (task:background), ctrl+c, ctrl+d, ctrl+t, ctrl+o, ctrl+r, ctrl+s, ctrl+g, ctrl+e
  const claudeBindings = [
    'C-b',
    'C-c',
    'C-d',
    'C-t',
    'C-o',
    'C-r',
    'C-s',
    'C-g',
    'C-e',
  ]
  const prefixConflicts = claudeBindings.includes(tmuxPrefix)

  // Set env vars for the inner Claude to display tmux info in welcome message
  const tmuxEnv = {
    ...process.env,
    CLAUDE_CODE_TMUX_SESSION: tmuxSessionName,
    CLAUDE_CODE_TMUX_PREFIX: tmuxPrefix,
    CLAUDE_CODE_TMUX_PREFIX_CONFLICTS: prefixConflicts ? '1' : '',
  }

  // Check if session already exists
  const hasSessionResult = spawnSync(
    'tmux',
    ['has-session', '-t', tmuxSessionName],
    { encoding: 'utf-8' },
  )
  const sessionExists = hasSessionResult.status === 0

  // Check if we're already inside a tmux session
  const isAlreadyInTmux = Boolean(process.env.TMUX)

  // Use tmux control mode (-CC) for native iTerm2 tab/pane integration
  // This lets users use iTerm2's UI instead of learning tmux keybindings
  // Use --tmux=classic to force traditional tmux even in iTerm2
  // Control mode doesn't make sense when already in tmux (would need to switch-client)
  const useControlMode = isInITerm2() && !forceClassicTmux && !isAlreadyInTmux
  const tmuxGlobalArgs = useControlMode ? ['-CC'] : []

  // Print hint about iTerm2 preferences when using control mode
  if (useControlMode && !sessionExists) {
    const y = chalk.yellow
    console.log(
      `\n${y('╭─ iTerm2 Tip ────────────────────────────────────────────────────────╮')}\n` +
        `${y('│')} To open as a tab instead of a new window:                           ${y('│')}\n` +
        `${y('│')} iTerm2 > Settings > General > tmux > "Tabs in attaching window"     ${y('│')}\n` +
        `${y('╰─────────────────────────────────────────────────────────────────────╯')}\n`,
    )
  }

  // For ants in claude-cli-internal, set up dev panes (watch + start)
  const isAnt = process.env.USER_TYPE === 'ant'
  const isClaudeCliInternal = repoName === 'claude-cli-internal'
  const shouldSetupDevPanes = isAnt && isClaudeCliInternal && !sessionExists

  if (shouldSetupDevPanes) {
    // Create detached session with Claude in first pane
    spawnSync(
      'tmux',
      [
        'new-session',
        '-d', // detached
        '-s',
        tmuxSessionName,
        '-c',
        worktreeDir,
        '--',
        process.execPath,
        ...newArgs,
      ],
      { cwd: worktreeDir, env: tmuxEnv },
    )

    // Split horizontally and run watch
    spawnSync(
      'tmux',
      ['split-window', '-h', '-t', tmuxSessionName, '-c', worktreeDir],
      { cwd: worktreeDir },
    )
    spawnSync(
      'tmux',
      ['send-keys', '-t', tmuxSessionName, 'bun run watch', 'Enter'],
      { cwd: worktreeDir },
    )

    // Split vertically and run start
    spawnSync(
      'tmux',
      ['split-window', '-v', '-t', tmuxSessionName, '-c', worktreeDir],
      { cwd: worktreeDir },
    )
    spawnSync('tmux', ['send-keys', '-t', tmuxSessionName, 'bun run start'], {
      cwd: worktreeDir,
    })

    // Select the first pane (Claude)
    spawnSync('tmux', ['select-pane', '-t', `${tmuxSessionName}:0.0`], {
      cwd: worktreeDir,
    })

    // Attach or switch to the session
    if (isAlreadyInTmux) {
      // Switch to sibling session (avoid nesting)
      spawnSync('tmux', ['switch-client', '-t', tmuxSessionName], {
        stdio: 'inherit',
      })
    } else {
      // Attach to the session
      spawnSync(
        'tmux',
        [...tmuxGlobalArgs, 'attach-session', '-t', tmuxSessionName],
        {
          stdio: 'inherit',
          cwd: worktreeDir,
        },
      )
    }
  } else {
    // Standard behavior: create or attach
    if (isAlreadyInTmux) {
      // Already in tmux - create detached session, then switch to it (sibling)
      // Check if session already exists first
      if (sessionExists) {
        // Just switch to existing session
        spawnSync('tmux', ['switch-client', '-t', tmuxSessionName], {
          stdio: 'inherit',
        })
      } else {
        // Create new detached session
        spawnSync(
          'tmux',
          [
            'new-session',
            '-d', // detached
            '-s',
            tmuxSessionName,
            '-c',
            worktreeDir,
            '--',
            process.execPath,
            ...newArgs,
          ],
          { cwd: worktreeDir, env: tmuxEnv },
        )

        // Switch to the new session
        spawnSync('tmux', ['switch-client', '-t', tmuxSessionName], {
          stdio: 'inherit',
        })
      }
    } else {
      // Not in tmux - create and attach (original behavior)
      const tmuxArgs = [
        ...tmuxGlobalArgs,
        'new-session',
        '-A', // Attach if exists, create if not
        '-s',
        tmuxSessionName,
        '-c',
        worktreeDir,
        '--', // Separator before command
        process.execPath,
        ...newArgs,
      ]

      spawnSync('tmux', tmuxArgs, {
        stdio: 'inherit',
        cwd: worktreeDir,
        env: tmuxEnv,
      })
    }
  }

  return { handled: true }
}
