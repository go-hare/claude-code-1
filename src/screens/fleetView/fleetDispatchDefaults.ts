/**
 * densable 2.1.289 FleetView dispatchDefaults helpers.
 * Behavior gold: parse / serialize / demote / agents-view relaunch.
 * Invent-ban: never export minify names cVe|Rdt|sf|P|Bw.
 */

import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import { spawnCliRelaunch } from '../../utils/cliRelaunch.js'
import { AGENT_VIEW_RELAUNCH_ENV_KEY } from '../../utils/residualFinalEnvGates.js'
import { flagArgPair } from '../../utils/tuiRelaunchCarry.js'

export type FleetDispatchDefaults = {
  permissionMode?: string
  permissionModeInherited?: true
  model?: string
  effort?: string
  agent?: string
  allowBypass?: true
  jsonSchema?: string
  appendSystemPrompt?: string
}

export type ParseAgentsDispatchResult = {
  dispatchDefaults: FleetDispatchDefaults | undefined
  rest: string[]
}

const AUTO_RELAUNCH_THROTTLE_MS = 3_600_000
const AGENTS_AUTO_RELAUNCHED_AT_ENV = 'CLAUDE_AGENTS_AUTO_RELAUNCHED_AT'

/** Module-level auto-relaunch throttle clock (densable Mg / Ms). */
let lastAutoRelaunchAt = 0

/** Test-only: reset auto throttle clock. */
export function resetFleetDispatchAutoRelaunchClockForTests(): void {
  lastAutoRelaunchAt = 0
}

/**
 * densable xo analog — project-config-root session marker.
 * No host launchOptions.projectConfigRoot() locally; detect env or argv.
 */
export function getActiveProjectConfigRoot(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): string | null {
  const fromEnv = env.CLAUDE_CODE_PROJECT_CONFIG_ROOT?.trim()
  if (fromEnv) return fromEnv
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--project-config-root') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) return next
      return ''
    }
    if (arg.startsWith('--project-config-root=')) {
      return arg.slice('--project-config-root='.length)
    }
  }
  return null
}

/**
 * densable Nt / YBn — value is inline `=…`, or the next token when it does
 * **not** look like a flag (`startsWith('-')`). Bare `--effort` / `--model`
 * with the next token another flag is dropped (same as old agents rewrite
 * and `extractPassthroughArgs`), so `--effort --cwd /tmp` keeps cwd in rest.
 */
function readDispatchFlagValue(
  args: string[],
  i: number,
  inline: string | undefined,
): { value: string; consume: number } | undefined {
  if (inline !== undefined) return { value: inline, consume: 0 }
  const next = args[i + 1]
  if (next !== undefined && !next.startsWith('-')) {
    return { value: next, consume: 1 }
  }
  return undefined
}

/**
 * densable Nt — soft-parse agents dispatch argv into defaults bag + rest.
 */
export function parseAgentsDispatchArgv(
  args: string[],
): ParseAgentsDispatchResult {
  let permissionModeExplicit: string | undefined
  let permissionModeInherited: string | undefined
  let model: string | undefined
  let effort: string | undefined
  let agent: string | undefined
  let allowBypass: true | undefined
  let jsonSchema: string | undefined
  let appendSystemPrompt: string | undefined
  const rest: string[] = []

  for (let i = 0; i < args.length; i++) {
    const raw = args[i]!
    const eq = raw.indexOf('=')
    const [flag, inline] =
      eq > 0 ? [raw.slice(0, eq), raw.slice(eq + 1)] : [raw, undefined]

    if (flag === '--dangerously-skip-permissions') {
      permissionModeExplicit = 'bypassPermissions'
      continue
    }
    if (flag === '--allow-dangerously-skip-permissions') {
      allowBypass = true
      continue
    }
    if (flag === '--permission-mode') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        permissionModeExplicit = got.value
        i += got.consume
      }
      continue
    }
    if (flag === '--inherit-permission-mode') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        permissionModeInherited = got.value
        i += got.consume
      }
      continue
    }
    if (flag === '--model') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        model = got.value
        i += got.consume
      }
      continue
    }
    if (flag === '--effort') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        effort = got.value
        i += got.consume
      }
      continue
    }
    if (flag === '--agent') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        agent = got.value
        i += got.consume
      }
      continue
    }
    if (flag === '--json-schema') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        jsonSchema = got.value
        i += got.consume
      }
      continue
    }
    if (flag === '--append-system-prompt') {
      const got = readDispatchFlagValue(args, i, inline)
      if (got) {
        appendSystemPrompt = got.value
        i += got.consume
      }
      continue
    }
    rest.push(raw)
  }

  const permissionMode = permissionModeExplicit ?? permissionModeInherited
  const hasBag =
    permissionMode !== undefined ||
    model !== undefined ||
    effort !== undefined ||
    agent !== undefined ||
    allowBypass === true ||
    jsonSchema !== undefined ||
    appendSystemPrompt !== undefined

  const dispatchDefaults: FleetDispatchDefaults | undefined = hasBag
    ? {
        permissionMode,
        ...(!permissionModeExplicit &&
          permissionModeInherited !== undefined && {
            permissionModeInherited: true as const,
          }),
        model,
        effort,
        agent,
        allowBypass,
        jsonSchema,
        appendSystemPrompt,
      }
    : undefined

  return { dispatchDefaults, rest }
}

/**
 * densable cVe — serialize dispatch defaults back to argv tokens.
 */
export function serializeFleetDispatchDefaults(
  d?: FleetDispatchDefaults,
): string[] {
  if (!d) return []
  return [
    ...flagArgPair('--model', d.model),
    ...flagArgPair('--effort', d.effort),
    ...flagArgPair('--agent', d.agent),
    ...flagArgPair(
      d.permissionModeInherited
        ? '--inherit-permission-mode'
        : '--permission-mode',
      d.permissionMode,
    ),
    ...(d.allowBypass ? ['--allow-dangerously-skip-permissions'] : []),
    ...flagArgPair('--json-schema', d.jsonSchema),
    ...flagArgPair('--append-system-prompt', d.appendSystemPrompt),
  ]
}

/**
 * densable Rdt — demote an explicit mode into an inherited bag when gated.
 */
export function demoteInheritedPermissionMode(
  mode: string,
): FleetDispatchDefaults {
  // Lazy: keep fleet module light when GrowthBook is unused in tests.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getFeatureValue_CACHED_MAY_BE_STALE } =
    require('../../services/analytics/growthbook.js') as typeof import('../../services/analytics/growthbook.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_agentview_inherit_mode_demote',
    true,
  )
    ? { permissionMode: mode, permissionModeInherited: true }
    : { permissionMode: mode }
}

function clearDefaultInheritedMode(
  defaults: FleetDispatchDefaults | undefined,
): FleetDispatchDefaults | undefined {
  if (
    defaults?.permissionModeInherited &&
    defaults.permissionMode === 'default'
  ) {
    return {
      ...defaults,
      permissionMode: undefined,
      permissionModeInherited: undefined,
    }
  }
  return defaults
}

function writeSwitchingPreSpawnMessage(): void {
  const version =
    typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string'
      ? MACRO.VERSION
      : 'this build'
  // densable me.dim — ANSI dim without chalk typing friction
  process.stdout.write(
    `\x1b[2m\nSwitching from ${version} to latest…\n\n\x1b[0m`,
  )
}

/**
 * densable sf — relaunch `claude agents` with cleared dispatch defaults.
 */
export async function relaunchAgentsView(input: {
  mode: 'manual' | 'auto'
  cwdFilter?: string
  defaults?: FleetDispatchDefaults
  typedAgent?: string
  extraArgs?: string[]
  onError?: (msg: string) => void
}): Promise<void> {
  const { mode, cwdFilter, defaults, typedAgent, extraArgs, onError } = input

  if (getActiveProjectConfigRoot() !== null) {
    if (mode === 'manual') {
      onError?.(
        "Couldn't switch to the latest build. This agent view was started with --project-config-root, and a relaunched one would not get that flag. To update, quit and start the agent view again.",
      )
    }
    return
  }

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { logEvent } =
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    logEvent('tengu_bg_agent_action', {
      action:
        `fleetview_update_${mode}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } catch {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { logForDebugging } =
        require('../../utils/debug.js') as typeof import('../../utils/debug.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      logForDebugging(`[fleet] fleetview_update_${mode}`)
    } catch {
      /* analytics/debug optional */
    }
  }

  if (mode === 'auto') {
    if (Date.now() - lastAutoRelaunchAt < AUTO_RELAUNCH_THROTTLE_MS) return
    lastAutoRelaunchAt = Date.now()
  }

  // typedAgent overrides bag.agent (densable P/sf UI agent pin); avoid double --agent.
  const cleared = clearDefaultInheritedMode(
    typedAgent !== undefined && typedAgent !== ''
      ? { ...defaults, agent: typedAgent }
      : defaults,
  )
  const args = [
    'agents',
    ...(cwdFilter ? ['--cwd', cwdFilter] : []),
    ...(extraArgs ?? []),
    ...serializeFleetDispatchDefaults(cleared),
  ]

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [AGENT_VIEW_RELAUNCH_ENV_KEY]: '1',
  }
  if (mode === 'auto') {
    env[AGENTS_AUTO_RELAUNCHED_AT_ENV] = String(Date.now())
  }

  writeSwitchingPreSpawnMessage()
  const result = spawnCliRelaunch({ args, env })
  if (!result.ok) {
    if (mode === 'manual') {
      onError?.(`Couldn't switch to the latest build — ${result.error}`)
    }
    return
  }
  // Child replaced the TUI; mirror update/relaunch consumers.
  process.exit(result.status ?? (result.signal ? 1 : 0))
}
