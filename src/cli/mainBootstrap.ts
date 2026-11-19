import { feature } from 'bun:bundle'
import { SHOW_CURSOR } from '@anthropic/ink'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { relative } from 'path'
import { isAnalyticsDisabled } from 'src/services/analytics/config.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { initializeAnalyticsGates } from 'src/services/analytics/sink.js'
import { getRelevantTips } from 'src/services/tips/tipRegistry.js'
import { getSystemContext, getUserContext } from '../context.js'
import {
  getInitialMainLoopModel,
  getIsNonInteractiveSession,
  getSdkBetas,
  setAllowedSettingSources,
  setFlagSettingsPath,
  setParentManagedSettings,
  setRestrictedSession,
  setUserMsgOptIn,
} from '../bootstrap/state.js'
import { migrateBypassPermissionsAcceptedToSettings } from '../migrations/migrateBypassPermissionsAcceptedToSettings.js'
import { migrateEnableAllProjectMcpServersToSettings } from '../migrations/migrateEnableAllProjectMcpServersToSettings.js'
import { migrateFennecToOpus } from '../migrations/migrateFennecToOpus.js'
import { migrateLegacyOpusToCurrent } from '../migrations/migrateLegacyOpusToCurrent.js'
import { migrateOpusToOpus1m } from '../migrations/migrateOpusToOpus1m.js'
import { migrateReplBridgeEnabledToRemoteControlAtStartup } from '../migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.js'
import { migrateSonnet45ToSonnet46 } from '../migrations/migrateSonnet45ToSonnet46.js'
import { resetAutoModeOptInForDefaultOffer } from '../migrations/resetAutoModeOptInForDefaultOffer.js'
import { resetProToOpusDefault } from '../migrations/resetProToOpusDefault.js'
import {
  prefetchAwsCredentialsAndBedRockInfoIfSafe,
  prefetchGcpCredentialsIfSafe,
} from '../utils/auth.js'
import { isRunningWithBun } from '../utils/bundledMode.js'
import { eagerHasCliFlag, eagerParseCliFlag } from '../utils/cliArgs.js'
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  isAutoUpdaterDisabled,
  saveGlobalConfig,
} from '../utils/config.js'
import { getContextWindowForModel } from '../utils/context.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import {
  hasNodeOption,
  isBareMode,
  isEnvTruthy,
  isInProtectedNamespace,
} from '../utils/envUtils.js'
import {
  errorMessage,
  getErrnoCode,
  isEISDIR,
  isENOENT,
  isNotRegularFileError,
} from '../utils/errors.js'
import {
  assertRegularFileWithinMaxBytes,
  getFsImplementation,
  safeResolvePath,
} from '../utils/fsOperations.js'
import { findGitRoot, getIsGit, getWorktreeCount } from '../utils/git.js'
import { getGhAuthStatus } from '../utils/github/ghAuthStatus.js'
import { safeParseJSON } from '../utils/json.js'
import { logError } from '../utils/log.js'
import {
  getDefaultMainLoopModel,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { refreshModelCapabilities } from '../utils/model/modelCapabilities.js'
import { loadAllPluginsCacheOnly } from '../utils/plugins/pluginLoader.js'
import { getManagedPluginNames } from '../utils/plugins/managedPlugins.js'
import { getPluginSeedDirs } from '../utils/plugins/pluginDirectories.js'
import { peekForStdinData } from '../utils/process.js'
import { migrateChangelogFromConfig } from '../utils/releaseNotes.js'
import { isRestrictedEnv } from '../utils/restricted.js'
import { countFilesRoundedRg } from '../utils/ripgrep.js'
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js'
import { getReplDiffHost } from '../utils/sessionHost.js'
import { settingsChangeDetector } from '../utils/settings/changeDetector.js'
import {
  FLAG_SETTINGS_MAX_BYTES,
  parseSettingSourcesFlag,
} from '../utils/settings/constants.js'
import {
  getInitialSettings,
  getManagedSettingsKeysForLogging,
  getSettingsForSource,
} from '../utils/settings/settings.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import { SettingsSchema } from '../utils/settings/types.js'
import { skillChangeDetector } from '../utils/skills/skillChangeDetector.js'
import { writeFileSync_DEPRECATED } from '../utils/slowOperations.js'
import { profileCheckpoint } from '../utils/startupProfiler.js'
import { getPinnedStorageV5 } from '../utils/storageV5/index.js'
import {
  logPluginLoadErrors,
  logPluginsEnabledForSession,
} from '../utils/telemetry/pluginTelemetry.js'
import { logSkillsLoaded } from '../utils/telemetry/skillLoadedEvent.js'
import { generateTempFilePath } from '../utils/tempfile.js'
import type { ThinkingConfig } from '../utils/thinking.js'
import { initUser } from '../utils/user.js'

// Dead code elimination: conditional import for COORDINATOR_MODE.
// Do NOT top-level require() this module during main.tsx evaluation — Bun can
// hand back an incomplete ESM exports object; reading `.isCoordinatorMode`
// then deadlocks on Windows. Runtime gate is the densable env check; full
// module is loaded lazily via import() when modeApi is needed.
export function isCoordinatorModeEnv(): boolean {
  return feature('COORDINATOR_MODE')
    ? isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
    : false
}

export type CoordinatorModeModule =
  typeof import('../coordinator/coordinatorMode.js')
let coordinatorModeModuleCache: CoordinatorModeModule | undefined

export async function loadCoordinatorModeModule(): Promise<CoordinatorModeModule | null> {
  if (!feature('COORDINATOR_MODE')) return null
  if (coordinatorModeModuleCache !== undefined) {
    return coordinatorModeModuleCache
  }
  const mod = await import('../coordinator/coordinatorMode.js')
  // Incomplete circular-init namespace — do not cache; retry on later calls.
  if (
    typeof mod.isCoordinatorMode !== 'function' ||
    typeof mod.matchSessionMode !== 'function'
  ) {
    return null
  }
  coordinatorModeModuleCache = mod
  return mod
}

/**
 * Log managed settings keys to Statsig for analytics.
 * This is called after init() completes to ensure settings are loaded
 * and environment variables are applied before model resolution.
 */
export function logManagedSettings(): void {
  try {
    const policySettings = getSettingsForSource('policySettings')
    if (policySettings) {
      const allKeys = getManagedSettingsKeysForLogging(policySettings)
      logEvent('tengu_managed_settings_loaded', {
        keyCount: allKeys.length,
        keys: allKeys.join(
          ',',
        ) as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch {
    // Silently ignore errors - this is just for analytics
  }
}

// Check if running in debug/inspection mode
export function _isBeingDebugged(): boolean {
  const isBun = isRunningWithBun()

  // Check for inspect flags in process arguments (including all variants)
  const hasInspectArg = process.execArgv.some(arg => {
    if (isBun) {
      // Note: Bun has an issue with single-file executables where application arguments
      // from process.argv leak into process.execArgv (similar to https://github.com/oven-sh/bun/issues/11673)
      // This breaks use of --debug mode if we omit this branch
      // We're fine to skip that check, because Bun doesn't support Node.js legacy --debug or --debug-brk flags
      return /--inspect(-brk)?/.test(arg)
    } else {
      // In Node.js, check for both --inspect and legacy --debug flags
      return /--inspect(-brk)?|--debug(-brk)?/.test(arg)
    }
  })

  // Check if NODE_OPTIONS contains inspect flags
  const hasInspectEnv = Boolean(
    process.env.NODE_OPTIONS &&
      /--inspect(-brk)?|--debug(-brk)?/.test(process.env.NODE_OPTIONS),
  )

  // Check if inspector is available and active (indicates debugging)
  try {
    // Dynamic import would be better but is async - use global object instead
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inspector = (global as any).require('inspector')
    const hasInspectorUrl = !!inspector.url()
    return hasInspectorUrl || hasInspectArg || hasInspectEnv
  } catch {
    // Ignore error and fall back to argument detection
    return hasInspectArg || hasInspectEnv
  }
}

/**
 * Per-session skill/plugin telemetry. Called from both the interactive path
 * and the headless -p path (before runHeadless) — both go through
 * main.tsx but branch before the interactive startup path, so it needs two
 * call sites here rather than one here plus one in the execution runtime.
 */
export function logSessionTelemetry(): void {
  const model = parseUserSpecifiedModel(
    getInitialMainLoopModel() ?? getDefaultMainLoopModel(),
  )
  void logSkillsLoaded(getCwd(), getContextWindowForModel(model, getSdkBetas()))
  void loadAllPluginsCacheOnly()
    .then(({ enabled, errors }) => {
      const managedNames = getManagedPluginNames()
      logPluginsEnabledForSession(enabled, managedNames, getPluginSeedDirs())
      logPluginLoadErrors(errors, managedNames)
    })
    .catch(err => logError(err))
}

function getCertEnvVarTelemetry(): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (process.env.NODE_EXTRA_CA_CERTS) {
    result.has_node_extra_ca_certs = true
  }
  if (process.env.CLAUDE_CODE_CLIENT_CERT) {
    result.has_client_cert = true
  }
  if (hasNodeOption('--use-system-ca')) {
    result.has_use_system_ca = true
  }
  if (hasNodeOption('--use-openssl-ca')) {
    result.has_use_openssl_ca = true
  }
  return result
}

export async function logStartupTelemetry(): Promise<void> {
  if (isAnalyticsDisabled()) return
  const [isGit, worktreeCount, ghAuthStatus] = await Promise.all([
    getIsGit(),
    getWorktreeCount(),
    getGhAuthStatus({ allowNetworkFallbackForOldGh: false }),
  ])

  logEvent('tengu_startup_telemetry', {
    is_git: isGit,
    worktree_count: worktreeCount,
    gh_auth_status:
      ghAuthStatus.status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    sandbox_enabled: SandboxManager.isSandboxingEnabled(),
    are_unsandboxed_commands_allowed:
      SandboxManager.areUnsandboxedCommandsAllowed(),
    is_auto_bash_allowed_if_sandbox_enabled:
      SandboxManager.isAutoAllowBashIfSandboxedEnabled(),
    auto_updater_disabled: isAutoUpdaterDisabled(),
    prefers_reduced_motion: getInitialSettings().prefersReducedMotion ?? false,
    ...getCertEnvVarTelemetry(),
  })
}

// @[MODEL LAUNCH]: Consider any migrations you may need for model strings. See migrateSonnet1mToSonnet45.ts for an example.
// Bump this when adding a new sync migration so existing users re-run the set.
const CURRENT_MIGRATION_VERSION = 11

export function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateBypassPermissionsAcceptedToSettings()
    migrateEnableAllProjectMcpServersToSettings()
    resetProToOpusDefault()
    migrateLegacyOpusToCurrent()
    migrateSonnet45ToSonnet46()
    migrateOpusToOpus1m()
    migrateReplBridgeEnabledToRemoteControlAtStartup()
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      resetAutoModeOptInForDefaultOffer()
    }
    if (process.env.USER_TYPE === 'ant') {
      migrateFennecToOpus()
    }
    saveGlobalConfig(prev =>
      prev.migrationVersion === CURRENT_MIGRATION_VERSION
        ? prev
        : { ...prev, migrationVersion: CURRENT_MIGRATION_VERSION },
    )
  }
  // Async migration - fire and forget since it's non-blocking
  migrateChangelogFromConfig().catch(() => {
    // Silently ignore migration errors - will retry on next startup
  })
}

/**
 * Prefetch system context (including git status) only when it's safe to do so.
 * Git commands can execute arbitrary code via hooks and config (e.g., core.fsmonitor,
 * diff.external), so we must only run them after trust is established or in
 * non-interactive mode where trust is implicit.
 */
function prefetchSystemContextIfSafe(): void {
  const isNonInteractiveSession = getIsNonInteractiveSession()

  // In non-interactive mode (--print), trust dialog is skipped and
  // execution is considered trusted (as documented in help text)
  if (isNonInteractiveSession) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_non_interactive')
    void getSystemContext()
    return
  }

  // In interactive mode, only prefetch if trust has already been established
  const hasTrust = checkHasTrustDialogAccepted()
  if (hasTrust) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_has_trust')
    void getSystemContext()
  } else {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_skipped_no_trust')
  }
  // Otherwise, don't prefetch - wait for trust to be established first
}

/**
 * Start background prefetches and housekeeping that are NOT needed before first render.
 * These are deferred from setup() to reduce event loop contention and child process
 * spawning during the critical startup path.
 * Call this after the REPL has been rendered.
 */
export function startDeferredPrefetches(): void {
  // This function runs after first render, so it doesn't block the initial paint.
  // However, the spawned processes and async work still contend for CPU and event
  // loop time, which skews startup benchmarks (CPU profiles, time-to-first-render
  // measurements). Skip all of it when we're only measuring startup performance.
  // Official EXIT_AFTER_FIRST_RENDER densable — skip prefetches for startup bench.
  let exitAfterFirstRender = false
  try {
    const { isExitAfterFirstRenderEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    exitAfterFirstRender = isExitAfterFirstRenderEnabled()
  } catch {
    exitAfterFirstRender = isEnvTruthy(
      process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER,
    )
  }
  if (
    exitAfterFirstRender ||
    // --bare: skip ALL prefetches. These are cache-warms for the REPL's
    // first-turn responsiveness (initUser, getUserContext, tips, countFiles,
    // modelCapabilities, change detectors). Scripted -p calls don't have a
    // "user is typing" window to hide this work in — it's pure overhead on
    // the critical path.
    isBareMode()
  ) {
    return
  }

  // Process-spawning prefetches (consumed at first API call, user is still typing)
  void initUser()
  void getUserContext()
  prefetchSystemContextIfSafe()
  void getRelevantTips({
    session: { host: getReplDiffHost() },
    storageV5: getPinnedStorageV5(),
  })
  // Official USE_*/SKIP_* densables for cloud-provider credential prefetch.
  let useBedrock = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
  let useVertex = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  let skipBedrockAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)
  let skipVertexAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)
  try {
    const {
      isUseBedrockEnvEnabled,
      isUseVertexEnvEnabled,
      isSkipBedrockAuthEnvEnabled,
      isSkipVertexAuthEnvEnabled,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    useBedrock = isUseBedrockEnvEnabled()
    useVertex = isUseVertexEnvEnabled()
    skipBedrockAuth = isSkipBedrockAuthEnvEnabled()
    skipVertexAuth = isSkipVertexAuthEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (useBedrock && !skipBedrockAuth) {
    void prefetchAwsCredentialsAndBedRockInfoIfSafe()
  }
  if (useVertex && !skipVertexAuth) {
    void prefetchGcpCredentialsIfSafe()
  }
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), [])

  // Analytics and feature flag initialization
  void initializeAnalyticsGates()

  void refreshModelCapabilities()

  // File change detectors deferred from init() to unblock first render
  void settingsChangeDetector.initialize()
  if (!isBareMode()) {
    void skillChangeDetector.initialize()
  }

  // Event loop stall detector — logs when the main thread is blocked >500ms
  if (process.env.USER_TYPE === 'ant') {
    void import('../utils/eventLoopStallDetector.js').then(m =>
      m.startEventLoopStallDetector(),
    )
  }
}

const RAW_SANDBOX_KEY_RE = /"sandbox"\s*:/

function rawJsonTextHasSandboxKey(raw: string): boolean {
  if (RAW_SANDBOX_KEY_RE.test(raw)) return true
  if (raw.includes('\\u')) {
    const decoded = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    if (RAW_SANDBOX_KEY_RE.test(decoded)) return true
  }
  return false
}

/**
 * Official 2.1.323 #2031 & #2178:
 * - #2178: stop at start-up when a `--settings` file is not valid JSON and
 *   contains a `sandbox` key (even one that turns the sandbox off).
 * - #2031: stop at start-up and name the invalid setting when `--settings` or
 *   SDK settings that turn `sandbox.enabled` on fail schema validation, so
 *   `claude -p` and the Agent SDK never run Bash unsandboxed.
 *
 * Returns a human-readable error message when start-up must abort, or `null`
 * when start-up may continue.
 */
export function validateFlagSettingsSandboxOrError(
  rawText: string,
  sourceLabel: string,
): string | null {
  const stripped = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    if (rawJsonTextHasSandboxKey(stripped)) {
      return `Error: Invalid JSON in --settings (${sourceLabel}): ${errorMessage(err)}. Because this settings file has a "sandbox" key, Claude Code will not start until the JSON is fixed.`
    }
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const sandbox = (parsed as Record<string, unknown>).sandbox
  const turnsSandboxOn =
    typeof sandbox === 'object' &&
    sandbox !== null &&
    !Array.isArray(sandbox) &&
    (sandbox as Record<string, unknown>).enabled === true
  if (!turnsSandboxOn) {
    return null
  }
  const result = SettingsSchema().safeParse(parsed)
  if (result.success) {
    return null
  }
  const formattedIssues = result.error.issues
    .slice(0, 5)
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${path}: ${issue.message}`
    })
    .join('; ')
  return `Error: Invalid setting in --settings (${sourceLabel}) while sandbox.enabled is true — refusing to start unsandboxed: ${formattedIssues}`
}

function loadSettingsFromFlag(settingsFile: string): void {
  // densable 2.1.214 #17: path form uses bj(path, Jme=2MiB) — refuse device /
  // directory / oversize before init; inline JSON form is unchanged.
  try {
    const trimmedSettings = settingsFile.trim()
    const looksLikeJson =
      trimmedSettings.startsWith('{') && trimmedSettings.endsWith('}')

    let settingsPath: string

    if (looksLikeJson) {
      // It's a JSON string - validate and create temp file
      const sandboxInlineErr = validateFlagSettingsSandboxOrError(
        trimmedSettings,
        'inline JSON',
      )
      if (sandboxInlineErr !== null) {
        process.stderr.write(chalk.red(`${sandboxInlineErr}\n`))
        process.exit(1)
      }
      const parsedJson = safeParseJSON(trimmedSettings)
      if (!parsedJson) {
        process.stderr.write(
          chalk.red('Error: Invalid JSON provided to --settings\n'),
        )
        process.exit(1)
      }

      // Create a temporary file and write the JSON to it.
      // Use a content-hash-based path instead of random UUID to avoid
      // busting the Anthropic API prompt cache. The settings path ends up
      // in the Bash tool's sandbox denyWithinAllow list, which is part of
      // the tool description sent to the API. A random UUID per subprocess
      // changes the tool description on every query() call, invalidating
      // the cache prefix and causing a 12x input token cost penalty.
      // The content hash ensures identical settings produce the same path
      // across process boundaries (each SDK query() spawns a new process).
      // densable: contentHash via JSON.stringify + control-char escape; we
      // keep trimmedSettings as the write body (1:1 with prior local) while
      // still content-hashing for stable temp path.
      const contentHash = JSON.stringify(parsedJson).replace(
        /[\u007f-\u009f]/g,
        s =>
          '\\u' + s.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'),
      )
      settingsPath = generateTempFilePath('claude-settings', '.json', {
        contentHash,
      })
      writeFileSync_DEPRECATED(settingsPath, trimmedSettings, 'utf8')
    } else {
      // densable: yf → bj(o, Jme) with ar / ERR_FILE_TOO_LARGE / eWe|Tae
      const fsImpl = getFsImplementation()
      const { resolvedPath: resolvedSettingsPath } = safeResolvePath(
        fsImpl,
        settingsFile,
      )
      let fileContent: string
      try {
        // densable qvl via assertRegularFileWithinMaxBytes (Jme = 2MiB)
        assertRegularFileWithinMaxBytes(
          fsImpl,
          resolvedSettingsPath,
          FLAG_SETTINGS_MAX_BYTES,
        )
        // Still open to surface other IO errors (parity with prior full read)
        fileContent = readFileSync(resolvedSettingsPath, 'utf8')
      } catch (e) {
        if (isENOENT(e)) {
          process.stderr.write(
            chalk.red(
              `Error: Settings file not found: ${resolvedSettingsPath}\n`,
            ),
          )
          process.exit(1)
        }
        if (getErrnoCode(e) === 'ERR_FILE_TOO_LARGE') {
          process.stderr.write(
            chalk.red(
              `Error: Settings file exceeds the ${FLAG_SETTINGS_MAX_BYTES / 1048576}MiB limit: ${resolvedSettingsPath}\n`,
            ),
          )
          process.exit(1)
        }
        // densable eWe (ERR_NOT_REGULAR_FILE) || Tae (EISDIR)
        if (isNotRegularFileError(e) || isEISDIR(e)) {
          process.stderr.write(
            chalk.red(
              `Error: Cannot use settings file (${errorMessage(e)}): ${resolvedSettingsPath}\n`,
            ),
          )
          process.exit(1)
        }
        throw e
      }
      // Official 2.1.323 #2031 & #2178: abort start-up on invalid JSON with a
      // `sandbox` key or invalid settings turning `sandbox.enabled` on.
      const sandboxFileErr = validateFlagSettingsSandboxOrError(
        fileContent,
        resolvedSettingsPath,
      )
      if (sandboxFileErr !== null) {
        process.stderr.write(chalk.red(`${sandboxFileErr}\n`))
        process.exit(1)
      }
      settingsPath = resolvedSettingsPath
    }

    setFlagSettingsPath(settingsPath)
    resetSettingsCache()
  } catch (error) {
    if (error instanceof Error) {
      // densable T(`Error processing --settings: …`, {level:"error"})
      logError(error)
    }
    process.stderr.write(
      chalk.red(`Error processing settings: ${errorMessage(error)}\n`),
    )
    process.exit(1)
  }
}

function loadSettingSourcesFromFlag(settingSourcesArg: string): void {
  try {
    const sources = parseSettingSourcesFlag(settingSourcesArg)
    setAllowedSettingSources(sources)
    resetSettingsCache()
  } catch (error) {
    if (error instanceof Error) {
      logError(error)
    }
    process.stderr.write(
      chalk.red(`Error processing --setting-sources: ${errorMessage(error)}\n`),
    )
    process.exit(1)
  }
}

/**
 * densable Slv / rNi — `--managed-settings <json>` parent tier for SDK hosts.
 * Invalid JSON is warned and ignored (does not exit).
 */
function loadManagedSettingsFromFlag(managedSettingsArg: string): void {
  const parsed = safeParseJSON(managedSettingsArg.trim())
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logForDebugging('--managed-settings ignored: invalid JSON object', {
      level: 'warn',
    })
    return
  }
  setParentManagedSettings(parsed as Record<string, unknown>)
}

/**
 * Parse and load settings flags early, before init()
 * This ensures settings are filtered from the start of initialization
 */
export function eagerLoadSettings(): void {
  profileCheckpoint('eagerLoadSettings_start')
  // Parse --settings flag early to ensure settings are loaded before init()
  const settingsFile = eagerParseCliFlag('--settings')
  if (settingsFile) {
    loadSettingsFromFlag(settingsFile)
  }

  // densable --managed-settings (parent managed settings / host model overlay)
  const managedSettingsArg = eagerParseCliFlag('--managed-settings')
  if (managedSettingsArg !== undefined) {
    loadManagedSettingsFromFlag(managedSettingsArg)
  }

  // Parse --setting-sources flag early to control which sources are loaded
  const settingSourcesArg = eagerParseCliFlag('--setting-sources')
  if (settingSourcesArg !== undefined) {
    loadSettingSourcesFromFlag(settingSourcesArg)
  }
  // official k3t @189721038 — restricted overwrites --setting-sources:
  // `if(t0("--restricted")||O2())g(""),c7e(!0)`
  if (eagerHasCliFlag('--restricted') || isRestrictedEnv()) {
    loadSettingSourcesFromFlag('')
    setRestrictedSession(true)
  }
  profileCheckpoint('eagerLoadSettings_end')
}

export function initializeEntrypoint(isNonInteractive: boolean): void {
  // Skip if already set (e.g., by SDK or other entrypoints)
  if (process.env.CLAUDE_CODE_ENTRYPOINT) {
    return
  }

  const cliArgs = process.argv.slice(2)

  // Check for MCP serve command (handle flags before mcp serve, e.g., --debug mcp serve)
  const mcpIndex = cliArgs.indexOf('mcp')
  if (mcpIndex !== -1 && cliArgs[mcpIndex + 1] === 'serve') {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'mcp'
    return
  }

  // Official CLAUDE_CODE_ACTION densable (GitHub Action entrypoint).
  let isAction = isEnvTruthy(process.env.CLAUDE_CODE_ACTION)
  try {
    const { isActionEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    isAction = isActionEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (isAction) {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-code-github-action'
    return
  }

  // Note: 'local-agent' entrypoint is set by the local agent mode launcher
  // via CLAUDE_CODE_ENTRYPOINT env var (handled by early return above)

  // Set based on interactive status
  process.env.CLAUDE_CODE_ENTRYPOINT = isNonInteractive ? 'sdk-cli' : 'cli'
}

export async function getInputPrompt(
  prompt: string,
  inputFormat: 'text' | 'stream-json',
): Promise<string | AsyncIterable<string>> {
  if (
    !process.stdin.isTTY &&
    // Input hijacking breaks MCP.
    !process.argv.includes('mcp')
  ) {
    if (inputFormat === 'stream-json') {
      return process.stdin
    }
    process.stdin.setEncoding('utf8')
    let data = ''
    const onData = (chunk: string) => {
      data += chunk
    }
    process.stdin.on('data', onData)
    // If no data arrives in 3s, stop waiting and warn. Stdin is likely an
    // inherited pipe from a parent that isn't writing (subprocess spawned
    // without explicit stdin handling). 3s covers slow producers like curl,
    // jq on large files, python with import overhead. The warning makes
    // silent data loss visible for the rare producer that's slower still.
    const timedOut = await peekForStdinData(process.stdin, 3000)
    process.stdin.off('data', onData)
    if (timedOut) {
      process.stderr.write(
        'Warning: no stdin data received in 3s, proceeding without it. ' +
          'If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n',
      )
    }
    return [prompt, data].filter(Boolean).join('\n')
  }
  return prompt
}

export async function logTenguInit({
  hasInitialPrompt,
  hasStdin,
  verbose,
  debug,
  debugToStderr,
  print,
  outputFormat,
  inputFormat,
  numAllowedTools,
  numDisallowedTools,
  mcpClientCount,
  worktreeEnabled,
  skipWebFetchPreflight,
  githubActionInputs,
  dangerouslySkipPermissionsPassed,
  permissionMode,
  modeIsBypass,
  allowDangerouslySkipPermissionsPassed,
  systemPromptFlag,
  appendSystemPromptFlag,
  thinkingConfig,
  assistantActivationPath,
}: {
  hasInitialPrompt: boolean
  hasStdin: boolean
  verbose: boolean
  debug: boolean
  debugToStderr: boolean
  print: boolean
  outputFormat: string
  inputFormat: string
  numAllowedTools: number
  numDisallowedTools: number
  mcpClientCount: number
  worktreeEnabled: boolean
  skipWebFetchPreflight: boolean | undefined
  githubActionInputs: string | undefined
  dangerouslySkipPermissionsPassed: boolean
  permissionMode: string
  modeIsBypass: boolean
  allowDangerouslySkipPermissionsPassed: boolean
  systemPromptFlag: 'file' | 'flag' | undefined
  appendSystemPromptFlag: 'file' | 'flag' | undefined
  thinkingConfig: ThinkingConfig
  assistantActivationPath: string | undefined
}): Promise<void> {
  try {
    logEvent('tengu_init', {
      entrypoint:
        'claude' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasInitialPrompt,
      hasStdin,
      verbose,
      debug,
      debugToStderr,
      print,
      outputFormat:
        outputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      inputFormat:
        inputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numAllowedTools,
      numDisallowedTools,
      mcpClientCount,
      worktree: worktreeEnabled,
      skipWebFetchPreflight,
      ...(githubActionInputs && {
        githubActionInputs:
          githubActionInputs as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      dangerouslySkipPermissionsPassed,
      permissionMode:
        permissionMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      modeIsBypass,
      inProtectedNamespace: isInProtectedNamespace(),
      allowDangerouslySkipPermissionsPassed,
      thinkingType:
        thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(thinkingConfig.type === 'enabled' && {
        thinkingBudgetTokens: thinkingConfig.budgetTokens,
      }),
      ...(systemPromptFlag && {
        systemPromptFlag:
          systemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(appendSystemPromptFlag && {
        appendSystemPromptFlag:
          appendSystemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      is_simple: isBareMode() || undefined,
      is_coordinator: isCoordinatorModeEnv() ? true : undefined,
      ...(assistantActivationPath && {
        assistantActivationPath:
          assistantActivationPath as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      autoUpdatesChannel: (getInitialSettings().autoUpdatesChannel ??
        'latest') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(() => {
        const cwd = getCwd()
        const gitRoot = findGitRoot(cwd)
        const rp = gitRoot ? relative(gitRoot, cwd) || '.' : undefined
        return rp
          ? {
              relativeProjectPath:
                rp as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}
      })(),
    })
  } catch (error) {
    logError(error)
  }
}

export function maybeActivateProactive(options: unknown): void {
  // Official PROACTIVE densable.
  let proactiveEnv = isEnvTruthy(process.env.CLAUDE_CODE_PROACTIVE)
  try {
    const { isProactiveEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    proactiveEnv = isProactiveEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (
    (feature('PROACTIVE') || feature('KAIROS')) &&
    ((options as { proactive?: boolean }).proactive || proactiveEnv)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const proactiveModule = require('../proactive/index.js')
    if (!proactiveModule.isProactiveActive()) {
      proactiveModule.activateProactive('command')
    }
  }
}

export function maybeActivateBrief(options: unknown): void {
  if (!(feature('KAIROS') || feature('KAIROS_BRIEF'))) return
  const briefFlag = (options as { brief?: boolean }).brief
  // Official CLAUDE_CODE_BRIEF densable.
  let briefEnv = isEnvTruthy(process.env.CLAUDE_CODE_BRIEF)
  try {
    const { isBriefEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    briefEnv = isBriefEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (!briefFlag && !briefEnv) return
  // --brief / CLAUDE_CODE_BRIEF are explicit opt-ins: check entitlement,
  // then set userMsgOptIn to activate the tool + prompt section. The env
  // var also grants entitlement (isBriefEntitled() reads it), so setting
  // CLAUDE_CODE_BRIEF=1 alone force-enables for dev/testing — no GB gate
  // needed. initialIsBriefOnly reads getUserMsgOptIn() directly.
  // Conditional require: static import would leak the tool name string
  // into external builds via BriefTool.ts → prompt.ts.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { isBriefEntitled } =
    require('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const entitled = isBriefEntitled()
  if (entitled) {
    setUserMsgOptIn(true)
  }
  // Fire unconditionally once intent is seen: enabled=false captures the
  // "user tried but was gated" failure mode in Datadog.
  logEvent('tengu_brief_mode_enabled', {
    enabled: entitled,
    gated: !entitled,
    source: (briefEnv
      ? 'env'
      : 'flag') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export function resetCursor(): void {
  const terminal = process.stderr.isTTY
    ? process.stderr
    : process.stdout.isTTY
      ? process.stdout
      : undefined
  terminal?.write(SHOW_CURSOR)
}

export type TeammateOptions = {
  agentId?: string
  agentName?: string
  teamName?: string
  agentColor?: string
  planModeRequired?: boolean
  parentSessionId?: string
  teammateMode?: 'auto' | 'tmux' | 'in-process'
  agentType?: string
}

export function extractTeammateOptions(options: unknown): TeammateOptions {
  if (typeof options !== 'object' || options === null) {
    return {}
  }
  const opts = options as Record<string, unknown>
  const teammateMode = opts.teammateMode
  return {
    agentId: typeof opts.agentId === 'string' ? opts.agentId : undefined,
    agentName: typeof opts.agentName === 'string' ? opts.agentName : undefined,
    teamName: typeof opts.teamName === 'string' ? opts.teamName : undefined,
    agentColor:
      typeof opts.agentColor === 'string' ? opts.agentColor : undefined,
    planModeRequired:
      typeof opts.planModeRequired === 'boolean'
        ? opts.planModeRequired
        : undefined,
    parentSessionId:
      typeof opts.parentSessionId === 'string'
        ? opts.parentSessionId
        : undefined,
    teammateMode:
      teammateMode === 'auto' ||
      teammateMode === 'tmux' ||
      teammateMode === 'in-process'
        ? teammateMode
        : undefined,
    agentType: typeof opts.agentType === 'string' ? opts.agentType : undefined,
  }
}
