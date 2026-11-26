import { readlink, realpath, stat } from 'fs/promises'
import { join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getPlatform } from '../platform.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { which } from '../which.js'

/**
 * densable `CKt` — probe a path is a regular file.
 */
async function probePath(p: string): Promise<string | null> {
  try {
    return (await stat(p)).isFile() ? p : null
  } catch {
    return null
  }
}

/**
 * densable `KKh` — resolve WindowsApps store alias (readlink → probe target).
 * Store app execution aliases are reparse points; plain stat may fail or hang.
 */
async function probeWindowsAppsAlias(p: string): Promise<string | null> {
  let target: string
  try {
    target = await readlink(p)
  } catch {
    return null
  }
  return probePath(target)
}

/**
 * densable `Be("shell_powershell_detect", reason)` — fallback path telemetry.
 */
function logPsDetectFallback(reason: string): void {
  logEvent('shell_powershell_detect', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * densable `Ae("shell_powershell_detect")` — PATH pwsh success (no fallback).
 */
function logPsDetectPathHit(): void {
  logEvent('shell_powershell_detect', {})
}

/**
 * Official 2.1.327 #485 (`Ie`): detect WindowsApps store alias path.
 */
function isWindowsAppsStoreAliasPath(p: string): boolean {
  const parts = p
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts.at(-2) === 'windowsapps' && parts.at(-3) === 'microsoft'
}

export type FindPowerShellDeps = {
  platform?: ReturnType<typeof getPlatform>
  env?: {
    ProgramFiles?: string
    LOCALAPPDATA?: string
    USERPROFILE?: string
    SYSTEMROOT?: string
  }
  whichFn?: (bin: string) => Promise<string | null>
  probePathFn?: (p: string) => Promise<string | null>
  probeWindowsAppsAliasFn?: (p: string) => Promise<string | null>
  realpathFn?: (p: string) => Promise<string>
}

/**
 * densable `YKh` + Official 2.1.327 #485 (`oe` @291979228) — find PowerShell,
 * preferring Core (pwsh) over Desktop 5.1.
 *
 * Order (2.1.327):
 * 1. `which("pwsh")` (+ WindowsApps store alias resolution; Linux snap workaround)
 * 2. On Windows, check all standard install locations CONCURRENTLY via `Promise.all`:
 *    - `%ProgramFiles%\PowerShell\7\pwsh.exe`
 *    - `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` (via readlink)
 *    - `%USERPROFILE%\.dotnet\tools\pwsh.exe`
 *    - `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\powershell.exe`
 *    Prefer PS7 if found; otherwise System32's `powershell.exe` wins over any
 *    `powershell.exe` earlier on PATH.
 * 3. `which("powershell")` (fallback when System32 check did not find 5.1)
 */
export async function findPowerShell(
  deps?: FindPowerShellDeps,
): Promise<string | null> {
  // Official CLAUDE_CODE_TEST_NO_PWSH — force "not found" for tests.
  if (
    !deps &&
    (
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    ).isTestNoPwsh()
  ) {
    return null
  }

  const platform = deps?.platform ?? getPlatform()
  const whichFn = deps?.whichFn ?? which
  const probePathFn = deps?.probePathFn ?? probePath
  const probeAliasFn = deps?.probeWindowsAppsAliasFn ?? probeWindowsAppsAlias
  const realpathFn = deps?.realpathFn ?? realpath
  const env = deps?.env ?? process.env

  let pwshPath = await whichFn('pwsh')
  if (
    pwshPath &&
    platform === 'windows' &&
    isWindowsAppsStoreAliasPath(pwshPath)
  ) {
    const resolvedAlias = await probeAliasFn(pwshPath)
    if (resolvedAlias) {
      logPsDetectFallback('store_alias_on_path')
      return resolvedAlias
    }
    pwshPath = null
  }
  if (pwshPath) {
    // densable snap_workaround: PATH/snap launcher hangs in subprocesses.
    if (platform === 'linux') {
      const resolved = await realpathFn(pwshPath).catch(() => pwshPath)
      if (pwshPath.startsWith('/snap/') || resolved.startsWith('/snap/')) {
        const direct =
          (await probePathFn('/opt/microsoft/powershell/7/pwsh')) ??
          (await probePathFn('/usr/bin/pwsh'))
        if (direct) {
          const directResolved = await realpathFn(direct).catch(() => direct)
          if (
            !direct.startsWith('/snap/') &&
            !directResolved.startsWith('/snap/')
          ) {
            logPsDetectFallback('snap_workaround')
            return direct
          }
        }
      }
    }
    logPsDetectPathHit()
    return pwshPath
  }

  // Official 2.1.327 #485: check all Windows standard install locations
  // concurrently in a single Promise.all. Prefer PS7; otherwise System32's
  // powershell.exe wins over a powershell.exe earlier on PATH.
  if (platform === 'windows') {
    const programFiles = env.ProgramFiles
    const localAppData = env.LOCALAPPDATA
    const userProfile = env.USERPROFILE
    const systemRoot = env.SYSTEMROOT || 'C:\\Windows'
    const [msiPs7, storePs7, dotnetPs7, system32Ps5] = await Promise.all([
      programFiles
        ? probePathFn(join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
        : null,
      localAppData
        ? probeAliasFn(
            join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
          )
        : null,
      userProfile
        ? probePathFn(join(userProfile, '.dotnet', 'tools', 'pwsh.exe'))
        : null,
      probePathFn(
        join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
      ),
    ])
    const ps7 = msiPs7 ?? storePs7 ?? dotnetPs7
    if (ps7) {
      logPsDetectFallback('windows_fallback_path')
      return ps7
    }
    if (system32Ps5) {
      logPsDetectFallback('fell_back_to_powershell_5')
      return system32Ps5
    }
  }

  const powershellPath = await whichFn('powershell')
  if (powershellPath) {
    logPsDetectFallback('fell_back_to_powershell_5')
    return powershellPath
  }

  return null
}

const powerShellPathHostSlot = new HostSlot<{
  cachedPowerShellPath: Promise<string | null> | null
}>(() => ({
  cachedPowerShellPath: null,
}))

function getPowerShellHostState(): {
  cachedPowerShellPath: Promise<string | null> | null
} {
  return powerShellPathHostSlot.of(getBootstrapSessionHost())
}

/**
 * densable `pX` — memoized PowerShell path (session).
 */
export function getCachedPowerShellPath(): Promise<string | null> {
  const hostState = getPowerShellHostState()
  if (!hostState.cachedPowerShellPath) {
    hostState.cachedPowerShellPath = findPowerShell()
  }
  return hostState.cachedPowerShellPath
}

export type PowerShellEdition = 'core' | 'desktop'

/**
 * densable `WBr` — edition from basename without spawning.
 * - `pwsh` / `pwsh.exe` → 'core' (PowerShell 7+)
 * - `powershell` / `powershell.exe` → 'desktop' (Windows PowerShell 5.1)
 */
export async function getPowerShellEdition(): Promise<PowerShellEdition | null> {
  const p = await getCachedPowerShellPath()
  if (!p) return null
  const base = p
    .split(/[/\\]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '')
  return base === 'pwsh' ? 'core' : 'desktop'
}

/**
 * Resets the cached PowerShell path. Only for testing.
 */
export function resetPowerShellCache(): void {
  getPowerShellHostState().cachedPowerShellPath = null
}
