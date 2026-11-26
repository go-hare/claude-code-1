/**
 * Package manager detection for Claude CLI
 */

import { realpathSync } from 'fs'
import { readFile } from 'fs/promises'
import { logForDebugging } from '../debug.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { getPlatform } from '../platform.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

type HostMemoized<Args extends unknown[], Result> = ((
  ...args: Args
) => Result) & {
  cache: Map<unknown, Result>
}

function memoizePerHost<Args extends unknown[], Result, Key = Args[0]>(
  fn: (...args: Args) => Result,
  resolver?: (...args: Args) => Key,
): HostMemoized<Args, Result> {
  const slot = new HostSlot<{ cache: Map<unknown, Result> }>(() => ({
    cache: new Map<unknown, Result>(),
  }))
  const memoized = (...args: Args): Result => {
    const key = resolver ? resolver(...args) : args[0]
    const cache = slot.of(getBootstrapSessionHost()).cache
    if (cache.has(key)) {
      return cache.get(key) as Result
    }
    const result = fn(...args)
    cache.set(key, result)
    return result
  }
  Object.defineProperty(memoized, 'cache', {
    get: () => slot.of(getBootstrapSessionHost()).cache,
    set: (next: Map<unknown, Result>) => {
      slot.of(getBootstrapSessionHost()).cache = next
    },
    configurable: true,
    enumerable: true,
  })
  return memoized as unknown as HostMemoized<Args, Result>
}

export type PackageManager =
  | 'homebrew'
  | 'winget'
  | 'pacman'
  | 'deb'
  | 'rpm'
  | 'apk'
  | 'mise'
  | 'asdf'
  | 'unknown'

/**
 * Parses /etc/os-release to extract the distro ID and ID_LIKE fields.
 * ID_LIKE identifies the distro family (e.g. Ubuntu has ID_LIKE=debian),
 * letting us skip package manager execs on distros that can't have them.
 * Returns null if the file is unreadable (pre-systemd or non-standard systems);
 * callers fall through to the exec in that case as a conservative fallback.
 */
export const getOsRelease = memoizePerHost(
  async (): Promise<{ id: string; idLike: string[] } | null> => {
    try {
      const content = await readFile('/etc/os-release', 'utf8')
      const idMatch = content.match(/^ID=["']?(\S+?)["']?\s*$/m)
      const idLikeMatch = content.match(/^ID_LIKE=["']?(.+?)["']?\s*$/m)
      return {
        id: idMatch?.[1] ?? '',
        idLike: idLikeMatch?.[1]?.split(' ') ?? [],
      }
    } catch {
      return null
    }
  },
)

function isDistroFamily(
  osRelease: { id: string; idLike: string[] },
  families: string[],
): boolean {
  return (
    families.includes(osRelease.id) ||
    osRelease.idLike.some(like => families.includes(like))
  )
}

/**
 * Detects if the currently running Claude instance was installed via mise
 * (a polyglot tool version manager) by checking if the executable path
 * is within a mise installs directory.
 *
 * mise installs to: ~/.local/share/mise/installs/<tool>/<version>/
 */
export function detectMise(): boolean {
  const execPath = process.execPath || process.argv[0] || ''

  // Check if the executable is within a mise installs directory
  if (/[/\\]mise[/\\]installs[/\\]/i.test(execPath)) {
    logForDebugging(`Detected mise installation: ${execPath}`)
    return true
  }

  return false
}

/**
 * Detects if the currently running Claude instance was installed via asdf
 * (another polyglot tool version manager) by checking if the executable path
 * is within an asdf installs directory.
 *
 * asdf installs to: ~/.asdf/installs/<tool>/<version>/
 */
export function detectAsdf(): boolean {
  const execPath = process.execPath || process.argv[0] || ''

  // Check if the executable is within an asdf installs directory
  if (/[/\\]\.?asdf[/\\]installs[/\\]/i.test(execPath)) {
    logForDebugging(`Detected asdf installation: ${execPath}`)
    return true
  }

  return false
}

/**
 * Detects if the currently running Claude instance was installed via Homebrew
 * by checking if the executable path is within a Homebrew Caskroom directory.
 *
 * Note: We specifically check for Caskroom because npm can also be installed via
 * Homebrew, which would place npm global packages under the same Homebrew prefix
 * (e.g., /opt/homebrew/lib/node_modules). We need to distinguish between:
 * - Homebrew cask: /opt/homebrew/Caskroom/claude-code/...
 * - npm-global (via Homebrew's npm): /opt/homebrew/lib/node_modules/@anthropic-ai/...
 */
export function detectHomebrew(): boolean {
  const platform = getPlatform()

  // Homebrew is only for macOS and Linux
  if (platform !== 'macos' && platform !== 'linux' && platform !== 'wsl') {
    return false
  }

  // Get the path of the currently running executable
  const execPath = process.execPath || process.argv[0] || ''

  // Check if the executable is within a Homebrew Caskroom directory
  // This is specific to Homebrew cask installations
  if (execPath.includes('/Caskroom/')) {
    logForDebugging(`Detected Homebrew cask installation: ${execPath}`)
    return true
  }

  return false
}

/**
 * Extracts the Homebrew cask name (e.g. `claude-code` or `claude-code@latest`)
 * from the running executable path (or its resolved realpath).
 * Matches official 2.1.328 `GKt` (`@300413606`).
 */
export function getHomebrewCaskName(): string | null {
  const execPath = process.execPath || process.argv[0] || ''
  const direct = execPath.match(/\/Caskroom\/([^/]+)\//)?.[1]
  if (direct) {
    return direct
  }
  if (execPath) {
    try {
      const resolved = realpathSync(execPath)
      return resolved.match(/\/Caskroom\/([^/]+)\//)?.[1] ?? null
    } catch {
      // execPath may not exist on disk in tests or virtual filesystems
    }
  }
  return null
}

/**
 * Detects if the currently running Claude instance was installed via winget
 * by checking if the executable path is within a WinGet directory.
 *
 * Winget installs to:
 * - User: %LOCALAPPDATA%\Microsoft\WinGet\Packages
 * - System: C:\Program Files\WinGet\Packages
 * And creates links at: %LOCALAPPDATA%\Microsoft\WinGet\Links\
 */
export function detectWinget(): boolean {
  const platform = getPlatform()

  // Winget is only for Windows
  if (platform !== 'windows') {
    return false
  }

  const execPath = process.execPath || process.argv[0] || ''

  // Check for WinGet paths (handles both forward and backslashes)
  const wingetPatterns = [
    /Microsoft[/\\]WinGet[/\\]Packages/i,
    /Microsoft[/\\]WinGet[/\\]Links/i,
  ]

  for (const pattern of wingetPatterns) {
    if (pattern.test(execPath)) {
      logForDebugging(`Detected winget installation: ${execPath}`)
      return true
    }
  }

  return false
}

/**
 * Detects if the currently running Claude instance was installed via pacman
 * by querying pacman's database for file ownership.
 *
 * We gate on the Arch distro family before invoking pacman. On other distros
 * like Ubuntu/Debian, 'pacman' in PATH may resolve to the pacman game
 * (/usr/games/pacman) rather than the Arch package manager.
 */
export const detectPacman = memoizePerHost(async (): Promise<boolean> => {
  const platform = getPlatform()

  if (platform !== 'linux') {
    return false
  }

  const osRelease = await getOsRelease()
  if (osRelease && !isDistroFamily(osRelease, ['arch'])) {
    return false
  }

  const execPath = process.execPath || process.argv[0] || ''

  const result = await execFileNoThrow('pacman', ['-Qo', execPath], {
    timeout: 5000,
    useCwd: false,
  })

  if (result.code === 0 && result.stdout) {
    logForDebugging(`Detected pacman installation: ${result.stdout.trim()}`)
    return true
  }

  return false
})

/**
 * Detects if the currently running Claude instance was installed via a .deb package
 * by querying dpkg's database for file ownership.
 *
 * We use `dpkg -S <execPath>` to check if the executable is owned by a dpkg-managed package.
 */
export const detectDeb = memoizePerHost(async (): Promise<boolean> => {
  const platform = getPlatform()

  if (platform !== 'linux') {
    return false
  }

  const osRelease = await getOsRelease()
  if (osRelease && !isDistroFamily(osRelease, ['debian'])) {
    return false
  }

  const execPath = process.execPath || process.argv[0] || ''

  const result = await execFileNoThrow('dpkg', ['-S', execPath], {
    timeout: 5000,
    useCwd: false,
  })

  if (result.code === 0 && result.stdout) {
    logForDebugging(`Detected deb installation: ${result.stdout.trim()}`)
    return true
  }

  return false
})

/**
 * Detects if the currently running Claude instance was installed via an RPM package
 * by querying the RPM database for file ownership.
 *
 * We use `rpm -qf <execPath>` to check if the executable is owned by an RPM package.
 */
export const detectRpm = memoizePerHost(async (): Promise<boolean> => {
  const platform = getPlatform()

  if (platform !== 'linux') {
    return false
  }

  const osRelease = await getOsRelease()
  if (osRelease && !isDistroFamily(osRelease, ['fedora', 'rhel', 'suse'])) {
    return false
  }

  const execPath = process.execPath || process.argv[0] || ''

  const result = await execFileNoThrow('rpm', ['-qf', execPath], {
    timeout: 5000,
    useCwd: false,
  })

  if (result.code === 0 && result.stdout) {
    logForDebugging(`Detected rpm installation: ${result.stdout.trim()}`)
    return true
  }

  return false
})

/**
 * Detects if the currently running Claude instance was installed via Alpine APK
 * by querying apk's database for file ownership.
 *
 * We use `apk info --who-owns <execPath>` to check if the executable is owned
 * by an apk-managed package.
 */
export const detectApk = memoizePerHost(async (): Promise<boolean> => {
  const platform = getPlatform()

  if (platform !== 'linux') {
    return false
  }

  const osRelease = await getOsRelease()
  if (osRelease && !isDistroFamily(osRelease, ['alpine'])) {
    return false
  }

  const execPath = process.execPath || process.argv[0] || ''

  const result = await execFileNoThrow(
    'apk',
    ['info', '--who-owns', execPath],
    {
      timeout: 5000,
      useCwd: false,
    },
  )

  if (result.code === 0 && result.stdout) {
    logForDebugging(`Detected apk installation: ${result.stdout.trim()}`)
    return true
  }

  return false
})

/**
 * Memoized function to detect which package manager installed Claude
 * Returns 'unknown' if no package manager is detected
 */
export const getPackageManager = memoizePerHost(
  async (): Promise<PackageManager> => {
    if (detectHomebrew()) {
      return 'homebrew'
    }

    if (detectWinget()) {
      return 'winget'
    }

    if (detectMise()) {
      return 'mise'
    }

    if (detectAsdf()) {
      return 'asdf'
    }

    if (await detectPacman()) {
      return 'pacman'
    }

    if (await detectApk()) {
      return 'apk'
    }

    if (await detectDeb()) {
      return 'deb'
    }

    if (await detectRpm()) {
      return 'rpm'
    }

    return 'unknown'
  },
)
