/**
 * densable 2.1.251 #6 — read opener `UWt` and write opener `DH`.
 *
 * After the permission check, Read/Write/Edit reopen with O_NOFOLLOW
 * (except Windows). Remaining gold callees: `ao` hop collector, `Ut`,
 * `I`, `aV`. `/proc/self/fd` is a single readlink of the opened fd, not
 * an ancestor walk of that fd path.
 */

import { constants } from 'fs'
import { homedir } from 'os'
import { lstat, mkdir, open, readlink, type FileHandle } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { getErrnoCode } from './errors.js'
import {
  getFsImplementation,
  resolveDeepestExistingAncestorSync,
  safeResolvePath,
} from './fsOperations.js'
import {
  expandPath,
  isNtObjectNamespacePath,
  isUncOrNtObjectPath,
  isWslUncPath,
} from './path.js'
import { getPlatform, type Platform } from './platform.js'

export class SymlinkResolutionChangedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SymlinkResolutionChangedError'
  }
}

/** densable `H` */
export function refusingReadAfterPermissionMessage(filePath: string): string {
  return `Refusing to read ${filePath}: its symlink resolution changed after permission was checked. If a link in the working directory is being rewritten concurrently, stop that and retry.`
}

/**
 * densable `I` @182186847 — DH parent symlink changed after the permission
 * check. Exact gold sentence (no concurrent-retry tail).
 */
export function refusingWriteAfterPermissionMessage(filePath: string): string {
  return `Refusing to write ${filePath}: its parent-directory symlink resolution changed after permission was checked.`
}

/** densable DH `bm` — final component is a symlink. */
export function refusingSymlinkLeafWriteMessage(filePath: string): string {
  return `Refusing to write ${filePath}: it is a symbolic link. Write to the link's target path instead.`
}

/** densable E2t resolution-changed error. */
export function refusingSearchAfterPermissionMessage(filePath: string): string {
  return `Refusing to search ${filePath}: its symlink resolution changed after permission was checked. If a link in the working directory is being rewritten concurrently, stop that and retry.`
}

/** densable E2t PATH-only ripgrep refusal. */
export function refusingPathOnlyRipgrepMessage(filePath: string): string {
  return `Refusing to search ${filePath}: ripgrep was found only by name on PATH, and a search outside the working directory cannot apply your Read deny rules in that configuration. Install ripgrep at an absolute path or search under the working directory.`
}

function readRefusal(filePath: string): SymlinkResolutionChangedError {
  return new SymlinkResolutionChangedError(
    refusingReadAfterPermissionMessage(filePath),
  )
}

/** densable `I` */
function writeRefusal(filePath: string): SymlinkResolutionChangedError {
  return new SymlinkResolutionChangedError(
    refusingWriteAfterPermissionMessage(filePath),
  )
}

export function pathAncestors(filePath: string): string[] {
  const out: string[] = []
  let cur = filePath
  for (;;) {
    out.push(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out
}

export function pathIsApproved(
  approved: ReadonlySet<string>,
  filePath: string,
): boolean {
  if (approved.has(filePath) || approved.has(filePath.normalize('NFC'))) {
    return true
  }
  try {
    return approved.has(resolve(filePath))
  } catch {
    return false
  }
}

const pendingApproval = new Map<string, Set<string>>()

/** Call from checkPermissions so call() can see the pre-open snapshot. */
export function noteApprovedFileToolPath(filePath: string): void {
  const absolute = expandPath(filePath)
  pendingApproval.set(absolute, approvedPathSetFor(absolute))
}

/** Snapshot from checkPermissions, or a fresh set when call() runs alone. */
export function takeApprovedFileToolPath(filePath: string): Set<string> {
  const absolute = expandPath(filePath)
  const snap = pendingApproval.get(absolute)
  if (snap) {
    pendingApproval.delete(absolute)
    return snap
  }
  return approvedPathSetFor(absolute)
}

export function clearApprovedFileToolPathsForTests(): void {
  pendingApproval.clear()
}

/** densable `jn(t)&&!Ds(t)||yr(t)` — UNC (not WSL) or NT-object. */
function isUncNtOrAutomount(filePath: string): boolean {
  return (
    (isUncOrNtObjectPath(filePath) && !isWslUncPath(filePath)) ||
    isNtObjectNamespacePath(filePath)
  )
}

/**
 * densable `tt` — Windows network UNC, or NT-object on any platform.
 * `return e==="windows"&&jn(t)&&!Ds(t)||yr(t)`
 */
function isNetworkSpecialPath(filePath: string, platform: Platform): boolean {
  return (
    (platform === 'windows' &&
      isUncOrNtObjectPath(filePath) &&
      !isWslUncPath(filePath)) ||
    isNtObjectNamespacePath(filePath)
  )
}

const PROC_FD_LEAF =
  /^(?:\/dev\/(?:stdin|stdout|stderr|fd\/\d+)|\/proc\/self\/fd\/\d+)$/

/**
 * densable `Ut` @182184813 — /proc/self/fd and /proc/<pid>/fd leaf paths.
 * Detector only; no ancestor walk.
 */
export function isProcFdPath(filePath: string): boolean {
  return (
    PROC_FD_LEAF.test(filePath) ||
    (/^\/proc\/\d+\/fd\/\d+$/.test(filePath) &&
      filePath.startsWith(`/proc/${process.pid}/fd/`))
  )
}

/**
 * densable `ao` @179108467 — symlink-hop collector of the user path (cap 64).
 * Never walks parents of `/proc/self/fd/${fd}`. `Yg` collapsed-landing is
 * ABSENT in 251 gold; hop loop + `Qx` + `Jo` remain.
 */
export function collectSymlinkHops(filePath: string): string[] {
  let t = filePath
  if (t === '~') t = homedir().normalize('NFC')
  else if (t.startsWith('~/')) {
    t = join(homedir().normalize('NFC'), t.slice(2))
  }
  const hops = new Set<string>()
  const fsImpl = getFsImplementation()
  hops.add(t)
  if (isUncNtOrAutomount(t)) return Array.from(hops)
  try {
    let current = t
    const visited = new Set<string>()
    const cap = 64
    for (let p = 0; p < cap; p++) {
      if (visited.has(current)) break
      visited.add(current)
      let target: string | undefined
      let code: string | undefined
      try {
        target = fsImpl.readlinkSync(current)
      } catch (err) {
        code = getErrnoCode(err)
      }
      if (target === undefined) {
        if (code === 'ENOENT') {
          if (current === t) {
            const collapsed = resolveDeepestExistingAncestorSync(fsImpl, t)
            if (collapsed !== undefined) hops.add(collapsed)
          }
        }
        break
      }
      const next = isAbsolute(target)
        ? target
        : resolve(dirname(current), target)
      hops.add(next)
      if (isUncNtOrAutomount(next)) return Array.from(hops)
      current = next
    }
  } catch {
    // hop walk is best-effort; Jo below still records the resolved leaf
  }
  const { resolvedPath, isSymlink } = safeResolvePath(fsImpl, t)
  if (isSymlink && resolvedPath !== t) hops.add(resolvedPath)
  return Array.from(hops)
}

/** Paths permission checked for `filePath` — densable `ao` hops. */
export function approvedPathSetFor(filePath: string): Set<string> {
  return new Set(collectSymlinkHops(filePath))
}

/** densable UWt flags: O_NOFOLLOW except Windows. */
export function readOpenFlags(platform: Platform): number {
  const base =
    platform === 'windows'
      ? constants.O_RDONLY
      : constants.O_RDONLY | (constants.O_NOCTTY ?? 0)
  if (platform === 'windows') return base
  return base | (constants.O_NOFOLLOW ?? 0)
}

/** densable `It` @182184813 cluster — macos open-symlink bit. */
const MACOS_O_SYMLINK = 536870912
/** densable `Yt` — linux/wsl O_PATH. */
const LINUX_O_PATH = 2097152

/**
 * densable `aV` @182184937 — macos swaps O_NOFOLLOW for O_SYMLINK; EINVAL
 * falls back to the original flags.
 */
async function openMaybeFollow(
  filePath: string,
  flags: number,
  platform: Platform,
): Promise<FileHandle> {
  if (platform !== 'macos') return open(filePath, flags)
  try {
    return await open(
      filePath,
      (flags & ~(constants.O_NOFOLLOW ?? 0)) | MACOS_O_SYMLINK,
    )
  } catch (err) {
    if (getErrnoCode(err) === 'EINVAL') return open(filePath, flags)
    throw err
  }
}

/**
 * densable `ht` — abort-racing open. `useMacosSymlink` is gold's `o`.
 */
async function openAbortable(
  filePath: string,
  flags: number,
  platform: Platform,
  useMacosSymlink: boolean,
  signal?: AbortSignal,
): Promise<FileHandle> {
  signal?.throwIfAborted()
  const pending = useMacosSymlink
    ? openMaybeFollow(filePath, flags, platform)
    : open(filePath, flags)
  if (!signal) return pending
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([pending, aborted])
  } catch (err) {
    void pending.then(
      handle => handle.close(),
      () => {},
    )
    throw err
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export type ApprovedRead = {
  ioPath: string
  canonicalPath: string
  handle: FileHandle
  close: () => Promise<void>
}

/**
 * densable `UWt` @182185287 — open `filePath` only if every `ao` hop and the
 * opened inode stay inside `approved`. Single `/proc/self/fd/${fd}` readlink;
 * no ancestor walk of that fd path. `Bt` is ABSENT — the pipe/socket special
 * `a` branch is omitted.
 */
export async function openApprovedRead(
  filePath: string,
  approved: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<ApprovedRead> {
  const hopsOk = new Set(approved)
  for (const hop of collectSymlinkHops(filePath)) {
    if (!hopsOk.has(hop)) throw readRefusal(filePath)
  }
  const platform = getPlatform()
  const withoutNofollow =
    platform === 'windows'
      ? constants.O_RDONLY
      : constants.O_RDONLY | (constants.O_NOCTTY ?? 0)
  const withNofollow =
    platform === 'windows'
      ? withoutNofollow
      : withoutNofollow | (constants.O_NOFOLLOW ?? 0)

  const openLeaf = async (
    openPath: string,
    skipMacosSymlink: boolean,
  ): Promise<ApprovedRead> => {
    if ((await lstat(openPath)).isSymbolicLink()) throw readRefusal(filePath)
    const handle = await openAbortable(
      openPath,
      withNofollow,
      platform,
      !skipMacosSymlink,
      signal,
    )
    if (platform === 'linux' || platform === 'wsl') {
      let procTarget: string | null = null
      try {
        procTarget = await readlink(`/proc/self/fd/${handle.fd}`)
      } catch {
        procTarget = null
      }
      if (
        procTarget !== null &&
        procTarget !== openPath &&
        !hopsOk.has(procTarget)
      ) {
        await handle.close()
        throw readRefusal(filePath)
      }
      if (procTarget !== null) {
        return {
          ioPath: `/proc/${process.pid}/fd/${handle.fd}`,
          canonicalPath: openPath,
          handle,
          close: () => handle.close(),
        }
      }
    }
    return {
      ioPath: openPath,
      canonicalPath: openPath,
      handle,
      close: () => handle.close(),
    }
  }

  if (isNetworkSpecialPath(filePath, platform)) {
    return openLeaf(filePath, false)
  }

  const resolved = safeResolvePath(getFsImplementation(), filePath)
  if (!resolved.isCanonical) {
    if (resolved.isSymlink || resolved.resolvedPath !== filePath) {
      if (
        hopsOk.has(resolved.resolvedPath) &&
        isNetworkSpecialPath(resolved.resolvedPath, platform)
      ) {
        const opened =
          platform === 'macos'
            ? await openLeaf(resolved.resolvedPath, false)
            : await openLeaf(filePath, true)
        const again = safeResolvePath(getFsImplementation(), filePath)
        if (again.isCanonical || again.resolvedPath !== resolved.resolvedPath) {
          await opened.close()
          throw readRefusal(filePath)
        }
        return opened
      }
      throw readRefusal(filePath)
    }
    const probed = await openAbortable(
      filePath,
      withoutNofollow,
      platform,
      false,
      signal,
    )
    await probed.close()
    throw readRefusal(filePath)
  }
  if (!hopsOk.has(resolved.resolvedPath)) throw readRefusal(filePath)
  const canonical = resolved.resolvedPath
  let handle: FileHandle
  try {
    handle = await openAbortable(
      canonical,
      withNofollow,
      platform,
      true,
      signal,
    )
  } catch (err) {
    if (getErrnoCode(err) === 'ELOOP') throw readRefusal(filePath)
    throw err
  }
  try {
    let ioPath = canonical
    if (platform === 'linux' || platform === 'wsl') {
      let procTarget: string | null = null
      try {
        procTarget = await readlink(`/proc/self/fd/${handle.fd}`)
      } catch {
        procTarget = null
      }
      if (procTarget !== null) {
        if (procTarget !== canonical) throw readRefusal(filePath)
        ioPath = `/proc/${process.pid}/fd/${handle.fd}`
      }
    }
    if (ioPath === canonical) {
      for (const hop of collectSymlinkHops(filePath)) {
        if (!hopsOk.has(hop)) throw readRefusal(filePath)
      }
    }
    return {
      canonicalPath: canonical,
      ioPath,
      handle,
      close: () => handle.close(),
    }
  } catch (err) {
    await handle.close().catch(() => {})
    throw err
  }
}

export type ApprovedWrite = {
  ioPath: string
  canonicalPath: string
  recheckBeforeWrite: () => Promise<void>
  close: () => Promise<void>
}

export type ApprovedWriteOpts = {
  createParents?: boolean
  leaf?: 'replace'
}

/**
 * densable `DH` @182187516 — create parents if asked, refuse a swapped parent
 * symlink (`I`), O_NOFOLLOW while creating children. `for(;;)` walks dirname
 * of the user path, then uses `/proc/self/fd/${fd}` as a stable handle.
 * That is not an ancestor walk of the fd path. `Z`/`e6` ABSENT — no
 * `readExisting`, mkdir errors rethrow.
 */
export async function openApprovedWrite(
  filePath: string,
  approved: ReadonlySet<string>,
  opts?: ApprovedWriteOpts,
): Promise<ApprovedWrite> {
  const hopsOk = new Set(approved)
  const leaf = basename(filePath)
  const platform = getPlatform()

  const recheck = (): void => {
    const hops =
      opts?.leaf === 'replace'
        ? collectSymlinkHops(dirname(filePath)).map(p => join(p, leaf))
        : collectSymlinkHops(filePath)
    for (const hop of hops) {
      if (!hopsOk.has(hop)) throw writeRefusal(filePath)
    }
  }
  recheck()

  const parentApproved = (dir: string): boolean => hopsOk.has(join(dir, leaf))
  const requireCanonical = (dir: string): string => {
    const got = safeResolvePath(getFsImplementation(), dir)
    if (!got.isCanonical) throw writeRefusal(filePath)
    return got.resolvedPath
  }
  const canonicalOrSelf = (dir: string): string => {
    const got = safeResolvePath(getFsImplementation(), dir)
    return got.isCanonical ? got.resolvedPath : dir
  }

  if (
    isNetworkSpecialPath(filePath, platform) &&
    platform !== 'linux' &&
    platform !== 'wsl'
  ) {
    const assertParentOpenable = async (start: string): Promise<void> => {
      if (platform !== 'macos') return
      for (let cur = start; ; cur = dirname(cur)) {
        try {
          await (
            await openMaybeFollow(
              cur,
              constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
              platform,
            )
          ).close()
          return
        } catch (err) {
          const code = getErrnoCode(err)
          if (code === 'ELOOP') throw writeRefusal(filePath)
          if (code !== 'ENOENT' || dirname(cur) === cur) throw err
        }
      }
    }
    await assertParentOpenable(dirname(filePath))
    if (opts?.createParents) {
      await getFsImplementation().mkdir(dirname(filePath))
      await assertParentOpenable(dirname(filePath))
    }
    const recheckBeforeWrite = async (): Promise<void> => {
      recheck()
      if (platform !== 'macos') return
      try {
        await (
          await openMaybeFollow(
            dirname(filePath),
            constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
            platform,
          )
        ).close()
      } catch (err) {
        throw getErrnoCode(err) === 'ELOOP' ? writeRefusal(filePath) : err
      }
    }
    return {
      ioPath: filePath,
      canonicalPath: filePath,
      recheckBeforeWrite,
      close: async () => {},
    }
  }

  const openViaPath = async (): Promise<ApprovedWrite> => {
    if (opts?.createParents) {
      await getFsImplementation().mkdir(dirname(filePath))
      recheck()
    }
    const parent = safeResolvePath(getFsImplementation(), dirname(filePath))
    if (
      !parent.isCanonical &&
      !(
        parent.isSymlink &&
        parentApproved(parent.resolvedPath) &&
        isNetworkSpecialPath(join(parent.resolvedPath, leaf), platform)
      )
    ) {
      if (!parent.isSymlink) await lstat(dirname(filePath))
      throw writeRefusal(filePath)
    }
    const resolvedParent = parent.resolvedPath
    if (!parentApproved(resolvedParent)) throw writeRefusal(filePath)
    return {
      ioPath: filePath,
      canonicalPath: join(resolvedParent, leaf),
      recheckBeforeWrite: async () => {
        recheck()
      },
      close: async () => {},
    }
  }

  if (platform === 'windows') return openViaPath()

  const dirFlags =
    platform === 'linux' || platform === 'wsl'
      ? LINUX_O_PATH | (constants.O_DIRECTORY ?? 0)
      : constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
  let cursor = dirname(filePath)
  const missing: string[] = []
  let dirHandle: FileHandle
  let openAt = ''
  for (;;) {
    try {
      openAt = platform === 'macos' ? canonicalOrSelf(cursor) : cursor
      dirHandle = await openMaybeFollow(openAt, dirFlags, platform)
      break
    } catch (err) {
      const code = getErrnoCode(err)
      const parent = dirname(cursor)
      const macosFollowedLink =
        code === 'ELOOP' &&
        platform === 'macos' &&
        openAt === cursor &&
        !safeResolvePath(getFsImplementation(), cursor).isCanonical
      if (code === 'ELOOP' && !macosFollowedLink) {
        const fileParent = safeResolvePath(
          getFsImplementation(),
          dirname(filePath),
        )
        if (
          !fileParent.isCanonical &&
          fileParent.isSymlink &&
          parentApproved(fileParent.resolvedPath) &&
          isNetworkSpecialPath(join(fileParent.resolvedPath, leaf), platform)
        ) {
          return openViaPath()
        }
        throw writeRefusal(filePath)
      }
      if (macosFollowedLink && !opts?.createParents) {
        const chain = [basename(cursor)]
        for (let cur = parent; ; cur = dirname(cur)) {
          const got = safeResolvePath(getFsImplementation(), cur)
          if (got.isCanonical) {
            await lstat(join(got.resolvedPath, chain[0]!))
            break
          }
          if (dirname(cur) === cur) break
          chain.unshift(basename(cur))
        }
        throw writeRefusal(filePath)
      }
      if (
        (code === 'ENOENT' || macosFollowedLink) &&
        opts?.createParents &&
        parent !== cursor
      ) {
        missing.unshift(basename(cursor))
        cursor = parent
        continue
      }
      throw err
    }
  }

  try {
    let viaProc = false
    const dirOf = async (
      handle: FileHandle,
      pathForJo: string,
    ): Promise<string> => {
      if (platform === 'linux' || platform === 'wsl') {
        try {
          const target = await readlink(`/proc/self/fd/${handle.fd}`)
          viaProc = true
          return target
        } catch {
          // fall through to Jo
        }
      }
      return requireCanonical(pathForJo)
    }
    let resolvedDir = await dirOf(dirHandle, cursor)
    const landing = join(resolvedDir, ...missing)
    if (!parentApproved(landing)) {
      if (missing.length === 0) {
        const leafPath = join(
          viaProc ? `/proc/self/fd/${dirHandle.fd}` : resolvedDir,
          leaf,
        )
        const isLink = await lstat(leafPath).then(
          st => st.isSymbolicLink(),
          () => false,
        )
        if (isLink) {
          throw new SymlinkResolutionChangedError(
            refusingSymlinkLeafWriteMessage(filePath),
          )
        }
      }
      throw writeRefusal(filePath)
    }
    for (const segment of missing) {
      const from = viaProc ? `/proc/self/fd/${dirHandle.fd}` : resolvedDir
      let mkdirErr: unknown = null
      try {
        await mkdir(join(from, segment))
      } catch (err) {
        mkdirErr = err
        if (getErrnoCode(err) !== 'EEXIST') throw err
      }
      let child: FileHandle
      try {
        child = await openMaybeFollow(
          join(from, segment),
          dirFlags | (constants.O_NOFOLLOW ?? 0),
          platform,
        )
      } catch (err) {
        const code = getErrnoCode(err)
        if (code === 'ELOOP' || code === 'ENOTDIR') throw writeRefusal(filePath)
        throw code === 'ENOENT' && mkdirErr !== null ? mkdirErr : err
      }
      await dirHandle.close()
      dirHandle = child
      const expected = join(resolvedDir, segment)
      resolvedDir = await dirOf(dirHandle, expected)
      if (resolvedDir !== expected) throw writeRefusal(filePath)
    }
    if (!viaProc) {
      recheck()
      const held = dirHandle
      const ioPath = join(landing, leaf)
      return {
        ioPath,
        canonicalPath: ioPath,
        recheckBeforeWrite: async () => {
          recheck()
        },
        close: () => held.close(),
      }
    }
    const held = dirHandle
    return {
      ioPath: `/proc/self/fd/${held.fd}/${leaf}`,
      canonicalPath: join(landing, leaf),
      recheckBeforeWrite: async () => {},
      close: () => held.close(),
    }
  } catch (err) {
    await dirHandle.close().catch(() => {})
    throw err
  }
}
