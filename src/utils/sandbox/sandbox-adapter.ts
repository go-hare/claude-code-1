/**
 * Adapter layer that wraps @anthropic-ai/sandbox-runtime with Claude CLI-specific integrations.
 * This file provides the bridge between the external sandbox-runtime package and Claude CLI's
 * settings system, tool integration, and additional features.
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
import { rmSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { memoize } from 'lodash-es'
import { homedir } from 'os'
import { dirname, join, posix, resolve, sep } from 'path'
import {
  getAdditionalDirectoriesForClaudeMd,
  getCwdState,
  getOriginalCwd,
} from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { expandPath } from '../path.js'
import { getPlatform, type Platform } from '../platform.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  isSettingSourceEnabled,
  SETTING_SOURCES,
  type SettingSource,
} from '../settings/constants.js'
import { getManagedSettingsDropInDir } from '../settings/managedPath.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
  getSettingsFilePathForSource,
  getSettingsForSource,
  getSettingsRootPathForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

// ============================================================================
// Settings Converter
// ============================================================================

import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { errorMessage } from '../errors.js'
import { readHostProxyPorts } from '../hostProxyPorts.js'
import { getClaudeTempDir } from '../permissions/filesystem.js'
import type { PermissionRuleValue } from '../permissions/PermissionRule.js'
import { ripgrepCommand } from '../ripgrep.js'

// ============================================================================
// Credential Protection Constants (from official sandbox.credentials)
// ============================================================================

/**
 * Environment files that should be write-protected in sandbox mode.
 * Equivalent to official NXq constant.
 */
export const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
  '.env.production',
  '.env.production.local',
] as const

/**
 * System directories that are allowed for writes in sandbox mode.
 * Equivalent to official gH7 constant.
 */
export const ALLOW_WRITE_SYSTEM_DIRS = [
  '/home',
  '/root',
  '/tmp',
  '/var',
  '/opt',
  '/run',
  '/mnt',
] as const

/**
 * Socket and runtime paths denied for reads in sandbox mode.
 * Equivalent to official denyRead list in CXq().
 */
export const DENY_READ_SOCKET_PATHS = [
  '/run/docker.sock',
  '/run/containerd/containerd.sock',
  '/run/podman/podman.sock',
  '/run/buildkit/buildkitd.sock',
  '/run/dbus',
  '/run/user',
] as const

/**
 * Base credential/config file names to protect.
 * Equivalent to official vD8 constant.
 */
export const SENSITIVE_CREDENTIAL_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
] as const

/**
 * Extended credential/config file names to protect (includes .claude.json).
 * Equivalent to official Gwf constant.
 */
export const EXTENDED_CREDENTIAL_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
  '.claude.json',
] as const

/**
 * Sensitive directory names to protect.
 * Equivalent to official V01 constant.
 */
export const SENSITIVE_DIRECTORIES = ['.git', '.vscode', '.idea'] as const

/**
 * Extended sensitive directory names to protect (includes .claude, .husky).
 * Equivalent to official Vwf constant.
 */
export const EXTENDED_SENSITIVE_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
  '.claude',
  '.husky',
] as const

/**
 * CA certificate bundle environment variables that should be scrubbed from
 * subprocess environments. If leaked, an attacker could point these at a
 * malicious CA bundle and MITM tooling (curl, git, pip, node, cargo, etc.).
 * Equivalent to official T01 constant.
 */
export const CA_CERT_ENV_VARS = [
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'PIP_CERT',
  'GIT_SSL_CAINFO',
  'AWS_CA_BUNDLE',
  'CARGO_HTTP_CAINFO',
  'DENO_CERT',
] as const

// Local copies to avoid circular dependency
// (permissions.ts imports SandboxManager, bashPermissions.ts imports permissions.ts)
function permissionRuleValueFromString(
  ruleString: string,
): PermissionRuleValue {
  const matches = ruleString.match(/^([^(]+)\(([^)]+)\)$/)
  if (!matches) {
    return { toolName: ruleString }
  }
  const toolName = matches[1]
  const ruleContent = matches[2]
  if (!toolName || !ruleContent) {
    return { toolName: ruleString }
  }
  return { toolName, ruleContent }
}

function permissionRuleExtractPrefix(permissionRule: string): string | null {
  const match = permissionRule.match(/^(.+):\*$/)
  return match?.[1] ?? null
}

/**
 * Resolve Claude Code-specific path patterns for sandbox-runtime.
 *
 * Claude Code uses special path prefixes in permission rules:
 * - `//path` → absolute from filesystem root (becomes `/path`)
 * - `/path` → relative to settings file directory (becomes `$SETTINGS_DIR/path`)
 * - `~/path` → passed through (sandbox-runtime handles this)
 * - `./path` or `path` → passed through (sandbox-runtime handles this)
 *
 * This function only handles CC-specific conventions (`//` and `/`).
 * Standard path patterns like `~/` and relative paths are passed through
 * for sandbox-runtime's normalizePathForSandbox to handle.
 *
 * @param pattern The path pattern from a permission rule
 * @param source The settings source this pattern came from (needed to resolve `/path` patterns)
 */
/**
 * densable `kA` — simple glob-char probe used by trailing-slash strip (Mmr).
 * Glob paths keep their trailing slash (directory-glob semantics); non-glob
 * deny/allow paths strip it so `~/.aws/` matches the directory itself.
 */
function pathHasGlobChars(path: string): boolean {
  return (
    path.includes('*') ||
    path.includes('?') ||
    path.includes('[') ||
    path.includes(']')
  )
}

/**
 * densable `Mmr` (2.1.224 #10) — strip trailing `/` on non-Windows, non-glob
 * paths so deny entries written as `~/.aws/` are not silently bypassable.
 * Root `/` stays `/`. Windows keeps trailing separators (drive roots / UNC).
 */
export function stripTrailingSlashForSandbox(
  path: string,
  opts: { evenAfterGlob?: boolean } = {},
): string {
  if (getPlatform() === 'windows' || !path.endsWith('/')) return path
  if (!opts.evenAfterGlob && pathHasGlobChars(path)) return path
  return path.replace(/\/+$/, '') || '/'
}

/**
 * Resolve Claude Code-specific path patterns for sandbox-runtime.
 *
 * Claude Code uses special path prefixes in permission rules:
 * - `//path` → absolute from filesystem root (becomes `/path`)
 * - `/path` → relative to settings file directory (becomes `$SETTINGS_DIR/path`)
 * - `~/path` → passed through (sandbox-runtime handles this)
 * - `./path` or `path` → passed through (sandbox-runtime handles this)
 *
 * This function only handles CC-specific conventions (`//` and `/`).
 * Standard path patterns like `~/` and relative paths are passed through
 * for sandbox-runtime's normalizePathForSandbox to handle.
 *
 * densable `swo`/`ZEo`: after resolve, apply Mmr trailing-slash strip.
 *
 * @param pattern The path pattern from a permission rule
 * @param source The settings source this pattern came from (needed to resolve `/path` patterns)
 */
export function resolvePathPatternForSandbox(
  pattern: string,
  source: SettingSource,
): string {
  // Handle // prefix - absolute from root (CC-specific convention)
  if (pattern.startsWith('//')) {
    return stripTrailingSlashForSandbox(pattern.slice(1)) // "//.aws/**" → "/.aws/**"
  }

  // Handle / prefix - relative to settings file directory (CC-specific convention)
  // Note: ~/path and relative paths are passed through for sandbox-runtime to handle
  if (pattern.startsWith('/') && !pattern.startsWith('//')) {
    const root = getSettingsRootPathForSource(source)
    // Pattern like "/foo/**" becomes "${root}/foo/**"
    return stripTrailingSlashForSandbox(resolve(root, pattern.slice(1)))
  }

  // Other patterns (~/path, ./path, path) pass through as-is
  // sandbox-runtime's normalizePathForSandbox will handle them
  return stripTrailingSlashForSandbox(pattern)
}

/**
 * Resolve paths from sandbox.filesystem.* settings (allowWrite, denyWrite, etc).
 *
 * Unlike permission rules (Edit/Read), these settings use standard path semantics:
 * - `/path` → absolute path (as written, NOT settings-relative)
 * - `~/path` → expanded to home directory
 * - `./path` or `path` → relative to settings file directory
 * - `//path` → absolute (legacy permission-rule syntax, accepted for compat)
 *
 * Fix for #30067: resolvePathPatternForSandbox treats `/Users/foo/.cargo` as
 * settings-relative (permission-rule convention). Users reasonably expect
 * absolute paths in sandbox.filesystem.allowWrite to work as-is.
 *
 * Also expands `~` here rather than relying on sandbox-runtime, because
 * sandbox-runtime's getFsWriteConfig() does not call normalizePathForSandbox
 * on allowWrite paths (it only strips trailing glob suffixes).
 *
 * densable `awo`/`c2t` (2.1.224 #10): expand then Mmr strip trailing slash so
 * `denyRead: "~/.aws/"` is not silently bypassable on Linux/macOS.
 */
export function resolveSandboxFilesystemPath(
  pattern: string,
  source: SettingSource,
): string {
  // Legacy permission-rule escape: //path → /path. Kept for compat with
  // users who worked around #30067 by writing //Users/foo/.cargo in config.
  if (pattern.startsWith('//')) {
    return stripTrailingSlashForSandbox(pattern.slice(1))
  }
  return stripTrailingSlashForSandbox(
    expandPath(pattern, getSettingsRootPathForSource(source)),
  )
}

/**
 * Check if only managed sandbox domains should be used.
 * This is true when policySettings has sandbox.network.allowManagedDomainsOnly: true
 */
export function shouldAllowManagedSandboxDomainsOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.sandbox?.network
      ?.allowManagedDomainsOnly === true
  )
}

function shouldAllowManagedReadPathsOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.sandbox?.filesystem
      ?.allowManagedReadPathsOnly === true
  )
}

/**
 * densable 2.1.216 — managed lock for sandbox.filesystem.disabled.
 * If policySettings configures sandbox.filesystem at all, or lists any
 * sandbox.credentials.files entry, only managed settings may set disabled.
 * credentials.envVars does not pin (env scrubbing is independent of FS layer).
 */
export function isSandboxFilesystemDisabledLockedByManaged(): boolean {
  const managedSandbox = getSettingsForSource('policySettings')?.sandbox
  if (!managedSandbox) {
    return false
  }
  if (managedSandbox.filesystem !== undefined) {
    return true
  }
  // densable: managed lock when credentials.files has any entry (envVars do not pin).
  const files = managedSandbox.credentials?.files
  return Array.isArray(files) && files.length > 0
}

/**
 * densable 2.1.216 Gvg/Wvg gate — effective sandbox.filesystem.disabled.
 *
 * - Native Windows: always false (isolation must stay on).
 * - projectSettings / localSettings: ignored for this flag.
 * - Honored only from userSettings, flagSettings (`--settings`), policySettings.
 * - When managed locks filesystem (or credentials.files), only policySettings.disabled.
 * - Unset → false (FS isolation on).
 */
export function resolveSandboxFilesystemDisabled(): boolean {
  // densable: ignored on native Windows (separate-user sandbox has no grants
  // to loosen by dropping FS rules).
  if (getPlatform() === 'windows') {
    return false
  }

  if (isSandboxFilesystemDisabledLockedByManaged()) {
    return (
      getSettingsForSource('policySettings')?.sandbox?.filesystem?.disabled ===
      true
    )
  }

  // Later sources win among allowed sources (user < flag). policy is only
  // consulted when it does not lock; if it sets filesystem.disabled without
  // "configuring filesystem" it can't happen — lock checks filesystem !== undefined.
  // Allowed sources when unlocked: userSettings, flagSettings.
  // densable also honors managed when unlocked — if managed has disabled without
  // filesystem object it can't; if managed has only other sandbox keys, user/flag apply.
  const flagDisabled =
    getSettingsForSource('flagSettings')?.sandbox?.filesystem?.disabled
  if (flagDisabled !== undefined) {
    return flagDisabled === true
  }

  const userDisabled =
    getSettingsForSource('userSettings')?.sandbox?.filesystem?.disabled
  if (userDisabled !== undefined) {
    return userDisabled === true
  }

  // policySettings without locking filesystem object: still allow explicit true
  // if somehow present under a partial shape (defensive; lock covers normal path).
  const policyDisabled =
    getSettingsForSource('policySettings')?.sandbox?.filesystem?.disabled
  if (policyDisabled !== undefined) {
    return policyDisabled === true
  }

  return false
}

/** densable Gvg when disabled — enforcement unrestricted (empty deny). */
export function getDisabledSandboxFsReadConfig(): FsReadRestrictionConfig {
  return { denyOnly: [], allowWithinDeny: [] }
}

/** densable Wvg when disabled — enforcement unrestricted write via root allowOnly. */
export function getDisabledSandboxFsWriteConfig(): FsWriteRestrictionConfig {
  return { allowOnly: ['/'], denyWithinAllow: [] }
}

/**
 * densable dual facade diagnostic lists when filesystem.disabled.
 * OUTER getFs* returns these raw configured paths for UI/prompt;
 * package Gvg/Wvg enforcement is unrestricted when filesystem.disabled.
 * Populated by convertToSandboxRuntimeConfig; null when isolation is on.
 */
export type DisabledFsDiagnosticLists = {
  denyRead: string[]
  allowRead: string[]
  allowWrite: string[]
  denyWrite: string[]
}

let disabledFsDiagnostic: DisabledFsDiagnosticLists | null = null

/** Test/diagnostic access to last convert dual-facade stash. */
export function getDisabledFsDiagnosticLists(): DisabledFsDiagnosticLists | null {
  return disabledFsDiagnostic
}

/**
 * densable host credentials merge for SandboxRuntimeConfig.credentials.
 *
 * - files: path-resolved via resolveSandboxFilesystemPath; densable 2.1.221
 *   accepts mode "deny"|"mask" + extract/onExtractNoMatch/maskDuplicates/injectHosts.
 * - envVars: later sources win, but mode "deny" is sticky (not overwritten).
 * - mask (files + envVars) from projectSettings/localSettings is skipped
 *   (untrusted repo).
 * - mask from userSettings is skipped when userSettings source is disabled
 *   (densable `ug("userSettings")` / isSettingSourceEnabled).
 * - allowPlaintextInject only from trusted sources (not project/local, not
 *   disabled user).
 * - Package Vzi/Anu/vnu turns this into unsetEnvVars/setEnvVars/maskedFileBinds.
 */
export function mergeSandboxCredentialsForRuntime():
  | SandboxRuntimeConfig['credentials']
  | undefined {
  type Cred = NonNullable<SandboxRuntimeConfig['credentials']>
  const files: NonNullable<Cred['files']> = []
  const envByName = new Map<string, NonNullable<Cred['envVars']>[number]>()
  const awsPairs: NonNullable<Cred['awsPairs']> = []
  let seen = false
  let allowPlaintextInject: boolean | undefined
  let sigv4: Cred['sigv4'] | undefined

  for (const source of SETTING_SOURCES) {
    const cred = getSettingsForSource(source)?.sandbox?.credentials
    if (!cred) {
      continue
    }
    seen = true
    const isProjectLocal =
      source === 'projectSettings' || source === 'localSettings'
    const isUntrustedUser =
      source === 'userSettings' && !isSettingSourceEnabled('userSettings')
    const isTrustedSource = !isProjectLocal && !isUntrustedUser

    for (const entry of cred.files ?? []) {
      if (!entry?.path) {
        continue
      }
      // densable 2.1.221: skip file mask from untrusted project/local or disabled user
      if (entry.mode === 'mask' && (isProjectLocal || isUntrustedUser)) {
        continue
      }
      const resolved: NonNullable<Cred['files']>[number] = {
        path: resolveSandboxFilesystemPath(entry.path, source),
        mode: entry.mode,
      }
      if (entry.mode === 'mask') {
        if (entry.extract !== undefined) {
          resolved.extract = entry.extract
        }
        if (entry.onExtractNoMatch !== undefined) {
          resolved.onExtractNoMatch = entry.onExtractNoMatch
        }
        // densable 2.1.224 #6 — jwt decode + claim-level mask
        if (entry.decode !== undefined) {
          resolved.decode = entry.decode
        }
        if (entry.maskClaims !== undefined) {
          resolved.maskClaims = [...entry.maskClaims]
        }
        if (entry.maskDuplicates !== undefined) {
          resolved.maskDuplicates = entry.maskDuplicates
        }
        if (entry.injectHosts !== undefined) {
          resolved.injectHosts = [...entry.injectHosts]
        }
      }
      files.push(resolved)
    }

    for (const entry of cred.envVars ?? []) {
      if (!entry?.name) {
        continue
      }
      // densable: skip mask from untrusted project/local or disabled user
      if (entry.mode === 'mask' && (isProjectLocal || isUntrustedUser)) {
        continue
      }
      // deny sticky — densable does not let a later entry replace deny
      if (envByName.get(entry.name)?.mode === 'deny') {
        continue
      }
      const envResolved: NonNullable<Cred['envVars']>[number] = {
        name: entry.name,
        mode: entry.mode,
      }
      if (entry.mode === 'mask') {
        // densable 2.1.224 #6 — structured env masking (extract/decode/maskClaims)
        if (entry.extract !== undefined) {
          envResolved.extract = entry.extract
        }
        if (entry.onExtractNoMatch !== undefined) {
          envResolved.onExtractNoMatch = entry.onExtractNoMatch
        }
        if (entry.decode !== undefined) {
          envResolved.decode = entry.decode
        }
        if (entry.maskClaims !== undefined) {
          envResolved.maskClaims = [...entry.maskClaims]
        }
        if (entry.injectHosts !== undefined) {
          envResolved.injectHosts = [...entry.injectHosts]
        }
      }
      envByName.set(entry.name, envResolved)
    }

    if (isTrustedSource && cred.allowPlaintextInject !== undefined) {
      allowPlaintextInject = cred.allowPlaintextInject
    }

    // densable 2.1.224 #6 — awsPairs/sigv4: user/managed/CLI only
    if (isTrustedSource) {
      for (const pair of cred.awsPairs ?? []) {
        if (!pair?.accessKeyIdVar || !pair?.secretAccessKeyVar) {
          continue
        }
        awsPairs.push({
          accessKeyIdVar: pair.accessKeyIdVar,
          secretAccessKeyVar: pair.secretAccessKeyVar,
          ...(pair.sessionTokenVar !== undefined
            ? { sessionTokenVar: pair.sessionTokenVar }
            : {}),
        })
      }
      if (cred.sigv4 !== undefined) {
        sigv4 = {
          ...(cred.sigv4.streaming !== undefined
            ? { streaming: cred.sigv4.streaming }
            : {}),
          ...(cred.sigv4.presigned !== undefined
            ? { presigned: cred.sigv4.presigned }
            : {}),
          ...(cred.sigv4.sigv4a !== undefined
            ? { sigv4a: cred.sigv4.sigv4a }
            : {}),
        }
      }
    }
  }

  if (!seen) {
    return undefined
  }
  return {
    files,
    envVars: [...envByName.values()],
    ...(allowPlaintextInject !== undefined ? { allowPlaintextInject } : {}),
    ...(awsPairs.length > 0 ? { awsPairs } : {}),
    ...(sigv4 !== undefined ? { sigv4 } : {}),
  }
}

/**
 * Convert Claude Code settings format to SandboxRuntimeConfig format
 * (Function exported for testing)
 *
 * @param settings Merged settings (used for sandbox config like network, ripgrep, etc.)
 */
export function convertToSandboxRuntimeConfig(
  settings: SettingsJson,
): SandboxRuntimeConfig {
  const permissions = settings.permissions || {}

  // Extract network domains from WebFetch rules
  const allowedDomains: string[] = []
  const deniedDomains: string[] = []

  // When allowManagedSandboxDomainsOnly is enabled, only use domains from policy settings
  if (shouldAllowManagedSandboxDomainsOnly()) {
    const policySettings = getSettingsForSource('policySettings')
    for (const domain of policySettings?.sandbox?.network?.allowedDomains ||
      []) {
      allowedDomains.push(domain)
    }
    for (const ruleString of policySettings?.permissions?.allow || []) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        allowedDomains.push(rule.ruleContent.substring('domain:'.length))
      }
    }
  } else {
    for (const domain of settings.sandbox?.network?.allowedDomains || []) {
      allowedDomains.push(domain)
    }
    for (const ruleString of permissions.allow || []) {
      const rule = permissionRuleValueFromString(ruleString)
      if (
        rule.toolName === WEB_FETCH_TOOL_NAME &&
        rule.ruleContent?.startsWith('domain:')
      ) {
        allowedDomains.push(rule.ruleContent.substring('domain:'.length))
      }
    }
  }

  // densable 2.1.219: sandbox.network.deniedDomains from settings, then
  // WebFetch(domain:...) deny rules. Survives allowManagedDomainsOnly.
  for (const domain of settings.sandbox?.network?.deniedDomains || []) {
    deniedDomains.push(domain)
  }
  for (const ruleString of permissions.deny || []) {
    const rule = permissionRuleValueFromString(ruleString)
    if (
      rule.toolName === WEB_FETCH_TOOL_NAME &&
      rule.ruleContent?.startsWith('domain:')
    ) {
      deniedDomains.push(rule.ruleContent.substring('domain:'.length))
    }
  }

  // Extract filesystem paths from Edit and Read rules
  // Always include current directory and Claude temp directory as writable
  // The temp directory is needed for Shell.ts cwd tracking files
  // densable dual facade: when filesystem.disabled we still build full path
  // lists for OUTER getFs* diagnostics; package gets disabled:true + same lists.
  const allowWrite: string[] = ['.', getClaudeTempDir()]
  const denyWrite: string[] = []
  const denyRead: string[] = []
  const allowRead: string[] = []

  // Always deny writes to settings.json files to prevent sandbox escape
  // This blocks settings in the original working directory (where Claude Code started)
  const settingsPaths = SETTING_SOURCES.map(source =>
    getSettingsFilePathForSource(source),
  ).filter((p): p is string => p !== undefined)
  denyWrite.push(...settingsPaths)
  denyWrite.push(getManagedSettingsDropInDir())

  // Also block settings files in the current working directory if it differs from original
  // This handles the case where the user has cd'd to a different directory
  const cwd = getCwdState()
  const originalCwd = getOriginalCwd()
  if (cwd !== originalCwd) {
    denyWrite.push(resolve(cwd, '.claude', 'settings.json'))
    denyWrite.push(resolve(cwd, '.claude', 'settings.local.json'))
  }

  // Block writes to .claude/skills in both original and current working directories.
  // The sandbox-runtime's getDangerousDirectories() protects .claude/commands and
  // .claude/agents but not .claude/skills. Skills have the same privilege level
  // (auto-discovered, auto-loaded, full Claude capabilities) so they need the
  // same OS-level sandbox protection.
  denyWrite.push(resolve(originalCwd, '.claude', 'skills'))
  if (cwd !== originalCwd) {
    denyWrite.push(resolve(cwd, '.claude', 'skills'))
  }

  // SECURITY: Git's is_git_directory() treats cwd as a bare repo if it has
  // HEAD + objects/ + refs/. An attacker planting these (plus a config with
  // core.fsmonitor) escapes the sandbox when Claude's unsandboxed git runs.
  //
  // Unconditionally denying these paths makes sandbox-runtime mount
  // /dev/null at non-existent ones, which (a) leaves a 0-byte HEAD stub on
  // the host and (b) breaks `git log HEAD` inside bwrap ("ambiguous argument").
  // So: if a file exists, denyWrite (ro-bind in place, no stub). If not, scrub
  // it post-command in scrubBareGitRepoFiles() — planted files are gone before
  // unsandboxed git runs; inside the command, git is itself sandboxed.
  bareGitRepoScrubPaths.length = 0
  const bareGitRepoFiles = ['HEAD', 'objects', 'refs', 'hooks', 'config']
  for (const dir of cwd === originalCwd ? [originalCwd] : [originalCwd, cwd]) {
    for (const gitFile of bareGitRepoFiles) {
      const p = resolve(dir, gitFile)
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- refreshConfig() must be sync
        statSync(p)
        denyWrite.push(p)
      } catch {
        bareGitRepoScrubPaths.push(p)
      }
    }
  }

  // ==========================================================================
  // Credential & config file write protection (from official CXq() /
  // sandbox.credentials). Prevents sandboxed commands from modifying shell
  // RC files, package manager config, env files, git config, CI/CD runner
  // paths, and credential directories — all of which are vectors for
  // sandbox escape or credential exfiltration.
  // ==========================================================================
  const home = homedir()

  // Shell RC files — modifying these lets an attacker persist across shell
  // sessions (e.g. alias sudo=..., PATH injection, PROMPT_COMMAND hook)
  denyWrite.push(
    join(home, '.bash_profile'),
    join(home, '.bashrc'),
    join(home, '.bash_aliases'),
    join(home, '.bash_login'),
    join(home, '.bash_logout'),
    join(home, '.profile'),
    join(home, '.zshrc'),
    join(home, '.zprofile'),
    join(home, '.zshenv'),
    join(home, '.zlogin'),
    join(home, '.zlogout'),
  )

  // Claude config — modifying these lets an attacker change model, auth,
  // permission rules, hooks, MCP servers, or sandbox settings
  denyWrite.push(
    join(home, '.claude'),
    join(home, '.claude.json'),
    getClaudeConfigHomeDir(),
  )

  // Git config — core.fsmonitor / core.sshCommand escape, credential helper
  // poisoning, insteadOf URL rewriting
  denyWrite.push(join(home, '.gitconfig'), join(home, '.config', 'git'))

  // Package manager config files — registry rewriting, script hooks, CA bundle
  // overrides, install-time code execution
  denyWrite.push(
    join(home, '.bunfig.toml'),
    join(originalCwd, 'bunfig.toml'),
    join(originalCwd, 'package.json'),
    ...ENV_FILES.map(f => join(originalCwd, f)),
    join(home, '.npmrc'),
    join(originalCwd, '.npmrc'),
    join(home, '.yarnrc'),
    join(home, '.yarnrc.yml'),
    join(originalCwd, '.yarnrc'),
    join(originalCwd, '.yarnrc.yml'),
    join(home, '.config', 'pip'),
    join(home, '.pip'),
  )

  // Lock files — tampering enables supply-chain attacks by swapping dependency
  // hashes for malicious packages
  denyWrite.push(
    join(originalCwd, 'package-lock.json'),
    join(originalCwd, 'yarn.lock'),
    join(originalCwd, 'pnpm-lock.yaml'),
  )

  // Project-level paths that are gateways for sandbox escape or code execution
  denyWrite.push(
    join(originalCwd, 'node_modules', '.bin'),
    join(originalCwd, '.git', 'modules'),
    join(originalCwd, 'scripts'),
    join(originalCwd, '.claude'),
    join(originalCwd, '.github'),
  )

  // CI/CD self-hosted runner directories — modifying these enables persistent
  // code execution on the runner host
  denyWrite.push(
    join(home, '.local', 'bin'),
    join(home, 'runners'),
    join(home, 'actions-runner'),
  )

  // Shared temp buffer used by inline-comments — modifying this could inject
  // content into the conversation context
  denyWrite.push('/tmp/inline-comments-buffer.jsonl')

  // PATH directories under system paths — binaries in these locations could
  // shadow or override expected commands.
  // Equivalent to official fU.pathDirs computation in SXq().
  const pathDirs = (process.env.PATH ?? '')
    .split(':')
    .map(p => (p ? posix.normalize(p).replace(/\/+$/, '') : p))
    .filter(p => p && ALLOW_WRITE_SYSTEM_DIRS.some(d => p.startsWith(`${d}/`)))
  denyWrite.push(...pathDirs)

  // GitHub Actions runner file commands directory — set-env / add-path /
  // set-output commands execute in the runner context, outside the sandbox
  const githubEnv = process.env.GITHUB_ENV
  if (githubEnv) {
    denyWrite.push(dirname(githubEnv))
  }

  // GitHub Actions action path — modifying action source is remote code
  // execution on the runner
  const githubActionPath = process.env.GITHUB_ACTION_PATH
  if (githubActionPath) {
    denyWrite.push(githubActionPath)
    // Also protect the _actions/ prefix directory (the checked-out actions tree)
    if (githubActionPath.includes('/_actions/')) {
      denyWrite.push(
        githubActionPath.slice(0, githubActionPath.indexOf('/_actions/') + 9),
      )
    }
  }

  // GitHub Actions event payload — modifying this can alter workflow behavior
  const githubEventPath = process.env.GITHUB_EVENT_PATH
  if (githubEventPath) {
    denyWrite.push(githubEventPath)
  }

  // Credential directories — SSH keys, GitHub CLI tokens, netrc passwords
  denyWrite.push(
    join(home, '.config', 'gh'),
    join(home, '.netrc'),
    join(home, '.ssh'),
  )

  // Git internals in project directory — hooks, config, modules, exclude
  denyWrite.push(
    join(originalCwd, '.git', 'hooks'),
    join(originalCwd, '.git', 'config'),
    join(originalCwd, '.gitmodules'),
    join(originalCwd, '.git', 'info', 'exclude'),
  )

  // When GITHUB_WORKSPACE differs from cwd (e.g. reusable workflows,
  // composite actions), also protect the workspace's git metadata
  const workspace = process.env.GITHUB_WORKSPACE
  if (workspace && resolve(workspace) !== resolve(originalCwd)) {
    denyWrite.push(
      join(workspace, '.git', 'hooks'),
      join(workspace, '.git', 'config'),
      join(workspace, '.git', 'modules'),
      join(workspace, '.git', 'info', 'exclude'),
      join(workspace, '.gitmodules'),
      join(workspace, '.github'),
    )
  }

  // Deny read access to container runtime sockets — these allow escaping
  // the sandbox by spawning privileged containers on the host
  denyRead.push(...DENY_READ_SOCKET_PATHS)

  // If we detected a git worktree during initialize(), the main repo path is
  // cached in worktreeMainRepoPath. Git operations in a worktree need write
  // access to the main repo's .git directory for index.lock etc.
  // This is resolved once at init time (worktree status doesn't change mid-session).
  if (worktreeMainRepoPath && worktreeMainRepoPath !== cwd) {
    allowWrite.push(worktreeMainRepoPath)
  }

  // Include directories added via --add-dir CLI flag or /add-dir command.
  // These must be in allowWrite so that Bash commands (which run inside the
  // sandbox) can access them — not just file tools, which check permissions
  // at the app level via pathInAllowedWorkingPath().
  // Two sources: persisted in settings, and session-only in bootstrap state.
  const additionalDirs = new Set([
    ...(settings.permissions?.additionalDirectories || []),
    ...getAdditionalDirectoriesForClaudeMd(),
  ])
  allowWrite.push(...additionalDirs)

  // Iterate through each settings source to resolve paths correctly
  // Path patterns like `/foo` are relative to the settings file directory,
  // so we need to know which source each rule came from
  for (const source of SETTING_SOURCES) {
    const sourceSettings = getSettingsForSource(source)

    // Extract filesystem paths from permission rules
    if (sourceSettings?.permissions) {
      for (const ruleString of sourceSettings.permissions.allow || []) {
        const rule = permissionRuleValueFromString(ruleString)
        if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
          allowWrite.push(
            resolvePathPatternForSandbox(rule.ruleContent, source),
          )
        }
      }

      for (const ruleString of sourceSettings.permissions.deny || []) {
        const rule = permissionRuleValueFromString(ruleString)
        if (rule.toolName === FILE_EDIT_TOOL_NAME && rule.ruleContent) {
          denyWrite.push(resolvePathPatternForSandbox(rule.ruleContent, source))
        }
        if (rule.toolName === FILE_READ_TOOL_NAME && rule.ruleContent) {
          denyRead.push(resolvePathPatternForSandbox(rule.ruleContent, source))
        }
      }
    }

    // Extract filesystem paths from sandbox.filesystem settings
    // sandbox.filesystem.* uses standard path semantics (/path = absolute),
    // NOT the permission-rule convention (/path = settings-relative). #30067
    const fs = sourceSettings?.sandbox?.filesystem
    if (fs) {
      for (const p of fs.allowWrite || []) {
        allowWrite.push(resolveSandboxFilesystemPath(p, source))
      }
      for (const p of fs.denyWrite || []) {
        denyWrite.push(resolveSandboxFilesystemPath(p, source))
      }
      for (const p of fs.denyRead || []) {
        denyRead.push(resolveSandboxFilesystemPath(p, source))
      }
      if (!shouldAllowManagedReadPathsOnly() || source === 'policySettings') {
        for (const p of fs.allowRead || []) {
          allowRead.push(resolveSandboxFilesystemPath(p, source))
        }
      }
    }

    // densable: credentials.files are NOT merged into filesystem.denyRead here.
    // Host convert only path-resolves them onto runtime `credentials` (merge
    // below). Package Gvg/Dou unions WZn(credentials) with filesystem.denyRead
    // at enforcement time (Vzi). When filesystem.disabled, Gvg drops both FS
    // denyRead and credential file denies; env scrub still applies.
  }
  // Ripgrep config for sandbox. User settings take priority; otherwise pass our rg.
  // In embedded mode (argv0='rg' dispatch), sandbox-runtime spawns with argv0 set.
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()
  const ripgrepConfig = settings.sandbox?.ripgrep ?? {
    command: rgPath,
    args: rgArgs,
    argv0,
  }

  // Official: host-injected CLAUDE_CODE_HOST_*_PROXY_PORT fill sandbox
  // network ports when settings omit them (bwrap --setenv path).
  const hostProxy = readHostProxyPorts()

  // densable credentials merge (files path-resolved; env mask trust gates)
  const credentials = mergeSandboxCredentialsForRuntime()

  // densable Xot()==="relaxed": attach filesystem.disabled + keep full path lists
  // on getConfig(). sandbox-runtime@0.0.70 honors filesystem.disabled natively
  // (Gvg empty / Wvg allowOnly['/'] / Bou skip FS mounts). OUTER getFs* still
  // returns raw diagnostic lists from this stash.
  const filesystemDisabled = resolveSandboxFilesystemDisabled()
  if (filesystemDisabled) {
    disabledFsDiagnostic = {
      denyRead: [...denyRead],
      allowRead: [...allowRead],
      allowWrite: [...allowWrite],
      denyWrite: [...denyWrite],
    }
  } else {
    disabledFsDiagnostic = null
  }

  // densable FQt tlsTerminate: policy → flag → enabled userSettings only
  // (project/local ignored). Windows without CA paths: warn + skip ephemeral.
  // densable 2.1.219: strictAllowlist via GDt() sources (policy/flag/user only).
  // Package @anthropic-ai/sandbox-runtime@0.0.70 does not yet read the field;
  // host still stamps it for forward-compat and enforces via ask-callback.
  const strictAllowlist = resolveSandboxStrictAllowlist() || undefined
  const network: SandboxRuntimeConfig['network'] & {
    strictAllowlist?: boolean
  } = {
    allowedDomains,
    deniedDomains,
    ...(strictAllowlist ? { strictAllowlist: true } : {}),
    allowUnixSockets: settings.sandbox?.network?.allowUnixSockets,
    allowAllUnixSockets: settings.sandbox?.network?.allowAllUnixSockets,
    allowLocalBinding: settings.sandbox?.network?.allowLocalBinding,
    httpProxyPort:
      settings.sandbox?.network?.httpProxyPort ?? hostProxy.httpProxyPort,
    socksProxyPort:
      settings.sandbox?.network?.socksProxyPort ?? hostProxy.socksProxyPort,
  }
  const tlsTerminate = resolveSandboxTlsTerminate()
  if (tlsTerminate !== undefined) {
    if (
      getPlatform() === 'windows' &&
      tlsTerminate.caCertPath === undefined &&
      tlsTerminate.caKeyPath === undefined
    ) {
      logForDebugging(
        '[sandbox] settings tlsTerminate has no caCertPath/caKeyPath; on Windows an ephemeral CA cannot pass srt-win user trust-ca — ignoring until a persistent CA is configured',
        { level: 'warn' },
      )
    } else {
      network.tlsTerminate = tlsTerminate
    }
  }

  return {
    network,
    filesystem: {
      denyRead,
      allowRead,
      allowWrite,
      denyWrite,
      ...(filesystemDisabled ? { disabled: true as const } : {}),
    },
    ...(credentials !== undefined ? { credentials } : {}),
    ignoreViolations: settings.sandbox?.ignoreViolations,
    enableWeakerNestedSandbox: settings.sandbox?.enableWeakerNestedSandbox,
    enableWeakerNetworkIsolation:
      settings.sandbox?.enableWeakerNetworkIsolation,
    ripgrep: ripgrepConfig,
  }
}

/**
 * densable FQt / GDt sources for network fields honored only from
 * managed/policy, flag (`--settings`), and enabled userSettings.
 * Project/local ignored.
 */
function trustedSandboxNetworkSources(): Array<
  SettingsJson | null | undefined
> {
  return [
    getSettingsForSource('policySettings'),
    getSettingsForSource('flagSettings'),
    isSettingSourceEnabled('userSettings')
      ? getSettingsForSource('userSettings')
      : null,
  ]
}

/**
 * densable FQt slice for network.tlsTerminate — managed/policy, flag, then
 * userSettings only when that source is enabled. Project/local ignored.
 */
export function resolveSandboxTlsTerminate():
  | NonNullable<SandboxRuntimeConfig['network']['tlsTerminate']>
  | undefined {
  return trustedSandboxNetworkSources()
    .map(s => s?.sandbox?.network?.tlsTerminate)
    .find(v => v !== undefined)
}

/**
 * densable 2.1.219 GDt().some(K => K?.sandbox?.network?.strictAllowlist === true)
 * — user / managed / CLI only; project settings ignored.
 */
export function resolveSandboxStrictAllowlist(): boolean {
  return trustedSandboxNetworkSources().some(
    s => s?.sandbox?.network?.strictAllowlist === true,
  )
}

/**
 * densable `tuu` — pure warning when envVars mask is configured but neither
 * network.tlsTerminate nor credentials.allowPlaintextInject is set.
 * Exported for tests / doctor; package Anu still masks to sentinels either way.
 */
export function maskCredentialInjectionWarning(
  config: SandboxRuntimeConfig | undefined | null,
): string | undefined {
  if (!config) {
    return undefined
  }
  const maskNames = (config.credentials?.envVars ?? [])
    .filter(r => r.mode === 'mask')
    .map(r => r.name)
  if (maskNames.length === 0) {
    return undefined
  }
  if (
    config.network.tlsTerminate !== undefined ||
    config.credentials?.allowPlaintextInject
  ) {
    return undefined
  }
  return (
    `sandbox.credentials mask entries (${maskNames.join(', ')}) are configured ` +
    'but TLS termination is unavailable — sandboxed commands see only a ' +
    'sentinel value and the proxy cannot substitute the real credential on egress, so tools needing these will fail to authenticate. Enable sandbox.network.tlsTerminate, or remove the mask entries'
  )
}

/**
 * densable `ruu` — gate for mask-credential warning path.
 * densable: (tkt() || (zO()&&false)) && cjr() ≡ settings sandbox.enabled && platform allowed.
 */
function canMaskCredentialWarningFire(): boolean {
  return getSandboxEnabledSetting() && isPlatformInEnabledList()
}

/**
 * densable `o0g` / getMaskCredentialWarning — needs package getConfig() (after init).
 */
function getMaskCredentialWarning(): string | undefined {
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

// ============================================================================
// Claude CLI-specific state
// ============================================================================

let initializationPromise: Promise<void> | undefined
let settingsSubscriptionCleanup: (() => void) | undefined

// Cached main repo path for git worktrees, resolved once during initialize().
// In a worktree, .git is a file containing "gitdir: /path/to/main/repo/.git/worktrees/name".
// undefined = not yet resolved; null = not a worktree or detection failed.
let worktreeMainRepoPath: string | null | undefined

// Bare-repo files at cwd that didn't exist at config time and should be
// scrubbed if they appear after a sandboxed command. See anthropics/claude-code#29316.
const bareGitRepoScrubPaths: string[] = []

/**
 * Delete bare-repo files planted at cwd during a sandboxed command, before
 * Claude's unsandboxed git calls can see them. See the SECURITY block above
 * bareGitRepoFiles. anthropics/claude-code#29316.
 */
function scrubBareGitRepoFiles(): void {
  for (const p of bareGitRepoScrubPaths) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- cleanupAfterCommand must be sync (Shell.ts:367)
      rmSync(p, { recursive: true })
      logForDebugging(`[Sandbox] scrubbed planted bare-repo file: ${p}`)
    } catch {
      // ENOENT is the expected common case — nothing was planted
    }
  }
}

/**
 * Detect if cwd is a git worktree and resolve the main repo path.
 * Called once during initialize() and cached for the session.
 * In a worktree, .git is a file (not a directory) containing "gitdir: ...".
 * If .git is a directory, readFile throws EISDIR and we return null.
 */
async function detectWorktreeMainRepoPath(cwd: string): Promise<string | null> {
  const gitPath = join(cwd, '.git')
  try {
    const gitContent = await readFile(gitPath, { encoding: 'utf8' })
    const gitdirMatch = gitContent.match(/^gitdir:\s*(.+)$/m)
    if (!gitdirMatch?.[1]) {
      return null
    }
    // gitdir may be relative (rare, but git accepts it) — resolve against cwd
    const gitdir = resolve(cwd, gitdirMatch[1].trim())
    // gitdir format: /path/to/main/repo/.git/worktrees/worktree-name
    // Match the /.git/worktrees/ segment specifically — indexOf('.git') alone
    // would false-match paths like /home/user/.github-projects/...
    const marker = `${sep}.git${sep}worktrees${sep}`
    const markerIndex = gitdir.lastIndexOf(marker)
    if (markerIndex > 0) {
      return gitdir.substring(0, markerIndex)
    }
    return null
  } catch {
    // Not in a worktree, .git is a directory (EISDIR), or can't read .git file
    return null
  }
}

/**
 * Check if dependencies are available (memoized)
 * Returns { errors, warnings } - errors mean sandbox cannot run
 */
const checkDependencies = memoize((): SandboxDependencyCheck => {
  const { rgPath, rgArgs } = ripgrepCommand()
  return BaseSandboxManager.checkDependencies({
    command: rgPath,
    args: rgArgs,
  })
})

function getSandboxEnabledSetting(): boolean {
  try {
    const settings = getSettings_DEPRECATED()
    return settings?.sandbox?.enabled ?? false
  } catch (error) {
    logForDebugging(`Failed to get settings for sandbox check: ${error}`)
    return false
  }
}

function isAutoAllowBashIfSandboxedEnabled(): boolean {
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.autoAllowBashIfSandboxed ?? true
}

function areUnsandboxedCommandsAllowed(): boolean {
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.allowUnsandboxedCommands ?? true
}

function isSandboxRequired(): boolean {
  const settings = getSettings_DEPRECATED()
  return (
    getSandboxEnabledSetting() &&
    (settings?.sandbox?.failIfUnavailable ?? false)
  )
}

/**
 * Check if the current platform is supported for sandboxing (memoized)
 * Supports: macOS, Linux, and WSL2+ (WSL1 is not supported)
 */
const isSupportedPlatform = memoize((): boolean => {
  return BaseSandboxManager.isSupportedPlatform()
})

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
function isPlatformInEnabledList(): boolean {
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
function isSandboxingEnabled(): boolean {
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

  return getSandboxEnabledSetting()
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
function getSandboxUnavailableReason(): string | undefined {
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
    return `sandbox.enabled is set but ${platform} is not supported (requires macOS, Linux, or WSL2)`
  }

  if (!isPlatformInEnabledList()) {
    return `sandbox.enabled is set but ${getPlatform()} is not in sandbox.enabledPlatforms`
  }

  const deps = checkDependencies()
  if (deps.errors.length > 0) {
    const platform = getPlatform()
    const hint =
      platform === 'macos'
        ? 'run /sandbox or /doctor for details'
        : 'install missing tools (e.g. apt install bubblewrap socat) or run /sandbox for details'
    return `sandbox.enabled is set but dependencies are missing: ${deps.errors.join(', ')} · ${hint}`
  }

  return undefined
}

/**
 * Get glob patterns that won't work fully on Linux/WSL
 */
function getLinuxGlobPatternWarnings(): string[] {
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

/**
 * Check if sandbox settings are locked by policy
 */
function areSandboxSettingsLockedByPolicy(): boolean {
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
 * Set sandbox settings
 */
async function setSandboxSettings(options: {
  enabled?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
}): Promise<void> {
  const existingSettings = getSettingsForSource('localSettings')

  // Note: Memoized caches auto-invalidate when settings change because they use
  // the settings object as the cache key (new settings object = cache miss)

  updateSettingsForSource('localSettings', {
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
}

/**
 * Get excluded commands (commands that should not be sandboxed)
 */
function getExcludedCommands(): string[] {
  const settings = getSettings_DEPRECATED()
  return settings?.sandbox?.excludedCommands ?? []
}

/**
 * Wrap command with sandbox, optionally specifying the shell to use
 */
async function wrapWithSandbox(
  command: string,
  binShell?: string,
  customConfig?: Partial<SandboxRuntimeConfig>,
  abortSignal?: AbortSignal,
): Promise<string> {
  // If sandboxing is enabled, ensure initialization is complete
  if (isSandboxingEnabled()) {
    if (initializationPromise) {
      await initializationPromise
    } else {
      throw new Error('Sandbox failed to initialize. ')
    }
  }

  // densable Bou / sandbox-runtime@0.0.70: package wrapWithSandbox itself
  // applies filesystem.disabled precedence (override.filesystem present →
  // override.disabled??false, else session). When disabled, package skips FS
  // mounts while still applying credentials.envVars unset/set (Vzi). No host
  // rewrite of path lists needed.
  return BaseSandboxManager.wrapWithSandbox(
    command,
    binShell,
    customConfig,
    abortSignal,
  )
}

/**
 * Initialize sandbox with log monitoring enabled by default
 */
async function initialize(
  sandboxAskCallback?: SandboxAskCallback,
): Promise<void> {
  // If already initializing or initialized, return the promise
  if (initializationPromise) {
    return initializationPromise
  }

  // Check if sandboxing is enabled in settings
  if (!isSandboxingEnabled()) {
    return
  }

  // Wrap the callback to enforce allowManagedDomainsOnly + densable 2.1.219
  // strictAllowlist (deny without prompt). Package 0.0.70 lacks the field check
  // densable dSu has (`!r||kl.network.strictAllowlist`); host enforces here so
  // all code paths (REPL, print/SDK) are covered even when the field is stripped.
  const wrappedCallback: SandboxAskCallback | undefined = sandboxAskCallback
    ? async (hostPattern: NetworkHostPattern) => {
        if (shouldAllowManagedSandboxDomainsOnly()) {
          logForDebugging(
            `[sandbox] Blocked network request to ${hostPattern.host} (allowManagedDomainsOnly)`,
          )
          return false
        }
        if (resolveSandboxStrictAllowlist()) {
          logForDebugging(
            `[sandbox] Blocked network request to ${hostPattern.host} (strictAllowlist)`,
          )
          return false
        }
        return sandboxAskCallback(hostPattern)
      }
    : undefined

  // Create the initialization promise synchronously (before any await) to prevent
  // race conditions where wrapWithSandbox() is called before the promise is assigned.
  initializationPromise = (async () => {
    try {
      // Resolve worktree main repo path once before building config.
      // Worktree status doesn't change mid-session, so this is cached for all
      // subsequent refreshConfig() calls (which must be synchronous to avoid
      // race conditions where pending requests slip through with stale config).
      if (worktreeMainRepoPath === undefined) {
        worktreeMainRepoPath = await detectWorktreeMainRepoPath(getCwdState())
      }

      const settings = getSettings_DEPRECATED()
      const runtimeConfig = convertToSandboxRuntimeConfig(settings)

      // Log monitor is automatically enabled for macOS
      await BaseSandboxManager.initialize(runtimeConfig, wrappedCallback)

      // Subscribe to settings changes to update sandbox config dynamically
      settingsSubscriptionCleanup = settingsChangeDetector.subscribe(() => {
        const settings = getSettings_DEPRECATED()
        const newConfig = convertToSandboxRuntimeConfig(settings)
        BaseSandboxManager.updateConfig(newConfig)
        logForDebugging('Sandbox configuration updated from settings change')
      })
    } catch (error) {
      // Clear the promise on error so initialization can be retried
      initializationPromise = undefined

      // Log error but don't throw - let sandboxing fail gracefully
      logForDebugging(`Failed to initialize sandbox: ${errorMessage(error)}`)
    }
  })()

  return initializationPromise
}

/**
 * Refresh sandbox config from current settings immediately
 * Call this after updating permissions to avoid race conditions
 */
function refreshConfig(): void {
  if (!isSandboxingEnabled()) return
  const settings = getSettings_DEPRECATED()
  const newConfig = convertToSandboxRuntimeConfig(settings)
  BaseSandboxManager.updateConfig(newConfig)
}

/**
 * Reset sandbox state and clear memoized values
 */
async function reset(): Promise<void> {
  // Clean up settings subscription
  settingsSubscriptionCleanup?.()
  settingsSubscriptionCleanup = undefined
  worktreeMainRepoPath = undefined
  bareGitRepoScrubPaths.length = 0

  // Clear memoized caches
  checkDependencies.cache.clear?.()
  isSupportedPlatform.cache.clear?.()
  initializationPromise = undefined

  // Reset the base sandbox manager
  return BaseSandboxManager.reset()
}

/**
 * Add a command to the excluded commands list (commands that should not be sandboxed)
 * This is a Claude CLI-specific function that updates local settings.
 */
export function addToExcludedCommands(
  command: string,
  permissionUpdates?: Array<{
    type: string
    rules: Array<{ toolName: string; ruleContent?: string }>
  }>,
): string {
  const existingSettings = getSettingsForSource('localSettings')
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
  if (!existingExcludedCommands.includes(commandPattern)) {
    updateSettingsForSource('localSettings', {
      sandbox: {
        ...existingSettings?.sandbox,
        excludedCommands: [...existingExcludedCommands, commandPattern],
      },
    })
  }

  return commandPattern
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
  areSandboxSettingsLockedByPolicy(): boolean
  setSandboxSettings(options: {
    enabled?: boolean
    autoAllowBashIfSandboxed?: boolean
    allowUnsandboxedCommands?: boolean
  }): Promise<void>
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
  wrapWithSandbox(
    command: string,
    binShell?: string,
    customConfig?: Partial<SandboxRuntimeConfig>,
    abortSignal?: AbortSignal,
  ): Promise<string>
  cleanupAfterCommand(): void
  getSandboxViolationStore(): SandboxViolationStore
  annotateStderrWithSandboxFailures(command: string, stderr: string): string
  getLinuxGlobPatternWarnings(): string[]
  /** densable o0g — mask without tlsTerminate/allowPlaintextInject warning */
  getMaskCredentialWarning(): string | undefined
  /** densable ruu — whether mask warning path may fire */
  canMaskCredentialWarningFire(): boolean
  refreshConfig(): void
  reset(): Promise<void>
}

/**
 * densable OUTER getFsReadConfig (~223611065):
 * when getConfig().filesystem.disabled → RAW config denyRead/allowRead
 * (diagnostic; does not include credentials.files — those are package-side
 * WZn/Dou only while isolation is on). Enforcement Gvg is unrestricted when
 * disabled. When isolation on → forward package getFsReadConfig (Gvg).
 *
 * Host keeps a convert-time diagnostic stash so tests / pre-init callers still
 * see raw lists when package getConfig() is not yet populated; shape matches
 * densable `e.filesystem.denyRead` (no credential-file paths).
 */
function getFsReadConfig(): FsReadRestrictionConfig {
  const cfg = BaseSandboxManager.getConfig?.()
  if (cfg?.filesystem?.disabled) {
    return {
      denyOnly: [...cfg.filesystem.denyRead],
      allowWithinDeny: [...(cfg.filesystem.allowRead ?? [])],
    }
  }
  if (resolveSandboxFilesystemDisabled()) {
    if (disabledFsDiagnostic) {
      return {
        denyOnly: disabledFsDiagnostic.denyRead,
        allowWithinDeny: disabledFsDiagnostic.allowRead,
      }
    }
    // convert not yet run — densable empty until hl is set
    return getDisabledSandboxFsReadConfig()
  }
  return BaseSandboxManager.getFsReadConfig()
}

/**
 * densable OUTER getFsWriteConfig:
 * when getConfig().filesystem.disabled → RAW config allowWrite/denyWrite.
 * Enforcement Wvg is unrestricted (allowOnly:['/']) when disabled.
 */
function getFsWriteConfig(): FsWriteRestrictionConfig {
  const cfg = BaseSandboxManager.getConfig?.()
  if (cfg?.filesystem?.disabled) {
    return {
      allowOnly: [...cfg.filesystem.allowWrite],
      denyWithinAllow: [...cfg.filesystem.denyWrite],
    }
  }
  if (resolveSandboxFilesystemDisabled()) {
    if (disabledFsDiagnostic) {
      return {
        allowOnly: disabledFsDiagnostic.allowWrite,
        denyWithinAllow: disabledFsDiagnostic.denyWrite,
      }
    }
    return getDisabledSandboxFsWriteConfig()
  }
  return BaseSandboxManager.getFsWriteConfig()
}

/**
 * densable enforcement-only Gvg/Wvg shapes (unrestricted when disabled).
 * Prefer these for wrap/path-safety when UI must keep raw lists via getFs*.
 */
export function getEnforcementFsReadConfig(): FsReadRestrictionConfig {
  if (resolveSandboxFilesystemDisabled()) {
    return getDisabledSandboxFsReadConfig()
  }
  return BaseSandboxManager.getFsReadConfig()
}

export function getEnforcementFsWriteConfig(): FsWriteRestrictionConfig {
  if (resolveSandboxFilesystemDisabled()) {
    return getDisabledSandboxFsWriteConfig()
  }
  return BaseSandboxManager.getFsWriteConfig()
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
  areSandboxSettingsLockedByPolicy,
  setSandboxSettings,
  getExcludedCommands,
  wrapWithSandbox,
  refreshConfig,
  reset,
  checkDependencies,

  // densable 2.1.216 Gvg/Wvg overrides + network forward
  getFsReadConfig,
  getFsWriteConfig,
  getNetworkRestrictionConfig: BaseSandboxManager.getNetworkRestrictionConfig,
  getIgnoreViolations: BaseSandboxManager.getIgnoreViolations,
  getLinuxGlobPatternWarnings,
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
  cleanupAfterCommand: (): void => {
    BaseSandboxManager.cleanupAfterCommand()
    scrubBareGitRepoFiles()
  },
}

// ============================================================================
// Re-export types from sandbox-runtime
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

export { SandboxViolationStore, SandboxRuntimeConfigSchema }
