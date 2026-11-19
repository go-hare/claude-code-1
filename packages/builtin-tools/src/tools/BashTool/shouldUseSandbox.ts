import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { splitCommand_DEPRECATED } from 'src/utils/bash/commands.js'
import { tryParseShellCommand } from 'src/utils/bash/shellQuote.js'
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

/**
 * SEA `Zwr.git` / `ebr` / `obr` / `dbr` (@290191510–290193800) —
 * Git subcommand flags (including `git clone` short options `-u`, `-c`,
 * `--config`, `--template`, and bundled forms like `-bu`) that execute code or
 * alter config, so `sandbox.excludedCommands` must NOT exempt them from sandbox.
 */
const GIT_SUBCOMMAND_DANGEROUS_FLAGS: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  ['-x', ['rebase', 'difftool']],
  ['-d', ['instaweb']],
  ['--file', ['config']],
  ['-f', ['config']],
  ['--prefix', ['checkout-index']],
  [
    '-o',
    [
      'archive',
      'bugreport',
      'diagnose',
      'format-patch',
      'index-pack',
      'mailsplit',
    ],
  ],
  ['--output-directory', ['bugreport', 'diagnose', 'format-patch']],
  ['--suffix', ['bugreport', 'diagnose', 'format-patch']],
  ['-s', ['bugreport', 'diagnose']],
  ['--pid-file', ['daemon']],
  ['--file', ['credential-store']],
  ['-d', ['filter-branch']],
  ['--export-marks', ['fast-export', 'fast-import']],
  ['--export-pack-edges', ['fast-import']],
  ['--rename-section', ['config']],
  ['rename-section', ['config']],
  ['--template', ['clone', 'init']],
  ['-c', ['clone']],
  ['--config', ['clone']],
  ['edit', ['config']],
  ['--edit', ['config']],
  ['-e', ['config']],
  ['-O', ['grep']],
  ['--tree-filter', ['filter-branch']],
  ['--index-filter', ['filter-branch']],
  ['--msg-filter', ['filter-branch']],
  ['--env-filter', ['filter-branch']],
  ['--commit-filter', ['filter-branch']],
  ['--parent-filter', ['filter-branch']],
  ['--tag-name-filter', ['filter-branch']],
  ['--setup', ['filter-branch']],
  ['--sendmail-cmd', ['send-email']],
  ['--smtp-server', ['send-email']],
  ['--to-cmd', ['send-email']],
  ['--cc-cmd', ['send-email']],
]

const GIT_CLONE_UPLOAD_PACK_SHORT_FLAG: readonly [string, readonly string[]] = [
  '-u',
  ['clone'],
]

const GIT_SUBCOMMAND_VALUED_SHORT_FLAGS: Record<string, readonly string[]> = {
  clone: ['b', 'o', 'j', 'u'],
  rebase: ['C', 'S', 'X', 's'],
  difftool: ['t'],
  instaweb: ['b', 'm', 'p'],
  config: [],
  archive: [],
  'format-patch': ['v'],
  grep: ['e', 'f', 'A', 'B', 'C', 'm'],
}

function matchesBundledShortFlag(
  arg: string,
  flagChar: string,
  valuedShortFlags: readonly string[],
): boolean {
  const cluster = /^[-+](?!-)([^=]*)/.exec(arg)?.[1] ?? ''
  for (const ch of cluster) {
    if (ch === flagChar) return true
    if (valuedShortFlags.includes(ch)) return false
  }
  return false
}

function matchesFlagToken(
  arg: string,
  targetFlag: string,
  caseInsensitive: boolean,
  isSingleCharShort: boolean,
  valuedShortFlags: readonly string[],
  supportsLongPrefixAbbrev: boolean,
): boolean {
  const normalized = caseInsensitive
    ? arg.toLowerCase().replace(/^[\u2013\u2014\u2015]/, '-')
    : arg
  if (normalized === targetFlag || normalized.startsWith(`${targetFlag}=`)) {
    return true
  }
  if (targetFlag.endsWith(':') && normalized.startsWith(targetFlag)) {
    return true
  }
  if (targetFlag.startsWith('/')) {
    return normalized.replace(/^(?:\/\/|-)/, '/').includes(targetFlag)
  }
  if (supportsLongPrefixAbbrev && targetFlag.startsWith('--')) {
    const eqIdx = normalized.indexOf('=')
    const prefix = eqIdx >= 0 ? normalized.slice(0, eqIdx) : normalized
    if (prefix.length > 2 && targetFlag.startsWith(prefix)) {
      return true
    }
  }
  if (
    caseInsensitive &&
    normalized.length > 1 &&
    targetFlag.startsWith(normalized)
  ) {
    return true
  }
  if (!(!targetFlag.startsWith('--') && targetFlag.length === 2)) {
    return false
  }
  const flagChar = targetFlag[1]!
  if (isSingleCharShort && normalized.startsWith('+')) {
    return matchesBundledShortFlag(normalized, flagChar, valuedShortFlags)
  }
  if (normalized.startsWith(targetFlag)) return true
  if (!isSingleCharShort) return false
  return matchesBundledShortFlag(normalized, flagChar, valuedShortFlags)
}

function extractGitSubcommandPositionals(argv: string[]): string[] {
  const positionals: string[] = []
  let afterDoubleDash = false
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true
      continue
    }
    if (!afterDoubleDash && arg.startsWith('-')) {
      if (
        arg === '-C' ||
        arg === '-c' ||
        arg === '--git-dir' ||
        arg === '--work-tree' ||
        arg === '--namespace' ||
        arg === '--super-prefix' ||
        arg === '--config-env' ||
        arg === '--attr-source'
      ) {
        i++
      }
      continue
    }
    positionals.push(arg)
  }
  return positionals
}

export function hasDangerousGitSubcommandFlag(argv: string[]): boolean {
  const cmdName = argv[0]?.split(/[\\/]/).pop()
  if (cmdName !== 'git') return false
  const rules = getFeatureValue_CACHED_MAY_BE_STALE('tengu_mossy_crayon', true)
    ? [...GIT_SUBCOMMAND_DANGEROUS_FLAGS, GIT_CLONE_UPLOAD_PACK_SHORT_FLAG]
    : GIT_SUBCOMMAND_DANGEROUS_FLAGS
  const positionals = extractGitSubcommandPositionals(argv).map(p =>
    p.toLowerCase(),
  )
  return rules.some(([flag, subcommands]) => {
    const matchedSub = positionals.find(p => subcommands.includes(p))
    if (matchedSub === undefined) return false
    const isSingleCharShort = /^-[A-Za-z]$/.test(flag)
    const valuedShortFlags = GIT_SUBCOMMAND_VALUED_SHORT_FLAGS[matchedSub] ?? []
    return argv.some(
      arg =>
        arg === flag ||
        (flag.startsWith('-') &&
          (arg.startsWith(flag) ||
            matchesFlagToken(
              arg,
              flag,
              false,
              isSingleCharShort,
              valuedShortFlags,
              true,
            ))),
    )
  })
}

function commandHasDangerousGitFlags(command: string): boolean {
  const parsed = tryParseShellCommand(command)
  if (!parsed.success) return false
  const argv = parsed.tokens.filter((t): t is string => typeof t === 'string')
  return hasDangerousGitSubcommandFlag(argv)
}

// NOTE: excludedCommands is a user-facing convenience feature, not a security boundary.
// It is not a security bug to be able to bypass excludedCommands — the sandbox permission
// system (which prompts users) is the actual security control.
export function containsExcludedCommand(
  command: string,
  excludedCommandsOverride?: readonly string[],
): boolean {
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
  const userExcludedCommands =
    excludedCommandsOverride ??
    getSettings_DEPRECATED().sandbox?.excludedCommands ??
    []

  if (userExcludedCommands.length === 0) {
    return false
  }

  // Official 2.1.323 #2022 (`Pbr` / `Mbr`):
  // An entry in `sandbox.excludedCommands` takes a call out of the sandbox ONLY
  // when EVERY subcommand in the call matches an entry. Keep the call sandboxed
  // whenever it contains `cd`/`chdir`/`pushd`/`popd`, command/process
  // substitution, redirects other than fd duplication like `2>&1` (including
  // heredocs), or a variable assigned in one subcommand and expanded in another.
  const hasCommandOrProcessSub = (cmd: string): boolean => {
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < cmd.length; i++) {
      const ch = cmd[i]!
      if (inSingle) {
        if (ch === "'") inSingle = false
        continue
      }
      if (inDouble) {
        if (ch === '\\' && i + 1 < cmd.length) {
          const next = cmd[i + 1]!
          if (
            next === '"' ||
            next === '\\' ||
            next === '$' ||
            next === '`' ||
            next === '\n'
          ) {
            i++
            continue
          }
        }
        if (ch === '"') {
          inDouble = false
          continue
        }
        if (ch === '`' || (ch === '$' && cmd[i + 1] === '(')) {
          return true
        }
        continue
      }
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === "'") {
        inSingle = true
        continue
      }
      if (ch === '"') {
        inDouble = true
        continue
      }
      if (ch === '`') return true
      if ((ch === '$' || ch === '<' || ch === '>') && cmd[i + 1] === '(') {
        return true
      }
    }
    return false
  }

  const hasNonFdDupRedirect = (cmd: string): boolean => {
    // Strip quoted and backslash-escaped spans with a proper POSIX quote state
    // machine so quotes inside quotes (e.g. `echo "don't" > /tmp/pwn && echo "can't"`)
    // cannot mask redirects outside quotes.
    let unquoted = ''
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < cmd.length; i++) {
      const ch = cmd[i]!
      if (inSingle) {
        if (ch === "'") inSingle = false
        unquoted += ' '
        continue
      }
      if (inDouble) {
        if (ch === '\\' && i + 1 < cmd.length) {
          const next = cmd[i + 1]!
          if (
            next === '"' ||
            next === '\\' ||
            next === '$' ||
            next === '`' ||
            next === '\n'
          ) {
            i++
            unquoted += '  '
            continue
          }
        }
        if (ch === '"') {
          inDouble = false
        }
        unquoted += ' '
        continue
      }
      if (ch === '\\') {
        i++
        unquoted += '  '
        continue
      }
      if (ch === "'") {
        inSingle = true
        unquoted += ' '
        continue
      }
      if (ch === '"') {
        inDouble = true
        unquoted += ' '
        continue
      }
      unquoted += ch
    }
    // Strip harmless fd duplications like `2>&1`, `1>&2`, `>&2`, `<&0`
    const withoutFdDups = unquoted.replace(/\b\d*[<>]&\d+\b|[<>]&\d+\b/g, '')
    return /[<>]/.test(withoutFdDups)
  }

  if (hasCommandOrProcessSub(command) || hasNonFdDupRedirect(command)) {
    return false
  }

  let subcommands: string[]
  try {
    subcommands = splitCommand_DEPRECATED(command)
  } catch {
    return false
  }

  if (subcommands.length === 0) {
    return false
  }

  // Official `Mbr`: reject cross-subcommand variable assignment & reference
  const assignedInSub = new Map<string, Set<number>>()
  for (let idx = 0; idx < subcommands.length; idx++) {
    const trimmedSub = subcommands[idx]!.trim()
    const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmedSub)
    if (assignMatch && !/\s/.test(trimmedSub)) {
      const name = assignMatch[1]!
      let set = assignedInSub.get(name)
      if (!set) {
        set = new Set<number>()
        assignedInSub.set(name, set)
      }
      set.add(idx)
    }
    for (const m of trimmedSub.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):?=/g)) {
      const name = m[1]!
      let set = assignedInSub.get(name)
      if (!set) {
        set = new Set<number>()
        assignedInSub.set(name, set)
      }
      set.add(idx)
    }
  }
  if (assignedInSub.size > 0) {
    for (let idx = 0; idx < subcommands.length; idx++) {
      const sub = subcommands[idx]!
      for (const [name, indices] of assignedInSub) {
        if (indices.size === 1 && indices.has(idx)) continue
        if (new RegExp(`\\$[=^~]*\\{?${name}\\b`).test(sub)) {
          return false
        }
      }
    }
  }

  const CD_LIKE_RE = /^(?:cd|chdir|pushd|popd)(?:\s|$)/

  for (const subcommand of subcommands) {
    const trimmed = subcommand.trim()
    if (!trimmed) {
      return false
    }
    if (CD_LIKE_RE.test(trimmed)) {
      return false
    }
    if (commandHasDangerousGitFlags(trimmed)) {
      return false
    }
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

    let subcommandMatched = false
    for (const pattern of userExcludedCommands) {
      const rule = bashPermissionRule(pattern)
      for (const cand of candidates) {
        switch (rule.type) {
          case 'prefix':
            if (cand === rule.prefix || cand.startsWith(rule.prefix + ' ')) {
              subcommandMatched = true
            }
            break
          case 'exact':
            if (cand === rule.command) {
              subcommandMatched = true
            }
            break
          case 'wildcard':
            if (matchWildcardPattern(rule.pattern, cand)) {
              subcommandMatched = true
            }
            break
        }
        if (subcommandMatched) break
      }
      if (subcommandMatched) break
    }
    if (!subcommandMatched) {
      return false
    }
  }

  return true
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
    SANDBOX_EXCLUSION_METACHAR_RE.test(trimmed) ||
    commandHasDangerousGitFlags(trimmed)
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

/** SEA `UAe` (@290202060) */
function formatSandboxStrictRefusal(reason: string, guidance: string): string {
  return `The command did not run. Strict sandbox mode is on, so no command may run outside the sandbox, and ${reason}. ${guidance} Changing sandbox settings is for the user or their administrator to decide, not you. So is running this command, or one that does the same, through another tool or program.`
}

/**
 * SEA `ZVe` (@290202377) — returns a strict-sandbox refusal message when a
 * command would run unsandboxed (including when sandbox is enabled in settings
 * but cannot run, or when an excluded command would bypass strict mode), or
 * `null` when allowed to proceed.
 */
export function getSandboxPolicyRefusal(
  useSandbox: boolean,
  command: string,
  userTypedDangerouslyDisableSandbox: boolean,
  shellType: 'bash' | 'powershell',
): string | null {
  if (
    userTypedDangerouslyDisableSandbox ||
    useSandbox ||
    getPlatform() !== 'windows' ||
    !SandboxManager.isSandboxEnabledInSettings() ||
    !SandboxManager.isPlatformInEnabledList() ||
    !SandboxManager.isStrictSandboxModeConfigured()
  ) {
    return null
  }
  const sandboxActive = SandboxManager.isSandboxingEnabled()
  const nankeenKestrel =
    isEnvTruthy(process.env.CLAUDE_CODE_NANKEEN_KESTREL) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_nankeen_kestrel', false)
  if (
    shellType === 'bash' &&
    (sandboxActive ||
      !nankeenKestrel ||
      !getFeatureValue_CACHED_MAY_BE_STALE('tengu_nifty_ripple', true))
  ) {
    return null
  }
  const isExcluded = isFullyExcludedCommandForPolicy(command)
  const unsandboxedCommandsDisabled =
    !SandboxManager.areUnsandboxedCommandsAllowed()
  if (isExcluded && !unsandboxedCommandsDisabled) {
    return null
  }
  const excludedNeedsPrompt =
    'command matches a sandbox exclusion, but an exclusion exempts a command only where a permission prompt can approve the unsandboxed run, and none is available here'
  if (sandboxActive) {
    return isExcluded
      ? formatSandboxStrictRefusal(
          `the ${excludedNeedsPrompt}`,
          'Here the command can run only inside the sandbox.',
        )
      : formatSandboxStrictRefusal(
          "no sandbox.excludedCommands entry in user settings, managed settings or a --settings file exempts this command; an entry in a project's .claude/settings.json or settings.local.json does not count under strict mode",
          'Only an entry in one of those three counts.',
        )
  }
  const reason = 'the sandbox failed to start in this session'
  const guidance =
    'The user can restart Claude Code to try starting the sandbox again.'
  if (isExcluded) {
    return formatSandboxStrictRefusal(
      `${reason}. The ${excludedNeedsPrompt}`,
      guidance,
    )
  }
  return formatSandboxStrictRefusal(reason, guidance)
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
