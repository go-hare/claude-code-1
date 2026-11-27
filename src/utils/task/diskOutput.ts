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
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'
import { isDisklessActive } from '../disklessGuards.js'
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
// Official 2.1.331 (@305046105) `yn()` — per-SessionHost task output state bag:
// `diskOutputs`, `outputPathBindings`, `pendingOutputOps`, `linkedOutputs`,
// `linksInheritedBefore` / `inheritedLinkLines`, and memoized `taskOutputDir`.
const PROCESS_START_MS = Date.now() - process.uptime() * 1000

type HostDiskOutputState = {
  taskOutputDir: string | undefined
  diskOutputs: Map<string, DiskTaskOutput>
  outputPathBindings: Map<
    string,
    { dev: number | bigint; ino: number | bigint }
  >
  pendingOutputOps: Set<Promise<unknown>>
  linkedOutputs: Map<string, string>
  linksInheritedBefore: number
  inheritedLinkLines: Map<string, number>
}

const diskOutputStateSlot = new RootSessionSlot<HostDiskOutputState>(() => ({
  taskOutputDir: undefined,
  diskOutputs: new Map(),
  outputPathBindings: new Map(),
  pendingOutputOps: new Set(),
  linkedOutputs: new Map(),
  linksInheritedBefore: PROCESS_START_MS,
  inheritedLinkLines: new Map(),
}))

const fallbackDiskOutputSession: { readonly root: object } = {
  get root() {
    return fallbackDiskOutputSession
  },
}

function getHostDiskOutputState(): HostDiskOutputState {
  try {
    const session = getBootstrapSession()
    if (
      session !== null &&
      typeof session === 'object' &&
      session.root !== null &&
      typeof session.root === 'object'
    ) {
      return diskOutputStateSlot.of(session)
    }
  } catch {
    // Fall back when sessionHost is partially mocked in tests
  }
  return diskOutputStateSlot.of(fallbackDiskOutputSession)
}

function getTaskOutputDirForState(state: HostDiskOutputState): string {
  if (state.taskOutputDir === undefined) {
    state.taskOutputDir = join(getProjectTempDir(), getSessionId(), 'tasks')
  }
  return state.taskOutputDir
}

export function getTaskOutputDir(): string {
  return getTaskOutputDirForState(getHostDiskOutputState())
}

export function inheritPredecessorTaskOutputLinks(
  dir: string,
  cutoffMs: number,
): void {
  if (!Number.isFinite(cutoffMs)) return
  getHostDiskOutputState().inheritedLinkLines.set(
    dir,
    Math.max(PROCESS_START_MS, Math.min(Date.now(), cutoffMs)),
  )
}

function getLinksInheritedBeforeForState(
  state: HostDiskOutputState,
  dir: string,
): number {
  return Math.max(
    state.linksInheritedBefore,
    state.inheritedLinkLines.get(dir) ?? 0,
  )
}

export function getLinksInheritedBeforeFor(dir: string): number {
  return getLinksInheritedBeforeForState(getHostDiskOutputState(), dir)
}

/** Test helper — override the pre-session inheritance cutoff timestamp. */
export function _setLinksInheritedBeforeForTest(cutoffMs?: number): void {
  const state = getHostDiskOutputState()
  state.linksInheritedBefore = cutoffMs ?? PROCESS_START_MS
  state.inheritedLinkLines.clear()
}

/** Test helper — clears the memoized dir and symlink registration state. */
export function _resetTaskOutputDirForTest(): void {
  const state = getHostDiskOutputState()
  state.taskOutputDir = undefined
  state.linkedOutputs.clear()
  state.outputPathBindings.clear()
  state.linksInheritedBefore = PROCESS_START_MS
  state.inheritedLinkLines.clear()
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

function getTaskOutputRootDirNormalized(
  state: HostDiskOutputState = getHostDiskOutputState(),
): string {
  return dirname(dirname(dirname(resolve(getTaskOutputDirForState(state)))))
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
function canonicalizeTaskOutputPath(
  filePath: string,
  state: HostDiskOutputState = getHostDiskOutputState(),
): string {
  const root = getTaskOutputRootDirNormalized(state)
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

function isTaskOutputFilePathForState(
  filePath: string,
  state: HostDiskOutputState,
): boolean {
  const root = getTaskOutputRootDirNormalized(state)
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

/**
 * Official 2.1.331 `f6t` (`isTaskOutputFilePath`) — true when any spelling of
 * `filePath` sits directly inside `<taskOutputRoot>/<project>/<sessionId>/tasks/`.
 */
export function isTaskOutputFilePath(filePath: string): boolean {
  return isTaskOutputFilePathForState(filePath, getHostDiskOutputState())
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

async function recordTargetIdentity(
  targetPath: string,
  state: HostDiskOutputState,
): Promise<void> {
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
    state.outputPathBindings.set(targetPath, { dev: st.dev, ino: st.ino })
  } finally {
    await fh.close()
  }
}

async function registerLinkedOutput(
  linkPath: string,
  targetPath: string,
  state: HostDiskOutputState,
): Promise<void> {
  if (isUnderTaskOutputRoot(targetPath)) {
    await recordTargetIdentity(targetPath, state)
  }
  state.linkedOutputs.set(
    canonicalizeTaskOutputPath(linkPath, state),
    targetPath,
  )
}

function getRecordedTargetIdentity(
  targetPath: string,
  state: HostDiskOutputState,
): {
  dev: number | bigint
  ino: number | bigint
} {
  const id = state.outputPathBindings.get(targetPath)
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
  state: HostDiskOutputState,
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
    st.ctimeMs >=
      getLinksInheritedBeforeForState(state, dirname(canonicalLinkPath))
  ) {
    throw new TaskOutputSwapRefusedError(
      canonicalLinkPath,
      'output is an unregistered symlink made during this session',
    )
  }
  await registerLinkedOutput(canonicalLinkPath, rawTarget, state)
  return rawTarget
}

/** Official 2.1.331 `tt(e, n)` — verify symlink against `linkedOutputs` allowlist or pre-session bound. */
async function resolveAuthorizedOutputSymlink(
  linkPath: string,
  ioPath: string,
  state: HostDiskOutputState,
): Promise<string | null> {
  const canonical = canonicalizeTaskOutputPath(linkPath, state)
  let expected = state.linkedOutputs.get(canonical)
  if (expected === undefined) {
    if (!isTaskOutputFilePathForState(canonical, state)) {
      throw new TaskOutputSwapRefusedError(
        canonical,
        'output is an unregistered symlink outside any tasks directory',
      )
    }
    const raw = await readlinkOrNull(ioPath)
    if (raw === null) return null
    expected = await inheritPreSessionOutputSymlink(
      canonical,
      ioPath,
      raw,
      state,
    )
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
  const state = getHostDiskOutputState()
  const taskOutputDir = state.taskOutputDir
  if (taskOutputDir === undefined) return
  let entries: string[]
  try {
    entries = await readdir(taskOutputDir)
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
    const linkPath = canonicalizeTaskOutputPath(
      join(taskOutputDir, name),
      state,
    )
    let expected = state.linkedOutputs.get(linkPath)
    try {
      if (expected === undefined) {
        const raw = await readlinkOrNull(linkPath)
        if (raw === null) continue
        expected = await inheritPreSessionOutputSymlink(
          linkPath,
          linkPath,
          raw,
          state,
        )
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
      await pinWriteTarget(taskOutputDir)
      await unlink(linkPath)
      if (state.linkedOutputs.get(linkPath) === expected) {
        await registerLinkedOutput(linkPath, next, state)
      }
      try {
        await symlink(next, linkPath).catch(async e => {
          if (getErrnoCode(e) !== 'EEXIST') throw e
          const nowTarget = await readlinkOrNull(linkPath).catch(() => null)
          if (
            nowTarget !== next &&
            nowTarget !== state.linkedOutputs.get(linkPath)
          ) {
            throw e
          }
        })
      } catch (e) {
        if (state.linkedOutputs.get(linkPath) === next) {
          state.linkedOutputs.delete(linkPath)
        }
        throw e
      }
      if ((await readlinkOrNull(linkPath).catch(() => null)) === next) {
        state.linkedOutputs.set(linkPath, next)
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
async function ensureOutputDir(
  state: HostDiskOutputState = getHostDiskOutputState(),
): Promise<void> {
  if (isDisklessActive()) {
    throw new Error('Task output is not written to disk in a diskless session')
  }
  const dir = getTaskOutputDirForState(state)
  await mkdir(dir, { recursive: true })
  await pinWriteTarget(dir)
}

function getTaskOutputPathForState(
  taskId: string,
  state: HostDiskOutputState,
): string {
  return join(getTaskOutputDirForState(state), `${taskId}.output`)
}

/**
 * Get the output file path for a task
 */
export function getTaskOutputPath(taskId: string): string {
  if (isDisklessActive()) {
    throw new Error('Task output is not written to disk in a diskless session')
  }
  return getTaskOutputPathForState(taskId, getHostDiskOutputState())
}

/** Official 2.1.331 — read refuses unregistered symlinks, chained symlinks, or unix nlink≠1 leaf. */
const TASK_OUTPUT_NOT_REGULAR = 'not a regular nlink-1 file'

async function resolveTaskOutputReadPathWithState(
  path: string,
  depth: number,
  state: HostDiskOutputState,
): Promise<string | null> {
  const canonical = canonicalizeTaskOutputPath(path, state)
  const st = await lstatOrNull(canonical)
  if (st === null) return null

  if (st.isSymbolicLink()) {
    const target = await resolveAuthorizedOutputSymlink(
      canonical,
      canonical,
      state,
    )
    if (target === null) {
      return resolveTaskOutputReadPathWithState(path, depth, state)
    }
    if (isUnderTaskOutputRoot(target)) {
      if (depth > 0) {
        throw new TaskOutputSwapRefusedError(canonical, 'output links chain')
      }
      return resolveTaskOutputReadPathWithState(target, depth + 1, state)
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
 * Official 2.1.331 `resolveTaskOutputReadPath` — validates the leaf against the
 * `linkedOutputs` allowlist + pre-session symlink inheritance bound (`linksInheritedBeforeFor`),
 * refuses unregistered session-created symlinks, symlink chains, symlinks leading
 * back into the tasks tree, non-files, and Unix `nlink !== 1` hardlinks.
 */
export async function resolveTaskOutputReadPath(
  path: string,
  depth = 0,
): Promise<string | null> {
  return resolveTaskOutputReadPathWithState(
    path,
    depth,
    getHostDiskOutputState(),
  )
}

async function openTaskOutputReadWithState(
  path: string,
  depth: number,
  relooked: boolean,
  state: HostDiskOutputState,
): Promise<FileHandle | null> {
  const canonical = canonicalizeTaskOutputPath(path, state)
  const st = await lstatOrNull(canonical)
  if (st === null) {
    return null
  }

  if (st.isSymbolicLink()) {
    const target = await resolveAuthorizedOutputSymlink(
      canonical,
      canonical,
      state,
    )
    if (target === null) {
      if (relooked) {
        throw new TaskOutputSwapRefusedError(
          canonical,
          'output leaf changed during open',
        )
      }
      return openTaskOutputReadWithState(canonical, depth, true, state)
    }
    if (isUnderTaskOutputRoot(target)) {
      if (depth > 0) {
        throw new TaskOutputSwapRefusedError(canonical, 'output links chain')
      }
      return openTaskOutputReadWithState(target, depth + 1, false, state)
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
          depth > 0 ? getRecordedTargetIdentity(canonical, state) : undefined,
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
 * Official 2.1.331 `$Xe` (`openTaskOutputRead` / `openTaskOutputForRead`):
 * Validates leaf + authorized symlink allowlist, opens with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`
 * (Windows `"r"`), and verifies handle identity via `vt`. Caller must close.
 */
export async function openTaskOutputRead(
  path: string,
  depth = 0,
  relooked = false,
): Promise<FileHandle | null> {
  return openTaskOutputReadWithState(
    path,
    depth,
    relooked,
    getHostDiskOutputState(),
  )
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
  const state = getHostDiskOutputState()
  const canonical = canonicalizeTaskOutputPath(filePath, state)
  const handle = await openTaskOutputReadWithState(canonical, 0, false, state)
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

async function openTaskOutputForAppendWithState(
  filePath: string,
  opts: {
    exclusive?: boolean
    windowsFlags?: string
    retried?: boolean
    relooked?: boolean
  },
  depth: number,
  state: HostDiskOutputState,
): Promise<FileHandle> {
  if (isDisklessActive()) {
    throw new Error('Task output is not written to disk in a diskless session')
  }
  const canonical = isTaskOutputFilePathForState(filePath, state)
    ? canonicalizeTaskOutputPath(filePath, state)
    : filePath
  const parentDir = dirname(canonical)

  if (process.platform === 'win32') {
    await mkdir(parentDir, { recursive: true })
    return open(canonical, opts.windowsFlags ?? 'a')
  }

  if (
    foldCaseForPlatform(resolve(parentDir)) ===
    foldCaseForPlatform(resolve(getTaskOutputDirForState(state)))
  ) {
    await ensureOutputDir(state)
  } else {
    await mkdir(parentDir, { recursive: true })
    const parentStat = await lstat(parentDir)
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
      throwTasksDirMovedOrLinked(parentDir)
    }
  }

  const existing = await lstatOrNull(canonical)
  if (existing?.isSymbolicLink()) {
    const target = await resolveAuthorizedOutputSymlink(
      canonical,
      canonical,
      state,
    )
    if (target === null) {
      if (opts.relooked) {
        throw new TaskOutputSwapRefusedError(
          canonical,
          'output leaf changed during open',
        )
      }
      return openTaskOutputForAppendWithState(
        canonical,
        { ...opts, relooked: true },
        depth,
        state,
      )
    }
    if (opts.exclusive || depth > 0 || !isUnderTaskOutputRoot(target)) {
      throw new TaskOutputSwapRefusedError(
        canonical,
        'output link is not appendable',
      )
    }
    return openTaskOutputForAppendWithState(
      target,
      { exclusive: opts.exclusive, windowsFlags: opts.windowsFlags },
      depth + 1,
      state,
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
      return openTaskOutputForAppendWithState(
        canonical,
        { ...opts, retried: true },
        depth,
        state,
      )
    }
    throw wrapSwapOpenError(e, canonical)
  }

  try {
    if (depth > 0 && existing === null) {
      const st = await fh.stat()
      state.outputPathBindings.set(canonical, { dev: st.dev, ino: st.ino })
    }
    await vt(fh, existing, canonical, {
      registeredIdentity:
        depth > 0 ? getRecordedTargetIdentity(canonical, state) : undefined,
    })
  } catch (e) {
    await fh.close().catch(() => {})
    throw e
  }
  return fh
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
  return openTaskOutputForAppendWithState(
    filePath,
    opts,
    depth,
    getHostDiskOutputState(),
  )
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
// evictTaskOutput, #drain) per SessionHost so tests can drain before teardown.
// Prevents the async-ENOENT-after-teardown flake class (#24957, #25065): a
// voided async resumes after preload's afterEach nuked the temp dir → ENOENT →
// unhandled rejection → flaky test failure. allSettled so a rejection doesn't
// short-circuit the drain and leave other ops racing the rmSync.
function track<T>(
  p: Promise<T>,
  state: HostDiskOutputState = getHostDiskOutputState(),
): Promise<T> {
  state.pendingOutputOps.add(p)
  void p.finally(() => state.pendingOutputOps.delete(p)).catch(() => {})
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
  #hostState: HostDiskOutputState
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
    this.#hostState = getHostDiskOutputState()
    this.#path =
      outputPath ?? getTaskOutputPathForState(taskId, this.#hostState)
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
      void track(this.#drain(), this.#hostState)
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
          this.#fileHandle = await openTaskOutputForAppendWithState(
            this.#path,
            {},
            0,
            this.#hostState,
          )
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
  const state = getHostDiskOutputState()
  for (const output of state.diskOutputs.values()) {
    output.cancel()
  }
  while (state.pendingOutputOps.size > 0) {
    await Promise.allSettled([...state.pendingOutputOps])
  }
  state.diskOutputs.clear()
}

function getOrCreateOutput(taskId: string): DiskTaskOutput {
  const { diskOutputs } = getHostDiskOutputState()
  let output = diskOutputs.get(taskId)
  if (!output) {
    output = new DiskTaskOutput(taskId)
    diskOutputs.set(taskId, output)
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
  const output = getHostDiskOutputState().diskOutputs.get(taskId)
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
  const state = getHostDiskOutputState()
  return track(
    (async () => {
      const output = state.diskOutputs.get(taskId)
      if (output) {
        await output.flush()
        if (output.failing && output.unwrittenChars > 0) {
          logForDebugging(
            `Task output writer evicted while failing; discarded ${output.unwrittenChars} chars of unwritten output`,
            { level: 'error' },
          )
        }
        state.diskOutputs.delete(taskId)
      }
    })(),
    state,
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
  const state = getHostDiskOutputState()
  const output = state.diskOutputs.get(taskId)
  if (output) {
    output.cancel()
    state.diskOutputs.delete(taskId)
  }

  if (isDisklessActive()) {
    return
  }

  const outputPath = canonicalizeTaskOutputPath(
    getTaskOutputPathForState(taskId, state),
    state,
  )
  const prevTarget = state.linkedOutputs.get(outputPath)
  state.linkedOutputs.delete(outputPath)
  if (prevTarget !== undefined) {
    state.outputPathBindings.delete(prevTarget)
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

function initTaskOutputForState(
  taskId: string,
  state: HostDiskOutputState,
): Promise<string> {
  return track(
    (async () => {
      await ensureOutputDir(state)
      const outputPath = getTaskOutputPathForState(taskId, state)
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
    state,
  )
}

/**
 * Initialize output file for a new task.
 * Creates an empty file to ensure the path exists.
 */
export function initTaskOutput(taskId: string): Promise<string> {
  return initTaskOutputForState(taskId, getHostDiskOutputState())
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
  const state = getHostDiskOutputState()
  return track(
    (async () => {
      try {
        await ensureOutputDir(state)
        const outputPath = canonicalizeTaskOutputPath(
          getTaskOutputPathForState(taskId, state),
          state,
        )

        if (isUnderTaskOutputRoot(targetPath)) {
          await recordTargetIdentity(targetPath, state)
        }
        state.linkedOutputs.set(outputPath, targetPath)
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
          if (state.linkedOutputs.get(outputPath) === targetPath) {
            state.linkedOutputs.delete(outputPath)
          }
          throw err
        }
        if (
          (await readlinkOrNull(outputPath).catch(() => null)) === targetPath
        ) {
          state.linkedOutputs.set(outputPath, targetPath)
        }

        return outputPath
      } catch (error) {
        if (!isTaskOutputSwapRefusal(error)) {
          logError(error)
        }
        return initTaskOutputForState(taskId, state)
      }
    })(),
    state,
  )
}
