import { constants as fsConstants, realpathSync } from 'fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  symlink,
  unlink,
} from 'fs/promises'
import { tmpdir } from 'os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { getPathsForPermissionCheck } from '../fsOperations.js'
import { logError } from '../log.js'
import {
  getClaudeTempDir,
  getProjectTempDir,
} from '../permissions/filesystem.js'
import { getPlatform } from '../platform.js'
import { sleep } from '../sleep.js'

// SECURITY: O_NOFOLLOW prevents following symlinks when opening task output files.
// Without this, an attacker in the sandbox could create symlinks in the tasks directory
// pointing to arbitrary files, causing Claude Code on the host to write to those files.
// O_NOFOLLOW is not available on Windows, but the sandbox attack vector is Unix-only.
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0

const DEFAULT_MAX_READ_BYTES = 8 * 1024 * 1024 // 8MB

/**
 * Disk cap for task output files. In file mode (bash), a watchdog polls
 * file size and kills the process. In pipe mode (hooks), DiskTaskOutput
 * drops chunks past this limit. Shared so both caps stay in sync.
 * Official 2.1.331 `Tce = 5368709120` ('5GB'), `uU = 67108864` (64MB), `qCs = 8192`.
 */
export const MAX_TASK_OUTPUT_BYTES = 5_368_709_120
export const MAX_TASK_OUTPUT_BYTES_DISPLAY = '5GB'
export const MAX_PERSISTED_OUTPUT_BYTES = 67_108_864
export const TASK_OUTPUT_TAIL_BYTES = 8192

/** densable 2.1.247 RTe — queued when the output file cannot be written. */
export const UNWRITTEN_OUTPUT_NOTICE = `
[output omitted: it could not be written to disk]
`
/** densable 2.1.247 hlo — drop the in-memory queue after a failed drain retry. */
export const UNWRITTEN_CHARS_DROP_THRESHOLD = 16_777_216

/** densable 2.1.301 tt/V — Windows EBUSY backoff schedule for trailer writes. */
export const EBUSY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600] as const
const EBUSY_RETRY_TOTAL_MS = EBUSY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
const EXHAUSTION_ERRNOS = new Set(['ENOSPC', 'EDQUOT', 'EROFS'])
export type TaskOutputTrailerKind = 'killed' | 'exited'

/** densable 2.1.247 TaskOutput.getStdout when failing || lostOutput. */
export function formatLostOutputNotice(sizeKB: number, path: string): string {
  return `Output truncated (${sizeKB}KB total). The full output could not all be saved to ${path}; that file may be missing or incomplete.`
}

/**
 * Get the task output directory for this session.
 * Uses project temp directory so reads are auto-allowed by checkReadableInternalPath.
 *
 * The session ID is included so concurrent sessions in the same project don't
 * clobber each other's output files. Startup cleanup in one session previously
 * unlinked in-flight output files from other sessions — the writing process's fd
 * keeps the inode alive but reads via path fail ENOENT, and getStdout() returned
 * empty string (inc-4586 / boris-20260309-060423).
 *
 * The session ID is captured at FIRST CALL, not re-read on every invocation.
 * /clear calls regenerateSessionId(), which would otherwise cause
 * ensureOutputDir() to create a new-session path while existing TaskOutput
 * instances still hold old-session paths — open() would ENOENT. Background
 * bash tasks surviving /clear need their output files to stay reachable.
 */
let _taskOutputDir: string | undefined
export function getTaskOutputDir(): string {
  if (_taskOutputDir === undefined) {
    _taskOutputDir = join(getProjectTempDir(), getSessionId(), 'tasks')
  }
  return _taskOutputDir
}

// Official 2.1.331 `yn().linkedOutputs` + `K` (linked target identity map) +
// `linksInheritedBefore` / `inheritedLinkLines` for pre-session symlink inheritance.
const PROCESS_START_MS = Date.now() - process.uptime() * 1000
const linkedOutputs = new Map<string, string>()
const linkedTargetIdentities = new Map<
  string,
  { dev: number | bigint; ino: number | bigint }
>()
let linksInheritedBefore = PROCESS_START_MS
const inheritedLinkLines = new Map<string, number>()

export function inheritPredecessorTaskOutputLinks(
  dir: string,
  cutoffMs: number,
): void {
  if (!Number.isFinite(cutoffMs)) return
  inheritedLinkLines.set(
    dir,
    Math.max(PROCESS_START_MS, Math.min(Date.now(), cutoffMs)),
  )
}

export function getLinksInheritedBeforeFor(dir: string): number {
  return Math.max(linksInheritedBefore, inheritedLinkLines.get(dir) ?? 0)
}

/** Test helper — override the pre-session inheritance cutoff timestamp. */
export function _setLinksInheritedBeforeForTest(cutoffMs?: number): void {
  linksInheritedBefore = cutoffMs ?? PROCESS_START_MS
  inheritedLinkLines.clear()
}

/** Test helper — clears the memoized dir and symlink registration state. */
export function _resetTaskOutputDirForTest(): void {
  _taskOutputDir = undefined
  linkedOutputs.clear()
  linkedTargetIdentities.clear()
  linksInheritedBefore = PROCESS_START_MS
  inheritedLinkLines.clear()
}

const SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function foldCaseForPlatform(p: string): string {
  const plat = getPlatform()
  return plat === 'windows' || plat === 'macos' ? p.toLowerCase() : p
}

function isSessionIdSegment(segment: string): boolean {
  return (
    segment === getSessionId() ||
    SESSION_UUID_RE.test(segment) ||
    segment.startsWith('session_') ||
    segment.startsWith('cse_')
  )
}

function getTaskOutputRootDirNormalized(): string {
  return dirname(dirname(dirname(resolve(getTaskOutputDir()))))
}

function safeRealpathSync(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Official 2.1.331 `x(e)` — path is inside the task output temp root. */
function isUnderTaskOutputRoot(targetPath: string): boolean {
  const root = resolve(getClaudeTempDir()).replace(/[\\/]+$/, '')
  const normalizedTarget = resolve(targetPath)
  const rootPrefix = root.endsWith(sep) ? root : root + sep
  const cmpTarget = foldCaseForPlatform(normalizedTarget)
  const cmpRoot = foldCaseForPlatform(root)
  const cmpPrefix = foldCaseForPlatform(rootPrefix)
  return cmpTarget === cmpRoot || cmpTarget.startsWith(cmpPrefix)
}

/** Official 2.1.331 `Rt(e)` — canonicalize task output path across root aliases (e.g. /tmp -> /private/tmp). */
function canonicalizeTaskOutputPath(filePath: string): string {
  const root = getTaskOutputRootDirNormalized()
  const resolved = resolve(filePath)
  if (resolved.startsWith(root + sep)) {
    return resolved
  }
  const candidateRoot = dirname(dirname(dirname(dirname(resolved))))
  const realCandidate = safeRealpathSync(candidateRoot)
  if (foldCaseForPlatform(realCandidate) === foldCaseForPlatform(root)) {
    return join(root, resolved.slice(candidateRoot.length + 1))
  }
  return resolved
}

/**
 * Official 2.1.331 `f6t` (`isTaskOutputFilePath`) — true when any spelling of
 * `filePath` sits directly inside `<taskOutputRoot>/<project>/<sessionId>/tasks/`.
 */
export function isTaskOutputFilePath(filePath: string): boolean {
  const root = getTaskOutputRootDirNormalized()
  const roots = new Set(
    [root, safeRealpathSync(root)].map(r => foldCaseForPlatform(r)),
  )
  return getPathsForPermissionCheck(filePath).some(spelling => {
    const dir = dirname(resolve(spelling))
    const sessionDir = dirname(dir)
    const rootDir = dirname(dirname(sessionDir))
    return (
      foldCaseForPlatform(basename(dir)) === 'tasks' &&
      isSessionIdSegment(basename(sessionDir)) &&
      roots.has(foldCaseForPlatform(rootDir))
    )
  })
}

function sessionGlobPatterns(): string[] {
  const patterns = [
    '????????-????-????-????-????????????',
    'session_*',
    'cse_*',
  ]
  const sid = getSessionId()
  if (
    sid &&
    !SESSION_UUID_RE.test(sid) &&
    !sid.startsWith('session_') &&
    !sid.startsWith('cse_') &&
    /^[A-Za-z0-9._-]+$/.test(sid)
  ) {
    patterns.push(sid)
  }
  return patterns
}

/**
 * Official 2.1.331 `FGi` (`taskOutputDirExclusions`) — ripgrep glob exclusions
 * preventing directory-level Grep from traversing into task output directories.
 * Returns `['!**']` when searching directly inside a `tasks/` directory.
 */
export function taskOutputDirExclusions(dirPath: string): string[] {
  const root = getTaskOutputRootDirNormalized()
  const roots = Array.from(new Set([root, safeRealpathSync(root)]))
  const exclusions = new Set<string>()
  const stripPrefix = (parent: string, child: string): string | null => {
    const prefix = parent.endsWith(sep) ? parent : parent + sep
    return foldCaseForPlatform(child).startsWith(foldCaseForPlatform(prefix))
      ? child.slice(prefix.length)
      : null
  }
  const toSlash = (p: string): string => p.replaceAll('\\', '/')

  for (const spelling of getPathsForPermissionCheck(dirPath)) {
    const abs = resolve(spelling)
    for (const r of roots) {
      const rootName = basename(r)
      if (foldCaseForPlatform(abs) === foldCaseForPlatform(r)) {
        for (const pat of sessionGlobPatterns()) {
          exclusions.add(`!/*/${pat}/tasks/**`)
          exclusions.add(`!**/${rootName}/*/${pat}/tasks/**`)
        }
        continue
      }
      const relToRoot = stripPrefix(abs, r)
      if (relToRoot !== null) {
        for (const pat of sessionGlobPatterns()) {
          exclusions.add(`!/${toSlash(relToRoot)}/*/${pat}/tasks/**`)
          exclusions.add(`!**/${rootName}/*/${pat}/tasks/**`)
        }
        continue
      }
      const relInsideRoot = stripPrefix(r, abs)
      if (relInsideRoot !== null) {
        const parts = relInsideRoot.split(sep)
        if (parts.length === 1) {
          for (const pat of sessionGlobPatterns()) {
            exclusions.add(`!/${pat}/tasks/**`)
            exclusions.add(
              `!**/${rootName}/${toSlash(relInsideRoot)}/${pat}/tasks/**`,
            )
          }
        } else if (!isSessionIdSegment(parts[1] ?? '')) {
          // unrelated directory
        } else if (parts.length === 2) {
          exclusions.add('!/tasks/**')
          exclusions.add(`!**/${rootName}/${toSlash(relInsideRoot)}/tasks/**`)
        } else if (foldCaseForPlatform(parts[2] ?? '') === 'tasks') {
          exclusions.add('!**')
        }
      }
    }
  }
  return [...exclusions]
}

async function readlinkOrNull(linkPath: string): Promise<string | null> {
  try {
    return await readlink(linkPath)
  } catch (e) {
    if (getErrnoCode(e) === 'EINVAL') return null
    throw e
  }
}

async function lstatOrNull(filePath: string) {
  try {
    return await lstat(filePath)
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') return null
    throw e
  }
}

async function recordTargetIdentity(targetPath: string): Promise<void> {
  const fh = await open(
    targetPath,
    process.platform === 'win32'
      ? 'r'
      : fsConstants.O_RDONLY | O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0),
  ).catch(e => {
    throw wrapSwapOpenError(e, targetPath)
  })
  try {
    const st = await fh.stat()
    if (!st.isFile() || (process.platform !== 'win32' && st.nlink !== 1)) {
      throw new TaskOutputSwapRefusedError(
        targetPath,
        'link target is not a regular single-link file',
      )
    }
    linkedTargetIdentities.set(targetPath, { dev: st.dev, ino: st.ino })
  } finally {
    await fh.close()
  }
}

async function registerLinkedOutput(
  linkPath: string,
  targetPath: string,
): Promise<void> {
  if (isUnderTaskOutputRoot(targetPath)) {
    await recordTargetIdentity(targetPath)
  }
  linkedOutputs.set(canonicalizeTaskOutputPath(linkPath), targetPath)
}

function getRecordedTargetIdentity(targetPath: string): {
  dev: number | bigint
  ino: number | bigint
} {
  const id = linkedTargetIdentities.get(targetPath)
  if (id === undefined) {
    throw new TaskOutputSwapRefusedError(
      targetPath,
      'link target identity was never recorded',
    )
  }
  return id
}

/**
 * Official 2.1.331 `pt(e, n, r)` — allow inheriting an unregistered symlink ONLY
 * when its target is absolute and inside the tasks root or `CLAUDE_CONFIG_DIR`
 * AND the symlink's `ctimeMs` strictly predates `linksInheritedBeforeFor(dir)`.
 */
async function inheritPreSessionOutputSymlink(
  canonicalLinkPath: string,
  ioPath: string,
  rawTarget: string,
): Promise<string> {
  const configRoot = resolve(getClaudeConfigHomeDir())
  const inConfigDir =
    isAbsolute(rawTarget) && resolve(rawTarget).startsWith(configRoot + sep)
  if (
    !isAbsolute(rawTarget) ||
    (!isUnderTaskOutputRoot(rawTarget) && !inConfigDir)
  ) {
    throw new TaskOutputSwapRefusedError(
      canonicalLinkPath,
      'output is an unregistered symlink of a shape this session does not create',
    )
  }
  const st = await lstat(ioPath)
  if (
    !st.isSymbolicLink() ||
    st.ctimeMs >= getLinksInheritedBeforeFor(dirname(canonicalLinkPath))
  ) {
    throw new TaskOutputSwapRefusedError(
      canonicalLinkPath,
      'output is an unregistered symlink made during this session',
    )
  }
  await registerLinkedOutput(canonicalLinkPath, rawTarget)
  return rawTarget
}

/** Official 2.1.331 `tt(e, n)` — verify symlink against `linkedOutputs` allowlist or pre-session bound. */
async function resolveAuthorizedOutputSymlink(
  linkPath: string,
  ioPath: string,
): Promise<string | null> {
  const canonical = canonicalizeTaskOutputPath(linkPath)
  let expected = linkedOutputs.get(canonical)
  if (expected === undefined) {
    if (!isTaskOutputFilePath(canonical)) {
      throw new TaskOutputSwapRefusedError(
        canonical,
        'output is an unregistered symlink outside any tasks directory',
      )
    }
    const raw = await readlinkOrNull(ioPath)
    if (raw === null) return null
    expected = await inheritPreSessionOutputSymlink(canonical, ioPath, raw)
  }
  const current = await readlinkOrNull(ioPath)
  if (current === null) return null
  if (current !== expected) {
    throw new TaskOutputSwapRefusedError(
      canonical,
      'output symlink was re-pointed',
    )
  }
  return expected
}

function wrapSwapOpenError(e: unknown, pathForError: string): unknown {
  const code = getErrnoCode(e)
  if (
    code === 'ELOOP' ||
    code === 'EISDIR' ||
    code === 'ENOTDIR' ||
    code === 'ENXIO' ||
    code === 'EOPNOTSUPP' ||
    code === 'ENOTSUP'
  ) {
    return new TaskOutputSwapRefusedError(
      pathForError,
      `open refused a swapped leaf (${code})`,
    )
  }
  return e
}

/**
 * densable hxg / repointTaskOutputSymlinks — after tNt renames the session
 * sidecar dir (`…/<sessionId>/`), rewrite any `*.output` symlinks under the
 * task-output dir that still point into the old sidecar prefix.
 *
 * No-op when the task-output dir has never been materialised (RIt === undefined).
 */
export async function repointTaskOutputSymlinks(
  oldSideDir: string,
  newSideDir: string,
): Promise<void> {
  if (_taskOutputDir === undefined) return
  let entries: string[]
  try {
    entries = await readdir(_taskOutputDir)
  } catch (e) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logError(e)
    }
    return
  }
  const oldPrefix = oldSideDir.endsWith(sep) ? oldSideDir : oldSideDir + sep
  for (const name of entries) {
    if (!name.endsWith('.output')) continue
    const linkPath = canonicalizeTaskOutputPath(join(_taskOutputDir, name))
    let expected = linkedOutputs.get(linkPath)
    try {
      if (expected === undefined) {
        const raw = await readlinkOrNull(linkPath)
        if (raw === null) continue
        expected = await inheritPreSessionOutputSymlink(linkPath, linkPath, raw)
      }
      if (!expected.startsWith(oldPrefix) && expected !== oldSideDir) continue
      const next =
        expected === oldSideDir
          ? newSideDir
          : newSideDir + expected.slice(oldSideDir.length)
      const current = await readlinkOrNull(linkPath)
      if (current === null) continue
      if (current !== expected) {
        throw new TaskOutputSwapRefusedError(
          linkPath,
          'output symlink was re-pointed',
        )
      }
      await pinWriteTarget(_taskOutputDir)
      await unlink(linkPath)
      if (linkedOutputs.get(linkPath) === expected) {
        await registerLinkedOutput(linkPath, next)
      }
      try {
        await symlink(next, linkPath).catch(async e => {
          if (getErrnoCode(e) !== 'EEXIST') throw e
          const nowTarget = await readlinkOrNull(linkPath).catch(() => null)
          if (nowTarget !== next && nowTarget !== linkedOutputs.get(linkPath)) {
            throw e
          }
        })
      } catch (e) {
        if (linkedOutputs.get(linkPath) === next) {
          linkedOutputs.delete(linkPath)
        }
        throw e
      }
      if ((await readlinkOrNull(linkPath).catch(() => null)) === next) {
        linkedOutputs.set(linkPath, next)
      }
    } catch (e) {
      if (getErrnoCode(e) !== 'ENOENT' && !isTaskOutputSwapRefusal(e)) {
        logError(e)
      }
    }
  }
}

/**
 * densable `P` @252 — `task output swap refused (${reason}): ${path}` plus
 * optional `. To recover: ${recover}.`
 */
export class TaskOutputSwapRefusedError extends Error {
  constructor(path: string, reason: string, recover?: string) {
    super(
      `task output swap refused (${reason}): ${path}` +
        (recover === undefined ? '' : `. To recover: ${recover}.`),
    )
    this.name = 'TaskOutputSwapRefusedError'
  }
}

/** Official 2.1.331 `SAt` (`isTaskOutputSwapRefusal`). */
export function isTaskOutputSwapRefusal(err: unknown): boolean {
  return err instanceof TaskOutputSwapRefusedError
}

/**
 * densable `P`/`q` @252 recover clause. Strip trailing `/` or `\` from
 * tmpRoot (gold `Vv().replace(/[\\/]+$/, "")`).
 */
export function formatTaskOutputSwapRecover(tmpRoot: string): string {
  const root = tmpRoot.replace(/[\\/]+$/, '')
  return (
    'restart Claude Code with CLAUDE_CODE_TMPDIR set to a fresh ' +
    `directory; or, if ${root} is a stray directory or a ` +
    'symbolic link that should not be there, remove that entry ' +
    'itself (not what it points to) and restart'
  )
}

function throwTasksDirMovedOrLinked(dir: string): never {
  throw new TaskOutputSwapRefusedError(
    dir,
    'tasks dir moved or linked',
    formatTaskOutputSwapRecover(process.env.CLAUDE_CODE_TMPDIR || tmpdir()),
  )
}

/**
 * Official 2.1.331 `pinWriteTarget` / `en(dir, canonHandle, platform)`:
 * Refuse any symlink (leaf or ancestor) or non-directory at `dir`.
 * Only accepts a realpath mismatch on macOS when EVERY ancestor component is a
 * true directory (not a symlink — e.g. APFS firmlinks) and `fstat` of
 * `O_RDONLY | O_DIRECTORY | O_NOFOLLOW` matches the canonical directory's (dev, ino).
 */
export async function pinWriteTarget(dir: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  let entry: Awaited<ReturnType<typeof lstat>>
  try {
    entry = await lstat(dir)
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      throwTasksDirMovedOrLinked(dir)
    }
    throw e
  }

  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    logForDebugging(
      `pinWriteTarget: ${dir} is not a real directory (symlink=${entry.isSymbolicLink()}); refused`,
      { level: 'warn' },
    )
    throwTasksDirMovedOrLinked(dir)
  }

  let resolved: string
  try {
    resolved = await realpath(dir)
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      throwTasksDirMovedOrLinked(dir)
    }
    throw e
  }

  const O_DIRECTORY = fsConstants.O_DIRECTORY ?? 0

  if (normalize(dir) === normalize(resolved)) {
    let fh: FileHandle
    try {
      fh = await open(dir, fsConstants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    } catch (e) {
      const code = getErrnoCode(e)
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        throwTasksDirMovedOrLinked(dir)
      }
      throw e
    }
    try {
      const fdStat = await fh.stat()
      if (
        !fdStat.isDirectory() ||
        fdStat.dev !== entry.dev ||
        fdStat.ino !== entry.ino
      ) {
        throwTasksDirMovedOrLinked(dir)
      }
    } finally {
      await fh.close()
    }
    return
  }

  if (process.platform === 'darwin') {
    let allAncestorsRealDirs = true
    for (let cur = normalize(dir); ; cur = dirname(cur)) {
      try {
        const st = await lstat(cur)
        if (st.isSymbolicLink() || !st.isDirectory()) {
          allAncestorsRealDirs = false
          break
        }
      } catch {
        allAncestorsRealDirs = false
        break
      }
      if (dirname(cur) === cur) break
    }
    if (allAncestorsRealDirs) {
      let givenHandle: FileHandle | undefined
      let canonHandle: FileHandle | undefined
      try {
        givenHandle = await open(
          dir,
          fsConstants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
        )
        canonHandle = await open(
          resolved,
          fsConstants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
        )
        const [given, canon] = await Promise.all([
          givenHandle.stat({ bigint: true }),
          canonHandle.stat({ bigint: true }),
        ])
        if (
          given.isDirectory() &&
          canon.isDirectory() &&
          given.dev === canon.dev &&
          given.ino === canon.ino
        ) {
          logForDebugging(
            `pinWriteTarget: ${dir} is rendered ${resolved} by realpath; ` +
              'same directory (device and inode), treated as an alias',
          )
          return
        }
      } catch {
        // Fall through to refuse
      } finally {
        await givenHandle?.close().catch(() => {})
        await canonHandle?.close().catch(() => {})
      }
    }
  }

  logForDebugging(
    `pinWriteTarget: ${dir} resolves to ${resolved}: not the same ` +
      'directory by a link-free route; refused',
    { level: 'warn' },
  )
  throwTasksDirMovedOrLinked(dir)
}

/**
 * Ensure the task output directory exists
 */
async function ensureOutputDir(): Promise<void> {
  const dir = getTaskOutputDir()
  await mkdir(dir, { recursive: true })
  await pinWriteTarget(dir)
}

/**
 * Get the output file path for a task
 */
export function getTaskOutputPath(taskId: string): string {
  return join(getTaskOutputDir(), `${taskId}.output`)
}

/** Official 2.1.331 — read refuses unregistered symlinks, chained symlinks, or unix nlink≠1 leaf. */
const TASK_OUTPUT_NOT_REGULAR = 'not a regular nlink-1 file'

/**
 * Official 2.1.331 `resolveTaskOutputReadPath` — validates the leaf against the
 * `linkedOutputs` allowlist + pre-session symlink inheritance bound (`linksInheritedBeforeFor`),
 * refuses unregistered session-created symlinks, symlink chains, symlinks leading
 * back into the tasks tree, non-files, and Unix `nlink !== 1` hardlinks.
 */
export async function resolveTaskOutputReadPath(
  path: string,
  depth = 0,
): Promise<string | null> {
  const canonical = canonicalizeTaskOutputPath(path)
  const st = await lstatOrNull(canonical)
  if (st === null) return null

  if (st.isSymbolicLink()) {
    const target = await resolveAuthorizedOutputSymlink(canonical, canonical)
    if (target === null) {
      return resolveTaskOutputReadPath(path, depth)
    }
    if (isUnderTaskOutputRoot(target)) {
      if (depth > 0) {
        throw new TaskOutputSwapRefusedError(canonical, 'output links chain')
      }
      return resolveTaskOutputReadPath(target, depth + 1)
    }
    let resolvedTarget: string
    try {
      resolvedTarget = await realpath(target)
    } catch (e) {
      if (getErrnoCode(e) === 'ENOENT') return null
      throw wrapSwapOpenError(e, canonical)
    }
    if (isUnderTaskOutputRoot(resolvedTarget)) {
      throw new TaskOutputSwapRefusedError(
        canonical,
        'output link leads back into the tasks tree',
      )
    }
    const targetStat = await lstatOrNull(resolvedTarget)
    if (targetStat === null) return null
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new TaskOutputSwapRefusedError(canonical, TASK_OUTPUT_NOT_REGULAR)
    }
    return resolvedTarget
  }

  if (depth === 0 && st.isFile() && st.nlink === 0) {
    return null
  }
  if (
    !st.isFile() ||
    (process.platform !== 'win32' && st.nlink !== 1 && depth === 0)
  ) {
    throw new TaskOutputSwapRefusedError(canonical, TASK_OUTPUT_NOT_REGULAR)
  }
  return canonical
}

/**
 * Official 2.1.331 `$Xe` (`openTaskOutputRead` / `openTaskOutputForRead`):
 * Validates leaf + authorized symlink allowlist, opens with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`
 * (Windows `"r"`), and verifies handle identity via `vt`. Caller must close.
 */
export async function openTaskOutputRead(
  path: string,
  depth = 0,
  relooked = false,
): Promise<FileHandle | null> {
  const canonical = canonicalizeTaskOutputPath(path)
  const st = await lstatOrNull(canonical)
  if (st === null) {
    return null
  }

  if (st.isSymbolicLink()) {
    const target = await resolveAuthorizedOutputSymlink(canonical, canonical)
    if (target === null) {
      if (relooked) {
        throw new TaskOutputSwapRefusedError(
          canonical,
          'output leaf changed during open',
        )
      }
      return openTaskOutputRead(canonical, depth, true)
    }
    if (isUnderTaskOutputRoot(target)) {
      if (depth > 0) {
        throw new TaskOutputSwapRefusedError(canonical, 'output links chain')
      }
      return openTaskOutputRead(target, depth + 1, false)
    }
    // Authorized symlink to external transcript (e.g. ~/.claude/projects/.../*.jsonl)
    let resolvedTarget: string
    let targetStat: Awaited<ReturnType<typeof lstat>>
    let fh: FileHandle
    try {
      resolvedTarget = await realpath(target)
      if (isUnderTaskOutputRoot(resolvedTarget)) {
        throw new TaskOutputSwapRefusedError(
          canonical,
          'output link leads back into the tasks tree',
        )
      }
      targetStat = await lstat(resolvedTarget)
      fh =
        process.platform === 'win32'
          ? await open(resolvedTarget, 'r')
          : await open(
              resolvedTarget,
              fsConstants.O_RDONLY | O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0),
            )
    } catch (e) {
      if (isTaskOutputSwapRefusal(e)) throw e
      if (getErrnoCode(e) === 'ENOENT') return null
      throw wrapSwapOpenError(e, canonical)
    }
    try {
      const fdStat = await fh.stat()
      if (
        !fdStat.isFile() ||
        fdStat.ino !== targetStat.ino ||
        fdStat.dev !== targetStat.dev
      ) {
        throw new TaskOutputSwapRefusedError(
          canonical,
          'link target is not a regular file',
        )
      }
    } catch (e) {
      await fh.close().catch(() => {})
      throw e
    }
    return fh
  }

  if (depth === 0 && st.isFile() && st.nlink === 0) {
    return null
  }
  if (
    !st.isFile() ||
    (process.platform !== 'win32' && st.nlink !== 1 && depth === 0)
  ) {
    throw new TaskOutputSwapRefusedError(canonical, TASK_OUTPUT_NOT_REGULAR)
  }

  try {
    const fh =
      process.platform === 'win32'
        ? await open(canonical, 'r')
        : await open(
            canonical,
            fsConstants.O_RDONLY | O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0),
          )
    // densable vt(handle, priorStat, path, {registeredIdentity, anyLinkCount})
    try {
      const checkStatus = await vt(fh, st, path, {
        registeredIdentity:
          depth > 0 ? getRecordedTargetIdentity(canonical) : undefined,
        anyLinkCount: process.platform === 'win32',
        unlinkedIsGone: depth === 0,
      })
      if (checkStatus === 'gone') {
        return null
      }
    } catch (e) {
      await fh.close().catch(() => {})
      throw e
    }
    return fh
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') {
      return null
    }
    if (isTaskOutputSwapRefusal(e)) {
      throw e
    }
    throw wrapSwapOpenError(e, canonical)
  }
}

/**
 * Official 2.1.331 `uTr` (`bindTaskOutputForRead`):
 * Safely binds a task output file for reading via `openTaskOutputRead`
 * (O_NOFOLLOW + registered-symlink allowlist + nlink=1 + fstat recheck) and
 * returns a `/dev/fd/<fd>` (macOS) or `/proc/self/fd/<fd>` (Linux/WSL) handle.
 * Caller MUST call `close()` in `finally`.
 */
export async function bindTaskOutputForRead(filePath: string): Promise<{
  ioPath: string
  canonicalPath: string
  handle: FileHandle
  close: () => Promise<void>
}> {
  const canonical = canonicalizeTaskOutputPath(filePath)
  const handle = await openTaskOutputRead(canonical)
  if (handle === null) {
    // Throw ENOENT if the entry itself doesn't exist; otherwise the link target vanished.
    await lstat(canonical)
    throw new Error(
      `task output ${canonical} is no longer available (the file it pointed to was removed)`,
    )
  }
  const platform = getPlatform()
  let ioPath = canonical
  if (platform === 'linux' || platform === 'wsl') {
    const procFd = `/proc/self/fd/${handle.fd}`
    const procReadable = await readlink(procFd).then(
      () => true,
      () => false,
    )
    if (procReadable) {
      ioPath = procFd
    }
  } else if (platform === 'macos') {
    ioPath = `/dev/fd/${handle.fd}`
  }
  return {
    ioPath,
    canonicalPath: canonical,
    handle,
    close: () => handle.close(),
  }
}

/**
 * Official 2.1.331 `N` (`openTaskOutputForAppend`) — safe append/create opener
 * verifying pre-open `lstat` (plain file, `nlink === 1`, or authorized symlink
 * under tasks root) + `O_NOFOLLOW` + post-open `fstat` identity & `nlink === 1`.
 */
export async function openTaskOutputForAppend(
  filePath: string,
  opts: {
    exclusive?: boolean
    windowsFlags?: string
    retried?: boolean
    relooked?: boolean
  } = {},
  depth = 0,
): Promise<FileHandle> {
  const canonical = isTaskOutputFilePath(filePath)
    ? canonicalizeTaskOutputPath(filePath)
    : filePath
  const parentDir = dirname(canonical)

  if (process.platform === 'win32') {
    await mkdir(parentDir, { recursive: true })
    return open(canonical, opts.windowsFlags ?? 'a')
  }

  if (
    foldCaseForPlatform(resolve(parentDir)) ===
    foldCaseForPlatform(resolve(getTaskOutputDir()))
  ) {
    await ensureOutputDir()
  } else {
    await mkdir(parentDir, { recursive: true })
    const parentStat = await lstat(parentDir)
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
      throwTasksDirMovedOrLinked(parentDir)
    }
  }

  const existing = await lstatOrNull(canonical)
  if (existing?.isSymbolicLink()) {
    const target = await resolveAuthorizedOutputSymlink(canonical, canonical)
    if (target === null) {
      if (opts.relooked) {
        throw new TaskOutputSwapRefusedError(
          canonical,
          'output leaf changed during open',
        )
      }
      return openTaskOutputForAppend(
        canonical,
        { ...opts, relooked: true },
        depth,
      )
    }
    if (opts.exclusive || depth > 0 || !isUnderTaskOutputRoot(target)) {
      throw new TaskOutputSwapRefusedError(
        canonical,
        'output link is not appendable',
      )
    }
    return openTaskOutputForAppend(
      target,
      { exclusive: opts.exclusive, windowsFlags: opts.windowsFlags },
      depth + 1,
    )
  }

  if (
    existing !== null &&
    (!existing.isFile() || (existing.nlink !== 1 && depth === 0))
  ) {
    throw new TaskOutputSwapRefusedError(
      canonical,
      'existing output is not a plain file',
    )
  }

  const createExclusive = opts.exclusive === true || existing === null
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_APPEND |
    (createExclusive ? fsConstants.O_CREAT | fsConstants.O_EXCL : 0) |
    O_NOFOLLOW |
    (fsConstants.O_NONBLOCK ?? 0)

  let fh: FileHandle
  try {
    fh = await open(canonical, flags)
  } catch (e) {
    if (!opts.exclusive && getErrnoCode(e) === 'EEXIST' && !opts.retried) {
      return openTaskOutputForAppend(
        canonical,
        { ...opts, retried: true },
        depth,
      )
    }
    throw wrapSwapOpenError(e, canonical)
  }

  if (depth > 0 && existing === null) {
    const st = await fh.stat()
    linkedTargetIdentities.set(canonical, { dev: st.dev, ino: st.ino })
  }

  try {
    await vt(fh, existing, canonical, {
      registeredIdentity:
        depth > 0 ? getRecordedTargetIdentity(canonical) : undefined,
    })
  } catch (e) {
    await fh.close().catch(() => {})
    throw e
  }
  return fh
}

/**
 * densable `vt` — post-open identity recheck on the file handle.
 * Gold: reject if not a file, wrong ino/dev vs registeredIdentity or prior
 * lstat, or (unix default) nlink≠1.
 */
export async function vt(
  handle: FileHandle,
  prior: { ino: number | bigint; dev: number | bigint } | null,
  pathForError: string,
  opts?: {
    registeredIdentity?: { ino: number | bigint; dev: number | bigint }
    anyLinkCount?: boolean
    unlinkedIsGone?: boolean
  },
): Promise<'same' | 'gone'> {
  const r = await handle.stat()
  const s = opts?.registeredIdentity
  if (
    opts?.unlinkedIsGone &&
    s === undefined &&
    !opts.anyLinkCount &&
    prior !== null &&
    r.isFile() &&
    r.nlink === 0 &&
    r.ino === prior.ino &&
    r.dev === prior.dev
  ) {
    await handle.close().catch(() => {})
    return 'gone'
  }
  if (
    !r.isFile() ||
    (s !== undefined
      ? r.ino !== s.ino || r.dev !== s.dev
      : !opts?.anyLinkCount && r.nlink !== 1) ||
    (prior !== null && (r.ino !== prior.ino || r.dev !== prior.dev))
  ) {
    throw new TaskOutputSwapRefusedError(
      pathForError,
      'output file identity changed',
    )
  }
  return 'same'
}

/** Read [offset, offset+maxBytes) through densable XX open-read. */
async function readTaskOutputRange(
  path: string,
  offset: number,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number; bytesTotal: number } | null> {
  const fh = await openTaskOutputRead(path)
  if (!fh) {
    return null
  }
  try {
    const size = (await fh.stat()).size
    if (size <= offset) {
      return null
    }
    const bytesToRead = Math.min(size - offset, maxBytes)
    const buffer = Buffer.allocUnsafe(bytesToRead)
    let totalRead = 0
    while (totalRead < bytesToRead) {
      const { bytesRead } = await fh.read(
        buffer,
        totalRead,
        bytesToRead - totalRead,
        offset + totalRead,
      )
      if (bytesRead === 0) {
        break
      }
      totalRead += bytesRead
    }
    return {
      content: buffer.toString('utf8', 0, totalRead),
      bytesRead: totalRead,
      bytesTotal: size,
    }
  } finally {
    await fh.close()
  }
}

/** Tail last maxBytes through densable XX open-read. */
async function tailTaskOutput(
  path: string,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number; bytesTotal: number }> {
  const fh = await openTaskOutputRead(path)
  if (!fh) {
    return { content: '', bytesRead: 0, bytesTotal: 0 }
  }
  try {
    const size = (await fh.stat()).size
    if (size === 0) {
      return { content: '', bytesRead: 0, bytesTotal: 0 }
    }
    const offset = Math.max(0, size - maxBytes)
    const bytesToRead = size - offset
    const buffer = Buffer.allocUnsafe(bytesToRead)
    let totalRead = 0
    while (totalRead < bytesToRead) {
      const { bytesRead } = await fh.read(
        buffer,
        totalRead,
        bytesToRead - totalRead,
        offset + totalRead,
      )
      if (bytesRead === 0) {
        break
      }
      totalRead += bytesRead
    }
    // densable `jBe`: skip UTF-8 continuation bytes at the tail window start.
    let skip = 0
    while (offset > 0 && skip < totalRead && (buffer[skip]! & 192) === 128) {
      skip++
    }
    return {
      content: buffer.toString('utf8', skip, totalRead),
      bytesRead: totalRead - skip,
      bytesTotal: size,
    }
  } finally {
    await fh.close()
  }
}

// Tracks fire-and-forget promises (initTaskOutput, initTaskOutputAsSymlink,
// evictTaskOutput, #drain) so tests can drain before teardown. Prevents the
// async-ENOENT-after-teardown flake class (#24957, #25065): a voided async
// resumes after preload's afterEach nuked the temp dir → ENOENT → unhandled
// rejection → flaky test failure. allSettled so a rejection doesn't short-
// circuit the drain and leave other ops racing the rmSync.
const _pendingOps = new Set<Promise<unknown>>()
function track<T>(p: Promise<T>): Promise<T> {
  _pendingOps.add(p)
  void p.finally(() => _pendingOps.delete(p)).catch(() => {})
  return p
}

/**
 * Encapsulates async disk writes for a single task's output.
 *
 * Uses a flat array as a write queue processed by a single drain loop,
 * so each chunk can be GC'd immediately after its write completes.
 * This avoids the memory retention problem of chained .then() closures
 * where every reaction captures its data until the whole chain resolves.
 */
export class DiskTaskOutput {
  #path: string
  #fileHandle: FileHandle | null = null
  #queue: string[] = []
  #bytesWritten = 0
  #capped = false
  #unwrittenChars = 0
  #generation = 0
  #failing = false
  #loggedKeys = new Set<string>()
  #lostOutput = false
  #trailerKind: TaskOutputTrailerKind | null = null
  #retryAbort: AbortController | null = null
  #flushPromise: Promise<void> | null = null
  #flushResolve: (() => void) | null = null

  constructor(taskId: string, outputPath?: string) {
    this.#path = outputPath ?? getTaskOutputPath(taskId)
  }

  append(content: string): void {
    if (this.#capped) {
      return
    }
    // content.length (UTF-16 code units) undercounts UTF-8 bytes by at most ~3×.
    // Acceptable for a coarse disk-fill guard — avoids re-scanning every chunk.
    this.#bytesWritten += content.length
    if (this.#bytesWritten > MAX_TASK_OUTPUT_BYTES) {
      this.#capped = true
    }
    const chunk = this.#capped
      ? `\n[output truncated: exceeded ${MAX_TASK_OUTPUT_BYTES_DISPLAY} disk cap]\n`
      : content
    this.#queue.push(chunk)
    this.#unwrittenChars += chunk.length
    if (!this.#flushPromise) {
      this.#flushPromise = new Promise<void>(resolve => {
        this.#flushResolve = resolve
      })
      void track(this.#drain())
    }
  }

  appendTrailer(content: string, kind: TaskOutputTrailerKind): void {
    if (!this.#capped) {
      this.#trailerKind = kind
    }
    this.append(content)
  }

  flush(): Promise<void> {
    return this.#flushPromise ?? Promise.resolve()
  }

  get failing(): boolean {
    return this.#failing
  }

  get lostOutput(): boolean {
    return this.#lostOutput
  }

  get unwrittenChars(): number {
    return this.#unwrittenChars
  }

  cancel(): void {
    this.#generation += 1
    this.#queue.length = 0
    this.#unwrittenChars = 0
    this.#trailerKind = null
    this.#retryAbort?.abort()
    this.#retryAbort = null
  }

  async #drainAllChunks(): Promise<void> {
    while (true) {
      try {
        if (!this.#fileHandle) {
          this.#fileHandle = await openTaskOutputForAppend(this.#path)
        }
        while (true) {
          const generation = this.#generation
          try {
            await this.#writeAllChunks()
          } catch (t) {
            if (this.#generation === generation) {
              this.#lostOutput = true
              this.#queue.unshift(UNWRITTEN_OUTPUT_NOTICE)
              this.#unwrittenChars += UNWRITTEN_OUTPUT_NOTICE.length
            }
            throw t
          }
          if (this.#queue.length === 0) {
            break
          }
        }
      } finally {
        if (this.#fileHandle) {
          const fileHandle = this.#fileHandle
          this.#fileHandle = null
          await fileHandle.close()
        }
      }
      // you could have another .append() while we're waiting for the file to close, so we check the queue again before fully exiting
      if (this.#queue.length) {
        continue
      }

      break
    }
  }

  #writeAllChunks(): Promise<void> {
    // This code is extremely precise.
    // You **must not** add an await here!! That will cause memory to balloon as the queue grows.
    // It's okay to add an `await` to the caller of this method (e.g. #drainAllChunks) because that won't cause Buffer[] to be kept alive in memory.
    return this.#fileHandle!.appendFile(
      // This variable needs to get GC'd ASAP.
      this.#queueToBuffers(),
    )
  }

  /** Keep this in a separate method so that GC doesn't keep it alive for any longer than it should. */
  #queueToBuffers(): Buffer {
    // Use .splice to in-place mutate the array, informing the GC it can free it.
    const queue = this.#queue.splice(0, this.#queue.length)
    this.#unwrittenChars = 0
    this.#trailerKind = null

    let totalLength = 0
    for (const str of queue) {
      totalLength += Buffer.byteLength(str, 'utf8')
    }

    const buffer = Buffer.allocUnsafe(totalLength)
    let offset = 0
    for (const str of queue) {
      offset += buffer.write(str, offset, 'utf8')
    }

    return buffer
  }

  async #drain(): Promise<void> {
    try {
      await this.#drainAllChunks()
      this.#clearFailing()
    } catch (e) {
      const ebusyKind = this.#ebusyTrailerKind(e)
      if (ebusyKind !== null) {
        if (!this.#failing) {
          this.#failing = true
          logForDebugging(
            `Task output closing line delayed: its file is busy (EBUSY); trying again for up to ${EBUSY_RETRY_TOTAL_MS} ms`,
          )
        }
        for (const [idx, delayMs] of EBUSY_RETRY_DELAYS_MS.entries()) {
          this.#retryAbort ??= new AbortController()
          await sleep(delayMs, this.#retryAbort.signal)
          if (this.#queue.length === 0) {
            return
          }
          const generation = this.#generation
          try {
            await this.#drainAllChunks()
            this.#clearFailing()
            return
          } catch (e2) {
            if (this.#queue.length === 0 && this.#generation !== generation) {
              return
            }
            const nextKind = this.#ebusyTrailerKind(e2)
            if (nextKind === null || idx === EBUSY_RETRY_DELAYS_MS.length - 1) {
              this.#giveUp(e2, nextKind)
              return
            }
          }
        }
        return
      }
      // densable 2.1.247 joe.#g: first fail marks failing and retries once.
      // A growing queue on permanent write failure is dropped at hlo.
      if (!this.#failing) {
        this.#failing = true
        logForDebugging(`Task output drain failed (will retry once): ${e}`, {
          level: 'error',
        })
      }
      if (this.#queue.length > 0) {
        try {
          await this.#drainAllChunks()
          this.#clearFailing()
        } catch (e2) {
          this.#giveUp(e2, null)
        }
      } else {
        this.#giveUp(e, null)
      }
    } finally {
      const resolve = this.#flushResolve!
      this.#flushPromise = null
      this.#flushResolve = null
      resolve()
    }
  }

  #clearFailing(): void {
    this.#failing = false
    this.#loggedKeys.clear()
  }

  #ebusyTrailerKind(e: unknown): TaskOutputTrailerKind | null {
    return process.platform === 'win32' && getErrnoCode(e) === 'EBUSY'
      ? this.#trailerKind
      : null
  }

  #giveUp(e: unknown, trailerKind: TaskOutputTrailerKind | null): void {
    const errno = getErrnoCode(e)
    const category =
      errno !== undefined && EXHAUSTION_ERRNOS.has(errno)
        ? 'exhaustion'
        : (trailerKind ?? 'unexpected')
    const key = `${category}:${errno ?? 'no errno'}`
    if (!this.#loggedKeys.has(key)) {
      this.#loggedKeys.add(key)
      switch (category) {
        case 'exhaustion':
          logForDebugging(`Task output drain retry failed (${errno}): ${e}`, {
            level: 'error',
          })
          break
        case 'exited':
          logForDebugging(
            `Task output closing line not written (EBUSY): the file was still busy after ${EBUSY_RETRY_TOTAL_MS} ms`,
            { level: 'warn' },
          )
          break
        case 'killed':
          logError(
            new Error(
              `closing line of a stopped shell command not written: output file still busy after ${EBUSY_RETRY_TOTAL_MS} ms`,
              { cause: e },
            ),
          )
          break
        case 'unexpected':
          logError(e)
          break
      }
    }
    if (this.#unwrittenChars > UNWRITTEN_CHARS_DROP_THRESHOLD) {
      logForDebugging(
        `Task output still cannot be written (${errno ?? 'no errno'}); dropped ${this.#unwrittenChars} chars of unwritten output`,
        { level: 'error' },
      )
      this.#lostOutput = true
      this.#queue.length = 0
      this.#queue.push(UNWRITTEN_OUTPUT_NOTICE)
      this.#unwrittenChars = UNWRITTEN_OUTPUT_NOTICE.length
      this.#trailerKind = null
    }
  }
}

const outputs = new Map<string, DiskTaskOutput>()

/**
 * Test helper — cancel pending writes, await in-flight ops, clear the map.
 * backgroundShells.test.ts and other task tests spawn real shells that
 * write through this module without afterEach cleanup; their entries
 * leak into diskOutput.test.ts on the same shard.
 *
 * Awaits all tracked promises until the set stabilizes — a settling promise
 * may spawn another (initTaskOutputAsSymlink's catch → initTaskOutput).
 * Call this in afterEach BEFORE rmSync to avoid async-ENOENT-after-teardown.
 */
export async function _clearOutputsForTest(): Promise<void> {
  for (const output of outputs.values()) {
    output.cancel()
  }
  while (_pendingOps.size > 0) {
    await Promise.allSettled([..._pendingOps])
  }
  outputs.clear()
}

function getOrCreateOutput(taskId: string): DiskTaskOutput {
  let output = outputs.get(taskId)
  if (!output) {
    output = new DiskTaskOutput(taskId)
    outputs.set(taskId, output)
  }
  return output
}

/**
 * Append output to a task's disk file asynchronously.
 * Creates the file if it doesn't exist.
 */
export function appendTaskOutput(taskId: string, content: string): void {
  getOrCreateOutput(taskId).append(content)
}

/**
 * Official SWt — append a terminal closing line (`[killed]` or `[exited with code ...]`)
 * so Windows EBUSY backoff retries apply when the shell's handle closes just after kill/exit.
 */
export function appendTaskOutputTrailer(
  taskId: string,
  outcome: 'killed' | { exitCode: number | null | undefined },
): void {
  const output = getOrCreateOutput(taskId)
  if (outcome === 'killed') {
    output.appendTrailer('\n[killed]\n', 'killed')
  } else {
    output.appendTrailer(
      `\n[exited with code ${outcome.exitCode ?? 'unknown'}]\n`,
      'exited',
    )
  }
}

/**
 * Wait for all pending writes for a task to complete.
 * Useful before reading output to ensure all data is flushed.
 */
export async function flushTaskOutput(taskId: string): Promise<void> {
  const output = outputs.get(taskId)
  if (output) {
    await output.flush()
  }
}

/**
 * Evict a task's DiskTaskOutput from the in-memory map after flushing.
 * Unlike cleanupTaskOutput, this does not delete the output file on disk.
 * Call this when a task completes and its output has been consumed.
 */
export function evictTaskOutput(taskId: string): Promise<void> {
  return track(
    (async () => {
      const output = outputs.get(taskId)
      if (output) {
        await output.flush()
        if (output.failing && output.unwrittenChars > 0) {
          logForDebugging(
            `Task output writer evicted while failing; discarded ${output.unwrittenChars} chars of unwritten output`,
            { level: 'error' },
          )
        }
        outputs.delete(taskId)
      }
    })(),
  )
}

/**
 * Get delta (new content) since last read.
 * Reads only from the byte offset, up to maxBytes — never loads the full file.
 */
export async function getTaskOutputDelta(
  taskId: string,
  fromOffset: number,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<{ content: string; newOffset: number }> {
  try {
    const result = await readTaskOutputRange(
      getTaskOutputPath(taskId),
      fromOffset,
      maxBytes,
    )
    if (!result) {
      return { content: '', newOffset: fromOffset }
    }
    return {
      content: result.content,
      newOffset: fromOffset + result.bytesRead,
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT' || isTaskOutputSwapRefusal(e)) {
      return { content: '', newOffset: fromOffset }
    }
    logError(e)
    return { content: '', newOffset: fromOffset }
  }
}

/**
 * Get output for a task, reading the tail of the file.
 * Caps at maxBytes to avoid loading multi-GB files into memory.
 */
/** densable `jBe` — tail for GetTask LF `output`. */
export async function readTaskOutputTail(
  taskId: string,
  maxBytes: number,
): Promise<{ content: string; omittedBytes: number }> {
  try {
    const { content, bytesTotal, bytesRead } = await tailTaskOutput(
      getTaskOutputPath(taskId),
      maxBytes,
    )
    return {
      content,
      omittedBytes: Math.max(0, bytesTotal - bytesRead),
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') logError(e)
    return { content: '', omittedBytes: 0 }
  }
}

export async function getTaskOutput(
  taskId: string,
  maxBytes: number = DEFAULT_MAX_READ_BYTES,
): Promise<string> {
  try {
    const { content, bytesTotal, bytesRead } = await tailTaskOutput(
      getTaskOutputPath(taskId),
      maxBytes,
    )
    if (bytesTotal > bytesRead) {
      return `[${Math.round((bytesTotal - bytesRead) / 1024)}KB of earlier output omitted]\n${content}`
    }
    return content
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return ''
    }
    logError(e)
    return ''
  }
}

/**
 * Get the current size (offset) of a task's output file.
 */
export async function getTaskOutputSize(taskId: string): Promise<number> {
  try {
    const fh = await openTaskOutputRead(getTaskOutputPath(taskId))
    if (fh === null) {
      return 0
    }
    try {
      return (await fh.stat()).size
    } finally {
      await fh.close()
    }
  } catch (e) {
    if (isTaskOutputSwapRefusal(e)) {
      throw e
    }
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return 0
    }
    logError(e)
    return 0
  }
}

/**
 * Clean up a task's output file and write queue.
 */
export async function cleanupTaskOutput(taskId: string): Promise<void> {
  const output = outputs.get(taskId)
  if (output) {
    output.cancel()
    outputs.delete(taskId)
  }

  const outputPath = canonicalizeTaskOutputPath(getTaskOutputPath(taskId))
  const prevTarget = linkedOutputs.get(outputPath)
  linkedOutputs.delete(outputPath)
  if (prevTarget !== undefined) {
    linkedTargetIdentities.delete(prevTarget)
  }

  try {
    await unlink(outputPath)
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return
    }
    logError(e)
  }
}

/**
 * Initialize output file for a new task.
 * Creates an empty file to ensure the path exists.
 */
export function initTaskOutput(taskId: string): Promise<string> {
  return track(
    (async () => {
      await ensureOutputDir()
      const outputPath = getTaskOutputPath(taskId)
      // SECURITY: O_NOFOLLOW prevents symlink-following attacks from the sandbox.
      // O_EXCL ensures we create a new file and fail if something already exists at this path.
      // On Windows, use string flags — numeric O_EXCL can produce EINVAL through libuv.
      const fh = await open(
        outputPath,
        process.platform === 'win32'
          ? 'wx'
          : fsConstants.O_WRONLY |
              fsConstants.O_CREAT |
              fsConstants.O_EXCL |
              O_NOFOLLOW,
      )
      await fh.close()
      return outputPath
    })(),
  )
}

/**
 * Initialize output file as a symlink to another file (e.g., agent transcript).
 * Registers the symlink in `linkedOutputs` (and target identity when under tasks
 * root) so `openTaskOutputRead` / `bindTaskOutputForRead` authorize it while
 * refusing any unregistered symlink.
 */
export function initTaskOutputAsSymlink(
  taskId: string,
  targetPath: string,
): Promise<string> {
  return track(
    (async () => {
      try {
        await ensureOutputDir()
        const outputPath = canonicalizeTaskOutputPath(getTaskOutputPath(taskId))

        if (isUnderTaskOutputRoot(targetPath)) {
          await recordTargetIdentity(targetPath)
        }
        linkedOutputs.set(outputPath, targetPath)
        try {
          try {
            await symlink(targetPath, outputPath)
          } catch (e) {
            if (getErrnoCode(e) !== 'EEXIST') throw e
            await unlink(outputPath).catch(err => {
              if (getErrnoCode(err) !== 'ENOENT') throw err
            })
            await symlink(targetPath, outputPath)
          }
        } catch (err) {
          if (linkedOutputs.get(outputPath) === targetPath) {
            linkedOutputs.delete(outputPath)
          }
          throw err
        }
        if (
          (await readlinkOrNull(outputPath).catch(() => null)) === targetPath
        ) {
          linkedOutputs.set(outputPath, targetPath)
        }

        return outputPath
      } catch (error) {
        if (!isTaskOutputSwapRefusal(error)) {
          logError(error)
        }
        return initTaskOutput(taskId)
      }
    })(),
  )
}
