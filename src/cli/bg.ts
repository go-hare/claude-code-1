import { readdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
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

/**
 * `claude daemon logs <target>` — show logs for a session.
 */
export async function logsHandler(target: string | undefined): Promise<void> {
  const sessions = await listLiveSessions()

  if (!target) {
    if (sessions.length === 0) {
      console.log('No active sessions.')
      return
    }
    if (sessions.length === 1) {
      target = sessions[0]!.sessionId
    } else {
      console.log('Multiple sessions active. Specify one:')
      for (const s of sessions) {
        const label = s.name ? `${s.name} (${s.sessionId})` : s.sessionId
        console.log(`  ${label}  PID=${s.pid}`)
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

  if (!session.logPath) {
    console.log(`No log path recorded for session ${session.sessionId}`)
    return
  }

  try {
    const content = await readFile(session.logPath, 'utf-8')
    process.stdout.write(content)
  } catch (e) {
    console.error(`Failed to read log file: ${session.logPath}`)
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
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
      process.stdout.write(
        `kept ${short} \u2014 worktree ${formatKeptWorktreeReason(result.keptReason, result.keptErrorSummary)}\n  worktree kept at ${result.keptWorktree}\n  resolve that (commit/push, or remove the worktree), then run 'claude rm ${short}' again\n`,
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
      env: { ...process.env },
      logPath,
      cwd: process.cwd(),
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
