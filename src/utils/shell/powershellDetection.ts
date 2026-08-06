import { readlink, realpath, stat } from 'fs/promises'
import { join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getPlatform } from '../platform.js'
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
 * densable `YKh` — find PowerShell, preferring Core (pwsh) over Desktop 5.1.
 *
 * Order (densable 2.1.212):
 * 1. `which("pwsh")` (+ Linux snap → /opt/microsoft|/usr/bin workaround)
 * 2. Windows fixed paths when PATH has no pwsh:
 *    - `%ProgramFiles%\PowerShell\7\pwsh.exe`
 *    - `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` (via readlink)
 *    - `%USERPROFILE%\.dotnet\tools\pwsh.exe`
 * 3. `which("powershell")` (5.1)
 * 4. Windows `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\powershell.exe`
 *
 * #11: when GP blocks PS5.1, uv_spawn fails if only 5.1 is on PATH; probing
 * ProgramFiles\PowerShell\7 first keeps daemon/bg/hooks on PS7.
 */
export async function findPowerShell(): Promise<string | null> {
  // Official CLAUDE_CODE_TEST_NO_PWSH — force "not found" for tests.
  if (
    (
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    ).isTestNoPwsh()
  ) {
    return null
  }

  const pwshPath = await which('pwsh')
  if (pwshPath) {
    // densable snap_workaround: PATH/snap launcher hangs in subprocesses.
    if (getPlatform() === 'linux') {
      const resolved = await realpath(pwshPath).catch(() => pwshPath)
      if (pwshPath.startsWith('/snap/') || resolved.startsWith('/snap/')) {
        const direct =
          (await probePath('/opt/microsoft/powershell/7/pwsh')) ??
          (await probePath('/usr/bin/pwsh'))
        if (direct) {
          const directResolved = await realpath(direct).catch(() => direct)
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

  // densable windows_fallback_path: fixed PS7 locations when `which(pwsh)` misses.
  // Covers MSI install not on PATH, Store alias, and dotnet tool install.
  if (getPlatform() === 'windows') {
    const programFiles = process.env.ProgramFiles
    const localAppData = process.env.LOCALAPPDATA
    const userProfile = process.env.USERPROFILE
    const fixed =
      (programFiles
        ? await probePath(join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
        : null) ??
      (localAppData
        ? await probeWindowsAppsAlias(
            join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
          )
        : null) ??
      (userProfile
        ? await probePath(join(userProfile, '.dotnet', 'tools', 'pwsh.exe'))
        : null)
    if (fixed) {
      logPsDetectFallback('windows_fallback_path')
      return fixed
    }
  }

  const powershellPath = await which('powershell')
  if (powershellPath) {
    logPsDetectFallback('fell_back_to_powershell_5')
    return powershellPath
  }

  // densable absolute 5.1 when PATH `powershell` is missing/blocked.
  if (getPlatform() === 'windows') {
    const systemRoot = process.env.SYSTEMROOT ?? 'C:\\Windows'
    const desktop = await probePath(
      join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
    )
    if (desktop) {
      logPsDetectFallback('fell_back_to_powershell_5')
      return desktop
    }
  }

  return null
}

let cachedPowerShellPath: Promise<string | null> | null = null

/**
 * densable `pX` — memoized PowerShell path (session).
 */
export function getCachedPowerShellPath(): Promise<string | null> {
  if (!cachedPowerShellPath) {
    cachedPowerShellPath = findPowerShell()
  }
  return cachedPowerShellPath
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
  cachedPowerShellPath = null
}
