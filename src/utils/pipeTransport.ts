/**
 * Named Pipe Transport - Unix domain socket IPC for CLI terminals
 *
 * Supports two modes:
 * 1. Standalone: Two independent terminals chat via pipes
 * 2. Master-Slave bridge: Master CLI attaches to Slave CLI, forwarding
 *    prompts and receiving streamed AI output back.
 *
 * Each CLI auto-creates a PipeServer at:
 *   ~/.claude/pipes/{session-short-id}.sock
 *
 * Protocol: newline-delimited JSON (NDJSON), one message per line.
 *
 * LAN TCP (enableTcp): requires shared-secret auth handshake before any
 * application message. Token is generated per PipeServer and advertised via
 * LanBeacon (`authToken`) — also in **plaintext** on the UDP beacon (TTL=1).
 * That only stops blind scanners; it is NOT a confidentiality boundary.
 * Trusted LAN only. Local UDS remains filesystem-permission gated and does
 * not require the handshake.
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { createServer, createConnection, type Server, type Socket } from 'net'
import { mkdir, unlink, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { PermissionDecision } from '../types/permissions.js'
import type { PermissionUpdate } from './permissions/PermissionUpdateSchema.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { logError } from './log.js'
import { logForDebugging } from './debug.js'
import { attachNdjsonFramer } from './ndjsonFramer.js'

/** TCP clients must complete auth within this window or are dropped. */
const PIPE_TCP_AUTH_TIMEOUT_MS = 3_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Message types exchanged over the pipe.
 *
 * Basic:        ping, pong
 * Control:      attach_request, attach_accept, attach_reject, detach,
 *               relay_mute, relay_unmute
 * Data (M→S):   prompt           — master sends user input to slave
 * Data (S→M):   stream           — slave streams AI output fragments
 *               tool_start       — slave notifies tool execution start
 *               tool_result      — slave notifies tool result
 *               done             — slave signals turn complete
 *               error            — either side reports an error
 * Legacy:       chat, cmd, result, exit  — kept for backward compat
 */
export type PipeMessageType =
  // Basic
  | 'ping'
  | 'pong'
  // LAN TCP shared-secret handshake (required before other msgs on TCP)
  | 'auth'
  | 'auth_ok'
  | 'auth_error'
  // Control flow (master-slave bridge)
  | 'attach_request'
  | 'attach_accept'
  | 'attach_reject'
  | 'detach'
  // Mute control (master → slave): logical disconnect without dropping transport
  | 'relay_mute'
  | 'relay_unmute'
  // Data flow (master → slave)
  | 'prompt'
  // Data flow (slave → master)
  | 'prompt_ack'
  | 'stream'
  | 'tool_start'
  | 'tool_result'
  | 'done'
  | 'error'
  | 'permission_request'
  | 'permission_response'
  | 'permission_cancel'
  // Legacy (standalone chat demo)
  | 'chat'
  | 'cmd'
  | 'result'
  | 'exit'

export type PipeMessage = {
  /** Discriminator */
  type: PipeMessageType
  /** Payload (text, command output, prompt, stream fragment, etc.) */
  data?: string
  /** Sender pipe name */
  from?: string
  /** ISO timestamp */
  ts?: string
  /** Additional metadata (tool name, error details, etc.) */
  meta?: Record<string, unknown>
}

export type PipePermissionRequestPayload = {
  requestId: string
  toolName: string
  toolUseID: string
  description: string
  input: Record<string, unknown>
  permissionResult: PermissionDecision
  permissionPromptStartTimeMs: number
}

export type PipePermissionResponsePayload =
  | {
      requestId: string
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      permissionUpdates?: PermissionUpdate[]
      feedback?: string
      contentBlocks?: ContentBlockParam[]
    }
  | {
      requestId: string
      behavior: 'deny'
      feedback?: string
      contentBlocks?: ContentBlockParam[]
    }

export type PipePermissionCancelPayload = {
  requestId: string
  reason?: string
}

export type PipeMessageHandler = (
  msg: PipeMessage,
  reply: (msg: PipeMessage) => void,
  /** Source socket — use for attach relay / directed replies (never clients[last]). */
  socket: Socket,
) => void

/** Constant-time token compare (length mismatch fails closed without timingSafeEqual throw). */
export function pipeAuthTokensEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// TCP transport types
// ---------------------------------------------------------------------------

export type PipeTransportMode = 'uds' | 'tcp'

export type TcpEndpoint = { host: string; port: number }

export type PipeServerOptions = {
  enableTcp?: boolean
  tcpPort?: number // 0 = random port
  /**
   * Shared secret for TCP clients. When omitted and enableTcp is true, a
   * random 32-byte hex token is generated. UDS listeners ignore this.
   */
  authToken?: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getPipesDir(): string {
  return join(getClaudeConfigHomeDir(), 'pipes')
}

export function getPipePath(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\claude-code-${safeName}`
  }
  return join(getPipesDir(), `${safeName}.sock`)
}

async function ensurePipesDir(): Promise<void> {
  await mkdir(getPipesDir(), { recursive: true })
}

// ---------------------------------------------------------------------------
// Server (listener side)
// ---------------------------------------------------------------------------

export class PipeServer extends EventEmitter {
  private server: Server | null = null
  private tcpServer: Server | null = null
  /** Fully trusted sockets only (UDS or post-auth TCP). Used by broadcast/sendTo/count. */
  private clients: Set<Socket> = new Set()
  /** TCP sockets waiting for auth — never broadcast to these. */
  private pendingAuthClients: Set<Socket> = new Set()
  private handlers: PipeMessageHandler[] = []
  private _tcpAddress: TcpEndpoint | null = null
  private _authToken: string | null = null
  readonly name: string
  readonly socketPath: string

  constructor(name: string) {
    super()
    this.name = name
    this.socketPath = getPipePath(name)
  }

  /** TCP endpoint if TCP is enabled, null otherwise. */
  get tcpAddress(): TcpEndpoint | null {
    return this._tcpAddress
  }

  /**
   * Shared secret required by TCP clients (null when TCP is off).
   * Advertised via LanBeacon so legitimate peers can connect.
   */
  get authToken(): string | null {
    return this._authToken
  }

  /**
   * Wire a socket. UDS/named-pipe sockets are trusted via filesystem perms.
   * TCP sockets must complete an `auth` handshake first — they are NOT added
   * to `clients` (broadcast/connectionCount) until auth succeeds.
   */
  private setupSocket(socket: Socket, requireAuth: boolean): void {
    let authenticated = !requireAuth
    let authTimer: ReturnType<typeof setTimeout> | null = null

    if (requireAuth) {
      this.pendingAuthClients.add(socket)
      authTimer = setTimeout(() => {
        if (authenticated || socket.destroyed) return
        logForDebugging(
          `[pipeTransport] closing unauthenticated TCP client for ${this.name}`,
        )
        if (!socket.destroyed) {
          try {
            socket.write(
              JSON.stringify({
                type: 'auth_error',
                data: 'authentication timeout',
                from: this.name,
                ts: new Date().toISOString(),
              }) + '\n',
            )
          } catch {
            // ignore write failures on teardown
          }
          socket.destroy()
        }
      }, PIPE_TCP_AUTH_TIMEOUT_MS)
      if (typeof authTimer.unref === 'function') authTimer.unref()
    } else {
      // UDS / named pipe: trusted via filesystem ACLs
      this.clients.add(socket)
      this.emit('connection', socket)
    }

    const clearAuthTimer = (): void => {
      if (authTimer) {
        clearTimeout(authTimer)
        authTimer = null
      }
    }

    const admitAuthenticated = (): void => {
      if (this.clients.has(socket)) return
      this.pendingAuthClients.delete(socket)
      this.clients.add(socket)
      this.emit('connection', socket)
    }

    const reply = (replyMsg: PipeMessage): void => {
      replyMsg.from = replyMsg.from ?? this.name
      replyMsg.ts = replyMsg.ts ?? new Date().toISOString()
      if (!socket.destroyed) {
        socket.write(JSON.stringify(replyMsg) + '\n')
      }
    }

    attachNdjsonFramer<PipeMessage>(socket, msg => {
      if (requireAuth && !authenticated) {
        if (msg.type === 'auth') {
          const offered =
            typeof msg.data === 'string'
              ? msg.data
              : typeof msg.meta?.token === 'string'
                ? msg.meta.token
                : ''
          if (
            this._authToken &&
            pipeAuthTokensEqual(offered, this._authToken)
          ) {
            authenticated = true
            clearAuthTimer()
            admitAuthenticated()
            reply({ type: 'auth_ok', data: 'ok' })
            return
          }
          logForDebugging(`[pipeTransport] TCP auth rejected for ${this.name}`)
          reply({ type: 'auth_error', data: 'unauthorized' })
          socket.destroy()
          return
        }
        logForDebugging(
          `[pipeTransport] rejected pre-auth message type=${msg.type} for ${this.name}`,
        )
        reply({ type: 'auth_error', data: 'auth required' })
        socket.destroy()
        return
      }

      // Post-auth: ignore stray auth frames (idempotent ok)
      if (msg.type === 'auth') {
        if (requireAuth) {
          reply({ type: 'auth_ok', data: 'ok' })
        }
        return
      }

      this.emit('message', msg)
      for (const handler of this.handlers) {
        handler(msg, reply, socket)
      }
    })

    socket.on('close', () => {
      clearAuthTimer()
      this.pendingAuthClients.delete(socket)
      const wasClient = this.clients.delete(socket)
      if (wasClient || !requireAuth) {
        this.emit('disconnect', socket)
      }
    })

    socket.on('error', err => {
      clearAuthTimer()
      this.pendingAuthClients.delete(socket)
      this.clients.delete(socket)
      logError(err)
    })
  }

  /**
   * Start listening for incoming connections.
   * @param options - Optional TCP configuration for LAN mode.
   */
  async start(options?: PipeServerOptions): Promise<void> {
    await ensurePipesDir()

    // Clean up stale socket file (Unix only)
    if (process.platform !== 'win32') {
      try {
        await unlink(this.socketPath)
      } catch {
        // File doesn't exist — fine
      }
    }

    // Start UDS/Named Pipe server (no NDJSON auth — OS filesystem ACLs)
    await new Promise<void>((resolve, reject) => {
      this.server = createServer(socket => this.setupSocket(socket, false))

      this.server.on('error', reject)

      this.server.listen(this.socketPath, () => {
        // On Windows, Named Pipes don't exist in the filesystem.
        // Write a registry file so listPipes() can discover this server.
        if (process.platform === 'win32') {
          const regFile = join(getPipesDir(), `${this.name}.pipe`)
          const { hostname } = require('os') as typeof import('os')
          void writeFile(
            regFile,
            JSON.stringify({
              pid: process.pid,
              ts: Date.now(),
              ip: getLocalIp(),
              hostname: hostname(),
            }),
          ).catch(() => {})
        }
        resolve()
      })
    })

    // Optionally start TCP server for LAN connectivity
    if (options?.enableTcp) {
      this._authToken =
        options.authToken && options.authToken.length > 0
          ? options.authToken
          : randomBytes(32).toString('hex')
      await this.startTcpServer(options.tcpPort ?? 0)
    }
  }

  /**
   * Start TCP listener for LAN peers (auth required on each socket).
   */
  private async startTcpServer(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.tcpServer = createServer(socket => this.setupSocket(socket, true))
      this.tcpServer.on('error', reject)
      this.tcpServer.listen(port, '0.0.0.0', () => {
        const addr = this.tcpServer!.address()
        if (addr && typeof addr === 'object') {
          this._tcpAddress = { host: '0.0.0.0', port: addr.port }
        }
        resolve()
      })
    })
  }

  /**
   * Register a handler for incoming messages.
   */
  onMessage(handler: PipeMessageHandler): void {
    this.handlers.push(handler)
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(msg: PipeMessage): void {
    msg.from = msg.from ?? this.name
    msg.ts = msg.ts ?? new Date().toISOString()
    const line = JSON.stringify(msg) + '\n'
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.write(line)
      }
    }
  }

  /**
   * Send to a specific socket (used for directed replies in attach flow).
   */
  sendTo(socket: Socket, msg: PipeMessage): void {
    msg.from = msg.from ?? this.name
    msg.ts = msg.ts ?? new Date().toISOString()
    if (!socket.destroyed) {
      socket.write(JSON.stringify(msg) + '\n')
    }
  }

  get connectionCount(): number {
    return this.clients.size
  }

  async close(): Promise<void> {
    for (const client of this.clients) {
      client.destroy()
    }
    this.clients.clear()
    for (const pending of this.pendingAuthClients) {
      pending.destroy()
    }
    this.pendingAuthClients.clear()

    // Close TCP server if running
    if (this.tcpServer) {
      await new Promise<void>(resolve => {
        this.tcpServer!.close(() => {
          this.tcpServer = null
          this._tcpAddress = null
          resolve()
        })
      })
    }

    return new Promise(resolve => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        this.server = null
        if (process.platform === 'win32') {
          // Remove the registry file
          const regFile = join(getPipesDir(), `${this.name}.pipe`)
          void unlink(regFile).catch(() => {})
        } else {
          void unlink(this.socketPath).catch(() => {})
        }
        resolve()
      })
    })
  }
}

// ---------------------------------------------------------------------------
// Client (connector side)
// ---------------------------------------------------------------------------

export class PipeClient extends EventEmitter {
  private socket: Socket | null = null
  private handlers: PipeMessageHandler[] = []
  readonly targetName: string
  readonly senderName: string
  readonly socketPath: string
  private tcpEndpoint: TcpEndpoint | null
  private authToken: string | null

  constructor(
    targetName: string,
    senderName?: string,
    tcpEndpoint?: TcpEndpoint,
    authToken?: string,
  ) {
    super()
    this.targetName = targetName
    this.senderName = senderName ?? `client-${process.pid}`
    this.socketPath = getPipePath(targetName)
    this.tcpEndpoint = tcpEndpoint ?? null
    this.authToken = authToken ?? null
  }

  /**
   * Connect to a pipe server (UDS or TCP).
   * When tcpEndpoint was provided in constructor, connects over TCP and
   * completes the shared-secret auth handshake before resolving.
   * Otherwise uses UDS with retry for socket file existence.
   */
  async connect(timeoutMs: number = 5000): Promise<void> {
    if (this.tcpEndpoint) {
      return this.connectTcp(timeoutMs)
    }
    return this.connectUds(timeoutMs)
  }

  private async connectTcp(timeoutMs: number): Promise<void> {
    const { host, port } = this.tcpEndpoint!
    if (!this.authToken) {
      throw new Error(
        `TCP connection to "${this.targetName}" requires authToken (LAN shared secret)`,
      )
    }
    const token = this.authToken

    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.destroy()
        reject(
          new Error(
            `TCP connection to "${this.targetName}" at ${host}:${port} timed out after ${timeoutMs}ms`,
          ),
        )
      }, timeoutMs)

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      }

      const socket = createConnection({ host, port }, () => {
        // First frame must be auth; wait for auth_ok before exposing the client.
        let buffer = ''
        const onData = (chunk: Buffer): void => {
          buffer += chunk.toString('utf8')
          const nl = buffer.indexOf('\n')
          if (nl === -1) return
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          socket.off('data', onData)
          let msg: PipeMessage
          try {
            msg = JSON.parse(line) as PipeMessage
          } catch {
            fail(
              new Error(
                `TCP auth to "${this.targetName}" failed: invalid server response`,
              ),
            )
            return
          }
          if (msg.type === 'auth_ok') {
            if (settled) return
            settled = true
            clearTimeout(timer)
            this.socket = socket
            // Replay any leftover bytes after auth_ok into the framer path
            // by re-emitting them as a synthetic data event after listeners attach.
            this.setupSocketListeners(socket)
            if (buffer.length > 0) {
              socket.emit('data', Buffer.from(buffer, 'utf8'))
            }
            this.emit('connected')
            resolve()
            return
          }
          fail(
            new Error(
              `TCP auth to "${this.targetName}" rejected: ${msg.data ?? msg.type}`,
            ),
          )
        }
        socket.on('data', onData)
        socket.write(
          JSON.stringify({
            type: 'auth',
            data: token,
            from: this.senderName,
            ts: new Date().toISOString(),
          }) + '\n',
        )
      })

      socket.on('error', err => {
        fail(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  private async connectUds(timeoutMs: number): Promise<void> {
    const { access } = await import('fs/promises')
    const deadline = Date.now() + timeoutMs
    const retryDelayMs = 300

    // Wait for socket file to exist (Unix only)
    if (process.platform !== 'win32') {
      while (Date.now() < deadline) {
        try {
          await access(this.socketPath)
          break
        } catch {
          if (Date.now() + retryDelayMs >= deadline) {
            throw new Error(
              `Pipe "${this.targetName}" not found at ${this.socketPath}. Is the server running?`,
            )
          }
          await new Promise(r => setTimeout(r, retryDelayMs))
        }
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          reject(
            new Error(
              `Connection to pipe "${this.targetName}" timed out after ${timeoutMs}ms`,
            ),
          )
        },
        Math.max(deadline - Date.now(), 1000),
      )

      const socket = createConnection({ path: this.socketPath }, () => {
        clearTimeout(timer)
        this.socket = socket
        this.setupSocketListeners(socket)
        this.emit('connected')
        resolve()
      })

      socket.on('error', err => {
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      })
    })
  }

  private setupSocketListeners(socket: Socket): void {
    attachNdjsonFramer<PipeMessage>(socket, msg => {
      this.emit('message', msg)
      const reply = (replyMsg: PipeMessage) => this.send(replyMsg)
      for (const handler of this.handlers) {
        handler(msg, reply, socket)
      }
    })

    socket.on('close', () => {
      this.emit('disconnect')
    })

    socket.on('error', err => {
      logError(err)
    })
  }

  onMessage(handler: PipeMessageHandler): void {
    this.handlers.push(handler)
  }

  send(msg: PipeMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error(`Not connected to pipe "${this.targetName}"`)
    }
    msg.from = msg.from ?? this.senderName
    msg.ts = msg.ts ?? new Date().toISOString()
    this.socket.write(JSON.stringify(msg) + '\n')
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }
}

// ---------------------------------------------------------------------------
// Convenience factory functions
// ---------------------------------------------------------------------------

export async function createPipeServer(
  name: string,
  options?: PipeServerOptions,
): Promise<PipeServer> {
  const server = new PipeServer(name)
  await server.start(options)
  return server
}

export async function connectToPipe(
  targetName: string,
  senderName?: string,
  timeoutMs?: number,
  tcpEndpoint?: TcpEndpoint,
  authToken?: string,
): Promise<PipeClient> {
  const client = new PipeClient(targetName, senderName, tcpEndpoint, authToken)
  await client.connect(timeoutMs)
  return client
}

/**
 * List all registered pipe names (fast — file scan only, no network probe).
 * Use isPipeAlive() separately to check liveness.
 */
export async function listPipes(): Promise<string[]> {
  try {
    await ensurePipesDir()
    const files = await readdir(getPipesDir())
    const ext = process.platform === 'win32' ? '.pipe' : '.sock'
    return files
      .filter(f => f.endsWith(ext))
      .map(f => f.replace(new RegExp(`\\${ext}$`), ''))
  } catch {
    return []
  }
}

/**
 * List only alive pipes (probes each one — slower, use sparingly).
 * Automatically cleans up stale registry files.
 */
export async function listAlivePipes(): Promise<string[]> {
  const names = await listPipes()
  const ext = process.platform === 'win32' ? '.pipe' : '.sock'
  const alive: string[] = []
  for (const name of names) {
    if (await isPipeAlive(name, 1000)) {
      alive.push(name)
    } else {
      const staleFile = join(getPipesDir(), `${name}${ext}`)
      void unlink(staleFile).catch(() => {})
    }
  }
  return alive
}

/**
 * Probe whether a pipe server is alive by sending a ping.
 */
export async function isPipeAlive(
  name: string,
  timeoutMs: number = 2000,
): Promise<boolean> {
  try {
    const client = new PipeClient(name, '_probe')
    await client.connect(timeoutMs)

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        client.disconnect()
        resolve(false)
      }, timeoutMs)

      client.onMessage(msg => {
        if (msg.type === 'pong') {
          clearTimeout(timer)
          client.disconnect()
          resolve(true)
        }
      })

      client.send({ type: 'ping' })
    })
  } catch {
    return false
  }
}

// ─── PipeIpc AppState extension ──────────────────────────────────────
// AppState.pipeIpc is added at runtime when feature('PIPE_IPC') is on.
// These types and the default accessor ensure safe access from hooks
// and commands without modifying the original AppStateStore.

export type PipeIpcSlaveState = {
  name: string
  connectedAt: string
  status: 'idle' | 'busy' | 'error'
  lastActivityAt?: string
  lastSummary?: string
  lastEventType?:
    | 'prompt'
    | 'prompt_ack'
    | 'stream'
    | 'tool_start'
    | 'tool_result'
    | 'done'
    | 'error'
  unreadCount?: number
  history: Array<{
    type: string
    content: string
    from: string
    timestamp: string
    meta?: Record<string, unknown>
  }>
}

export type PipeIpcState = {
  role: 'main' | 'sub' | 'master' | 'slave'
  /** Sub instance sequence number (1-based), null for main */
  subIndex: number | null
  /** Display name shown in UI. Controlled subs still display as "sub-N". */
  displayRole: string
  serverName: string | null
  attachedBy: string | null
  /** Local IP address for registry display and machine identity metadata */
  localIp: string | null
  /** Host info for registry display and machine identity metadata */
  hostname: string | null
  /** OS-level stable machine fingerprint */
  machineId: string | null
  /** Primary NIC MAC address */
  mac: string | null
  /** Show pipe status line in footer (set by /pipes command) */
  statusVisible: boolean
  /** Selector panel expanded (toggled by /pipes command) */
  selectorOpen: boolean
  /** Pipes selected for message broadcast (toggled via /pipes or status panel) */
  selectedPipes: string[]
  /** Current routing mode for normal prompts. `local` preserves selections but talks to main. */
  routeMode: 'selected' | 'local'
  slaves: Record<string, PipeIpcSlaveState>
  /** Discovered pipe entries from registry (populated by /pipes) */
  discoveredPipes: Array<{
    id: string
    pipeName: string
    role: string
    machineId: string
    ip: string
    hostname: string
    alive: boolean
  }>
}

const DEFAULT_PIPE_IPC: PipeIpcState = {
  role: 'main',
  subIndex: null,
  displayRole: 'main',
  serverName: null,
  attachedBy: null,
  localIp: null,
  hostname: null,
  machineId: null,
  mac: null,
  statusVisible: false,
  selectorOpen: false,
  selectedPipes: [],
  routeMode: 'selected',
  slaves: {},
  discoveredPipes: [],
}

export function isPipeControlled(pipeIpc: PipeIpcState): boolean {
  return Boolean(pipeIpc.attachedBy)
}

export function getPipeDisplayRole(pipeIpc: PipeIpcState): string {
  if (pipeIpc.role === 'master') {
    return 'master'
  }

  if (pipeIpc.subIndex != null) {
    return `sub-${pipeIpc.subIndex}`
  }

  return 'main'
}

/**
 * Get the local (non-loopback) IPv4 address for registry metadata.
 */
export function getLocalIp(): string {
  try {
    const { networkInterfaces } = require('os') as typeof import('os')
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address
        }
      }
    }
  } catch {}
  return '127.0.0.1'
}

/**
 * Safely read pipeIpc from AppState, returning the default if not yet initialized.
 * This avoids crashes when the state hasn't been extended by the PIPE_IPC bootstrap.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPipeIpc(state: any): PipeIpcState {
  return state?.pipeIpc ?? DEFAULT_PIPE_IPC
}
