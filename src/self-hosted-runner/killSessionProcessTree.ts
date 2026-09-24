import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getErrnoCode } from '../utils/errors.js'

/**
 * densable `ug` / `P` @182467xxx — Windows Bash-tool / runner tree kill.
 * `taskkill /T /F` via System32, then `process.kill(pid)` if spawn fails.
 * densable `f`: log + `tengu_bash_tool_kill_error` with `stage`.
 * No Unix branch: the caller uses this only on win32 (`else this.child.kill()`).
 *
 * densable `Fr`/`ir`/`Ir` process-tree identity are BODY in SEA but
 * `treeSnapshot` is never assigned on the runner class — dead arms. Not
 * invented as live reap.
 */
export function windowsTaskkillSpec(
  pid: number,
  env: NodeJS.ProcessEnv = process.env,
): { exe: string; args: string[] } {
  const root = env.SYSTEMROOT || 'C:\\Windows'
  return {
    exe: join(root, 'System32', 'taskkill.exe'),
    args: ['/PID', String(pid), '/T', '/F'],
  }
}

function killFailureText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return String(err)
}

/**
 * densable `f` — killProcessTree failure log + analytics.
 * `s("tengu_bash_tool_kill_error",{stage:c(e),...t&&{error_code:t}})`
 */
export function reportKillProcessTreeFailure(
  stage: string,
  err: unknown,
  log?: (message: string) => void,
): void {
  try {
    const message = killFailureText(err)
    log?.(`killProcessTree ${stage} failed: ${message}`)
    const code = getErrnoCode(err)
    logEvent('tengu_bash_tool_kill_error', {
      stage:
        stage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(code
        ? {
            error_code:
              code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
  } catch {
    /* gold f swallows analytics failures */
  }
}

export function killSessionProcessTree(
  pid: number,
  log?: (message: string) => void,
  spawnImpl: typeof spawn = spawn,
  killPid: (pid: number) => void = target => {
    process.kill(target)
  },
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) return Promise.resolve()
  // densable P: o=(r)=>{f("taskkill",r);try{process.kill(e)}catch{}}
  const fail = (err: unknown): void => {
    reportKillProcessTreeFailure('taskkill', err, log)
    try {
      killPid(pid)
    } catch {
      /* already gone */
    }
  }
  try {
    const { exe, args } = windowsTaskkillSpec(pid)
    const child: ChildProcess = spawnImpl(exe, args, {
      cwd: undefined,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', fail)
  } catch (err) {
    fail(err)
  }
  return Promise.resolve()
}
