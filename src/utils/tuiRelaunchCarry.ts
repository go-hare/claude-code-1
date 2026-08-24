/**
 * densable 2.1.234 /tui relaunch carry + refuse (Cmt / Rmt / W4e / UYh / Jpc).
 *
 * Gold (SEA):
 *   Cmt(e,t)  — replConfigArgv (strip --add-dir) + bypass + add-dir + model +
 *               effort + --permission-mode
 *   Rmt(e,t)  — --allowed-tools / --disallowed-tools / agent / agents /
 *               append-system-prompt
 *   W4e(e,t)  — uncarriable reason list (restricted launch, session rules,
 *               ask cliArg, non-eLa rules, bad add-dir)
 *   UYh / Jpc — refuse / save-without-restart copy
 */

import type {
  AdditionalWorkingDirectory,
  ToolPermissionContext,
} from '../types/permissions.js'
import type { ForkReplayLaunchConfig } from './forkReplayLaunchConfig.js'

/** densable FBn — reason fragment for restricted launch flags. */
export const FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION =
  'a custom system prompt, a tool allowlist, or restricted settings'

/**
 * densable IIv — argv-unsafe value: leading `-` or URI scheme.
 * Values matching this (or containing NUL) cannot be carried as separate argv.
 */
export const ARGV_UNSAFE_VALUE_RE = /^-|^[A-Za-z][A-Za-z0-9+.-]+:\/\//

/** densable EOe — safe as a standalone argv token (not flag-like / no NUL). */
export function isSafeArgvValue(value: string): boolean {
  return !ARGV_UNSAFE_VALUE_RE.test(value) && !value.includes('\0')
}

/**
 * densable SR — comma/space tokenizer with paren awareness for permission rules.
 * Used by eLa to ensure a rule string is a single intact token.
 */
export function tokenizePermissionRuleArgs(
  inputs: readonly string[],
): string[] {
  if (inputs.length === 0) return []
  const out: string[] = []
  for (const raw of inputs) {
    if (!raw) continue
    let cur = ''
    let inParen = false
    for (const ch of raw) {
      switch (ch) {
        case '(':
          inParen = true
          cur += ch
          break
        case ')':
          inParen = false
          cur += ch
          break
        case ',':
          if (inParen) {
            cur += ch
          } else {
            if (cur.trim()) out.push(cur.trim())
            cur = ''
          }
          break
        case ' ':
          if (inParen) {
            cur += ch
          } else if (cur.trim()) {
            out.push(cur.trim())
            cur = ''
          }
          break
        default:
          cur += ch
      }
    }
    if (cur.trim()) out.push(cur.trim())
  }
  return out
}

/**
 * densable eLa — rule can be carried intact on the CLI (single SR token + EOe).
 */
export function canCarryPermissionRuleIntact(rule: string): boolean {
  const tokens = tokenizePermissionRuleArgs([rule])
  return tokens.length === 1 && tokens[0] === rule && isSafeArgvValue(rule)
}

/**
 * densable B9p — paths from additionalWorkingDirectories whose source is
 * cliArg or session (the ones a restart must re-apply via --add-dir).
 */
export function carryableAddDirPaths(
  dirs:
    | ReadonlyMap<string, AdditionalWorkingDirectory>
    | Iterable<AdditionalWorkingDirectory>
    | undefined,
): string[] {
  if (!dirs) return []
  const values =
    dirs instanceof Map
      ? Array.from(dirs.values())
      : Array.from(dirs as Iterable<AdditionalWorkingDirectory>)
  return values
    .filter(d => d.source === 'cliArg' || d.source === 'session')
    .map(d => d.path)
}

/**
 * densable sz — prefer `--flag value` when EOe(value); else `--flag=value`
 * so leading-dash / URI values still parse as a single option.
 */
export function flagArgPair(flag: string, value: string | undefined): string[] {
  if (!value) return []
  return isSafeArgvValue(value) ? [flag, value] : [`${flag}=${value}`]
}

/** densable QOa fragment — skip model pin when value fails EOe. */
export function resolveRelaunchModelArgWithArgvGuard(
  modelArg: string | undefined,
): string | undefined {
  if (modelArg === undefined) return undefined
  if (!isSafeArgvValue(modelArg)) return undefined
  return modelArg
}

/**
 * densable kXs — carry effort when it differs from settingsEffortAtStartup,
 * or when CLI `--effort` was present and parses to the same value.
 */
export function shouldCarryEffortArg(
  effort: string,
  deps: {
    settingsEffortAtStartup?: string | undefined
    argv?: readonly string[]
    parseEffort?: (raw: string) => string | undefined
  } = {},
): boolean {
  const settings = deps.settingsEffortAtStartup
  if (effort !== settings) return true
  const argv = deps.argv ?? process.argv
  const parse =
    deps.parseEffort ??
    ((raw: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { parseEffortLevelString } =
          require('./effort.js') as typeof import('./effort.js')
        return parseEffortLevelString(raw)
      } catch {
        return undefined
      }
    })
  const cliEffort = getLastCliFlagValue('--effort', argv)
  return cliEffort !== undefined && parse(cliEffort) === effort
}

/**
 * densable nMr — only carry `--effort` when:
 *   typeof string && pGo() && kXs(e)
 * pGo = all three unpin* launch pins are true.
 */
export function resolveRelaunchEffortArg(
  effort: unknown,
  deps: {
    arePinsUnpinned?: () => boolean
    settingsEffortAtStartup?: string | undefined
    argv?: readonly string[]
    parseEffort?: (raw: string) => string | undefined
  } = {},
): string | undefined {
  if (typeof effort !== 'string') return undefined
  const pinsUnpinned =
    deps.arePinsUnpinned ??
    (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { areAllEffortLaunchPinsUnpinned } =
          require('./model/effortCatalog.js') as typeof import('./model/effortCatalog.js')
        return areAllEffortLaunchPinsUnpinned()
      } catch {
        return false
      }
    })
  if (!pinsUnpinned()) return undefined
  let settingsEffort = deps.settingsEffortAtStartup
  if (settingsEffort === undefined && !('settingsEffortAtStartup' in deps)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      settingsEffort = (
        require('./forkReplayLaunchConfig.js') as typeof import('./forkReplayLaunchConfig.js')
      ).getSettingsEffortAtStartup()
    } catch {
      settingsEffort = undefined
    }
  }
  if (
    !shouldCarryEffortArg(effort, {
      settingsEffortAtStartup: settingsEffort,
      argv: deps.argv,
      parseEffort: deps.parseEffort,
    })
  ) {
    return undefined
  }
  return effort
}

/** densable NRr / F4s.at(-1) — last occurrence of `--flag` / `--flag=`. */
export function getLastCliFlagValue(
  flag: string,
  argv: readonly string[] = process.argv,
): string | undefined {
  const values: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === '--') break
    if (tok?.startsWith(`${flag}=`)) {
      values.push(tok.slice(flag.length + 1))
      continue
    }
    if (tok === flag && i + 1 < argv.length) {
      values.push(argv[++i]!)
    }
  }
  return values.at(-1)
}

/**
 * densable Cmt — build carry argv from permission context + effort.
 * Strips `--add-dir` pairs from replConfigArgv (re-added from context).
 */
export function buildTuiCarryPermissionArgs(
  ctx: Pick<
    ToolPermissionContext,
    'mode' | 'additionalWorkingDirectories' | 'isBypassPermissionsModeAvailable'
  >,
  effort: unknown,
  deps: {
    replConfigArgv?: readonly string[]
    resolveModelArg?: () => string | undefined
    resolveEffortArg?: (effort: unknown) => string | undefined
    settingsEffortAtStartup?: string | undefined
  } = {},
): string[] {
  const repl =
    deps.replConfigArgv ??
    (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getReplConfigArgv } =
          require('./forkReplayLaunchConfig.js') as typeof import('./forkReplayLaunchConfig.js')
        return getReplConfigArgv()
      } catch {
        return [] as readonly string[]
      }
    })()

  const addDirs = carryableAddDirPaths(ctx.additionalWorkingDirectories)
  const stripped: string[] = []
  let skipNext = false
  for (const tok of repl) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (tok === '--add-dir') {
      skipNext = true
      continue
    }
    stripped.push(tok)
  }

  const resolveModel =
    deps.resolveModelArg ??
    (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveRelaunchModelArg } =
          require('./cliRelaunch.js') as typeof import('./cliRelaunch.js')
        return resolveRelaunchModelArgWithArgvGuard(resolveRelaunchModelArg())
      } catch {
        return undefined
      }
    })
  const resolveEffort =
    deps.resolveEffortArg ??
    ((e: unknown) =>
      resolveRelaunchEffortArg(e, {
        settingsEffortAtStartup: deps.settingsEffortAtStartup,
      }))

  const modelArg = resolveModel()
  const effortArg = resolveEffort(effort)
  const needBypass =
    ctx.isBypassPermissionsModeAvailable &&
    !stripped.includes('--allow-dangerously-skip-permissions')

  return [
    ...stripped,
    ...(needBypass ? (['--allow-dangerously-skip-permissions'] as const) : []),
    ...addDirs.flatMap(p => ['--add-dir', p]),
    ...(modelArg !== undefined ? ['--model', modelArg] : []),
    ...(effortArg !== undefined ? ['--effort', effortArg] : []),
    '--permission-mode',
    ctx.mode,
  ]
}

/**
 * densable Rmt — allowed/disallowed cliArg tools + forkReplay agent flags.
 */
export function buildTuiCarryToolRuleArgs(
  ctx: Pick<ToolPermissionContext, 'alwaysAllowRules' | 'alwaysDenyRules'>,
  replay: ForkReplayLaunchConfig = {},
): string[] {
  return [
    ...(ctx.alwaysAllowRules.cliArg ?? []).flatMap(r => ['--allowed-tools', r]),
    ...(ctx.alwaysDenyRules.cliArg ?? []).flatMap(r => [
      '--disallowed-tools',
      r,
    ]),
    ...flagArgPair('--agent', replay.agent),
    ...flagArgPair('--agents', replay.agents),
    ...flagArgPair('--append-system-prompt', replay.appendSystemPrompt),
  ]
}

/** densable Cmt+Rmt compose — full extraArgs for I_r / acceptTuiRelaunch. */
export function buildTuiRelaunchExtraArgs(input: {
  toolPermissionContext: ToolPermissionContext
  effort?: unknown
  replay?: ForkReplayLaunchConfig
  replConfigArgv?: readonly string[]
  resolveModelArg?: () => string | undefined
  resolveEffortArg?: (effort: unknown) => string | undefined
  settingsEffortAtStartup?: string | undefined
}): string[] {
  const replay =
    input.replay ??
    (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getForkReplayLaunchConfig } =
          require('./forkReplayLaunchConfig.js') as typeof import('./forkReplayLaunchConfig.js')
        return getForkReplayLaunchConfig()
      } catch {
        return {} as ForkReplayLaunchConfig
      }
    })()
  return [
    ...buildTuiCarryPermissionArgs(input.toolPermissionContext, input.effort, {
      replConfigArgv: input.replConfigArgv,
      resolveModelArg: input.resolveModelArg,
      resolveEffortArg: input.resolveEffortArg,
      settingsEffortAtStartup: input.settingsEffortAtStartup,
    }),
    ...buildTuiCarryToolRuleArgs(input.toolPermissionContext, replay),
  ]
}

/**
 * densable W4e — reasons a restart cannot carry session restrictions.
 * Empty array ⇒ ok to relaunch.
 */
export function getTuiUncarriableReasons(
  ctx: Pick<
    ToolPermissionContext,
    | 'alwaysAllowRules'
    | 'alwaysDenyRules'
    | 'alwaysAskRules'
    | 'additionalWorkingDirectories'
  >,
  forkRestricted: boolean,
): string[] {
  return [
    ...(forkRestricted
      ? [`launch flags: ${FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION}`]
      : []),
    ...((ctx.alwaysDenyRules.session ?? []).length > 0 ||
    (ctx.alwaysAskRules.session ?? []).length > 0
      ? ['permission rules set for this session only']
      : []),
    ...((ctx.alwaysAskRules.cliArg ?? []).length > 0
      ? ['ask-before-running rules with no command-line form']
      : []),
    ...([
      ...(ctx.alwaysAllowRules.cliArg ?? []),
      ...(ctx.alwaysDenyRules.cliArg ?? []),
    ].some(r => !canCarryPermissionRuleIntact(r))
      ? ['permission rules a command line cannot carry intact']
      : []),
    ...(carryableAddDirPaths(ctx.additionalWorkingDirectories).some(
      r => !isSafeArgvValue(r),
    )
      ? ['added directories a command line cannot carry intact']
      : []),
  ]
}

/**
 * densable UYh — refuse /tui before preference save (nothing changed).
 * Uses densable en-dash (U+2014).
 */
export function formatTuiUncarriableRefuseMessage(
  target: string,
  reasons: readonly string[],
): string {
  return `Cannot switch renderers in this session — it has restrictions a restart can't carry over (${reasons.join('; ')}). Nothing was changed. Running /tui ${target} in a session started without them switches every later session too.`
}

/**
 * densable Jpc — preference saved, stay without restart (bounce / post-save).
 */
export function formatTuiUncarriableSavedMessage(
  reasons: readonly string[],
): string {
  return `Staying on the default renderer without a restart — this session now has restrictions a restart can't carry over (${reasons.join('; ')}); the preference is saved.`
}
