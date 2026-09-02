/**
 * densable 2.1.212 xSe / Uq_ / e6_ client spawn shell.
 *
 * extract: docs/upstream-extraction/v2.1.212/xSe_JFa.extract.md
 *          docs/upstream-extraction/v2.1.212/Uq_.raw.js
 *
 * Ceremony: e6_ gate → mkdir jobDir/tmp → Uq_ peel (argv) → seed (non fleet/
 * spare) → isa(dispatch) → ack-timeout/enoconn/estarting rescue.
 */

import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tryProcessCwd } from '../utils/cachePaths.js'
import { getGlobalConfig } from '../utils/config.js'
import { errorMessage } from '../utils/errors.js'
import {
  getJobDirPath,
  readBgJobState,
  writeBgJobState,
  type BgJobState,
} from './jobState.js'
import {
  PROTO_VERSION,
  shellExecSpec,
  type DispatchRequest,
} from './bgWorker.js'
import {
  CLOUD_BG_CONFLICT,
  collectUncWarnPaths,
  doubleDashIndex,
  filterAllowlistedRespawnFlags,
  hasCloudRemoteFlags,
  peelShortFlags,
  peelUqArgv,
  readFlagValue,
  valueIndexSet,
} from './uqArgvPeel.js'

export type XSeSource = 'shell' | 'repl' | 'fleet' | 'spare' | string

export type XSeResult =
  | {
      ok: true
      short: string
      sessionId: string
      idle?: boolean
      name?: string
      rescued?: boolean
    }
  | {
      ok: false
      error: string
      reason: string
      short?: string
      alive?: boolean
    }

export type XSeOpts = {
  intent: string
  name?: string
  agent?: string
  routine?: string
  exec?: string
  cwd?: string
  extraArgs?: string[]
  /** densable argv for e6_ gate (shell path). Empty/undefined → no gate. */
  argv?: string[]
  source?: XSeSource
  sessionId?: string
  resumeSessionId?: string
  forkSession?: boolean
  providedSessionId?: string
  isolation?: 'worktree' | 'none'
  worktree?: { path: string }
  env?: Record<string, string>
  reattachEnv?: Record<string, string>
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  memoryToggledOff?: boolean
  /**
   * densable n.bgIsolation — "default" means omit; repl forces "none".
   */
  bgIsolation?: 'none' | 'worktree' | 'default'
  /** densable timeout for isa / await-ack (ms). */
  ackTimeoutMs?: number
}

/**
 * densable e6_ — cloud/remote conflict, --print, bypass without disclaimer,
 * auto without opt-in. Uses densable yie value-index so flag values are not
 * mistaken for flags.
 */
export function gateBgSpawnArgs(argv: readonly string[]): string | null {
  const t = doubleDashIndex(argv)
  const r = t >= 0 ? argv.slice(0, t) : [...argv]
  const n = valueIndexSet(r)
  const o = r.filter((_, a) => !n.has(a))
  if (hasCloudRemoteFlags(o)) return CLOUD_BG_CONFLICT
  if (
    o.some(s => {
      const { peeled: a, rest: l } = peelShortFlags(s)
      return (
        s === '--print' ||
        s.startsWith('--print=') ||
        a.includes('-p') ||
        l === '-p'
      )
    })
  ) {
    return (
      '--bg and --print conflict: --print never starts the interactive session ' +
      'that `claude agents` attaches to, so the job would be unattachable. ' +
      "The prompt is the positional — drop --print: `claude --bg '<task>'`."
    )
  }
  const i = readFlagValue(r, '--permission-mode')
  const hasBypass =
    i === 'bypassPermissions' ||
    o.includes('--dangerously-skip-permissions') ||
    o.includes('--allow-dangerously-skip-permissions')
  if (hasBypass) {
    try {
      if (!getGlobalConfig().bypassPermissionsModeAccepted) {
        return (
          '--bg with bypassPermissions requires accepting the disclaimer first. ' +
          'Run `claude --dangerously-skip-permissions` once interactively.'
        )
      }
    } catch {
      return (
        '--bg with bypassPermissions requires accepting the disclaimer first. ' +
        'Run `claude --dangerously-skip-permissions` once interactively.'
      )
    }
  }
  if (i === 'auto') {
    let opted = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const am = require('../utils/permissions/autoModeState.js') as {
        getAutoModeFlagCli?: () => boolean
      }
      opted = am.getAutoModeFlagCli?.() === true
    } catch {
      opted = false
    }
    if (!opted) {
      return (
        '--bg with auto mode requires opting in first. ' +
        'Run `claude --permission-mode auto` once interactively.'
      )
    }
  }
  return null
}

function deriveSessionName(intent: string): string {
  const words = intent
    .trim()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'new session'
  const name = words.slice(0, 4).join(' ')
  return name.length > 30 ? name.slice(0, 29) + '…' : name
}

/**
 * densable Uq_ client seed (non fleet/spare).
 * Daemon also seeds on handleDispatch; client seed makes Fleet list immediate.
 */
export function seedJobStateClient(
  req: DispatchRequest,
  opts: { freshDir: boolean; skipSeed: boolean },
): void {
  if (opts.skipSeed) return
  const jobDir = getJobDirPath(req.short)
  try {
    // mkdir parent handled by caller (tmp); ensure job dir exists
    mkdirSync(jobDir, { recursive: true })
  } catch {
    // ignore
  }
  const now = new Date().toISOString()
  const existing = opts.freshDir ? null : readBgJobState(req.short)
  if (existing === null) {
    const state: BgJobState = {
      state: 'starting',
      detail: 'starting…',
      tempo: 'active',
      output: null,
      children: null,
      linkScanOffset: 0,
      template: req.agent ?? req.routine ?? 'bg',
      routine: req.routine,
      // densable seed uses qat(D); dispatch payload keeps n2o(w)
      respawnFlags: filterAllowlistedRespawnFlags(req.respawnFlags ?? []),
      intent: req.intent ?? req.seed?.intent ?? '',
      name: req.name ?? req.seed?.name,
      sessionId: req.sessionId,
      resumeSessionId: req.sessionId,
      daemonShort: req.short,
      cwd: req.cwd,
      originCwd: req.cwd,
      worktreePath: req.worktree?.path,
      createdAt: now,
      updatedAt: now,
      firstTerminalAt: null,
    }
    writeBgJobState(req.short, state)
    return
  }
  const flags = filterAllowlistedRespawnFlags(req.respawnFlags ?? [])
  if (flags.length > 0 && existing.respawnFlags.length === 0) {
    writeBgJobState(req.short, {
      ...existing,
      respawnFlags: flags,
      sessionId: req.sessionId,
      resumeSessionId:
        req.launch.mode === 'resume'
          ? req.sessionId
          : (existing.resumeSessionId ?? req.sessionId),
      daemonShort: req.short,
      updatedAt: now,
    })
  }
}

/**
 * densable Uq_ peel + launch build.
 * When `opts.argv` present, peel agent/name/resume/intent/respawnFlags/session-id
 * warn/UNC warn 1:1 with densable helpers.
 */
function buildDispatchRequest(opts: XSeOpts): {
  dispatch: DispatchRequest
  short: string
  sessionId: string
  derivedName: string | undefined
  freshDir: boolean
  idle?: boolean
} {
  const source = opts.source || 'fleet'
  const argv = opts.argv ?? []
  const peeled = argv.length > 0 ? peelUqArgv(argv) : null

  // densable: resume id from peel (WLp) wins when present; else opts
  const resumeFromPeel = peeled?.resumeSessionId
  const resumeSessionId = resumeFromPeel ?? opts.resumeSessionId
  const agent = peeled?.agent ?? opts.agent
  const nameFromPeel = peeled?.name
  const intentFromPeel = peeled?.intent
  const G = opts.exec?.trim()
    ? opts.exec.trim()
    : opts.intent || intentFromPeel || ''

  const sessionId = opts.providedSessionId ?? opts.sessionId ?? randomUUID()
  const short = sessionId.slice(0, 8)
  const freshDir =
    opts.sessionId === undefined && opts.providedSessionId === undefined

  // densable j: resume id === managed session id → no --session-id injection
  const j = resumeSessionId !== undefined && resumeSessionId === sessionId
  // densable S = continue/resume present; E = --fork-session present
  const S = peeled?.hasResumeOrContinue ?? Boolean(resumeSessionId)
  const E = peeled?.hasForkSession === true || opts.forkSession === true
  // densable B = S&&!E ? ["--fork-session"] : []
  const B = S && !E ? (['--fork-session'] as string[]) : []
  // densable W = j?[]:["--session-id",s,...B]
  const W = j ? [] : (['--session-id', sessionId, ...B] as string[])

  // densable shell session-id warn
  if (source === 'shell' && peeled?.hadSessionIdFlag) {
    process.stderr.write(
      'warning: --bg manages the session id; ignoring --session-id (use --resume <id> to continue an existing session)\n',
    )
  }

  // densable shell UNC warn
  if (source === 'shell') {
    const unc = collectUncWarnPaths({
      cwd: opts.cwd,
      exec: opts.exec,
      resumeSessionId,
      respawnFlags: peeled?.respawnFlags ?? opts.extraArgs ?? [],
    })
    if (unc.length > 0) {
      process.stderr.write(
        `warning: background sessions do not support Windows network (UNC) paths; the following will be neutralized: ${unc.join(', ')}\n`,
      )
    }
  }

  // densable agent unknown warn (shell only) — skip full agent catalog load if absent
  if (source === 'shell' && agent) {
    // portable: no densable Qj agent catalog here; warn only when env forces
    if (process.env.CLAUDE_BG_WARN_UNKNOWN_AGENT === '1') {
      process.stderr.write(
        `warning: no agent named '${agent}' — spawning with default template\n`,
      )
    }
  }

  const derivedName =
    nameFromPeel ??
    opts.name ??
    (opts.exec?.trim()
      ? opts.exec.trim().slice(0, 40)
      : G.trim()
        ? deriveSessionName(G)
        : undefined)

  // densable idle: !initialPrompt && !exec && !intent && !--reply-on-resume
  const hasReplyOnResume =
    peeled?.head.some(
      (ae, se) => !peeled.valueIdx.has(se) && ae === '--reply-on-resume',
    ) === true
  const idle = !opts.exec && !G && !hasReplyOnResume

  const inheritEnv: Record<string, string> = {}
  if (opts.sessionPermissionRules) {
    inheritEnv.CLAUDE_BG_SESSION_PERMISSION_RULES = JSON.stringify(
      opts.sessionPermissionRules,
    )
  }
  if (opts.memoryToggledOff) {
    inheritEnv.CLAUDE_BG_MEMORY_TOGGLED_OFF = '1'
  }
  let bgIsolation: 'none' | 'worktree' | undefined
  if (opts.bgIsolation === 'none' || opts.bgIsolation === 'worktree') {
    bgIsolation = opts.bgIsolation
  } else if (opts.bgIsolation === 'default') {
    bgIsolation = undefined
  }
  if (source === 'repl' && bgIsolation === undefined) {
    bgIsolation = 'none'
  }
  if (bgIsolation) {
    inheritEnv.CLAUDE_BG_ISOLATION = bgIsolation
  }

  const env = {
    ...inheritEnv,
    ...(opts.env ?? {}),
    ...(opts.reattachEnv ?? {}),
  }

  // densable w = n2o(head); dispatch.respawnFlags = w; seed filters via qat
  const respawnFlagsField = peeled?.respawnFlags ?? opts.extraArgs ?? []
  // densable GLp(e) for prompt args after session-id strip
  const GLpArgs = peeled?.promptArgs ?? []

  let launch: DispatchRequest['launch']
  if (opts.exec !== undefined && opts.exec.trim()) {
    const spec = shellExecSpec(opts.exec.trim())
    launch = { mode: 'exec', cmd: spec.cmd, args: spec.args }
  } else if (S && resumeSessionId !== undefined) {
    // densable: resume mode when S && y
    launch = {
      mode: 'resume',
      sessionId: resumeSessionId,
      // densable: fork:!j&&(E||B.length>0)
      fork: !j && (E || B.length > 0),
      flagArgs: [
        ...respawnFlagsField,
        ...(peeled && peeled.dd >= 0 ? argv.slice(peeled.dd) : []),
      ],
    }
  } else {
    // densable: mode prompt args = [...W, ...GLp(e)]; no-argv opts path keeps name/agent/extra
    launch = {
      mode: 'prompt',
      sessionId,
      args: peeled
        ? [...W, ...GLpArgs]
        : [
            ...W,
            ...(derivedName ? ['-n', derivedName] : []),
            ...(agent ? ['--agent', agent] : []),
            ...(opts.extraArgs || []),
          ],
    }
  }

  const nonce = randomUUID().slice(0, 8)
  const dispatch: DispatchRequest = {
    short,
    sessionId,
    nonce,
    intent: G,
    name: derivedName,
    agent,
    routine: opts.routine,
    cwd: opts.cwd || tryProcessCwd(),
    // densable X.respawnFlags = w (n2o)
    respawnFlags: respawnFlagsField,
    source,
    createdAt: Date.now(),
    seed: {
      intent: G,
      name: derivedName,
    },
    isolation: opts.isolation,
    worktree: opts.worktree,
    env: Object.keys(env).length > 0 ? env : undefined,
    reattachEnv:
      Object.keys(opts.reattachEnv ?? {}).length > 0
        ? opts.reattachEnv
        : undefined,
    launch,
  }

  return { dispatch, short, sessionId, derivedName, freshDir, idle }
}

type ListJob = {
  short?: string
  nonce?: string
  outcome?: unknown
}

/**
 * densable xSe → Uq_ shell.
 * Returns result object (does not throw) — submitDispatch maps to throw.
 */
export async function xSeSpawn(opts: XSeOpts): Promise<XSeResult> {
  const source = opts.source || 'fleet'
  const argv = opts.argv ?? []
  if (argv.length > 0) {
    const gate = gateBgSpawnArgs(argv)
    if (gate) {
      return { ok: false, error: gate, reason: 'gate_blocked' }
    }
  }

  const { dispatch, short, sessionId, derivedName, freshDir, idle } =
    buildDispatchRequest(opts)
  const jobDir = getJobDirPath(short)

  try {
    await mkdir(join(jobDir, 'tmp'), { recursive: true })
  } catch (d) {
    if (source !== 'fleet' && source !== 'spare') {
      await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    }
    return {
      ok: false,
      error: `Couldn't start the session — ${errorMessage(d)}`,
      reason: 'spawn_failed_mkdir',
      short,
    }
  }

  const skipSeed = source === 'fleet' || source === 'spare'
  let seededFresh = false
  try {
    if (!skipSeed) {
      const before = readBgJobState(short)
      seedJobStateClient(dispatch, {
        freshDir: freshDir || before === null,
        skipSeed: false,
      })
      seededFresh = before === null
    }
  } catch {
    // densable logs warn; continue to isa
  }

  // densable isa(X)
  const { sendControlRequest } = await import('./controlSocketClient.js')
  const DISPATCH_ACK_TIMEOUT_MS = opts.ackTimeoutMs ?? 15_000
  const resp = await sendControlRequest(
    {
      op: 'dispatch',
      proto: PROTO_VERSION,
      d: dispatch,
      timeoutMs: DISPATCH_ACK_TIMEOUT_MS,
    },
    { timeoutMs: DISPATCH_ACK_TIMEOUT_MS },
  )

  if (resp.ok) {
    const settled = resp.settled
    if (
      typeof settled === 'string' &&
      (settled === 'crashed' || settled === 'failed' || settled === 'killed')
    ) {
      if (seededFresh) {
        await rm(jobDir, { recursive: true, force: true }).catch(() => {})
      }
      return {
        ok: false,
        short,
        error: `Background dispatch settled immediately (${settled})${
          typeof resp.error === 'string' && resp.error ? `: ${resp.error}` : ''
        }`,
        reason: 'settled',
      }
    }
    return {
      ok: true,
      short,
      sessionId,
      name: derivedName,
      idle,
    }
  }

  const code =
    typeof resp.code === 'string' ? resp.code.toUpperCase() : undefined
  const reasonRaw =
    typeof resp.reason === 'string'
      ? resp.reason
      : typeof resp.error === 'string'
        ? resp.error
        : undefined
  const reasonNorm = reasonRaw?.toLowerCase().replace(/_/g, '-') ?? ''

  // densable short-alive
  if (
    code === 'EALIVE' ||
    reasonNorm === 'short-alive' ||
    resp.alive === true
  ) {
    return {
      ok: false,
      alive: true,
      short,
      error:
        typeof resp.error === 'string' && resp.error
          ? resp.error
          : `Session ${short} is already running — \`claude attach ${short}\` to join it`,
      reason: 'short_alive',
    }
  }

  if (code === 'ESTALE' || reasonNorm === 'stale-short') {
    return {
      ok: false,
      short,
      error:
        typeof resp.error === 'string' && resp.error
          ? resp.error
          : 'Previous session is still shutting down — try again in a moment',
      reason: 'stale_short',
    }
  }

  // densable rescue: ack-timeout | enoconn | estarting
  const rescueReason =
    resp.timeout === true || code === 'ETIMEOUT' || reasonNorm === 'ack-timeout'
      ? 'ack-timeout'
      : code === 'ENOCONN' || reasonNorm === 'enoconn'
        ? 'enoconn'
        : code === 'ESTARTING' || reasonNorm === 'estarting'
          ? 'estarting'
          : null

  if (rescueReason) {
    const list = await sendControlRequest(
      { proto: PROTO_VERSION, op: 'list' },
      { timeoutMs: 5000 },
    )
    if (list.ok && list.op === 'list' && Array.isArray(list.jobs)) {
      const jobs = list.jobs as ListJob[]
      const live = jobs.some(
        se => se.short === short && se.nonce === dispatch.nonce && !se.outcome,
      )
      if (live) {
        return {
          ok: true,
          short,
          sessionId,
          name: derivedName,
          idle,
          rescued: true,
        }
      }
      // densable: ack-timeout + short missing → redispatch same nonce
      if (
        rescueReason === 'ack-timeout' &&
        !jobs.some(se => se.short === short)
      ) {
        const se = await sendControlRequest(
          {
            proto: PROTO_VERSION,
            op: 'dispatch',
            d: dispatch,
            timeoutMs: 5000,
          },
          { timeoutMs: 6000 },
        )
        if (se.ok && se.op === 'dispatch') {
          return {
            ok: true,
            short,
            sessionId,
            name: derivedName,
            idle,
            rescued: true,
          }
        }
      }
    }

    // densable hard fail after rescue attempts
    if (rescueReason === 'ack-timeout') {
      if (seededFresh) {
        await rm(jobDir, { recursive: true, force: true }).catch(() => {})
      }
      return {
        ok: false,
        short,
        error:
          typeof resp.error === 'string' && resp.error
            ? resp.error
            : 'Background dispatch worker ack timeout',
        reason: 'ack_timeout',
      }
    }
  }

  // ENOCONN / daemon offline → file fallback (densable also has dispatch-write)
  if (
    code === 'ENOCONN' ||
    reasonNorm === 'daemon-unreachable' ||
    reasonNorm.includes('offline') ||
    !resp.ok
  ) {
    try {
      const { getDispatchDir } = await import('./bgWorker.js')
      const dispatchDir = getDispatchDir()
      await mkdir(dispatchDir, { recursive: true }).catch(() => {})
      const { writeFile } = await import('fs/promises')
      await writeFile(
        join(dispatchDir, `${short}.json`),
        JSON.stringify(dispatch),
      )
      return { ok: true, short, sessionId, name: derivedName }
    } catch (d) {
      if (seededFresh) {
        await rm(jobDir, { recursive: true, force: true }).catch(() => {})
      }
      return {
        ok: false,
        short,
        error: `Couldn't start the session — ${errorMessage(d)}`,
        reason: 'dispatch_write',
      }
    }
  }

  if (seededFresh) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
  }
  return {
    ok: false,
    short,
    error:
      typeof resp.error === 'string' && resp.error
        ? resp.error
        : 'Could not dispatch background session',
    reason: reasonNorm || 'spawn_failed',
  }
}
