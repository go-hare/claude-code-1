/**
 * Official `ies` — hook spawn cwd when the session directory is gone.
 * Prefer current cwd; else first existing of originalCwd → projectRoot →
 * homedir(); else tmpdir(). Warn once per missing cwd.
 */
import { homedir, tmpdir } from 'os'
import { logForDebugging } from '../debug.js'
import { pathExists } from '../file.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

const hostWarnedMissingHookCwdsSlot = new HostSlot<Set<string>>(() => new Set())

function warnedMissingHookCwds(): Set<string> {
  return hostWarnedMissingHookCwdsSlot.of(getBootstrapSessionHost())
}

export async function resolveHookCwd(
  cwd: string,
  ctx: { originalCwd?: string; projectRoot?: string },
): Promise<string> {
  if (await pathExists(cwd)) {
    return cwd
  }
  let fallback = tmpdir()
  for (const candidate of [ctx.originalCwd, ctx.projectRoot, homedir()]) {
    if (
      typeof candidate === 'string' &&
      candidate !== cwd &&
      (await pathExists(candidate))
    ) {
      fallback = candidate
      break
    }
  }
  const warned = warnedMissingHookCwds()
  if (!warned.has(cwd)) {
    warned.add(cwd)
    logForDebugging(
      `Hooks: working directory ${cwd} no longer exists; running hooks from ${fallback} instead`,
      { level: 'warn' },
    )
  }
  return fallback
}

export function resetHookCwdFallbackWarningsForTests(): void {
  warnedMissingHookCwds().clear()
}
