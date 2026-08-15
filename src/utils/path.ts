import { homedir } from 'os'
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  posix,
  relative,
  resolve,
  win32,
} from 'path'
import { getCwd } from './cwd.js'
import { getFsImplementation } from './fsOperations.js'
import { getPlatform } from './platform.js'
import { posixPathToWindowsPath } from './windowsPaths.js'

/**
 * densable `Rwr` — strip Windows extended-length prefixes during path expansion.
 * More aggressive than densable `Xpr` / `stripWindowsLongPathPrefix`: any `\\?\`
 * prefix is removed (not only drive-letter forms).
 *
 * - `\\?\UNC\server\share` → `\\server\share`
 * - `\\?\C:\Users\...` → `C:\Users\...`
 * - `\\?\volume{...}` → `volume{...}` (caller may still treat as device path)
 * - densable 2.1.233 #11: `\??\UNC\server\share` / `\??\C:\...` NT object prefix
 */
export function stripWindowsExtendedPathPrefix(path: string): string {
  // NT object manager device prefix `\??\` (and `/??/`) — before classic `\\?\`
  // `\??\UNC\server` → slice(8) past `\??\UNC\` then re-prefix `\\`
  if (/^[\\/]\?\?[\\/]unc[\\/]/i.test(path)) return '\\\\' + path.slice(8)
  if (/^[\\/]\?\?[\\/]/.test(path)) return path.slice(4)
  if (/^\\\\\?\\unc\\/i.test(path)) return '\\\\' + path.slice(8)
  if (path.startsWith('\\\\?\\')) return path.slice(4)
  return path
}

/**
 * densable `Xpr` — strip only well-formed long-path prefixes (drive letter or UNC).
 * Leaves other `\\?\…` device paths intact (unlike {@link stripWindowsExtendedPathPrefix}).
 */
export function stripWindowsLongPathPrefixXpr(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return '\\\\' + path.slice(8)
  if (path.startsWith('\\\\?\\') && path.length >= 7 && path[5] === ':') {
    return path.slice(4)
  }
  return path
}

/**
 * densable `UOo` — true when win32.toNamespacedPath looks like `\\?\UNC\…`
 * (network UNC that must not be resolve()'d against cwd).
 */
function isWindowsNamespacedUnc(path: string): boolean {
  const namespaced = win32.toNamespacedPath(path)
  return /^[\\/]{2}[?.][\\/]unc[\\/]/i.test(namespaced)
}

/**
 * Expands a path that may contain tilde notation (~) to an absolute path.
 *
 * On Windows, POSIX-style paths (e.g., `/c/Users/...`) are automatically converted
 * to Windows format (e.g., `C:\Users\...`). The function always returns paths in
 * the native format for the current platform.
 *
 * @param path - The path to expand, may contain:
 *   - `~` - expands to user's home directory
 *   - `~/path` - expands to path within user's home directory
 *   - absolute paths - returned normalized
 *   - relative paths - resolved relative to baseDir
 *   - POSIX paths on Windows - converted to Windows format
 * @param baseDir - The base directory for resolving relative paths (defaults to current working directory)
 * @returns The expanded absolute path in the native format for the current platform
 *
 * @throws {Error} If path is invalid
 *
 * @example
 * expandPath('~') // '/home/user'
 * expandPath('~/Documents') // '/home/user/Documents'
 * expandPath('./src', '/project') // '/project/src'
 * expandPath('/absolute/path') // '/absolute/path'
 */
export function expandPath(path: string, baseDir?: string): string {
  // Set default baseDir to getCwd() if not provided
  const actualBaseDir = baseDir ?? getCwd() ?? getFsImplementation().cwd()

  // Input validation
  if (typeof path !== 'string') {
    throw new TypeError(`Path must be a string, received ${typeof path}`)
  }

  if (typeof actualBaseDir !== 'string') {
    throw new TypeError(
      `Base directory must be a string, received ${typeof actualBaseDir}`,
    )
  }

  // Security: Check for null bytes
  if (path.includes('\0') || actualBaseDir.includes('\0')) {
    throw new Error('Path contains null bytes')
  }

  const isSyntheticPosixPath = (value: string): boolean =>
    value.includes('/') && !value.includes('\\') && !/^[A-Za-z]:/.test(value)

  // Handle empty or whitespace-only paths
  const trimmedPath = path.trim()
  if (!trimmedPath) {
    if (getPlatform() === 'windows' && isSyntheticPosixPath(actualBaseDir)) {
      return posix.normalize(actualBaseDir).normalize('NFC')
    }
    return normalize(actualBaseDir).normalize('NFC')
  }

  // Handle home directory notation
  if (trimmedPath === '~') {
    return homedir().normalize('NFC')
  }

  if (trimmedPath.startsWith('~/')) {
    return join(homedir(), trimmedPath.slice(2)).normalize('NFC')
  }

  // On Windows, convert POSIX-style paths (e.g., /c/Users/...) to Windows format
  let processedPath = trimmedPath
  if (getPlatform() === 'windows') {
    // densable `_$`: Rwr(…) before further expansion — prevents crash on `\\?\` / UNC
    processedPath = stripWindowsExtendedPathPrefix(processedPath)
    if (processedPath.match(/^\/[a-z]\//i)) {
      try {
        processedPath = posixPathToWindowsPath(processedPath)
      } catch {
        // If conversion fails, keep stripped path
      }
    }
    // densable: capitalize drive letter after strip
    if (/^[a-z]:/.test(processedPath)) {
      processedPath = processedPath[0]!.toUpperCase() + processedPath.slice(1)
    }
    // densable UOo && !glob: early win32.normalize for network UNC
    if (
      isWindowsNamespacedUnc(processedPath) &&
      !processedPath.includes('*') &&
      !processedPath.includes('?')
    ) {
      return win32.normalize(processedPath).normalize('NFC')
    }
  }

  // Handle absolute paths
  if (isAbsolute(processedPath)) {
    if (getPlatform() === 'windows' && isSyntheticPosixPath(processedPath)) {
      return posix.normalize(processedPath).normalize('NFC')
    }
    return normalize(processedPath).normalize('NFC')
  }

  // Handle relative paths
  if (
    getPlatform() === 'windows' &&
    isSyntheticPosixPath(actualBaseDir) &&
    !/^[A-Za-z]:/.test(processedPath) &&
    !processedPath.startsWith('\\\\')
  ) {
    return posix.resolve(actualBaseDir, processedPath).normalize('NFC')
  }
  return resolve(actualBaseDir, processedPath).normalize('NFC')
}

/**
 * Converts an absolute path to a relative path from cwd, to save tokens in
 * tool output. If the path is outside cwd (relative path would start with ..),
 * returns the absolute path unchanged so it stays unambiguous.
 *
 * @param absolutePath - The absolute path to relativize
 * @returns Relative path if under cwd, otherwise the original absolute path
 */
export function toRelativePath(absolutePath: string): string {
  const relativePath = relative(getCwd(), absolutePath)
  // If the relative path would go outside cwd (starts with ..), keep absolute
  return relativePath.startsWith('..') ? absolutePath : relativePath
}

/**
 * Gets the directory path for a given file or directory path.
 * If the path is a directory, returns the path itself.
 * If the path is a file or doesn't exist, returns the parent directory.
 *
 * @param path - The file or directory path
 * @returns The directory path
 */
export function getDirectoryForPath(path: string): string {
  const absolutePath = expandPath(path)
  // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
  if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
    return dirname(absolutePath)
  }
  try {
    const stats = getFsImplementation().statSync(absolutePath)
    if (stats.isDirectory()) {
      return absolutePath
    }
  } catch {
    // Path doesn't exist or can't be accessed
  }
  // If it's not a directory or doesn't exist, return the parent directory
  return dirname(absolutePath)
}

/**
 * Checks if a path contains directory traversal patterns that navigate to parent directories.
 *
 * @param path - The path to check for traversal patterns
 * @returns true if the path contains traversal (e.g., '../', '..\', or ends with '..')
 */
export function containsPathTraversal(path: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)
}

// Re-export from the shared zero-dep source.
export { sanitizePath } from './sessionStoragePortable.js'

/**
 * Normalizes a path for use as a JSON config key.
 * On Windows, paths can have inconsistent separators (C:\path vs C:/path)
 * depending on whether they come from git, Node.js APIs, or user input.
 * This normalizes to forward slashes for consistent JSON serialization.
 *
 * @param path - The path to normalize
 * @returns The normalized path with consistent forward slashes
 */
export function normalizePathForConfigKey(path: string): string {
  // First use Node's normalize to resolve . and .. segments
  const normalized = normalize(path)
  // Then convert all backslashes to forward slashes for consistent JSON keys
  // This is safe because forward slashes work in Windows paths for most operations
  return normalized.replace(/\\/g, '/')
}
