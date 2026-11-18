// This file represents useful wrappers over node:child_process
// These wrappers ease error handling and cross-platform compatbility
// By using execa, Windows automatically gets shell escaping + BAT / CMD handling

import { type ExecaError, execa } from 'execa'
import { existsSync, lstatSync, readdirSync, statSync } from 'fs'
import { isAbsolute, join } from 'path'
import { tryProcessCwd } from './cachePaths.js'
import { getCwd } from '../utils/cwd.js'
import { logError } from './log.js'

export { execSyncWithDefaults_DEPRECATED } from './execFileNoThrowPortable.js'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60

type ExecFileOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  maxBuffer?: number
  // Setting useCwd=false avoids circular dependencies during initialization
  // getCwd() -> PersistentShell -> logEvent() -> execFileNoThrow
  useCwd?: boolean
  env?: NodeJS.ProcessEnv
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
  inheritFd?: number
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    useCwd: true,
  },
): Promise<{
  stdout: string
  stderr: string
  code: number
  error?: string
  noChildLeft?: boolean
}> {
  return execFileNoThrowWithCwd(file, args, {
    abortSignal: options.abortSignal,
    timeout: options.timeout,
    preserveOutputOnError: options.preserveOutputOnError,
    maxBuffer: options.maxBuffer,
    cwd: options.useCwd ? getCwd() : undefined,
    env: options.env,
    stdin: options.stdin,
    input: options.input,
    inheritFd: options.inheritFd,
  })
}

type ExecFileWithCwdOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  maxBuffer?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  /**
   * densable 2.1.238 marketplace/catalog headersHelper (`m5n`): when false,
   * do not merge process.env — `env` is the full child environment.
   */
  extendEnv?: boolean
  shell?: boolean | string | undefined
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
  inheritFd?: number
  /** densable git harden `stripFinalNewline:!1` — keep trailing NL for `Ae`. */
  stripFinalNewline?: boolean
}

type ExecaResultWithError = {
  shortMessage?: string
  signal?: string
}

/**
 * Extracts a human-readable error message from an execa result.
 *
 * Priority order:
 * 1. shortMessage - execa's human-readable error (e.g., "Command failed with exit code 1: ...")
 *    This is preferred because it already includes signal info when a process is killed,
 *    making it more informative than just the signal name.
 * 2. signal - the signal that killed the process (e.g., "SIGTERM")
 * 3. errorCode - fallback to just the numeric exit code
 */
function getErrorMessage(
  result: ExecaResultWithError,
  errorCode: number,
): string {
  if (result.shortMessage) {
    return result.shortMessage
  }
  if (typeof result.signal === 'string') {
    return result.signal
  }
  return String(errorCode)
}

function isErrnoError(err: unknown): err is {
  errno: number
  code?: string
  syscall?: string
  message?: string
} {
  return (
    err !== null &&
    typeof err === 'object' &&
    'errno' in err &&
    typeof (err as { errno: unknown }).errno === 'number'
  )
}

/**
 * Official Sn(result, spawnError) — when execa fails to spawn (e.g. ENOENT)
 * under `reject: false`, surface the captured child_process `error` event's
 * code/syscall/message instead of generic "Premature close".
 */
export function formatSpawnError(
  result: {
    exitCode?: number
    timedOut?: boolean
    isCanceled?: boolean
    command?: string
    code?: string
  },
  spawnError: unknown,
): string | undefined {
  if (
    !isErrnoError(spawnError) ||
    spawnError.code === undefined ||
    typeof spawnError.syscall !== 'string' ||
    !spawnError.syscall.startsWith('spawn') ||
    result.exitCode !== undefined ||
    result.timedOut ||
    result.isCanceled ||
    result.code === spawnError.code
  ) {
    return undefined
  }
  return `Command failed with ${spawnError.code}: ${result.command}\n${spawnError.message}`
}

/**
 * execFile, but always resolves (never throws)
 */
export const MACOS_GIT_NOT_INSTALLED_MESSAGE =
  'git is not installed on this Mac. To install it, run xcode-select --install, then try again.'

/**
 * densable `nYe` — avoid triggering macOS's GUI "Install Command Line
 * Developer Tools" dialog when `/usr/bin/git` is only the xcrun shim and
 * neither CommandLineTools, xcode_select_link, nor Xcode*.app is present.
 */
export function isMacosMissingGitCommandLineTools(
  file: string,
  env: NodeJS.ProcessEnv,
  deps: {
    platform?: NodeJS.Platform
    existsSync?: (p: string) => boolean
    statSync?: (p: string, opts: { throwIfNoEntry: false }) => unknown
    lstatSync?: (p: string, opts: { throwIfNoEntry: false }) => unknown
    readdirSync?: (p: string) => string[]
  } = {},
): boolean {
  if ((deps.platform ?? process.platform) !== 'darwin') return false
  if (env.DEVELOPER_DIR) return false
  const exists = deps.existsSync ?? existsSync
  const stat = deps.statSync ?? statSync
  const lstat = deps.lstatSync ?? lstatSync
  const readdir = deps.readdirSync ?? readdirSync
  try {
    const resolved = file.includes('/')
      ? file
      : (env.PATH ?? '')
          .split(':')
          .filter(p => isAbsolute(p))
          .map(p => join(p, file))
          .find(p => exists(p))
    return (
      resolved === '/usr/bin/git' &&
      stat('/Library/Developer/CommandLineTools', { throwIfNoEntry: false }) ===
        undefined &&
      lstat('/var/db/xcode_select_link', { throwIfNoEntry: false }) ===
        undefined &&
      !readdir('/Applications').some(name => /^Xcode.*\.app$/i.test(name))
    )
  } catch {
    return false
  }
}

export function execFileNoThrowWithCwd(
  file: string,
  args: string[],
  {
    abortSignal,
    timeout: finalTimeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: finalPreserveOutput = true,
    cwd: finalCwd,
    env: finalEnv,
    extendEnv,
    maxBuffer,
    shell,
    stdin: finalStdin,
    input: finalInput,
    inheritFd: finalInheritFd,
    stripFinalNewline: finalStripFinalNewline,
  }: ExecFileWithCwdOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    maxBuffer: 1_000_000,
  },
): Promise<{
  stdout: string
  stderr: string
  code: number
  error?: string
  noChildLeft?: boolean
}> {
  const effectiveEnv =
    finalEnv === undefined
      ? process.env
      : extendEnv === false
        ? finalEnv
        : { ...process.env, ...finalEnv }
  if (isMacosMissingGitCommandLineTools(file, effectiveEnv)) {
    return Promise.resolve({
      stdout: '',
      stderr: MACOS_GIT_NOT_INSTALLED_MESSAGE,
      code: 127,
      error: MACOS_GIT_NOT_INSTALLED_MESSAGE,
    })
  }
  return new Promise(resolve => {
    let spawnError: unknown
    // Use execa for cross-platform .bat/.cmd compatibility on Windows
    const child = execa(file, args, {
      maxBuffer,
      cancelSignal: abortSignal,
      timeout: finalTimeout,
      // densable 236 #4: omitted cwd still used process.cwd() inside execa
      // and threw after a switched-into directory was removed.
      cwd: finalCwd ?? tryProcessCwd(),
      env: finalEnv,
      ...(extendEnv === false ? { extendEnv: false } : {}),
      shell,
      ...(finalInheritFd === undefined
        ? { stdin: finalStdin }
        : {
            stdio: [
              finalStdin ?? 'pipe',
              'pipe',
              'pipe',
              finalInheritFd as unknown as 'inherit',
            ],
          }),
      input: finalInput,
      ...(finalStripFinalNewline === false ? { stripFinalNewline: false } : {}),
      reject: false, // Don't throw on non-zero exit codes
    })
    child.once('error', err => {
      spawnError = err
    })
    child
      .then(result => {
        const noChildLeft =
          process.platform === 'linux' &&
          child.pid === undefined &&
          isErrnoError(spawnError)
            ? true
            : undefined
        if (result.failed) {
          if (finalPreserveOutput) {
            const errorCode = result.exitCode ?? 1
            void resolve({
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              code: errorCode,
              ...(noChildLeft ? { noChildLeft } : {}),
              error:
                formatSpawnError(
                  result as unknown as {
                    exitCode?: number
                    timedOut?: boolean
                    isCanceled?: boolean
                    command?: string
                    code?: string
                  },
                  spawnError,
                ) ??
                getErrorMessage(
                  result as unknown as ExecaResultWithError,
                  errorCode,
                ),
            })
          } else {
            void resolve({
              stdout: '',
              stderr: '',
              code: result.exitCode ?? 1,
              ...(noChildLeft ? { noChildLeft } : {}),
            })
          }
        } else {
          void resolve({
            stdout: result.stdout,
            stderr: result.stderr,
            code: 0,
          })
        }
      })
      .catch((error: ExecaError) => {
        logError(error)
        const noChildLeft =
          process.platform === 'linux' &&
          child.pid === undefined &&
          isErrnoError(error)
            ? true
            : undefined
        void resolve({
          stdout: '',
          stderr: '',
          code: 1,
          ...(noChildLeft ? { noChildLeft } : {}),
        })
      })
  })
}
