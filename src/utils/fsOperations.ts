import * as fs from 'fs'
import {
  mkdir as mkdirPromise,
  open,
  readdir as readdirPromise,
  readFile as readFilePromise,
  rename as renamePromise,
  rmdir as rmdirPromise,
  rm as rmPromise,
  stat as statPromise,
  unlink as unlinkPromise,
} from 'fs/promises'
import { homedir } from 'os'
import * as nodePath from 'path'
import { getErrnoCode } from './errors.js'
import { getPlatform } from './platform.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'
import { slowLogging } from './slowOperations.js'

/**
 * densable APn / realpathSync.native — expand Windows 8.3 short names so
 * permission checks and suspicious-pattern gates see consistent long paths.
 * Plain realpathSync on win32 often returns ADMINI~1 while other APIs return
 * Administrator; native aligns them for symmetric working-dir containment.
 */
export function realpathSyncCanonical(path: string): string {
  const platform = getPlatform()
  if (platform === 'windows' || platform === 'wsl') {
    const native = (
      fs.realpathSync as typeof fs.realpathSync & {
        native?: (p: string) => string
      }
    ).native
    if (native) {
      try {
        return native(path).normalize('NFC')
      } catch {
        // fall through to plain realpathSync
      }
    }
  }
  return fs.realpathSync(path).normalize('NFC')
}

/**
 * Simplified filesystem operations interface based on Node.js fs module.
 * Provides a subset of commonly used sync operations with type safety.
 * Allows abstraction for alternative implementations (e.g., mock, virtual).
 */
export type FsOperations = {
  // File access and information operations
  /** Gets the current working directory */
  cwd(): string
  /** Checks if a file or directory exists */
  existsSync(path: string): boolean
  /** Gets file stats asynchronously */
  stat(path: string): Promise<fs.Stats>
  /** Lists directory contents with file type information asynchronously */
  readdir(path: string): Promise<fs.Dirent[]>
  /** Deletes file asynchronously */
  unlink(path: string): Promise<void>
  /** Removes an empty directory asynchronously */
  rmdir(path: string): Promise<void>
  /** Removes files and directories asynchronously (with recursive option) */
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>
  /** Creates directory recursively asynchronously. */
  mkdir(path: string, options?: { mode?: number }): Promise<void>
  /** Reads file content as string asynchronously */
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>
  /** Renames/moves file asynchronously */
  rename(oldPath: string, newPath: string): Promise<void>
  /** Gets file stats */
  statSync(path: string): fs.Stats
  /** Gets file stats without following symlinks */
  lstatSync(path: string): fs.Stats

  // File content operations
  /** Reads file content as string with specified encoding */
  readFileSync(
    path: string,
    options: {
      encoding: BufferEncoding
    },
  ): string
  /** Reads raw file bytes as Buffer */
  readFileBytesSync(path: string): Buffer
  /** Reads specified number of bytes from file start */
  readSync(
    path: string,
    options: {
      length: number
    },
  ): {
    buffer: Buffer
    bytesRead: number
  }
  /** Appends string to file */
  appendFileSync(path: string, data: string, options?: { mode?: number }): void
  /** Copies file from source to destination */
  copyFileSync(src: string, dest: string): void
  /** Deletes file */
  unlinkSync(path: string): void
  /** Renames/moves file */
  renameSync(oldPath: string, newPath: string): void
  /** Creates hard link */
  linkSync(target: string, path: string): void
  /** Creates symbolic link */
  symlinkSync(
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ): void
  /** Reads symbolic link */
  readlinkSync(path: string): string
  /** Resolves symbolic links and returns the canonical pathname */
  realpathSync(path: string): string

  // Directory operations
  /** Creates directory recursively. Mode defaults to 0o777 & ~umask if not specified. */
  mkdirSync(
    path: string,
    options?: {
      mode?: number
    },
  ): void
  /** Lists directory contents with file type information */
  readdirSync(path: string): fs.Dirent[]
  /** Lists directory contents as strings */
  readdirStringSync(path: string): string[]
  /** Checks if the directory is empty */
  isDirEmptySync(path: string): boolean
  /** Removes an empty directory */
  rmdirSync(path: string): void
  /** Removes files and directories (with recursive option) */
  rmSync(
    path: string,
    options?: {
      recursive?: boolean
      force?: boolean
    },
  ): void
  /** Create a writable stream for writing data to a file. */
  createWriteStream(path: string): fs.WriteStream
  /** Reads raw file bytes as Buffer asynchronously.
   *  When maxBytes is set, only reads up to that many bytes. */
  readFileBytes(path: string, maxBytes?: number): Promise<Buffer>
}

/**
 * Safely resolves a file path, handling symlinks and errors gracefully.
 *
 * Error handling strategy:
 * - If the file doesn't exist, returns the original path (allows for file creation)
 * - If symlink resolution fails (broken symlink, permission denied, circular links),
 *   returns the original path and marks it as not a symlink
 * - This ensures operations can continue with the original path rather than failing
 *
 * @param fs The filesystem implementation to use
 * @param filePath The path to resolve
 * @returns Object containing the resolved path and whether it was a symlink
 */
/**
 * densable `qvl` — refuse non-files and oversize paths before a full read.
 * Throws ErrnoException-shaped errors:
 *   - EISDIR when path is a directory
 *   - ERR_NOT_REGULAR_FILE when path is a device/FIFO/socket/etc.
 *   - ERR_FILE_TOO_LARGE when size > maxBytes (when maxBytes is set)
 */
export function assertRegularFileWithinMaxBytes(
  fs: FsOperations,
  filePath: string,
  maxBytes?: number,
): void {
  const stats = fs.statSync(filePath)
  if (stats.isDirectory()) {
    throw Object.assign(
      new Error('EISDIR: illegal operation on a directory, read'),
      {
        code: 'EISDIR',
        errno: -21,
        syscall: 'read',
        path: filePath,
      },
    )
  }
  if (!stats.isFile()) {
    throw Object.assign(
      new Error('Not a regular file (device, FIFO, or socket)'),
      {
        code: 'ERR_NOT_REGULAR_FILE',
        path: filePath,
      },
    )
  }
  if (maxBytes !== undefined && stats.size > maxBytes) {
    throw Object.assign(new Error('File exceeds maxBytes limit'), {
      code: 'ERR_FILE_TOO_LARGE',
      path: filePath,
      size: stats.size,
      maxBytes,
    })
  }
}

export function safeResolvePath(
  fs: FsOperations,
  filePath: string,
): { resolvedPath: string; isSymlink: boolean; isCanonical: boolean } {
  // Block UNC paths before any filesystem access to prevent network
  // requests (DNS/SMB) during validation on Windows
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }

  try {
    // Check for special file types (FIFOs, sockets, devices) before calling realpathSync.
    // realpathSync can block on FIFOs waiting for a writer, causing hangs.
    // If the file doesn't exist, lstatSync throws ENOENT which the catch
    // below handles by returning the original path (allows file creation).
    const stats = fs.lstatSync(filePath)
    if (
      stats.isFIFO() ||
      stats.isSocket() ||
      stats.isCharacterDevice() ||
      stats.isBlockDevice()
    ) {
      return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
    }

    const resolvedPath = fs.realpathSync(filePath)
    return {
      resolvedPath,
      isSymlink: resolvedPath !== filePath,
      // realpathSync returned: resolvedPath is canonical (all symlinks in
      // all path components resolved). Callers can skip further symlink
      // resolution on this path.
      isCanonical: true,
    }
  } catch (_error) {
    // If lstat/realpath fails for any reason (ENOENT, broken symlink,
    // EACCES, ELOOP, etc.), return the original path to allow operations
    // to proceed
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }
}

/**
 * Check if a file path is a duplicate and should be skipped.
 * Resolves symlinks to detect duplicates pointing to the same file.
 * If not a duplicate, adds the resolved path to loadedPaths.
 *
 * @returns true if the file should be skipped (is duplicate)
 */
export function isDuplicatePath(
  fs: FsOperations,
  filePath: string,
  loadedPaths: Set<string>,
): boolean {
  const { resolvedPath } = safeResolvePath(fs, filePath)
  if (loadedPaths.has(resolvedPath)) {
    return true
  }
  loadedPaths.add(resolvedPath)
  return false
}

/**
 * Official 2.1.327 (#501, SEA `PSo` / `Fe` / `tt`):
 * Detect symbolic link targets whose literal text cannot be safely vetted:
 * - Contains U+FFFD replacement char (non-UTF-8 symlink target)
 * - Points to a UNC / network path (directly or after leading `..` segments)
 * - Points into `/proc/<pid|self>/root|cwd|exe|fd|map_files` or `/dev/fd`
 * - On Windows: drive-relative (`C:foo`), root-relative (`\foo`), non-drive/UNC
 *   device namespace (`\\?\...`), trailing dot/space, or reserved device name.
 */
const WINDOWS_RESERVED_DEVICE_RE =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
export const PROC_OR_DEV_MAGIC_LINK_RE =
  /^\/(?:dev\/fd|proc\/(?:self|thread-self|\d+)(?:\/task\/\d+)?\/(?:root|cwd|exe|fd|map_files))(?:\/|$)/i

function isProcOrDevMagicLinkPath(p: string): boolean {
  const normalized = nodePath.posix.normalize(p.replaceAll('\\', '/'))
  return PROC_OR_DEV_MAGIC_LINK_RE.test(normalized)
}

export function isOpaqueSymlinkTarget(
  target: string,
  isWindows = getPlatform() === 'windows',
): boolean {
  if (target.includes('\uFFFD')) return true
  const strippedLeadingUp = nodePath.isAbsolute(target)
    ? target
    : target.replace(/^(?:\.\.(?:[\\/]|$))+/, '')
  if (
    strippedLeadingUp.startsWith('//') ||
    strippedLeadingUp.startsWith('\\\\')
  ) {
    return true
  }
  if (isProcOrDevMagicLinkPath(target)) {
    return true
  }
  if (isWindows) {
    if (/^(?:[A-Za-z]:(?![\\/])|[\\/](?![\\/]))/.test(target)) return true
    if (
      /^[\\/]{2}\?[\\/]/.test(target) &&
      !/^[\\/]{2}\?[\\/](?:[A-Za-z]:[\\/]|UNC[\\/])/i.test(target)
    ) {
      return true
    }
    const parts = target.split(/[\\/]/)
    if (
      parts.some(
        seg =>
          seg !== '.' &&
          seg !== '..' &&
          (/[. ]$/.test(seg) || WINDOWS_RESERVED_DEVICE_RE.test(seg)),
      )
    ) {
      return true
    }
  }
  return false
}

const MAX_SYMLINK_HOPS = 32
const BINARY_SEARCH_DEPTH_THRESHOLD = 8

/**
 * Resolve the deepest existing ancestor of a path via realpathSync, walking
 * up until it succeeds. Detects dangling symlinks (link entry exists, target
 * doesn't) via lstat and resolves them via readlink.
 *
 * Official 2.1.327 (#489): on deeply nested missing paths on macOS/Linux,
 * uses binary search over path components (`O(log depth)` `lstatSync` calls
 * instead of `O(depth)`) before resolving the deepest existing ancestor.
 */
function resolveSymlinkAncestorWithMetaSync(
  fs: FsOperations,
  dir: string,
  segments: readonly string[],
): { resolved: string | undefined; opaque: boolean } {
  let rawTarget: string
  try {
    rawTarget = fs.readlinkSync(dir)
  } catch {
    return { resolved: undefined, opaque: true }
  }
  // Official 2.1.327 (#501): check raw readlink target BEFORE nodePath.resolve
  // so relative opaque targets like `../../\\server\share` cannot bypass.
  if (isOpaqueSymlinkTarget(rawTarget)) {
    return { resolved: rawTarget, opaque: true }
  }
  try {
    const resolvedDir = fs.realpathSync(dir)
    const resolved =
      segments.length === 0
        ? resolvedDir
        : nodePath.join(resolvedDir, ...segments)
    return { resolved, opaque: isOpaqueSymlinkTarget(resolved) }
  } catch {
    // Dangling symlink: realpath failed but lstat/readlink saw the link entry.
    const absTarget = nodePath.isAbsolute(rawTarget)
      ? rawTarget
      : nodePath.resolve(nodePath.dirname(dir), rawTarget)
    const resolved =
      segments.length === 0 ? absTarget : nodePath.join(absTarget, ...segments)
    return { resolved, opaque: isOpaqueSymlinkTarget(resolved) }
  }
}

function resolveDeepestExistingAncestorWithMetaSync(
  fs: FsOperations,
  absolutePath: string,
): { resolved: string | undefined; opaque: boolean } {
  const normalized = nodePath.normalize(absolutePath)
  // Fast binary-search path for deeply nested missing paths without `..`
  if (
    getPlatform() !== 'windows' &&
    normalized.startsWith('/') &&
    !normalized.includes('/../') &&
    !normalized.endsWith('/..')
  ) {
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length > BINARY_SEARCH_DEPTH_THRESHOLD) {
      // Binary search for the deepest prefix index in [0, parts.length] that
      // does NOT fail with ENOENT/ENOTDIR/ENAMETOOLONG.
      let lo = 0
      let hi = parts.length
      let deepestFound: { prefix: string; stats: fs.Stats } | null = null
      let fellBackToLinear = false
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1
        const candidate = `/${parts.slice(0, mid).join('/')}`
        try {
          const st = fs.lstatSync(candidate)
          lo = mid
          deepestFound = { prefix: candidate, stats: st }
        } catch (err) {
          const code = getErrnoCode(err)
          if (
            code === 'ENOENT' ||
            code === 'ENOTDIR' ||
            code === 'ENAMETOOLONG'
          ) {
            hi = mid - 1
          } else {
            // Non-missing error (e.g. EACCES/ELOOP): fall back to linear walk-up
            // so existing symlink ancestors above this prefix are still resolved.
            fellBackToLinear = true
            break
          }
        }
      }
      if (!fellBackToLinear) {
        if (lo === 0) return { resolved: undefined, opaque: false }
        const dir = `/${parts.slice(0, lo).join('/')}`
        const segments = parts.slice(lo)
        let st = deepestFound?.prefix === dir ? deepestFound.stats : undefined
        if (!st) {
          try {
            st = fs.lstatSync(dir)
          } catch {
            fellBackToLinear = true
          }
        }
        if (!fellBackToLinear && st) {
          if (st.isSymbolicLink()) {
            return resolveSymlinkAncestorWithMetaSync(fs, dir, segments)
          }
          try {
            const resolved = fs.realpathSync(dir)
            if (resolved !== dir) {
              const joined =
                segments.length === 0
                  ? resolved
                  : nodePath.join(resolved, ...segments)
              return { resolved: joined, opaque: isOpaqueSymlinkTarget(joined) }
            }
          } catch {
            // realpath failed (e.g. EACCES in ancestors)
          }
          return { resolved: undefined, opaque: false }
        }
      }
    }
  }

  let dir = absolutePath
  const segments: string[] = []
  // Walk up using lstat (cheap, O(1)) to find the first existing component.
  // lstat does not follow symlinks, so dangling symlinks are detected here.
  // Only call realpathSync (expensive, O(depth)) once at the end.
  while (dir !== nodePath.dirname(dir)) {
    let st: fs.Stats
    try {
      st = fs.lstatSync(dir)
    } catch {
      // lstat failed: non-existent or inaccessible. Walk up.
      segments.unshift(nodePath.basename(dir))
      dir = nodePath.dirname(dir)
      continue
    }
    if (st.isSymbolicLink()) {
      return resolveSymlinkAncestorWithMetaSync(fs, dir, segments)
    }
    // Existing non-symlink component. One realpath call resolves any
    // symlinks in its ancestors. If none, return undefined (no symlink).
    try {
      const resolved = fs.realpathSync(dir)
      if (resolved !== dir) {
        const joined =
          segments.length === 0
            ? resolved
            : nodePath.join(resolved, ...segments)
        return { resolved: joined, opaque: isOpaqueSymlinkTarget(joined) }
      }
    } catch {
      // realpath can still fail (e.g. EACCES in ancestors). Return
      // undefined — we can't resolve, and the logical path is already
      // in pathSet for the caller.
    }
    return { resolved: undefined, opaque: false }
  }
  return { resolved: undefined, opaque: false }
}

export function resolveDeepestExistingAncestorSync(
  fs: FsOperations,
  absolutePath: string,
): string | undefined {
  return resolveDeepestExistingAncestorWithMetaSync(fs, absolutePath).resolved
}

export type PermissionPathWalk = {
  paths: string[]
  unresolved: boolean
}

/**
 * densable `Rt`/`Ba` permission walk. Spellings for deny/ask rules plus
 * `unresolved` when a symlink hop started and the next lstat/readlink threw.
 * Gold `j`: EACCES/EPERM/ENAMETOOLONG **without** a hop is canonicalize, not
 * unresolved. Do not invent gold `opendirNofollow` / Uh / PBt.
 */
export function walkPermissionPaths(inputPath: string): PermissionPathWalk {
  // Expand tilde notation defensively - tools should do this in getPath(),
  // but we normalize here as defense in depth for permission checking
  let path = inputPath
  if (path === '~') {
    path = homedir().normalize('NFC')
  } else if (path.startsWith('~/')) {
    path = nodePath.join(homedir().normalize('NFC'), path.slice(2))
  }

  const pathSet = new Set<string>()
  const fsImpl = getFsImplementation()

  // Always check the original path
  pathSet.add(path)

  // Block UNC paths before any filesystem access to prevent network
  // requests (DNS/SMB) during validation on Windows
  if (path.startsWith('//') || path.startsWith('\\\\')) {
    return { paths: Array.from(pathSet), unresolved: false }
  }

  let hopStarted = false
  let unresolved = false

  // Official 2.1.327 (#501): reject magic /proc or /dev/fd link paths upfront.
  if (isProcOrDevMagicLinkPath(path)) {
    return { paths: Array.from(pathSet), unresolved: true }
  }

  // Follow the symlink chain, collecting ALL intermediate targets
  // This handles cases like: test.txt -> /etc/passwd -> /private/etc/passwd
  // We want to check all three paths, not just test.txt and /private/etc/passwd
  try {
    let currentPath = path
    const visited = new Set<string>()
    let hops = 0

    for (;;) {
      // Prevent infinite loops from circular symlinks
      if (visited.has(currentPath)) {
        break
      }
      visited.add(currentPath)

      let stats: fs.Stats
      try {
        // gold C() lstat/readlink — do not existsSync-skip after a hop:
        // EACCES on the landing is unresolved, ENOENT resolves the deepest
        // existing ancestor on ANY hop so dangling symlinks pointing through
        // directory symlinks or chained dangling symlinks are fully walked.
        stats = fsImpl.lstatSync(currentPath)
      } catch (error) {
        const code = getErrnoCode(error)
        if (code === 'ENOENT') {
          const { resolved, opaque } =
            resolveDeepestExistingAncestorWithMetaSync(fsImpl, currentPath)
          if (opaque) {
            unresolved = true
            break
          }
          if (resolved !== undefined && !visited.has(resolved)) {
            if (isProcOrDevMagicLinkPath(resolved)) {
              unresolved = true
              break
            }
            pathSet.add(resolved)
            hopStarted = true
            hops++
            if (hops > MAX_SYMLINK_HOPS) {
              unresolved = true
              break
            }
            currentPath = resolved
            continue
          }
          break
        }
        throw error
      }

      // Skip special file types that can cause issues
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        break
      }

      if (!stats.isSymbolicLink()) {
        break
      }

      hopStarted = true
      hops++
      // Official 2.1.327 (#501, SEA `C = 32`): refuse symlink chains longer
      // than MAX_SYMLINK_HOPS (32) rather than silently truncating them.
      if (hops > MAX_SYMLINK_HOPS) {
        unresolved = true
        break
      }
      // Get the immediate symlink target
      const target = fsImpl.readlinkSync(currentPath)
      // Official 2.1.327 (#501, SEA `PSo`): refuse opaque/unvettable symlink
      // targets (non-UTF-8 `\uFFFD`, UNC/network targets, `/proc/<pid>/fd`,
      // or Windows drive-relative/reserved targets).
      if (isOpaqueSymlinkTarget(target)) {
        unresolved = true
        break
      }

      // If target is relative, resolve it relative to the symlink's directory
      const absoluteTarget = nodePath.isAbsolute(target)
        ? target
        : nodePath.resolve(nodePath.dirname(currentPath), target)

      if (isProcOrDevMagicLinkPath(absoluteTarget)) {
        unresolved = true
        break
      }

      // Add this intermediate target to the set
      pathSet.add(absoluteTarget)
      currentPath = absoluteTarget
    }
  } catch (error) {
    // gold Rt `k()`: hop+fail → unresolved. No-hop EACCES/EPERM/ENAMETOOLONG
    // is canonicalize (`j`), not Cl.
    const code = getErrnoCode(error)
    const canonicalizeNoHop =
      !hopStarted &&
      (code === 'ENAMETOOLONG' || code === 'EACCES' || code === 'EPERM')
    unresolved = !canonicalizeNoHop
  }

  if (!unresolved) {
    // Also add the final resolved path using realpathSync for completeness
    // This handles any remaining symlinks in directory components
    const { resolvedPath, isSymlink } = safeResolvePath(fsImpl, path)
    if (isSymlink && resolvedPath !== path) {
      pathSet.add(resolvedPath)
    }
  }

  return { paths: Array.from(pathSet), unresolved }
}

/**
 * Gets all paths that should be checked for permissions.
 * This includes the original path, all intermediate symlink targets in the chain,
 * and the final resolved path.
 *
 * For example, if test.txt -> /etc/passwd -> /private/etc/passwd:
 * - test.txt (original path)
 * - /etc/passwd (intermediate symlink target)
 * - /private/etc/passwd (final resolved path)
 *
 * This is important for security: a deny rule for /etc/passwd should block
 * access even if the file is actually at /private/etc/passwd (as on macOS).
 *
 * @param path - The path to check (will be converted to absolute)
 * @returns An array of absolute paths to check permissions for
 */
export function getPathsForPermissionCheck(inputPath: string): string[] {
  return walkPermissionPaths(inputPath).paths
}

/**
 * 2.1.323 #1985 (SEA `sM` @278264999):
 * Read at most `maxBytes` from an open FileHandle in 64 KiB chunks so
 * synthetic 0-byte `/proc` files and streams never cause OOM.
 */
export async function readBoundedFromHandle(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
  mode?: 'file' | 'stream',
): Promise<Buffer> {
  const isPositional =
    mode !== undefined ? mode === 'file' : (await handle.stat()).isFile()
  const chunks: Buffer[] = []
  let total = 0
  const scratch = Buffer.allocUnsafe(Math.min(65536, Math.max(1, maxBytes)))
  while (total < maxBytes) {
    const remaining = maxBytes - total
    const slice =
      remaining < scratch.length ? scratch.subarray(0, remaining) : scratch
    const { bytesRead } = await handle.read(
      slice,
      0,
      slice.length,
      isPositional ? total : null,
    )
    if (bytesRead === 0) break
    chunks.push(Buffer.from(slice.subarray(0, bytesRead)))
    total += bytesRead
  }
  return Buffer.concat(chunks, total)
}

/**
 * 2.1.323 #1985 (SEA `Gqo` @278265200):
 * Sync counterpart of `readBoundedFromHandle` for sync callers.
 */
export function readBoundedFromFdSync(
  fd: number,
  maxBytes: number,
  mode: 'file' | 'stream',
): Buffer {
  const chunks: Buffer[] = []
  let total = 0
  const scratch = Buffer.allocUnsafe(Math.min(65536, Math.max(1, maxBytes)))
  while (total < maxBytes) {
    const remaining = maxBytes - total
    const slice =
      remaining < scratch.length ? scratch.subarray(0, remaining) : scratch
    const bytesRead = fs.readSync(
      fd,
      slice,
      0,
      slice.length,
      mode === 'file' ? total : null,
    )
    if (bytesRead === 0) break
    chunks.push(Buffer.from(slice.subarray(0, bytesRead)))
    total += bytesRead
  }
  return Buffer.concat(chunks, total)
}

export const NodeFsOperations: FsOperations = {
  cwd() {
    return process.cwd()
  },

  existsSync(fsPath) {
    using _ = slowLogging`fs.existsSync(${fsPath})`
    return fs.existsSync(fsPath)
  },

  async stat(fsPath) {
    return statPromise(fsPath)
  },

  async readdir(fsPath) {
    return readdirPromise(fsPath, { withFileTypes: true })
  },

  async unlink(fsPath) {
    return unlinkPromise(fsPath)
  },

  async rmdir(fsPath) {
    return rmdirPromise(fsPath)
  },

  async rm(fsPath, options) {
    return rmPromise(fsPath, options)
  },

  async mkdir(dirPath, options) {
    try {
      await mkdirPromise(dirPath, { recursive: true, ...options })
    } catch (e) {
      // Bun/Windows: recursive:true throws EEXIST on directories with the
      // FILE_ATTRIBUTE_READONLY bit set (Group Policy, OneDrive, desktop.ini).
      // Bun's directoryExistsAt misclassifies DIRECTORY+READONLY as not-a-dir
      // (bun-internal src/sys.zig existsAtType). The dir exists; ignore.
      // https://github.com/anthropics/claude-code/issues/30924
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
  },

  async readFile(fsPath, options) {
    return readFilePromise(fsPath, { encoding: options.encoding })
  },

  async rename(oldPath, newPath) {
    return renamePromise(oldPath, newPath)
  },

  statSync(fsPath) {
    using _ = slowLogging`fs.statSync(${fsPath})`
    return fs.statSync(fsPath)
  },

  lstatSync(fsPath) {
    using _ = slowLogging`fs.lstatSync(${fsPath})`
    return fs.lstatSync(fsPath)
  },

  readFileSync(fsPath, options) {
    using _ = slowLogging`fs.readFileSync(${fsPath})`
    return fs.readFileSync(fsPath, { encoding: options.encoding })
  },

  readFileBytesSync(fsPath) {
    using _ = slowLogging`fs.readFileBytesSync(${fsPath})`
    return fs.readFileSync(fsPath)
  },

  readSync(fsPath, options) {
    using _ = slowLogging`fs.readSync(${fsPath}, ${options.length} bytes)`
    let fd: number | undefined
    try {
      fd = fs.openSync(fsPath, 'r')
      const buffer = Buffer.alloc(options.length)
      const bytesRead = fs.readSync(fd, buffer, 0, options.length, 0)
      return { buffer, bytesRead }
    } finally {
      if (fd) fs.closeSync(fd)
    }
  },

  appendFileSync(path, data, options) {
    using _ = slowLogging`fs.appendFileSync(${path}, ${data.length} chars)`
    // For new files with explicit mode, use 'ax' (atomic create-with-mode) to avoid
    // TOCTOU race between existence check and open. Fall back to normal append if exists.
    if (options?.mode !== undefined) {
      try {
        const fd = fs.openSync(path, 'ax', options.mode)
        try {
          fs.appendFileSync(fd, data)
        } finally {
          fs.closeSync(fd)
        }
        return
      } catch (e) {
        if (getErrnoCode(e) !== 'EEXIST') throw e
        // File exists — fall through to normal append
      }
    }
    fs.appendFileSync(path, data)
  },

  copyFileSync(src, dest) {
    using _ = slowLogging`fs.copyFileSync(${src} → ${dest})`
    fs.copyFileSync(src, dest)
  },

  unlinkSync(path: string) {
    using _ = slowLogging`fs.unlinkSync(${path})`
    fs.unlinkSync(path)
  },

  renameSync(oldPath: string, newPath: string) {
    using _ = slowLogging`fs.renameSync(${oldPath} → ${newPath})`
    fs.renameSync(oldPath, newPath)
  },

  linkSync(target: string, path: string) {
    using _ = slowLogging`fs.linkSync(${target} → ${path})`
    fs.linkSync(target, path)
  },

  symlinkSync(
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ) {
    using _ = slowLogging`fs.symlinkSync(${target} → ${path})`
    fs.symlinkSync(target, path, type)
  },

  readlinkSync(path: string) {
    using _ = slowLogging`fs.readlinkSync(${path})`
    return fs.readlinkSync(path)
  },

  realpathSync(path: string) {
    using _ = slowLogging`fs.realpathSync(${path})`
    return realpathSyncCanonical(path)
  },

  mkdirSync(dirPath, options) {
    using _ = slowLogging`fs.mkdirSync(${dirPath})`
    const mkdirOptions: { recursive: boolean; mode?: number } = {
      recursive: true,
    }
    if (options?.mode !== undefined) {
      mkdirOptions.mode = options.mode
    }
    try {
      fs.mkdirSync(dirPath, mkdirOptions)
    } catch (e) {
      // Bun/Windows: recursive:true throws EEXIST on directories with the
      // FILE_ATTRIBUTE_READONLY bit set (Group Policy, OneDrive, desktop.ini).
      // Bun's directoryExistsAt misclassifies DIRECTORY+READONLY as not-a-dir
      // (bun-internal src/sys.zig existsAtType). The dir exists; ignore.
      // https://github.com/anthropics/claude-code/issues/30924
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
  },

  readdirSync(dirPath) {
    using _ = slowLogging`fs.readdirSync(${dirPath})`
    return fs.readdirSync(dirPath, { withFileTypes: true })
  },

  readdirStringSync(dirPath) {
    using _ = slowLogging`fs.readdirStringSync(${dirPath})`
    return fs.readdirSync(dirPath)
  },

  isDirEmptySync(dirPath) {
    using _ = slowLogging`fs.isDirEmptySync(${dirPath})`
    const files = this.readdirSync(dirPath)
    return files.length === 0
  },

  rmdirSync(dirPath) {
    using _ = slowLogging`fs.rmdirSync(${dirPath})`
    fs.rmdirSync(dirPath)
  },

  rmSync(path, options) {
    using _ = slowLogging`fs.rmSync(${path})`
    fs.rmSync(path, options)
  },

  createWriteStream(path: string) {
    return fs.createWriteStream(path)
  },

  async readFileBytes(fsPath: string, maxBytes?: number) {
    if (maxBytes === undefined) {
      return readFilePromise(fsPath)
    }
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0)
    const handle = await open(fsPath, flags)
    try {
      if (!(await handle.stat()).isFile()) {
        return Buffer.alloc(0)
      }
      return await readBoundedFromHandle(handle, maxBytes, 'file')
    } finally {
      await handle.close()
    }
  },
}

type FsOperationsHostState = {
  activeFs: FsOperations
  autofsNotMapRoots: Set<string>
  autofsPassingFailures: Map<string, number>
}

const fsOperationsHostSlot = new HostSlot<FsOperationsHostState>(() => ({
  activeFs: NodeFsOperations,
  autofsNotMapRoots: new Set(),
  autofsPassingFailures: new Map(),
}))

function getFsOperationsHostState(): FsOperationsHostState {
  return fsOperationsHostSlot.of(getBootstrapSessionHost())
}

/**
 * Overrides the filesystem implementation. Note: This function does not
 * automatically update cwd.
 * @param implementation The filesystem implementation to use
 */
export function setFsImplementation(implementation: FsOperations): void {
  getFsOperationsHostState().activeFs = implementation
}

/**
 * Gets the currently active filesystem implementation
 * @returns The currently active filesystem implementation
 */
export function getFsImplementation(): FsOperations {
  return getFsOperationsHostState().activeFs
}

/**
 * 2.1.323 #2161 (SEA `y6` / `ste` @279396800):
 * Avoid probing Linux autofs map roots (such as `/home` when mounted as an
 * indirect autofs map, which can trigger slow/hanging NIS/LDAP lookups at
 * startup). Also honors `CLAUDE_CODE_AUTOMOUNT_ROOTS` (delimiter-separated
 * absolute paths) for deeper map roots.
 */
const AUTOFS_SUPER_MAGIC = 0x0187 // 391
const AUTOFS_PERMANENT_ERRNO = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
])
const AUTOFS_MAX_TRANSIENT_RETRIES = 2

export function _resetAutofsMapRootCacheForTesting(): void {
  const hostState = getFsOperationsHostState()
  hostState.autofsNotMapRoots.clear()
  hostState.autofsPassingFailures.clear()
}

export function isAutofsMapRoot(
  dirPath: string,
  opts?: {
    platform?: ReturnType<typeof getPlatform>
    statfsSyncFn?: (p: string) => { type: number | bigint }
  },
): boolean {
  const plat = opts?.platform ?? getPlatform()
  if ((plat !== 'linux' && plat !== 'wsl') || dirPath === '/') {
    return false
  }
  const normalized = nodePath.resolve(dirPath)
  if (normalized === '/' || nodePath.dirname(normalized) !== '/') {
    return false
  }
  const useCache =
    opts?.statfsSyncFn === undefined && opts?.platform === undefined
  const hostState = useCache ? getFsOperationsHostState() : undefined
  if (hostState && hostState.autofsNotMapRoots.has(normalized)) {
    return false
  }
  try {
    const statfsFn =
      opts?.statfsSyncFn ??
      ((p: string) =>
        (
          fs as unknown as {
            statfsSync?: (p: string) => { type: number | bigint }
          }
        ).statfsSync?.(p))
    const info = statfsFn(normalized)
    if (info && Number(info.type) === AUTOFS_SUPER_MAGIC) {
      if (hostState) hostState.autofsPassingFailures.delete(normalized)
      return true
    }
  } catch (err) {
    const code = getErrnoCode(err)
    const isPermanent =
      code === undefined
        ? err instanceof TypeError
        : AUTOFS_PERMANENT_ERRNO.has(code)
    if (hostState) {
      const count = (hostState.autofsPassingFailures.get(normalized) ?? 0) + 1
      if (!isPermanent && count < AUTOFS_MAX_TRANSIENT_RETRIES) {
        hostState.autofsPassingFailures.set(normalized, count)
        return false
      }
    }
  }
  if (hostState) hostState.autofsNotMapRoots.add(normalized)
  return false
}

export function isAutomountMapRoot(
  dirPath: string,
  opts?: {
    envValue?: string
    platform?: ReturnType<typeof getPlatform>
    statfsSyncFn?: (p: string) => { type: number | bigint }
  },
): boolean {
  const normalized = nodePath.resolve(dirPath)
  const rawRoots =
    opts?.envValue !== undefined
      ? opts.envValue
      : process.env.CLAUDE_CODE_AUTOMOUNT_ROOTS
  if (rawRoots) {
    const matched = rawRoots
      .split(nodePath.delimiter)
      .some(
        entry =>
          entry.length > 0 &&
          nodePath.isAbsolute(entry) &&
          nodePath.resolve(entry) === normalized,
      )
    if (matched) return true
  }
  return isAutofsMapRoot(normalized, opts)
}

/**
 * Resets the filesystem implementation to the default Node.js implementation.
 * Note: This function does not automatically update cwd.
 */
export function setOriginalFsImplementation(): void {
  getFsOperationsHostState().activeFs = NodeFsOperations
}

export type ReadFileRangeResult = {
  content: string
  bytesRead: number
  bytesTotal: number
}

/**
 * Read up to `maxBytes` from a file starting at `offset`.
 * Returns a flat string from Buffer — no sliced string references to a
 * larger parent. Returns null if the file is smaller than the offset.
 */
export async function readFileRange(
  path: string,
  offset: number,
  maxBytes: number,
): Promise<ReadFileRangeResult | null> {
  await using fh = await open(path, 'r')
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
}

/**
 * Read the last `maxBytes` of a file.
 * Returns the whole file if it's smaller than maxBytes.
 */
export async function tailFile(
  path: string,
  maxBytes: number,
): Promise<ReadFileRangeResult> {
  await using fh = await open(path, 'r')
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

  return {
    content: buffer.toString('utf8', 0, totalRead),
    bytesRead: totalRead,
    bytesTotal: size,
  }
}

/**
 * Async generator that yields lines from a file in reverse order.
 * Reads the file backwards in chunks to avoid loading the entire file into memory.
 * @param path - The path to the file to read
 * @returns An async generator that yields lines in reverse order
 */
export async function* readLinesReverse(
  path: string,
): AsyncGenerator<string, void, undefined> {
  const CHUNK_SIZE = 1024 * 4
  const fileHandle = await open(path, 'r')
  try {
    const stats = await fileHandle.stat()
    let position = stats.size
    // Carry raw bytes (not a decoded string) across chunk boundaries so that
    // multi-byte UTF-8 sequences split by the 4KB boundary are not corrupted.
    // Decoding per-chunk would turn a split sequence into U+FFFD on both sides,
    // which for history.jsonl means JSON.parse throws and the entry is dropped.
    let remainder = Buffer.alloc(0)
    const buffer = Buffer.alloc(CHUNK_SIZE)

    while (position > 0) {
      const currentChunkSize = Math.min(CHUNK_SIZE, position)
      position -= currentChunkSize

      await fileHandle.read(buffer, 0, currentChunkSize, position)
      const combined = Buffer.concat([
        buffer.subarray(0, currentChunkSize),
        remainder,
      ])

      const firstNewline = combined.indexOf(0x0a)
      if (firstNewline === -1) {
        remainder = combined
        continue
      }

      remainder = Buffer.from(combined.subarray(0, firstNewline))
      const lines = combined.toString('utf8', firstNewline + 1).split('\n')

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!
        if (line) {
          yield line
        }
      }
    }

    if (remainder.length > 0) {
      yield remainder.toString('utf8')
    }
  } finally {
    await fileHandle.close()
  }
}
