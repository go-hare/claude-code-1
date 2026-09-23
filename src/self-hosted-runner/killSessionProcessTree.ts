import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * densable `ug` / `P` — Windows Bash-tool tree kill.
 * `taskkill /T /F` via System32, then `process.kill(pid)` if spawn fails.
 * No Unix branch: the caller uses this only on win32 (`else this.child.kill()`).
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

export function killSessionProcessTree(
  pid: number,
  log?: (message: string) => void,
  spawnImpl: typeof spawn = spawn,
  killPid: (pid: number) => void = target => {
    process.kill(target)
  },
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) return Promise.resolve()
  const fail = (err: unknown): void => {
    log?.(`killProcessTree taskkill failed: ${killFailureText(err)}`)
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
