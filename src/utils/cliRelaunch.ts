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
 * - densable 2.1.248 `_G`/Ket (Mhr/le): injectTuiSwitch:false — env is
 *   `$B()` + extraInjectEnv, not CLAUDE_CODE_TUI_JUST_SWITCHED. Yet /
 *   CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE still applies (official `_G` always
 *   Object.assign(s, Yet()) after extra + dropEnv).
 */

import { spawn, spawnSync } from 'node:child_process'
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

/** Always cleared on relaunch (PNe / official `_G` delete list + k0e). */
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
  'CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE',
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
 *
 * densable 2.1.248 `_G`/Ket: `injectTuiSwitch: false` is `$B()` + extra
 * (no TUI switch / OLt dropEnv). Yet / CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE
 * still applies after extraInjectEnv (official `_G` always Yet last).
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
   * densable Cmt+Rmt / official 248 o5+i5 — when set, builds full carry
   * argv (caller extraArgs append after compose).
   */
  toolPermissionContext?: import('../types/permissions.js').ToolPermissionContext
  effort?: unknown
  /**
   * official oyt/OLt: true (default). official `_G`/Ket (Mhr/le): false
   * (`$B` + extra, no TUI switch). Yet still applies either way.
   */
  injectTuiSwitch?: boolean
  /** official Mhr `m` overlay after `$B()` — team + s5(bridge). */
  extraInjectEnv?: Readonly<Record<string, string>>
}): {
  args: string[]
  env: NodeJS.ProcessEnv
  dropEnv: readonly string[]
  injectEnv: Record<string, string>
} {
  const screenReaderEnv = input.screenReaderEnv ?? getScreenReaderChildEnv()
  const injectEnv: Record<string, string> =
    input.injectTuiSwitch === false
      ? { ...screenReaderEnv }
      : buildTuiRelaunchEnv(input.target, screenReaderEnv)
  if (input.extraInjectEnv) {
    Object.assign(injectEnv, input.extraInjectEnv)
  }
  // Official `_G` Yet — always last after extraInjectEnv (not TUI-only).
  // Kro / TUI_JUST_SWITCHED stays gated above; Yet must not.
  try {
    const { buildRelaunchTerminalSizeEnv } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    Object.assign(injectEnv, buildRelaunchTerminalSizeEnv(input.terminalSize))
  } catch {
    // densable optional
  }
  const dropEnv = input.injectTuiSwitch === false ? [] : TUI_RELAUNCH_DROP_ENV
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
 * official Xet @189571454 — sanitize env for process.execve.
 * Skip undefined values; define `__proto__` via Object.defineProperty so it
 * does not pollute Object.prototype. Used by leftover E only (not C).
 */
export function sanitizeEnvForExecve(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (key === '__proto__') {
      Object.defineProperty(out, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Official `_G` C = `spawnSync` — options ONLY `{stdio:"inherit",env,cwd}`.
 * No windowsHide (official does not pass it on this call site).
 * Does NOT call process.exit — caller decides. Destructive; opt-in only.
 */
export function spawnCliRelaunch(input: {
  args: readonly string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
}): RelaunchSpawnResult {
  const launch = buildCliLaunch([...input.args], { env: input.env })
  // official C(o,[...r,...i],{stdio:"inherit",env:s,cwd:m}) — raw spawnSync.
  const result = spawnSync(launch.execPath, launch.args, {
    stdio: 'inherit',
    env: launch.env,
    cwd: input.cwd ?? process.cwd(),
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
 * acceptTuiRelaunch spawn. Same options as official C (`stdio: 'inherit'`,
 * env, cwd). Resolves `{ok:false}` on the `error` event when the process
 * never starts. Resolves `{ok:true}` on the `spawn` event and lets the
 * caller hand off the terminal before awaiting `exited`.
 * relaunchIntoTui stays on spawnSync.
 */
function beginCliRelaunch(input: {
  args: readonly string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
  onSpawned: () => void
}): Promise<
  | { ok: false; error: string }
  | {
      ok: true
      exited: Promise<{
        status: number | null
        signal: NodeJS.Signals | null
      }>
    }
> {
  const launch = buildCliLaunch([...input.args], { env: input.env })
  return new Promise(resolve => {
    let settled = false
    const child = spawn(launch.execPath, launch.args, {
      stdio: 'inherit',
      env: launch.env,
      cwd: input.cwd ?? process.cwd(),
    })
    child.on('error', (err: unknown) => {
      if (settled) return
      settled = true
      const error = err instanceof Error ? err.message : String(err)
      resolve({ ok: false, error })
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      const exited = new Promise<{
        status: number | null
        signal: NodeJS.Signals | null
      }>(resolveExit => {
        child.once('exit', (status, signal) => {
          resolveExit({ status, signal })
        })
      })
      try {
        input.onSpawned()
      } catch {
        /* child is running; handoff errors must not look like a spawn miss */
      }
      resolve({ ok: true, exited })
    })
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

/** Keys `applyTuiRelaunchPlanToProcessEnv` mutates (inject assign + drop delete). */
export function tuiRelaunchProcessEnvMutationKeys(plan: {
  injectEnv: Readonly<Record<string, string>>
  dropEnv: readonly string[]
}): string[] {
  return [...Object.keys(plan.injectEnv), ...plan.dropEnv]
}

/**
 * Snapshot values before apply — leftover returns on spawn fail, so parent
 * must restore (official `_G` exits and does not care).
 */
export function snapshotProcessEnvKeys(
  keys: readonly string[],
  processEnv: NodeJS.ProcessEnv = process.env,
): Map<string, string | undefined> {
  const snap = new Map<string, string | undefined>()
  for (const key of keys) {
    snap.set(key, processEnv[key])
  }
  return snap
}

export function restoreProcessEnvSnapshot(
  snap: ReadonlyMap<string, string | undefined>,
  processEnv: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of snap) {
    if (value === undefined) delete processEnv[key]
    else processEnv[key] = value
  }
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

const RELAUNCH_G_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** official tde — leftover cleanup timeout on leftover `_G`. */
const RELAUNCH_CLEANUP_TIMEOUT_MS = 2000

/**
 * official gKt @189576892 —
 * `let e=Zs(),t=ve();if(e&&dirname(e)===Wa(t))return t;return an()`
 * leftover: sessionFile / originalCwd / getProjectDir / projectRoot.
 */
export function resolveRelaunchCwd(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dirname } = require('path') as typeof import('path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getOriginalCwd, getProjectRoot } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getProjectDir } =
    require('./sessionPaths.js') as typeof import('./sessionPaths.js')
  let sessionFile: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProject } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    sessionFile = getProject().sessionFile
  } catch {
    /* storage optional */
  }
  const originalCwd = getOriginalCwd()
  if (sessionFile && dirname(sessionFile) === getProjectDir(originalCwd)) {
    return originalCwd
  }
  return getProjectRoot()
}

/**
 * official g() @189576965 — leftover Rq/Qbt/svt/EC hosts.
 */
async function runRelaunchGFlush(): Promise<void> {
  const { withTimeout } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sleep.js') as typeof import('./sleep.js')
  const tasks: Promise<unknown>[] = []
  try {
    const { flushDebugLogs } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./debug.js') as typeof import('./debug.js')
    tasks.push(
      withTimeout(
        flushDebugLogs(),
        2000,
        'debug flush timeout (relaunch)',
      ).catch(() => {}),
    )
  } catch {
    tasks.push(Promise.resolve())
  }
  try {
    const { flushDiagLogs } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./diagLogs.js') as typeof import('./diagLogs.js')
    tasks.push(
      withTimeout(flushDiagLogs(), 2000, 'diag flush timeout (relaunch)').catch(
        () => {},
      ),
    )
  } catch {
    tasks.push(Promise.resolve())
  }
  try {
    const { runPreExitFlush } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./cleanupRegistry.js') as typeof import('./cleanupRegistry.js')
    tasks.push(
      withTimeout(
        runPreExitFlush(),
        2000,
        'pre-exit flush timeout (relaunch)',
      ).catch(() => {}),
    )
  } catch {
    tasks.push(Promise.resolve())
  }
  try {
    const { drainStdoutBeforeExit } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./process.js') as typeof import('./process.js')
    tasks.push(
      withTimeout(
        drainStdoutBeforeExit(2000, { scaleBudgetToQueue: false }),
        2000,
        'write queue drain timeout (relaunch)',
      ).catch(() => {}),
    )
  } catch {
    tasks.push(Promise.resolve())
  }
  await Promise.all(tasks)
}

/**
 * official bu @178624609 — chdir then touch cwd (ignore errors).
 */
function chdirForExecve(dir: string): void {
  process.chdir(dir)
  try {
    process.cwd()
  } catch {
    /* official bu swallows */
  }
}

/**
 * official E @189573358 — leftover execve replace.
 * windows / non-absolute cmd → no-op (fall through to C spawnSync).
 * env via Xet; argv = [cmd, ...prefix, ...cli]; cwd via bu chdir+restore.
 */
function tryExecveReplace(
  plan: { args: string[]; env: NodeJS.ProcessEnv },
  cwd?: string,
): void {
  // official B()==="windows" — leftover win32.
  if (process.platform === 'win32') return
  try {
    const { isAbsolute } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('path') as typeof import('path')
    const { buildCliLaunch } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./cliLaunch.js') as typeof import('./cliLaunch.js')
    const launch = buildCliLaunch([...plan.args], { env: plan.env })
    // official A(e) = path.isAbsolute — relative cmd skips execve.
    if (!isAbsolute(launch.execPath)) return
    const execve = (
      process as NodeJS.Process & {
        execve?: (
          file: string,
          argv: readonly string[],
          env: NodeJS.ProcessEnv,
        ) => void
      }
    ).execve
    if (typeof execve !== 'function') return
    let saved: string | undefined
    try {
      if (cwd) {
        saved = process.cwd()
        chdirForExecve(cwd)
      }
      // official E(o,[o,...r,...i],s,m) + Xet(o)
      execve(
        launch.execPath,
        [launch.execPath, ...launch.args],
        sanitizeEnvForExecve(launch.env),
      )
      try {
        const { logForDebugging } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./debug.js') as typeof import('./debug.js')
        logForDebugging(
          `execve(${launch.execPath}) returned \u2014 falling back to spawn`,
          { level: 'warn' },
        )
      } catch {
        /* debug optional */
      }
    } catch (err) {
      try {
        const { logForDebugging } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./debug.js') as typeof import('./debug.js')
        const msg = err instanceof Error ? err.message : String(err)
        logForDebugging(
          `execReplaceProcess: ${msg} \u2014 falling back to spawn`,
          { level: 'warn' },
        )
      } catch {
        /* debug optional */
      }
    } finally {
      if (saved !== undefined) {
        try {
          chdirForExecve(saved)
        } catch {
          /* leftover cwd restore */
        }
      }
    }
  } catch {
    /* official fallback to leftover C spawn */
  }
}

/**
 * Non-destructive relaunch prep — assert wrapper + scroll + session flush.
 * Does NOT claimShutdown / runCleanup / strip signals, and does not print
 * the switching line. Those run only after the child emits `spawn`.
 * Otherwise ENOENT/EACCES would leave callers unable to show UI errors
 * (/tui, /update, gateway login, Fleet setError).
 */
async function runOfficialRelaunchGPrep(): Promise<void> {
  const { assertProcessWrapperRunnableForRelaunch } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./processWrapper.js') as typeof import('./processWrapper.js')
  assertProcessWrapperRunnableForRelaunch()
  try {
    const { emitScrollTelemetrySummary } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./scrollTelemetry.js') as typeof import('./scrollTelemetry.js')
    emitScrollTelemetrySummary()
  } catch {
    /* leftover hPt */
  }
  const { withTimeout } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sleep.js') as typeof import('./sleep.js')
  try {
    const { flushSessionStorage } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    await withTimeout(flushSessionStorage(), 30000, 'flush timeout (relaunch)')
  } catch {
    /* leftover ja .catch */
  }
}

/**
 * Destructive `_G` commit — leftover qje/Nj + mEe/$ie. Only after the child
 * has emitted `spawn`, before the parent waits for exit.
 */
async function runOfficialRelaunchGCommit(): Promise<void> {
  try {
    const { claimShutdown, cleanupTerminalModes } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./gracefulShutdown.js') as typeof import('./gracefulShutdown.js')
    claimShutdown()
    cleanupTerminalModes()
  } catch {
    /* leftover Nj optional */
  }
  const { withTimeout } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sleep.js') as typeof import('./sleep.js')
  try {
    const { runCleanupFunctions } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./cleanupRegistry.js') as typeof import('./cleanupRegistry.js')
    await withTimeout(
      runCleanupFunctions(),
      RELAUNCH_CLEANUP_TIMEOUT_MS,
      'cleanup timeout',
    )
  } catch {
    /* leftover mEe .catch */
  }
  try {
    const { shutdown1PEventLogging } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/firstPartyEventLogger.js') as typeof import('../services/analytics/firstPartyEventLogger.js')
    await withTimeout(shutdown1PEventLogging(), 1000, 'analytics flush timeout')
  } catch {
    /* leftover $ie .catch */
  }
}

/**
 * Official fullscreen-upsell /tui accept densable (`oyt` / leftover `_G`):
 * 1. build OLt plan
 * 2. apply inject/drop to process.env (Ake only)
 * 3. prep (session flush) + optional execve + async spawn
 * 4. spawn error (never started) → restore applied process.env + return
 *    `{ mode:'spawned', spawn }` (leftover UI callers)
 * 5. `spawn` event → strip signals, commit (terminal handoff), preSpawn,
 *    then wait for exit and process.exit(child status)
 * Throws from prep / buildCliLaunch restore process.env via finally.
 *
 * Leftover divergence from official `_G`: official exits on spawn error after
 * teardown; leftover returns so /tui /update gateway Fleet can show errors.
 * Ake/oyt still apply inject/drop before spawn (official order); leftover
 * restores on fail so CLAUDE_CODE_TUI_JUST_SWITCHED / dropped NO_FLICKER do
 * not stick on the live session. Ket/_G (injectTuiSwitch:false) never apply.
 * Invent-ban: no spawn opt-in env gate (oyt always spawns; tests: spawn:false).
 */
export async function acceptTuiRelaunch(input: {
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
  /** densable Cmt+Rmt / official 248 o5+i5 — when set, compose carry argv. */
  toolPermissionContext?: import('../types/permissions.js').ToolPermissionContext
  effort?: unknown
  /** official `_G`/Ket: false — no TUI_JUST_SWITCHED (Mhr/le). */
  injectTuiSwitch?: boolean
  extraInjectEnv?: Readonly<Record<string, string>>
  /**
   * official oyt applies inject to process.env. official Ket/_G does not.
   * Default: true when injectTuiSwitch !== false.
   */
  applyToProcessEnv?: boolean
  /**
   * official `_G`/`Ket` proactivity slot (Mhr/le/Ake). Official `_G`
   * body does not read it — pass-through for 1:1.
   */
  proactivity?: {
    proactivityLevel?: unknown
    toolPermissionContext?: unknown
  }
  /** official `_G` e.preSpawn — leftover Switching / leftover le line. */
  preSpawn?: () => void
}): Promise<AcceptTuiRelaunchResult> {
  void input.proactivity
  const plan = buildTuiRelaunchPlan(input)
  const processEnv = input.env ?? process.env
  const apply = input.applyToProcessEnv ?? input.injectTuiSwitch !== false
  // Snapshot before mutate — leftover spawn-fail returns to the live session.
  const envSnap = apply
    ? snapshotProcessEnvKeys(
        tuiRelaunchProcessEnvMutationKeys(plan),
        processEnv,
      )
    : undefined
  if (apply) {
    applyTuiRelaunchPlanToProcessEnv(plan, processEnv)
  }
  // densable accept → oyt. Tests pass spawn:false to stay on inject_only.
  // Return before the try so inject_only keeps the applied env.
  if (input.spawn === false) {
    return { mode: 'inject_only', plan }
  }

  // Set once the child emits `spawn`. finally restores unless this is set,
  // so prep / buildCliLaunch throws and the error event both roll back
  // Ake/oyt process.env mutations.
  let childStarted = false
  try {
    // Prep only (flush transcript for child). Do NOT claimShutdown / cleanup /
    // strip signals / preSpawn yet — a miss must return to callers for UI.
    await runOfficialRelaunchGPrep()
    const relaunchCwd = input.cwd ?? resolveRelaunchCwd()
    await runRelaunchGFlush()
    tryExecveReplace(plan, relaunchCwd)
    const spawn = await beginCliRelaunch({
      args: plan.args,
      env: plan.env,
      cwd: relaunchCwd,
      onSpawned() {
        childStarted = true
        // Child is in this process group. Swallow parent shutdown signals
        // for the rest of its life so Ctrl+C hits the child, not us.
        for (const sig of RELAUNCH_G_SIGNALS) {
          process.removeAllListeners(sig)
          process.on(sig, () => {})
        }
      },
    })
    if (!spawn.ok) {
      try {
        const { logEvent } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/analytics/index.js') as typeof import('../services/analytics/index.js')
        logEvent('relaunch_spawn_error', {})
      } catch {
        /* leftover pp */
      }
      // Leftover contract (vs official `_G` exit-on-spawn-error): return so
      // /tui, /update, gateway login, Fleet setError can keep the session and
      // show their failure copy. Session was not torn down; finally restores
      // process.env so Ake/oyt fail does not leave TUI_JUST_SWITCHED or drop
      // NO_FLICKER on the parent.
      return { mode: 'spawned', plan, spawn }
    }
    childStarted = true
    try {
      // Child is running. Hand off the terminal before it paints, then
      // announce (preSpawn) and wait for its exit.
      await runOfficialRelaunchGCommit()
      input.preSpawn?.()
      await runRelaunchGFlush()
      process.removeAllListeners('beforeExit')
      process.removeAllListeners('exit')
      if (input.skipFlush !== true) {
        flushStreamsBeforeRelaunchExit()
      }
    } catch {
      /* child already owns the terminal; still exit with its status */
    }
    const exited = await spawn.exited
    process.exit(exited.status ?? (exited.signal ? 1 : 0))
    return {
      mode: 'spawned',
      plan,
      spawn: { ok: true, status: exited.status, signal: exited.signal },
    }
  } finally {
    if (!childStarted && envSnap) {
      restoreProcessEnvSnapshot(envSnap, processEnv)
    }
  }
}
