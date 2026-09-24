import { feature } from 'bun:bundle'
import { readdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { logEventAsync } from '../services/analytics/index.js'
import { getDispatcherAccountFromOauthToken } from '../utils/auth.js'
import { dispatcherReattachEnv } from '../utils/bgDispatcherAccount.js'
import { tryProcessCwd } from '../utils/cachePaths.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import { jsonParse } from '../utils/slowOperations.js'
import { selectEngine } from './bg/engines/index.js'
import type { SessionEntry } from './bg/engine.js'
import {
  formatBgHints,
  shouldOpenAgentsViewOnDetach,
  stripBgFlags,
  type DetachAttachResult,
} from './bg/helpers.js'
import { formatClaudeLogsReplay } from './bg/logsReplay.js'
import {
  sanitizeDaemonControlError,
  subscribeJobStreamTail,
} from './bg/logsSubscribe.js'
import { backgroundServiceLabel } from '../bridge/remoteControlServers.js'

export type { SessionEntry } from './bg/engine.js'

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

export async function listLiveSessions(): Promise<SessionEntry[]> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const sessions: SessionEntry[] = []
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)

    if (!isProcessRunning(pid)) {
      void unlink(join(dir, file)).catch(() => {})
      continue
    }

    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const entry = jsonParse(raw) as SessionEntry
      sessions.push(entry)
    } catch {
      // Corrupt file — skip
    }
  }

  return sessions
}

export function findSession(
  sessions: SessionEntry[],
  target: string,
): SessionEntry | undefined {
  const asNum = parseInt(target, 10)
  return sessions.find(
    s =>
      s.sessionId === target ||
      s.pid === asNum ||
      (s.name && s.name === target),
  )
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

/**
 * Resolve the engine type for an existing session.
 * Backward-compatible: sessions without an `engine` field are inferred
 * from the presence of `tmuxSessionName`.
 */
function resolveSessionEngine(session: SessionEntry): 'tmux' | 'detached' {
  if (session.engine) return session.engine
  return session.tmuxSessionName ? 'tmux' : 'detached'
}

/**
 * `claude daemon status` / `claude ps` — list live sessions.
 */
export async function psHandler(_args: string[]): Promise<void> {
  const sessions = await listLiveSessions()

  if (sessions.length === 0) {
    console.log('No active sessions.')
    return
  }

  console.log(
    `${sessions.length} active session${sessions.length > 1 ? 's' : ''}:\n`,
  )

  for (const s of sessions) {
    const engineType = resolveSessionEngine(s)
    const parts: string[] = [
      `  PID: ${s.pid}`,
      `  Kind: ${s.kind}`,
      `  Engine: ${engineType}`,
      `  Session: ${s.sessionId}`,
      `  CWD: ${s.cwd}`,
    ]

    if (s.name) parts.push(`  Name: ${s.name}`)
    if (s.startedAt) parts.push(`  Started: ${formatTime(s.startedAt)}`)
    if (s.status) parts.push(`  Status: ${s.status}`)
    if (s.waitingFor) parts.push(`  Waiting for: ${s.waitingFor}`)
    if (s.bridgeSessionId) parts.push(`  Bridge: ${s.bridgeSessionId}`)
    if (s.tmuxSessionName) parts.push(`  Tmux: ${s.tmuxSessionName}`)
    if (s.logPath) parts.push(`  Log: ${s.logPath}`)

    console.log(parts.join('\n'))
    console.log()
  }
}

const CLI_BG_LOGS =
  'cli_bg_logs' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
const CLI_BG_LOGS_READ_FAILED =
  'read_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
const CLI_BG_RESPAWN =
  'cli_bg_respawn' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

const LOGS_USAGE = 'claude logs <id>'
const LOGS_DESCRIPTION =
  "Print the background session's recent terminal output."

/** Gold `ov` @187616399 sha=0bd2593aeb86dc1f — flushed stdout write. */
async function writeStdoutFlushed(text: string): Promise<void> {
  await new Promise<void>(resolve => {
    process.stdout.write(text, () => resolve())
  })
}

/**
 * Gold `Ype` @187616616 + `Pi` @187616733 sha=008b1b49d3a37fd4.
 * Ype is flushAnalyticsSinks (local leftover: 1P shutdown). Nj is
 * generic shutdown, not a logs-exit caller — do not invent mode reset.
 */
async function exitAfterAnalyticsFlush(code: number): Promise<void> {
  try {
    const { shutdown1PEventLogging } = await import(
      '../services/analytics/firstPartyEventLogger.js'
    )
    await shutdown1PEventLogging()
  } catch {
    // gold Ype swallows flush errors
  }
  process.exit(code)
}

/**
 * Gold `dn` @189641683 sha=3e886fec3a355447 — resolve 8-hex job prefix.
 * Disk list is `sn(iS())`; storageV5 `bqt` is unlanded (no listJobIdsV5).
 */
async function resolveLogsJobId(target: string | undefined): Promise<string> {
  if (target === '--help' || target === '-h') {
    process.stdout.write(`Usage: ${LOGS_USAGE}\n\n  ${LOGS_DESCRIPTION}\n`)
    process.exit(0)
  }
  if (target?.startsWith('-')) {
    process.stderr.write(`unknown option '${target}'\nUsage: ${LOGS_USAGE}\n`)
    process.exit(1)
  }
  if (!target) {
    process.stderr.write(`Usage: ${LOGS_USAGE}\n`)
    process.exit(1)
  }

  const { resolveJobShortByPrefix } = await import('../daemon/deleteJob.js')
  const resolved = await resolveJobShortByPrefix(target)
  if (resolved.ok) return resolved.short
  process.stderr.write(
    resolved.kind === 'none'
      ? `No job matching '${target}'. Run 'claude agents' to list running sessions.\n`
      : `Ambiguous prefix '${target}', matches: ${resolved.matches.join(', ')}\n`,
  )
  process.exit(1)
}

/**
 * Official `claude logs <id>` — densable `Pmr` @189642272 sha=90e236fb25f3e1ac
 * (export `Pmr as logsHandler`). Replay streamTail via `tr`, write via `ov`,
 * exit via `Pi(0)`.
 */
export async function logsHandler(
  target: string | undefined,
  _storageV5?: unknown,
): Promise<void> {
  const short = await resolveLogsJobId(target)
  const streamTail = await new Promise<string[] | string>(resolve => {
    const unsub = subscribeJobStreamTail(
      short,
      500,
      msg => {
        if (msg.type === 'snapshot') {
          unsub()
          const tail = msg.streamTail
          resolve(
            Array.isArray(tail)
              ? tail.map(line => (typeof line === 'string' ? line : ''))
              : [],
          )
        }
      },
      err => {
        unsub()
        resolve(err)
      },
    )
  })

  if (typeof streamTail === 'string') {
    await logEventAsync('tengu_feature_bad', {
      feature_name: CLI_BG_LOGS,
      error_code: CLI_BG_LOGS_READ_FAILED,
    })
    process.stderr.write(
      `Couldn't read logs for ${short} \u2014 ${sanitizeDaemonControlError(streamTail)}\n`,
    )
    return await exitAfterAnalyticsFlush(1)
  }

  const rows = process.stdout.rows || 9999
  await writeStdoutFlushed(
    formatClaudeLogsReplay(streamTail, process.stdout.isTTY === true, rows),
  )
  await logEventAsync('tengu_feature_ok', { feature_name: CLI_BG_LOGS })
  return await exitAfterAnalyticsFlush(0)
}

/**
 * `claude daemon attach <target>` — attach to a background session.
 *
 * Engine-aware: tmux sessions use tmux attach, detached sessions use log tail.
 */
export async function attachHandler(target: string | undefined): Promise<void> {
  const sessions = await listLiveSessions()

  if (!target) {
    // Find bg sessions (tmux or detached)
    const bgSessions = sessions.filter(
      s => s.tmuxSessionName || s.engine === 'detached',
    )
    if (bgSessions.length === 0) {
      console.log(
        'No background sessions to attach to. Start one with `claude daemon bg`.',
      )
      return
    }
    if (bgSessions.length === 1) {
      target = bgSessions[0]!.sessionId
    } else {
      console.log('Multiple background sessions. Specify one:')
      for (const s of bgSessions) {
        const label = s.name ? `${s.name} (${s.sessionId})` : s.sessionId
        const engineType = resolveSessionEngine(s)
        console.log(`  ${label}  PID=${s.pid}  engine=${engineType}`)
      }
      return
    }
  }

  const session = findSession(sessions, target)
  if (!session) {
    console.error(`Session not found: ${target}`)
    process.exitCode = 1
    return
  }

  const engineType = resolveSessionEngine(session)

  try {
    let attachResult: DetachAttachResult | undefined
    if (engineType === 'tmux') {
      const { TmuxEngine } = await import('./bg/engines/tmux.js')
      const tmux = new TmuxEngine()
      if (!(await tmux.available())) {
        console.error(
          'tmux is no longer available. Cannot attach to tmux session.',
        )
        process.exitCode = 1
        return
      }
      attachResult = await tmux.attach(session)
    } else {
      const { DetachedEngine } = await import('./bg/engines/detached.js')
      const detached = new DetachedEngine()
      attachResult = await detached.attach(session)
    }

    // Official GCp: after interactive APC/log-tail detach, open AgentsView with
    // CLAUDE_AGENTS_SELECT so the detached session is pre-selected.
    if (
      attachResult &&
      shouldOpenAgentsViewOnDetach(
        attachResult,
        process.stdout.isTTY === true,
        process.stdin.isTTY === true,
      )
    ) {
      process.env.CLAUDE_AGENTS_SELECT = session.sessionId
      const { agentsMain } = await import('./agents.js')
      await agentsMain([])
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
}

/**
 * `claude daemon kill <target>` — kill a session.
 */
export async function killHandler(target: string | undefined): Promise<void> {
  const sessions = await listLiveSessions()

  if (!target) {
    if (sessions.length === 0) {
      console.log('No active sessions to kill.')
      return
    }
    console.log('Specify a session to kill:')
    for (const s of sessions) {
      const label = s.name ? `${s.name} (${s.sessionId})` : s.sessionId
      console.log(`  ${label}  PID=${s.pid}`)
    }
    return
  }

  const session = findSession(sessions, target)
  if (!session) {
    console.error(`Session not found: ${target}`)
    process.exitCode = 1
    return
  }

  console.log(`Killing session ${session.sessionId} (PID: ${session.pid})...`)

  try {
    process.kill(session.pid, 'SIGTERM')
  } catch {
    console.log('Session already exited.')
    return
  }

  await new Promise(resolve => setTimeout(resolve, 2000))

  if (isProcessRunning(session.pid)) {
    try {
      process.kill(session.pid, 'SIGKILL')
      console.log('Session force-killed.')
    } catch {
      console.log('Session exited during grace period.')
    }
  } else {
    console.log('Session stopped.')
  }

  const pidFile = join(getSessionsDir(), `${session.pid}.json`)
  void unlink(pidFile).catch(() => {})
}

/**
 * densable gJ_ — `claude rm <id>` / `claude daemon rm <id>`.
 * Delete a background job + worktree via C2e (deleteJob), not bare removeJob.
 */
export async function rmHandler(target: string | undefined): Promise<void> {
  if (target === '--help' || target === '-h') {
    process.stdout.write(
      `Usage: claude rm <id>\n\n  Delete a background session and its worktree. Unlike \`stop\`, works on already-exited sessions.\n`,
    )
    process.exitCode = 0
    return
  }
  if (target?.startsWith('-')) {
    process.stderr.write(`unknown option '${target}'\nUsage: claude rm <id>\n`)
    process.exitCode = 1
    return
  }
  if (!target) {
    process.stderr.write(`Usage: claude rm <id>\n`)
    process.exitCode = 1
    return
  }

  const { resolveJobShortByPrefix, deleteJob, formatKeptWorktreeReason } =
    await import('../daemon/deleteJob.js')
  const { readBgJobState } = await import('../daemon/jobState.js')

  const resolved = await resolveJobShortByPrefix(target)
  if (!resolved.ok) {
    if (resolved.kind === 'none') {
      process.stderr.write(`No job matching '${target}'\n`)
    } else {
      process.stderr.write(
        `Ambiguous prefix '${target}', matches: ${resolved.matches.join(', ')}\n`,
      )
    }
    process.exitCode = 1
    return
  }

  const short = resolved.short
  const state = readBgJobState(short)
  const result = await deleteJob(short)

  if (!result.removed) {
    if (result.keptWorktree) {
      // densable: kept ${n} — worktree ${Kjo(c,u)}
      const followUp =
        result.keptReason === 'unverified' ||
        result.keptReason === 'shared_record'
          ? `if you don't need its contents, remove the directory, then run 'claude rm ${short}' again.`
          : result.keptReason === 'identity_changed'
            ? `retry the delete (the directory's resolution changed while it was being verified), then run 'claude rm ${short}' again if it recurs.`
            : result.keptReason === 'records_unreadable'
              ? `retry once sibling records are readable (see ~/.claude/jobs), then run 'claude rm ${short}' again.`
              : result.keptReason === 'occupied'
                ? `exit the Claude Code session using that directory (shown above; or 'claude stop <id>' if it is a background session), then run 'claude rm ${short}' again.`
                : result.keptReason === 'in_use' ||
                    result.keptReason === 'live_lock'
                  ? `wait for that session to finish (or stop it), then run 'claude rm ${short}' again.`
                  : `resolve that (commit/push, or remove the worktree), then run 'claude rm ${short}' again.`
      process.stdout.write(
        `kept ${short} \u2014 worktree ${formatKeptWorktreeReason(result.keptReason, result.keptErrorSummary)}\n  worktree kept at ${result.keptWorktree}\n  ${followUp}\n`,
      )
      process.exitCode = 1
      return
    }
    process.stderr.write(
      `couldn't remove ${short} \u2014 ${result.error ?? 'the background service may be restarting. Try again in a moment.'}\n`,
    )
    process.exitCode = 1
    return
  }

  // densable success: removed ${n} [+ worktree left / worktree path]
  let msg = `removed ${short}`
  if (result.leftWorktreeDir) {
    msg += `\n  worktree directory left at ${result.leftWorktreeDir} (git no longer recognized it)`
  } else if (state?.worktreePath) {
    msg += `\n  worktree: ${state.worktreePath}`
  }
  process.stdout.write(`${msg}\n`)
}

/**
 * densable f6e @185027644 (gold-e #41, sibling of gP sha=a2f4140d2c371f17).
 * Gold: `if (e === undefined) return false` then G5/Xpe then true.
 * G5/Xpe kind-allowlist bodies are ABSENT — do not invent.
 * Local nullish / non-function = no host (query_setup uses `?? null`).
 */
export function f6e(requestDialog: unknown): boolean {
  if (requestDialog == null) return false
  return typeof requestDialog === 'function'
}

/**
 * densable gP @185027702 sha=a2f4140d2c371f17 — `lp(e)&&!cjt(Xe(e))&&Gce()&&f6e(t)`.
 * lp/cjt/Xe/Gce stay in leftover fableConsent; this leftover only adds f6e(t).
 * Caller is `if (gP(zr, ct.requestDialog))`. --bg never arms a host, so gP
 * is false: no fable credit prompt, no abort.
 */
export function gP(_model: unknown, requestDialog: unknown): boolean {
  return f6e(requestDialog)
}

/**
 * `claude daemon bg [args]` / `claude --bg …` — start a background session.
 *
 * densable path: e6_ gate → xSe/Uq_ (daemon dispatch) when BG_SESSIONS + daemon.
 * Legacy engine path kept as fallback when xSe gate-ok but daemon offline and
 * engines can still start detached/tmux (non-daemon product path).
 *
 * Cross-platform engines: TmuxEngine on macOS/Linux when tmux is available,
 * DetachedEngine on Windows or when tmux is absent.
 */
export async function handleBgStart(args: string[]): Promise<void> {
  // Official Iia: strip --bg/--background before `--`, keep rest intact.
  const filteredArgs = stripBgFlags(args)

  // densable `if (gP(zr, ct.requestDialog))` — --bg has no requestDialog.
  // f6e(undefined) is false → no fable_overage_consent_prompt, no abort.
  void gP(undefined, undefined)

  // densable e6_ + xSe shell (gate before any spawn). Use full argv so
  // `--print`/`bypass`/`auto` flags densable blocks are visible.
  try {
    const { gateBgSpawnArgs, xSeSpawn } = await import('../daemon/xSeSpawn.js')
    const gate = gateBgSpawnArgs(filteredArgs)
    if (gate) {
      console.error(gate)
      process.exitCode = 1
      return
    }

    // densable Bq_/xSe: prefer daemon dispatch (source shell).
    // Full Uq_ peel happens inside xSeSpawn from argv (agent/name/resume/intent).
    const { peelUqArgv } = await import('../daemon/uqArgvPeel.js')
    const peeled = peelUqArgv(filteredArgs)
    const xse = await xSeSpawn({
      intent: peeled.intent ?? '',
      name: peeled.name,
      agent: peeled.agent,
      resumeSessionId: peeled.resumeSessionId,
      forkSession: peeled.hasForkSession ? true : undefined,
      argv: filteredArgs,
      source: 'shell',
      extraArgs: peeled.allowlistedRespawnFlags,
    })
    if (xse.ok) {
      // densable xmt(short, idle?, name)
      console.log(
        formatBgHints(
          xse.short,
          xse.idle ? '(idle — waiting for input)' : undefined,
          xse.name,
        ),
      )
      if (xse.rescued) {
        console.error(
          'warning: dispatch ack timed out but worker is live (rescued)',
        )
      }
      return
    }
    // gate already handled; other hard fails surface and stop (no engine double-spawn)
    if (
      xse.reason === 'gate_blocked' ||
      xse.reason === 'short_alive' ||
      xse.reason === 'stale_short' ||
      xse.reason === 'ack_timeout'
    ) {
      console.error(xse.error)
      process.exitCode = 1
      return
    }
    // daemon offline / dispatch_write already file-fallbacked inside xSe when possible
    if (
      xse.reason === 'dispatch_write' ||
      xse.reason.includes('spawn_failed')
    ) {
      console.error(xse.error)
      process.exitCode = 1
      return
    }
    // Fall through to legacy engine only when xSe returned soft offline without write
  } catch {
    // xSe module / daemon path unavailable — legacy engine below
  }

  const engine = await selectEngine()

  // Engines without interactive TTY input (e.g. detached) require -p/--print
  // or piped input. Tmux provides a virtual terminal so it works without -p.
  // densable e6_ already blocked --print for daemon path; engine path still
  // needs -p for detached (product constraint, not densable xSe).
  if (
    !engine.supportsInteractiveInput &&
    !filteredArgs.some(a => a === '-p' || a === '--print' || a === '--pipe')
  ) {
    console.error(
      'Error: Background sessions with detached engine require -p/--print flag.\n' +
        'The detached engine has no terminal for interactive input.\n\n' +
        'Usage:\n' +
        '  claude daemon bg -p "your prompt here"\n' +
        '  echo "prompt" | claude daemon bg --pipe',
    )
    if (process.platform !== 'win32') {
      console.error(
        '\nAlternatively, install tmux for interactive background sessions:\n' +
          `  ${process.platform === 'darwin' ? 'brew install tmux' : 'sudo apt install tmux'}`,
      )
    }
    process.exitCode = 1
    return
  }

  const sessionName = `claude-bg-${randomUUID().slice(0, 8)}`
  const logPath = join(
    getClaudeConfigHomeDir(),
    'sessions',
    'logs',
    `${sessionName}.log`,
  )

  try {
    const result = await engine.start({
      sessionName,
      args: filteredArgs,
      // densable So leftover engine: `reattachEnv: {...i, ...!exec && urr(awn())}`.
      // No exec on this path — always urr(awn()). Child engines stamp SESSION_KIND=bg.
      env: {
        ...process.env,
        ...dispatcherReattachEnv(getDispatcherAccountFromOauthToken()),
      },
      logPath,
      cwd: tryProcessCwd(),
    })

    // Official Vdt post-spawn hints.
    console.log(formatBgHints(result.sessionName))
    console.log(`  Engine: ${result.engineUsed}`)
    console.log(`  Log: ${result.logPath}`)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
}

// densable t6_/r2o peel moved to daemon/uqArgvPeel.ts (full Uq_ 1:1).

function respawnStatusHint(): string {
  if (feature('DAEMON')) {
    return " \u2014 run 'claude daemon status'"
  }
  if (feature('BG_SESSIONS')) {
    return " \u2014 run 'claude daemon status'"
  }
  return ''
}

async function logRespawnBad(errorCode: string): Promise<void> {
  await logEventAsync('tengu_feature_bad', {
    feature_name: CLI_BG_RESPAWN,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

async function logRespawnOk(): Promise<void> {
  await logEventAsync('tengu_feature_ok', { feature_name: CLI_BG_RESPAWN })
}

/**
 * densable cEr — `claude respawn <id>|--all`.
 * Restarts background jobs onto the current binary. Does not attach.
 */
export async function respawnHandler(
  target: string | undefined,
): Promise<void> {
  if (target === '--help' || target === '-h') {
    process.stdout.write(
      'Usage: claude respawn <id>|--all\n\n  Restart a background session (or all of them) so it picks up the current Claude binary.\n',
    )
    process.exitCode = 0
    return
  }
  if (target?.startsWith('-') && target !== '--all') {
    process.stderr.write(
      `unknown option '${target}'\nUsage: claude respawn <id>|--all\n`,
    )
    process.exitCode = 1
    return
  }
  if (!target) {
    process.stderr.write('usage: claude respawn <id>|--all\n')
    process.exitCode = 1
    return
  }

  const { ensureDaemonRunning } = await import('../daemon/installPrompt.js')
  const daemon = await ensureDaemonRunning({
    forceTransient: true,
    mayPromptInstall: false,
  })
  if (!daemon.ok) {
    const reason = daemon.reason ?? 'not running'
    process.stderr.write(
      `Couldn't respawn — ${backgroundServiceLabel()} is unavailable (${reason})${respawnStatusHint()}\n`,
    )
    await logRespawnBad('daemon_unavailable')
    process.exitCode = 1
    return
  }

  const { forceRespawnJob } = await import('../daemon/forceRespawnJob.js')
  if (target === '--all') {
    const { isTerminalState, listAllJobs } = await import(
      '../daemon/jobState.js'
    )
    const jobs = (await listAllJobs()).filter(
      job => !isTerminalState(job.state),
    )
    if (jobs.length === 0) {
      process.stdout.write('no live jobs to respawn\n')
      return
    }
    let restarted = 0
    let stillAlive = 0
    for (const job of jobs) {
      const result = await forceRespawnJob(job.short)
      if (result.ok) {
        restarted++
        const arrow =
          result.short !== job.short ? ` \u2192 ${result.short}` : ''
        process.stdout.write(`respawned ${job.short}${arrow}\n`)
      } else if ('alive' in result && result.alive) {
        stillAlive++
        process.exitCode = 1
        process.stderr.write(
          `${job.short}: still running — couldn't confirm restart, retry in a moment\n`,
        )
      } else {
        process.exitCode = 1
        process.stderr.write(`${job.short}: ${result.error}\n`)
      }
    }
    if (restarted === jobs.length) await logRespawnOk()
    else if (restarted > 0 || stillAlive > 0) {
      await logRespawnBad(stillAlive > 0 ? 'still_alive' : 'partial')
    } else await logRespawnBad('spawn_failed')
    return
  }

  const { resolveJobShortByPrefix } = await import('../daemon/deleteJob.js')
  const resolved = await resolveJobShortByPrefix(target)
  if (!resolved.ok) {
    process.stderr.write(
      resolved.kind === 'none'
        ? `No job matching '${target}'\n`
        : `Ambiguous prefix '${target}', matches: ${resolved.matches.join(', ')}\n`,
    )
    await logRespawnBad(resolved.kind === 'none' ? 'no_match' : 'ambiguous')
    process.exitCode = 1
    return
  }

  const result = await forceRespawnJob(resolved.short)
  if (!result.ok && 'alive' in result && result.alive) {
    process.stderr.write(
      `${resolved.short}: still running — couldn't confirm restart, retry in a moment\n`,
    )
    await logRespawnBad('still_alive')
    process.exitCode = 1
    return
  }
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`)
    await logRespawnBad('spawn_failed')
    process.exitCode = 1
    return
  }
  await logRespawnOk()
  const arrow = result.short !== resolved.short ? ` \u2192 ${result.short}` : ''
  process.stdout.write(`respawned ${resolved.short}${arrow}\n`)
}
