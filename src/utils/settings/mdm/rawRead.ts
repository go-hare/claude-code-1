/**
 * Minimal module for firing MDM subprocess reads without blocking the event loop.
 * Has minimal imports — only child_process, fs, and mdmConstants (which only imports os).
 *
 * Two usage patterns:
 * 1. Startup: startMdmRawRead() fires at main.tsx module evaluation, results consumed later via getMdmRawReadPromise()
 * 2. Poll/fallback: fireRawRead() creates a fresh read on demand (used by changeDetector and SDK entrypoint)
 *
 * Raw stdout is consumed by mdmSettings.ts via consumeRawReadResult().
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import {
  getMacOSPlistPaths,
  MDM_SUBPROCESS_TIMEOUT_MS,
  PLUTIL_ARGS_PREFIX,
  PLUTIL_PATH,
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_VALUE_NAME,
} from './constants.js'

export type MdmUnreadCause =
  | 'timeout'
  | 'killed'
  | 'spawn_busy'
  | 'spawn_error'
  | 'oversize'
  | 'unconvertible'
  | 'lint_unfinished'

export type RawPlistEntry = {
  stdout: string | null
  label: string
  unreadReason?: string
  unreadCause?: MdmUnreadCause
}

export type RawReadResult = {
  plistStdouts: RawPlistEntry[] | null
  hklmStdout: string | null
  hkcuStdout: string | null
}

type ExecOutcome = {
  stdout: string
  stderr: string
  status: 'ok' | 'timeout' | 'killed' | 'spawn_error' | 'exited'
  code: number | null
  errno: string | null
  signal: string | null
}

const SPAWN_BUSY_ERRNOS = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM'])

let rawReadPromise: Promise<RawReadResult> | null = null

function classifyExecError(
  err: NodeJS.ErrnoException & { killed?: boolean; signal?: string | null },
): Pick<ExecOutcome, 'status' | 'code' | 'errno' | 'signal'> {
  const signal =
    typeof err.signal === 'string' && err.signal ? err.signal : null
  if (typeof err.code === 'string') {
    return { status: 'spawn_error', code: null, errno: err.code, signal: null }
  }
  if (err.killed === true) {
    return { status: 'timeout', code: null, errno: null, signal }
  }
  if (signal) {
    return { status: 'killed', code: null, errno: null, signal }
  }
  return {
    status: 'exited',
    code: typeof err.code === 'number' ? err.code : 1,
    errno: null,
    signal: null,
  }
}

export function classifyPlutilUnreadCause(outcome: ExecOutcome): {
  unreadReason: string
  unreadCause?: MdmUnreadCause
} {
  if (
    outcome.status === 'spawn_error' &&
    outcome.errno === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  ) {
    return {
      unreadReason: "plutil's output exceeded the size limit",
      unreadCause: 'oversize',
    }
  }
  switch (outcome.status) {
    case 'timeout':
      return {
        unreadReason: `plutil timed out after ${MDM_SUBPROCESS_TIMEOUT_MS / 1000} seconds`,
        unreadCause: 'timeout',
      }
    case 'killed':
      return {
        unreadReason: 'plutil was stopped by a signal',
        unreadCause: 'killed',
      }
    case 'spawn_error':
      return {
        unreadReason: 'plutil could not be run',
        unreadCause:
          outcome.errno !== null && SPAWN_BUSY_ERRNOS.has(outcome.errno)
            ? 'spawn_busy'
            : 'spawn_error',
      }
    case 'ok':
    case 'exited':
      return { unreadReason: 'plutil did not finish' }
  }
}

export function isRetryableMdmUnreadCause(
  cause: MdmUnreadCause | undefined,
): boolean {
  return (
    cause === 'timeout' ||
    cause === 'killed' ||
    cause === 'spawn_busy' ||
    cause === 'lint_unfinished'
  )
}

function execFilePromise(cmd: string, args: string[]): Promise<ExecOutcome> {
  return new Promise(resolve => {
    try {
      execFile(
        cmd,
        args,
        { encoding: 'utf-8', timeout: MDM_SUBPROCESS_TIMEOUT_MS },
        (err, stdout, stderr) => {
          if (!err) {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              status: 'ok',
              code: 0,
              errno: null,
              signal: null,
            })
            return
          }
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            ...classifyExecError(
              err as NodeJS.ErrnoException & {
                killed?: boolean
                signal?: string | null
              },
            ),
          })
        },
      )
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      resolve({
        stdout: '',
        stderr: '',
        status: 'spawn_error',
        code: null,
        errno: typeof code === 'string' ? code : null,
        signal: null,
      })
    }
  })
}

/**
 * Official 2.1.321 (#1903): run plutil on a single plist path; if it times out
 * or is interrupted transiently, retry once before reporting `unreadCause`.
 */
async function readMacOSPlistWithRetry(
  path: string,
  label: string,
  execFn: (
    cmd: string,
    args: string[],
  ) => Promise<ExecOutcome> = execFilePromise,
): Promise<RawPlistEntry | null> {
  if (!existsSync(path)) {
    return null
  }
  const args = [...PLUTIL_ARGS_PREFIX, path]
  let outcome = await execFn(PLUTIL_PATH, args)
  if (outcome.status === 'ok' && outcome.stdout) {
    return { stdout: outcome.stdout, label }
  }
  const firstFailure = classifyPlutilUnreadCause(outcome)
  if (isRetryableMdmUnreadCause(firstFailure.unreadCause)) {
    // Retry once on slow MDM read timeout / transient interruption (#1903)
    outcome = await execFn(PLUTIL_PATH, args)
    if (outcome.status === 'ok' && outcome.stdout) {
      return { stdout: outcome.stdout, label }
    }
  }
  if (outcome.status === 'ok') {
    return { stdout: outcome.stdout, label }
  }
  if (outcome.status !== 'exited') {
    const failure = classifyPlutilUnreadCause(outcome)
    return {
      stdout: null,
      label,
      unreadReason: failure.unreadReason,
      unreadCause: failure.unreadCause,
    }
  }
  return { stdout: '', label }
}

/**
 * Fire fresh subprocess reads for MDM settings and return raw stdout.
 * On macOS: spawns plutil for each plist path in parallel (retrying once on
 * timeout), picks first winner or preserves unread failure entries.
 * On Windows: spawns reg query for HKLM and HKCU in parallel.
 * On Linux: returns empty (no MDM equivalent).
 */
export function fireRawRead(
  execFn: (
    cmd: string,
    args: string[],
  ) => Promise<ExecOutcome> = execFilePromise,
): Promise<RawReadResult> {
  return (async (): Promise<RawReadResult> => {
    if (process.platform === 'darwin') {
      const plistPaths = getMacOSPlistPaths()

      const entries = (
        await Promise.all(
          plistPaths.map(({ path, label }) =>
            readMacOSPlistWithRetry(path, label, execFn),
          ),
        )
      ).filter((entry): entry is RawPlistEntry => entry !== null)

      // First readable source wins; keep leading unread failures if none succeeded
      const firstReadableIdx = entries.findIndex(
        e => e.stdout !== null && e.stdout.length > 0,
      )
      return {
        plistStdouts:
          firstReadableIdx === -1
            ? entries
            : entries.slice(0, firstReadableIdx + 1),
        hklmStdout: null,
        hkcuStdout: null,
      }
    }

    if (process.platform === 'win32') {
      const [hklm, hkcu] = await Promise.all([
        execFn('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKLM,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
        execFn('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKCU,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
      ])
      return {
        plistStdouts: null,
        hklmStdout: hklm.code === 0 ? hklm.stdout : null,
        hkcuStdout: hkcu.code === 0 ? hkcu.stdout : null,
      }
    }

    return { plistStdouts: null, hklmStdout: null, hkcuStdout: null }
  })()
}

/**
 * Fire raw subprocess reads once for startup. Called at main.tsx module evaluation.
 * Results are consumed via getMdmRawReadPromise().
 */
export function startMdmRawRead(): void {
  if (rawReadPromise) return
  rawReadPromise = fireRawRead()
}

/**
 * Get the startup promise. Returns null if startMdmRawRead() wasn't called.
 */
export function getMdmRawReadPromise(): Promise<RawReadResult> | null {
  return rawReadPromise
}
