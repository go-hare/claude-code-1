/**
 * Adapter layer that wraps @anthropic-ai/sandbox-runtime with Claude CLI-specific integrations.
 * This file provides the public SandboxManager facade and re-exports the cohesive
 * submodules under `./adapter/*` alongside `@anthropic-ai/sandbox-runtime` and `./windowsSandbox.js`.
 */

import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  IgnoreViolationsConfig,
  NetworkHostPattern,
  NetworkRestrictionConfig,
  SandboxAskCallback,
  SandboxDependencyCheck,
  SandboxRuntimeConfig,
  SandboxViolationEvent,
} from '@anthropic-ai/sandbox-runtime'
import {
  SandboxManager as BaseSandboxManager,
  SandboxRuntimeConfigSchema,
  SandboxViolationStore,
} from '@anthropic-ai/sandbox-runtime'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { settingsHaveBlockReadsOutsideWorkingDirectories } from '../permissions/outsideReads.js'
import { getPlatform } from '../platform.js'
import {
  getFsReadConfig,
  getFsWriteConfig,
} from './adapter/configConversion.js'
import {
  areSandboxSettingsLockedByPolicy,
  areUnsandboxedCommandsAllowed,
  canMaskCredentialWarningFire,
  checkDependencies,
  getExcludedCommands,
  getLinuxGlobPatternWarnings,
  getMaskCredentialWarning,
  getProfileReadSecurityWarnings,
  getSandboxEnabledSetting,
  getSandboxUnavailableReason,
  getUnbracketedIpv6DomainWarnings,
  getUnbracketedIpv6InjectHostWarnings,
  getWindowsSandboxBackend,
  isAutoAllowBashIfSandboxedEnabled,
  isBashRefusedByMxcBackend,
  isBashToolWithheldForMxcBackend,
  isPlatformInEnabledList,
  isSandboxingEnabled,
  isSandboxRequired,
  isSandboxRequirementSetAsideInHostedWorker,
  isStrictSandboxModeConfigured,
  isSupportedPlatform,
  needsRestartForLocalConnections,
  needsRestartForTlsTerminate,
  setSandboxSettings,
  spawnSandboxedOnWindows,
  wouldSetAsideSandboxRequirementInHostedWorker,
} from './adapter/diagnostics.js'
import { markHostedToolContainer } from './adapter/hostState.js'
import {
  addSessionAllowedHost,
  cleanupAfterCommand,
  ensureInitializedForWrap,
  initialize,
  refreshConfig,
  reset,
} from './adapter/lifecycle.js'
import {
  resolveSandboxFilesystemDisabled,
  shouldAllowManagedReadPathsOnly,
} from './adapter/pathPolicy.js'
import { wrapWithSandbox, wrapWithSandboxArgv } from './adapter/wrapCommands.js'
import {
  areWindowsLocalConnectionsOn,
  checkWindowsSandboxStatusAsync,
  classifyWindowsSandboxLaunchExit,
  type EnsurePersistentWindowsCaOptions,
  type EnsurePersistentWindowsCaResult,
  ensurePersistentWindowsCa,
  estimateWindowsCommandLineUtf16Length,
  forgetWindowsProfileReadAsync,
  getWindowsMxcLastStart,
  getWindowsMxcSetAside,
  getWindowsSandboxNativeProvider,
  hasWindowsMxcSdk,
  hasWindowsSandboxSupport,
  installWindowsSandboxAsync,
  isInstalledWindowsTlsCaCurrent,
  isWindowsBackendUnset,
  isWindowsCommandLineTooLong,
  registerWindowsSandboxNativeProvider,
  resolveWindowsBackendChoice,
  resolveWindowsTlsTerminateCaSource,
  runWindowsSandboxInstallFlow,
  uninstallWindowsSandbox,
  validateMxcBaseContainerProbe,
  WINDOWS_ARGV_MAX_LENGTH,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
  WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE,
  WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
  type WindowsBackendChoice,
  type WindowsInstallOptions,
  type WindowsMxcLastStart,
  type WindowsMxcProbeResult,
  type WindowsSandboxBackend,
  WindowsSandboxError,
  type WindowsSandboxInstallFlowOptions,
  type WindowsSandboxInstallFlowResult,
  type WindowsSandboxNativeProvider,
  type WindowsSandboxStartState,
  type WindowsSandboxStatus,
  type WindowsSandboxUserStatus,
  type WindowsSandboxWfpStatus,
  type WindowsTlsTerminateCaSource,
  type WindowsUninstallOptions,
  willSandboxTlsTerminate,
  windowsArgvTooLongError,
  windowsSandboxStartStore,
} from './windowsSandbox.js'

/**
 * Official 2.1.328 (`BMt` + `dG` @291244397): returns true iff the active
 * sandbox can enforce `permissions.blockReadsOutsideWorkingDirectories` via FS
 * read-deny rules (independent of whether the setting is already enabled):
 * - Sandboxing enabled
 * - Platform is not Windows (Windows sandbox does not add read denies)
 * - Filesystem isolation is not disabled (`!resolveSandboxFilesystemDisabled()`
 *   and live `getConfig()?.filesystem?.disabled !== true`)
 * - `allowManagedReadPathsOnly` is not set in `policySettings`
 * - `getOriginalCwd()` contains no glob characters (`[*?[\]]`)
 */
export function canSandboxFenceOutsideReads(): boolean {
  if (!SandboxManager.isSandboxingEnabled()) return false
  if (getPlatform() === 'windows') return false
  if (resolveSandboxFilesystemDisabled()) return false
  const liveCfg = BaseSandboxManager.getConfig?.() as
    | { filesystem?: { disabled?: boolean } }
    | undefined
  if (liveCfg?.filesystem?.disabled === true) return false
  if (shouldAllowManagedReadPathsOnly()) return false
  if (/[*?[\]]/.test(getOriginalCwd())) return false
  return true
}

/**
 * Official 2.1.328 (`BMt` && `h4e` @295799760): returns true iff the active
 * sandbox actually enforces `permissions.blockReadsOutsideWorkingDirectories`
 * via FS read-deny rules.
 */
export function isSandboxFencingOutsideReads(): boolean {
  return (
    canSandboxFenceOutsideReads() &&
    settingsHaveBlockReadsOutsideWorkingDirectories()
  )
}

// ============================================================================
// Export interface and implementation
// ============================================================================

export interface ISandboxManager {
  initialize(sandboxAskCallback?: SandboxAskCallback): Promise<void>
  isSupportedPlatform(): boolean
  isPlatformInEnabledList(): boolean
  getSandboxUnavailableReason(): string | undefined
  isSandboxingEnabled(): boolean
  isSandboxEnabledInSettings(): boolean
  checkDependencies(): SandboxDependencyCheck
  isAutoAllowBashIfSandboxedEnabled(): boolean
  areUnsandboxedCommandsAllowed(): boolean
  isSandboxRequired(): boolean
  isSandboxRequirementSetAsideInHostedWorker(): boolean
  wouldSetAsideSandboxRequirementInHostedWorker(): boolean
  markHostedToolContainer(value?: boolean): void
  areSandboxSettingsLockedByPolicy(): boolean
  isStrictSandboxModeConfigured(): boolean
  setSandboxSettings(options: {
    enabled?: boolean
    autoAllowBashIfSandboxed?: boolean
    allowUnsandboxedCommands?: boolean
  }): Promise<{ error: Error | null }>
  getFsReadConfig(): FsReadRestrictionConfig
  getFsWriteConfig(): FsWriteRestrictionConfig
  getNetworkRestrictionConfig(): NetworkRestrictionConfig
  getAllowUnixSockets(): string[] | undefined
  getAllowLocalBinding(): boolean | undefined
  getIgnoreViolations(): IgnoreViolationsConfig | undefined
  getEnableWeakerNestedSandbox(): boolean | undefined
  getExcludedCommands(): string[]
  getProxyPort(): number | undefined
  getSocksProxyPort(): number | undefined
  getLinuxHttpSocketPath(): string | undefined
  getLinuxSocksSocketPath(): string | undefined
  waitForNetworkInitialization(): Promise<boolean>
  ensureInitializedForWrap(options?: {
    keepsSandboxOn?: boolean
  }): Promise<void>
  wrapWithSandbox(
    command: string,
    binShell?: string,
    customConfig?: Partial<SandboxRuntimeConfig>,
    abortSignal?: AbortSignal,
    wrapOptions?: { keepsSandboxOn?: boolean },
  ): Promise<string>
  wrapWithSandboxArgv(
    command: string,
    binShell?: string,
    customConfig?: Partial<SandboxRuntimeConfig>,
    abortSignal?: AbortSignal,
    cwd?: string,
    wrapOptions?: { keepsSandboxOn?: boolean },
  ): Promise<{ argv: string[]; env: NodeJS.ProcessEnv }>
  cleanupAfterCommand(): void
  getSandboxViolationStore(): SandboxViolationStore
  annotateStderrWithSandboxFailures(command: string, stderr: string): string
  getLinuxGlobPatternWarnings(): string[]
  /** densable 2.1.229 iA_ — unreliable IPv6/domain spellings for doctor */
  getUnbracketedIpv6DomainWarnings(): string[]
  /** densable 2.1.229 sA_ — injectHosts multi-colon IPv6 spelling warnings */
  getUnbracketedIpv6InjectHostWarnings(): string[]
  /** densable o0g — mask without tlsTerminate/allowPlaintextInject warning */
  getMaskCredentialWarning(): string | undefined
  /** densable ruu — whether mask warning path may fire */
  canMaskCredentialWarningFire(): boolean
  refreshConfig(): void
  /** densable zvb — session-scoped host allow → allowedDomains via refreshConfig */
  addSessionAllowedHost(host: string): void
  /** Official 2.1.331 `hl` — active Windows sandbox backend (`sandboxuser` | `mxc`) */
  getWindowsSandboxBackend(): WindowsSandboxBackend
  /** Official 2.1.331 `b1` — true when Windows MXC backend refuses Bash commands */
  isBashRefusedByMxcBackend(): boolean
  /** Official 2.1.331 `oH` — latched session-start Bash withholding under MXC */
  isBashToolWithheldForMxcBackend(): boolean
  /** Official 2.1.331 — spawn a sandboxed command via the Windows native provider */
  spawnSandboxedOnWindows(
    command: string,
    opts?: Record<string, unknown>,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>
  /** Official 2.1.331 — true when TLS termination setting changed since start */
  needsRestartForTlsTerminate(): boolean
  /** Official 2.1.331 — true when Windows local connections setting changed since start */
  needsRestartForLocalConnections(): boolean
  /** Official 2.1.331 — profile-read security warnings captured for this host */
  getProfileReadSecurityWarnings(): string[]
  reset(): Promise<void>
}

/**
 * Claude CLI sandbox manager - wraps sandbox-runtime with Claude-specific features
 */
export const SandboxManager: ISandboxManager = {
  // Custom implementations
  initialize,
  isSandboxingEnabled,
  isSandboxEnabledInSettings: getSandboxEnabledSetting,
  isPlatformInEnabledList,
  getSandboxUnavailableReason,
  isAutoAllowBashIfSandboxedEnabled,
  areUnsandboxedCommandsAllowed,
  isSandboxRequired,
  isSandboxRequirementSetAsideInHostedWorker,
  wouldSetAsideSandboxRequirementInHostedWorker,
  markHostedToolContainer,
  areSandboxSettingsLockedByPolicy,
  isStrictSandboxModeConfigured,
  setSandboxSettings,
  getExcludedCommands,
  ensureInitializedForWrap,
  wrapWithSandbox,
  wrapWithSandboxArgv,
  refreshConfig,
  addSessionAllowedHost,
  getWindowsSandboxBackend,
  isBashRefusedByMxcBackend,
  isBashToolWithheldForMxcBackend,
  spawnSandboxedOnWindows,
  needsRestartForTlsTerminate,
  needsRestartForLocalConnections,
  getProfileReadSecurityWarnings,
  reset,
  checkDependencies,

  // densable 2.1.216 Gvg/Wvg overrides + network forward
  getFsReadConfig,
  getFsWriteConfig,
  getNetworkRestrictionConfig: BaseSandboxManager.getNetworkRestrictionConfig,
  getIgnoreViolations: BaseSandboxManager.getIgnoreViolations,
  getLinuxGlobPatternWarnings,
  getUnbracketedIpv6DomainWarnings,
  getUnbracketedIpv6InjectHostWarnings,
  getMaskCredentialWarning,
  canMaskCredentialWarningFire,
  isSupportedPlatform,
  getAllowUnixSockets: BaseSandboxManager.getAllowUnixSockets,
  getAllowLocalBinding: BaseSandboxManager.getAllowLocalBinding,
  getEnableWeakerNestedSandbox: BaseSandboxManager.getEnableWeakerNestedSandbox,
  getProxyPort: BaseSandboxManager.getProxyPort,
  getSocksProxyPort: BaseSandboxManager.getSocksProxyPort,
  getLinuxHttpSocketPath: BaseSandboxManager.getLinuxHttpSocketPath,
  getLinuxSocksSocketPath: BaseSandboxManager.getLinuxSocksSocketPath,
  waitForNetworkInitialization: BaseSandboxManager.waitForNetworkInitialization,
  getSandboxViolationStore: BaseSandboxManager.getSandboxViolationStore,
  annotateStderrWithSandboxFailures:
    BaseSandboxManager.annotateStderrWithSandboxFailures,
  cleanupAfterCommand,
}

// ============================================================================
// Re-export cohesive adapter submodules (100% backward-compatible barrel)
// ============================================================================

export {
  convertToSandboxRuntimeConfig,
  getEnforcementFsReadConfig,
  getEnforcementFsWriteConfig,
  getSrtAllowNestedUsernsEnv,
  resolveTrustedSandboxSettings,
  type TrustedSandboxSettingsResolution,
} from './adapter/configConversion.js'
export {
  ALLOW_WRITE_SYSTEM_DIRS,
  CA_CERT_ENV_VARS,
  DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS,
  DENY_READ_ENV_GLOBS,
  DENY_READ_SOCKET_PATHS,
  type DisabledFsDiagnosticLists,
  ENV_FILES,
  EXTENDED_CREDENTIAL_FILES,
  EXTENDED_SENSITIVE_DIRECTORIES,
  type SandboxRootMoveHold,
  SENSITIVE_CREDENTIAL_FILES,
  SENSITIVE_DIRECTORIES,
  SRT_ALLOW_NESTED_USERNS_ENV,
  stripTrailingSlashForSandbox,
} from './adapter/constants.js'
export {
  type AppArmorProbeDeps,
  addToExcludedCommands,
  addToExcludedCommandsWithResult,
  captureSandboxRootMoveHold,
  detectLinuxAppArmorUsernsRestriction,
  isSandboxHeldOnByFailedSettingsRead,
  isSandboxHeldOnByRootMove,
  isStrictSandboxModeConfigured,
} from './adapter/diagnostics.js'
export {
  cleanupLinuxSandboxPlaceholderFiles,
  detectWorktreeMainRepoPath,
  ensureLinuxGitWorktreeConfigPlaceholder,
  getActiveGitDirSnapshotCountForTesting,
  isEscapingGitRefFile,
  isGitRefBearingPath,
  quarantineUnexpectedGitDirEntries,
  resolveUniqueGitDirs,
  snapshotGitDirBeforeSandboxWrap,
} from './adapter/gitDirGuard.js'
export {
  _resetSandboxHeldStateForTesting,
  _setSandboxInitFailureForTesting,
  clearFsReadConfigMemoForTests,
  clearSandboxRootMoveHold,
  clearSessionAllowedHostsForTests,
  getDisabledFsDiagnosticLists,
  getLastSandboxAskCallbackForTests,
  getSandboxInitFailureReason,
  getSandboxRootMoveHold,
  getSessionAllowedHosts,
  hasSandboxStartedOnce,
  isSandboxDisabledThisSession,
  markHostedToolContainer,
  normalizeSandboxSessionHost,
  SandboxInitFailedError,
  serializeSandboxRootMoveHoldEnv,
} from './adapter/hostState.js'
export {
  addSessionAllowedHost,
  ensureInitializedForWrap,
} from './adapter/lifecycle.js'
export {
  collectSensitiveHomeDenyWritePaths,
  directoryHasUnreadableOrNetworkSymlink,
  expandSymlinkedDenyWriteGlobs,
  filterLinuxNetSymlinkDenyRead,
  getDisabledSandboxFsReadConfig,
  getDisabledSandboxFsWriteConfig,
  getInlinePluginRoots,
  getUpdaterStagingDir,
  hasTrustedSandboxNetworkRestriction,
  isAllowWriteSymlinkEscapingOrDangling,
  isLinuxNetAutofsPath,
  isSandboxAdminMandated,
  isSandboxFilesystemDisabledLockedByManaged,
  maskCredentialInjectionWarning,
  mergeSandboxCredentialsForRuntime,
  precreateMissingLinuxAddDirs,
  pushProtectedClaudeDirEntries,
  resolvePathPatternForSandbox,
  resolveSandboxBwrapPath,
  resolveSandboxFilesystemDisabled,
  resolveSandboxFilesystemPath,
  resolveSandboxRipgrep,
  resolveSandboxSocatPath,
  resolveSandboxStrictAllowlist,
  resolveSandboxTlsTerminate,
  shouldAllowManagedSandboxDomainsOnly,
} from './adapter/pathPolicy.js'
export {
  applyLinuxNestedUsernsEnv,
  fixLinuxBwrapAllowReadMountOrder,
  hardenMacOsSeatbeltProcessInfo,
} from './adapter/wrapCommands.js'

// ============================================================================
// Re-export types from sandbox-runtime & Windows sandbox
// ============================================================================

export type {
  SandboxAskCallback,
  SandboxDependencyCheck,
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  NetworkRestrictionConfig,
  NetworkHostPattern,
  SandboxViolationEvent,
  SandboxRuntimeConfig,
  IgnoreViolationsConfig,
}

export {
  SandboxViolationStore,
  SandboxRuntimeConfigSchema,
  // Official 2.1.331 Windows sandbox exports (15 + registry/helpers/constants)
  WindowsSandboxError,
  windowsSandboxStartStore,
  isWindowsBackendUnset,
  getWindowsMxcSetAside,
  getWindowsMxcLastStart,
  checkWindowsSandboxStatusAsync,
  installWindowsSandboxAsync,
  uninstallWindowsSandbox,
  ensurePersistentWindowsCa,
  resolveWindowsTlsTerminateCaSource,
  isInstalledWindowsTlsCaCurrent,
  forgetWindowsProfileReadAsync,
  estimateWindowsCommandLineUtf16Length,
  isWindowsCommandLineTooLong,
  windowsArgvTooLongError,
  classifyWindowsSandboxLaunchExit,
  areWindowsLocalConnectionsOn,
  registerWindowsSandboxNativeProvider,
  getWindowsSandboxNativeProvider,
  hasWindowsMxcSdk,
  hasWindowsSandboxSupport,
  resolveWindowsBackendChoice,
  validateMxcBaseContainerProbe,
  runWindowsSandboxInstallFlow,
  willSandboxTlsTerminate,
  WINDOWS_ARGV_MAX_LENGTH,
  WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE,
  WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
}

export type {
  EnsurePersistentWindowsCaOptions,
  EnsurePersistentWindowsCaResult,
  WindowsBackendChoice,
  WindowsInstallOptions,
  WindowsMxcLastStart,
  WindowsMxcProbeResult,
  WindowsSandboxBackend,
  WindowsSandboxInstallFlowOptions,
  WindowsSandboxInstallFlowResult,
  WindowsSandboxNativeProvider,
  WindowsSandboxStartState,
  WindowsSandboxStatus,
  WindowsSandboxUserStatus,
  WindowsSandboxWfpStatus,
  WindowsTlsTerminateCaSource,
  WindowsUninstallOptions,
}
