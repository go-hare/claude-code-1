import { lstatSync, mkdirSync } from 'fs'
import { lstat, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { errorMessage } from '../utils/errors.js'

export const CHILD_LOGS_DIR_NAME = 'child-logs'

/**
 * Official 2.1.326 #338 (`NMt`): Remote Control `--verbose` child session
 * debug logs live in `~/.claude/child-logs/` (instead of `/tmp/claude/`).
 */
export function getChildLogsRoot(homeDir: string = homedir()): string {
  return join(homeDir, '.claude', CHILD_LOGS_DIR_NAME)
}

function assertSafeChildLogsStat(
  stat: { isDirectory(): boolean; uid: number; mode: number },
  dir: string,
): void {
  if (!stat.isDirectory()) {
    throw new Error(`child log root (${dir}) is not a directory`)
  }
  if (process.platform !== 'win32') {
    const uid =
      typeof process.getuid === 'function' ? process.getuid() : undefined
    if ((uid !== undefined && stat.uid !== uid) || (stat.mode & 0o022) !== 0) {
      throw new Error(`child log root (${dir}) has unexpected owner or mode`)
    }
  }
}

/**
 * Official 2.1.326 #338 (`Fii` / `$$a`): ensure `~/.claude/child-logs` exists
 * with mode `0o700`, owned by the current user, and not group/world writable.
 * Returns the directory path, or `undefined` if unusable (reporting via `onError`).
 */
export async function resolveChildLogsDir(
  onError?: (msg: string) => void,
  homeDir: string = homedir(),
): Promise<string | undefined> {
  const dir = getChildLogsRoot(homeDir)
  try {
    await mkdir(dirname(dir), { recursive: true })
    try {
      await mkdir(dir, { mode: 0o700 })
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
    }
    const stat = await lstat(dir)
    assertSafeChildLogsStat(stat, dir)
    return dir
  } catch (err) {
    onError?.(`${dir} cannot be used (${errorMessage(err)})`)
    return undefined
  }
}

/**
 * Synchronous variant of `resolveChildLogsDir` for synchronous child spawn paths
 * (`createSessionSpawner.spawn`).
 */
export function resolveChildLogsDirSync(
  onError?: (msg: string) => void,
  homeDir: string = homedir(),
): string | undefined {
  const dir = getChildLogsRoot(homeDir)
  try {
    mkdirSync(dirname(dir), { recursive: true })
    try {
      mkdirSync(dir, { mode: 0o700 })
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
    }
    const stat = lstatSync(dir)
    assertSafeChildLogsStat(stat, dir)
    return dir
  } catch (err) {
    onError?.(`${dir} cannot be used (${errorMessage(err)})`)
    return undefined
  }
}
