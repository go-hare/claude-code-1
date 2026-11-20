/**
 * Adapter layer that wraps @anthropic-ai/sandbox-runtime with Claude CLI-specific integrations.
 * This file provides the bridge between the external sandbox-runtime package and Claude CLI's
 * settings system, tool integration, and additional features.
 */

import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  IgnoreViolationsConfig,
  NetworkHostPattern,
  NetworkRestrictionConfig,
  SandboxAskCallback,
  SandboxDependencyCheck,
  SandboxRuntimeConfig,
  SandboxViolationEvent,
} from '@anthropic-ai/sandbox-runtime'
import {
  SandboxManager as BaseSandboxManager,
  SandboxRuntimeConfigSchema,
  SandboxViolationStore,
} from '@anthropic-ai/sandbox-runtime'
import { spawnSync } from 'child_process'
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'fs'
import { memoize } from 'lodash-es'
import { isIP } from 'node:net'
import { homedir } from 'os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from 'path'
import { getCwd } from '../cwd.js'
import { URL as NodeURL } from 'node:url'
import {
  getAdditionalDirectoriesForClaudeMd,
  getCwdState,
  getInlinePlugins,
  getInlinePluginsNoMcp,
  getOriginalCwd,
} from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { sandboxHelperSubprocessEnv } from '../subprocessEnv.js'
import { expandPath } from '../path.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { getProjectDir } from '../sessionPaths.js'
import { settingsHaveBlockReadsOutsideWorkingDirectories } from '../permissions/outsideReads.js'
import { isWorktreePathNetworkRelativeToCwd } from '../worktree.js'
import {
  gitAdminHopUnsafe,
  gitdirPointerHopUnsafe,
} from '../git/gitdirHopWalk.js'
import { getPlatform, type Platform } from '../platform.js'
import {
  getCommandProducerScanRoots,
  isPathEqualOrUnder,
  scanInstalledCommandProducerDirs,
  subscribeCommandProducerDirsChanged,
} from '../plugins/commandProducerDirs.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  isSettingSourceEnabled,
  SETTING_SOURCES,
  type SettingSource,
} from '../settings/constants.js'
import {
  getManagedSettingsDropInDir,
  WSL_WINDOWS_MANAGED_PATH,
} from '../settings/managedPath.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
  getSettingsFilePathForSource,
  getSettingsForSource,
  getSettingsRootPathForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

// ============================================================================
// Settings Converter
// ============================================================================

import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { errorMessage } from '../errors.js'
import { readHostProxyPorts } from '../hostProxyPorts.js'
import {
  getClaudeTempDir,
  getFlagMcpConfigFilePaths,
  getProfileStoreDenyPaths,
} from '../permissions/filesystem.js'
import {
  getWorktreeAddDirPinState,
  resolveWorktreeAddDirEntry,
} from '../permissions/permissionSetup.js'
import type { PermissionRuleValue } from '../permissions/PermissionRule.js'
import {
  collectUngatedAdditionalDirectories,
  collectUngatedAllowRuleStrings,
  isSourceGrantsGated,
} from '../permissions/projectGrantsGate.js'
import { ripgrepCommand } from '../ripgrep.js'
import {
  applySandboxRuntimeConfig,
  clearSymlinkedDenyLists,
  failSandboxInitializeAllowlist,
  finishSandboxInitializeAllowlist,
  markInstallsSinceInitializeStarted,
  promoteDenyLiteralSymlinkTargets,
  recordSymlinkedDenyPath,
  recordWrapWriteRoots,
  rememberBuiltConfigAllowlist,
  resetSymlinkedDenyScrubState,
  scrubSymlinkedDenyPaths,
  setSandboxInitializationPromise,
} from './symlinkedDenyScrub.js'
import {
  ensureAtomicWriteStagingDirs,
  ensureBridgeSpawnRootDirForWrap,
} from './wrapPreflight.js'
import {
  type ForwardedUntrustedGrant,
  recheckReadDenyAndCredentialMasksBeforeWrap,
  recordReadDenyRecheckBaseline,
} from './readDenyRecheck.js'

// ============================================================================
// Credential Protection Constants (from official sandbox.credentials)
// ============================================================================

/**
 * Environment files that should be write-protected in sandbox mode.
 * Equivalent to official NXq constant.
 */
export const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
  '.env.production',
  '.env.production.local',
] as const

/**
 * System directories that are allowed for writes in sandbox mode.
 * Equivalent to official gH7 constant.
 */
export const ALLOW_WRITE_SYSTEM_DIRS = [
  '/home',
  '/root',
  '/tmp',
  '/var',
  '/opt',
  '/run',
  '/mnt',
] as const

/**
 * Socket and runtime paths denied for reads in sandbox mode.
 * Equivalent to official denyRead list in CXq().
 */
export const DENY_READ_SOCKET_PATHS = [
  '/run/docker.sock',
  '/run/containerd/containerd.sock',
  '/run/podman/podman.sock',
  '/run/buildkit/buildkitd.sock',
  '/run/dbus',
  '/run/user',
] as const

// Local 236 wildcard read-deny (gold QOi lists these; CXq table did not).
export const DENY_READ_ENV_GLOBS = ['**/.env', '**/.env*'] as const

/**
 * Official 2.1.326 #23: track 0-byte placeholder files created by the sandbox
 * on Linux/WSL (including `.git/config.lock`, `.git/config.worktree`,
 * `.git/config.worktree.lock`) so they are removed on cleanup AND if Claude
 * Code is stopped mid-command (SIGINT/SIGTERM/exit).
 */
const createdLinuxPlaceholderFiles = new Set<string>()
let placeholderExitHookInstalled = false

function installLinuxPlaceholderExitHook(): void {
  if (placeholderExitHookInstalled) return
  placeholderExitHookInstalled = true
  const onExit = (): void => {
    cleanupLinuxSandboxPlaceholderFiles()
  }
  process.once('exit', onExit)
  registerCleanup(() => {
    cleanupLinuxSandboxPlaceholderFiles()
  })
}

/**
 * Official 2.1.326 #23: remove tracked 0-byte placeholder files (such as
 * `.git/config.lock` or `.git/config.worktree`) left by Linux bwrap when a
 * command ends or Claude Code is stopped. Never deletes non-empty user files.
 */
export function cleanupLinuxSandboxPlaceholderFiles(
  extraPaths?: readonly string[],
): string[] {
  const candidates = extraPaths
    ? new Set([...createdLinuxPlaceholderFiles, ...extraPaths])
    : new Set(createdLinuxPlaceholderFiles)
  const removed: string[] = []
  for (const p of candidates) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand/exit must be sync
      const st = lstatSync(p)
      if (st.isFile() && st.size === 0) {
        // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand/exit must be sync
        unlinkSync(p)
        removed.push(p)
      }
      createdLinuxPlaceholderFiles.delete(p)
    } catch {
      createdLinuxPlaceholderFiles.delete(p)
    }
  }
  return removed
}

/**
 * densable 2.1.239 G + 2.1.326 #23 — on linux/wsl, create a missing
 * `.git/config.worktree` / `.git/config.lock` (`openSync(..., "wx")`) so
 * denyWrite binds a real empty file, and record it for cleanup on command end
 * or process stop.
 */
export function ensureLinuxGitWorktreeConfigPlaceholder(path: string): void {
  const plat = getPlatform()
  if (plat !== 'linux' && plat !== 'wsl') return
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
    if (!lstatSync(dirname(path)).isDirectory()) return
    // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
    closeSync(openSync(path, 'wx'))
    createdLinuxPlaceholderFiles.add(path)
    installLinuxPlaceholderExitHook()
  } catch {
    // exists, or parent is gone — official G() swallows
  }
}

/**
 * Official 2.1.326 #22 (`ivr` / `Phl` / `X3`):
 * Detect Linux `/net/...` autofs paths. When the home or config directory is
 * reached through a symlink into `/net` and sandbox settings deny reads of it,
 * bwrap fails to start if `/net` or the symlink target is blindly ro-bound/denied.
 */
export function isLinuxNetAutofsPath(
  p: string,
  platform: Platform = getPlatform(),
): boolean {
  if (platform !== 'linux' && platform !== 'wsl') return false
  const normalized = p.replace(/\/+$/, '')
  return normalized === '/net' || normalized.startsWith('/net/')
}

/**
 * Official 2.1.326 #22: filter/adjust Linux `denyRead` entries when `home` or
 * `configDir` is reached via a symlink into `/net` so bwrap does not fail on
 * autofs mounts while keeping literal home/config deny protection intact.
 */
export function filterLinuxNetSymlinkDenyRead(
  denyRead: readonly string[],
  home: string,
  configDir: string,
  platform: Platform = getPlatform(),
): string[] {
  if (platform !== 'linux' && platform !== 'wsl') return [...denyRead]
  const resolvedNetRoots = new Set<string>()
  for (const base of [home, configDir]) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
      const real = realpathSync(base)
      if (real !== base && isLinuxNetAutofsPath(real, platform)) {
        resolvedNetRoots.add(real)
      }
    } catch {
      // ignore unresolvable home/configDir
    }
  }
  if (resolvedNetRoots.size === 0) return [...denyRead]
  return denyRead.filter(entry => {
    if (!isLinuxNetAutofsPath(entry, platform)) return true
    for (const root of resolvedNetRoots) {
      if (entry === '/net' || root === entry || root.startsWith(`${entry}/`)) {
        logForDebugging(
          `[Sandbox] Skipping Linux /net autofs denyRead ancestor "${entry}" for symlinked home/config root "${root}"`,
        )
        return false
      }
    }
    return true
  })
}

/**
 * Official 2.1.326 #300 (`Tii` / `Cii` @291479784):
 * Sensitive home directories/files write-protected by default on macOS, Linux,
 * and WSL. Entries in `USER_OVERRIDABLE_SENSITIVE_HOME_DENY_WRITE` can be
 * allowed via `sandbox.filesystem.allowWrite` in user, flag, or managed settings
 * (NOT project/local settings).
 */
export const DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS: readonly (readonly string[])[] =
  [
    ['.ssh'],
    ['.aws'],
    ['.azure'],
    ['.gnupg'],
    ['.kube'],
    ['.docker'],
    ['.config', 'gh'],
    ['.config', 'glab-cli'],
    ['.config', 'gcloud'],
    ['.cargo', 'credentials'],
    ['.cargo', 'credentials.toml'],
    ['.gem', 'credentials'],
    ['.m2', 'settings.xml'],
    ['.gradle', 'gradle.properties'],
    ['.config', 'powershell', 'profile.ps1'],
    ['.claude', 'state'],
    ['Library', 'Keychains'],
    ['.netrc'],
    ['.git-credentials'],
    ['.pypirc'],
    ['.pgpass'],
    ['.my.cnf'],
    ['.mylogin.cnf'],
    ['.terraform.d', 'credentials.tfrc.json'],
    ['.boto'],
    ['.s3cfg'],
  ] as const

export function collectSensitiveHomeDenyWritePaths(
  home: string,
  trustedAllowWrite: readonly string[],
): string[] {
  const normalizedTrusted = trustedAllowWrite.map(p =>
    resolve(p.startsWith('~/') ? join(home, p.slice(2)) : p).replace(
      /\/+$/,
      '',
    ),
  )
  const out: string[] = []
  for (const segments of DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS) {
    const full = resolve(home, ...segments)
    // Never allow project/local settings to override; only trusted user/flag/policy
    // allowWrite entries matching this path or a parent folder exempt non-Claude paths.
    const isClaudeState = segments[0] === '.claude'
    const explicitlyAllowed =
      !isClaudeState &&
      normalizedTrusted.some(
        allowed =>
          allowed === full ||
          (allowed.startsWith(`${home}/`) && full.startsWith(`${allowed}/`)),
      )
    if (!explicitlyAllowed) {
      out.push(full)
    }
  }
  return out
}

/**
 * Official 2.1.326 #301 (`nme()` / `tme()` / `vA()` @291369661):
 * Snapshot `.git` entries before a sandboxed command and ONLY unlink/quarantine
 * newly appearing symlinks, FIFOs, Windows junctions, and `ref:` symref files
 * whose target escapes `refs/`. Never touch regular git metadata files or
 * directories (`.git/worktrees`, `.git/REBASE_HEAD`, `.git/BISECT_*`,
 * `.git/modules`, `.git/lfs`, etc.), and ref-count/clean up each snapshot entry
 * on command completion.
 */
type GitDirEntryKind = 'file' | 'dir' | 'symlink' | 'fifo' | 'other'

type GitDirSnapshotEntry = {
  baseline: Map<string, GitDirEntryKind>
  refCount: number
}

function classifyGitDirStat(
  st: NonNullable<ReturnType<typeof lstatSync>>,
): GitDirEntryKind {
  if (st.isSymbolicLink()) return 'symlink'
  if (st.isFIFO()) return 'fifo'
  if (st.isDirectory()) return 'dir'
  if (st.isFile()) return 'file'
  return 'other'
}

const gitDirSnapshotsBeforeWrap = new Map<string, GitDirSnapshotEntry>()
const GIT_SYMREF_SCAN_BYTES = 4096
const GIT_DIR_SCAN_MAX_DEPTH = 8
const GIT_DIR_SCAN_SKIP_DIRS = new Set(['objects'])

function isSafeGitSymrefTarget(target: string): boolean {
  const trimmed = target.trimEnd()
  if (trimmed === 'refs/heads/.invalid') return true
  const normalized = trimmed.replace(/\/+$/, '')
  return normalized.startsWith('refs/') && !/\/\.|[\\:~\uFFFD]/.test(normalized)
}

/**
 * Official 2.1.328 `vA()` (#628): returns true iff `fullPath` is a regular file
 * starting with `ref:` whose symref target escapes `refs/` (or exceeds scan
 * buffer without a valid `refs/` target). Opens non-blocking & no-follow.
 * On Linux/WSL (`allowNonUtf8`), non-UTF-8 branch names decode with `\uFFFD` —
 * replace `\uFFFD` with `_` before checking safety so valid non-UTF-8 branch
 * names in `.git/HEAD` are not quarantined/renamed after every command.
 */
export function isEscapingGitRefFile(
  fullPath: string,
  allowNonUtf8: boolean = getPlatform() === 'linux' || getPlatform() === 'wsl',
): boolean {
  const flags =
    fsConstants.O_RDONLY |
    (fsConstants.O_NONBLOCK ?? 0) |
    (fsConstants.O_NOFOLLOW ?? 0)
  let fd: number | undefined
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
    fd = openSync(fullPath, flags)
    const buf = Buffer.alloc(GIT_SYMREF_SCAN_BYTES)
    // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
    const bytesRead = readSync(fd, buf, 0, buf.length, 0)
    const text = buf.toString('utf8', 0, bytesRead)
    if (!text.startsWith('ref:')) return false
    if (bytesRead === buf.length) return true
    const rawTarget = text.replace(/^ref:[ \t\r\n]*/, '')
    const target = allowNonUtf8
      ? rawTarget.replaceAll('\uFFFD', '_')
      : rawTarget
    return !isSafeGitSymrefTarget(target)
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore close errors
      }
    }
  }
}

function collectGitDirRelativeEntries(
  rootGitDir: string,
  relPrefix = '',
  depth = 0,
  out: Map<string, GitDirEntryKind> = new Map(),
): Map<string, GitDirEntryKind> {
  if (depth > GIT_DIR_SCAN_MAX_DEPTH) return out
  const dir = relPrefix ? join(rootGitDir, relPrefix) : rootGitDir
  let entries: string[]
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name.startsWith('.claude-quarantine-')) continue
    if (depth === 0 && GIT_DIR_SCAN_SKIP_DIRS.has(name)) continue
    const rel = relPrefix ? join(relPrefix, name) : name
    const fullPath = join(rootGitDir, rel)
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
      const st = lstatSync(fullPath)
      const kind = classifyGitDirStat(st)
      out.set(rel, kind)
      if (kind === 'dir') {
        collectGitDirRelativeEntries(rootGitDir, rel, depth + 1, out)
      }
    } catch {
      // ignore vanished entries
    }
  }
  return out
}

export function snapshotGitDirBeforeSandboxWrap(cwd: string): void {
  const gitDir = join(cwd, '.git')
  const existing = gitDirSnapshotsBeforeWrap.get(gitDir)
  if (existing) {
    existing.refCount += 1
    return
  }
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot
    const st = lstatSync(gitDir)
    if (!st.isDirectory()) return
    const baseline = collectGitDirRelativeEntries(gitDir)
    gitDirSnapshotsBeforeWrap.set(gitDir, { baseline, refCount: 1 })
  } catch {
    // No .git directory at cwd
  }
}

export function getActiveGitDirSnapshotCountForTesting(): number {
  return gitDirSnapshotsBeforeWrap.size
}

const GIT_TOP_LEVEL_REF_NAME_RE =
  /^(.*_)?HEAD$|^(AUTO_MERGE|BISECT_EXPECTED_REV|NOTES_MERGE_PARTIAL|NOTES_MERGE_REF|MERGE_AUTOSTASH)$/i

/**
 * Official 2.1.328 (`eme` + `Khe` @291364353): returns true iff `rel` (relative
 * to `.git`) is a ref-bearing path where git interprets a `ref:` symref target:
 * files under `refs/` (including `worktrees/<name>/refs/` and `modules/.../refs/`)
 * and top-level/worktree/module ref files matching `Khe`. Never matches
 * `COMMIT_EDITMSG`, `MERGE_MSG`, `SQUASH_MSG`, `TAG_EDITMSG`, `description`,
 * `index`, or `logs/*`.
 */
export function isGitRefBearingPath(rel: string): boolean {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length === 0) return false
  const name = parts[parts.length - 1]!
  const dirParts = parts.slice(0, -1).map(p => p.toUpperCase())
  const effectiveDir =
    dirParts[0] === 'WORKTREES' ? dirParts.slice(2) : dirParts
  const top = effectiveDir[0] ?? ''
  if (top === 'REFS' || (top === 'MODULES' && effectiveDir.includes('REFS'))) {
    return true
  }
  if (top === '' || top === 'MODULES') {
    return GIT_TOP_LEVEL_REF_NAME_RE.test(name)
  }
  return false
}

export function quarantineUnexpectedGitDirEntries(cwd?: string): {
  quarantined: string[]
  removedSymlinks: string[]
} {
  const quarantined: string[] = []
  const removedSymlinks: string[] = []
  const targets = cwd
    ? [join(cwd, '.git')]
    : Array.from(gitDirSnapshotsBeforeWrap.keys())
  for (const gitDir of targets) {
    const snapshot = gitDirSnapshotsBeforeWrap.get(gitDir)
    if (!snapshot) continue
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
      if (lstatSync(gitDir).isDirectory()) {
        const current = collectGitDirRelativeEntries(gitDir)
        for (const [rel, currentKind] of current) {
          const baselineKind = snapshot.baseline.get(rel)
          const isNew = baselineKind === undefined
          const replacedWithSymlink =
            !isNew && currentKind === 'symlink' && baselineKind !== 'symlink'
          const replacedWithFifo =
            !isNew && currentKind === 'fifo' && baselineKind !== 'fifo'
          const isTrackedRefPath = isGitRefBearingPath(rel)
          if (
            !isNew &&
            !replacedWithSymlink &&
            !replacedWithFifo &&
            !isTrackedRefPath
          ) {
            continue
          }
          const fullPath = join(gitDir, rel)
          try {
            // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
            const st = lstatSync(fullPath)
            // Official `tme`: handle newly appearing OR replaced symlinks
            // (incl. Windows junctions), FIFOs, and `ref:` symref files
            // escaping `refs/` on ref-bearing paths (`eme`/`Khe`). Never
            // touch regular git metadata files or directories.
            if ((isNew || replacedWithSymlink) && st.isSymbolicLink()) {
              // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
              unlinkSync(fullPath)
              removedSymlinks.push(fullPath)
              logForDebugging(
                `[Sandbox] Removed unexpected symlink planted in .git: ${fullPath}`,
                { level: 'warn' },
              )
              continue
            }
            const isFifo = (isNew || replacedWithFifo) && st.isFIFO()
            const isUnsafeRef =
              !isFifo &&
              isTrackedRefPath &&
              st.isFile() &&
              isEscapingGitRefFile(fullPath)
            if (isFifo || isUnsafeRef) {
              const quarantineDir = join(
                gitDir,
                '.claude-quarantine-unexpected',
              )
              try {
                // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
                mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
                const safeName = rel.replace(/[\\/]/g, '_')
                const dest = join(quarantineDir, `${Date.now()}-${safeName}`)
                // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
                renameSync(fullPath, dest)
                quarantined.push(fullPath)
                logForDebugging(
                  `[Sandbox] Set aside planted ${isFifo ? 'FIFO' : 'escaping ref file'} ${fullPath} -> ${dest}`,
                  { level: 'warn' },
                )
              } catch {
                // Fallback unlink if rename into quarantine fails (matches official `tme`)
                // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
                unlinkSync(fullPath)
                quarantined.push(fullPath)
              }
            }
          } catch {
            // Best-effort quarantine
          }
        }
      }
    } catch {
      // Ignore vanished .git dir
    } finally {
      snapshot.refCount -= 1
      if (snapshot.refCount <= 0) {
        gitDirSnapshotsBeforeWrap.delete(gitDir)
      }
    }
  }
  return { quarantined, removedSymlinks }
}

/**
 * Official 2.1.326 #302: on Linux and WSL, pre-create missing `--add-dir`
 * folders before each sandboxed command so bwrap bind-mounts work cleanly.
 * Skips paths whose existing ancestor is a symlink/network mount or unreadable.
 */
export function precreateMissingLinuxAddDirs(
  additionalDirs: readonly string[],
  platform: Platform = getPlatform(),
): string[] {
  if (platform !== 'linux' && platform !== 'wsl') return []
  const created: string[] = []
  for (const rawDir of additionalDirs) {
    if (!rawDir || !isAbsolute(rawDir)) continue
    const dir = resolve(rawDir)
    if (isLinuxNetAutofsPath(dir, platform) || dir === '/') continue
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
      lstatSync(dir)
      continue // already exists (file, dir, or symlink)
    } catch (err) {
      if (getErrnoCode(err) !== 'ENOENT') continue
    }
    // Verify nearest existing ancestor is a real directory (not a symlink)
    let ancestor = dirname(dir)
    let ancestorSafe = false
    while (ancestor && ancestor !== dirname(ancestor)) {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
        const st = lstatSync(ancestor)
        ancestorSafe = st.isDirectory() && !st.isSymbolicLink()
        break
      } catch (err) {
        if (getErrnoCode(err) !== 'ENOENT') break
        ancestor = dirname(ancestor)
      }
    }
    if (!ancestorSafe) continue
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
      mkdirSync(dir, { recursive: true })
      created.push(dir)
    } catch {
      // Best-effort pre-create
    }
  }
  return created
}

/**
 * Official 2.1.326 #235: check whether a folder contains any symlink pointing
 * to an unreadable or network path (`/net`, UNC `//...`, dangling/ELOOP).
 * Used to tighten sandbox write grants and mods-folder edit permissions.
 */
export function directoryHasUnreadableOrNetworkSymlink(dir: string): boolean {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- sync check
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isSymbolicLink()) continue
      const full = join(dir, ent.name)
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- sync check
        const target = readlinkSync(full)
        if (
          target.startsWith('/net/') ||
          target === '/net' ||
          target.startsWith('//') ||
          target.startsWith('\\\\') ||
          target.startsWith('/Network/')
        ) {
          return true
        }
        // Verify target is readable/stat-able
        // eslint-disable-next-line custom-rules/no-sync-fs -- sync check
        statSync(full)
      } catch {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

/**
 * Official 2.1.323 #2174 & #2177 (`pushLinkedWorktreeConfigDenyWrite`):
 * Protect every linked worktree's `config.worktree`, `config.worktree.lock`,
 * `commondir`, and `glab-cli` inside `<gitDir>/worktrees/*`.
 */
function pushLinkedWorktreeConfigDenyWrite(
  denyWrite: string[],
  gitDir: string,
): void {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
    for (const ent of readdirSync(join(gitDir, 'worktrees'), {
      withFileTypes: true,
    })) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
      const nested = join(gitDir, 'worktrees', ent.name, 'config.worktree')
      ensureLinuxGitWorktreeConfigPlaceholder(nested)
      const nestedGlab = join(gitDir, 'worktrees', ent.name, 'glab-cli')
      denyWrite.push(
        nested,
        join(gitDir, 'worktrees', ent.name, 'config.worktree.lock'),
        join(gitDir, 'worktrees', ent.name, 'commondir'),
        nestedGlab,
      )
    }
  } catch {
    // official j() swallows a missing worktrees dir
  }
}

/**
 * Official 2.1.323 #2175 (`N3`): on macOS, Linux, and WSL, ignore write access
 * granted via an `allowWrite` entry that passes through a symlink inside a
 * writable folder leading elsewhere (outside its own spelling) or to a missing
 * target. Users must grant the real path instead.
 */
export function isAllowWriteSymlinkEscapingOrDangling(
  entry: string,
  platform: Platform = getPlatform(),
): boolean {
  if (platform === 'windows') return false
  if (entry === '.' || entry === '..') return false
  // Strip trailing glob suffix if any (e.g. `/path/**` -> `/path`)
  const stripped = entry.replace(/\/\*+$/, '')
  if (!stripped || !isAbsolute(stripped)) return false
  const isMac = platform === 'macos'
  const macPrivateAlias =
    isMac && (stripped.startsWith('/tmp/') || stripped.startsWith('/var/'))
  const normalizeCmp = (p: string) => {
    const clean = p.replace(/\/+$/, '') || '/'
    return isMac ? clean.toLowerCase() : clean
  }
  const sameSpelling = (a: string, b: string) => {
    const na = normalizeCmp(a)
    const nb = normalizeCmp(b)
    if (na === nb) return true
    if (macPrivateAlias && normalizeCmp('/private' + a) === nb) return true
    return false
  }
  // Walk path components from root to leaf looking for any symlink
  const parts = stripped.split('/').filter(Boolean)
  let current = '/'
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const next = current === '/' ? `/${part}` : `${current}/${part}`
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- config build must be sync
      const st = lstatSync(next)
      if (st.isSymbolicLink()) {
        // Skip system macOS root symlinks (`/tmp`, `/var`, `/etc`)
        if (
          isMac &&
          i === 0 &&
          (part === 'tmp' || part === 'var' || part === 'etc')
        ) {
          current = next
          continue
        }
        try {
          // eslint-disable-next-line custom-rules/no-sync-fs -- config build must be sync
          const resolved = realpathSync(next)
          if (!sameSpelling(next, resolved)) {
            return true
          }
        } catch {
          // Dangling symlink pointing to a missing path -> ignore grant
          return true
        }
      }
      current = next
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // Non-existent path without a symlink along its existing prefix is fine
        return false
      }
      return true
    }
  }
  return false
}

/**
 * Official 2.1.323 #2207: harden macOS Seatbelt profile in the wrapped
 * `sandbox-exec -p '...'` command so `process-info*` is denied by default and
 * only allowed for `(target same-sandbox)` plus `process-info-listpids` when
 * defined — matching official SEA `@285714858` without modifying `node_modules/`.
 */
export function hardenMacOsSeatbeltProcessInfo(wrappedCommand: string): string {
  if (!wrappedCommand.includes('(allow process-info* (target same-sandbox))')) {
    return wrappedCommand
  }
  if (wrappedCommand.includes('(deny process-info*')) {
    return wrappedCommand
  }
  const logTagMatch = /; LogTag: ([^\n'"\\]+)/.exec(wrappedCommand)
  const logTag = logTagMatch?.[1]
  // Inside single-quoted shell-quote arguments, a literal `'` must be escaped as `'\''`.
  const isSingleQuoted =
    wrappedCommand.includes("sandbox-exec -p '") ||
    /sandbox-exec\s+-p\s+'/.test(wrappedCommand)
  // Inside double-quoted (or backslash-escaped) shell-quote arguments (e.g. when a path
  // contains `'`), literal `"` must be escaped as `\"` so it does not close the outer quote.
  const isDoubleQuoted =
    /sandbox-exec\s+-p\s+"/.test(wrappedCommand) ||
    (!isSingleQuoted && wrappedCommand.includes('\\"'))
  const denyLine = logTag
    ? isDoubleQuoted
      ? `(deny process-info* (with message \\"${logTag}\\"))`
      : `(deny process-info* (with message "${logTag}"))`
    : '(deny process-info*)'
  const listPidsLine = isSingleQuoted
    ? "(if (defined? '\\''process-info-listpids) (allow process-info-listpids))"
    : "(if (defined? 'process-info-listpids) (allow process-info-listpids))"
  return wrappedCommand.replace(
    '(allow process-info* (target same-sandbox))',
    `${denyLine}\n(allow process-info* (target same-sandbox))\n${listPidsLine}`,
  )
}

/**
 * Official 2.1.325 #2333 (`D5n`): native updater download staging directory
 * (`$XDG_CACHE_HOME/claude/staging` or `~/.cache/claude/staging`).
 */
export function getUpdaterStagingDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const cacheBase = env.XDG_CACHE_HOME ?? join(home, '.cache')
  const root = isAbsolute(cacheBase) ? cacheBase : join(home, '.cache')
  return join(root, 'claude', 'staging')
}

/**
 * Official 2.1.325 #2333 (`Ahe`): materialize the updater staging directory
 * (0o700) before wrap on non-Windows so bwrap/Seatbelt deny an existing folder.
 */
function ensureUpdaterStagingDir(): void {
  if (getPlatform() === 'windows') return
  const stagingDir = getUpdaterStagingDir()
  if (!isAbsolute(stagingDir)) return
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap setup
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
  } catch (err) {
    logForDebugging(
      `[sandbox] could not create the update staging folder, which is denied all the same: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
}

/**
 * Official 2.1.325 #2334 & #2358 (`_o` / `fs` / `jf`):
 * Protect `.claude` settings, skills, agents, commands, hooks, workflows,
 * routines, output-styles, launch/scheduled_tasks/loop configs, and `.mcp.json`
 * inside a project, worktree, or added directory (`additionalDirectories`).
 */
export function pushProtectedClaudeDirEntries(
  denyWrite: string[],
  dir: string,
): void {
  denyWrite.push(
    recordSymlinkedDenyPath(resolve(dir, '.claude', 'settings.json')),
    recordSymlinkedDenyPath(resolve(dir, '.claude', 'settings.local.json')),
    resolve(dir, '.claude', 'skills'),
    resolve(dir, '.claude', 'commands'),
    resolve(dir, '.claude', 'agents'),
    resolve(dir, '.claude', 'hooks'),
    resolve(dir, '.claude', 'launch.json'),
    resolve(dir, '.claude', 'workflows'),
    resolve(dir, '.claude', 'routines'),
    resolve(dir, '.claude', 'output-styles'),
    resolve(dir, '.claude', 'scheduled_tasks.json'),
    resolve(dir, '.claude', 'loop.md'),
    resolve(dir, '.mcp.json'),
  )
}

/**
 * Official 2.1.325 #2335 (`Ba` + `Hf` / `$r`):
 * Protect git metadata inside a git directory (`hooks`, `config`, `config.lock`,
 * `config.worktree`, `config.worktree.lock`, `commondir`, `worktrees`,
 * `info/exclude`, `glab-cli`, and linked worktrees under `worktrees/*`).
 */
function pushGitDirMetadataDenyWrite(
  denyWrite: string[],
  gitDir: string,
): void {
  const worktreeConfig = join(gitDir, 'config.worktree')
  ensureLinuxGitWorktreeConfigPlaceholder(worktreeConfig)
  const glabDir = join(gitDir, 'glab-cli')
  ensureLinuxGitWorktreeConfigPlaceholder(glabDir)
  denyWrite.push(
    join(gitDir, 'hooks'),
    join(gitDir, 'config'),
    join(gitDir, 'config.lock'),
    worktreeConfig,
    join(gitDir, 'config.worktree.lock'),
    join(gitDir, 'commondir'),
    join(gitDir, 'worktrees'),
    join(gitDir, 'info', 'exclude'),
    glabDir,
  )
  pushLinkedWorktreeConfigDenyWrite(denyWrite, gitDir)
}

/**
 * Official 2.1.325 #2335 (`Hf` `$r` `commonDirDotGitGuarded`):
 * Because a linked worktree's shared `commonDir` is added to `allowWrite` so
 * git can update objects/refs, guard `<commonDir>/.git` against creation or
 * tampering so a sandboxed command cannot plant a nested `.git` inside it.
 */
function guardWorktreeCommonDirDotGit(
  denyWrite: string[],
  commonDir: string,
): void {
  const nestedDotGit = join(commonDir, '.git')
  let st: ReturnType<typeof lstatSync> | undefined
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
    st = lstatSync(nestedDotGit)
  } catch {
    st = undefined
  }
  if (st?.isFile()) {
    denyWrite.push(nestedDotGit)
  } else if (st?.isDirectory()) {
    pushGitDirMetadataDenyWrite(denyWrite, nestedDotGit)
  } else {
    bareGitRepoScrubPaths.push(nestedDotGit)
    if (st === undefined && getPlatform() === 'macos') {
      denyWrite.push(nestedDotGit)
      if (!/[*?]/.test(commonDir)) {
        denyWrite.push(join(commonDir, '.[gG][iI][tT]'))
      }
    }
  }
}

/**
 * Tokenize a POSIX shell command string preserving original token slices so
 * we can inspect and reorder bwrap mount flags without altering shell quoting.
 */
function tokenizeShellCommandPreservingRaw(
  cmd: string,
): Array<{ raw: string; value: string; sep: string }> {
  const tokens: Array<{ raw: string; value: string; sep: string }> = []
  let i = 0
  const n = cmd.length
  while (i < n) {
    const sepStart = i
    while (i < n && /\s/.test(cmd[i]!)) i++
    const sep = cmd.slice(sepStart, i)
    if (i >= n) break
    const rawStart = i
    let value = ''
    while (i < n && !/\s/.test(cmd[i]!)) {
      const ch = cmd[i]!
      if (ch === "'") {
        i++
        while (i < n && cmd[i] !== "'") {
          value += cmd[i++]
        }
        if (i < n) i++
      } else if (ch === '"') {
        i++
        while (i < n && cmd[i] !== '"') {
          if (cmd[i] === '\\' && i + 1 < n) {
            i++
            value += cmd[i++]
          } else {
            value += cmd[i++]
          }
        }
        if (i < n) i++
      } else if (ch === '\\' && i + 1 < n) {
        i++
        value += cmd[i++]
      } else {
        value += cmd[i++]
      }
    }
    tokens.push({ raw: cmd.slice(rawStart, i), value, sep })
  }
  return tokens
}

function isSameOrChildPath(parent: string, child: string): boolean {
  const normParent = parent === '/' ? '/' : parent.replace(/\/+$/, '')
  const normChild = child === '/' ? '/' : child.replace(/\/+$/, '')
  if (normParent === normChild) return true
  const prefix = normParent === '/' ? '/' : `${normParent}/`
  return normChild.startsWith(prefix)
}

function tryCanonicalPath(p: string): string {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- wrap post-process
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * Official 2.1.325 #2340 (SEA `gj`):
 * Fix Linux/WSL `bwrap: Can't create file` when the working directory (an
 * allowed write path) is below an `allowRead` folder inside a `denyRead`
 * (such as under a symlinked home directory).
 *
 * `@anthropic-ai/sandbox-runtime@0.0.73` emits `--bind <writePath>` BEFORE
 * `--ro-bind <allowRead>` right after `--tmpfs <denyDir>`, so an `allowRead`
 * ancestor overwrites the writable child mount read-only and subsequent
 * `--ro-bind /dev/null <stub>` mounts fail with `Can't create file`.
 *
 * Reordering each `--tmpfs` restore block to emit `--ro-bind` restore mounts
 * BEFORE `--bind` restore mounts (matching 2.1.325 `gj()`) keeps the child
 * write path writable on top of the read-only `allowRead` ancestor.
 */
export function fixLinuxBwrapAllowReadMountOrder(
  wrappedCommand: string,
): string {
  if (!wrappedCommand.includes('--tmpfs')) {
    return wrappedCommand
  }
  const tokens = tokenizeShellCommandPreservingRaw(wrappedCommand)
  let changed = false

  let idx = 0
  while (idx < tokens.length) {
    if (tokens[idx]?.value === '--tmpfs' && idx + 1 < tokens.length) {
      const denyDir = tokens[idx + 1]!.value
      const denyDirReal = tryCanonicalPath(denyDir)
      const blockStart = idx + 2
      let cursor = blockStart
      const roRestoreMounts: Array<typeof tokens> = []
      const rwRestoreMounts: Array<typeof tokens> = []
      const rwRestorePaths: Array<{ raw: string; real: string }> = []

      while (cursor + 2 < tokens.length) {
        const flag = tokens[cursor]!.value
        if (flag !== '--bind' && flag !== '--ro-bind') break
        const src = tokens[cursor + 1]!.value
        const dst = tokens[cursor + 2]!.value
        // Stop if this is a /dev/null file mask or sentinel bind (src !== dst)
        if (src === '/dev/null' || src !== dst) break
        const dstReal = tryCanonicalPath(dst)
        const underDeny =
          isSameOrChildPath(denyDir, dst) ||
          isSameOrChildPath(denyDirReal, dstReal)
        if (!underDeny) break
        const group = tokens.slice(cursor, cursor + 3)
        if (flag === '--ro-bind') {
          // Only treat a `--ro-bind` as an `allowRead` restore mount if it is NOT
          // the same path as or a child of any already-collected `--bind` mount.
          // A `--ro-bind` at or below a writable `--bind` (e.g. `.git/hooks`,
          // `.claude/settings.json`) is a `denyWrite` protection and MUST stay
          // after `--bind` — stop scanning the block immediately.
          const isDenyWriteUnderRw = rwRestorePaths.some(
            rw =>
              isSameOrChildPath(rw.raw, dst) ||
              isSameOrChildPath(rw.real, dstReal),
          )
          if (isDenyWriteUnderRw) break
          roRestoreMounts.push(group)
        } else {
          rwRestoreMounts.push(group)
          rwRestorePaths.push({ raw: dst, real: dstReal })
        }
        cursor += 3
      }

      if (roRestoreMounts.length > 0 && rwRestoreMounts.length > 0) {
        // Check if any --bind appeared before a --ro-bind in the original order
        let seenBind = false
        let needsReorder = false
        for (let k = blockStart; k < cursor; k += 3) {
          if (tokens[k]!.value === '--bind') {
            seenBind = true
          } else if (tokens[k]!.value === '--ro-bind' && seenBind) {
            needsReorder = true
            break
          }
        }
        if (needsReorder) {
          // Emit --ro-bind restore mounts first (shallow-first), then --bind restore mounts
          const reordered = [...roRestoreMounts, ...rwRestoreMounts].flat()
          // Preserve original leading separators for each slot
          const originalSeps = tokens
            .slice(blockStart, cursor)
            .map(t => t.sep || ' ')
          for (let k = 0; k < reordered.length; k++) {
            tokens[blockStart + k] = {
              ...reordered[k]!,
              sep: originalSeps[k] ?? ' ',
            }
          }
          changed = true
        }
      }
      idx = cursor
    } else {
      idx++
    }
  }

  if (!changed) return wrappedCommand
  return tokens.map(t => `${t.sep}${t.raw}`).join('')
}

/**
 * Base credential/config file names to protect.
 * Equivalent to official vD8 constant.
 */
export const SENSITIVE_CREDENTIAL_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
] as const

/**
 * Extended credential/config file names to protect (includes .claude.json).
 * Equivalent to official Gwf constant.
 */
export const EXTENDED_CREDENTIAL_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
  '.claude.json',
] as const

/**
 * Sensitive directory names to protect.
 * Equivalent to official V01 constant.
 */
export const SENSITIVE_DIRECTORIES = ['.git', '.vscode', '.idea'] as const

/**
 * Extended sensitive directory names to protect (includes .claude, .husky).
 * Equivalent to official Vwf constant.
 */
export const EXTENDED_SENSITIVE_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
  '.claude',
  '.husky',
] as const

/**
 * CA certificate bundle environment variables that should be scrubbed from
 * subprocess environments. If leaked, an attacker could point these at a
 * malicious CA bundle and MITM tooling (curl, git, pip, node, cargo, etc.).
 * Equivalent to official T01 constant.
 */
export const CA_CERT_ENV_VARS = [
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'PIP_CERT',
  'GIT_SSL_CAINFO',
  'AWS_CA_BUNDLE',
  'CARGO_HTTP_CAINFO',
  'DENO_CERT',
] as const

// Local copies to avoid circular dependency
// (permissions.ts imports SandboxManager, bashPermissions.ts imports permissions.ts)
function permissionRuleValueFromString(
  ruleString: string,
): PermissionRuleValue {
  const matches = ruleString.match(/^([^(]+)\(([^)]+)\)$/)
  if (!matches) {
    return { toolName: ruleString }
  }
  const toolName = matches[1]
  const ruleContent = matches[2]
  if (!toolName || !ruleContent) {
    return { toolName: ruleString }
  }
  return { toolName, ruleContent }
}

function permissionRuleExtractPrefix(permissionRule: string): string | null {
  const match = permissionRule.match(/^(.+):\*$/)
  return match?.[1] ?? null
}

const GLOB_META_RE = /[*?[\]{}]/

/**
 * Official 325 `tk(e)` / `nk(n, e)` (#1119): for macOS Seatbelt `denyWrite`
 * glob patterns whose folder is reached through a symlink, also emit the
 * realpath-resolved glob pattern so `@anthropic-ai/sandbox-runtime`
 * `generateWriteRules` denies writes at the real location.
 */
export function expandSymlinkedDenyWriteGlobs(
  patterns: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  for (const pattern of patterns) {
    add(pattern)
    const idx = pattern.search(GLOB_META_RE)
    if (idx <= 0) continue
    const prefix = pattern.slice(0, idx)
    const suffix = pattern.slice(idx)
    const lastSep = prefix.lastIndexOf('/')
    const anchor =
      lastSep === -1 ? '' : lastSep === 0 ? '/' : prefix.slice(0, lastSep)
    const restPrefix = lastSep === -1 ? prefix : prefix.slice(lastSep + 1)
    if (!anchor || anchor === '/' || anchor.startsWith('/dev')) continue
    const missing: string[] = []
    let cur = anchor
    let realAnchor: string | null = null
    while (true) {
      try {
        const real = realpathSync(cur)
        realAnchor = missing.length === 0 ? real : join(real, ...missing)
        break
      } catch {
        const parent = dirname(cur)
        if (parent === cur) break
        missing.unshift(cur.slice(parent === '/' ? 1 : parent.length + 1))
        cur = parent
      }
    }
    if (
      realAnchor !== null &&
      realAnchor !== anchor &&
      !realAnchor.startsWith('/dev')
    ) {
      add(`${realAnchor}/${restPrefix}${suffix}`)
    }
  }
  return out
}

/**
 * Resolve Claude Code-specific path patterns for sandbox-runtime.
 *
 * Claude Code uses special path prefixes in permission rules:
 * - `//path` → absolute from filesystem root (becomes `/path`)
 * - `/path` → relative to settings file directory (becomes `$SETTINGS_DIR/path`)
 * - `~/path` → passed through (sandbox-runtime handles this)
 * - `./path` or `path` → passed through (sandbox-runtime handles this)
 *
 * This function only handles CC-specific conventions (`//` and `/`).
 * Standard path patterns like `~/` and relative paths are passed through
 * for sandbox-runtime's normalizePathForSandbox to handle.
 *
 * @param pattern The path pattern from a permission rule
 * @param source The settings source this pattern came from (needed to resolve `/path` patterns)
 */
/**
 * densable `kA` — simple glob-char probe used by trailing-slash strip (Mmr).
 * Glob paths keep their trailing slash (directory-glob semantics); non-glob
 * deny/allow paths strip it so `~/.aws/` matches the directory itself.
 */
function pathHasGlobChars(path: string): boolean {
  return (
    path.includes('*') ||
    path.includes('?') ||
    path.includes('[') ||
    path.includes(']')
  )
}

/**
 * densable `Mmr` (2.1.224 #10) — strip trailing `/` on non-Windows, non-glob
 * paths so deny entries written as `~/.aws/` are not silently bypassable.
 * Root `/` stays `/`. Windows keeps trailing separators (drive roots / UNC).
 */
export function stripTrailingSlashForSandbox(
  path: string,
  opts: { evenAfterGlob?: boolean } = {},
): string {
  if (getPlatform() === 'windows' || !path.endsWith('/')) return path
  if (!opts.evenAfterGlob && pathHasGlobChars(path)) return path
  return path.replace(/\/+$/, '') || '/'
}

/**
 * Resolve Claude Code-specific path patterns for sandbox-runtime.
 *
 * Claude Code uses special path prefixes in permission rules:
 * - `//path` → absolute from filesystem root (becomes `/path`)
 * - `/path` → relative to settings file directory (becomes `$SETTINGS_DIR/path`)
 * - `~/path` → passed through (sandbox-runtime handles this)
 * - `./path` or `path` → passed through (sandbox-runtime handles this)
 *
 * This function only handles CC-specific conventions (`//` and `/`).
 * Standard path patterns like `~/` and relative paths are passed through
 * for sandbox-runtime's normalizePathForSandbox to handle.
 *
 * densable `swo`/`ZEo`: after resolve, apply Mmr trailing-slash strip.
 *
 * @param pattern The path pattern from a permission rule
 * @param source The settings source this pattern came from (needed to resolve `/path` patterns)
 */
export function resolvePathPatternForSandbox(
  pattern: string,
  source: SettingSource,
): string {
  // Handle // prefix - absolute from root (CC-specific convention)
  if (pattern.startsWith('//')) {
    return stripTrailingSlashForSandbox(pattern.slice(1)) // "//.aws/**" → "/.aws/**"
  }

  // Handle / prefix - relative to settings file directory (CC-specific convention)
  // Note: ~/path and relative paths are passed through for sandbox-runtime to handle
  if (pattern.startsWith('/') && !pattern.startsWith('//')) {
    const root = getSettingsRootPathForSource(source)
    // Pattern like "/foo/**" becomes "${root}/foo/**"
    return stripTrailingSlashForSandbox(resolve(root, pattern.slice(1)))
  }

  // Other patterns (~/path, ./path, path) pass through as-is
  // sandbox-runtime's normalizePathForSandbox will handle them
  return stripTrailingSlashForSandbox(pattern)
}

/**
 * Resolve paths from sandbox.filesystem.* settings (allowWrite, denyWrite, etc).
 *
 * Unlike permission rules (Edit/Read), these settings use standard path semantics:
 * - `/path` → absolute path (as written, NOT settings-relative)
 * - `~/path` → expanded to home directory
 * - `./path` or `path` → relative to settings file directory
 * - `//path` → absolute (legacy permission-rule syntax, accepted for compat)
 *
 * Fix for #30067: resolvePathPatternForSandbox treats `/Users/foo/.cargo` as
 * settings-relative (permission-rule convention). Users reasonably expect
 * absolute paths in sandbox.filesystem.allowWrite to work as-is.
 *
 * Also expands `~` here rather than relying on sandbox-runtime, because
 * sandbox-runtime's getFsWriteConfig() does not call normalizePathForSandbox
 * on allowWrite paths (it only strips trailing glob suffixes).
 *
 * densable `awo`/`c2t` (2.1.224 #10): expand then Mmr strip trailing slash so
 * `denyRead: "~/.aws/"` is not silently bypassable on Linux/macOS.
 */
export function resolveSandboxFilesystemPath(
  pattern: string,
  source: SettingSource,
): string {
  // Legacy permission-rule escape: //path → /path. Kept for compat with
  // users who worked around #30067 by writing //Users/foo/.cargo in config.
  if (pattern.startsWith('//')) {
    return stripTrailingSlashForSandbox(pattern.slice(1))
  }
  return stripTrailingSlashForSandbox(
    expandPath(pattern, getSettingsRootPathForSource(source)),
  )
}

/**
 * Check if only managed sandbox domains should be used.
 * This is true when policySettings has sandbox.network.allowManagedDomainsOnly: true
 */
export function shouldAllowManagedSandboxDomainsOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.sandbox?.network
      ?.allowManagedDomainsOnly === true
  )
}

function shouldAllowManagedReadPathsOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.sandbox?.filesystem
      ?.allowManagedReadPathsOnly === true
  )
}

/**
 * densable 2.1.216 — managed lock for sandbox.filesystem.disabled.
 * If policySettings configures sandbox.filesystem at all, or lists any
 * sandbox.credentials.files entry, only managed settings may set disabled.
 * credentials.envVars does not pin (env scrubbing is independent of FS layer).
 */
export function isSandboxFilesystemDisabledLockedByManaged(): boolean {
  const managedSandbox = getSettingsForSource('policySettings')?.sandbox
  if (!managedSandbox) {
    return false
  }
  if (managedSandbox.filesystem !== undefined) {
    return true
  }
  // densable: managed lock when credentials.files has any entry (envVars do not pin).
  const files = managedSandbox.credentials?.files
  return Array.isArray(files) && files.length > 0
}

/**
 * densable 2.1.216 Gvg/Wvg gate — effective sandbox.filesystem.disabled.
 *
 * - Native Windows: always false (isolation must stay on).
 * - projectSettings / localSettings: ignored for this flag.
 * - Honored only from userSettings, flagSettings (`--settings`), policySettings.
 * - When managed locks filesystem (or credentials.files), only policySettings.disabled.
 * - Unset → false (FS isolation on).
 */
export function resolveSandboxFilesystemDisabled(): boolean {
  // densable: ignored on native Windows (separate-user sandbox has no grants
  // to loosen by dropping FS rules).
  if (getPlatform() === 'windows') {
    return false
  }

  if (isSandboxFilesystemDisabledLockedByManaged()) {
    return (
      getSettingsForSource('policySettings')?.sandbox?.filesystem?.disabled ===
      true
    )
  }

  // Later sources win among allowed sources (user < flag). policy is only
  // consulted when it does not lock; if it sets filesystem.disabled without
  // "configuring filesystem" it can't happen — lock checks filesystem !== undefined.
  // Allowed sources when unlocked: userSettings, flagSettings.
  // densable also honors managed when unlocked — if managed has disabled without
  // filesystem object it can't; if managed has only other sandbox keys, user/flag apply.
  const flagDisabled =
    getSettingsForSource('flagSettings')?.sandbox?.filesystem?.disabled
  if (flagDisabled !== undefined) {
    return flagDisabled === true
  }

  const userDisabled =
    getSettingsForSource('userSettings')?.sandbox?.filesystem?.disabled
  if (userDisabled !== undefined) {
    return userDisabled === true
  }

  // policySettings without locking filesystem object: still allow explicit true
  // if somehow present under a partial shape (defensive; lock covers normal path).
  const policyDisabled =
    getSettingsForSource('policySettings')?.sandbox?.filesystem?.disabled
  if (policyDisabled !== undefined) {
    return policyDisabled === true
  }

  return false
}

/**
 * Official 2.1.328 (`BMt` + `dG` @291244397): returns true iff the active
 * sandbox can enforce `permissions.blockReadsOutsideWorkingDirectories` via FS
 * read-deny rules (independent of whether the setting is already enabled):
 * - Sandboxing enabled
 * - Platform is not Windows (Windows sandbox does not add read denies)
 * - Filesystem isolation is not disabled (`!resolveSandboxFilesystemDisabled()`
 *   and live `getConfig()?.filesystem?.disabled !== true`)
 * - `allowManagedReadPathsOnly` is not set in `policySettings`
 * - `getOriginalCwd()` contains no glob characters (`[*?[\]]`)
 */
export function canSandboxFenceOutsideReads(): boolean {
  if (!SandboxManager.isSandboxingEnabled()) return false
  if (getPlatform() === 'windows') return false
  if (resolveSandboxFilesystemDisabled()) return false
  const liveCfg = BaseSandboxManager.getConfig?.() as
    | { filesystem?: { disabled?: boolean } }
    | undefined
  if (liveCfg?.filesystem?.disabled === true) return false
  if (shouldAllowManagedReadPathsOnly()) return false
  if (/[*?[\]]/.test(getOriginalCwd())) return false
  return true
}

/**
 * Official 2.1.328 (`BMt` && `h4e` @295799760): returns true iff the active
 * sandbox actually enforces `permissions.blockReadsOutsideWorkingDirectories`
 * via FS read-deny rules.
 */
export function isSandboxFencingOutsideReads(): boolean {
  return (
    canSandboxFenceOutsideReads() &&
    settingsHaveBlockReadsOutsideWorkingDirectories()
  )
}

/** densable Gvg when disabled — enforcement unrestricted (empty deny). */
export function getDisabledSandboxFsReadConfig(): FsReadRestrictionConfig {
  return { denyOnly: [], allowWithinDeny: [] }
}

/** densable Wvg when disabled — enforcement unrestricted write via root allowOnly. */
export function getDisabledSandboxFsWriteConfig(): FsWriteRestrictionConfig {
  return { allowOnly: ['/'], denyWithinAllow: [] }
}

/**
 * densable dual facade diagnostic lists when filesystem.disabled.
 * OUTER getFs* returns these raw configured paths for UI/prompt;
 * package Gvg/Wvg enforcement is unrestricted when filesystem.disabled.
 * Populated by convertToSandboxRuntimeConfig; null when isolation is on.
 */
export type DisabledFsDiagnosticLists = {
  denyRead: string[]
  allowRead: string[]
  allowWrite: string[]
  denyWrite: string[]
}

let disabledFsDiagnostic: DisabledFsDiagnosticLists | null = null

/**
 * densable `CFd.sessionAllowedHosts` / `zvb` — hosts allowed for this session
 * (UI/SDK allow) merged into runtime allowedDomains so the package skips
 * re-asking after compact clears classifier maps.
 */
const sessionAllowedHosts = new Set<string>()

/** densable `KXt` — bracket bare IPv6 for domain list / rule content. */
export function normalizeSandboxSessionHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

/**
 * densable `zvb` / `addSessionAllowedHost` — add host and refreshConfig so
 * convert merges it into allowedDomains.
 */
export function addSessionAllowedHost(host: string): void {
  const normalized = normalizeSandboxSessionHost(host)
  if (sessionAllowedHosts.has(normalized)) return
  sessionAllowedHosts.add(normalized)
  refreshConfig()
}

/** Test helper — densable session bag contents. */
export function getSessionAllowedHosts(): ReadonlySet<string> {
  return sessionAllowedHosts
}

/** Test helper — clear densable session host bag without full reset. */
export function clearSessionAllowedHostsForTests(): void {
  sessionAllowedHosts.clear()
}

/** Test/diagnostic access to last convert dual-facade stash. */
export function getDisabledFsDiagnosticLists(): DisabledFsDiagnosticLists | null {
  return disabledFsDiagnostic
}

/**
 * densable host credentials merge for SandboxRuntimeConfig.credentials.
 *
 * - files: path-resolved via resolveSandboxFilesystemPath; densable 2.1.221
 *   accepts mode "deny"|"mask" + extract/onExtractNoMatch/maskDuplicates/injectHosts.
 * - envVars: later sources win, but mode "deny" is sticky (not overwritten).
 * - mask (files + envVars) from projectSettings/localSettings is skipped
 *   (untrusted repo).
 * - mask from userSettings is skipped when userSettings source is disabled
 *   (densable `ug("userSettings")` / isSettingSourceEnabled).
 * - allowPlaintextInject only from trusted sources (not project/local, not
 *   disabled user).
 * - Package Vzi/Anu/vnu turns this into unsetEnvVars/setEnvVars/maskedFileBinds.
 */
export function mergeSandboxCredentialsForRuntime():
  | SandboxRuntimeConfig['credentials']
  | undefined {
  type Cred = NonNullable<SandboxRuntimeConfig['credentials']>
  const files: NonNullable<Cred['files']> = []
  const envByName = new Map<string, NonNullable<Cred['envVars']>[number]>()
  const awsPairs: NonNullable<Cred['awsPairs']> = []
  let seen = false
  let allowPlaintextInject: boolean | undefined
  let sigv4: Cred['sigv4'] | undefined

  for (const source of SETTING_SOURCES) {
    const cred = getSettingsForSource(source)?.sandbox?.credentials
    if (!cred) {
      continue
    }
    seen = true
    const isProjectLocal =
      source === 'projectSettings' || source === 'localSettings'
    const isUntrustedUser =
      source === 'userSettings' && !isSettingSourceEnabled('userSettings')
    const isTrustedSource = !isProjectLocal && !isUntrustedUser

    for (const entry of cred.files ?? []) {
      if (!entry?.path) {
        continue
      }
      // densable 2.1.221: skip file mask from untrusted project/local or disabled user
      if (entry.mode === 'mask' && (isProjectLocal || isUntrustedUser)) {
        continue
      }
      const resolved: NonNullable<Cred['files']>[number] = {
        path: resolveSandboxFilesystemPath(entry.path, source),
        mode: entry.mode,
      }
      if (entry.mode === 'mask') {
        if (entry.extract !== undefined) {
          resolved.extract = entry.extract
        }
        if (entry.onExtractNoMatch !== undefined) {
          resolved.onExtractNoMatch = entry.onExtractNoMatch
        }
        // densable 2.1.224 #6 — jwt decode + claim-level mask
        if (entry.decode !== undefined) {
          resolved.decode = entry.decode
        }
        if (entry.maskClaims !== undefined) {
          resolved.maskClaims = [...entry.maskClaims]
        }
        if (entry.maskDuplicates !== undefined) {
          resolved.maskDuplicates = entry.maskDuplicates
        }
        if (entry.injectHosts !== undefined) {
          resolved.injectHosts = [...entry.injectHosts]
        }
      }
      files.push(resolved)
    }

    for (const entry of cred.envVars ?? []) {
      if (!entry?.name) {
        continue
      }
      // densable: skip mask from untrusted project/local or disabled user
      if (entry.mode === 'mask' && (isProjectLocal || isUntrustedUser)) {
        continue
      }
      // deny sticky — densable does not let a later entry replace deny
      if (envByName.get(entry.name)?.mode === 'deny') {
        continue
      }
      const envResolved: NonNullable<Cred['envVars']>[number] = {
        name: entry.name,
        mode: entry.mode,
      }
      if (entry.mode === 'mask') {
        // densable 2.1.224 #6 — structured env masking (extract/decode/maskClaims)
        if (entry.extract !== undefined) {
          envResolved.extract = entry.extract
        }
        if (entry.onExtractNoMatch !== undefined) {
          envResolved.onExtractNoMatch = entry.onExtractNoMatch
        }
        if (entry.decode !== undefined) {
          envResolved.decode = entry.decode
        }
        if (entry.maskClaims !== undefined) {
          envResolved.maskClaims = [...entry.maskClaims]
        }
        if (entry.injectHosts !== undefined) {
          envResolved.injectHosts = [...entry.injectHosts]
        }
      }
      envByName.set(entry.name, envResolved)
    }

    if (isTrustedSource && cred.allowPlaintextInject !== undefined) {
      allowPlaintextInject = cred.allowPlaintextInject
    }

    // densable 2.1.224 #6 — awsPairs/sigv4: user/managed/CLI only
    if (isTrustedSource) {
      for (const pair of cred.awsPairs ?? []) {
        if (!pair?.accessKeyIdVar || !pair?.secretAccessKeyVar) {
          continue
        }
        awsPairs.push({
          accessKeyIdVar: pair.accessKeyIdVar,
          secretAccessKeyVar: pair.secretAccessKeyVar,
          ...(pair.sessionTokenVar !== undefined
            ? { sessionTokenVar: pair.sessionTokenVar }
            : {}),
        })
      }
      if (cred.sigv4 !== undefined) {
        sigv4 = {
          ...(cred.sigv4.streaming !== undefined
            ? { streaming: cred.sigv4.streaming }
            : {}),
          ...(cred.sigv4.presigned !== undefined
            ? { presigned: cred.sigv4.presigned }
            : {}),
          ...(cred.sigv4.sigv4a !== undefined
            ? { sigv4a: cred.sigv4.sigv4a }
            : {}),
        }
      }
    }
  }

  if (!seen) {
    return undefined
  }
  return {
    files,
    envVars: [...envByName.values()],
    ...(allowPlaintextInject !== undefined ? { allowPlaintextInject } : {}),
    ...(awsPairs.length > 0 ? { awsPairs } : {}),
    ...(sigv4 !== undefined ? { sigv4 } : {}),
  }
}

/**
 * Convert Claude Code settings format to SandboxRuntimeConfig format
 * (Function exported for testing)
 *
 * @param settings Merged settings (used for sandbox config like network, ripgrep, etc.)
 */
/**
 * Official 325 `i3n()` — deduplicated resolved roots for `--plugin-dir` and
 * `--plugin-dir-no-mcp` flags.
 */
export function getInlinePluginRoots(baseDir = getOriginalCwd()): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const p of [...getInlinePlugins(), ...getInlinePluginsNoMcp()]) {
    const resolved = resolve(baseDir, p)
    if (!seen.has(resolved)) {
      seen.add(resolved)
      roots.push(resolved)
    }
  }
  return roots
}

export function convertToSandboxRuntimeConfig(
  settings: SettingsJson,
): SandboxRuntimeConfig {
  const permissions = settings.permissions || {}

  // Extract network domains from WebFetch rules
  const allowedDomains: string[] = []
  const deniedDomains: string[] = []

  // When allowManagedSandboxDomainsOnly is enabled, only use domains from policy settings
  if (shouldAllowManagedSandboxDomainsOnly()) {
    const policySettings = getSettingsForSource('policySettings')
    for (const domain of policySettings?.sandbox?.network?.allowedDomains ||
      []) {
      allowedDomains.push(domain)
    }
    for (const ruleString of policySettings?.permissions?.allow || []) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        allowedDomains.push(rule.ruleContent.substring('domain:'.length))
      }
    }
  } else {
    for (const domain of settings.sandbox?.network?.allowedDomains || []) {
      allowedDomains.push(domain)
    }
    // Ungated sources only: an untrusted project must not add to the sandbox
    // network allowlist via WebFetch(domain:...).
    for (const ruleString of collectUngatedAllowRuleStrings()) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        allowedDomains.push(rule.ruleContent.substring('domain:'.length))
      }
    }
    // densable LOr: for (let Be of t.sessionAllowedHosts) s.push(Be)
    // Only outside allowManagedDomainsOnly — policy path ignores session bag.
    for (const host of sessionAllowedHosts) {
      allowedDomains.push(host)
    }
  }

  // densable 2.1.219: sandbox.network.deniedDomains from settings, then
  // WebFetch(domain:...) deny rules. Survives allowManagedDomainsOnly.
  for (const domain of settings.sandbox?.network?.deniedDomains || []) {
    deniedDomains.push(domain)
  }
  for (const ruleString of permissions.deny || []) {
    const rule = permissionRuleValueFromString(ruleString)
    if (
      rule.toolName === WEB_FETCH_TOOL_NAME &&
      rule.ruleContent?.startsWith('domain:')
    ) {
      deniedDomains.push(rule.ruleContent.substring('domain:'.length))
    }
  }

  // Extract filesystem paths from Edit and Read rules
  // Always include current directory and Claude temp directory as writable
  // The temp directory is needed for Shell.ts cwd tracking files
  // densable dual facade: when filesystem.disabled we still build full path
  // lists for OUTER getFs* diagnostics; package gets disabled:true + same lists.
  const allowWrite: string[] = ['.', getClaudeTempDir()]
  const denyWrite: string[] = []
  const denyRead: string[] = []
  const allowRead: string[] = []
  const trustedDenyRoots: string[] = []
  const forwardedUntrustedGrants: ForwardedUntrustedGrant[] = []

  // Always deny writes to settings.json files to prevent sandbox escape
  // This blocks settings in the original working directory (where Claude Code started)
  // densable Pa: t.symlinkedDenyScrubPaths.length=0 then C.map(Zt)
  clearSymlinkedDenyLists()
  const settingsPaths = SETTING_SOURCES.map(source =>
    getSettingsFilePathForSource(source),
  ).filter((p): p is string => p !== undefined)
  denyWrite.push(...settingsPaths.map(recordSymlinkedDenyPath))
  denyWrite.push(recordSymlinkedDenyPath(getManagedSettingsDropInDir()))
  // 2.1.299 #598 (SEA OH): On WSL2, protect Windows-side managed settings under DrvFs
  // only when the directory exists so bwrap does not fail with `Can't mkdir /mnt/c/Program Files/ClaudeCode`.
  if (getPlatform() === 'wsl' && existsSync(WSL_WINDOWS_MANAGED_PATH)) {
    denyWrite.push(join(WSL_WINDOWS_MANAGED_PATH, 'managed-settings.json'))
    denyWrite.push(join(WSL_WINDOWS_MANAGED_PATH, 'managed-settings.d'))
  }

  // Also block settings, skills, commands, agents, hooks, workflows, routines,
  // and .mcp.json in original and current working directories (2.1.325 #2334).
  const cwd = getCwdState()
  const originalCwd = getOriginalCwd()
  pushProtectedClaudeDirEntries(denyWrite, originalCwd)
  if (cwd !== originalCwd) {
    pushProtectedClaudeDirEntries(denyWrite, cwd)
  }

  // densable jEr: for (const p of lDs(RPo())) if absolute && !BFs(resolve(p))
  //   m(resolve(p), false, true) → denyWrite. BFs(e) = cpe(e, cwd) = cwd under e.
  // Folds session zvt bag + installed sourceProducerPath / previousProducerPaths
  // so sandboxed Bash cannot mutate mode:"link" producer trees (app-layer DXS
  // alone is not enough). cDs → refreshConfig re-runs this builder.
  for (const producer of scanInstalledCommandProducerDirs(
    getCommandProducerScanRoots(),
  )) {
    if (!isAbsolute(producer)) continue
    const abs = resolve(producer)
    // densable BFs — skip when cwd is the producer or under it (would lock workspace)
    if (isPathEqualOrUnder(abs, cwd)) continue
    denyWrite.push(abs)
  }

  // 2.1.299 #591 (SEA i3n / pc): Protect `--plugin-dir` / `--plugin-dir-no-mcp` roots
  // from sandboxed writes unless originalCwd is equal to or under the plugin root.
  for (const pluginRoot of getInlinePluginRoots(originalCwd)) {
    if (!isPathEqualOrUnder(pluginRoot, originalCwd)) {
      denyWrite.push(recordSymlinkedDenyPath(pluginRoot))
    }
  }

  // SECURITY: Git's is_git_directory() treats cwd as a bare repo if it has
  // HEAD + objects/ + refs/. An attacker planting these (plus a config with
  // core.fsmonitor) escapes the sandbox when Claude's unsandboxed git runs.
  //
  // Unconditionally denying these paths makes sandbox-runtime mount
  // /dev/null at non-existent ones, which (a) leaves a 0-byte HEAD stub on
  // the host and (b) breaks `git log HEAD` inside bwrap ("ambiguous argument").
  // So: if a file exists, denyWrite (ro-bind in place, no stub). If not, scrub
  // it post-command in scrubBareGitRepoFiles() — planted files are gone before
  // unsandboxed git runs; inside the command, git is itself sandboxed.
  bareGitRepoScrubPaths.length = 0
  const bareGitRepoFiles = ['HEAD', 'objects', 'refs', 'hooks', 'config']
  for (const dir of cwd === originalCwd ? [originalCwd] : [originalCwd, cwd]) {
    for (const gitFile of bareGitRepoFiles) {
      const p = resolve(dir, gitFile)
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        statSync(p)
        denyWrite.push(p)
      } catch {
        bareGitRepoScrubPaths.push(p)
      }
    }
  }

  // ==========================================================================
  // Credential & config file write protection (from official CXq() /
  // sandbox.credentials). Prevents sandboxed commands from modifying shell
  // RC files, package manager config, env files, git config, CI/CD runner
  // paths, and credential directories — all of which are vectors for
  // sandbox escape or credential exfiltration.
  // ==========================================================================
  const home = homedir()

  // Shell RC files — modifying these lets an attacker persist across shell
  // sessions (e.g. alias sudo=..., PATH injection, PROMPT_COMMAND hook)
  denyWrite.push(
    join(home, '.bash_profile'),
    join(home, '.bashrc'),
    join(home, '.bash_aliases'),
    join(home, '.bash_login'),
    join(home, '.bash_logout'),
    join(home, '.profile'),
    join(home, '.zshrc'),
    join(home, '.zprofile'),
    join(home, '.zshenv'),
    join(home, '.zlogin'),
    join(home, '.zlogout'),
  )

  // Claude config — modifying these lets an attacker change model, auth,
  // permission rules, hooks, MCP servers, or sandbox settings.
  // Official 2.1.323 #2025: also protect legacy config file (`.config.json`
  // inside config dir / `~/.claude/.config.json`) and backup/lock siblings.
  const claudeConfigDir = getClaudeConfigHomeDir()
  const claudeConfigFiles = [
    join(home, '.claude'),
    join(home, '.claude.json'),
    join(home, '.claude.json.backup'),
    join(home, '.claude.json.lock'),
    join(home, '.claude', '.config.json'),
    join(home, '.claude', '.config.json.backup'),
    join(home, '.claude', '.config.json.lock'),
    claudeConfigDir,
    join(claudeConfigDir, '.claude.json'),
    join(claudeConfigDir, '.claude.json.backup'),
    join(claudeConfigDir, '.claude.json.lock'),
    join(claudeConfigDir, '.config.json'),
    join(claudeConfigDir, '.config.json.backup'),
    join(claudeConfigDir, '.config.json.lock'),
  ]
  for (const cfgPath of claudeConfigFiles) {
    denyWrite.push(cfgPath)
    try {
      const realCfg = realpathSync(cfgPath)
      if (realCfg !== cfgPath) denyWrite.push(realCfg)
    } catch {
      // File may not exist; literal denyWrite still protects it
    }
  }

  // Official 2.1.323 #2027 (`Wb`): block sandboxed commands from reading (or
  // writing) Claude Code's file checkpoint copies (`file-history`) and daemon
  // state under the config directory.
  for (const sub of ['file-history', 'daemon'] as const) {
    const protectedDir = resolve(claudeConfigDir, sub)
    denyRead.push(protectedDir)
    denyWrite.push(protectedDir)
    trustedDenyRoots.push(protectedDir)
    try {
      const realProtected = realpathSync(protectedDir)
      if (realProtected !== protectedDir) {
        denyRead.push(realProtected)
        denyWrite.push(realProtected)
        trustedDenyRoots.push(realProtected)
      }
    } catch {
      // Directory may not exist yet; literal deny still applies
    }
  }

  // Git config — core.fsmonitor / core.sshCommand escape, credential helper
  // poisoning, insteadOf URL rewriting
  denyWrite.push(join(home, '.gitconfig'), join(home, '.config', 'git'))

  // Package manager config files — registry rewriting, script hooks, CA bundle
  // overrides, install-time code execution
  denyWrite.push(
    join(home, '.bunfig.toml'),
    join(originalCwd, 'bunfig.toml'),
    join(originalCwd, 'package.json'),
    ...ENV_FILES.map(f => join(originalCwd, f)),
    join(home, '.npmrc'),
    join(originalCwd, '.npmrc'),
    join(home, '.yarnrc'),
    join(home, '.yarnrc.yml'),
    join(originalCwd, '.yarnrc'),
    join(originalCwd, '.yarnrc.yml'),
    join(home, '.config', 'pip'),
    join(home, '.pip'),
  )

  // Lock files — tampering enables supply-chain attacks by swapping dependency
  // hashes for malicious packages
  denyWrite.push(
    join(originalCwd, 'package-lock.json'),
    join(originalCwd, 'yarn.lock'),
    join(originalCwd, 'pnpm-lock.yaml'),
  )

  // Project-level paths that are gateways for sandbox escape or code execution
  denyWrite.push(
    join(originalCwd, 'node_modules', '.bin'),
    join(originalCwd, '.git', 'modules'),
    join(originalCwd, 'scripts'),
    join(originalCwd, '.claude'),
    join(originalCwd, '.github'),
  )

  // CI/CD self-hosted runner directories — modifying these enables persistent
  // code execution on the runner host
  denyWrite.push(
    join(home, '.local', 'bin'),
    join(home, 'runners'),
    join(home, 'actions-runner'),
  )

  // Official 2.1.325 #2333 (`D5n`): protect the native updater's download
  // staging folder (`$XDG_CACHE_HOME/claude/staging` or `~/.cache/claude/staging`).
  const updaterStagingDir = getUpdaterStagingDir()
  if (isAbsolute(updaterStagingDir)) {
    denyWrite.push(recordSymlinkedDenyPath(updaterStagingDir))
    if (getPlatform() === 'macos') {
      const stagingGrandparent = dirname(dirname(updaterStagingDir))
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        const realGrandparent = realpathSync(stagingGrandparent)
        if (realGrandparent !== stagingGrandparent) {
          denyWrite.push(
            join(
              realGrandparent,
              relative(stagingGrandparent, updaterStagingDir),
            ),
          )
        }
      } catch {
        // Grandparent may not exist yet; literal denyWrite still applies
      }
    }
  }

  // Shared temp buffer used by inline-comments — modifying this could inject
  // content into the conversation context
  denyWrite.push('/tmp/inline-comments-buffer.jsonl')

  // PATH directories under system paths — binaries in these locations could
  // shadow or override expected commands.
  // Equivalent to official fU.pathDirs computation in SXq().
  const pathDirs = (process.env.PATH ?? '')
    .split(':')
    .map(p => (p ? posix.normalize(p).replace(/\/+$/, '') : p))
    .filter(p => p && ALLOW_WRITE_SYSTEM_DIRS.some(d => p.startsWith(`${d}/`)))
  denyWrite.push(...pathDirs)

  // GitHub Actions runner file commands directory — set-env / add-path /
  // set-output commands execute in the runner context, outside the sandbox
  const githubEnv = process.env.GITHUB_ENV
  if (githubEnv) {
    denyWrite.push(dirname(githubEnv))
  }

  // GitHub Actions action path — modifying action source is remote code
  // execution on the runner
  const githubActionPath = process.env.GITHUB_ACTION_PATH
  if (githubActionPath) {
    denyWrite.push(githubActionPath)
    // Also protect the _actions/ prefix directory (the checked-out actions tree)
    if (githubActionPath.includes('/_actions/')) {
      denyWrite.push(
        githubActionPath.slice(0, githubActionPath.indexOf('/_actions/') + 9),
      )
    }
  }

  // GitHub Actions event payload — modifying this can alter workflow behavior
  const githubEventPath = process.env.GITHUB_EVENT_PATH
  if (githubEventPath) {
    denyWrite.push(githubEventPath)
  }

  // Credential & sensitive home directories — Official 2.1.326 #300 (`Tii` / `Cii`):
  // Write-protect sensitive home folders on macOS, Linux, and WSL by default;
  // trusted user/flag/managed `sandbox.filesystem.allowWrite` can explicitly allow them.
  const trustedAllowWriteForHome = [
    ...(getSettingsForSource('userSettings')?.sandbox?.filesystem?.allowWrite ??
      []),
    ...(getSettingsForSource('flagSettings')?.sandbox?.filesystem?.allowWrite ??
      []),
    ...(getSettingsForSource('policySettings')?.sandbox?.filesystem
      ?.allowWrite ?? []),
  ]
  denyWrite.push(
    ...collectSensitiveHomeDenyWritePaths(home, trustedAllowWriteForHome),
  )

  // Git internals in project directory — hooks, config, modules, exclude.
  // densable 2.1.232 #6: project-local glab-cli store (`.git/glab-cli`).
  // densable 2.1.239 #36 CXq: config.lock / config.worktree(+.lock) /
  // commondir / worktrees. G() materializes missing config.worktree on
  // linux/wsl before denyWrite so bwrap does not stub an unreadable hole.
  const projectGitDir = join(originalCwd, '.git')
  const projectWorktreeConfig = join(projectGitDir, 'config.worktree')
  ensureLinuxGitWorktreeConfigPlaceholder(projectWorktreeConfig)
  // Official 2.1.323 #2174: protect `.git/glab-cli` (and materialize placeholder
  // on Linux/WSL if `.git` is a directory so `glab config set` / `glab config edit --local`
  // fail read-only inside the sandbox).
  const projectGlabDir = join(projectGitDir, 'glab-cli')
  ensureLinuxGitWorktreeConfigPlaceholder(projectGlabDir)
  // Official 2.1.323 #2177: protect `.git/worktrees` (and materialize placeholder
  // on Linux/WSL if missing so `git worktree add/move/remove` and commits to
  // ungranted worktrees fail read-only).
  const projectWorktreesDir = join(projectGitDir, 'worktrees')
  denyWrite.push(
    join(projectGitDir, 'hooks'),
    join(projectGitDir, 'config'),
    join(projectGitDir, 'config.lock'),
    projectWorktreeConfig,
    join(projectGitDir, 'config.worktree.lock'),
    join(projectGitDir, 'commondir'),
    projectWorktreesDir,
    join(originalCwd, '.gitmodules'),
    join(projectGitDir, 'info', 'exclude'),
    projectGlabDir,
  )
  pushLinkedWorktreeConfigDenyWrite(denyWrite, projectGitDir)

  // When GITHUB_WORKSPACE differs from cwd (e.g. reusable workflows,
  // composite actions), also protect the workspace's git metadata
  const workspace = process.env.GITHUB_WORKSPACE
  if (workspace && resolve(workspace) !== resolve(originalCwd)) {
    const workspaceGitDir = join(workspace, '.git')
    const workspaceWorktreeConfig = join(workspaceGitDir, 'config.worktree')
    ensureLinuxGitWorktreeConfigPlaceholder(workspaceWorktreeConfig)
    denyWrite.push(
      join(workspaceGitDir, 'hooks'),
      join(workspaceGitDir, 'config'),
      join(workspaceGitDir, 'config.lock'),
      workspaceWorktreeConfig,
      join(workspaceGitDir, 'config.worktree.lock'),
      join(workspaceGitDir, 'commondir'),
      join(workspaceGitDir, 'worktrees'),
      join(workspaceGitDir, 'modules'),
      join(workspaceGitDir, 'info', 'exclude'),
      join(workspaceGitDir, 'glab-cli'),
      join(workspace, '.gitmodules'),
      join(workspace, '.github'),
      join(workspace, '.claude'),
    )
    pushLinkedWorktreeConfigDenyWrite(denyWrite, workspaceGitDir)
  }

  // Deny read access to container runtime sockets — these allow escaping
  // the sandbox by spawning privileged containers on the host
  denyRead.push(...DENY_READ_SOCKET_PATHS)
  denyRead.push(...DENY_READ_ENV_GLOBS)

  // Official 2.1.326 #22: when home or config directory resolves through a
  // symlink into `/net` on Linux/WSL, avoid failing bwrap startup on `/net`
  // autofs denyRead ancestors while preserving literal path protection.
  const filteredDenyRead = filterLinuxNetSymlinkDenyRead(
    denyRead,
    home,
    claudeConfigDir,
  )
  denyRead.length = 0
  denyRead.push(...filteredDenyRead)

  // #200 SEA CXq: ~/.claude/seed-admin holds private git directories of
  // cloud-session /ultrareview uploads — materialize and block both reads and writes.
  const seedAdminDir = join(getClaudeConfigHomeDir(), 'seed-admin')
  try {
    mkdirSync(seedAdminDir, { recursive: true, mode: 0o700 })
  } catch {
    // Best-effort materialization; deny rules still apply.
  }
  denyWrite.push(seedAdminDir)
  denyRead.push(seedAdminDir)
  trustedDenyRoots.push(seedAdminDir)
  try {
    const realSeedAdminDir = realpathSync(seedAdminDir)
    if (realSeedAdminDir !== seedAdminDir) {
      denyWrite.push(realSeedAdminDir)
      denyRead.push(realSeedAdminDir)
      trustedDenyRoots.push(realSeedAdminDir)
    }
  } catch {
    // Directory may not exist if mkdirSync failed.
  }

  // Include directories added via --add-dir CLI flag or /add-dir command.
  // These must be in allowWrite so that Bash commands (which run inside the
  // sandbox) can access them — not just file tools, which check permissions
  // at the app level via pathInAllowedWorkingPath().
  // Two sources: persisted in settings, and session-only in bootstrap state.
  // collectUngatedAdditionalDirectories rather than the merged settings: when
  // autoAllowBashIfSandboxed is on Bash runs unprompted, so this list is the
  // only boundary left, and an untrusted project's additionalDirectories must
  // not widen it just because the app-level gate dropped them elsewhere.
  const worktreePin = getWorktreeAddDirPinState()
  const rawAdditionalDirs = [
    ...collectUngatedAdditionalDirectories(),
    ...getAdditionalDirectoriesForClaudeMd(),
  ]
  const additionalDirs = new Set(
    worktreePin.launchFolder !== undefined
      ? rawAdditionalDirs.map(dir =>
          resolveWorktreeAddDirEntry(
            dir,
            worktreePin.launchFolder!,
            true,
            rel => join(cwd, rel),
          ),
        )
      : rawAdditionalDirs,
  )
  allowWrite.push(...additionalDirs)

  // Official 2.1.325 #2358 (`jf` / `_o`): refuse sandboxed writes to `.claude`
  // settings, skills, agents, commands, hooks, and `.mcp.json` in added
  // directories, matching the launch folder protection.
  for (const addedDir of additionalDirs) {
    if (!addedDir || pathHasGlobChars(addedDir)) continue
    pushProtectedClaudeDirEntries(denyWrite, addedDir)
    if (getPlatform() === 'macos') {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        const realAddedDir = realpathSync(addedDir)
        if (realAddedDir !== addedDir) {
          pushProtectedClaudeDirEntries(denyWrite, realAddedDir)
        }
      } catch {
        // Directory may not exist yet
      }
    }
  }

  // Official 2.1.323 #2177/#2174 + 2.1.325 #2334/#2335 (`Hf` / `$r`):
  // Protect linked worktrees' shared git folder (`commonDir`), main repo
  // `.claude` settings/hooks, and `<commonDir>/.git` across originalCwd, cwd,
  // cached startup worktree, and any added worktree directories.
  const linkedWorktreeCommonDirs = new Set<string>()
  const worktreeCheckDirs = new Set<string>([originalCwd, cwd])
  for (const addedDir of additionalDirs) {
    if (addedDir && !pathHasGlobChars(addedDir)) {
      worktreeCheckDirs.add(addedDir)
    }
  }
  if (worktreeMainRepoPath) {
    linkedWorktreeCommonDirs.add(worktreeMainRepoPath)
  }
  for (const dir of worktreeCheckDirs) {
    const detected = detectWorktreeMainRepoPath(dir)
    if (detected) {
      linkedWorktreeCommonDirs.add(detected)
      // Protect `.git` file inside a linked worktree from tampering
      const wtDotGit = join(dir, '.git')
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        if (lstatSync(wtDotGit).isFile()) {
          denyWrite.push(wtDotGit)
        }
      } catch {
        // Ignore if vanished
      }
    }
  }
  for (const commonDir of linkedWorktreeCommonDirs) {
    if (commonDir !== cwd && !allowWrite.includes(commonDir)) {
      allowWrite.push(commonDir)
    }
    pushGitDirMetadataDenyWrite(denyWrite, commonDir)
    guardWorktreeCommonDirDotGit(denyWrite, commonDir)
    // Also protect the main repo root's `.claude` settings & hooks (#2334)
    if (basename(commonDir) === '.git') {
      const mainRepoRoot = dirname(commonDir)
      if (
        mainRepoRoot &&
        mainRepoRoot !== originalCwd &&
        mainRepoRoot !== cwd
      ) {
        pushProtectedClaudeDirEntries(denyWrite, mainRepoRoot)
      }
    }
  }

  // Iterate through each settings source to resolve paths correctly
  // Path patterns like `/foo` are relative to the settings file directory,
  // so we need to know which source each rule came from
  for (const source of SETTING_SOURCES) {
    const sourceSettings = getSettingsForSource(source)
    // densable 2.1.246 #61 — `--setting-sources` must skip disabled sources
    // (network already did; filesystem/permission rules did not).
    if (!isSettingSourceEnabled(source)) {
      if (sourceSettings?.permissions || sourceSettings?.sandbox?.filesystem) {
        logForDebugging(
          `Sandbox: ignoring permission rules and sandbox.filesystem entries from disabled setting source ${source}`,
          { level: 'info' },
        )
      }
      continue
    }

    // Extract filesystem paths from permission rules
    if (sourceSettings?.permissions) {
      // Allow only — deny is never gated.
      const gatedGrants = isSourceGrantsGated(source)
      for (const ruleString of gatedGrants
        ? []
        : sourceSettings.permissions.allow || []) {
        const rule = permissionRuleValueFromString(ruleString)
        if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
          const resolvedWrite = resolvePathPatternForSandbox(
            rule.ruleContent,
            source,
          )
          allowWrite.push(resolvedWrite)
          if (source === 'projectSettings' || source === 'localSettings') {
            forwardedUntrustedGrants.push({
              literal: resolvedWrite,
              list: 'allowWrite',
            })
          }
        }
      }

      for (const ruleString of sourceSettings.permissions.deny || []) {
        const rule = permissionRuleValueFromString(ruleString)
        if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
          denyWrite.push(resolvePathPatternForSandbox(rule.ruleContent, source))
        }
        if (rule.toolName === FILE_READ_TOOL_NAME && rule.ruleContent) {
          const resolvedDeny = resolvePathPatternForSandbox(
            rule.ruleContent,
            source,
          )
          denyRead.push(resolvedDeny)
          if (
            source === 'policySettings' ||
            source === 'flagSettings' ||
            source === 'userSettings'
          ) {
            trustedDenyRoots.push(resolvedDeny)
          }
        }
      }
    }

    // Extract filesystem paths from sandbox.filesystem settings
    // sandbox.filesystem.* uses standard path semantics (/path = absolute),
    // NOT the permission-rule convention (/path = settings-relative). #30067
    const fs = sourceSettings?.sandbox?.filesystem
    if (fs) {
      for (const p of fs.allowWrite || []) {
        const resolvedWrite = resolveSandboxFilesystemPath(p, source)
        allowWrite.push(resolvedWrite)
        if (source === 'projectSettings' || source === 'localSettings') {
          forwardedUntrustedGrants.push({
            literal: resolvedWrite,
            list: 'allowWrite',
          })
        }
      }
      for (const p of fs.denyWrite || []) {
        denyWrite.push(resolveSandboxFilesystemPath(p, source))
      }
      for (const p of fs.denyRead || []) {
        const resolvedDeny = resolveSandboxFilesystemPath(p, source)
        denyRead.push(resolvedDeny)
        if (
          source === 'policySettings' ||
          source === 'flagSettings' ||
          source === 'userSettings'
        ) {
          trustedDenyRoots.push(resolvedDeny)
        }
      }
      if (!shouldAllowManagedReadPathsOnly() || source === 'policySettings') {
        for (const p of fs.allowRead || []) {
          const resolvedRead = resolveSandboxFilesystemPath(p, source)
          allowRead.push(resolvedRead)
          if (source === 'projectSettings' || source === 'localSettings') {
            forwardedUntrustedGrants.push({
              literal: resolvedRead,
              list: 'allowRead',
            })
          }
        }
      }
    }

    // densable: credentials.files are NOT merged into filesystem.denyRead here.
    // Host convert only path-resolves them onto runtime `credentials` (merge
    // below). Package Gvg/Dou unions WZn(credentials) with filesystem.denyRead
    // at enforcement time (Vzi). When filesystem.disabled, Gvg drops both FS
    // denyRead and credential file denies; env scrub still applies.
  }
  // densable 2.1.232 #48: rkt().map(s => s?.sandbox?.ripgrep).find(...)
  // — policy / flag / user only; project+local must not override the binary.
  // In embedded mode (argv0='rg' dispatch), sandbox-runtime spawns with argv0 set.
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()
  const ripgrepConfig = resolveSandboxRipgrep() ?? {
    command: rgPath,
    args: rgArgs,
    argv0,
  }

  // Official: host-injected CLAUDE_CODE_HOST_*_PROXY_PORT fill sandbox
  // network ports when settings omit them (bwrap --setenv path).
  const hostProxy = readHostProxyPorts()

  // densable credentials merge (files path-resolved; env mask trust gates)
  const credentials = mergeSandboxCredentialsForRuntime()
  recordReadDenyRecheckBaseline({
    trustedDenyRoots,
    forwardedUntrustedGrants,
  })

  // #1120 SEA: include --mcp-config file paths (and resolved targets) in denyWrite
  for (const mcpPath of getFlagMcpConfigFilePaths()) {
    denyWrite.push(mcpPath)
    try {
      const realMcp = realpathSync(mcpPath)
      if (realMcp !== mcpPath) denyWrite.push(realMcp)
    } catch {
      // Target may not exist yet
    }
  }

  // #1128 SEA Ger(): include Anthropic profile store dirs/files in denyWrite
  const profileStore = getProfileStoreDenyPaths()
  if (profileStore !== null) {
    for (const d of profileStore.dirs) {
      denyWrite.push(d)
      try {
        const realD = realpathSync(d)
        if (realD !== d) denyWrite.push(realD)
      } catch {
        // Ignore
      }
    }
    for (const f of profileStore.files) {
      denyWrite.push(f)
      try {
        const realF = realpathSync(f)
        if (realF !== f) denyWrite.push(realF)
      } catch {
        // Ignore
      }
    }
  }

  // Official 2.1.323 #2175 (`N3`): on macOS, Linux, and WSL, ignore write
  // access granted through a symlink inside a writable folder that leads
  // elsewhere or to a missing path; users must grant the real path instead.
  const currentPlat = getPlatform()
  if (
    currentPlat === 'macos' ||
    currentPlat === 'linux' ||
    currentPlat === 'wsl'
  ) {
    const tempDir = getClaudeTempDir()
    for (let i = allowWrite.length - 1; i >= 0; i--) {
      const entry = allowWrite[i]
      if (!entry || entry === '.' || entry === tempDir) continue
      if (isAllowWriteSymlinkEscapingOrDangling(entry, currentPlat)) {
        logForDebugging(
          `[Sandbox] Ignoring allowWrite entry "${entry}": it passes through a symlink leading elsewhere or to a missing path (grant the real path instead)`,
          { level: 'warn' },
        )
        allowWrite.splice(i, 1)
      }
    }
  }

  // #1119 SEA tk/nk: on macOS, expand denyWrite glob patterns whose parent
  // folder is reached through a symlink so Seatbelt denies writes at the real path.
  if (getPlatform() === 'macos') {
    const expanded = expandSymlinkedDenyWriteGlobs(denyWrite)
    denyWrite.length = 0
    denyWrite.push(...expanded)
  }

  // #1272 SEA: apply permissions.blockReadsOutsideWorkingDirectories to sandbox
  // denyRead / allowRead unless allowManagedReadPathsOnly is enabled in policySettings.
  if (
    settingsHaveBlockReadsOutsideWorkingDirectories() &&
    !shouldAllowManagedReadPathsOnly()
  ) {
    const workingDirs = [
      originalCwd,
      ...Array.from(additionalDirs).map(d => expandPath(d)),
    ]
    const nonGlobWorkingDirs = workingDirs.filter(p => !/[*?[\]]/.test(p))
    const inlinePluginRoots = getInlinePluginRoots(originalCwd)
    const inlinePluginRootSet = new Set(inlinePluginRoots)

    // Prevent `bwrap: Can't create file` when a `--plugin-dir` folder is also
    // an added directory (`additionalDirectories`): keep it in `allowRead` and
    // `denyWrite`, not `allowWrite`.
    for (let i = allowWrite.length - 1; i >= 0; i--) {
      const w = allowWrite[i]
      if (
        w !== undefined &&
        inlinePluginRootSet.has(w) &&
        !isPathEqualOrUnder(w, originalCwd)
      ) {
        allowWrite.splice(i, 1)
      }
    }

    // Snapshot pre-existing denyRead entries (expanded) BEFORE adding
    // fenceRoots so reopenCandidates (originalCwd, additionalDirectories,
    // project/memory dirs, explicit Claude subdirs) are only filtered by
    // pre-existing denies and NOT by the fenceRoots we are about to add.
    const existingDenies = denyRead.map(d => {
      try {
        return expandPath(d)
      } catch {
        return d
      }
    })

    const fenceRoots = [
      '~/',
      '/home/',
      '/Users/',
      '/root/',
      '/mnt/',
      '/media/',
      '/run/media/',
      '/Volumes/',
      '/srv/',
    ]
    for (const rawRoot of fenceRoots) {
      const resolvedRoot = expandPath(rawRoot)
      if (nonGlobWorkingDirs.some(wd => isPathEqualOrUnder(wd, resolvedRoot))) {
        continue
      }
      denyRead.push(resolvedRoot)
    }

    const claudeDir = getClaudeConfigHomeDir()
    const projectConfigDir = getProjectDir(originalCwd)
    let autoMemDir: string | undefined
    try {
      const rawAutoMem = resolve(getAutoMemPath())
      if (!/[*?[\]]/.test(rawAutoMem)) {
        autoMemDir = rawAutoMem
      }
    } catch {
      // ignore if auto-memory path cannot be computed
    }
    const reopenCandidates = [
      ...nonGlobWorkingDirs,
      ...inlinePluginRoots.filter(p => !/[*?[\]]/.test(p)),
      ...inlinePluginRoots.flatMap(p => {
        try {
          const real = realpathSync(p)
          return real !== p && !/[*?[\]]/.test(real) ? [real] : []
        } catch {
          return []
        }
      }),
      getClaudeTempDir(),
      ...(!/[*?[\]]/.test(projectConfigDir) ? [projectConfigDir] : []),
      ...(autoMemDir !== undefined ? [autoMemDir] : []),
      join(claudeDir, 'shell-snapshots'),
      join(claudeDir, 'session-env'),
      join(claudeDir, 'skills'),
      join(claudeDir, 'plugins'),
      join(claudeDir, 'rules'),
      join(claudeDir, 'agents'),
      join(claudeDir, 'commands'),
    ]
    for (const candidate of reopenCandidates) {
      if (
        existingDenies.some(
          expandedDeny =>
            !/[*?[\]]/.test(expandedDeny) &&
            isPathEqualOrUnder(expandedDeny, candidate),
        )
      ) {
        continue
      }
      if (!allowRead.includes(candidate)) {
        allowRead.push(candidate)
      }
    }
  }

  // densable Xot()==="relaxed": attach filesystem.disabled + keep full path lists
  // on getConfig(). sandbox-runtime@0.0.70 honors filesystem.disabled natively
  // (Gvg empty / Wvg allowOnly['/'] / Bou skip FS mounts). OUTER getFs* still
  // returns raw diagnostic lists from this stash.
  const filesystemDisabled = resolveSandboxFilesystemDisabled()
  if (filesystemDisabled) {
    disabledFsDiagnostic = {
      denyRead: [...denyRead],
      allowRead: [...allowRead],
      allowWrite: [...allowWrite],
      denyWrite: [...denyWrite],
    }
  } else {
    disabledFsDiagnostic = null
  }

  // densable FQt tlsTerminate: policy → flag → enabled userSettings only
  // (project/local ignored). Windows without CA paths: warn + skip ephemeral.
  // densable 2.1.219: strictAllowlist via GDt() sources (policy/flag/user only).
  // Package @anthropic-ai/sandbox-runtime@0.0.70 does not yet read the field;
  // host still stamps it for forward-compat and enforces via ask-callback.
  const strictAllowlist = resolveSandboxStrictAllowlist() || undefined
  const network: SandboxRuntimeConfig['network'] & {
    strictAllowlist?: boolean
  } = {
    allowedDomains,
    deniedDomains,
    ...(strictAllowlist ? { strictAllowlist: true } : {}),
    allowUnixSockets: settings.sandbox?.network?.allowUnixSockets,
    allowAllUnixSockets: settings.sandbox?.network?.allowAllUnixSockets,
    // densable 2.1.251 #66 qe — network.allowMachLookup (macOS XPC allowlist)
    allowMachLookup: settings.sandbox?.network?.allowMachLookup,
    allowLocalBinding: settings.sandbox?.network?.allowLocalBinding,
    httpProxyPort:
      settings.sandbox?.network?.httpProxyPort ?? hostProxy.httpProxyPort,
    socksProxyPort:
      settings.sandbox?.network?.socksProxyPort ?? hostProxy.socksProxyPort,
  }
  const tlsTerminate = resolveSandboxTlsTerminate()
  if (tlsTerminate !== undefined) {
    if (
      getPlatform() === 'windows' &&
      tlsTerminate.caCertPath === undefined &&
      tlsTerminate.caKeyPath === undefined
    ) {
      logForDebugging(
        '[sandbox] settings tlsTerminate has no caCertPath/caKeyPath; on Windows an ephemeral CA cannot pass srt-win user trust-ca — ignoring until a persistent CA is configured',
        { level: 'warn' },
      )
    } else {
      network.tlsTerminate = tlsTerminate
    }
  }

  // densable Pa: `Nu=!1`; WeakMap.set(Ya, Nu) then return Ya
  // densable 2.1.251 #66 qe — allowAppleEvents + enableWeaker* land on package config
  const config = {
    network,
    filesystem: {
      denyRead,
      allowRead,
      allowWrite,
      denyWrite,
      ...(filesystemDisabled ? { disabled: true as const } : {}),
    },
    ...(credentials !== undefined ? { credentials } : {}),
    ignoreViolations: settings.sandbox?.ignoreViolations,
    enableWeakerNestedSandbox: settings.sandbox?.enableWeakerNestedSandbox,
    enableWeakerNetworkIsolation:
      settings.sandbox?.enableWeakerNetworkIsolation,
    allowAppleEvents: settings.sandbox?.allowAppleEvents,
    allowNestedUserNamespaces: settings.sandbox?.allowNestedUserNamespaces,
    ripgrep: ripgrepConfig,
  }
  rememberBuiltConfigAllowlist(config, false)
  return config
}

/**
 * densable FQt / GDt sources for network fields honored only from
 * managed/policy, flag (`--settings`), and enabled userSettings.
 * Project/local ignored.
 */
function trustedSandboxNetworkSources(): Array<
  SettingsJson | null | undefined
> {
  return [
    getSettingsForSource('policySettings'),
    getSettingsForSource('flagSettings'),
    isSettingSourceEnabled('userSettings')
      ? getSettingsForSource('userSettings')
      : null,
  ]
}

/**
 * densable FQt slice for network.tlsTerminate — managed/policy, flag, then
 * userSettings only when that source is enabled. Project/local ignored.
 */
export function resolveSandboxTlsTerminate():
  | NonNullable<SandboxRuntimeConfig['network']['tlsTerminate']>
  | undefined {
  return trustedSandboxNetworkSources()
    .map(s => s?.sandbox?.network?.tlsTerminate)
    .find(v => v !== undefined)
}

/**
 * densable 2.1.219 GDt().some(K => K?.sandbox?.network?.strictAllowlist === true)
 * — user / managed / CLI only; project settings ignored.
 */
export function resolveSandboxStrictAllowlist(): boolean {
  return trustedSandboxNetworkSources().some(
    s => s?.sandbox?.network?.strictAllowlist === true,
  )
}

/**
 * densable 2.1.232 #48 — sandbox.ripgrep via rkt() layers:
 * policy tiers + flagSettings + enabled userSettings; project/local ignored.
 * First defined wins (policy → flag → user), matching densable `.find`.
 */
export function resolveSandboxRipgrep():
  | { command: string; args?: string[] }
  | undefined {
  const raw = trustedSandboxNetworkSources()
    .map(s => s?.sandbox?.ripgrep)
    .find(v => v !== undefined && v !== null)
  if (!raw || typeof raw !== 'object') return undefined
  const command = (raw as { command?: unknown }).command
  if (typeof command !== 'string' || command.length === 0) return undefined
  const argsRaw = (raw as { args?: unknown }).args
  const args = Array.isArray(argsRaw)
    ? argsRaw.filter((a): a is string => typeof a === 'string')
    : undefined
  return args !== undefined ? { command, args } : { command }
}

/**
 * densable XEn — sandbox.bwrapPath from managed/policy tiers only.
 * Project/user/flag ignored (schema: admin-controlled managed settings).
 */
export function resolveSandboxBwrapPath(): string | undefined {
  const v = getSettingsForSource('policySettings')?.sandbox?.bwrapPath
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * densable Mad — sandbox.socatPath from managed/policy tiers only.
 */
export function resolveSandboxSocatPath(): string | undefined {
  const v = getSettingsForSource('policySettings')?.sandbox?.socatPath
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * densable `tuu` — pure warning when envVars mask is configured but neither
 * network.tlsTerminate nor credentials.allowPlaintextInject is set.
 * Exported for tests / doctor; package Anu still masks to sentinels either way.
 */
export function maskCredentialInjectionWarning(
  config: SandboxRuntimeConfig | undefined | null,
): string | undefined {
  if (!config) {
    return undefined
  }
  const maskNames = (config.credentials?.envVars ?? [])
    .filter(r => r.mode === 'mask')
    .map(r => r.name)
  if (maskNames.length === 0) {
    return undefined
  }
  if (
    config.network.tlsTerminate !== undefined ||
    config.credentials?.allowPlaintextInject
  ) {
    return undefined
  }
  return (
    `sandbox.credentials mask entries (${maskNames.join(', ')}) are configured ` +
    'but TLS termination is unavailable — sandboxed commands see only a ' +
    'sentinel value and the proxy cannot substitute the real credential on egress, so tools needing these will fail to authenticate. Enable sandbox.network.tlsTerminate, or remove the mask entries'
  )
}

/**
 * densable `ruu` — gate for mask-credential warning path.
 * densable: (tkt() || (zO()&&false)) && cjr() ≡ settings sandbox.enabled && platform allowed.
 */
function canMaskCredentialWarningFire(): boolean {
  return getSandboxEnabledSetting() && isPlatformInEnabledList()
}

/**
 * densable `o0g` / getMaskCredentialWarning — needs package getConfig() (after init).
 */
function getMaskCredentialWarning(): string | undefined {
  try {
    if (!canMaskCredentialWarningFire()) {
      return undefined
    }
    const cfg = BaseSandboxManager.getConfig?.()
    if (cfg === undefined) {
      return undefined
    }
    return maskCredentialInjectionWarning(cfg)
  } catch (e) {
    logForDebugging(`Failed to compute mask credential warning: ${e}`)
    return undefined
  }
}

// ============================================================================
// Claude CLI-specific state
// ============================================================================

let initializationPromise: Promise<void> | undefined
let settingsSubscriptionCleanup: (() => void) | undefined

// Cached main repo path for git worktrees, resolved once during initialize().
// In a worktree, .git is a file containing "gitdir: /path/to/main/repo/.git/worktrees/name".
// undefined = not yet resolved; null = not a worktree or detection failed.
let worktreeMainRepoPath: string | null | undefined

// Bare-repo files at cwd that didn't exist at config time and should be
// scrubbed if they appear after a sandboxed command. See anthropics/claude-code#29316.
const bareGitRepoScrubPaths: string[] = []

/**
 * Delete bare-repo files planted at cwd during a sandboxed command, before
 * Claude's unsandboxed git calls can see them. See the SECURITY block above
 * bareGitRepoFiles. anthropics/claude-code#29316.
 */
function scrubBareGitRepoFiles(): void {
  for (const p of bareGitRepoScrubPaths) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand must be sync (Shell.ts:367)
      rmSync(p, { recursive: true })
      logForDebugging(`[Sandbox] scrubbed planted bare-repo file: ${p}`)
    } catch {
      // ENOENT is the expected common case — nothing was planted
    }
  }
}

/**
 * densable `Dr` arm of WZ `Vm`/`ne`.
 */
function worktreeGitAdminKindUnsafe(path: string): boolean {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return true
    return !st.isFile() && !st.isDirectory()
  } catch (err) {
    const code = getErrnoCode(err)
    return code !== 'ENOENT' && code !== 'ENOTDIR'
  }
}

/**
 * densable WZ — worktree cwd → main `.git` directory (not repo root).
 * `Vm` = `ne` (`!ae` hop-walk + `Dr`). `Ji` = `ko`. `Qi` = `xe`.
 */
export function detectWorktreeMainRepoPath(cwd: string): string | null {
  const gitPath = join(cwd, '.git')
  try {
    if (gitAdminHopUnsafe(gitPath, cwd)) return null
    if (worktreeGitAdminKindUnsafe(gitPath)) return null
    const gitdirMatch = readFileSync(gitPath, { encoding: 'utf8' }).match(
      /^gitdir:\s*(.+)$/m,
    )
    if (!gitdirMatch?.[1]) return null
    const pointer = gitdirMatch[1].trim()
    if (isWorktreePathNetworkRelativeToCwd(pointer, cwd)) return null
    if (gitdirPointerHopUnsafe(pointer, cwd)) return null
    const worktreeGitDir = resolve(cwd, pointer)
    const worktreesDir = dirname(worktreeGitDir)
    if (basename(worktreesDir) !== 'worktrees') return null
    const mainGitDir = dirname(worktreesDir)
    if (!basename(mainGitDir).endsWith('.git')) return null
    const worktreeGitdirFile = join(worktreeGitDir, 'gitdir')
    if (gitAdminHopUnsafe(worktreeGitdirFile, worktreeGitDir)) return null
    if (worktreeGitAdminKindUnsafe(worktreeGitdirFile)) return null
    const worktreeGitPointer = readFileSync(worktreeGitdirFile, {
      encoding: 'utf8',
    }).trim()
    if (isWorktreePathNetworkRelativeToCwd(worktreeGitPointer, cwd)) {
      return null
    }
    if (gitdirPointerHopUnsafe(worktreeGitPointer, worktreeGitDir, cwd)) {
      return null
    }
    if (
      realpathSync(resolve(worktreeGitDir, worktreeGitPointer)) !==
      join(realpathSync(cwd), '.git')
    ) {
      return null
    }
    return mainGitDir
  } catch {
    return null
  }
}

/**
 * Check if dependencies are available (memoized)
 * Returns { errors, warnings } - errors mean sandbox cannot run
 */
const APPARMOR_USERNS_RESTRICT_PATH =
  '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
const APPARMOR_USERNS_ERROR_RE =
  /setting up uid map: Permission denied|Failed RTM_NEWADDR/
const APPARMOR_BWRAP_TRIAL_ARGS = [
  '--unshare-user',
  '--unshare-net',
  '--dev-bind',
  '/',
  '/',
  '/bin/true',
]
const APPARMOR_BWRAP_TRIAL_TIMEOUT_MS = 2000

export type AppArmorProbeDeps = {
  readRestrictionSwitch: () => string | undefined
  resolveBubblewrap: () => string | null
  tryBubblewrap: (bwrapPath: string) => {
    ran: boolean
    exitCode: number | null
    stderr: string
  }
}

function defaultResolveBubblewrap(): string | null {
  try {
    const custom = getSettings_DEPRECATED()?.sandbox?.bwrapPath
    if (custom) return expandPath(custom)
  } catch {
    // ignore settings read error
  }
  return 'bwrap'
}

function defaultTryBubblewrap(bwrapPath: string): {
  ran: boolean
  exitCode: number | null
  stderr: string
} {
  try {
    const res = spawnSync(bwrapPath, APPARMOR_BWRAP_TRIAL_ARGS, {
      cwd: '/',
      env: sandboxHelperSubprocessEnv({
        PATH: '/usr/bin:/bin',
        USER_TYPE: 'external',
        NODE_ENV: 'production',
      }),
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: APPARMOR_BWRAP_TRIAL_TIMEOUT_MS,
      encoding: 'utf8',
    })
    return {
      ran:
        res.error === undefined &&
        res.signal === null &&
        typeof res.status === 'number',
      exitCode: res.status ?? null,
      stderr: typeof res.stderr === 'string' ? res.stderr : '',
    }
  } catch {
    return { ran: false, exitCode: null, stderr: '' }
  }
}

/**
 * Official 2.1.325 #2371/#2372 (SEA `g1(d3)`):
 * Run a synchronous sandbox-runtime helper call with Claude Code's sign-in
 * tokens, API keys, and `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` temporarily
 * removed from `process.env` so child probes (`which`, `bwrap --version`,
 * `npm root -g`, `rg`) never inherit them. Safe because JS is single-threaded
 * across synchronous calls.
 */
function withStrippedSandboxHelperEnvSync<T>(fn: () => T): T {
  const sanitized = sandboxHelperSubprocessEnv(process.env)
  const removed: Array<[string, string | undefined]> = []
  for (const key of Object.keys(process.env)) {
    if (!(key in sanitized)) {
      removed.push([key, process.env[key]])
      delete process.env[key]
    }
  }
  try {
    return fn()
  } finally {
    for (const [key, val] of removed) {
      if (val !== undefined) {
        process.env[key] = val
      }
    }
  }
}

// Forward-compatible hook for sandbox-runtime versions exposing helper env provider
const baseSandboxWithHelperEnv = BaseSandboxManager as unknown as {
  setHelperEnvProvider?: (provider: () => NodeJS.ProcessEnv) => void
}
baseSandboxWithHelperEnv.setHelperEnvProvider?.(sandboxHelperSubprocessEnv)

/**
 * Official 325 `$W` (#1207): detect Ubuntu AppArmor unprivileged userns restriction
 * blocking `bwrap` and return an actionable remediation message.
 */
export function detectLinuxAppArmorUsernsRestriction(
  deps: AppArmorProbeDeps = {
    readRestrictionSwitch: () => {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- sync dependency probe
        return readFileSync(APPARMOR_USERNS_RESTRICT_PATH, 'utf8')
      } catch {
        return undefined
      }
    },
    resolveBubblewrap: defaultResolveBubblewrap,
    tryBubblewrap: defaultTryBubblewrap,
  },
): string | undefined {
  try {
    if (deps.readRestrictionSwitch()?.trim() !== '1') return undefined
    const bwrapPath = deps.resolveBubblewrap()
    if (bwrapPath === null) return undefined
    const trial = deps.tryBubblewrap(bwrapPath)
    if (!trial.ran || trial.exitCode === 0) return undefined
    logForDebugging(
      `[sandbox] kernel.apparmor_restrict_unprivileged_userns=1 and the bubblewrap trial (${bwrapPath} ${APPARMOR_BWRAP_TRIAL_ARGS.join(' ')}) exited ${trial.exitCode}: ${trial.stderr.trim()}`,
      { level: 'warn' },
    )
    if (!APPARMOR_USERNS_ERROR_RE.test(trial.stderr)) return undefined
    const matchingLine = trial.stderr
      .split('\n')
      .map(line => line.trim().replace(/^bwrap: /, ''))
      .find(line => APPARMOR_USERNS_ERROR_RE.test(line))
      ?.slice(0, 80)
    return `Ubuntu's AppArmor restriction on user namespaces stops bubblewrap here ("${matchingLine ?? ''}"). Add bubblewrap's AppArmor profile from https://code.claude.com/docs/en/sandboxing, or run \`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0\` (holds until reboot), then restart Claude Code`
  } catch (err) {
    logForDebugging(
      `[sandbox] the AppArmor user-namespace check could not be made: ${err}`,
      { level: 'warn' },
    )
    return undefined
  }
}

const checkDependencies = memoize((): SandboxDependencyCheck => {
  const { rgPath, rgArgs } = ripgrepCommand()
  const base = withStrippedSandboxHelperEnvSync(() =>
    BaseSandboxManager.checkDependencies({
      command: rgPath,
      args: rgArgs,
    }),
  )
  const platform = getPlatform()
  if (
    (platform === 'linux' || platform === 'wsl') &&
    base.errors.length === 0 &&
    initializationPromise === undefined
  ) {
    const appArmorError = detectLinuxAppArmorUsernsRestriction()
    if (appArmorError !== undefined) {
      return { ...base, errors: [appArmorError] }
    }
  }
  return base
})

// Official 2.1.323 #2017 (`Da` / `cV`): keep the sandbox on if it was already
// enabled during the session and settings subsequently fail to read. While held
// on by unreadable settings, auto-allow is off and dangerouslyDisableSandbox is
// ignored until settings can be read again.
let sandboxWasEnabled = false
let isHeldOnByFailedSettingsRead = false
// Official 2.1.325 #2374 (`startedOnce` / `hostedToolContainer` / `W3` / `V3`):
// Track whether the sandbox started once in this session and whether this
// process is running inside Anthropic's hosted cloud container.
let sandboxStartedOnce = false
let hostedToolContainer = false
// Official 2.1.328 #676 (`TPe` / `sandboxDisabledThisSession` / `initFailureReason`):
// When sandbox fails to initialize and failIfUnavailable is not set, refuse
// the next sandboxed Bash command and disable sandboxing for the session.
let sandboxDisabledThisSession = false
let initFailureReason: string | undefined
let forcedInitFailureForTesting: string | undefined
let lastSandboxAskCallback: SandboxAskCallback | undefined

export class SandboxInitFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxInitFailedError'
  }
}

export function _resetSandboxHeldStateForTesting(): void {
  sandboxWasEnabled = false
  isHeldOnByFailedSettingsRead = false
  sandboxStartedOnce = false
  hostedToolContainer = false
  sandboxDisabledThisSession = false
  initFailureReason = undefined
  forcedInitFailureForTesting = undefined
  lastSandboxAskCallback = undefined
}

export function isSandboxDisabledThisSession(): boolean {
  return sandboxDisabledThisSession
}

export function getSandboxInitFailureReason(): string | undefined {
  return initFailureReason
}

export function _setSandboxInitFailureForTesting(
  reason: string | undefined,
): void {
  forcedInitFailureForTesting = reason
  initFailureReason = reason
  if (reason !== undefined) {
    initializationPromise = undefined
  }
}

export function markHostedToolContainer(value = true): void {
  hostedToolContainer = value
}

export function isSandboxHeldOnByFailedSettingsRead(): boolean {
  getSandboxEnabledSetting()
  return isHeldOnByFailedSettingsRead
}

function setSandboxHeldOnByFailedRead(held: boolean): void {
  if (held === isHeldOnByFailedSettingsRead) return
  isHeldOnByFailedSettingsRead = held
  logForDebugging(
    held
      ? '[sandbox] The settings could not be read, so the sandbox stays on; auto-allow is off and dangerouslyDisableSandbox is ignored until they can be read again'
      : '[sandbox] The sandbox is no longer kept on by unreadable settings and follows the settings again',
    { level: 'warn' },
  )
}

function getSandboxEnabledSetting(): boolean {
  try {
    const settings = getSettings_DEPRECATED()
    if (settings == null) {
      setSandboxHeldOnByFailedRead(sandboxWasEnabled)
      return sandboxWasEnabled
    }
    const enabled = settings?.sandbox?.enabled ?? false
    if (enabled) {
      sandboxWasEnabled = true
    }
    setSandboxHeldOnByFailedRead(false)
    return enabled
  } catch (error) {
    logForDebugging(`Failed to get settings for sandbox check: ${error}`)
    setSandboxHeldOnByFailedRead(sandboxWasEnabled)
    return sandboxWasEnabled
  }
}

/**
 * Official 2.1.325 #2353 & #2354 (`_pe`):
 * - `autoAllowBashIfSandboxed` defaults to `false` (sandboxed Bash commands
 *   follow the normal permission flow unless explicitly set to `true`).
 * - When managed settings (`policySettings`) turn the sandbox on, auto-allow
 *   only applies if the highest-ranking managed source explicitly sets
 *   `autoAllowBashIfSandboxed: true`.
 */
/**
 * Official 2.1.326 #299 (`Ro` / `kme` / `Ime` / `Dme` / `Nme` @291403274):
 * Keep sandbox state during a session across directory/root moves until the
 * user explicitly runs `/sandbox` or `/cd` (which calls `clearSandboxRootMoveHold`).
 */
export type SandboxRootMoveHold = {
  isStrict: boolean
  isStrictByFailedRead: boolean
  isRequired: boolean
  isAutoAllowOff: boolean
}

const RELAUNCH_SANDBOX_HOLD_ENV = 'CLAUDE_CODE_RELAUNCH_SANDBOX_HOLD'

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

let sandboxRootMoveHold: SandboxRootMoveHold | undefined =
  readInitialSandboxRootMoveHold()

export function getSandboxRootMoveHold(): SandboxRootMoveHold | undefined {
  return sandboxRootMoveHold
}

export function isSandboxHeldOnByRootMove(): boolean {
  return (
    sandboxRootMoveHold !== undefined &&
    getSettings_DEPRECATED()?.sandbox?.enabled !== true
  )
}

export function captureSandboxRootMoveHold(): void {
  if (!getSandboxEnabledSetting() && sandboxRootMoveHold === undefined) {
    return
  }
  try {
    sandboxRootMoveHold = {
      isStrict: !areUnsandboxedCommandsAllowed(),
      isStrictByFailedRead:
        isSandboxHeldOnByFailedSettingsRead() ||
        sandboxRootMoveHold?.isStrictByFailedRead === true,
      isRequired: isSandboxRequiredBySettings(),
      isAutoAllowOff: !isAutoAllowBashIfSandboxedEnabled(),
    }
  } catch (err) {
    logForDebugging(
      `Could not read the sandbox settings before a move, so keeping the sandbox at its strictest: ${err}`,
      { level: 'error' },
    )
    sandboxRootMoveHold = {
      isStrict: true,
      isStrictByFailedRead: true,
      isRequired: true,
      isAutoAllowOff: true,
    }
  }
}

export function clearSandboxRootMoveHold(): void {
  sandboxRootMoveHold = undefined
}

export function serializeSandboxRootMoveHoldEnv(): Record<string, string> {
  if (!sandboxRootMoveHold) return {}
  const flags = [
    'on',
    ...Object.entries(sandboxRootMoveHold)
      .filter(([, v]) => v)
      .map(([k]) => k),
  ]
  return { [RELAUNCH_SANDBOX_HOLD_ENV]: flags.join(',') }
}

/**
 * Official 2.1.325 #2353 & #2354 (`_pe`) + 2.1.326 #299 (`rootMoveHold`):
 * - `autoAllowBashIfSandboxed` defaults to `false` (sandboxed Bash commands
 *   follow the normal permission flow unless explicitly set to `true`).
 * - When managed settings (`policySettings`) turn the sandbox on, auto-allow
 *   only applies if the highest-ranking managed source explicitly sets
 *   `autoAllowBashIfSandboxed: true`.
 * - When `rootMoveHold` is active with `isAutoAllowOff` or holding sandbox on,
 *   auto-allow stays off so Bash asks first.
 */
function isAutoAllowBashIfSandboxedEnabled(): boolean {
  if (isSandboxHeldOnByFailedSettingsRead()) {
    return false
  }
  if (sandboxRootMoveHold?.isAutoAllowOff || isSandboxHeldOnByRootMove()) {
    return false
  }
  const policySandbox = getSettingsForSource('policySettings')?.sandbox
  if (policySandbox?.enabled === true) {
    return policySandbox.autoAllowBashIfSandboxed === true
  }
  if (policySandbox?.autoAllowBashIfSandboxed === false) {
    return false
  }
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.autoAllowBashIfSandboxed ?? false
}

function areUnsandboxedCommandsAllowed(): boolean {
  if (isSandboxHeldOnByFailedSettingsRead() || sandboxRootMoveHold?.isStrict) {
    return false
  }
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.allowUnsandboxedCommands ?? true
}

function isSandboxRequiredBySettings(): boolean {
  if (sandboxRootMoveHold?.isRequired) {
    return true
  }
  const settings = getSettings_DEPRECATED()
  return (
    getSandboxEnabledSetting() &&
    isPlatformInEnabledList() &&
    (settings?.sandbox?.failIfUnavailable ?? false)
  )
}

/**
 * Official 2.1.325 #2374 (`W3` / `V3`):
 * Claude Code on the web, cloud scheduled tasks, and Cowork cloud sessions
 * run inside an isolated hosted Linux container without a command sandbox
 * (`bwrap`). Set aside `sandbox.failIfUnavailable` so those sessions can start
 * with a warning instead of exiting fatally.
 */
function wouldSetAsideSandboxRequirementInHostedWorker(): boolean {
  const isHostedLinuxContainer =
    getPlatform() === 'linux' &&
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND === undefined &&
    (hostedToolContainer ||
      (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
        Boolean(
          process.env.CLAUDE_CODE_REMOTE_SESSION_ID ||
            process.env.CLAUDE_CODE_CONTAINER_ID,
        )))
  if (!isHostedLinuxContainer) return false
  if (!isSandboxRequiredBySettings() || sandboxStartedOnce) return false
  const deps = checkDependencies()
  return deps.errors.length > 0
}

function isSandboxRequirementSetAsideInHostedWorker(): boolean {
  return wouldSetAsideSandboxRequirementInHostedWorker()
}

function isSandboxRequired(): boolean {
  return (
    isSandboxRequiredBySettings() &&
    !isSandboxRequirementSetAsideInHostedWorker()
  )
}

/**
 * Check if the current platform is supported for sandboxing (memoized)
 * Supports: macOS, Linux, and WSL2+ (WSL1 is not supported)
 */
const isSupportedPlatform = memoize((): boolean => {
  return BaseSandboxManager.isSupportedPlatform()
})

/**
 * Check if the current platform is in the enabledPlatforms list.
 *
 * This is an undocumented setting that allows restricting sandbox to specific platforms.
 * When enabledPlatforms is not set, all supported platforms are allowed.
 *
 * Added to unblock NVIDIA enterprise rollout: they want to enable autoAllowBashIfSandboxed
 * but only on macOS initially, since Linux/WSL sandbox support is newer. This allows
 * setting enabledPlatforms: ["macos"] to disable sandbox (and auto-allow) on other platforms.
 */
function isPlatformInEnabledList(): boolean {
  try {
    const settings = getInitialSettings()
    const enabledPlatforms = (
      settings?.sandbox as { enabledPlatforms?: Platform[] } | undefined
    )?.enabledPlatforms

    if (enabledPlatforms === undefined) {
      return true
    }

    if (enabledPlatforms.length === 0) {
      return false
    }

    const currentPlatform = getPlatform()
    return enabledPlatforms.includes(currentPlatform)
  } catch (error) {
    logForDebugging(`Failed to check enabledPlatforms: ${error}`)
    return true // Default to enabled if we can't read settings
  }
}

/**
 * Check if sandboxing is enabled
 * This checks the user's enabled setting, platform support, and enabledPlatforms restriction
 */
function isSandboxingEnabled(): boolean {
  if (sandboxDisabledThisSession) {
    return false
  }
  if (!isSupportedPlatform()) {
    return false
  }

  if (checkDependencies().errors.length > 0) {
    return false
  }

  // Check if current platform is in the enabledPlatforms list (undocumented setting)
  if (!isPlatformInEnabledList()) {
    return false
  }

  return getSandboxEnabledSetting() || sandboxRootMoveHold !== undefined
}

/**
 * If the user explicitly enabled sandbox (sandbox.enabled: true in settings)
 * but it cannot actually run, return a human-readable reason. Otherwise
 * return undefined.
 *
 * Fix for #34044: previously isSandboxingEnabled() silently returned false
 * when dependencies were missing, giving users zero feedback that their
 * explicit security setting was being ignored. This is a security footgun —
 * users configure allowedDomains expecting enforcement, get none.
 *
 * Call this once at startup (REPL/print) and surface the reason if present.
 * Does not cover the case where the user never enabled sandbox (no noise).
 */
function getSandboxUnavailableReason(): string | undefined {
  // Only warn if user explicitly asked for sandbox. If they didn't enable
  // it, missing deps are irrelevant.
  if (!getSandboxEnabledSetting()) {
    return undefined
  }

  if (!isSupportedPlatform()) {
    const platform = getPlatform()
    if (platform === 'wsl') {
      return 'sandbox.enabled is set but WSL1 is not supported (requires WSL2)'
    }
    return `sandbox.enabled is set but ${platform} is not supported (requires macOS, Linux, or WSL2)`
  }

  if (!isPlatformInEnabledList()) {
    return `sandbox.enabled is set but ${getPlatform()} is not in sandbox.enabledPlatforms`
  }

  const deps = checkDependencies()
  if (deps.errors.length > 0) {
    const platform = getPlatform()
    const hint =
      platform === 'macos'
        ? 'run /sandbox or /doctor for details'
        : 'install missing tools (e.g. apt install bubblewrap socat) or run /sandbox for details'
    return `sandbox.enabled is set but dependencies are missing: ${deps.errors.join(', ')} · ${hint}`
  }

  return undefined
}

/**
 * Get glob patterns that won't work fully on Linux/WSL
 */
function getLinuxGlobPatternWarnings(): string[] {
  // Only return warnings on Linux/WSL (bubblewrap doesn't support globs)
  const platform = getPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    return []
  }

  // densable uCg: when filesystem.disabled, no glob warnings (FS rules not enforced)
  if (resolveSandboxFilesystemDisabled()) {
    return []
  }

  try {
    const settings = getSettings_DEPRECATED()

    // Only return warnings when sandboxing is enabled (check settings directly, not cached value)
    if (!settings?.sandbox?.enabled) {
      return []
    }

    const permissions = settings?.permissions || {}
    const warnings: string[] = []

    // Helper to check if a path has glob characters (excluding trailing /**)
    const hasGlobs = (path: string): boolean => {
      const stripped = path.replace(/\/\*\*$/, '')
      return /[*?[\]]/.test(stripped)
    }

    // Check all permission rules
    for (const ruleString of [
      ...(permissions.allow || []),
      ...(permissions.deny || []),
    ]) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        (rule.toolName === FILE_EDIT_TOOL_NAME ||
          rule.toolName === FILE_READ_TOOL_NAME) &&
        rule.ruleContent &&
        hasGlobs(rule.ruleContent)
      ) {
        warnings.push(ruleString)
      }
    }

    return warnings
  } catch (error) {
    logForDebugging(`Failed to get Linux glob pattern warnings: ${error}`)
    return []
  }
}

// ============================================================================
// densable 2.1.229 #26 — IPv6 / unreliable domain spelling warnings
// SEA: iA_ / sA_ / VFs / fHo / RRe / jNe / UFs / nnd=/^[1-9][0-9]{0,4}$/
// ============================================================================

/** densable nnd — port suffix 1–65535, no leading zeros */
const IPV6_PORT_SUFFIX_RE = /^[1-9][0-9]{0,4}$/

/** densable jNe — strip surrounding [] from host */
function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * densable RRe — canonicalize host via URL hostname + strip trailing dot.
 * Returns undefined when the host is not a valid URL host.
 */
function canonicalizeNetworkHost(host: string): string | undefined {
  try {
    const stripped = stripIpv6Brackets(host)
    const forUrl = isIP(stripped) === 6 ? `[${stripped}]` : stripped
    const hostname = new NodeURL(`http://${forUrl}/`).hostname
    return stripIpv6Brackets(hostname).replace(/\.$/, '')
  } catch {
    return undefined
  }
}

/**
 * densable fHo — non-IPv6 host whose canonical form differs from lowercase input
 * (trailing-dot / punycode / case drift).
 */
function isNonCanonicalDomainSpelling(host: string): boolean {
  if (isIP(host) === 6) return false
  const canonical = canonicalizeNetworkHost(host)
  return canonical !== undefined && canonical !== host.toLowerCase()
}

/**
 * densable VFs — unbracketed multi-colon entry (bare IPv6 or host:port with IPv6).
 */
function isUnbracketedMultiColonDomain(entry: string): boolean {
  const first = entry.indexOf(':')
  return (
    first !== -1 &&
    entry.indexOf(':', first + 1) !== -1 &&
    !entry.startsWith('[')
  )
}

/**
 * densable UFs — collect allowedDomains / deniedDomains from settings +
 * WebFetch(domain:...) permission rules.
 */
function collectSandboxNetworkDomains(
  settingsList: Array<SettingsJson | undefined | null>,
  side: 'allow' | 'deny',
): string[] {
  const key = side === 'allow' ? 'allowedDomains' : 'deniedDomains'
  const out: string[] = []
  for (const settings of settingsList) {
    if (!settings) continue
    for (const domain of settings.sandbox?.network?.[key] ?? []) {
      out.push(domain)
    }
    for (const ruleString of settings.permissions?.[side] ?? []) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        out.push(rule.ruleContent.substring('domain:'.length))
      }
    }
  }
  return out
}

/**
 * densable EV-ish: non-empty settings sources (enabled only).
 * Used with merged settings so doctor sees user+project+policy domains.
 */
function listNonEmptySettingsSources(): SettingsJson[] {
  const out: SettingsJson[] = []
  for (const source of SETTING_SOURCES) {
    if (!isSettingSourceEnabled(source)) continue
    const s = getSettingsForSource(source)
    if (s && Object.keys(s).length > 0) out.push(s)
  }
  return out
}

/**
 * densable iA_ / getUnbracketedIpv6DomainWarnings.
 *
 * Flags domain entries that are unreliable for fail-closed enforcement:
 * - contains `@`
 * - unbracketed multi-colon (bare IPv6)
 * - bracketed IPv6 with bad port / non-IPv6 interior / leading zeros / globs
 */
function getUnbracketedIpv6DomainWarnings(): string[] {
  try {
    const merged = getSettings_DEPRECATED()
    const sources = listNonEmptySettingsSources()
    const settingsList = [...(merged ? [merged] : []), ...sources]
    const bad = new Set<string>()
    for (const side of ['allow', 'deny'] as const) {
      for (const entry of collectSandboxNetworkDomains(settingsList, side)) {
        if (entry.includes('@')) {
          bad.add(entry)
          continue
        }
        if (isUnbracketedMultiColonDomain(entry)) {
          bad.add(entry)
          continue
        }
        if (entry.startsWith('[')) {
          const close = entry.indexOf(']')
          const after = close === -1 ? undefined : entry.slice(close + 1)
          const interior = close === -1 ? undefined : entry.slice(1, close)
          if (
            after === undefined ||
            interior === undefined ||
            (after !== '' &&
              (!after.startsWith(':') ||
                !IPV6_PORT_SUFFIX_RE.test(after.slice(1)) ||
                Number(after.slice(1)) > 65535)) ||
            canonicalizeNetworkHost(interior) === undefined ||
            isNonCanonicalDomainSpelling(interior) ||
            interior.includes('*')
          ) {
            bad.add(entry)
          }
        }
      }
    }
    return [...bad]
  } catch (error) {
    logForDebugging(`Failed to get IPv6 domain entry warnings: ${error}`)
    return []
  }
}

/**
 * densable sA_ / getUnbracketedIpv6InjectHostWarnings.
 * injectHosts multi-colon entries that are not already lowercase canonical IPv6.
 */
function getUnbracketedIpv6InjectHostWarnings(): string[] {
  try {
    const merged = getSettings_DEPRECATED()
    const sources = listNonEmptySettingsSources()
    const settingsList = [...(merged ? [merged] : []), ...sources]
    const bad = new Set<string>()
    for (const settings of settingsList) {
      const creds = settings.sandbox?.credentials
      for (const item of [
        ...(creds?.envVars ?? []),
        ...(creds?.files ?? []),
      ] as Array<{ injectHosts?: string[] }>) {
        for (const host of item.injectHosts ?? []) {
          const first = host.indexOf(':')
          if (first === -1 || host.indexOf(':', first + 1) === -1) continue
          if (
            isIP(host) === 6 &&
            canonicalizeNetworkHost(host) === host.toLowerCase()
          ) {
            continue
          }
          bad.add(host)
        }
      }
    }
    return [...bad]
  } catch (error) {
    logForDebugging(`Failed to get injectHosts entry warnings: ${error}`)
    return []
  }
}

/**
 * Check if sandbox settings are locked by policy
 */
function areSandboxSettingsLockedByPolicy(): boolean {
  // Check if sandbox settings are explicitly set in any source that overrides localSettings
  // These sources have higher priority than localSettings and would make local changes ineffective
  const overridingSources = ['flagSettings', 'policySettings'] as const

  for (const source of overridingSources) {
    const settings = getSettingsForSource(source)
    if (
      settings?.sandbox?.enabled !== undefined ||
      settings?.sandbox?.autoAllowBashIfSandboxed !== undefined ||
      settings?.sandbox?.allowUnsandboxedCommands !== undefined
    ) {
      return true
    }
  }

  return false
}

/**
 * Set sandbox settings
 */
async function setSandboxSettings(options: {
  enabled?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
}): Promise<{ error: Error | null }> {
  const existingSettings = getSettingsForSource('localSettings')

  // Note: Memoized caches auto-invalidate when settings change because they use
  // the settings object as the cache key (new settings object = cache miss)

  const result = updateSettingsForSource('localSettings', {
    sandbox: {
      ...existingSettings?.sandbox,
      ...(options.enabled !== undefined && { enabled: options.enabled }),
      ...(options.autoAllowBashIfSandboxed !== undefined && {
        autoAllowBashIfSandboxed: options.autoAllowBashIfSandboxed,
      }),
      ...(options.allowUnsandboxedCommands !== undefined && {
        allowUnsandboxedCommands: options.allowUnsandboxedCommands,
      }),
    },
  })
  if (!result.error) {
    if (options.enabled === false) {
      sandboxWasEnabled = false
      setSandboxHeldOnByFailedRead(false)
      sandboxRootMoveHold = undefined
    } else if (sandboxRootMoveHold !== undefined) {
      sandboxRootMoveHold = {
        ...sandboxRootMoveHold,
        isStrict:
          sandboxRootMoveHold.isStrict &&
          options.allowUnsandboxedCommands !== true,
        isAutoAllowOff:
          sandboxRootMoveHold.isAutoAllowOff &&
          options.autoAllowBashIfSandboxed !== true,
      }
    }
  }
  return result
}

/**
 * Get excluded commands (commands that should not be sandboxed)
 */
function getExcludedCommands(): string[] {
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.excludedCommands ?? []
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
  if (!initializationPromise && !sandboxDisabledThisSession) {
    await initialize(lastSandboxAskCallback)
  }
  const currentInit = initializationPromise
  if (currentInit) {
    await currentInit
  }
  if (!currentInit || initializationPromise !== currentInit) {
    const suffix = initFailureReason ? `: ${initFailureReason}` : ''
    if (isSandboxRequired()) {
      throw new SandboxInitFailedError(
        `Sandbox is required but failed to initialize${suffix}. Restart to retry. Running it outside the sandbox (dangerouslyDisableSandbox) is not allowed either.`,
      )
    }
    if (options?.keepsSandboxOn !== false && !sandboxDisabledThisSession) {
      throw new SandboxInitFailedError(
        `Sandbox is enabled but failed to initialize${suffix}. This command of Claude Code's own was not run; the sandbox stays on, and the next command tries to start it again.`,
      )
    }
    sandboxDisabledThisSession = true
    throw new SandboxInitFailedError(
      `Sandbox is enabled but failed to initialize${suffix}. Sandboxing is disabled for the rest of this session; restart to retry.`,
    )
  }
}

/**
 * Wrap command with sandbox, optionally specifying the shell to use
 */
async function wrapWithSandbox(
  command: string,
  binShell?: string,
  customConfig?: Partial<SandboxRuntimeConfig>,
  abortSignal?: AbortSignal,
  wrapOptions?: { keepsSandboxOn?: boolean },
): Promise<string> {
  // If sandboxing is enabled, ensure initialization is complete
  if (isSandboxingEnabled()) {
    await ensureInitializedForWrap(wrapOptions)
    // densable wrap: await fN(), pN(), VZ(), FZ(), Ahe()
    await ensureBridgeSpawnRootDirForWrap()
    ensureAtomicWriteStagingDirs()
    if (!resolveSandboxFilesystemDisabled()) {
      ensureUpdaterStagingDir()
    }
    // Official 2.1.326 #301: snapshot .git before sandboxed command so
    // unexpected entries planted inside .git/ are set aside after the command.
    snapshotGitDirBeforeSandboxWrap(getOriginalCwd())
    if (getCwd() !== getOriginalCwd()) {
      snapshotGitDirBeforeSandboxWrap(getCwd())
    }
    // Official 2.1.326 #302: on Linux/WSL, pre-create missing `--add-dir`
    // folders before each sandboxed command so bwrap can bind-mount them.
    const configuredAddDirs = Array.from(
      new Set([
        ...(getSettings_DEPRECATED()?.permissions?.additionalDirectories ?? []),
        ...getAdditionalDirectoriesForClaudeMd(),
      ]),
    )
    if (configuredAddDirs.length > 0) {
      precreateMissingLinuxAddDirs(configuredAddDirs)
    }
    promoteDenyLiteralSymlinkTargets({
      getConfig: () => BaseSandboxManager.getConfig?.(),
      updateConfig: cfg => {
        BaseSandboxManager.updateConfig(cfg)
      },
    })
    recheckReadDenyAndCredentialMasksBeforeWrap({
      getConfig: () => BaseSandboxManager.getConfig?.(),
      updateConfig: cfg => {
        BaseSandboxManager.updateConfig(cfg)
      },
    })
    recordWrapWriteRoots(BaseSandboxManager.getConfig?.())
  }

  // densable Bou / sandbox-runtime@0.0.70: package wrapWithSandbox itself
  // applies filesystem.disabled precedence (override.filesystem present →
  // override.disabled??false, else session). When disabled, package skips FS
  // mounts while still applying credentials.envVars unset/set (Vzi). No host
  // rewrite of path lists needed.
  const wrapped = await BaseSandboxManager.wrapWithSandbox(
    command,
    binShell,
    customConfig,
    abortSignal,
  )
  const plat = getPlatform()
  // 2.1.323 #2207: Harden macOS Seatbelt profile so `lsof` and similar tools
  // cannot inspect processes outside the sandbox.
  if (plat === 'macos') {
    return hardenMacOsSeatbeltProcessInfo(wrapped)
  }
  // 2.1.325 #2340: Ensure `--ro-bind` allowRead mounts precede `--bind`
  // writePath mounts after `--tmpfs <denyRead>` so bwrap does not fail with
  // `Can't create file` when cwd is below an `allowRead` inside a `denyRead`.
  if (plat === 'linux' || plat === 'wsl') {
    return fixLinuxBwrapAllowReadMountOrder(wrapped)
  }
  return wrapped
}

/**
 * Initialize sandbox with log monitoring enabled by default
 */
async function initialize(
  sandboxAskCallback?: SandboxAskCallback,
): Promise<void> {
  if (sandboxAskCallback !== undefined) {
    lastSandboxAskCallback = sandboxAskCallback
  }
  // If already initializing or initialized, return the promise
  if (initializationPromise) {
    return initializationPromise
  }

  // Check if sandboxing is enabled in settings
  if (!isSandboxingEnabled()) {
    return
  }

  if (forcedInitFailureForTesting !== undefined) {
    initFailureReason = forcedInitFailureForTesting
    initializationPromise = undefined
    return
  }

  // Wrap the callback to enforce allowManagedDomainsOnly + densable 2.1.219
  // strictAllowlist (deny without prompt). Package 0.0.70 lacks the field check
  // densable dSu has (`!r||kl.network.strictAllowlist`); host enforces here so
  // all code paths (REPL, print/SDK) are covered even when the field is stripped.
  const wrappedCallback: SandboxAskCallback | undefined = sandboxAskCallback
    ? async (hostPattern: NetworkHostPattern) => {
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
        return sandboxAskCallback(hostPattern)
      }
    : undefined

  // Create the initialization promise synchronously (before any await) to prevent
  // race conditions where wrapWithSandbox() is called before the promise is assigned.
  // densable Te().initializationPromise is set before Pa/initialize so ro() &&= n.
  const initToken = {}
  initFailureReason = undefined
  setSandboxInitializationPromise(initToken)
  initializationPromise = (async () => {
    try {
      markInstallsSinceInitializeStarted()
      // Resolve worktree main `.git` once (densable WZ). Cached for refreshConfig().
      if (worktreeMainRepoPath === undefined) {
        worktreeMainRepoPath = detectWorktreeMainRepoPath(getCwdState())
      }

      // densable windows init: pN(), await fN() before Re.initialize
      if (getPlatform() === 'windows') {
        ensureAtomicWriteStagingDirs()
        await ensureBridgeSpawnRootDirForWrap()
      }

      const settings = getSettings_DEPRECATED()
      const runtimeConfig = convertToSandboxRuntimeConfig(settings)

      // Log monitor is automatically enabled for macOS
      await BaseSandboxManager.initialize(runtimeConfig, wrappedCallback)
      sandboxStartedOnce = true
      finishSandboxInitializeAllowlist(runtimeConfig)
      // densable FZ — record wrap write roots after init (yN)
      recordWrapWriteRoots(runtimeConfig)

      // Subscribe to settings changes to update sandbox config dynamically
      // densable: also cDs.subscribe(() => bHo()) — command-producer deny bag
      // changes (zvt/qvt) must refresh sandbox config so write deny tracks producers.
      const unsubSettings = settingsChangeDetector.subscribe(() => {
        const settings = getSettings_DEPRECATED()
        applySandboxRuntimeConfig(
          convertToSandboxRuntimeConfig(settings),
          cfg => {
            BaseSandboxManager.updateConfig(cfg)
          },
        )
        logForDebugging('Sandbox configuration updated from settings change')
      })
      const unsubCommandProducers = subscribeCommandProducerDirsChanged(() => {
        // densable bHo: if sandboxing enabled, rebuild runtime config from settings
        refreshConfig()
      })
      settingsSubscriptionCleanup = () => {
        unsubSettings()
        unsubCommandProducers()
      }
    } catch (error) {
      // Clear the promise on error so initialization can be retried
      initializationPromise = undefined
      setSandboxInitializationPromise(undefined)
      failSandboxInitializeAllowlist()
      initFailureReason = errorMessage(error)

      // Log error but don't throw - let sandboxing fail gracefully
      logForDebugging(`Failed to initialize sandbox: ${initFailureReason}`)
    }
  })()

  return initializationPromise
}

/**
 * Refresh sandbox config from current settings immediately
 * Call this after updating permissions to avoid race conditions
 */
function refreshConfig(): void {
  if (!isSandboxingEnabled()) return
  applySandboxRuntimeConfig(
    convertToSandboxRuntimeConfig(getSettings_DEPRECATED()),
    cfg => {
      BaseSandboxManager.updateConfig(cfg)
    },
  )
}

/**
 * Reset sandbox state and clear memoized values
 */
async function reset(): Promise<void> {
  // Clean up settings subscription
  settingsSubscriptionCleanup?.()
  settingsSubscriptionCleanup = undefined
  worktreeMainRepoPath = undefined
  bareGitRepoScrubPaths.length = 0
  resetSymlinkedDenyScrubState()
  // densable mSb drops whole CFd (sessionAllowedHosts with it)
  sessionAllowedHosts.clear()

  // Clear memoized caches
  checkDependencies.cache.clear?.()
  isSupportedPlatform.cache.clear?.()
  initializationPromise = undefined
  sandboxStartedOnce = false
  hostedToolContainer = false
  sandboxDisabledThisSession = false
  initFailureReason = undefined
  lastSandboxAskCallback = undefined

  // Reset the base sandbox manager
  return BaseSandboxManager.reset()
}

/**
 * Add a command to the excluded commands list (commands that should not be sandboxed)
 * This is a Claude CLI-specific function that updates local settings.
 */
/**
 * densable `Ge.isStrictSandboxModeConfigured` — policy/flag sandbox lock.
 * Local twin is `areSandboxSettingsLockedByPolicy`.
 */
export function isStrictSandboxModeConfigured(): boolean {
  return areSandboxSettingsLockedByPolicy()
}

export function addToExcludedCommandsWithResult(
  command: string,
  permissionUpdates?: Array<{
    type: string
    rules: Array<{ toolName: string; ruleContent?: string }>
  }>,
  source: 'localSettings' | 'userSettings' = 'localSettings',
): {
  commandPattern: string
  settingsSource: 'localSettings' | 'userSettings'
  error: Error | null
} {
  const existingSettings = getSettingsForSource(source)
  const existingExcludedCommands =
    existingSettings?.sandbox?.excludedCommands || []

  // Determine the command pattern to add
  // If there are suggestions with Bash rules, extract the pattern (e.g., "npm run test" from "npm run test:*")
  // Otherwise use the exact command
  let commandPattern: string = command

  if (permissionUpdates) {
    const bashSuggestions = permissionUpdates.filter(
      update =>
        update.type === 'addRules' &&
        update.rules.some(rule => rule.toolName === BASH_TOOL_NAME),
    )

    if (bashSuggestions.length > 0 && bashSuggestions[0]!.type === 'addRules') {
      const firstBashRule = bashSuggestions[0]!.rules.find(
        rule => rule.toolName === BASH_TOOL_NAME,
      )
      if (firstBashRule?.ruleContent) {
        // Extract pattern from Bash(command) or Bash(command:*) format
        const prefix = permissionRuleExtractPrefix(firstBashRule.ruleContent)
        commandPattern = prefix || firstBashRule.ruleContent
      }
    }
  }

  // Add to excludedCommands if not already present
  let error: Error | null = null
  if (!existingExcludedCommands.includes(commandPattern)) {
    const result = updateSettingsForSource(source, {
      sandbox: {
        ...existingSettings?.sandbox,
        excludedCommands: [...existingExcludedCommands, commandPattern],
      },
    })
    error = result.error
  }

  return { commandPattern, settingsSource: source, error }
}

export function addToExcludedCommands(
  command: string,
  permissionUpdates?: Array<{
    type: string
    rules: Array<{ toolName: string; ruleContent?: string }>
  }>,
  source: 'localSettings' | 'userSettings' = 'localSettings',
): string {
  return addToExcludedCommandsWithResult(command, permissionUpdates, source)
    .commandPattern
}

// ============================================================================
// Export interface and implementation
// ============================================================================

export interface ISandboxManager {
  initialize(sandboxAskCallback?: SandboxAskCallback): Promise<void>
  isSupportedPlatform(): boolean
  isPlatformInEnabledList(): boolean
  getSandboxUnavailableReason(): string | undefined
  isSandboxingEnabled(): boolean
  isSandboxEnabledInSettings(): boolean
  checkDependencies(): SandboxDependencyCheck
  isAutoAllowBashIfSandboxedEnabled(): boolean
  areUnsandboxedCommandsAllowed(): boolean
  isSandboxRequired(): boolean
  isSandboxRequirementSetAsideInHostedWorker(): boolean
  wouldSetAsideSandboxRequirementInHostedWorker(): boolean
  markHostedToolContainer(value?: boolean): void
  areSandboxSettingsLockedByPolicy(): boolean
  isStrictSandboxModeConfigured(): boolean
  setSandboxSettings(options: {
    enabled?: boolean
    autoAllowBashIfSandboxed?: boolean
    allowUnsandboxedCommands?: boolean
  }): Promise<{ error: Error | null }>
  getFsReadConfig(): FsReadRestrictionConfig
  getFsWriteConfig(): FsWriteRestrictionConfig
  getNetworkRestrictionConfig(): NetworkRestrictionConfig
  getAllowUnixSockets(): string[] | undefined
  getAllowLocalBinding(): boolean | undefined
  getIgnoreViolations(): IgnoreViolationsConfig | undefined
  getEnableWeakerNestedSandbox(): boolean | undefined
  getExcludedCommands(): string[]
  getProxyPort(): number | undefined
  getSocksProxyPort(): number | undefined
  getLinuxHttpSocketPath(): string | undefined
  getLinuxSocksSocketPath(): string | undefined
  waitForNetworkInitialization(): Promise<boolean>
  ensureInitializedForWrap(options?: {
    keepsSandboxOn?: boolean
  }): Promise<void>
  wrapWithSandbox(
    command: string,
    binShell?: string,
    customConfig?: Partial<SandboxRuntimeConfig>,
    abortSignal?: AbortSignal,
    wrapOptions?: { keepsSandboxOn?: boolean },
  ): Promise<string>
  cleanupAfterCommand(): void
  getSandboxViolationStore(): SandboxViolationStore
  annotateStderrWithSandboxFailures(command: string, stderr: string): string
  getLinuxGlobPatternWarnings(): string[]
  /** densable 2.1.229 iA_ — unreliable IPv6/domain spellings for doctor */
  getUnbracketedIpv6DomainWarnings(): string[]
  /** densable 2.1.229 sA_ — injectHosts multi-colon IPv6 spelling warnings */
  getUnbracketedIpv6InjectHostWarnings(): string[]
  /** densable o0g — mask without tlsTerminate/allowPlaintextInject warning */
  getMaskCredentialWarning(): string | undefined
  /** densable ruu — whether mask warning path may fire */
  canMaskCredentialWarningFire(): boolean
  refreshConfig(): void
  /** densable zvb — session-scoped host allow → allowedDomains via refreshConfig */
  addSessionAllowedHost(host: string): void
  reset(): Promise<void>
}

/**
 * densable OUTER getFsReadConfig (~223611065):
 * when getConfig().filesystem.disabled → RAW config denyRead/allowRead
 * (diagnostic; does not include credentials.files — those are package-side
 * WZn/Dou only while isolation is on). Enforcement Gvg is unrestricted when
 * disabled. When isolation on → forward package getFsReadConfig (Gvg).
 *
 * Host keeps a convert-time diagnostic stash so tests / pre-init callers still
 * see raw lists when package getConfig() is not yet populated; shape matches
 * densable `e.filesystem.denyRead` (no credential-file paths).
 */
let fsReadConfigMemo:
  | { cfg: unknown; result: FsReadRestrictionConfig }
  | undefined

function stripTrailingGlob(p: string): string {
  return p.endsWith('/**') ? p.slice(0, -3) : p
}

function hasGlobCharacters(p: string): boolean {
  return /[*?[\]]/.test(p)
}

function buildRawFsReadConfig(
  cfg: ReturnType<NonNullable<typeof BaseSandboxManager.getConfig>>,
  credPaths: readonly string[],
): FsReadRestrictionConfig {
  const denySet = new Set([
    ...(cfg?.filesystem?.denyRead ?? []).map(stripTrailingGlob),
    ...credPaths.map(stripTrailingGlob),
  ])
  return {
    denyOnly: [...denySet],
    allowWithinDeny: (cfg?.filesystem?.allowRead ?? []).map(stripTrailingGlob),
  }
}

export function clearFsReadConfigMemoForTests(): void {
  fsReadConfigMemo = undefined
}

function getFsReadConfig(): FsReadRestrictionConfig {
  const cfg = BaseSandboxManager.getConfig?.()
  if (cfg?.filesystem?.disabled) {
    return {
      denyOnly: cfg.filesystem.denyRead.map(stripTrailingGlob),
      allowWithinDeny: (cfg.filesystem.allowRead ?? []).map(stripTrailingGlob),
    }
  }
  if (resolveSandboxFilesystemDisabled()) {
    if (disabledFsDiagnostic) {
      return {
        denyOnly: disabledFsDiagnostic.denyRead,
        allowWithinDeny: disabledFsDiagnostic.allowRead,
      }
    }
    // convert not yet run — densable empty until hl is set
    return getDisabledSandboxFsReadConfig()
  }
  if (fsReadConfigMemo !== undefined && fsReadConfigMemo.cfg === cfg) {
    return fsReadConfigMemo.result
  }
  const platform = getPlatform()
  const credFiles =
    (
      cfg as
        | (typeof cfg & {
            credentials?: { files?: Array<{ mode?: string; path: string }> }
          })
        | undefined
    )?.credentials?.files ?? []
  const denyCredPaths = credFiles
    .filter(f => f.mode === 'deny')
    .map(f => f.path)
  // #90 SEA (@286068500): on Linux/WSL, avoid synchronous glob expansion in
  // BaseSandboxManager.getFsReadConfig() when any read rule contains a glob
  // (e.g. `~/**/.env`), which would walk large directory trees and freeze
  // before the first request and in `/sandbox` Config tab.
  if (
    (platform === 'linux' || platform === 'wsl') &&
    [
      ...(cfg?.filesystem?.denyRead ?? []),
      ...(cfg?.filesystem?.allowRead ?? []),
      ...denyCredPaths,
    ].some(p => hasGlobCharacters(stripTrailingGlob(p)))
  ) {
    const result = buildRawFsReadConfig(cfg, denyCredPaths)
    fsReadConfigMemo = { cfg, result }
    return result
  }
  try {
    const result = BaseSandboxManager.getFsReadConfig()
    fsReadConfigMemo = { cfg, result }
    return result
  } catch (err) {
    logForDebugging(
      `[sandbox] getFsReadConfig threw; falling back to raw deny lists: ${errorMessage(err)}`,
    )
    const result = buildRawFsReadConfig(
      cfg,
      credFiles.map(f => f.path),
    )
    fsReadConfigMemo = { cfg, result }
    return result
  }
}

/**
 * densable OUTER getFsWriteConfig:
 * when getConfig().filesystem.disabled → RAW config allowWrite/denyWrite.
 * Enforcement Wvg is unrestricted (allowOnly:['/']) when disabled.
 */
function getFsWriteConfig(): FsWriteRestrictionConfig {
  const cfg = BaseSandboxManager.getConfig?.()
  if (cfg?.filesystem?.disabled) {
    return {
      allowOnly: [...cfg.filesystem.allowWrite],
      denyWithinAllow: [...cfg.filesystem.denyWrite],
    }
  }
  if (resolveSandboxFilesystemDisabled()) {
    if (disabledFsDiagnostic) {
      return {
        allowOnly: disabledFsDiagnostic.allowWrite,
        denyWithinAllow: disabledFsDiagnostic.denyWrite,
      }
    }
    return getDisabledSandboxFsWriteConfig()
  }
  return BaseSandboxManager.getFsWriteConfig()
}

/**
 * densable enforcement-only Gvg/Wvg shapes (unrestricted when disabled).
 * Prefer these for wrap/path-safety when UI must keep raw lists via getFs*.
 */
export function getEnforcementFsReadConfig(): FsReadRestrictionConfig {
  if (resolveSandboxFilesystemDisabled()) {
    return getDisabledSandboxFsReadConfig()
  }
  return BaseSandboxManager.getFsReadConfig()
}

export function getEnforcementFsWriteConfig(): FsWriteRestrictionConfig {
  if (resolveSandboxFilesystemDisabled()) {
    return getDisabledSandboxFsWriteConfig()
  }
  return BaseSandboxManager.getFsWriteConfig()
}

/**
 * Claude CLI sandbox manager - wraps sandbox-runtime with Claude-specific features
 */
export const SandboxManager: ISandboxManager = {
  // Custom implementations
  initialize,
  isSandboxingEnabled,
  isSandboxEnabledInSettings: getSandboxEnabledSetting,
  isPlatformInEnabledList,
  getSandboxUnavailableReason,
  isAutoAllowBashIfSandboxedEnabled,
  areUnsandboxedCommandsAllowed,
  isSandboxRequired,
  isSandboxRequirementSetAsideInHostedWorker,
  wouldSetAsideSandboxRequirementInHostedWorker,
  markHostedToolContainer,
  areSandboxSettingsLockedByPolicy,
  isStrictSandboxModeConfigured,
  setSandboxSettings,
  getExcludedCommands,
  ensureInitializedForWrap,
  wrapWithSandbox,
  refreshConfig,
  addSessionAllowedHost,
  reset,
  checkDependencies,

  // densable 2.1.216 Gvg/Wvg overrides + network forward
  getFsReadConfig,
  getFsWriteConfig,
  getNetworkRestrictionConfig: BaseSandboxManager.getNetworkRestrictionConfig,
  getIgnoreViolations: BaseSandboxManager.getIgnoreViolations,
  getLinuxGlobPatternWarnings,
  getUnbracketedIpv6DomainWarnings,
  getUnbracketedIpv6InjectHostWarnings,
  getMaskCredentialWarning,
  canMaskCredentialWarningFire,
  isSupportedPlatform,
  getAllowUnixSockets: BaseSandboxManager.getAllowUnixSockets,
  getAllowLocalBinding: BaseSandboxManager.getAllowLocalBinding,
  getEnableWeakerNestedSandbox: BaseSandboxManager.getEnableWeakerNestedSandbox,
  getProxyPort: BaseSandboxManager.getProxyPort,
  getSocksProxyPort: BaseSandboxManager.getSocksProxyPort,
  getLinuxHttpSocketPath: BaseSandboxManager.getLinuxHttpSocketPath,
  getLinuxSocksSocketPath: BaseSandboxManager.getLinuxSocksSocketPath,
  waitForNetworkInitialization: BaseSandboxManager.waitForNetworkInitialization,
  getSandboxViolationStore: BaseSandboxManager.getSandboxViolationStore,
  annotateStderrWithSandboxFailures:
    BaseSandboxManager.annotateStderrWithSandboxFailures,
  cleanupAfterCommand: (): void => {
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
  },
}

// ============================================================================
// Re-export types from sandbox-runtime
// ============================================================================

export type {
  SandboxAskCallback,
  SandboxDependencyCheck,
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  NetworkRestrictionConfig,
  NetworkHostPattern,
  SandboxViolationEvent,
  SandboxRuntimeConfig,
  IgnoreViolationsConfig,
}

export { SandboxViolationStore, SandboxRuntimeConfigSchema }
