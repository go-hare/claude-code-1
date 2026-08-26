/**
 * Official OLt / PNe densable — CLI process relaunch plan for /tui switch +
 * fullscreen upsell accept.
 *
 * Densifies:
 * - env inject/drop for TUI switch (OLt)
 * - argv resolve: fresh vs `--resume <sessionId>` (PNe)
 * - densable 2.1.228 Bxa model pin (`--model` from mainLoopModelOverride)
 * - optional spawnSync relaunch consumer
 * - multi-flush pre-exit densable (stdout/stderr best-effort)
 */

import { spawnSync } from 'node:child_process'
import { buildCliLaunch } from './cliLaunch.js'
import { getScreenReaderChildEnv } from './screenReaderGate.js'

/**
 * densable Bxa — resolve live mainLoopModelOverride for /tui relaunch argv.
 *
 * Gold:
 * ```
 * function Bxa(){
 *   let e=ZC(); // mainLoopModelOverride
 *   if(e===void 0||Vn()==="mantle")return;
 *   if(e===null)return"default";
 *   if(!e)return;
 *   if(N_t(as(e)))return; // deprecated remap / past retirement
 *   if(Jje()?.fallbackModel===e)return; // refusal fallback latch
 *   return e
 * }
 * ```
 * cui then appends `...s!==void 0?["--model",s]:[]`.
 */
export type ResolveRelaunchModelArgDeps = {
  getOverride?: () => string | null | undefined
  getProvider?: () => string
  getLatchFallbackModel?: () => string | undefined
  /** densable N_t(as(e)) — true means skip pin. */
  isDeprecatedResolved?: (resolvedModel: string) => boolean
  /** densable as() — parse user-specified model before deprecation check. */
  parseModel?: (raw: string) => string
}

export function resolveRelaunchModelArg(
  deps: ResolveRelaunchModelArgDeps = {},
): string | undefined {
  const getOverride =
    deps.getOverride ??
    (() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getMainLoopModelOverride } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      return getMainLoopModelOverride() as string | null | undefined
    })
  const getProvider =
    deps.getProvider ??
    (() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getAPIProvider } =
        require('./model/providers.js') as typeof import('./model/providers.js')
      return getAPIProvider()
    })
  const getLatchFallbackModel =
    deps.getLatchFallbackModel ??
    (() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getRefusalFallbackModelLatch } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      return getRefusalFallbackModelLatch()?.fallbackModel
    })
  const parseModel =
    deps.parseModel ??
    ((raw: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { parseUserSpecifiedModel } =
          require('./model/model.js') as typeof import('./model/model.js')
        return parseUserSpecifiedModel(raw)
      } catch {
        return raw
      }
    })
  const isDeprecatedResolved =
    deps.isDeprecatedResolved ??
    ((resolved: string) => {
      try {
        // Local deprecation table is retirement-oriented; non-null warning ≈
        // densable N_t skip for remap / known-deprecated models.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getModelDeprecationWarning } =
          require('./model/deprecation.js') as typeof import('./model/deprecation.js')
        return getModelDeprecationWarning(resolved) !== null
      } catch {
        return false
      }
    })

  const override = getOverride()
  if (override === undefined || getProvider() === 'mantle') return undefined
  if (override === null) return 'default'
  if (!override) return undefined
  const resolved = parseModel(override)
  if (isDeprecatedResolved(resolved)) return undefined
  if (getLatchFallbackModel() === override) return undefined
  // densable QOa: Bxa + EOe — skip pin when value cannot be a standalone argv token.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isSafeArgvValue } =
      require('./tuiRelaunchCarry.js') as typeof import('./tuiRelaunchCarry.js')
    if (!isSafeArgvValue(override)) return undefined
  } catch {
    // densable optional during early bootstrap
  }
  return override
}

/**
 * densable cui fragment: append `--model <Bxa>` when resolved and not already
 * present in extraArgs (caller may pass a fuller cui-like list later).
 */
export function mergeRelaunchModelArgs(
  extraArgs?: readonly string[],
  modelArg: string | undefined = resolveRelaunchModelArg(),
): string[] {
  const out = extraArgs ? [...extraArgs] : []
  if (modelArg === undefined) return out
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '--model') return out
  }
  return [...out, '--model', modelArg]
}

/** Official dropEnv for TUI relaunchInto (OLt). */
export const TUI_RELAUNCH_DROP_ENV = [
  'CLAUDE_CODE_NO_FLICKER',
  'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN',
  'CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL',
] as const

/** Always cleared on relaunch (PNe). */
export const RELAUNCH_ALWAYS_DROP_ENV = [
  'CLAUDE_CODE_TUI_JUST_SWITCHED',
  'CLAUDE_CODE_TUI_TRIAL',
  'CLAUDE_BRIDGE_REATTACH_SESSION',
  'CLAUDE_BRIDGE_REATTACH_SEQ',
  'CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY',
  'CLAUDE_BRIDGE_REATTACH_GROUPING',
  'CLAUDE_BRIDGE_REATTACH_OWNER_ACCT',
  'CLAUDE_BRIDGE_REATTACH_OWNER_ORG',
  'CLAUDE_BRIDGE_REATTACH_NO_BACKFILL',
] as const

export type TuiRelaunchTarget = 'fullscreen' | 'default' | string

/**
 * Official OLt env densable — CLAUDE_CODE_TUI_JUST_SWITCHED + FXe screen-reader.
 */
export function buildTuiRelaunchEnv(
  target: TuiRelaunchTarget,
  screenReaderEnv: Readonly<Record<string, string>> = getScreenReaderChildEnv(),
): Record<string, string> {
  return {
    CLAUDE_CODE_TUI_JUST_SWITCHED: target,
    ...screenReaderEnv,
  }
}

/**
 * Official PNe argv densable — when freshIfNoTranscript and no non-empty
 * transcript, use only extraArgs; else `--resume <sessionId> ...extraArgs`.
 */
export function resolveRelaunchCliArgs(input: {
  extraArgs?: readonly string[]
  sessionId?: string | null
  /** Official: skip resume when no transcript / empty transcript. */
  freshIfNoTranscript?: boolean
  hasNonEmptyTranscript?: boolean
  /** Force explicit args (overrides resume/fresh). */
  args?: readonly string[]
}): string[] {
  if (input.args) return [...input.args]
  const extra = input.extraArgs ? [...input.extraArgs] : []
  if (input.freshIfNoTranscript && !input.hasNonEmptyTranscript) {
    return extra
  }
  const sessionId = input.sessionId?.trim()
  if (!sessionId) return extra
  return ['--resume', sessionId, ...extra]
}

/**
 * Official PNe env densable — clone process env, drop reattach/tui-switch
 * keys, assign inject, drop dropEnv list.
 */
export function buildRelaunchProcessEnv(input: {
  processEnv?: NodeJS.ProcessEnv
  injectEnv?: Readonly<Record<string, string | undefined>> | null
  dropEnv?: readonly string[]
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(input.processEnv ?? process.env) }
  for (const key of RELAUNCH_ALWAYS_DROP_ENV) {
    delete env[key]
  }
  if (input.injectEnv) {
    for (const [k, v] of Object.entries(input.injectEnv)) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
  }
  for (const key of input.dropEnv ?? []) {
    delete env[key]
  }
  return env
}

/**
 * Official OLt densable plan — env + drop list + freshIfNoTranscript for TUI.
 *
 * densable 2.1.234: when `toolPermissionContext` is provided, extraArgs are
 * composed as Cmt+Rmt (permission mode / allow-deny / add-dir / model /
 * effort / agent flags) instead of model-only merge.
 */
export function buildTuiRelaunchPlan(input: {
  target: TuiRelaunchTarget
  extraArgs?: readonly string[]
  sessionId?: string | null
  hasNonEmptyTranscript?: boolean
  screenReaderEnv?: Readonly<Record<string, string>>
  /** Optional stdout size inject for child (default: current stdout). */
  terminalSize?: { columns?: number; rows?: number }
  /**
   * densable Cmt+Rmt input — when set, builds full carry argv (overrides
   * bare mergeRelaunchModelArgs unless caller also passes extraArgs which
   * are then ignored in favor of the densable compose).
   */
  toolPermissionContext?: import('../types/permissions.js').ToolPermissionContext
  effort?: unknown
}): {
  args: string[]
  env: NodeJS.ProcessEnv
  dropEnv: readonly string[]
  injectEnv: Record<string, string>
} {
  const injectEnv = buildTuiRelaunchEnv(
    input.target,
    input.screenReaderEnv ?? getScreenReaderChildEnv(),
  )
  // Official Kro densable — snapshot current terminal size for child Ink.
  try {
    const { buildRelaunchTerminalSizeEnv } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    Object.assign(injectEnv, buildRelaunchTerminalSizeEnv(input.terminalSize))
  } catch {
    // densable optional
  }
  const dropEnv = TUI_RELAUNCH_DROP_ENV
  let extraArgs: string[]
  if (input.toolPermissionContext) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildTuiRelaunchExtraArgs } =
        require('./tuiRelaunchCarry.js') as typeof import('./tuiRelaunchCarry.js')
      let settingsEffort: string | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        settingsEffort = (
          require('./forkReplayLaunchConfig.js') as typeof import('./forkReplayLaunchConfig.js')
        ).getSettingsEffortAtStartup()
      } catch {
        settingsEffort = undefined
      }
      extraArgs = buildTuiRelaunchExtraArgs({
        toolPermissionContext: input.toolPermissionContext,
        effort: input.effort,
        settingsEffortAtStartup: settingsEffort,
      })
      // Caller-supplied extraArgs append after densable compose (rare).
      if (input.extraArgs?.length) {
        extraArgs = [...extraArgs, ...input.extraArgs]
      }
    } catch {
      extraArgs = mergeRelaunchModelArgs(input.extraArgs)
    }
  } else {
    // densable 2.1.228 Bxa: pin live mainLoopModelOverride as --model so /tui
    // relaunch does not revert to an earlier model after /model.
    extraArgs = mergeRelaunchModelArgs(input.extraArgs)
  }
  const args = resolveRelaunchCliArgs({
    extraArgs,
    sessionId: input.sessionId,
    freshIfNoTranscript: true,
    hasNonEmptyTranscript: input.hasNonEmptyTranscript,
  })
  const env = buildRelaunchProcessEnv({
    injectEnv,
    dropEnv,
  })
  return { args, env, dropEnv, injectEnv }
}

export type RelaunchSpawnResult =
  | { ok: true; status: number | null; signal: NodeJS.Signals | null }
  | { ok: false; error: string }

/**
 * Official PNe densable consumer — spawnSync current CLI with planned args/env.
 * Does NOT call process.exit — caller decides. Destructive; opt-in only.
 */
export function spawnCliRelaunch(input: {
  args: readonly string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
}): RelaunchSpawnResult {
  const launch = buildCliLaunch([...input.args], { env: input.env })
  const result = spawnSync(launch.execPath, launch.args, {
    stdio: 'inherit',
    env: launch.env,
    cwd: input.cwd ?? process.cwd(),
    windowsHide: launch.windowsHide,
  })
  if (result.error) {
    return { ok: false, error: result.error.message }
  }
  return {
    ok: true,
    status: result.status,
    signal: result.signal,
  }
}

/**
 * Official OLt densable consumer — plan + spawnSync for TUI target.
 * Does not exit the process.
 */
export function relaunchIntoTui(input: {
  target: TuiRelaunchTarget
  extraArgs?: readonly string[]
  sessionId?: string | null
  hasNonEmptyTranscript?: boolean
  screenReaderEnv?: Readonly<Record<string, string>>
  cwd?: string
}): RelaunchSpawnResult {
  const plan = buildTuiRelaunchPlan(input)
  return spawnCliRelaunch({
    args: plan.args,
    env: plan.env,
    cwd: input.cwd,
  })
}

/**
 * Official upsell-accept densable: apply inject/drop to current process.env
 * so a manual restart inherits TUI_JUST_SWITCHED without spawning.
 */
export function applyTuiRelaunchPlanToProcessEnv(
  plan: {
    injectEnv: Readonly<Record<string, string>>
    dropEnv: readonly string[]
  },
  processEnv: NodeJS.ProcessEnv = process.env,
): void {
  Object.assign(processEnv, plan.injectEnv)
  for (const key of plan.dropEnv) {
    delete processEnv[key]
  }
}

/**
 * Legacy opt-in leftover. Official `/tui` accept always oyt (spawn+exit).
 * `acceptTuiRelaunch` no longer reads this; tests may still force `spawn:false`.
 */
export function isTuiRelaunchSpawnEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.CLAUDE_CODE_SPAWN_TUI_RELAUNCH === '1' ||
    env.CLAUDE_CODE_SPAWN_TUI_RELAUNCH === 'true'
  )
}

export type AcceptTuiRelaunchResult =
  | { mode: 'inject_only'; plan: ReturnType<typeof buildTuiRelaunchPlan> }
  | {
      mode: 'spawned'
      plan: ReturnType<typeof buildTuiRelaunchPlan>
      spawn: RelaunchSpawnResult
    }

/**
 * Official multi-flush pre-exit densable — best-effort drain stdout/stderr
 * before process.exit after a successful spawnSync replacement. Injectable
 * streams for tests; never throws.
 */
export function flushStreamsBeforeRelaunchExit(input?: {
  stdout?: {
    write?: (chunk: string, cb?: (err?: Error | null) => void) => boolean
    end?: (cb?: () => void) => void
  }
  stderr?: {
    write?: (chunk: string, cb?: (err?: Error | null) => void) => boolean
    end?: (cb?: () => void) => void
  }
  /** When true, also call end() on streams (default false — inherit parent). */
  endStreams?: boolean
}): void {
  const outs = [
    input?.stdout ?? (process.stdout as typeof process.stdout),
    input?.stderr ?? (process.stderr as typeof process.stderr),
  ]
  for (const stream of outs) {
    try {
      // Trigger a no-op write callback path so buffered data is pushed.
      if (typeof stream.write === 'function') {
        stream.write('', () => {
          /* ignore */
        })
      }
      if (input?.endStreams && typeof stream.end === 'function') {
        stream.end()
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Official fullscreen-upsell /tui accept densable (`oyt`):
 * 1. build OLt plan
 * 2. apply inject/drop to process.env
 * 3. spawnSync replacement (pass `spawn: false` only in tests)
 * 4. multi-flush streams before caller process.exit
 * Caller may process.exit after mode==='spawned' if spawn.ok.
 */
export function acceptTuiRelaunch(input: {
  target: TuiRelaunchTarget
  extraArgs?: readonly string[]
  sessionId?: string | null
  hasNonEmptyTranscript?: boolean
  screenReaderEnv?: Readonly<Record<string, string>>
  cwd?: string
  env?: NodeJS.ProcessEnv
  spawn?: boolean
  /** Skip stream flush (tests). Default flushes when spawned ok. */
  skipFlush?: boolean
  /** densable Cmt+Rmt — when set, compose full carry argv. */
  toolPermissionContext?: import('../types/permissions.js').ToolPermissionContext
  effort?: unknown
}): AcceptTuiRelaunchResult {
  const plan = buildTuiRelaunchPlan(input)
  applyTuiRelaunchPlanToProcessEnv(plan, input.env ?? process.env)
  // densable accept → oyt. Tests pass spawn:false to stay on inject_only.
  if (input.spawn === false) {
    return { mode: 'inject_only', plan }
  }
  const spawn = spawnCliRelaunch({
    args: plan.args,
    env: plan.env,
    cwd: input.cwd,
  })
  if (spawn.ok && input.skipFlush !== true) {
    flushStreamsBeforeRelaunchExit()
  }
  return { mode: 'spawned', plan, spawn }
}
