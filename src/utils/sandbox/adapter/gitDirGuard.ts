/**
 * Git directory & worktree sandbox guards:
 * - Linux 0-byte placeholder file tracking & cleanup (`config.worktree`, etc.)
 * - Linked worktree main `.git` dir detection (`detectWorktreeMainRepoPath`)
 * - Pre-wrap `.git` snapshot & post-wrap unexpected entry quarantine
 * - Bare-repo planted file scrubbing & worktree metadata denyWrite helpers
 */

import {
  closeSync,
  constants as fsConstants,
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
import { basename, dirname, join, resolve } from 'path'
import { registerCleanup } from '../../cleanupRegistry.js'
import { logForDebugging } from '../../debug.js'
import { getErrnoCode } from '../../errors.js'
import {
  gitAdminHopUnsafe,
  gitdirPointerHopUnsafe,
} from '../../git/gitdirHopWalk.js'
import { expandPath } from '../../path.js'
import { getPlatform } from '../../platform.js'
import { isWorktreePathNetworkRelativeToCwd } from '../../worktree.js'
import type { GitDirBaselineEntry, GitDirEntryKind } from './constants.js'
import {
  getLiveSandboxHostStates,
  getSandboxHostState,
  type SandboxHostState,
} from './hostState.js'

/**
 * Official 2.1.326 #23: track 0-byte placeholder files created by the sandbox
 * on Linux/WSL (including `.git/config.lock`, `.git/config.worktree`,
 * `.git/config.worktree.lock`) per SessionHost so Host A teardown only removes
 * Host A's placeholder files, and process exit cleans up any remaining live
 * hosts' placeholder files.
 */
let placeholderProcessExitHookInstalled = false

function cleanupLinuxSandboxPlaceholderFilesForSet(
  trackedFiles: Set<string>,
  extraPaths?: readonly string[],
): string[] {
  const candidates = extraPaths
    ? new Set([...trackedFiles, ...extraPaths])
    : new Set(trackedFiles)
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
      trackedFiles.delete(p)
    } catch {
      trackedFiles.delete(p)
    }
  }
  return removed
}

function installLinuxPlaceholderExitHook(hostState: SandboxHostState): void {
  if (!placeholderProcessExitHookInstalled) {
    placeholderProcessExitHookInstalled = true
    const onExit = (): void => {
      for (const liveState of getLiveSandboxHostStates()) {
        cleanupLinuxSandboxPlaceholderFilesForSet(
          liveState.createdLinuxPlaceholderFiles,
        )
      }
    }
    process.once('exit', onExit)
  }
  if (!hostState.placeholderCleanupRegistered) {
    hostState.placeholderCleanupRegistered = true
    const stateRef = new WeakRef(hostState)
    registerCleanup(() => {
      const liveState = stateRef.deref()
      if (!liveState) return
      cleanupLinuxSandboxPlaceholderFilesForSet(
        liveState.createdLinuxPlaceholderFiles,
      )
    })
  }
}

/**
 * Official 2.1.326 #23: remove tracked 0-byte placeholder files (such as
 * `.git/config.lock` or `.git/config.worktree`) left by Linux bwrap when a
 * command ends or Claude Code is stopped. Never deletes non-empty user files.
 */
export function cleanupLinuxSandboxPlaceholderFiles(
  extraPaths?: readonly string[],
): string[] {
  return cleanupLinuxSandboxPlaceholderFilesForSet(
    getSandboxHostState().createdLinuxPlaceholderFiles,
    extraPaths,
  )
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
    const hostState = getSandboxHostState()
    hostState.createdLinuxPlaceholderFiles.add(path)
    installLinuxPlaceholderExitHook(hostState)
  } catch {
    // exists, or parent is gone — official G() swallows
  }
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
function classifyGitDirStat(
  st: NonNullable<ReturnType<typeof lstatSync>>,
): GitDirEntryKind {
  if (st.isSymbolicLink()) return 'symlink'
  if (st.isFIFO()) return 'fifo'
  if (st.isDirectory()) return 'dir'
  if (st.isFile()) return 'file'
  return 'other'
}

function readGitDirSymlinkTarget(fullPath: string): string {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
    return readlinkSync(fullPath, 'latin1')
  } catch (err) {
    return `\x00${getErrnoCode(err) ?? 'ERR'}`
  }
}

/** Official 2.1.328 `jS = 512` — max symref scan buffer size in bytes. */
const GIT_SYMREF_SCAN_BYTES = 512
/** Loose-object fanout directory names under `.git/objects/` (`00`..`ff`). */
const GIT_OBJECTS_FANOUT_RE = /^[0-9a-f]{2}$/i

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
  out: Map<string, GitDirBaselineEntry> = new Map(),
): Map<string, GitDirBaselineEntry> {
  // Iterative traversal without artificial depth cutoff. Only real directories
  // (`lstatSync` -> `isDirectory()`, never following symlinks) are descended
  // into, and visited `(dev, ino)` pairs guard against bind-mount cycles.
  // `.git/objects/info` and `.git/objects/pack` ARE scanned; only loose-object
  // hex fanout dirs (`.git/objects/[0-9a-f]{2}`) are skipped when they are dirs.
  const stack: string[] = ['']
  const visitedDirInodes = new Set<string>()
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
    const rootStat = lstatSync(rootGitDir)
    if (rootStat.ino) {
      visitedDirInodes.add(`${rootStat.dev}:${rootStat.ino}`)
    }
  } catch {
    return out
  }

  while (stack.length > 0) {
    const relPrefix = stack.pop()!
    const dir = relPrefix ? join(rootGitDir, relPrefix) : rootGitDir
    let entries: string[]
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.startsWith('.claude-quarantine-')) continue
      const rel = relPrefix ? join(relPrefix, name) : name
      const fullPath = join(rootGitDir, rel)
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
        const st = lstatSync(fullPath)
        const kind = classifyGitDirStat(st)
        if (kind === 'symlink') {
          out.set(rel, { kind, linkTarget: readGitDirSymlinkTarget(fullPath) })
          continue
        }
        out.set(rel, { kind })
        if (kind === 'dir') {
          if (relPrefix === 'objects' && GIT_OBJECTS_FANOUT_RE.test(name)) {
            continue
          }
          if (st.ino) {
            const inodeKey = `${st.dev}:${st.ino}`
            if (visitedDirInodes.has(inodeKey)) continue
            visitedDirInodes.add(inodeKey)
          }
          stack.push(rel)
        }
      } catch {
        // ignore vanished entries
      }
    }
  }
  return out
}

function addUniqueGitDir(
  candidate: string,
  seen: Set<string>,
  gitDirs: string[],
  useCanonicalPath = false,
): void {
  const resolved = resolve(candidate)
  let canonical = resolved
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
    canonical = realpathSync(resolved)
  } catch {
    // keep resolved path when realpath fails
  }
  if (seen.has(canonical)) return
  seen.add(canonical)
  gitDirs.push(useCanonicalPath ? canonical : resolved)
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

export function resolveUniqueGitDirs(
  cwd: string,
  additionalWorkingDirectories?: readonly string[],
): string[] {
  const roots = [cwd, ...(additionalWorkingDirectories ?? [])]
  const seen = new Set<string>()
  const visitedDirs = new Set<string>()
  const gitDirs: string[] = []
  for (const rawRoot of roots) {
    if (!rawRoot) continue
    let cur = resolve(expandPath(rawRoot))
    for (;;) {
      if (visitedDirs.has(cur)) break
      visitedDirs.add(cur)
      const dotGit = join(cur, '.git')
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
        const st = lstatSync(dotGit)
        if (st.isDirectory()) {
          addUniqueGitDir(dotGit, seen, gitDirs)
        } else if (st.isFile()) {
          // Linked worktree `.git` file: resolve main repo's common `.git` dir
          const commonDir = detectWorktreeMainRepoPath(cur)
          if (commonDir) {
            addUniqueGitDir(commonDir, seen, gitDirs)
          }
        } else if (st.isSymbolicLink()) {
          try {
            // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot / sync cleanup
            if (statSync(dotGit).isDirectory()) {
              addUniqueGitDir(dotGit, seen, gitDirs, true)
            }
          } catch {
            // ignore broken or unreadable symlink
          }
        }
      } catch {
        // No .git entry at this directory level
      }
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  }
  return gitDirs
}

export function snapshotGitDirBeforeSandboxWrap(
  cwd: string,
  additionalWorkingDirectories?: readonly string[],
): void {
  const gitDirSnapshotsBeforeWrap =
    getSandboxHostState().gitDirSnapshotsBeforeWrap
  for (const gitDir of resolveUniqueGitDirs(
    cwd,
    additionalWorkingDirectories,
  )) {
    const existing = gitDirSnapshotsBeforeWrap.get(gitDir)
    if (existing) {
      existing.refCount += 1
      continue
    }
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- pre-wrap snapshot
      const st = lstatSync(gitDir)
      if (!st.isDirectory()) continue
      const baseline = collectGitDirRelativeEntries(gitDir)
      gitDirSnapshotsBeforeWrap.set(gitDir, { baseline, refCount: 1 })
    } catch {
      // No .git directory at this working root
    }
  }
}

export function getActiveGitDirSnapshotCountForTesting(): number {
  return getSandboxHostState().gitDirSnapshotsBeforeWrap.size
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

export function quarantineUnexpectedGitDirEntries(
  cwd?: string,
  additionalWorkingDirectories?: readonly string[],
): {
  quarantined: string[]
  removedSymlinks: string[]
} {
  const quarantined: string[] = []
  const removedSymlinks: string[] = []
  const gitDirSnapshotsBeforeWrap =
    getSandboxHostState().gitDirSnapshotsBeforeWrap
  const targets = cwd
    ? resolveUniqueGitDirs(cwd, additionalWorkingDirectories)
    : Array.from(gitDirSnapshotsBeforeWrap.keys())
  let quarantineSeq = 0
  for (const gitDir of targets) {
    const snapshot = gitDirSnapshotsBeforeWrap.get(gitDir)
    if (!snapshot) continue
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
      if (lstatSync(gitDir).isDirectory()) {
        const current = collectGitDirRelativeEntries(gitDir)
        for (const [rel, currentEntry] of current) {
          const baselineEntry = snapshot.baseline.get(rel)
          const isNew = baselineEntry === undefined
          const replacedWithSymlink =
            !isNew &&
            currentEntry.kind === 'symlink' &&
            baselineEntry.kind !== 'symlink'
          const retargetedSymlink =
            !isNew &&
            currentEntry.kind === 'symlink' &&
            baselineEntry.kind === 'symlink' &&
            baselineEntry.linkTarget !== currentEntry.linkTarget
          const replacedWithFifo =
            !isNew &&
            currentEntry.kind === 'fifo' &&
            baselineEntry.kind !== 'fifo'
          const isTrackedRefPath = isGitRefBearingPath(rel)
          if (
            !isNew &&
            !replacedWithSymlink &&
            !retargetedSymlink &&
            !replacedWithFifo &&
            !isTrackedRefPath
          ) {
            continue
          }
          const fullPath = join(gitDir, rel)
          try {
            // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
            const st = lstatSync(fullPath)
            // Official `tme`: move aside newly appearing, replaced, or
            // retargeted symlinks (incl. Windows junctions), FIFOs, and `ref:`
            // symref files escaping `refs/` on ref-bearing paths (`eme`/`Khe`)
            // into a recoverable quarantine directory (falling back to unlink
            // only if rename fails). Never touch regular git metadata files.
            const isUnexpectedSymlink =
              (isNew || replacedWithSymlink || retargetedSymlink) &&
              st.isSymbolicLink()
            const isFifo =
              !isUnexpectedSymlink && (isNew || replacedWithFifo) && st.isFIFO()
            const isUnsafeRef =
              !isUnexpectedSymlink &&
              !isFifo &&
              isTrackedRefPath &&
              st.isFile() &&
              isEscapingGitRefFile(fullPath)
            if (isUnexpectedSymlink || isFifo || isUnsafeRef) {
              const quarantineDir = join(
                gitDir,
                '.claude-quarantine-unexpected',
              )
              const kindLabel = isUnexpectedSymlink
                ? retargetedSymlink
                  ? 'retargeted symlink'
                  : 'symlink'
                : isFifo
                  ? 'FIFO'
                  : 'escaping ref file'
              try {
                // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
                mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
                const safeName = rel.replace(/[\\/]/g, '_')
                const dest = join(
                  quarantineDir,
                  `${Date.now()}-${++quarantineSeq}-${safeName}`,
                )
                // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
                renameSync(fullPath, dest)
                quarantined.push(fullPath)
                if (isUnexpectedSymlink) {
                  removedSymlinks.push(fullPath)
                }
                logForDebugging(
                  `[Sandbox] Set aside planted ${kindLabel} ${fullPath} -> ${dest}`,
                  { level: 'warn' },
                )
              } catch {
                // Fallback unlink if rename into quarantine fails (matches official `tme`)
                // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand is sync
                unlinkSync(fullPath)
                quarantined.push(fullPath)
                if (isUnexpectedSymlink) {
                  removedSymlinks.push(fullPath)
                }
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
 * Official 2.1.323 #2174 & #2177 (`pushLinkedWorktreeConfigDenyWrite`):
 * Protect every linked worktree's `config.worktree`, `config.worktree.lock`,
 * `commondir`, and `glab-cli` inside `<gitDir>/worktrees/*`.
 */
export function pushLinkedWorktreeConfigDenyWrite(
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
 * Official 2.1.325 #2335 (`Ba` + `Hf` / `$r`):
 * Protect git metadata inside a git directory (`hooks`, `config`, `config.lock`,
 * `config.worktree`, `config.worktree.lock`, `commondir`, `worktrees`,
 * `info/exclude`, `glab-cli`, and linked worktrees under `worktrees/*`).
 */
export function pushGitDirMetadataDenyWrite(
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
export function guardWorktreeCommonDirDotGit(
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
    getSandboxHostState().bareGitRepoScrubPaths.push(nestedDotGit)
    if (st === undefined && getPlatform() === 'macos') {
      denyWrite.push(nestedDotGit)
      if (!/[*?]/.test(commonDir)) {
        denyWrite.push(join(commonDir, '.[gG][iI][tT]'))
      }
    }
  }
}

/**
 * Delete bare-repo files planted at cwd during a sandboxed command, before
 * Claude's unsandboxed git calls can see them. See the SECURITY block above
 * bareGitRepoFiles. anthropics/claude-code#29316.
 */
export function scrubBareGitRepoFiles(): void {
  for (const p of getSandboxHostState().bareGitRepoScrubPaths) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand must be sync (Shell.ts:367)
      rmSync(p, { recursive: true })
      logForDebugging(`[Sandbox] scrubbed planted bare-repo file: ${p}`)
    } catch {
      // ENOENT is the expected common case — nothing was planted
    }
  }
}
