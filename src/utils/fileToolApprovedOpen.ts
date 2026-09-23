/**
 * densable 2.1.251 #6 — read opener `UWt` and write opener `DH`.
 *
 * After the permission check, Read/Write/Edit reopen with O_NOFOLLOW
 * (except Windows) and refuse when ancestors or the opened inode's
 * resolution are no longer in the approved path set. H/I messages match
 * the gold cluster; the write leaf-symlink sentence is the `bm` string
 * inside DH.
 */

import { constants } from 'fs'
import { lstatSync, realpathSync } from 'fs'
import { lstat, mkdir, open, realpath, type FileHandle } from 'fs/promises'
import { basename, dirname, resolve } from 'path'
import { isENOENT } from './errors.js'
import { getPathsForPermissionCheck } from './fsOperations.js'
import { expandPath } from './path.js'
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
 * densable `I` — DH throws `I(t)` when a parent symlink changed after the
 * permission check. The sentence is the write-side twin of `H` (E2t uses
 * the same sentence with "search").
 */
export function refusingWriteAfterPermissionMessage(filePath: string): string {
  return `Refusing to write ${filePath}: its symlink resolution changed after permission was checked. If a link in the working directory is being rewritten concurrently, stop that and retry.`
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

function remember(set: Set<string>, filePath: string): void {
  set.add(filePath)
  set.add(filePath.normalize('NFC'))
  try {
    set.add(resolve(filePath))
  } catch {
    // unresolvable path string — the raw form is already recorded
  }
}

function addAncestorClosure(set: Set<string>, filePath: string): void {
  for (const ancestor of pathAncestors(filePath)) {
    remember(set, ancestor)
    try {
      const st = lstatSync(ancestor)
      if (!st.isSymbolicLink()) continue
      const target = realpathSync(ancestor)
      remember(set, target)
      for (const targetAncestor of pathAncestors(target)) {
        remember(set, targetAncestor)
      }
    } catch {
      // missing component — lexical ancestor is enough until it exists
    }
  }
  try {
    const real = realpathSync(filePath)
    remember(set, real)
    for (const ancestor of pathAncestors(real)) remember(set, ancestor)
  } catch {
    // ENOENT / ELOOP — permission snapshot keeps the lexical path
  }
}

/** Paths permission checked for `filePath`, including ancestors and resolution. */
export function approvedPathSetFor(filePath: string): Set<string> {
  const absolute = expandPath(filePath)
  const set = new Set<string>()
  addAncestorClosure(set, absolute)
  for (const extra of getPathsForPermissionCheck(absolute)) {
    addAncestorClosure(set, extra)
  }
  return set
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

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
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

export type ApprovedRead = {
  ioPath: string
  canonicalPath: string
  handle: FileHandle
  close: () => Promise<void>
}

/**
 * densable `UWt` — open `filePath` only if every ancestor and the resolved
 * inode stay inside `approved`.
 */
export async function openApprovedRead(
  filePath: string,
  approved: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<ApprovedRead> {
  signal?.throwIfAborted()
  const absolute = expandPath(filePath)
  for (const ancestor of pathAncestors(absolute)) {
    if (!pathIsApproved(approved, ancestor)) throw readRefusal(absolute)
  }

  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(absolute)
  } catch (err) {
    if (isENOENT(err) || errnoCode(err) === 'ENOENT') throw err
    throw err
  }

  let canonical = absolute
  if (info.isSymbolicLink()) {
    try {
      canonical = await realpath(absolute)
    } catch (err) {
      if (isENOENT(err) || errnoCode(err) === 'ENOENT') throw err
      throw readRefusal(absolute)
    }
  } else {
    try {
      canonical = await realpath(absolute)
    } catch (err) {
      if (isENOENT(err) || errnoCode(err) === 'ENOENT') throw err
      throw readRefusal(absolute)
    }
  }

  if (!pathIsApproved(approved, canonical)) throw readRefusal(absolute)
  for (const ancestor of pathAncestors(canonical)) {
    if (!pathIsApproved(approved, ancestor)) throw readRefusal(absolute)
  }

  const platform = getPlatform()
  let handle: FileHandle
  try {
    handle = await open(canonical, readOpenFlags(platform))
  } catch (err) {
    if (errnoCode(err) === 'ELOOP') throw readRefusal(absolute)
    throw err
  }

  try {
    signal?.throwIfAborted()
    if (platform === 'linux' || platform === 'wsl') {
      let procTarget: string | null = null
      try {
        procTarget = await realpath(`/proc/self/fd/${handle.fd}`)
      } catch {
        procTarget = null
      }
      if (procTarget !== null) {
        if (procTarget !== canonical && !pathIsApproved(approved, procTarget)) {
          throw readRefusal(absolute)
        }
        if (!pathIsApproved(approved, procTarget)) {
          throw readRefusal(absolute)
        }
        const fdPath = `/proc/${process.pid}/fd/${handle.fd}`
        return {
          ioPath: fdPath,
          canonicalPath: canonical,
          handle,
          close: async () => {
            await handle.close()
          },
        }
      }
    }

    for (const ancestor of pathAncestors(absolute)) {
      if (!pathIsApproved(approved, ancestor)) throw readRefusal(absolute)
    }
    return {
      ioPath: canonical,
      canonicalPath: canonical,
      handle,
      close: async () => {
        await handle.close()
      },
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

/**
 * densable `DH` — create parents if asked, refuse a swapped parent symlink,
 * and on Linux/WSL expose the directory through /proc/self/fd.
 */
export async function openApprovedWrite(
  filePath: string,
  approved: ReadonlySet<string>,
  opts?: { createParents?: boolean },
): Promise<ApprovedWrite> {
  const absolute = expandPath(filePath)
  const parent = dirname(absolute)
  const leaf = basename(absolute)
  const platform = getPlatform()

  const recheckBeforeWrite = async (): Promise<void> => {
    for (const ancestor of pathAncestors(absolute)) {
      if (!pathIsApproved(approved, ancestor)) throw writeRefusal(absolute)
    }
    let parentExists = true
    try {
      const parentStat = await lstat(parent)
      if (parentStat.isSymbolicLink()) {
        let resolvedParent: string
        try {
          resolvedParent = await realpath(parent)
        } catch (err) {
          if (isENOENT(err) || errnoCode(err) === 'ENOENT') {
            throw writeRefusal(absolute)
          }
          throw err
        }
        if (!pathIsApproved(approved, resolvedParent)) {
          throw writeRefusal(absolute)
        }
        for (const ancestor of pathAncestors(resolvedParent)) {
          if (!pathIsApproved(approved, ancestor)) throw writeRefusal(absolute)
        }
      }
    } catch (err) {
      if (err instanceof SymlinkResolutionChangedError) throw err
      if (isENOENT(err) || errnoCode(err) === 'ENOENT') parentExists = false
      else throw err
    }
    if (!parentExists) return
    try {
      const leafStat = await lstat(absolute)
      if (leafStat.isSymbolicLink()) {
        throw new SymlinkResolutionChangedError(
          refusingSymlinkLeafWriteMessage(absolute),
        )
      }
    } catch (err) {
      if (err instanceof SymlinkResolutionChangedError) throw err
      if (isENOENT(err) || errnoCode(err) === 'ENOENT') return
      throw err
    }
  }

  await recheckBeforeWrite()
  if (opts?.createParents) {
    await mkdir(parent, { recursive: true })
    await recheckBeforeWrite()
  }

  let dirHandle: FileHandle | null = null
  let ioPath = absolute
  let canonicalPath = absolute

  if (platform !== 'windows') {
    const flags =
      constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0)
    try {
      dirHandle = await open(parent, flags)
    } catch (err) {
      const code = errnoCode(err)
      if (code === 'ELOOP' || code === 'ENOTDIR') throw writeRefusal(absolute)
      if (code !== 'EINVAL' && code !== 'ENOTSUP') throw err
    }
  }

  try {
    if (dirHandle && (platform === 'linux' || platform === 'wsl')) {
      let procDir: string | null = null
      try {
        procDir = await realpath(`/proc/self/fd/${dirHandle.fd}`)
      } catch {
        procDir = null
      }
      if (procDir !== null) {
        if (!pathIsApproved(approved, procDir)) throw writeRefusal(absolute)
        ioPath = `/proc/self/fd/${dirHandle.fd}/${leaf}`
        canonicalPath = resolve(procDir, leaf)
      }
    }
  } catch (err) {
    await dirHandle?.close().catch(() => {})
    throw err
  }

  return {
    ioPath,
    canonicalPath,
    recheckBeforeWrite,
    close: async () => {
      await dirHandle?.close()
    },
  }
}
