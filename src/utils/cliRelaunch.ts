/**
 * Official OLt / PNe densable — CLI process relaunch plan for /tui switch +
 * fullscreen upsell accept.
 *
 * Densifies:
 * - env inject/drop for TUI switch (OLt)
 * - argv resolve: fresh vs `--resume <sessionId>` (PNe)
 * - optional spawnSync relaunch consumer
 * - multi-flush pre-exit densable (stdout/stderr best-effort)
 */

import { spawnSync } from 'node:child_process'
import { buildCliLaunch } from './cliLaunch.js'
import { getScreenReaderChildEnv } from './screenReaderGate.js'

/** Official dropEnv for TUI relaunchInto (OLt). */
export const TUI_RELAUNCH_DROP_ENV = [
  'CLAUDE_CODE_NO_FLICKER',
  'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN',
  'CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL',
] as const

/** Always cleared on relaunch (PNe). */
export const RELAUNCH_ALWAYS_DROP_ENV = [
  'CLAUDE_CODE_TUI_JUST_SWITCHED',
  'CLAUDE_BRIDGE_REATTACH_SESSION',
  'CLAUDE_BRIDGE_REATTACH_SEQ',
  'CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY',
  'CLAUDE_BRIDGE_REATTACH_GROUPING',
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
 */
export function buildTuiRelaunchPlan(input: {
  target: TuiRelaunchTarget
  extraArgs?: readonly string[]
  sessionId?: string | null
  hasNonEmptyTranscript?: boolean
  screenReaderEnv?: Readonly<Record<string, string>>
  /** Optional stdout size inject for child (default: current stdout). */
  terminalSize?: { columns?: number; rows?: number }
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
  const args = resolveRelaunchCliArgs({
    extraArgs: input.extraArgs,
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
 * Gate for full spawnSync+exit after /tui or fullscreen upsell accept.
 * Off by default (plan+inject only); set CLAUDE_CODE_SPAWN_TUI_RELAUNCH=1
 * to opt into process replacement densable.
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
 * Official fullscreen-upsell /tui accept densable:
 * 1. build OLt plan
 * 2. apply inject/drop to process.env
 * 3. optionally spawnSync replacement when SPAWN_TUI_RELAUNCH is set
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
}): AcceptTuiRelaunchResult {
  const plan = buildTuiRelaunchPlan(input)
  applyTuiRelaunchPlanToProcessEnv(plan, input.env ?? process.env)
  const shouldSpawn =
    input.spawn ?? isTuiRelaunchSpawnEnabled(input.env ?? process.env)
  if (!shouldSpawn) {
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
