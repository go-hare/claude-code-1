/**
 * Bg Manager — orchestrates background session lifecycle.
 *
 * Upstream equivalent: `CG_` (createBgManager) in the official binary.
 *
 * Responsibilities:
 *   - Accept dispatch requests (via control socket or file watcher)
 *   - Spawn PTY host processes for each session
 *   - Track session state via job state files
 *   - Handle session exit (update state, respawn if needed)
 *   - Provide status to FleetView
 */

import { type ChildProcess } from 'child_process'
import { mkdirSync } from 'fs'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { buildCliLaunch, spawnCli } from '../utils/cliLaunch.js'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import {
  type BgJobState,
  readBgJobState,
  writeBgJobState,
  createInitialJobState,
  getJobDirPath,
  isTerminalState,
} from './jobState.js'
import {
  startControlSocket,
  type ControlRequest,
  type ControlResponse,
} from './controlSocket.js'
import { startDispatchWatcher } from './dispatchWatcher.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchRequest {
  short: string
  sessionId: string
  intent: string
  name: string
  agent?: string
  cwd: string
  respawnFlags: string[]
  source: string
  createdAt: number
  launch: {
    mode: 'prompt' | 'resume' | 'exec'
    sessionId?: string
    fork?: boolean
    flagArgs?: string[]
    args?: string[]
  }
}

export interface BgHandle {
  dispatch: DispatchRequest
  child: ChildProcess | null
  pid: number
  outcome: 'done' | 'killed' | 'crashed' | null
  attempt: number
  startedAt: number
}

export interface BgManagerInstance {
  dispatch(req: DispatchRequest): void
  handles: Map<string, BgHandle>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export async function startBgManager(opts?: {
  onLog?: (msg: string) => void
}): Promise<BgManagerInstance> {
  const log = opts?.onLog ?? (() => {})
  const handles = new Map<string, BgHandle>()

  // Ensure directories
  const jobsDir = join(getClaudeConfigHomeDir(), 'jobs')
  await mkdir(jobsDir, { recursive: true })

  // Dispatch handler
  const handleDispatch = (dispatch: DispatchRequest) => {
    const existing = handles.get(dispatch.short)
    if (existing && existing.outcome === null) {
      log(`bg: dup dispatch ${dispatch.short} dropped (already running)`)
      return
    }
    spawnSession(dispatch, handles, log, 1)
  }

  // Start control socket
  const controlSocket = await startControlSocket(
    async (req: ControlRequest): Promise<ControlResponse> => {
      switch (req.op) {
        case 'ping':
          return { ok: true, op: 'ping' }

        case 'dispatch': {
          const dispatch = req as unknown as DispatchRequest
          if (!dispatch.short || !dispatch.sessionId || !dispatch.intent) {
            return { ok: false, error: 'missing required fields' }
          }
          handleDispatch(dispatch)
          return { ok: true, op: 'dispatch', short: dispatch.short }
        }

        case 'status':
        case 'list': {
          const jobs = [...handles.values()].map(h => ({
            short: h.dispatch.short,
            pid: h.pid,
            outcome: h.outcome,
            name: h.dispatch.name,
            intent: h.dispatch.intent,
            sessionId: h.dispatch.sessionId,
            attempt: h.attempt,
          }))
          return { ok: true, op: 'list', jobs }
        }

        case 'stop': {
          const short = req.short as string
          const handle = handles.get(short)
          if (!handle) return { ok: false, error: 'job not found' }
          if (handle.child) {
            handle.child.kill('SIGTERM')
            // Force kill after 5s
            setTimeout(() => {
              if (handle.child && handle.outcome === null) {
                handle.child.kill('SIGKILL')
              }
            }, 5000).unref()
          }
          return { ok: true, op: 'stop' }
        }

        default:
          return { ok: false, error: `unknown op: ${req.op}` }
      }
    },
  )

  log(`bg manager: control socket ready`)

  // Start dispatch watcher
  const watcher = await startDispatchWatcher(handleDispatch, log)

  log(`bg manager: dispatch watcher ready`)

  return {
    dispatch: handleDispatch,
    handles,
    async close() {
      watcher.close()
      await controlSocket.close()
      for (const h of handles.values()) {
        if (h.child && h.outcome === null) {
          h.child.kill('SIGTERM')
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Session Spawn
// ---------------------------------------------------------------------------

function spawnSession(
  dispatch: DispatchRequest,
  handles: Map<string, BgHandle>,
  log: (msg: string) => void,
  attempt: number,
): void {
  // Create job state
  if (attempt === 1) {
    writeBgJobState(
      dispatch.short,
      createInitialJobState({
        intent: dispatch.intent,
        name: dispatch.name,
        sessionId: dispatch.sessionId,
        cwd: dispatch.cwd,
        agent: dispatch.agent,
        respawnFlags: dispatch.respawnFlags,
      }),
    )
  }

  // Build CLI args based on launch mode and attempt
  const cliArgs = buildSessionArgs(dispatch, attempt)

  // Build log path
  const logDir = join(getClaudeConfigHomeDir(), 'sessions', 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `claude-bg-${dispatch.short}.log`)

  const { openSync, closeSync } = require('fs') as typeof import('fs')
  const logFd = openSync(logPath, 'a')

  const jobDir = getJobDirPath(dispatch.short)
  mkdirSync(jobDir, { recursive: true })

  // Environment
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_CODE_SESSION_NAME: dispatch.name,
    CLAUDE_CODE_SESSION_LOG: logPath,
    CLAUDE_JOB_DIR: jobDir,
    CLAUDE_BG_SOURCE: dispatch.source,
  }

  // Spawn via PTY host or direct
  const usePtyHost = shouldUsePtyHost()

  let child: ChildProcess

  if (usePtyHost) {
    // Spawn PTY host which will spawn CLI inside PTY
    const ptySock = getPtySockPath(dispatch.short)
    const cols = String(process.stdout.columns || 200)
    const rows = String(process.stdout.rows || 50)

    const ptyArgs = ['--bg-pty-host', ptySock, cols, rows, '--', ...cliArgs]

    const launch = buildCliLaunch(ptyArgs, { env: env as NodeJS.ProcessEnv })
    child = spawnCli(launch, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: dispatch.cwd,
    })
  } else {
    // Direct spawn (fallback)
    const launch = buildCliLaunch(cliArgs, { env: env as NodeJS.ProcessEnv })
    child = spawnCli(launch, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: dispatch.cwd,
    })
  }

  child.unref()
  closeSync(logFd)

  const handle: BgHandle = {
    dispatch,
    child,
    pid: child.pid ?? 0,
    outcome: null,
    attempt,
    startedAt: Date.now(),
  }

  handles.set(dispatch.short, handle)
  log(`bg spawned ${dispatch.short} pid=${handle.pid} attempt=${attempt}`)

  // Update job state to working
  const state = readBgJobState(dispatch.short)
  if (state && state.state === 'starting') {
    state.state = 'working'
    state.tempo = 'active'
    state.updatedAt = new Date().toISOString()
    writeBgJobState(dispatch.short, state)
  }

  // Handle exit
  child.on('exit', (code, signal) => {
    handle.child = null
    handle.outcome =
      code === 0 ? 'done' : signal === 'SIGTERM' ? 'killed' : 'crashed'

    log(
      `bg settled ${dispatch.short} (${handle.outcome}) code=${code} signal=${signal}`,
    )

    // Update job state
    const jobState = readBgJobState(dispatch.short)
    if (jobState && !isTerminalState(jobState)) {
      const now = new Date().toISOString()
      jobState.state =
        handle.outcome === 'done'
          ? 'done'
          : handle.outcome === 'killed'
            ? 'stopped'
            : 'failed'
      jobState.tempo = 'idle'
      jobState.updatedAt = now
      jobState.firstTerminalAt = jobState.firstTerminalAt ?? now
      writeBgJobState(dispatch.short, jobState)
    }

    // Clean up PTY socket
    if (usePtyHost) {
      const ptySock = getPtySockPath(dispatch.short)
      unlink(ptySock).catch(() => {})
      unlink(ptySock + '.err').catch(() => {})
    }
  })
}

// ---------------------------------------------------------------------------
// Args Builder
// ---------------------------------------------------------------------------

function buildSessionArgs(
  dispatch: DispatchRequest,
  attempt: number,
): string[] {
  // On respawn (attempt > 1), use --resume
  if (attempt > 1) {
    return ['--resume', dispatch.sessionId, ...dispatch.respawnFlags]
  }

  // First attempt: use launch mode
  if (dispatch.launch.mode === 'resume') {
    return [
      ...(dispatch.launch.fork
        ? ['--session-id', dispatch.sessionId, '--fork-session']
        : []),
      '--resume',
      dispatch.launch.sessionId ?? dispatch.sessionId,
      ...(dispatch.launch.flagArgs ?? []),
    ]
  }

  if (dispatch.launch.mode === 'exec' && dispatch.launch.args) {
    return dispatch.launch.args
  }

  // Default: prompt mode
  return [
    '-p',
    dispatch.intent,
    '--session-id',
    dispatch.sessionId,
    ...(dispatch.name ? ['-n', dispatch.name] : []),
    ...(dispatch.agent ? ['--agent', dispatch.agent] : []),
    ...dispatch.respawnFlags,
  ]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldUsePtyHost(): boolean {
  // PTY host uses Bun.Terminal (conpty on Windows, forkpty on Unix)
  // Always use PTY host — it falls back to pipe + FORCE_INTERACTIVE internally
  return true
}

function getPtySockPath(short: string): string {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER || 'default'
    return `//./pipe/cc-pty-${user}-${short}`
  }
  const ptyDir = join(getClaudeConfigHomeDir(), 'daemon', 'bg', 'pty')
  mkdirSync(ptyDir, { recursive: true })
  return join(ptyDir, `${short}.sock`)
}

// ---------------------------------------------------------------------------
// Public dispatch helper (for FleetView / CLI)
// ---------------------------------------------------------------------------

/**
 * Create and submit a dispatch request.
 * Tries control socket first, falls back to file-based dispatch.
 */
export async function submitDispatch(opts: {
  intent: string
  name?: string
  agent?: string
  cwd?: string
  extraArgs?: string[]
  source?: string
}): Promise<{ short: string; sessionId: string }> {
  const sessionId = randomUUID()
  const short = sessionId.slice(0, 8)

  const dispatch: DispatchRequest = {
    short,
    sessionId,
    intent: opts.intent,
    name: opts.name || deriveSessionName(opts.intent),
    agent: opts.agent,
    cwd: opts.cwd || process.cwd(),
    respawnFlags: opts.extraArgs || [],
    source: opts.source || 'fleet',
    createdAt: Date.now(),
    launch: {
      mode: 'prompt',
      sessionId,
    },
  }

  // Try control socket
  const { sendControlRequest } = await import('./controlSocket.js')
  const resp = await sendControlRequest({
    op: 'dispatch',
    ...dispatch,
  })

  if (resp.ok) {
    return { short, sessionId }
  }

  // Fallback: write dispatch file + direct spawn
  const { writeDispatchFile } = await import('./dispatchWatcher.js')
  await writeDispatchFile(dispatch)

  // Give daemon 500ms to pick it up
  await new Promise(r => setTimeout(r, 500))

  // If file still exists, no daemon — spawn directly
  const { existsSync } = await import('fs')
  const { getDispatchDir } = await import('./dispatchWatcher.js')
  const filePath = join(getDispatchDir(), `${short}.json`)
  if (existsSync(filePath)) {
    await unlink(filePath).catch(() => {})
    // No daemon running — spawn PTY host directly
    writeBgJobState(
      short,
      createInitialJobState({
        intent: dispatch.intent,
        name: dispatch.name,
        sessionId: dispatch.sessionId,
        cwd: dispatch.cwd,
        agent: dispatch.agent,
        respawnFlags: dispatch.respawnFlags,
      }),
    )

    const cliArgs = [
      '-p',
      dispatch.intent,
      '--session-id',
      dispatch.sessionId,
      ...(dispatch.name ? ['-n', dispatch.name] : []),
      ...(dispatch.agent ? ['--agent', dispatch.agent] : []),
      ...dispatch.respawnFlags,
    ]

    const logDir = join(getClaudeConfigHomeDir(), 'sessions', 'logs')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, `claude-bg-${short}.log`)
    const { openSync, closeSync } = require('fs') as typeof import('fs')
    const logFd = openSync(logPath, 'a')

    const ptySock = getPtySockPath(short)
    const cols = String(process.stdout.columns || 200)
    const rows = String(process.stdout.rows || 50)
    const ptyArgs = ['--bg-pty-host', ptySock, cols, rows, '--', ...cliArgs]

    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_CODE_SESSION_KIND: 'bg',
      CLAUDE_CODE_SESSION_NAME: dispatch.name,
      CLAUDE_CODE_SESSION_LOG: logPath,
      CLAUDE_JOB_DIR: getJobDirPath(short),
      CLAUDE_BG_SOURCE: opts.source || 'fleet',
    }

    const launch = buildCliLaunch(ptyArgs, { env: env as NodeJS.ProcessEnv })
    const child = spawnCli(launch, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: dispatch.cwd,
    })
    child.unref()
    closeSync(logFd)

    // Update state to working
    const state = readBgJobState(short)
    if (state) {
      state.state = 'working'
      state.tempo = 'active'
      state.updatedAt = new Date().toISOString()
      writeBgJobState(short, state)
    }
  }

  return { short, sessionId }
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
