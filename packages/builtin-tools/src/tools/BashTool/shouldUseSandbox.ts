import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { splitCommand_DEPRECATED } from 'src/utils/bash/commands.js'
import { getPlatform } from 'src/utils/platform.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { isSettingSourceEnabled } from 'src/utils/settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from 'src/utils/settings/settings.js'
import { findGitBashPathOrNull } from 'src/utils/windowsPaths.js'
import {
  BINARY_HIJACK_VARS,
  bashPermissionRule,
  matchWildcardPattern,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
} from './bashPermissions.js'

type SandboxInput = {
  command?: string
  dangerouslyDisableSandbox?: boolean
  /** densable p3 shellType — default "bash"; "powershell" for PS tool */
  shellType?: 'bash' | 'powershell'
}

/**
 * densable gxy — shell metacharacters. H0d fails closed (never exclude) when present.
 */
export const SANDBOX_EXCLUSION_METACHAR_RE = /[;|&`$(){}<>#\n\r]/

// NOTE: excludedCommands is a user-facing convenience feature, not a security boundary.
// It is not a security bug to be able to bypass excludedCommands — the sandbox permission
// system (which prompts users) is the actual security control.
function containsExcludedCommand(command: string): boolean {
  // Check dynamic config for disabled commands and substrings (only for ants)
  if (process.env.USER_TYPE === 'ant') {
    const disabledCommands = getFeatureValue_CACHED_MAY_BE_STALE<{
      commands: string[]
      substrings: string[]
    }>('tengu_sandbox_disabled_commands', { commands: [], substrings: [] })

    // Check if command contains any disabled substrings
    for (const substring of disabledCommands.substrings) {
      if (command.includes(substring)) {
        return true
      }
    }

    // Check if command starts with any disabled commands
    try {
      const commandParts = splitCommand_DEPRECATED(command)
      for (const part of commandParts) {
        const baseCommand = part.trim().split(' ')[0]
        if (baseCommand && disabledCommands.commands.includes(baseCommand)) {
          return true
        }
      }
    } catch {
      // If we can't parse the command (e.g., malformed bash syntax),
      // treat it as not excluded to allow other validation checks to handle it
      // This prevents crashes when rendering tool use messages
    }
  }

  // Check user-configured excluded commands from settings
  const settings = getSettings_DEPRECATED()
  const userExcludedCommands = settings.sandbox?.excludedCommands ?? []

  if (userExcludedCommands.length === 0) {
    return false
  }

  // Split compound commands (e.g. "docker ps && curl evil.com") into individual
  // subcommands and check each one against excluded patterns. This prevents a
  // compound command from escaping the sandbox just because its first subcommand
  // matches an excluded pattern.
  let subcommands: string[]
  try {
    subcommands = splitCommand_DEPRECATED(command)
  } catch {
    subcommands = [command]
  }

  for (const subcommand of subcommands) {
    const trimmed = subcommand.trim()
    // Also try matching with env var prefixes and wrapper commands stripped, so
    // that `FOO=bar bazel ...` and `timeout 30 bazel ...` match `bazel:*`. Not a
    // security boundary (see NOTE at top); the &&-split above already lets
    // `export FOO=bar && bazel ...` match. BINARY_HIJACK_VARS kept as a heuristic.
    //
    // We iteratively apply both stripping operations until no new candidates are
    // produced (fixed-point), matching the approach in filterRulesByContentsMatchingInput.
    // This handles interleaved patterns like `timeout 300 FOO=bar bazel run`
    // where single-pass composition would fail.
    const candidates = [trimmed]
    const seen = new Set(candidates)
    let startIdx = 0
    while (startIdx < candidates.length) {
      const endIdx = candidates.length
      for (let i = startIdx; i < endIdx; i++) {
        const cmd = candidates[i]!
        const envStripped = stripAllLeadingEnvVars(cmd, BINARY_HIJACK_VARS)
        if (!seen.has(envStripped)) {
          candidates.push(envStripped)
          seen.add(envStripped)
        }
        const wrapperStripped = stripSafeWrappers(cmd)
        if (!seen.has(wrapperStripped)) {
          candidates.push(wrapperStripped)
          seen.add(wrapperStripped)
        }
      }
      startIdx = endIdx
    }

    for (const pattern of userExcludedCommands) {
      const rule = bashPermissionRule(pattern)
      for (const cand of candidates) {
        switch (rule.type) {
          case 'prefix':
            if (cand === rule.prefix || cand.startsWith(rule.prefix + ' ')) {
              return true
            }
            break
          case 'exact':
            if (cand === rule.command) {
              return true
            }
            break
          case 'wildcard':
            if (matchWildcardPattern(rule.pattern, cand)) {
              return true
            }
            break
        }
      }
    }
  }

  return false
}

/**
 * densable frr — layered settings sources for H0d excludedCommands.
 * policy (Jne) + flagSettings + optional userSettings.
 */
function getLayeredExcludedCommandsForPolicy(): string[] {
  const layers = [
    getSettingsForSource('policySettings'),
    getSettingsForSource('flagSettings'),
    isSettingSourceEnabled('userSettings')
      ? getSettingsForSource('userSettings')
      : null,
  ]
  return layers.flatMap(s => s?.sandbox?.excludedCommands ?? [])
}

/**
 * densable qJd(QAo(pattern), command) — whole-command exclusion match (no split).
 */
function matchesExcludedCommandPattern(
  pattern: string,
  command: string,
): boolean {
  const rule = bashPermissionRule(pattern)
  switch (rule.type) {
    case 'prefix':
      return command === rule.prefix || command.startsWith(rule.prefix + ' ')
    case 'exact':
      return command === rule.command
    case 'wildcard':
      return matchWildcardPattern(rule.pattern, command)
    default:
      return false
  }
}

/**
 * densable H0d core — pure matcher for tests and I0d.
 * Metacharacters / compounds NEVER count as excluded (fail closed).
 * Whole trimmed command only — no compound split (unlike hxy/containsExcludedCommand).
 */
export function isFullyExcludedCommandForPolicyWithPatterns(
  command: string,
  patterns: readonly string[],
): boolean {
  const trimmed = command.trim()
  if (
    patterns.length === 0 ||
    !trimmed ||
    SANDBOX_EXCLUSION_METACHAR_RE.test(trimmed)
  ) {
    return false
  }
  return patterns.some(p => matchesExcludedCommandPattern(p, trimmed))
}

/**
 * densable H0d — STRICT policy exclusion matcher (PowerShell / Windows policy gate).
 */
export function isFullyExcludedCommandForPolicy(command: string): boolean {
  return isFullyExcludedCommandForPolicyWithPatterns(
    command,
    getLayeredExcludedCommandsForPolicy(),
  )
}

/**
 * densable I0d — Windows enterprise policy refusal when command would not be sandboxed
 * and is not a full simple excludedCommands match (H0d).
 *
 * @param useSandbox result of shouldUseSandbox / densable p3/vxo
 * @param command raw command string
 */
export function isWindowsSandboxPolicyViolation(
  useSandbox: boolean,
  command: string,
): boolean {
  return (
    getPlatform() === 'windows' &&
    SandboxManager.isSandboxEnabledInSettings() &&
    SandboxManager.isPlatformInEnabledList() &&
    !SandboxManager.areUnsandboxedCommandsAllowed() &&
    !useSandbox &&
    !isFullyExcludedCommandForPolicy(command)
  )
}

/** densable x0d — 2.1.218 Windows sandbox policy refusal message */
export const WINDOWS_SANDBOX_POLICY_REFUSAL =
  'Enterprise policy requires sandboxing, but this command would not be sandboxed on Windows: either the sandbox is unavailable, or the command matches a sandbox exclusion pattern only in part. Compound commands and commands with shell metacharacters must run sandboxed even when a statement matches an exclusion. Shell command execution is blocked by policy.'

/**
 * densable SandboxPolicyRefusalError (vao)
 */
export class SandboxPolicyRefusalError extends Error {
  constructor(message: string = WINDOWS_SANDBOX_POLICY_REFUSAL) {
    super(message)
    this.name = 'SandboxPolicyRefusalError'
  }
}

/**
 * densable p3 — should this command run sandboxed?
 */
export function shouldUseSandbox(input: Partial<SandboxInput>): boolean {
  if (!SandboxManager.isSandboxingEnabled()) {
    return false
  }

  // densable: Windows bash without Git Bash cannot wrap sandboxed child
  const shellType = input.shellType ?? 'bash'
  // densable cQ() — null when Git Bash unavailable
  if (shellType === 'bash' && getPlatform() === 'windows') {
    if (findGitBashPathOrNull() === null) {
      return false
    }
  }

  // Don't sandbox if explicitly overridden AND unsandboxed commands are allowed by policy
  if (
    input.dangerouslyDisableSandbox &&
    SandboxManager.areUnsandboxedCommandsAllowed()
  ) {
    return false
  }

  if (!input.command) {
    return false
  }

  // Don't sandbox if the command contains user-configured excluded commands (hxy)
  if (containsExcludedCommand(input.command)) {
    return false
  }

  return true
}
