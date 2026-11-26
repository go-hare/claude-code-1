/**
 * Rendezvous Server — session-side server for daemon ↔ session communication.
 *
 * Upstream equivalent: cn8 module (startRendezvousServer/stopRendezvousServer/sendRv).
 *
 * The daemon connects to this server to:
 *   - Send "repaint" requests (triggers Ink forceRedraw)
 *   - Send "reply" messages (enqueues user input)
 *   - Send "shutdown" (graceful exit)
 *   - Send "attacher-caps" (terminal capabilities)
 *   - Receive "heartbeat" (keep-alive)
 *   - Receive "state" patches (session state updates)
 *   - Receive "repaint-done" acknowledgements
 *
 * Protocol: newline-delimited JSON over Unix socket / Windows named pipe.
 */

import { createServer, type Server, type Socket } from 'net'
import { basename } from 'path'
import { unlink } from 'fs/promises'
import { StringDecoder } from 'string_decoder'
import {
  getAttachStampMs,
  markDetachedSinceLastAttach,
  Ns,
  stampAttachTime,
} from '@anthropic/ink'
import { snapshotInFlight } from '../utils/bgNeedsInputBridge.js'
import { enqueue } from '../utils/messageQueueManager.js'
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionHost.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { plural } from '../utils/stringUtils.js'

// ---------------------------------------------------------------------------
// State (Host-scoped via HostSlot on SessionHost)
// ---------------------------------------------------------------------------

type PeerQuestionHandler = (text: string) => boolean
type ImmediateCommandRunner = (text: string) => boolean

type RendezvousHostState = {
  server: Server | undefined
  client: Socket | undefined
  heartbeatTimer: ReturnType<typeof setInterval> | undefined
  wedgeTimer: ReturnType<typeof setTimeout> | undefined
  wedgeDisarmed: boolean
  peerQuestionHandler: PeerQuestionHandler | null
  immediateCommandRunner: ImmediateCommandRunner | null
}

const rendezvousHostSlot = new HostSlot<RendezvousHostState>(() => ({
  server: undefined,
  client: undefined,
  heartbeatTimer: undefined,
  wedgeTimer: undefined,
  wedgeDisarmed: false,
  peerQuestionHandler: null,
  immediateCommandRunner: null,
}))

function getRendezvousHostState(): RendezvousHostState {
  return rendezvousHostSlot.of(getBootstrapSessionHost())
}

/**
 * densable `e5a` / `rPt` — default startup detail. Wedge only fires while
 * job state is still `working` + this sentinel (SEA `z8n`).
 */
export const STARTUP_DETAIL_RPT = 'starting…'

/** densable `m1e` — written when the 45s startup wedge trips. */
export const STUCK_STARTUP_DIALOG = 'stuck on a startup dialog'

/** densable `g1e` */
export const STUCK_STARTUP_NEEDS = 'open this session to continue setup'

function jobShortFromDir(jobDir: string): string {
  return basename(jobDir.replace(/[\\/]+$/, ''))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the rendezvous server. Reads socket path from CLAUDE_BG_RENDEZVOUS_SOCK
 * environment variable (set by daemon when spawning bg sessions).
 */
export async function startRendezvousServer(): Promise<void> {
  const hostState = getRendezvousHostState()
  const sockPath = process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  if (!sockPath || hostState.server) return

  delete process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  await unlink(sockPath).catch(() => {})

  const server = createServer((socket: Socket) => {
    // Only one client at a time (daemon supervisor)
    hostState.client?.destroy()
    hostState.client = socket

    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      if (hostState.client === socket) hostState.client = undefined
    })

    // densable onConnection → clearPreBootState re-evaluates the wedge.
    const jobDir = process.env.CLAUDE_JOB_DIR
    if (jobDir) maybeArmStartupWedgeForHost(jobDir, hostState)

    let buf = ''
    const decoder = new StringDecoder('utf8')
    socket.on('data', (chunk: Buffer) => {
      buf += decoder.write(chunk)
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line) handleMessage(line, hostState)
      }
      if (buf.length > 1_048_576) {
        buf = ''
        socket.destroy()
      }
    })
  })
  hostState.server = server

  server.on('error', (err: Error) => {
    // Log but don't crash — rv is best-effort
    if (process.env.CLAUDE_CODE_DEBUG) {
      process.stderr.write(`[bg-rv] server error: ${err.message}\n`)
    }
  })

  server.listen(sockPath)
  server.unref()

  // Heartbeat every 30s so daemon knows we're alive
  hostState.heartbeatTimer = setInterval(
    () => sendRvForHost(hostState, { type: 'heartbeat' }),
    30_000,
  )
  hostState.heartbeatTimer.unref()

  // densable z8n: if the job is already working + rPt, start the 45s clock.
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (jobDir) maybeArmStartupWedgeForHost(jobDir, hostState)
}

/**
 * Stop the rendezvous server and clean up.
 */
export function stopRendezvousServer(): void {
  const hostState = getRendezvousHostState()
  if (hostState.heartbeatTimer) {
    clearInterval(hostState.heartbeatTimer)
    hostState.heartbeatTimer = undefined
  }
  disarmStartupWedgeWatchdog()
  hostState.client?.destroy()
  hostState.client = undefined
  hostState.server?.close()
  hostState.server = undefined
}

function armStartupWedgeWatchdogForHost(
  jobDir: string,
  hostState: RendezvousHostState,
): void {
  if (hostState.wedgeDisarmed) return
  clearTimeout(hostState.wedgeTimer)
  const ms = Number(process.env.CLAUDE_BG_STARTUP_WEDGE_MS || 45000)
  hostState.wedgeTimer = setTimeout(
    () => void onStartupWedgeTimeoutForHost(jobDir, hostState),
    ms,
  )
  hostState.wedgeTimer.unref()
}

/**
 * densable `z8n.armStartupWedgeWatchdog`.
 * `CLAUDE_BG_STARTUP_WEDGE_MS || 45000`.
 */
export function armStartupWedgeWatchdog(jobDir: string): void {
  armStartupWedgeWatchdogForHost(jobDir, getRendezvousHostState())
}

/** densable `z8n.disarmStartupWedgeWatchdog`. */
export function disarmStartupWedgeWatchdog(): void {
  const hostState = getRendezvousHostState()
  hostState.wedgeDisarmed = true
  clearTimeout(hostState.wedgeTimer)
  hostState.wedgeTimer = undefined
}

async function onStartupWedgeTimeoutForHost(
  jobDir: string,
  hostState: RendezvousHostState,
): Promise<void> {
  try {
    const { readBgJobState, writeBgJobState } = await import('./jobState.js')
    if (hostState.wedgeDisarmed) return
    const short = jobShortFromDir(jobDir)
    const t = readBgJobState(short)
    if (
      !t ||
      t.state !== 'working' ||
      t.detail !== STARTUP_DETAIL_RPT ||
      t.tempo === 'blocked'
    ) {
      return
    }
    const updatedAt = new Date().toISOString()
    writeBgJobState(short, {
      ...t,
      tempo: 'blocked',
      detail: STUCK_STARTUP_DIALOG,
      needs: STUCK_STARTUP_NEEDS,
      updatedAt,
    })
    sendRvForHost(hostState, {
      type: 'state',
      patch: {
        tempo: 'blocked',
        detail: STUCK_STARTUP_DIALOG,
        needs: STUCK_STARTUP_NEEDS,
      },
    })
  } catch {
    // densable Et/Gp: swallow expected I/O; don't take down rv
  }
}

/**
 * densable `z8n.onStartupWedgeTimeout`: still `working` + `detail===rPt`
 * and not already blocked → tempo blocked + stuck-dialog copy.
 */
export async function onStartupWedgeTimeout(jobDir: string): Promise<void> {
  return onStartupWedgeTimeoutForHost(jobDir, getRendezvousHostState())
}

function maybeArmStartupWedgeForHost(
  jobDir: string,
  hostState: RendezvousHostState,
): void {
  void import('./jobState.js')
    .then(({ readBgJobState }) => {
      const t = readBgJobState(jobShortFromDir(jobDir))
      if (t?.state === 'working' && t.detail === STARTUP_DETAIL_RPT) {
        armStartupWedgeWatchdogForHost(jobDir, hostState)
      }
    })
    .catch(() => {})
}

/** densable: `if (t.state==="working" && t.detail===rPt) arm…` */
export function maybeArmStartupWedge(jobDir: string): void {
  maybeArmStartupWedgeForHost(jobDir, getRendezvousHostState())
}

/** Test helper — reset latch so the next arm can fire. */
export function resetStartupWedgeForTests(): void {
  const hostState = getRendezvousHostState()
  clearTimeout(hostState.wedgeTimer)
  hostState.wedgeTimer = undefined
  hostState.wedgeDisarmed = false
}

function sendRvForHost(
  hostState: RendezvousHostState,
  msg: Record<string, unknown>,
): boolean {
  const client = hostState.client
  if (!client || client.destroyed) return false
  try {
    client.write(jsonStringify(msg) + '\n')
    return true
  } catch {
    return false
  }
}

/**
 * Send a message to the daemon via the rendezvous connection.
 * Returns true if the message was sent, false if no client is connected.
 */
export function sendRv(msg: Record<string, unknown>): boolean {
  return sendRvForHost(getRendezvousHostState(), msg)
}

/** densable dSH / Hr8 / FLK — APC fallback when YK/sendRv fails. */
const DETACH_SEQ = '\x1B_cc-daemon-detach\x1B\\'
const DETACH_MSG_PREFIX = '\x1B_cc-detach-msg;'
const DETACH_ST = '\x1B\\'

/** densable _Nn — inFlight tasks; undefined when 0 (Ej then emits bare dSH). */
export function detachInFlightMessage(): string | undefined {
  const { tasks } = snapshotInFlight()
  if (tasks === 0) return
  return `Detached — ${tasks} ${plural(tasks, 'task')} still running. Run \`claude agents\` to see your background sessions.`
}

/** densable Ej */
function encodeDetachApc(msg?: string): string {
  if (!msg) return DETACH_SEQ
  return DETACH_MSG_PREFIX + msg + DETACH_ST + DETACH_SEQ
}

/**
 * densable KW — daemon detach.
 * Gold: if (YK({type:"detach-request",msg,broadcast})) { Hlt(); return }
 * else stdout.write(Ej(msg)). Hlt is sync and only on sendRv success.
 */
export function requestBgDetach(opts?: { broadcast?: boolean }): void {
  if (process.env.CLAUDE_BG_BACKEND !== 'daemon') return
  const msg = detachInFlightMessage()
  if (
    sendRv({
      type: 'detach-request',
      msg,
      broadcast: opts?.broadcast,
    })
  ) {
    markDetachedSinceLastAttach()
    return
  }
  process.stdout.write(encodeDetachApc(msg))
}

/** densable fEe / pEe — onBgDetach 1s window. */
export const BG_DETACH_DEBOUNCE_MS = 1000

/**
 * densable XE.onBgDetach — per-screen #s, not process-global.
 * Gold: if (now-#s < fEe && U$() <= #s) return; #s=now; KW()
 * /exit, Desktop, already-bg call requestBgDetach() and skip this gate.
 */
export function createOnBgDetach(): () => void {
  let lastKwMs = 0
  return () => {
    const now = Date.now()
    if (
      now - lastKwMs < BG_DETACH_DEBOUNCE_MS &&
      getAttachStampMs() <= lastKwMs
    ) {
      return
    }
    lastKwMs = now
    requestBgDetach()
  }
}

// ---------------------------------------------------------------------------
// Message handling — official bg3
// ---------------------------------------------------------------------------

function handleMessage(line: string, hostState: RendezvousHostState): void {
  let msg: Record<string, unknown>
  try {
    msg = jsonParse(line) as Record<string, unknown>
  } catch {
    return
  }
  if (!msg || typeof msg !== 'object') return
  if ('role' in msg) return // Ignore stray API messages

  switch (msg.type) {
    case 'shutdown':
      sendRvForHost(hostState, { type: 'shutting-down' })
      // Graceful shutdown
      setTimeout(() => process.exit(0), 5000).unref()
      process.exit(0)
      break

    case 'repaint': {
      // Gold C(): if(Al()!==null) Won(Date.now()); forceRedraw({flushReact:!0})
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getAttacherCaps } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      if (getAttacherCaps() !== null) stampAttachTime(Date.now())
      const ink = Ns().get(process.stdout)
      if (!ink?.forceRedraw({ flushReact: true })) {
        // Ink not ready yet — write a fallback message
        process.stdout.write(
          '\x1B[2J\x1B[H\n  \x1B[2mSession can\u2019t redraw right now \u2014 Ctrl+Z to detach\x1B[0m\n',
        )
      }
      sendRvForHost(hostState, { type: 'repaint-done' })
      break
    }

    case 'attacher-caps': {
      // densable yfy: tii(e.caps) — truthy caps means a terminal is attached
      // (Pte becomes false so MCP OAuth / install-github-app can run).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { setAttacherCaps } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      const caps =
        msg && typeof msg === 'object' && 'caps' in msg
          ? (msg as { caps?: Record<string, unknown> | null }).caps
          : null
      setAttacherCaps(caps ?? null)
      if (caps) stampAttachTime(Date.now())
      else markDetachedSinceLastAttach()
      break
    }

    case 'reply':
      if (typeof msg.text === 'string') {
        // Official #156: nextTurn enqueues prompt directly skipping slash/immediate/question gates.
        if (msg.nextTurn === true) {
          enqueue({
            mode: 'prompt',
            value: msg.text,
            priority: 'next',
            origin: { kind: 'human' },
            skipSlashCommands: true,
          })
          break
        }
        // Official bg-rv densable:
        //   if (nZK(text)) return  // peer answered an in-session question
        //   if (A(w(), text)) return  // immediate /model /effort /rename /usage
        //   mw({ mode: pR(text), value: Vh(text), priority: 'next' })
        if (tryAnswerPeerQuestion(msg.text, hostState)) {
          break
        }
        if (tryImmediateCommand(msg.text, hostState)) {
          break
        }
        enqueueReplyAsQueuedCommand(msg.text)
      }
      break
  }
}

/**
 * Official pR — bash mode when seed starts with '!', else prompt.
 */
export function replyMode(text: string): 'bash' | 'prompt' {
  return text.startsWith('!') ? 'bash' : 'prompt'
}

/**
 * Official Vh — strip leading '!' for bash mode values.
 */
export function replyValue(text: string): string {
  return replyMode(text) === 'prompt' ? text : text.slice(1)
}

/**
 * Official mw payload for a bg-rv `reply` text (without peer-question gate).
 */
export function replyToQueuedCommand(text: string): {
  mode: 'bash' | 'prompt'
  value: string
  priority: 'next'
} {
  return {
    mode: replyMode(text),
    value: replyValue(text),
    priority: 'next',
  }
}

/**
 * Official nZK — optional peer-question interceptor (registered by REPL).
 * When a question UI is open, the reply answers it instead of enqueueing.
 */
export function setPeerQuestionHandler(
  handler: PeerQuestionHandler | null,
): void {
  getRendezvousHostState().peerQuestionHandler = handler
}

function tryAnswerPeerQuestion(
  text: string,
  hostState: RendezvousHostState,
): boolean {
  try {
    return hostState.peerQuestionHandler?.(text) ?? false
  } catch {
    return false
  }
}

/**
 * Official Kns — immediate command runner for peer replies (/model, /effort, /rename, /usage).
 */
export function registerImmediateCommandRunner(
  runner: ImmediateCommandRunner | null,
): void {
  getRendezvousHostState().immediateCommandRunner = runner
}

function tryImmediateCommand(
  text: string,
  hostState: RendezvousHostState,
): boolean {
  try {
    return hostState.immediateCommandRunner?.(text) ?? false
  } catch {
    return false
  }
}

/**
 * Official mw({mode,value,priority:'next'}) — structured queue inject.
 */
function enqueueReplyAsQueuedCommand(text: string): void {
  enqueue(replyToQueuedCommand(text))
}
