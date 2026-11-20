/**
 * Package-manager auto-update helpers (Homebrew, winget, mise, apk).
 * Aligns with official 2.1.328 `Bn`, `Fn`, `or`, `vWt`, `kt`/`a9n`.
 */

import axios from 'axios'
import { join } from 'path'
import semver from 'semver'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import type { PackageManager } from './nativeInstaller/packageManagers.js'
import { getEssentialTrafficOnlyReason } from './privacyLevel.js'
import { jsonStringify } from './slowOperations.js'

/**
 * Official CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE portable gate.
 * Returns:
 * - true when env force-enables
 * - false when env force-disables
 * - undefined when unset (caller uses existing defaults)
 */
export function resolvePackageManagerAutoUpdateFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  if (isEnvTruthy(env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE)) return true
  if (isEnvDefinedFalsy(env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE)) {
    return false
  }
  return undefined
}

/** Cooldown after a failed package-manager update attempt (30 minutes). */
export const PACKAGE_MANAGER_FAILURE_COOLDOWN_MS = 1_800_000

let packageManagerUpdateLastFailedAt = 0

/**
 * Opt-in gate for spawning package manager upgrades (`brew`/`winget`).
 * Never bypasses `isAutoUpdaterDisabled()`.
 */
export function isPackageManagerAutoUpdateOptedIn(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE)
}

/**
 * Build argv for running a non-interactive package-manager upgrade, or null
 * for package managers that only support manual upgrade prompts.
 * Matches official 2.1.328 `Bn`.
 */
export function getPackageManagerUpgradeArgs(
  pm: PackageManager,
  caskName?: string | null,
): string[] | null {
  switch (pm) {
    case 'homebrew':
      return ['brew', 'upgrade', '--cask', caskName ?? 'claude-code']
    case 'winget': {
      const localAppData = process.env.LOCALAPPDATA
      const wingetExe = localAppData
        ? join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe')
        : 'winget'
      return [
        wingetExe,
        'upgrade',
        '--id',
        'Anthropic.ClaudeCode',
        '--exact',
        '--silent',
        '--disable-interactivity',
      ]
    }
    default:
      return null
  }
}

/**
 * Human-readable manual upgrade command shown in notifications and prompts.
 * Matches official 2.1.328 `Fn`.
 */
export function getPackageManagerManualUpgradeCommand(
  pm: PackageManager,
  caskName?: string | null,
): string {
  switch (pm) {
    case 'homebrew':
      return `brew upgrade ${caskName ?? 'claude-code'}`
    case 'winget':
      return 'winget upgrade Anthropic.ClaudeCode'
    case 'mise':
      return 'mise upgrade claude'
    case 'apk':
      return 'apk upgrade claude-code'
    default:
      return 'your package manager update command'
  }
}

export function getPackageManagerUpdateLastFailedAt(): number {
  return packageManagerUpdateLastFailedAt
}

export function recordPackageManagerUpdateFailure(now?: number): void {
  packageManagerUpdateLastFailedAt = now ?? Date.now()
}

export function resetPackageManagerUpdateStateForTests(): void {
  packageManagerUpdateLastFailedAt = 0
}

/**
 * Fetch the latest version published for a Homebrew cask from formulae.brew.sh.
 * Matches official 2.1.328 `kt` (`@300379550`).
 */
export async function fetchHomebrewCaskLatestVersion(
  caskName: string,
): Promise<string | null> {
  if (getEssentialTrafficOnlyReason() !== null) {
    return null
  }
  try {
    const response = await axios.get<{ version?: unknown }>(
      `https://formulae.brew.sh/api/cask/${encodeURIComponent(caskName)}.json`,
      {
        timeout: 5000,
        responseType: 'json',
      },
    )
    const rawVersion = response.data?.version
    const version = typeof rawVersion === 'string' ? rawVersion.trim() : null
    if (!version || !semver.parse(version)) {
      logForDebugging(
        `formulae.brew.sh ${caskName} version is not a valid semver version — treating as no result`,
      )
      const preview =
        typeof response.data === 'string'
          ? response.data
          : String(jsonStringify(response.data))
      logForDebugging(
        `brew response (first 300 chars, JSON-encoded): ${JSON.stringify(preview.slice(0, 300))}`,
      )
      return null
    }
    return version
  } catch (err) {
    logForDebugging(`Failed to fetch ${caskName} from formulae.brew.sh: ${err}`)
    return null
  }
}
