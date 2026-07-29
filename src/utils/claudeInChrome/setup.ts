import {
  BRIDGE_ONLY_BROWSER_TOOLS,
  BROWSER_TOOLS,
} from '@ant/claude-for-chrome-mcp'
import { existsSync } from 'fs'
import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import {
  getChromeFlagOverride,
  getIsInteractive,
  getIsNonInteractiveSession,
  getSessionBypassPermissionsMode,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { isInBundledMode } from '../bundledMode.js'
import { distRoot } from '../distRoot.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from '../envUtils.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getPlatform } from '../platform.js'
import { jsonStringify } from '../slowOperations.js'
import { isChromeBridgeTransportEnabled } from './chromeBridgeTransport.js'
import {
  CLAUDE_IN_CHROME_MCP_SERVER_NAME,
  getAllBrowserDataPaths,
  getAllNativeMessagingHostsDirs,
  getAllWindowsRegistryKeys,
  openInChrome,
} from './common.js'
import { getChromeSystemPrompt } from './prompt.js'
import {
  getClaudeChromeExtensionIds,
  isChromeExtensionInstalledPortable,
} from './setupPortable.js'

const CHROME_EXTENSION_RECONNECT_URL = 'https://clau.de/chrome/reconnect'

const NATIVE_HOST_IDENTIFIER = 'com.anthropic.claude_code_browser_extension'
const NATIVE_HOST_MANIFEST_NAME = `${NATIVE_HOST_IDENTIFIER}.json`

/**
 * Path to the CLI entry used by native-host wrapper and non-bundled MCP spawn.
 *
 * `distRoot` in dev is the **repo root** (from `src/utils/…`), not `dist/`.
 * Prefer built `dist/cli.js` when present; else fall back to `src/entrypoints/cli.tsx`
 * so `bun run dev -- --chrome` does not write a dead `…/cli.js` wrapper.
 */
export function resolveChromeCliJsPath(): string {
  const built = join(distRoot, 'dist', 'cli.js')
  if (existsSync(built)) {
    return built
  }
  const atRoot = join(distRoot, 'cli.js')
  if (existsSync(atRoot)) {
    // Production layout when distRoot already points at the dist directory.
    return atRoot
  }
  const srcEntry = join(distRoot, 'src', 'entrypoints', 'cli.tsx')
  if (existsSync(srcEntry)) {
    return srcEntry
  }
  // Last resort — same as historical join(distRoot, 'cli.js')
  return atRoot
}

/**
 * densable 2.1.211 `Dtn` order:
 * flag true/false → CLAUDE_CODE_ENABLE_CFC true/false → non-interactive → defaultEnabled → false.
 * CFC must win over non-interactive so SDK/CI can force-enable without `--chrome`.
 */
export function shouldEnableClaudeInChrome(chromeFlag?: boolean): boolean {
  // Check CLI flags
  if (chromeFlag === true) {
    return true
  }
  if (chromeFlag === false) {
    return false
  }

  // Official ENABLE_CFC densable (before non-interactive gate).
  let cfcEnabled = isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_CFC)
  try {
    const { isCfcEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    cfcEnabled = isCfcEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (cfcEnabled) {
    return true
  }
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ENABLE_CFC)) {
    return false
  }

  // Disable by default in non-interactive sessions (e.g., SDK, CI) unless CFC/flag
  if (getIsNonInteractiveSession()) {
    return false
  }

  // Check default config settings
  const config = getGlobalConfig()
  if (config.claudeInChromeDefaultEnabled !== undefined) {
    return config.claudeInChromeDefaultEnabled
  }

  return false
}

let shouldAutoEnable: boolean | undefined

/**
 * densable 2.1.211 `YOs` ≈ `IRo() && (de_() || HRo()) && tengu_chrome_auto_enable`.
 * densable IRo ends with claude.ai subscriber; this fork drops that gate so
 * API-key / non-subscriber interactive sessions can auto-enable with extension evidence.
 * Remaining IRo-ish: flag not false, CFC not false, defaultEnabled unset, interactive.
 * HRo/de_: extension install cache or paired device evidence.
 */
export function shouldAutoEnableClaudeInChrome(): boolean {
  if (shouldAutoEnable !== undefined) {
    return shouldAutoEnable
  }

  shouldAutoEnable =
    hasBaseChromeAutoEnableEligibility() &&
    hasChromeExtensionEvidence() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_chrome_auto_enable', false)

  return shouldAutoEnable
}

/** densable `IRo` base gates — fork: no subscriber requirement. */
function hasBaseChromeAutoEnableEligibility(): boolean {
  if (getChromeFlagOverride() === false) {
    return false
  }
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ENABLE_CFC)) {
    return false
  }
  const config = getGlobalConfig()
  if (config.claudeInChromeDefaultEnabled !== undefined) {
    return false
  }
  if (!getIsInteractive()) {
    return false
  }
  return true
}

/** densable `HRo` ∪ positive `de_()` — install cache or bridge pairing evidence. */
function hasChromeExtensionEvidence(): boolean {
  // Side-effect: refresh positive install cache (same as densable de_).
  // Return value already reads cachedChromeExtensionInstalled from disk.
  if (isChromeExtensionInstalled_CACHED_MAY_BE_STALE()) {
    return true
  }
  return Boolean(getGlobalConfig().chromeExtension?.pairedDeviceId)
}

/**
 * densable ListTools: multi-browser tools only when copper bridge transport
 * is actually usable. Must match getChromeBridgeUrl() in mcpServer.
 */
function isChromeBridgeLikelyEnabled(env?: Record<string, string>): boolean {
  return isChromeBridgeTransportEnabled(env)
}

export type SetupClaudeInChromeOptions = {
  /**
   * Fork Connect local / unpacked: pin MCP to native Unix socket — no
   * claude.ai token, no bridge WebSocket. Does **not** change official
   * Reconnect (still opens clau.de). Official bridge remains available when
   * this is unset and the user has OAuth + copper flag.
   */
  forceNative?: boolean
}

/**
 * Setup Claude in Chrome MCP server and tools
 *
 * @returns MCP config and allowed tools, or throws an error if platform is unsupported
 */
export function setupClaudeInChrome(options?: SetupClaudeInChromeOptions): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  systemPrompt: string
} {
  const isNativeBuild = isInBundledMode()
  const env: Record<string, string> = {}
  if (options?.forceNative) {
    // In-process createChromeContext(serverRef.env) + stdio child both honor this.
    env.CLAUDE_CHROME_FORCE_NATIVE = '1'
  }
  if (getSessionBypassPermissionsMode()) {
    env.CLAUDE_CHROME_PERMISSION_MODE = 'skip_all_permission_checks'
  }
  const bridgeLikely = isChromeBridgeLikelyEnabled(env)
  const allowedTools = BROWSER_TOOLS.filter(
    tool => bridgeLikely || !BRIDGE_ONLY_BROWSER_TOOLS.has(tool.name),
  ).map(tool => `mcp__claude-in-chrome__${tool.name}`)

  const hasEnv = Object.keys(env).length > 0

  if (isNativeBuild) {
    // Create a wrapper script that calls the same binary with --chrome-native-host. This
    // is needed because the native host manifest "path" field cannot contain arguments.
    const execCommand = `"${process.execPath}" --chrome-native-host`

    // Run asynchronously without blocking; best-effort so swallow errors
    void createWrapperScript(execCommand)
      .then(manifestBinaryPath =>
        installChromeNativeHostManifest(manifestBinaryPath),
      )
      .catch(e =>
        logForDebugging(
          `[Claude in Chrome] Failed to install native host: ${e}`,
          { level: 'error' },
        ),
      )

    return {
      mcpConfig: {
        [CLAUDE_IN_CHROME_MCP_SERVER_NAME]: {
          type: 'stdio' as const,
          command: process.execPath,
          args: ['--claude-in-chrome-mcp'],
          scope: 'dynamic' as const,
          ...(hasEnv && { env }),
        },
      },
      allowedTools,
      systemPrompt: getChromeSystemPrompt(),
    }
  } else {
    const cliPath = resolveChromeCliJsPath()

    void createWrapperScript(
      `"${process.execPath}" "${cliPath}" --chrome-native-host`,
    )
      .then(manifestBinaryPath =>
        installChromeNativeHostManifest(manifestBinaryPath),
      )
      .catch(e =>
        logForDebugging(
          `[Claude in Chrome] Failed to install native host: ${e}`,
          { level: 'error' },
        ),
      )

    const mcpConfig = {
      [CLAUDE_IN_CHROME_MCP_SERVER_NAME]: {
        type: 'stdio' as const,
        command: process.execPath,
        args: [`${cliPath}`, '--claude-in-chrome-mcp'],
        scope: 'dynamic' as const,
        ...(hasEnv && { env }),
      },
    }

    return {
      mcpConfig,
      allowedTools,
      systemPrompt: getChromeSystemPrompt(),
    }
  }
}

/**
 * Get native messaging hosts directories for all supported browsers
 * Returns an array of directories where the native host manifest should be installed
 */
function getNativeMessagingHostsDirs(): string[] {
  const platform = getPlatform()

  if (platform === 'windows') {
    // Windows uses a single location with registry entries pointing to it
    const home = homedir()
    const appData = process.env.APPDATA || join(home, 'AppData', 'Local')
    return [join(appData, 'Claude Code', 'ChromeNativeHost')]
  }

  // macOS and Linux: return all browser native messaging directories
  return getAllNativeMessagingHostsDirs().map(({ path }) => path)
}

export type InstallChromeNativeHostOptions = {
  /**
   * densable opens https://clau.de/chrome/reconnect after first manifest write
   * so the Web Store extension re-binds. Local unpacked / fork menus pass false
   * and never open a browser tab.
   */
  openReconnectPage?: boolean
}

export async function installChromeNativeHostManifest(
  manifestBinaryPath: string,
  options?: InstallChromeNativeHostOptions,
): Promise<void> {
  const openReconnectPage = options?.openReconnectPage !== false
  const manifestDirs = getNativeMessagingHostsDirs()
  if (manifestDirs.length === 0) {
    throw Error('Claude in Chrome Native Host not supported on this platform')
  }

  // Official store id + optional CLAUDE_CHROME_EXTENSION_IDS (local forks).
  // Connect local rewrites this file — hand-editing alone will be overwritten.
  const manifest = {
    name: NATIVE_HOST_IDENTIFIER,
    description: 'Claude Code Browser Extension Native Host',
    path: manifestBinaryPath,
    type: 'stdio',
    allowed_origins: getClaudeChromeExtensionIds().map(
      id => `chrome-extension://${id}/`,
    ),
  }

  const manifestContent = jsonStringify(manifest, null, 2)
  let anyManifestUpdated = false

  // Install manifest to all browser directories
  for (const manifestDir of manifestDirs) {
    const manifestPath = join(manifestDir, NATIVE_HOST_MANIFEST_NAME)

    // Check if content matches to avoid unnecessary writes
    const existingContent = await readFile(manifestPath, 'utf-8').catch(
      () => null,
    )
    if (existingContent === manifestContent) {
      continue
    }

    try {
      await mkdir(manifestDir, { recursive: true })
      await writeFile(manifestPath, manifestContent)
      logForDebugging(
        `[Claude in Chrome] Installed native host manifest at: ${manifestPath}`,
      )
      anyManifestUpdated = true
    } catch (error) {
      // Log but don't fail - the browser might not be installed
      logForDebugging(
        `[Claude in Chrome] Failed to install manifest at ${manifestPath}: ${error}`,
      )
    }
  }

  // Windows requires registry entries pointing to the manifest for each browser
  if (getPlatform() === 'windows') {
    const manifestPath = join(manifestDirs[0]!, NATIVE_HOST_MANIFEST_NAME)
    registerWindowsNativeHosts(manifestPath)
  }

  // densable: open reconnect page so Web Store extension re-binds after first write.
  // Local connect path opts out via openReconnectPage: false.
  if (anyManifestUpdated && openReconnectPage) {
    void isChromeExtensionInstalled().then(isInstalled => {
      if (isInstalled) {
        logForDebugging(
          `[Claude in Chrome] First-time install detected, opening reconnect page in browser`,
        )
        void openInChrome(CHROME_EXTENSION_RECONNECT_URL)
      } else {
        logForDebugging(
          `[Claude in Chrome] First-time install detected, but extension not installed, skipping reconnect`,
        )
      }
    })
  }
}

/**
 * Fork: reinstall native-messaging wrapper + manifest for local extension
 * (unpacked / Load unpacked) without opening claude.ai reconnect.
 * Returns wrapper path and whether the extension is currently detected.
 */
export async function ensureChromeNativeHostLocal(): Promise<{
  wrapperPath: string
  extensionInstalled: boolean
  cliPath: string | null
}> {
  const isNativeBuild = isInBundledMode()
  const cliPath = isNativeBuild ? null : resolveChromeCliJsPath()
  const execCommand = isNativeBuild
    ? `"${process.execPath}" --chrome-native-host`
    : `"${process.execPath}" "${cliPath}" --chrome-native-host`

  const wrapperPath = await createWrapperScript(execCommand)
  await installChromeNativeHostManifest(wrapperPath, {
    openReconnectPage: false,
  })
  const extensionInstalled = await isChromeExtensionInstalled()
  logForDebugging(
    `[Claude in Chrome] Local native host ready wrapper=${wrapperPath} cliPath=${cliPath ?? '(bundled)'} extensionInstalled=${extensionInstalled}`,
  )
  return { wrapperPath, extensionInstalled, cliPath }
}

/**
 * Register the native host in Windows registry for all supported browsers
 */
function registerWindowsNativeHosts(manifestPath: string): void {
  const registryKeys = getAllWindowsRegistryKeys()

  for (const { browser, key } of registryKeys) {
    const fullKey = `${key}\\${NATIVE_HOST_IDENTIFIER}`
    // Use reg.exe to add the registry entry
    // https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
    void execFileNoThrowWithCwd('reg', [
      'add',
      fullKey,
      '/ve', // Set the default (unnamed) value
      '/t',
      'REG_SZ',
      '/d',
      manifestPath,
      '/f', // Force overwrite without prompt
    ]).then(result => {
      if (result.code === 0) {
        logForDebugging(
          `[Claude in Chrome] Registered native host for ${browser} in Windows registry: ${fullKey}`,
        )
      } else {
        logForDebugging(
          `[Claude in Chrome] Failed to register native host for ${browser} in Windows registry: ${result.stderr}`,
        )
      }
    })
  }
}

/**
 * Create a wrapper script in ~/.claude/chrome/ that invokes the given command. This is
 * necessary because Chrome's native host manifest "path" field cannot contain arguments.
 *
 * @param command - The full command to execute (e.g., "/path/to/claude --chrome-native-host")
 * @returns The path to the wrapper script
 */
async function createWrapperScript(command: string): Promise<string> {
  const platform = getPlatform()
  const chromeDir = join(getClaudeConfigHomeDir(), 'chrome')
  const wrapperPath =
    platform === 'windows'
      ? join(chromeDir, 'chrome-native-host.bat')
      : join(chromeDir, 'chrome-native-host')

  const scriptContent =
    platform === 'windows'
      ? `@echo off
REM Chrome native host wrapper script
REM Generated by Claude Code - do not edit manually
${command}
`
      : `#!/bin/sh
# Chrome native host wrapper script
# Generated by Claude Code - do not edit manually
exec ${command}
`

  // Check if content matches to avoid unnecessary writes
  const existingContent = await readFile(wrapperPath, 'utf-8').catch(() => null)
  if (existingContent === scriptContent) {
    return wrapperPath
  }

  await mkdir(chromeDir, { recursive: true })
  await writeFile(wrapperPath, scriptContent)

  if (platform !== 'windows') {
    await chmod(wrapperPath, 0o755)
  }

  logForDebugging(
    `[Claude in Chrome] Created Chrome native host wrapper script: ${wrapperPath}`,
  )
  return wrapperPath
}

/**
 * Get cached value of whether Chrome extension is installed. Returns
 * from disk cache immediately, updates cache in background.
 *
 * Use this for sync/startup-critical paths where blocking on filesystem
 * access is not acceptable. The value may be stale if the cache hasn't
 * been updated recently.
 *
 * Only positive detections are persisted. A negative result from the
 * filesystem scan is not cached, because it may come from a machine that
 * shares ~/.claude.json but has no local Chrome (e.g. a remote dev
 * environment using the bridge), and caching it would permanently poison
 * auto-enable for every session on every machine that reads that config.
 */
function isChromeExtensionInstalled_CACHED_MAY_BE_STALE(): boolean {
  // Update cache in background without blocking
  void isChromeExtensionInstalled().then(isInstalled => {
    // Only persist positive detections — see docstring. The cost of a stale
    // `true` is one silent MCP connection attempt per session; the cost of a
    // stale `false` is auto-enable never working again without manual repair.
    if (!isInstalled) {
      return
    }
    const config = getGlobalConfig()
    if (config.cachedChromeExtensionInstalled !== isInstalled) {
      saveGlobalConfig(prev => ({
        ...prev,
        cachedChromeExtensionInstalled: isInstalled,
      }))
    }
  })

  // Return cached value immediately from disk
  const cached = getGlobalConfig().cachedChromeExtensionInstalled
  return cached ?? false
}

/**
 * Detects if the Claude in Chrome extension is installed by checking the Extensions
 * directory across all supported Chromium-based browsers and their profiles.
 *
 * @returns Object with isInstalled boolean and the browser where the extension was found
 */
export async function isChromeExtensionInstalled(): Promise<boolean> {
  const browserPaths = getAllBrowserDataPaths()
  if (browserPaths.length === 0) {
    logForDebugging(
      `[Claude in Chrome] Unsupported platform for extension detection: ${getPlatform()}`,
    )
    return false
  }
  return isChromeExtensionInstalledPortable(browserPaths, logForDebugging)
}
