/**
 * Auto-mode broad permission rule filter.
 *
 * Mirrors official v2.1.187 `NRH` / `rlq` / `ov8` / `olq` / `alq` semantics:
 * when the user is in auto mode (or plan mode with auto-mode active), broad
 * Bash/PowerShell/Agent allow rules are filtered out of `getAllowRules` so
 * the auto-mode classifier gets a chance to evaluate them per-invocation.
 *
 * Data structures and matching order follow the official implementation:
 *   - `oT8` / `dgq` / `yw4`: dangerous command lists
 *   - `kZ6` / `Ew4`: network/cloud commands that need subcommand awareness
 *   - `hw4`: per-command special subcommand sets (kubectl)
 *   - `_L4`-equivalent: result cache keyed by `toolName\0ruleContent`
 *
 * The matchers accept the same rule-shape variants the official matchers do:
 *   exact, `:*`, trailing `*`, ` *`, ` -…*`, plus `.exe` variants on Windows
 *   shells and the curl/wget/kubectl special-cases.
 */

import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { getSettingsForSource } from '../settings/settings.js'
import { normalizeLegacyToolName } from './permissionRuleParser.js'

/**
 * Cross-platform code-execution entry points (official `oT8`).
 * Kept in sync with `dangerousPatterns.ts`'s CROSS_PLATFORM_CODE_EXEC so the
 * two layers (broad-rule filter + auto-mode stripping) agree on what counts
 * as "interpreter reachable from a shell".
 */
const O_T8 = [
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  'npx',
  'bunx',
  'pnpx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  'npm exec',
  'npm x',
  'pnpm exec',
  'pnpm dlx',
  'yarn exec',
  'yarn dlx',
  'bun exec',
  'bun x',
  'bash',
  'sh',
  'ssh',
] as const

/**
 * Official 2.1.326 `vPn` — shells, wrappers, and launchers used by `he()`
 * to recognize wildcard allow rules that can wrap arbitrary execution.
 */
const SHELL_WRAPPERS_VPN = new Set<string>([
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'ksh',
  'mksh',
  'dash',
  'ash',
  'hush',
  'rbash',
  'rsh',
  'busybox',
  'toybox',
  'wsl',
  'cmd',
  'powershell',
  'pwsh',
  'env',
  'xargs',
  'command',
  'builtin',
  'noglob',
  'nice',
  'stdbuf',
  'nohup',
  'timeout',
  'time',
  'watch',
  'ionice',
  'chrt',
  'setsid',
  'taskset',
  'strace',
  'ltrace',
  'script',
  'flock',
  'unshare',
  'nsenter',
  'sandbox-exec',
  'sudo',
  'doas',
  'pkexec',
  'su',
  'runuser',
])

/**
 * Extended dangerous list (official `dgq`). Adds shells and wrappers that
 * don't directly execute arbitrary code but can be used to chain into it.
 */
const D_G_Q: readonly string[] = [
  ...O_T8,
  'zsh',
  'fish',
  'eval',
  'exec',
  'env',
  'xargs',
  'sudo',
]

/**
 * Network/cloud commands that accept subcommands. The matcher treats rules
 * like `Bash(curl:*)` as broad only when the rule would also allow POST/exfil
 * subcommands; a plain `Bash(curl https://...)` rule is allowed through.
 */
const K_Z_6 = ['curl', 'wget', 'kubectl', 'aws', 'gcloud', 'gsutil'] as const

/**
 * Reserved for future per-command subcommand maps. Currently empty in the
 * official binary (`NZ6 = []`).
 */
const N_Z_6: readonly string[] = []

/**
 * Set form of `[...K_Z_6, ...N_Z_6]`. Membership triggers the special
 * subcommand-aware matching branch in `matchBashBroadRule`.
 */
const E_W_4 = new Set<string>([...K_Z_6, ...N_Z_6])

/**
 * Per-command subcommand sets. An entry maps a command to either:
 *   - a `Set<string>` of subcommands considered broad (kubectl → exec/apply/...)
 *   - the literal string `'all'` → every subcommand is broad
 *   - absent → no subcommand is broad on its own
 *
 * Matches official `hw4 = { kubectl: new Set([...]), ...!1 }` (`...!1`
 * spreads nothing, equivalent to a single-key object).
 */
const H_W_4: Record<string, Set<string> | 'all'> = {
  kubectl: new Set([
    'exec',
    'apply',
    'create',
    'delete',
    'run',
    'cp',
    'port-forward',
    'proxy',
    'patch',
    'edit',
    'replace',
    'attach',
    'debug',
    'scale',
    'rollout',
    'drain',
    'cordon',
    'taint',
  ]),
}

/**
 * Bash broad-rule command list (official `yw4 = [...dgq, ...[]]`).
 *
 * NOTE: this is intentionally narrower than `DANGEROUS_BASH_PATTERNS` from
 * `dangerousPatterns.ts`. The latter includes ant-only extras (curl/wget/git/
 * gh/kubectl/aws/gcloud/gsutil) used by the auto-mode *stripping* layer;
 * the official broad-rule *filter* only uses `[...dgq]`. Keeping these
 * separate matches the official split.
 */
const Y_W_4: readonly string[] = [...D_G_Q]

/**
 * PowerShell broad-rule command list (official `[...oT8, "pwsh", ...]`).
 */
const POWERSHELL_BROAD_PATTERNS: readonly string[] = [
  ...O_T8,
  'pwsh',
  'powershell',
  'cmd',
  'wsl',
  'iex',
  'invoke-expression',
  'icm',
  'invoke-command',
  'start-process',
  'saps',
  'start',
  'start-job',
  'sajb',
  'start-threadjob',
  'invoke-wmimethod',
  'iwmi',
  'invoke-cimmethod',
  'icim',
  'wmic',
  'register-objectevent',
  'register-engineevent',
  'register-wmievent',
  'register-scheduledjob',
  'new-pssession',
  'nsn',
  'enter-pssession',
  'etsn',
  'add-type',
  'new-object',
]

const POWERSHELL_EXTRA_EXACT_PATTERNS: readonly string[] = [
  'get-module',
  'gmo',
  'module',
]

// Official 2.1.326 `Ke` / `pe` / `ze` / `qe` / `Q` / `Z` / `he` (#320 / #321)
const LEADING_TOKEN_RE =
  /\s*((?:\\.|'[^']*'|"(?:\\.|[^"\\])*"|[^\s\\'"])+)(?=\s)/gsy
const NON_PROGRAM_TOKEN_RE =
  /^(?:\w+\+?=|-|\/+\w$|\d[\d.]*[smhd]?$|[^a-z0-9]*$)|[^\w .+@%,:~/-]/i
const INLINE_CMD_FLAG_RE = /^(?:-\w*c|\/c)$/i
const RELATIVE_WIN_DOT_SLASH_PREFIX_RE =
  /^\.(?:\\[\w.+@-]*[\w+@-])+(?=[ \t]|:\*$)/

/** Official `Q(e)`: basename, lowercase, strip trailing version digits and `.exe`. */
export function normalizeBroadRuleProg(token: string): string {
  return token
    .replace(/^.*[\\/]/s, '')
    .toLowerCase()
    .replace(/^(.*?[^\d.])?[\d.]*(?:\.exe)?$/s, '$1')
}

/** Official `Z(e)`: normalize whitespace, collapse `* *`, normalize leading command. */
export function normalizeBroadRuleContent(ruleContent: string): string {
  return ruleContent
    .trim()
    .toLowerCase()
    .replace(/[ \t]+/g, ' ')
    .replace(/\*[ *]*\*/g, '*')
    .replace(/^(?:"[^"*]*"|'[^'*]*'|[^ *='"])+?(?= |:\*$|$)/, match =>
      normalizeBroadRuleProg(match.replace(/['"]/g, '')),
    )
    .replace(/['"]/g, '')
}

/**
 * Official 2.1.326 `he(ruleContent, patterns)` (#320 / #321):
 * Inspect the prefix before the first unescaped `*` in a wildcard shell rule.
 * Exact rules (no wildcard) return `false` so exact rules keep their allow.
 * Wildcard rules that name no program, start with `$HOME`/env/flags/shell chars,
 * start with a Windows backslash path or path traversal, or prefix a shell
 * wrapper / dangerous interpreter return `true` (treated as broad so auto mode's
 * safety classifier evaluates them).
 */
export function matchesWildcardBroadPrefix(
  ruleContent: string,
  patterns: readonly string[] = [],
): boolean {
  const normalizedSuffix = ruleContent.replace(/:\*$/, ' *')
  const prefix = /^(?:\\[*\\]|[^*])*/.exec(normalizedSuffix)?.[0] ?? ''
  if (prefix === normalizedSuffix) return false

  const words = normalizeBroadRuleContent(prefix).split(' ')
  const lastNonFlagIdx = words.findLastIndex(
    w => !/^(?:-|[^a-z0-9:]*$)/.test(w),
  )
  if (patterns.includes(words.slice(0, lastNonFlagIdx + 1).join(' '))) {
    return true
  }

  const allTargets = [...SHELL_WRAPPERS_VPN, ...patterns]
  let consumed = 0
  LEADING_TOKEN_RE.lastIndex = 0
  for (const match of prefix.matchAll(LEADING_TOKEN_RE)) {
    const raw = (match[1] ?? '').replace(/['"]/g, '')
    if (INLINE_CMD_FLAG_RE.test(raw)) return true
    if (
      !NON_PROGRAM_TOKEN_RE.test(raw) &&
      !allTargets.includes(normalizeBroadRuleProg(raw))
    ) {
      return false
    }
    consumed += match[0].length
  }

  const tail = prefix.slice(consumed).trim().replace(/['"]/g, '')
  const tailProg = normalizeBroadRuleProg(tail)
  return (
    NON_PROGRAM_TOKEN_RE.test(tail) ||
    /^(?:[/~\\]|[a-z]:)|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(tail) ||
    (tailProg !== '' &&
      allTargets.some(t => !t.includes(' ') && t.startsWith(tailProg)))
  )
}

/**
 * Cache mirroring official `_L4`. Keyed by `${toolName}\x00${ruleContent ?? ''}`,
 * isolated per SessionHost via `HostSlot`.
 */
const broadRuleCacheByHost = new HostSlot<Map<string, boolean>>(() => new Map())

function getBroadRuleCache(): Map<string, boolean> {
  return broadRuleCacheByHost.of(getBootstrapSessionHost())
}

/**
 * Auto-mode detection (official `PL4` / densable xa @177386583).
 *
 * Returns true when permission rules should be filtered for auto-mode safety,
 * i.e. when `mode === 'auto'` or when plan mode is acting as auto-mode
 * (`mode === 'plan'` and the auto-mode flag is active).
 *
 * densable lL @179623813: `xa(e.mode, e.servedCall===true)` — a served
 * plan+auto context does **not** take the auto allow-filter path (`!s`).
 * `mode === 'auto'` still filters regardless of `servedCall`.
 *
 * `autoModeStateModule` is required lazily so this module stays loadable
 * without `TRANSCRIPT_CLASSIFIER` enabled.
 */
export function isAutoModeFilteringActive(
  mode: string,
  isAutoModeActive?: boolean,
  servedCall?: boolean,
): boolean {
  if (mode === 'auto') return true
  if (mode === 'plan' && servedCall === true) return false
  if (mode === 'plan') return isAutoModeActive ?? false
  return false
}

/**
 * Official 2.1.193 `$oi` / `p6r`: when any trusted settings source sets
 * `autoMode.classifyAllShell: true`, every Bash/PowerShell allow rule is treated
 * as broad while auto mode is active (shell always goes through the classifier).
 * Sources match getAutoModeConfig: user / flag / policy (not project/local).
 */
export function isClassifyAllShellEnabled(): boolean {
  for (const source of [
    'userSettings',
    'flagSettings',
    'policySettings',
  ] as const) {
    const settings = getSettingsForSource(source)
    const autoMode = (
      settings as { autoMode?: { classifyAllShell?: boolean } } | null
    )?.autoMode
    if (autoMode?.classifyAllShell === true) return true
  }
  return false
}

/**
 * Official `rlq` — Bash broad-rule detector.
 *
 * A Bash rule is broad when:
 *   - the rule has no content (tool-level allow), or
 *   - the content is whitespace/asterisks only, or
 *   - the content matches a broad pattern from `Y_W_4` (via `matchBashBroadRule`).
 */
function isBashBroadRule(
  toolName: string,
  ruleContent: string | undefined,
): boolean {
  if (toolName !== BASH_TOOL_NAME) return false
  if (ruleContent === undefined || ruleContent === '') return true
  if (/^[\s*]+$/.test(ruleContent)) return true
  return (
    matchesWildcardBroadPrefix(ruleContent, D_G_Q) ||
    matchBashBroadRule(ruleContent, Y_W_4)
  )
}

/**
 * Official `ov8` / `cro`. Walks the broad-pattern list and returns true if `ruleContent`
 * matches any pattern as one of: exact, `:*`, trailing `*`, ` *`, ` -…*`.
 *
 * For commands in `E_W_4` (curl/wget/kubectl/aws/gcloud/gsutil), the matcher
 * inspects the first non-flag token to decide if the subcommand is dangerous
 * (per `H_W_4`), with a curl/wget URL-arg escape hatch.
 *
 * For Python variants, `python -m <module>.*` is allowed through (the official
 * binary special-cases this because `-m package.module` is a fixed entrypoint,
 * not arbitrary code).
 */
function matchBashBroadRule(
  ruleContent: string,
  patterns: readonly string[],
): boolean {
  const k = normalizeBroadRuleContent(ruleContent)
  if (k === '*') return true
  for (const p of patterns) {
    const lp = p.toLowerCase()
    if (k === lp) return true
    if (k === `${lp}:*` || k === `${lp} *`) return true
    if (k === `${lp}*`) return true
    if (k.startsWith(`${lp} `) && k.endsWith('*')) {
      const f = k.slice(lp.length + 1)
      if (E_W_4.has(lp)) {
        // Shell metacharacters in the suffix → treat as broad (arbitrary
        // shell substitution can bypass any subcommand allowlist).
        if (/[$`]/.test(f)) return true
        const subcmdSet = H_W_4[lp]
        if (subcmdSet === 'all') return true
        // Tokenize, skip leading flags (and their values), find first
        // positional token. Matches the official index-walking loop.
        const tokens = f
          .replace(/[\s:*]+$/, '')
          .split(/\s+/)
          .filter(Boolean)
        let i = 0
        for (; i < tokens.length; i++) {
          const t = tokens[i]
          if (!t.startsWith('-')) break
          // Flag with inline value (e.g. --data=...) → consume just this token.
          if (t.includes('=')) continue
          // Flag that takes a value as the next token (e.g. -d POSTDATA).
          if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) i++
        }
        const firstPositional = tokens[i]
        if (firstPositional === undefined) {
          // No positional → broad unless curl/wget with a URL argument
          // (URL fetch without -d/-X POST is read-only and the official
          // binary lets it through).
          if (
            (lp === 'curl' || lp === 'wget') &&
            tokens.some(t => t.includes('://'))
          ) {
            continue
          }
          return true
        }
        if (subcmdSet instanceof Set && subcmdSet.has(firstPositional)) {
          return true
        }
        continue
      }
      // Non-network command with a `-*` suffix → broad unless it's the
      // Python `-m package.module` special case.
      if (f.startsWith('-')) {
        const withoutTrailingStar = f.slice(0, -1)
        if (
          !(
            /^python[\d.]*$/.test(lp) &&
            /^-m\s+\w+\.[\w.]+(\s*:|\s+)$/.test(withoutTrailingStar)
          )
        ) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Official `olq` — PowerShell broad-rule detector.
 *
 * Mirrors `matchBashBroadRule` but also matches `.exe` variants of each
 * pattern (e.g. `python.exe`, `npm.exe run`). PowerShell rule content is
 * case-insensitive.
 */
function isPowerShellBroadRule(
  toolName: string,
  ruleContent: string | undefined,
): boolean {
  if (toolName !== POWERSHELL_TOOL_NAME) return false
  if (ruleContent === undefined || ruleContent === '') return true
  if (/^[\s*]+$/.test(ruleContent)) return true
  const k = normalizeBroadRuleContent(ruleContent)
  if (k === '*') return true
  // Official 2.1.326 `zes` (#321): normalize leading `.\sub\cmd` backslashes
  // for `he()` while keeping arbitrary Windows backslash paths (`C:\...`, `\...`)
  // broad when wildcarded. Exact rules (no wildcard) skip `he()`.
  const psForWildcard = ruleContent.replace(
    RELATIVE_WIN_DOT_SLASH_PREFIX_RE,
    m => m.replaceAll('\\', '/'),
  )
  if (matchesWildcardBroadPrefix(psForWildcard, POWERSHELL_BROAD_PATTERNS)) {
    return true
  }
  for (const p of [
    ...POWERSHELL_BROAD_PATTERNS,
    ...POWERSHELL_EXTRA_EXACT_PATTERNS,
  ]) {
    if (k === p) return true
    if (k === `${p}:*`) return true
    if (k === `${p}*`) return true
    if (k === `${p} *`) return true
    if (k.startsWith(`${p} -`) && k.endsWith('*')) return true
    // `.exe` variant — injected on the first word of the pattern.
    const sp = p.indexOf(' ')
    const exe = sp === -1 ? `${p}.exe` : `${p.slice(0, sp)}.exe${p.slice(sp)}`
    if (k === exe) return true
    if (k === `${exe}:*`) return true
    if (k === `${exe}*`) return true
    if (k === `${exe} *`) return true
    if (k.startsWith(`${exe} -`) && k.endsWith('*')) return true
  }
  return false
}

/**
 * Official `alq` — Agent tool broad-rule detector.
 *
 * Any Agent tool allow rule is broad in auto mode because it would auto-approve
 * sub-agent spawns before the classifier can evaluate the sub-agent's prompt.
 * `$$` in the official binary resolves to the string `"Agent"`, and `PV(H)`
 * is the legacy-name normalizer.
 */
function isAgentBroadRule(toolName: string): boolean {
  return normalizeLegacyToolName(toolName) === AGENT_TOOL_NAME
}

/**
 * densable 2.1.236 `lpv` / `HE="Monitor"` — any Monitor allow rule is broad
 * in auto mode so Monitor is reviewed like Bash (set aside from alwaysAllow).
 */
const MONITOR_TOOL_NAME = 'Monitor'
function isMonitorBroadRule(toolName: string): boolean {
  return normalizeLegacyToolName(toolName) === MONITOR_TOOL_NAME
}

/**
 * Official `NRH` — cached broad-rule detector entry point.
 *
 * Cache key matches official: `${toolName}\x00${ruleContent ?? ''}`.
 * Result is reusable across calls because the broadness of a rule depends
 * only on (toolName, ruleContent), not on runtime state.
 */
export function isBroadRule(
  toolName: string,
  ruleContent: string | undefined,
): boolean {
  // Official `v0t`: classifyAllShell makes every Bash/PowerShell allow rule broad.
  // Not cached with the rule key — setting can change mid-session via file watch.
  const normalized = normalizeLegacyToolName(toolName)
  if (
    (normalized === BASH_TOOL_NAME || normalized === POWERSHELL_TOOL_NAME) &&
    isClassifyAllShellEnabled()
  ) {
    return true
  }

  const key = `${toolName}\x00${ruleContent ?? ''}`
  const cache = getBroadRuleCache()
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  // Official nWn: Q9n(Bash) || tWn(PowerShell) || k8a(Agent) || lpv(Monitor)
  const result =
    isBashBroadRule(toolName, ruleContent) ||
    isPowerShellBroadRule(toolName, ruleContent) ||
    isAgentBroadRule(toolName) ||
    isMonitorBroadRule(toolName)
  cache.set(key, result)
  return result
}

/**
 * Test-only: clears the broad-rule cache. Mirrors the pattern used by
 * `autoModeState._resetForTesting()`.
 */
export function _resetBroadRuleCacheForTesting(): void {
  broadRuleCacheByHost.peek(getBootstrapSessionHost())?.clear()
}

export function _getBroadRuleCacheForTesting(): Map<string, boolean> {
  return getBroadRuleCache()
}
