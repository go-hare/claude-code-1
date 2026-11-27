/**
 * Shared sandbox adapter constants, path/rule parsing utilities, and core types.
 */

import type { PermissionRuleValue } from '../../permissions/PermissionRule.js'
import { getPlatform } from '../../platform.js'

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

// Local 236 wildcard read-deny (gold QOi lists these; CXq table did not).
export const DENY_READ_ENV_GLOBS = ['**/.env', '**/.env*'] as const

/**
 * Official 2.1.326 #300 (`Tii` / `Cii` @291479784):
 * Sensitive home directories/files write-protected by default on macOS, Linux,
 * and WSL. Entries in `USER_OVERRIDABLE_SENSITIVE_HOME_DENY_WRITE` can be
 * allowed via `sandbox.filesystem.allowWrite` in user, flag, or managed settings
 * (NOT project/local settings).
 */
export const DEFAULT_SENSITIVE_HOME_DENY_WRITE_PATHS: readonly (readonly string[])[] =
  [
    ['.ssh'],
    ['.aws'],
    ['.azure'],
    ['.gnupg'],
    ['.kube'],
    ['.docker'],
    ['.config', 'gh'],
    ['.config', 'glab-cli'],
    ['.config', 'gcloud'],
    ['.cargo', 'credentials'],
    ['.cargo', 'credentials.toml'],
    ['.gem', 'credentials'],
    ['.m2', 'settings.xml'],
    ['.gradle', 'gradle.properties'],
    ['.config', 'powershell', 'profile.ps1'],
    ['.claude', 'state'],
    ['Library', 'Keychains'],
    ['.netrc'],
    ['.git-credentials'],
    ['.pypirc'],
    ['.pgpass'],
    ['.my.cnf'],
    ['.mylogin.cnf'],
    ['.terraform.d', 'credentials.tfrc.json'],
    ['.boto'],
    ['.s3cfg'],
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

/** Official 2.1.328 `pN` (`chunk@290312616.js@740798`): Linux/WSL seccomp userns policy env var. */
export const SRT_ALLOW_NESTED_USERNS_ENV = 'SRT_ALLOW_NESTED_USERNS'

export const RELAUNCH_SANDBOX_HOLD_ENV = 'CLAUDE_CODE_RELAUNCH_SANDBOX_HOLD'

// ============================================================================
// Shared Types
// ============================================================================

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

/**
 * Official 2.1.326 #299 (`Ro` / `kme` / `Ime` / `Dme` / `Nme` @291403274):
 * Keep sandbox state during a session across directory/root moves until the
 * user explicitly runs `/sandbox` or `/cd` (which calls `clearSandboxRootMoveHold`).
 */
export type SandboxRootMoveHold = {
  isStrict: boolean
  isStrictByFailedRead: boolean
  isRequired: boolean
  isAutoAllowOff: boolean
}

export type GitDirEntryKind = 'file' | 'dir' | 'symlink' | 'fifo' | 'other'

export type GitDirBaselineEntry = {
  kind: GitDirEntryKind
  linkTarget?: string
}

export type GitDirSnapshotEntry = {
  baseline: Map<string, GitDirBaselineEntry>
  refCount: number
}

// ============================================================================
// Pure Rule / Glob Parsing Helpers
// ============================================================================

// Local copies to avoid circular dependency
// (permissions.ts imports SandboxManager, bashPermissions.ts imports permissions.ts)
export function permissionRuleValueFromString(
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

export function permissionRuleExtractPrefix(
  permissionRule: string,
): string | null {
  const match = permissionRule.match(/^(.+):\*$/)
  return match?.[1] ?? null
}

/**
 * densable `kA` — simple glob-char probe used by trailing-slash strip (Mmr).
 * Glob paths keep their trailing slash (directory-glob semantics); non-glob
 * deny/allow paths strip it so `~/.aws/` matches the directory itself.
 */
export function pathHasGlobChars(path: string): boolean {
  return (
    path.includes('*') ||
    path.includes('?') ||
    path.includes('[') ||
    path.includes(']')
  )
}

export function stripTrailingGlob(p: string): string {
  return p.endsWith('/**') ? p.slice(0, -3) : p
}

export function hasGlobCharacters(p: string): boolean {
  return /[*?[\]]/.test(p)
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
