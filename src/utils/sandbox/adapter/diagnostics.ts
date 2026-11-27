/**
 * Sandbox platform/dependency probes, enablement predicates, root-move holds,
 * doctor diagnostics/warnings, settings mutations, and Windows backend helpers.
 */

import type { SandboxDependencyCheck } from '@anthropic-ai/sandbox-runtime'
import { SandboxManager as BaseSandboxManager } from '@anthropic-ai/sandbox-runtime'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { memoize } from 'lodash-es'
import { isIP } from 'node:net'
import { URL as NodeURL } from 'node:url'
import { logForDebugging } from '../../debug.js'
import { isEnvTruthy } from '../../envUtils.js'
import { expandPath } from '../../path.js'
import { getPlatform, type Platform } from '../../platform.js'
import { ripgrepCommand } from '../../ripgrep.js'
import {
  isSettingSourceEnabled,
  SETTING_SOURCES,
} from '../../settings/constants.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
  getSettingsForSource,
  updateSettingsForSource,
} from '../../settings/settings.js'
import type { SettingsJson } from '../../settings/types.js'
import { sandboxHelperSubprocessEnv } from '../../subprocessEnv.js'
import {
  areWindowsLocalConnectionsOn,
  ensureDefaultWindowsSandboxNativeProvider,
  getWindowsSandboxNativeProvider,
  hasWindowsSandboxSupport,
  isWindowsBackendUnset,
  isWindowsCommandLineTooLong,
  resolveWindowsBackendChoice,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  type WindowsSandboxBackend,
  WindowsSandboxError,
  willSandboxTlsTerminate,
  windowsArgvTooLongError,
  windowsSandboxStartStore,
} from '../windowsSandbox.js'
import {
  permissionRuleExtractPrefix,
  permissionRuleValueFromString,
} from './constants.js'
import { getSandboxHostState } from './hostState.js'
import {
  maskCredentialInjectionWarning,
  resolveSandboxFilesystemDisabled,
} from './pathPolicy.js'

/**
 * Check if dependencies are available (memoized)
 * Returns { errors, warnings } - errors mean sandbox cannot run
 */
const APPARMOR_USERNS_RESTRICT_PATH =
  '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
const APPARMOR_USERNS_ERROR_RE =
  /setting up uid map: Permission denied|Failed RTM_NEWADDR/
const APPARMOR_BWRAP_TRIAL_ARGS = [
  '--unshare-user',
  '--unshare-net',
  '--dev-bind',
  '/',
  '/',
  '/bin/true',
]
const APPARMOR_BWRAP_TRIAL_TIMEOUT_MS = 2000

export type AppArmorProbeDeps = {
  readRestrictionSwitch: () => string | undefined
  resolveBubblewrap: () => string | null
  tryBubblewrap: (bwrapPath: string) => {
    ran: boolean
    exitCode: number | null
    stderr: string
  }
}

function defaultResolveBubblewrap(): string | null {
  try {
    const custom = getSettings_DEPRECATED()?.sandbox?.bwrapPath
    if (custom) return expandPath(custom)
  } catch {
    // ignore settings read error
  }
  return 'bwrap'
}

function defaultTryBubblewrap(bwrapPath: string): {
  ran: boolean
  exitCode: number | null
  stderr: string
} {
  try {
    const res = spawnSync(bwrapPath, APPARMOR_BWRAP_TRIAL_ARGS, {
      cwd: '/',
      env: sandboxHelperSubprocessEnv({
        PATH: '/usr/bin:/bin',
        USER_TYPE: 'external',
        NODE_ENV: 'production',
      }),
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: APPARMOR_BWRAP_TRIAL_TIMEOUT_MS,
      encoding: 'utf8',
    })
    return {
      ran:
        res.error === undefined &&
        res.signal === null &&
        typeof res.status === 'number',
      exitCode: res.status ?? null,
      stderr: typeof res.stderr === 'string' ? res.stderr : '',
    }
  } catch {
    return { ran: false, exitCode: null, stderr: '' }
  }
}

/**
 * Official 2.1.325 #2371/#2372 (SEA `g1(d3)`):
 * Run a synchronous sandbox-runtime helper call with Claude Code's sign-in
 * tokens, API keys, and `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` temporarily
 * removed from `process.env` so child probes (`which`, `bwrap --version`,
 * `npm root -g`, `rg`) never inherit them. Safe because JS is single-threaded
 * across synchronous calls.
 */
function withStrippedSandboxHelperEnvSync<T>(fn: () => T): T {
  const sanitized = sandboxHelperSubprocessEnv(process.env)
  const removed: Array<[string, string | undefined]> = []
  for (const key of Object.keys(process.env)) {
    if (!(key in sanitized)) {
      removed.push([key, process.env[key]])
      delete process.env[key]
    }
  }
  try {
    return fn()
  } finally {
    for (const [key, val] of removed) {
      if (val !== undefined) {
        process.env[key] = val
      }
    }
  }
}

// Forward-compatible hook for sandbox-runtime versions exposing helper env provider
const baseSandboxWithHelperEnv = BaseSandboxManager as unknown as {
  setHelperEnvProvider?: (provider: () => NodeJS.ProcessEnv) => void
}
baseSandboxWithHelperEnv.setHelperEnvProvider?.(sandboxHelperSubprocessEnv)

/**
 * Official 325 `$W` (#1207): detect Ubuntu AppArmor unprivileged userns restriction
 * blocking `bwrap` and return an actionable remediation message.
 */
export function detectLinuxAppArmorUsernsRestriction(
  deps: AppArmorProbeDeps = {
    readRestrictionSwitch: () => {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- sync dependency probe
        return readFileSync(APPARMOR_USERNS_RESTRICT_PATH, 'utf8')
      } catch {
        return undefined
      }
    },
    resolveBubblewrap: defaultResolveBubblewrap,
    tryBubblewrap: defaultTryBubblewrap,
  },
): string | undefined {
  try {
    if (deps.readRestrictionSwitch()?.trim() !== '1') return undefined
    const bwrapPath = deps.resolveBubblewrap()
    if (bwrapPath === null) return undefined
    const trial = deps.tryBubblewrap(bwrapPath)
    if (!trial.ran || trial.exitCode === 0) return undefined
    logForDebugging(
      `[sandbox] kernel.apparmor_restrict_unprivileged_userns=1 and the bubblewrap trial (${bwrapPath} ${APPARMOR_BWRAP_TRIAL_ARGS.join(' ')}) exited ${trial.exitCode}: ${trial.stderr.trim()}`,
      { level: 'warn' },
    )
    if (!APPARMOR_USERNS_ERROR_RE.test(trial.stderr)) return undefined
    const matchingLine = trial.stderr
      .split('\n')
      .map(line => line.trim().replace(/^bwrap: /, ''))
      .find(line => APPARMOR_USERNS_ERROR_RE.test(line))
      ?.slice(0, 80)
    return `Ubuntu's AppArmor restriction on user namespaces stops bubblewrap here ("${matchingLine ?? ''}"). Add bubblewrap's AppArmor profile from https://code.claude.com/docs/en/sandboxing, or run \`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0\` (holds until reboot), then restart Claude Code`
  } catch (err) {
    logForDebugging(
      `[sandbox] the AppArmor user-namespace check could not be made: ${err}`,
      { level: 'warn' },
    )
    return undefined
  }
}

export const baseCheckDependencies = memoize((): SandboxDependencyCheck => {
  const { rgPath, rgArgs } = ripgrepCommand()
  const base = withStrippedSandboxHelperEnvSync(() =>
    BaseSandboxManager.checkDependencies({
      command: rgPath,
      args: rgArgs,
    }),
  )
  const platform = getPlatform()
  if (
    (platform === 'linux' || platform === 'wsl') &&
    base.errors.length === 0 &&
    getSandboxHostState().initializationPromise === undefined
  ) {
    const appArmorError = detectLinuxAppArmorUsernsRestriction()
    if (appArmorError !== undefined) {
      return { ...base, errors: [appArmorError] }
    }
  }
  return base
})

export function checkDependencies(): SandboxDependencyCheck {
  if (getPlatform() === 'windows') {
    if (!hasWindowsSandboxSupport()) {
      return {
        warnings: [],
        errors: ['Windows sandbox runtime is not available on this build'],
      }
    }
    if (isWindowsBackendUnset()) {
      return {
        warnings: [],
        errors: [WINDOWS_BACKEND_UNSET_MESSAGE],
      }
    }
    return { warnings: [], errors: [] }
  }
  return baseCheckDependencies()
}

export function isSandboxHeldOnByFailedSettingsRead(): boolean {
  getSandboxEnabledSetting()
  return getSandboxHostState().isHeldOnByFailedSettingsRead
}

function setSandboxHeldOnByFailedRead(held: boolean): void {
  const hostState = getSandboxHostState()
  if (held === hostState.isHeldOnByFailedSettingsRead) return
  hostState.isHeldOnByFailedSettingsRead = held
  logForDebugging(
    held
      ? '[sandbox] The settings could not be read, so the sandbox stays on; auto-allow is off and dangerouslyDisableSandbox is ignored until they can be read again'
      : '[sandbox] The sandbox is no longer kept on by unreadable settings and follows the settings again',
    { level: 'warn' },
  )
}

export function getSandboxEnabledSetting(): boolean {
  const hostState = getSandboxHostState()
  try {
    const settings = getSettings_DEPRECATED()
    if (settings == null) {
      setSandboxHeldOnByFailedRead(hostState.sandboxWasEnabled)
      return hostState.sandboxWasEnabled
    }
    const enabled = settings?.sandbox?.enabled ?? false
    if (enabled) {
      hostState.sandboxWasEnabled = true
    }
    setSandboxHeldOnByFailedRead(false)
    return enabled
  } catch (error) {
    logForDebugging(`Failed to get settings for sandbox check: ${error}`)
    setSandboxHeldOnByFailedRead(hostState.sandboxWasEnabled)
    return hostState.sandboxWasEnabled
  }
}

export function isSandboxHeldOnByRootMove(): boolean {
  return (
    getSandboxHostState().sandboxRootMoveHold !== undefined &&
    getSettings_DEPRECATED()?.sandbox?.enabled !== true
  )
}

export function captureSandboxRootMoveHold(): void {
  const hostState = getSandboxHostState()
  if (
    !getSandboxEnabledSetting() &&
    hostState.sandboxRootMoveHold === undefined
  ) {
    return
  }
  try {
    hostState.sandboxRootMoveHold = {
      isStrict: !areUnsandboxedCommandsAllowed(),
      isStrictByFailedRead:
        isSandboxHeldOnByFailedSettingsRead() ||
        hostState.sandboxRootMoveHold?.isStrictByFailedRead === true,
      isRequired: isSandboxRequiredBySettings(),
      isAutoAllowOff: !isAutoAllowBashIfSandboxedEnabled(),
    }
  } catch (err) {
    logForDebugging(
      `Could not read the sandbox settings before a move, so keeping the sandbox at its strictest: ${err}`,
      { level: 'error' },
    )
    hostState.sandboxRootMoveHold = {
      isStrict: true,
      isStrictByFailedRead: true,
      isRequired: true,
      isAutoAllowOff: true,
    }
  }
}

/**
 * Official 2.1.325 #2353 & #2354 (`_pe`) + 2.1.326 #299 (`rootMoveHold`):
 * - `autoAllowBashIfSandboxed` defaults to `false` (sandboxed Bash commands
 *   follow the normal permission flow unless explicitly set to `true`).
 * - When managed settings (`policySettings`) turn the sandbox on, auto-allow
 *   only applies if the highest-ranking managed source explicitly sets
 *   `autoAllowBashIfSandboxed: true`.
 * - When `rootMoveHold` is active with `isAutoAllowOff` or holding sandbox on,
 *   auto-allow stays off so Bash asks first.
 */
export function isAutoAllowBashIfSandboxedEnabled(): boolean {
  if (isSandboxHeldOnByFailedSettingsRead()) {
    return false
  }
  if (
    getSandboxHostState().sandboxRootMoveHold?.isAutoAllowOff ||
    isSandboxHeldOnByRootMove()
  ) {
    return false
  }
  const policySandbox = getSettingsForSource('policySettings')?.sandbox
  if (policySandbox?.enabled === true) {
    return policySandbox.autoAllowBashIfSandboxed === true
  }
  if (policySandbox?.autoAllowBashIfSandboxed === false) {
    return false
  }
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.autoAllowBashIfSandboxed ?? false
}

export function areUnsandboxedCommandsAllowed(): boolean {
  if (
    isSandboxHeldOnByFailedSettingsRead() ||
    getSandboxHostState().sandboxRootMoveHold?.isStrict
  ) {
    return false
  }
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.allowUnsandboxedCommands ?? true
}

function isSandboxRequiredBySettings(): boolean {
  if (getSandboxHostState().sandboxRootMoveHold?.isRequired) {
    return true
  }
  const settings = getSettings_DEPRECATED()
  return (
    getSandboxEnabledSetting() &&
    isPlatformInEnabledList() &&
    (settings?.sandbox?.failIfUnavailable ?? false)
  )
}

/**
 * Official 2.1.325 #2374 (`W3` / `V3`):
 * Claude Code on the web, cloud scheduled tasks, and Cowork cloud sessions
 * run inside an isolated hosted Linux container without a command sandbox
 * (`bwrap`). Set aside `sandbox.failIfUnavailable` so those sessions can start
 * with a warning instead of exiting fatally.
 */
export function wouldSetAsideSandboxRequirementInHostedWorker(): boolean {
  const hostState = getSandboxHostState()
  const isHostedLinuxContainer =
    getPlatform() === 'linux' &&
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND === undefined &&
    (hostState.hostedToolContainer ||
      (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
        Boolean(
          process.env.CLAUDE_CODE_REMOTE_SESSION_ID ||
            process.env.CLAUDE_CODE_CONTAINER_ID,
        )))
  if (!isHostedLinuxContainer) return false
  if (!isSandboxRequiredBySettings() || hostState.sandboxStartedOnce) {
    return false
  }
  const deps = checkDependencies()
  return deps.errors.length > 0
}

export function isSandboxRequirementSetAsideInHostedWorker(): boolean {
  return wouldSetAsideSandboxRequirementInHostedWorker()
}

export function isSandboxRequired(): boolean {
  return (
    isSandboxRequiredBySettings() &&
    !isSandboxRequirementSetAsideInHostedWorker()
  )
}

/**
 * Check if the current platform is supported for sandboxing (memoized)
 * Supports: macOS, Linux, WSL2+ (WSL1 is not supported), and Windows (when
 * a Windows sandbox native provider or MXC SDK is present).
 */
export const baseIsSupportedPlatform = memoize((): boolean => {
  return BaseSandboxManager.isSupportedPlatform()
})

export function isSupportedPlatform(): boolean {
  if (getPlatform() === 'windows') {
    return hasWindowsSandboxSupport()
  }
  return baseIsSupportedPlatform()
}

/**
 * Check if the current platform is in the enabledPlatforms list.
 *
 * This is an undocumented setting that allows restricting sandbox to specific platforms.
 * When enabledPlatforms is not set, all supported platforms are allowed.
 *
 * Added to unblock NVIDIA enterprise rollout: they want to enable autoAllowBashIfSandboxed
 * but only on macOS initially, since Linux/WSL sandbox support is newer. This allows
 * setting enabledPlatforms: ["macos"] to disable sandbox (and auto-allow) on other platforms.
 */
export function isPlatformInEnabledList(): boolean {
  try {
    const settings = getInitialSettings()
    const enabledPlatforms = (
      settings?.sandbox as { enabledPlatforms?: Platform[] } | undefined
    )?.enabledPlatforms

    if (enabledPlatforms === undefined) {
      return true
    }

    if (enabledPlatforms.length === 0) {
      return false
    }

    const currentPlatform = getPlatform()
    return enabledPlatforms.includes(currentPlatform)
  } catch (error) {
    logForDebugging(`Failed to check enabledPlatforms: ${error}`)
    return true // Default to enabled if we can't read settings
  }
}

/**
 * Check if sandboxing is enabled
 * This checks the user's enabled setting, platform support, and enabledPlatforms restriction
 */
export function isSandboxingEnabled(): boolean {
  const hostState = getSandboxHostState()
  if (hostState.sandboxDisabledThisSession) {
    return false
  }
  if (!isSupportedPlatform()) {
    return false
  }

  if (checkDependencies().errors.length > 0) {
    return false
  }

  // Check if current platform is in the enabledPlatforms list (undocumented setting)
  if (!isPlatformInEnabledList()) {
    return false
  }

  return (
    getSandboxEnabledSetting() || hostState.sandboxRootMoveHold !== undefined
  )
}

/**
 * If the user explicitly enabled sandbox (sandbox.enabled: true in settings)
 * but it cannot actually run, return a human-readable reason. Otherwise
 * return undefined.
 *
 * Fix for #34044: previously isSandboxingEnabled() silently returned false
 * when dependencies were missing, giving users zero feedback that their
 * explicit security setting was being ignored. This is a security footgun —
 * users configure allowedDomains expecting enforcement, get none.
 *
 * Call this once at startup (REPL/print) and surface the reason if present.
 * Does not cover the case where the user never enabled sandbox (no noise).
 */
export function getSandboxUnavailableReason(): string | undefined {
  // Only warn if user explicitly asked for sandbox. If they didn't enable
  // it, missing deps are irrelevant.
  if (!getSandboxEnabledSetting()) {
    return undefined
  }

  if (!isSupportedPlatform()) {
    const platform = getPlatform()
    if (platform === 'wsl') {
      return 'sandbox.enabled is set but WSL1 is not supported (requires WSL2)'
    }
    if (platform === 'windows') {
      return 'sandbox.enabled is set but the Windows sandbox is not enabled on this build (install srt-win.exe or use WSL2)'
    }
    return `sandbox.enabled is set but ${platform} is not supported (requires macOS, Linux, or WSL2)`
  }

  if (!isPlatformInEnabledList()) {
    return `sandbox.enabled is set but ${getPlatform()} is not in sandbox.enabledPlatforms`
  }

  if (getPlatform() === 'windows' && isWindowsBackendUnset()) {
    return WINDOWS_BACKEND_UNSET_MESSAGE
  }

  const deps = checkDependencies()
  if (deps.errors.length > 0) {
    const platform = getPlatform()
    const hint =
      platform === 'macos'
        ? 'run /sandbox or /doctor for details'
        : platform === 'windows'
          ? 'run /sandbox install or claude sandbox status for details'
          : 'install missing tools (e.g. apt install bubblewrap socat) or run /sandbox for details'
    return `sandbox.enabled is set but dependencies are missing: ${deps.errors.join(', ')} · ${hint}`
  }

  return undefined
}

/**
 * Get glob patterns that won't work fully on Linux/WSL
 */
export function getLinuxGlobPatternWarnings(): string[] {
  // Only return warnings on Linux/WSL (bubblewrap doesn't support globs)
  const platform = getPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    return []
  }

  // densable uCg: when filesystem.disabled, no glob warnings (FS rules not enforced)
  if (resolveSandboxFilesystemDisabled()) {
    return []
  }

  try {
    const settings = getSettings_DEPRECATED()

    // Only return warnings when sandboxing is enabled (check settings directly, not cached value)
    if (!settings?.sandbox?.enabled) {
      return []
    }

    const permissions = settings?.permissions || {}
    const warnings: string[] = []

    // Helper to check if a path has glob characters (excluding trailing /**)
    const hasGlobs = (path: string): boolean => {
      const stripped = path.replace(/\/\*\*$/, '')
      return /[*?[\]]/.test(stripped)
    }

    // Check all permission rules
    for (const ruleString of [
      ...(permissions.allow || []),
      ...(permissions.deny || []),
    ]) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        (rule.toolName === FILE_EDIT_TOOL_NAME ||
          rule.toolName === FILE_READ_TOOL_NAME) &&
        rule.ruleContent &&
        hasGlobs(rule.ruleContent)
      ) {
        warnings.push(ruleString)
      }
    }

    return warnings
  } catch (error) {
    logForDebugging(`Failed to get Linux glob pattern warnings: ${error}`)
    return []
  }
}

// ============================================================================
// densable 2.1.229 #26 — IPv6 / unreliable domain spelling warnings
// SEA: iA_ / sA_ / VFs / fHo / RRe / jNe / UFs / nnd=/^[1-9][0-9]{0,4}$/
// ============================================================================

/** densable nnd — port suffix 1–65535, no leading zeros */
const IPV6_PORT_SUFFIX_RE = /^[1-9][0-9]{0,4}$/

/** densable jNe — strip surrounding [] from host */
function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * densable RRe — canonicalize host via URL hostname + strip trailing dot.
 * Returns undefined when the host is not a valid URL host.
 */
function canonicalizeNetworkHost(host: string): string | undefined {
  try {
    const stripped = stripIpv6Brackets(host)
    const forUrl = isIP(stripped) === 6 ? `[${stripped}]` : stripped
    const hostname = new NodeURL(`http://${forUrl}/`).hostname
    return stripIpv6Brackets(hostname).replace(/\.$/, '')
  } catch {
    return undefined
  }
}

/**
 * densable fHo — non-IPv6 host whose canonical form differs from lowercase input
 * (trailing-dot / punycode / case drift).
 */
function isNonCanonicalDomainSpelling(host: string): boolean {
  if (isIP(host) === 6) return false
  const canonical = canonicalizeNetworkHost(host)
  return canonical !== undefined && canonical !== host.toLowerCase()
}

/**
 * densable VFs — unbracketed multi-colon entry (bare IPv6 or host:port with IPv6).
 */
function isUnbracketedMultiColonDomain(entry: string): boolean {
  const first = entry.indexOf(':')
  return (
    first !== -1 &&
    entry.indexOf(':', first + 1) !== -1 &&
    !entry.startsWith('[')
  )
}

/**
 * densable UFs — collect allowedDomains / deniedDomains from settings +
 * WebFetch(domain:...) permission rules.
 */
function collectSandboxNetworkDomains(
  settingsList: Array<SettingsJson | undefined | null>,
  side: 'allow' | 'deny',
): string[] {
  const key = side === 'allow' ? 'allowedDomains' : 'deniedDomains'
  const out: string[] = []
  for (const settings of settingsList) {
    if (!settings) continue
    for (const domain of settings.sandbox?.network?.[key] ?? []) {
      out.push(domain)
    }
    for (const ruleString of settings.permissions?.[side] ?? []) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        out.push(rule.ruleContent.substring('domain:'.length))
      }
    }
  }
  return out
}

/**
 * densable EV-ish: non-empty settings sources (enabled only).
 * Used with merged settings so doctor sees user+project+policy domains.
 */
function listNonEmptySettingsSources(): SettingsJson[] {
  const out: SettingsJson[] = []
  for (const source of SETTING_SOURCES) {
    if (!isSettingSourceEnabled(source)) continue
    const s = getSettingsForSource(source)
    if (s && Object.keys(s).length > 0) out.push(s)
  }
  return out
}

/**
 * densable iA_ / getUnbracketedIpv6DomainWarnings.
 *
 * Flags domain entries that are unreliable for fail-closed enforcement:
 * - contains `@`
 * - unbracketed multi-colon (bare IPv6)
 * - bracketed IPv6 with bad port / non-IPv6 interior / leading zeros / globs
 */
export function getUnbracketedIpv6DomainWarnings(): string[] {
  try {
    const merged = getSettings_DEPRECATED()
    const sources = listNonEmptySettingsSources()
    const settingsList = [...(merged ? [merged] : []), ...sources]
    const bad = new Set<string>()
    for (const side of ['allow', 'deny'] as const) {
      for (const entry of collectSandboxNetworkDomains(settingsList, side)) {
        if (entry.includes('@')) {
          bad.add(entry)
          continue
        }
        if (isUnbracketedMultiColonDomain(entry)) {
          bad.add(entry)
          continue
        }
        if (entry.startsWith('[')) {
          const close = entry.indexOf(']')
          const after = close === -1 ? undefined : entry.slice(close + 1)
          const interior = close === -1 ? undefined : entry.slice(1, close)
          if (
            after === undefined ||
            interior === undefined ||
            (after !== '' &&
              (!after.startsWith(':') ||
                !IPV6_PORT_SUFFIX_RE.test(after.slice(1)) ||
                Number(after.slice(1)) > 65535)) ||
            canonicalizeNetworkHost(interior) === undefined ||
            isNonCanonicalDomainSpelling(interior) ||
            interior.includes('*')
          ) {
            bad.add(entry)
          }
        }
      }
    }
    return [...bad]
  } catch (error) {
    logForDebugging(`Failed to get IPv6 domain entry warnings: ${error}`)
    return []
  }
}

/**
 * densable sA_ / getUnbracketedIpv6InjectHostWarnings.
 * injectHosts multi-colon entries that are not already lowercase canonical IPv6.
 */
export function getUnbracketedIpv6InjectHostWarnings(): string[] {
  try {
    const merged = getSettings_DEPRECATED()
    const sources = listNonEmptySettingsSources()
    const settingsList = [...(merged ? [merged] : []), ...sources]
    const bad = new Set<string>()
    for (const settings of settingsList) {
      const creds = settings.sandbox?.credentials
      for (const item of [
        ...(creds?.envVars ?? []),
        ...(creds?.files ?? []),
      ] as Array<{ injectHosts?: string[] }>) {
        for (const host of item.injectHosts ?? []) {
          const first = host.indexOf(':')
          if (first === -1 || host.indexOf(':', first + 1) === -1) continue
          if (
            isIP(host) === 6 &&
            canonicalizeNetworkHost(host) === host.toLowerCase()
          ) {
            continue
          }
          bad.add(host)
        }
      }
    }
    return [...bad]
  } catch (error) {
    logForDebugging(`Failed to get injectHosts entry warnings: ${error}`)
    return []
  }
}

/**
 * densable `ruu` — gate for mask-credential warning path.
 * densable: (tkt() || (zO()&&false)) && cjr() ≡ settings sandbox.enabled && platform allowed.
 */
export function canMaskCredentialWarningFire(): boolean {
  return getSandboxEnabledSetting() && isPlatformInEnabledList()
}

/**
 * densable `o0g` / getMaskCredentialWarning — needs package getConfig() (after init).
 */
export function getMaskCredentialWarning(): string | undefined {
  try {
    if (!canMaskCredentialWarningFire()) {
      return undefined
    }
    const cfg = BaseSandboxManager.getConfig?.()
    if (cfg === undefined) {
      return undefined
    }
    return maskCredentialInjectionWarning(cfg)
  } catch (e) {
    logForDebugging(`Failed to compute mask credential warning: ${e}`)
    return undefined
  }
}

/**
 * Check if sandbox settings are locked by policy
 */
export function areSandboxSettingsLockedByPolicy(): boolean {
  // Check if sandbox settings are explicitly set in any source that overrides localSettings
  // These sources have higher priority than localSettings and would make local changes ineffective
  const overridingSources = ['flagSettings', 'policySettings'] as const

  for (const source of overridingSources) {
    const settings = getSettingsForSource(source)
    if (
      settings?.sandbox?.enabled !== undefined ||
      settings?.sandbox?.autoAllowBashIfSandboxed !== undefined ||
      settings?.sandbox?.allowUnsandboxedCommands !== undefined
    ) {
      return true
    }
  }

  return false
}

/**
 * densable `Ge.isStrictSandboxModeConfigured` — policy/flag sandbox lock.
 * Local twin is `areSandboxSettingsLockedByPolicy`.
 */
export function isStrictSandboxModeConfigured(): boolean {
  return areSandboxSettingsLockedByPolicy()
}

/**
 * Set sandbox settings
 */
export async function setSandboxSettings(options: {
  enabled?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
}): Promise<{ error: Error | null }> {
  const existingSettings = getSettingsForSource('localSettings')

  // Note: Memoized caches auto-invalidate when settings change because they use
  // the settings object as the cache key (new settings object = cache miss)

  const result = updateSettingsForSource('localSettings', {
    sandbox: {
      ...existingSettings?.sandbox,
      ...(options.enabled !== undefined && { enabled: options.enabled }),
      ...(options.autoAllowBashIfSandboxed !== undefined && {
        autoAllowBashIfSandboxed: options.autoAllowBashIfSandboxed,
      }),
      ...(options.allowUnsandboxedCommands !== undefined && {
        allowUnsandboxedCommands: options.allowUnsandboxedCommands,
      }),
    },
  })
  if (!result.error) {
    const hostState = getSandboxHostState()
    if (options.enabled === false) {
      hostState.sandboxWasEnabled = false
      setSandboxHeldOnByFailedRead(false)
      hostState.sandboxRootMoveHold = undefined
    } else if (hostState.sandboxRootMoveHold !== undefined) {
      hostState.sandboxRootMoveHold = {
        ...hostState.sandboxRootMoveHold,
        isStrict:
          hostState.sandboxRootMoveHold.isStrict &&
          options.allowUnsandboxedCommands !== true,
        isAutoAllowOff:
          hostState.sandboxRootMoveHold.isAutoAllowOff &&
          options.autoAllowBashIfSandboxed !== true,
      }
    }
  }
  return result
}

/**
 * Get excluded commands (commands that should not be sandboxed)
 */
export function getExcludedCommands(): string[] {
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.excludedCommands ?? []
}

/**
 * Add a command to the excluded commands list (commands that should not be sandboxed)
 * This is a Claude CLI-specific function that updates local settings.
 */
export function addToExcludedCommandsWithResult(
  command: string,
  permissionUpdates?: Array<{
    type: string
    rules: Array<{ toolName: string; ruleContent?: string }>
  }>,
  source: 'localSettings' | 'userSettings' = 'localSettings',
): {
  commandPattern: string
  settingsSource: 'localSettings' | 'userSettings'
  error: Error | null
} {
  const existingSettings = getSettingsForSource(source)
  const existingExcludedCommands =
    existingSettings?.sandbox?.excludedCommands || []

  // Determine the command pattern to add
  // If there are suggestions with Bash rules, extract the pattern (e.g., "npm run test" from "npm run test:*")
  // Otherwise use the exact command
  let commandPattern: string = command

  if (permissionUpdates) {
    const bashSuggestions = permissionUpdates.filter(
      update =>
        update.type === 'addRules' &&
        update.rules.some(rule => rule.toolName === BASH_TOOL_NAME),
    )

    if (bashSuggestions.length > 0 && bashSuggestions[0]!.type === 'addRules') {
      const firstBashRule = bashSuggestions[0]!.rules.find(
        rule => rule.toolName === BASH_TOOL_NAME,
      )
      if (firstBashRule?.ruleContent) {
        // Extract pattern from Bash(command) or Bash(command:*) format
        const prefix = permissionRuleExtractPrefix(firstBashRule.ruleContent)
        commandPattern = prefix || firstBashRule.ruleContent
      }
    }
  }

  // Add to excludedCommands if not already present
  let error: Error | null = null
  if (!existingExcludedCommands.includes(commandPattern)) {
    const result = updateSettingsForSource(source, {
      sandbox: {
        ...existingSettings?.sandbox,
        excludedCommands: [...existingExcludedCommands, commandPattern],
      },
    })
    error = result.error
  }

  return { commandPattern, settingsSource: source, error }
}

export function addToExcludedCommands(
  command: string,
  permissionUpdates?: Array<{
    type: string
    rules: Array<{ toolName: string; ruleContent?: string }>
  }>,
  source: 'localSettings' | 'userSettings' = 'localSettings',
): string {
  return addToExcludedCommandsWithResult(command, permissionUpdates, source)
    .commandPattern
}

// ============================================================================
// Windows Backend Helpers (Official 2.1.331)
// ============================================================================

export function getWindowsSandboxBackend(): WindowsSandboxBackend {
  return (
    windowsSandboxStartStore.get().windowsBackendAtStart ??
    resolveWindowsBackendChoice().backend
  )
}

export function isBashRefusedByMxcBackend(): boolean {
  return (
    getPlatform() === 'windows' &&
    getSandboxEnabledSetting() &&
    isPlatformInEnabledList() &&
    hasWindowsSandboxSupport() &&
    getWindowsSandboxBackend() === 'mxc' &&
    !isWindowsBackendUnset()
  )
}

export function isBashToolWithheldForMxcBackend(): boolean {
  const state = windowsSandboxStartStore.get()
  if (state.bashRefusedByMxcAtStart === undefined) {
    if (
      getPlatform() === 'windows' &&
      getWindowsSandboxNativeProvider() === undefined
    ) {
      ensureDefaultWindowsSandboxNativeProvider()
    }
    state.bashRefusedByMxcAtStart = isBashRefusedByMxcBackend()
  }
  return state.bashRefusedByMxcAtStart
}

export async function spawnSandboxedOnWindows(
  command: string,
  opts?: Record<string, unknown>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (isWindowsBackendUnset()) {
    throw new WindowsSandboxError(
      'backend_unset',
      WINDOWS_BACKEND_UNSET_MESSAGE,
      'spawn',
    )
  }
  const rawArgs = Array.isArray(opts?.args) ? opts.args : undefined
  if (isWindowsCommandLineTooLong(command, rawArgs)) {
    throw windowsArgvTooLongError({
      hasAddedDenies: Boolean(opts?.hasAddedDenies),
    })
  }
  const provider = getWindowsSandboxNativeProvider()
  if (!provider?.spawnSandboxed) {
    throw new WindowsSandboxError(
      'spawn_unavailable',
      'Windows sandbox native provider does not support spawnSandboxed',
      'spawn',
    )
  }
  return provider.spawnSandboxed(command, opts)
}

export function needsRestartForTlsTerminate(): boolean {
  const state = windowsSandboxStartStore.get()
  if (state.tlsTerminateAtStart === undefined) {
    return false
  }
  return willSandboxTlsTerminate() !== state.tlsTerminateAtStart
}

export function needsRestartForLocalConnections(): boolean {
  const state = windowsSandboxStartStore.get()
  if (state.localConnectionsAtStart === undefined) {
    return false
  }
  return areWindowsLocalConnectionsOn() !== state.localConnectionsAtStart
}

export function getProfileReadSecurityWarnings(): string[] {
  return [...windowsSandboxStartStore.get().profileReadWarnings]
}
