import { lstat } from 'fs/promises'
import { posix, win32 } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { LogOption } from '../types/logs.js'
import { quote } from './bash/shellQuote.js'
import { getErrnoCode } from './errors.js'
import { isUncOrNtObjectPath } from './path.js'
import { getPlatform, type Platform } from './platform.js'
import { getSessionIdFromLog } from './sessionStorage.js'

/**
 * Official 2.1.325 `F(e)` (#2338): normalize Windows drive-letter case and
 * slashes so `/resume` does not hide or refuse sessions recorded with a
 * different drive-letter case (`C:\repo` vs `c:/repo`).
 */
export function normalizeResumeProjectPath(
  p: string,
  platform: Platform = getPlatform(),
): string {
  if (platform !== 'windows') return p
  let norm = p.replaceAll('\\', '/')
  // Collapse redundant slashes except leading UNC `//`
  norm = norm.startsWith('//')
    ? '//' + norm.slice(2).replace(/\/+/g, '/')
    : norm.replace(/\/+/g, '/')
  // Lowercase Windows drive letter (`C:/...` -> `c:/...`)
  if (/^[A-Za-z]:/.test(norm)) {
    norm = norm[0]!.toLowerCase() + norm.slice(1)
  }
  // Strip trailing slash unless it's a root like `c:/` or `/`
  if (norm.length > 1 && norm.endsWith('/') && !/^[a-z]:\/$/.test(norm)) {
    norm = norm.slice(0, -1)
  }
  return norm
}

/** Official 2.1.325 `Zro(a, b)` (#2338). */
export function isSameResumeProjectPath(
  a: string,
  b: string,
  platform: Platform = getPlatform(),
): boolean {
  return (
    normalizeResumeProjectPath(a, platform) ===
    normalizeResumeProjectPath(b, platform)
  )
}

/** Official 2.1.325 `Iur(projectPath, worktreePaths)` (#2338). */
export function findContainingWorktreePath(
  projectPath: string,
  worktreePaths: readonly string[],
  platform: Platform = getPlatform(),
): string | undefined {
  const target = normalizeResumeProjectPath(projectPath, platform)
  const matches = worktreePaths.filter(wt => {
    const normWt = normalizeResumeProjectPath(wt, platform)
    return (
      target === normWt ||
      target.startsWith(normWt.endsWith('/') ? normWt : `${normWt}/`)
    )
  })
  matches.sort((a, b) => b.length - a.length)
  return matches[0]
}

/**
 * densable `DTs` — Windows cmd uses `;`, everyone else `&&`.
 */
export function resumeCdJoiner(): ';' | '&&' {
  return getPlatform() === 'windows' ? ';' : '&&'
}

/**
 * densable `Hg` / `HMr` — posix `/net/<host>/...` automount.
 */
function isPosixNetAutomount(path: string): boolean {
  if (!path.startsWith('/')) return false
  const segs: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segs.pop()
      continue
    }
    segs.push(part)
    if (segs.length === 2 && segs[0]!.toLowerCase() === 'net') return true
  }
  return false
}

/**
 * densable `rft` — `/net/<host>/...` or `/Network/...`.
 */
export function isPosixNetworkResumeSpelling(path: string): boolean {
  return isPosixNetAutomount(path) || /^\/Network\//i.test(path)
}

/**
 * densable `MoA` — walk each path component with `lstat`.
 * Symlink anywhere on the chain, or a complete walk, is "still there".
 * ENOENT / ENOTDIR means the directory is gone (changelog #19).
 */
export async function pathHasSymlinkAncestor(path: string): Promise<boolean> {
  const windows = getPlatform() === 'windows'
  const { parse, sep: pathSep } = windows ? win32 : posix
  const root = windows
    ? parse(path).root.replaceAll('/', pathSep)
    : parse(path).root
  const parts = path
    .slice(parse(path).root.length)
    .split(windows ? /[\\/]+/ : pathSep)
    .filter(Boolean)
  let cursor = root
  for (const part of parts) {
    cursor =
      cursor === '' || cursor.endsWith(pathSep)
        ? cursor + part
        : cursor + pathSep + part
    try {
      if ((await lstat(cursor)).isSymbolicLink()) return true
    } catch (err) {
      const code = getErrnoCode(err)
      return code !== 'ENOENT' && code !== 'ENOTDIR'
    }
  }
  return true
}

/**
 * densable `MTs` — all-projects `/resume` command, or `null` to resume here.
 *
 * Returns a `cd … claude --resume` string only when the recorded directory
 * is still a local path (or a network spelling we cannot probe). Deleted
 * worktrees / missing ancestors return `null` so the picker resumes in cwd.
 *
 * Invent-ban leftover: official binary is `claude`; tip prints `ccb`.
 */
export async function checkCrossProjectResume(
  log: LogOption,
  showAllProjects: boolean,
  worktreePaths: string[],
): Promise<string | null> {
  const currentCwd = getOriginalCwd()
  if (
    !showAllProjects ||
    !log.projectPath ||
    isSameResumeProjectPath(log.projectPath, currentCwd)
  ) {
    return null
  }
  if (
    findContainingWorktreePath(log.projectPath, worktreePaths) !== undefined
  ) {
    return null
  }
  if (
    !isUncOrNtObjectPath(log.projectPath) &&
    !isPosixNetworkResumeSpelling(log.projectPath) &&
    !(await pathHasSymlinkAncestor(log.projectPath))
  ) {
    return null
  }
  const sessionId = getSessionIdFromLog(log)
  return `cd ${quote([log.projectPath])} ${resumeCdJoiner()} ccb --resume ${sessionId}`
}
