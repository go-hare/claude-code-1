import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertTempDirAllowedInDiskless } from './disklessGuards.js'
import { getErrnoCode } from './errors.js'
import { getClaudeTempDirName } from './permissions/filesystem.js'

export class TempDirVolumeFullError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'TempDirVolumeFullError'
    this.code = code
  }
}

export function getTempRootDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CODE_TMPDIR || tmpdir()
}

export function formatTempDirFullErrorMessage(
  tempRoot: string,
  tempDir: string,
  code: 'ENOSPC' | 'EDQUOT',
): string {
  const detail =
    code === 'EDQUOT'
      ? `your disk quota on the volume holding ${tempRoot} is used up (${code})`
      : `the volume holding ${tempRoot} is full (${code})`
  return `Claude Code's temporary directory ${tempDir} could not be created: ${detail}. Free space on that volume, or set CLAUDE_CODE_TMPDIR to a directory on another one, then try again.`
}

/**
 * densable `Ku()` — ensure the per-user Claude Code temp directory exists,
 * translating ENOSPC/EDQUOT into a clear actionable error naming the temp
 * volume and `CLAUDE_CODE_TMPDIR`.
 */
export function ensureClaudeTempDir(
  deps: {
    env?: NodeJS.ProcessEnv
    mkdirSyncFn?: typeof mkdirSync
    hasGetuid?: boolean
  } = {},
): string {
  assertTempDirAllowedInDiskless()
  const env = deps.env ?? process.env
  const mkdir = deps.mkdirSyncFn ?? mkdirSync
  const hasGetuid = deps.hasGetuid ?? typeof process.getuid === 'function'
  const tempRoot = getTempRootDir(env)
  const tempDir = join(tempRoot, getClaudeTempDirName())

  if (hasGetuid) {
    try {
      mkdir(tempDir, { recursive: true, mode: 0o700 })
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOSPC' || code === 'EDQUOT') {
        throw new TempDirVolumeFullError(
          formatTempDirFullErrorMessage(tempRoot, tempDir, code),
          code,
        )
      }
      throw err
    }
  } else {
    try {
      mkdir(tempDir, { recursive: true, mode: 0o700 })
    } catch {
      // Non-POSIX fallback mirrors SEA Ku()
    }
  }

  return tempDir
}
