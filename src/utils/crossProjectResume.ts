import { lstat } from 'fs/promises'
import { posix, sep, win32 } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { LogOption } from '../types/logs.js'
import { quote } from './bash/shellQuote.js'
import { getErrnoCode } from './errors.js'
import { isUncOrNtObjectPath } from './path.js'
import { getPlatform } from './platform.js'
import { getSessionIdFromLog } from './sessionStorage.js'

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
  if (!showAllProjects || !log.projectPath || log.projectPath === currentCwd) {
    return null
  }
  if (
    worktreePaths.some(
      wt => log.projectPath === wt || log.projectPath!.startsWith(wt + sep),
    )
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
