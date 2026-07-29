import { access, readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isFsInaccessible } from '../errors.js'

export const CHROME_EXTENSION_URL = 'https://claude.ai/chrome'

// Production extension ID (Chrome Web Store / official key)
export const PROD_EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'
/**
 * go-hare / agent-extension fork (custom manifest.key).
 * Default-allow so local Connect works without CLAUDE_CHROME_EXTENSION_IDS.
 * Official store id stays first so densable + Web Store installs still match.
 */
export const FORK_EXTENSION_ID = 'bbkeopmjdjdiiaahndbbjhckdbgblpjn'
// Dev extension IDs (for internal use)
const DEV_EXTENSION_ID = 'dihbgbndebgnbjfmelmegjepbnkhlgni'
const ANT_EXTENSION_ID = 'dngcpimnedloihjnnfngkgjoidhnaolf'

/** Chromium extension ids are 32 chars in a–p (public-key hash encoding). */
const CHROME_EXTENSION_ID_RE = /^[a-p]{32}$/

/**
 * Extra ids from `CLAUDE_CHROME_EXTENSION_IDS` (comma-separated).
 * Appended on top of official + built-in fork ids.
 */
export function parseExtraChromeExtensionIds(
  raw: string | undefined = process.env.CLAUDE_CHROME_EXTENSION_IDS,
): string[] {
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase()
    if (!id || seen.has(id)) continue
    if (!CHROME_EXTENSION_ID_RE.test(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Extension ids accepted for install detection + native-host allowed_origins.
 * Always: official store + hare fork; optional ant ids; optional env extras.
 */
export function getClaudeChromeExtensionIds(): string[] {
  const ids: string[] = [PROD_EXTENSION_ID, FORK_EXTENSION_ID]
  if (process.env.USER_TYPE === 'ant') {
    ids.push(DEV_EXTENSION_ID, ANT_EXTENSION_ID)
  }
  for (const extra of parseExtraChromeExtensionIds()) {
    if (!ids.includes(extra)) ids.push(extra)
  }
  return ids
}

/** @deprecated use getClaudeChromeExtensionIds — kept as internal alias */
function getExtensionIds(): string[] {
  return getClaudeChromeExtensionIds()
}

// Must match ChromiumBrowser from common.ts
export type ChromiumBrowser =
  | 'chrome'
  | 'brave'
  | 'arc'
  | 'chromium'
  | 'edge'
  | 'vivaldi'
  | 'opera'

export type BrowserPath = {
  browser: ChromiumBrowser
  path: string
}

type Logger = (message: string) => void

// Browser detection order - must match BROWSER_DETECTION_ORDER from common.ts
const BROWSER_DETECTION_ORDER: ChromiumBrowser[] = [
  'chrome',
  'brave',
  'arc',
  'edge',
  'chromium',
  'vivaldi',
  'opera',
]

type BrowserDataConfig = {
  macos: string[]
  linux: string[]
  windows: { path: string[]; useRoaming?: boolean }
}

// Must match CHROMIUM_BROWSERS dataPath from common.ts
const CHROMIUM_BROWSERS: Record<ChromiumBrowser, BrowserDataConfig> = {
  chrome: {
    macos: ['Library', 'Application Support', 'Google', 'Chrome'],
    linux: ['.config', 'google-chrome'],
    windows: { path: ['Google', 'Chrome', 'User Data'] },
  },
  brave: {
    macos: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
    linux: ['.config', 'BraveSoftware', 'Brave-Browser'],
    windows: { path: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  },
  arc: {
    macos: ['Library', 'Application Support', 'Arc', 'User Data'],
    linux: [],
    windows: { path: ['Arc', 'User Data'] },
  },
  chromium: {
    macos: ['Library', 'Application Support', 'Chromium'],
    linux: ['.config', 'chromium'],
    windows: { path: ['Chromium', 'User Data'] },
  },
  edge: {
    macos: ['Library', 'Application Support', 'Microsoft Edge'],
    linux: ['.config', 'microsoft-edge'],
    windows: { path: ['Microsoft', 'Edge', 'User Data'] },
  },
  vivaldi: {
    macos: ['Library', 'Application Support', 'Vivaldi'],
    linux: ['.config', 'vivaldi'],
    windows: { path: ['Vivaldi', 'User Data'] },
  },
  opera: {
    macos: ['Library', 'Application Support', 'com.operasoftware.Opera'],
    linux: ['.config', 'opera'],
    windows: { path: ['Opera Software', 'Opera Stable'], useRoaming: true },
  },
}

/**
 * Get all browser data paths to check for extension installation.
 * Portable version that uses process.platform directly.
 */
export function getAllBrowserDataPathsPortable(): BrowserPath[] {
  const home = homedir()
  const paths: BrowserPath[] = []

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]
    let dataPath: string[] | undefined

    switch (process.platform) {
      case 'darwin':
        dataPath = config.macos
        break
      case 'linux':
        dataPath = config.linux
        break
      case 'win32': {
        if (config.windows.path.length > 0) {
          const appDataBase = config.windows.useRoaming
            ? join(home, 'AppData', 'Roaming')
            : join(home, 'AppData', 'Local')
          paths.push({
            browser: browserId,
            path: join(appDataBase, ...config.windows.path),
          })
        }
        continue
      }
    }

    if (dataPath && dataPath.length > 0) {
      paths.push({
        browser: browserId,
        path: join(home, ...dataPath),
      })
    }
  }

  return paths
}

/**
 * True when Chrome preferences mark the extension as disabled.
 * disable_reasons may be a list (older) or object map (newer Chromium).
 * state === 0 is the classic disabled flag when present.
 */
function isExtensionPrefsDisabled(meta: Record<string, unknown>): boolean {
  if (meta.state === 0) {
    return true
  }
  const reasons = meta.disable_reasons
  if (Array.isArray(reasons) && reasons.length > 0) {
    return true
  }
  if (
    reasons !== null &&
    typeof reasons === 'object' &&
    !Array.isArray(reasons) &&
    Object.keys(reasons as object).length > 0
  ) {
    return true
  }
  return false
}

/**
 * Web-store / packed installs live under `<profile>/Extensions/<id>/`.
 * Developer unpacked loads (Load unpacked) keep the official id via manifest
 * `key` but only appear under Preferences / Secure Preferences with an absolute
 * `path` — they never create `Extensions/<id>/`. Local forks often ship this way.
 */
async function profileHasExtension(
  browserBasePath: string,
  profile: string,
  extensionId: string,
  log?: Logger,
): Promise<boolean> {
  const packedPath = join(browserBasePath, profile, 'Extensions', extensionId)
  try {
    await readdir(packedPath)
    log?.(
      `[Claude in Chrome] Extension ${extensionId} found (packed) in ${profile}`,
    )
    return true
  } catch {
    // fall through to preferences (unpacked)
  }

  for (const prefName of ['Secure Preferences', 'Preferences'] as const) {
    const prefPath = join(browserBasePath, profile, prefName)
    let raw: string
    try {
      raw = await readFile(prefPath, 'utf-8')
    } catch (e) {
      if (isFsInaccessible(e)) continue
      throw e
    }

    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    if (!data || typeof data !== 'object') continue
    const settings = (data as { extensions?: { settings?: unknown } })
      .extensions?.settings
    if (!settings || typeof settings !== 'object') continue
    const meta = (settings as Record<string, unknown>)[extensionId]
    if (!meta || typeof meta !== 'object') continue
    const record = meta as Record<string, unknown>
    if (isExtensionPrefsDisabled(record)) {
      log?.(
        `[Claude in Chrome] Extension ${extensionId} present but disabled in ${profile}/${prefName}`,
      )
      continue
    }
    const installPath = record.path
    if (typeof installPath !== 'string' || installPath.length === 0) {
      continue
    }
    // Absolute unpacked path: require directory still exists.
    // Relative path is under the profile (component/external) — prefs entry is enough.
    if (installPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(installPath)) {
      try {
        await access(installPath)
      } catch {
        log?.(
          `[Claude in Chrome] Extension ${extensionId} prefs path missing: ${installPath}`,
        )
        continue
      }
    }
    log?.(
      `[Claude in Chrome] Extension ${extensionId} found (prefs/${prefName}) in ${profile} path=${installPath}`,
    )
    return true
  }

  return false
}

/**
 * Detects if the Claude in Chrome extension is installed by checking the Extensions
 * directory and Chrome Preferences / Secure Preferences (unpacked developer installs)
 * across all supported Chromium-based browsers and their profiles.
 *
 * This is a portable version that can be used by both TUI and VS Code extension.
 *
 * @param browserPaths - Array of browser data paths to check (from getAllBrowserDataPaths)
 * @param log - Optional logging callback for debug messages
 * @returns Object with isInstalled boolean and the browser where the extension was found
 */
export async function detectExtensionInstallationPortable(
  browserPaths: BrowserPath[],
  log?: Logger,
): Promise<{
  isInstalled: boolean
  browser: ChromiumBrowser | null
}> {
  if (browserPaths.length === 0) {
    log?.(`[Claude in Chrome] No browser paths to check`)
    return { isInstalled: false, browser: null }
  }

  const extensionIds = getExtensionIds()

  // Check each browser for the extension
  for (const { browser, path: browserBasePath } of browserPaths) {
    let browserProfileEntries = []

    try {
      browserProfileEntries = await readdir(browserBasePath, {
        withFileTypes: true,
      })
    } catch (e) {
      // Browser not installed or path doesn't exist, continue to next browser
      if (isFsInaccessible(e)) continue
      throw e
    }

    const profileDirs = browserProfileEntries
      .filter(entry => entry.isDirectory())
      .filter(
        entry => entry.name === 'Default' || entry.name.startsWith('Profile '),
      )
      .map(entry => entry.name)

    if (profileDirs.length > 0) {
      log?.(
        `[Claude in Chrome] Found ${browser} profiles: ${profileDirs.join(', ')}`,
      )
    }

    // Check each profile for any of the extension IDs (packed + unpacked prefs)
    for (const profile of profileDirs) {
      for (const extensionId of extensionIds) {
        if (
          await profileHasExtension(browserBasePath, profile, extensionId, log)
        ) {
          log?.(
            `[Claude in Chrome] Extension ${extensionId} found in ${browser} ${profile}`,
          )
          return { isInstalled: true, browser }
        }
      }
    }
  }

  log?.(`[Claude in Chrome] Extension not found in any browser`)
  return { isInstalled: false, browser: null }
}

/**
 * Simple wrapper that returns just the boolean result
 */
export async function isChromeExtensionInstalledPortable(
  browserPaths: BrowserPath[],
  log?: Logger,
): Promise<boolean> {
  const result = await detectExtensionInstallationPortable(browserPaths, log)
  return result.isInstalled
}

/**
 * Convenience function that gets browser paths automatically.
 * Use this when you don't need to provide custom browser paths.
 */
export function isChromeExtensionInstalled(log?: Logger): Promise<boolean> {
  const browserPaths = getAllBrowserDataPathsPortable()
  return isChromeExtensionInstalledPortable(browserPaths, log)
}
