/**
 * densable `vIt` — Monitor({ws}) via `ws` (proxy / tls / maxPayload / cf-mitigated).
 */
import { lookup as dnsLookup } from 'dns/promises'
import type { Agent, IncomingMessage } from 'http'
import { isIP } from 'net'
import type { ConnectionOptions } from 'tls'
import WebSocket from 'ws'
import { monitorSocketRegistry, oF } from '../services/artifactAutoReact/oF.js'
import {
  createTaskStateBase,
  generateTaskId,
  type SetAppState,
} from '../Task.js'
import type { MonitorWsFrameLive } from '../tasks/MonitorWsTask/MonitorWsTask.js'
import type { AgentId } from '../types/ids.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { isBlockedAddress } from './hooks/ssrfGuard.js'
import {
  createMonitorStreamPump,
  monitorExpiredEvent,
  notifyMonitorStreamEvent,
} from './monitorStreamNotify.js'
import { getWebSocketTLSOptions } from './mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from './proxy.js'
import {
  addKeepaliveReason,
  monitorKeepaliveReason,
  removeKeepaliveReason,
} from './task/framework.js'
import type { TaskRegistry } from './taskRegistry.js'

const MAX_PAYLOAD = 1_048_576
const HANDSHAKE_MS = 30_000

export class MonitorWsPreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonitorWsPreconditionError'
  }
}

export type MonitorWsSpawnInput = {
  url: string
  protocols?: string[]
  description: string
  timeoutMs: number
  persistent: boolean
  toolUseId?: string
  agentId?: AgentId
  setAppState: SetAppState
  taskRegistry: TaskRegistry
  keepalive?: {
    intervalMs: number
    frame: string | string[] | (() => string[])
    deadlineMs?: number
    sendEveryMs: number
    openFrames?: string[]
  }
  handshakeDeadlineMs?: number
  quietLifecycle?: boolean
  /** densable vIt `e.ambient` — handshake 30s only when set. */
  ambient?: boolean
  headers?: Record<string, string>
  /** densable vIt `e.transform` — null drops the frame. */
  transform?: (text: string) => string | null
  /** densable vIt `e.onSender` — send hook after open. */
  onSender?: (send: (frame: string) => void) => void
  onSenderClosed?: () => void
  reuseTaskId?: string
  bounded?: boolean
  autoReactArmed?: boolean
  autoReactSlug?: string
  frameLive?: MonitorWsFrameLive
  onLifecycle?: (
    event: 'open' | 'close',
    extra: string | undefined,
    durationMs: number,
  ) => void
}

function frameBytes(data: WebSocket.RawData): number {
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0)
  if (data instanceof ArrayBuffer) return data.byteLength
  return data.length
}

export type ResolveMonitorWsOptions = {
  proxy?: string | Agent
  tls?: ConnectionOptions
}

/**
 * densable `ue(e, n)` @194294560 — SSRF check + Host-header IP pin only for
 * direct unproxied `ws:`. When `proxy` is configured or `parsed.protocol === 'wss:'`,
 * dial the original URL directly without IP-rewriting or local CONNECT tunneling.
 */
export async function resolveMonitorWsUrl(
  url: string,
  opts: ResolveMonitorWsOptions = {},
  lookup: typeof dnsLookup = dnsLookup,
): Promise<{
  url: string
  headers?: Record<string, string>
  tls?: ConnectionOptions
}> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new MonitorWsPreconditionError(`could not resolve ${url}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new MonitorWsPreconditionError(
        `${host} is in a private, link-local, or cloud-metadata range`,
      )
    }
    return { url, ...(opts.tls !== undefined ? { tls: opts.tls } : {}) }
  }
  if (opts.proxy) {
    return { url, ...(opts.tls !== undefined ? { tls: opts.tls } : {}) }
  }
  let records: Array<{ address: string; family: number }>
  try {
    records = await lookup(host, { all: true })
  } catch (err) {
    throw new MonitorWsPreconditionError(
      `could not resolve ${host}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (records.length === 0) {
    throw new MonitorWsPreconditionError(`could not resolve ${host}`)
  }
  for (const rec of records) {
    if (isBlockedAddress(rec.address)) {
      throw new MonitorWsPreconditionError(
        `${host} resolves to ${rec.address}, which is in a private, link-local, or cloud-metadata range`,
      )
    }
  }
  if (parsed.protocol === 'wss:') {
    return { url, ...(opts.tls !== undefined ? { tls: opts.tls } : {}) }
  }
  const v4 = records.find(r => r.family === 4) ?? records[0]!
  const originalHost = parsed.host
  parsed.hostname = v4.family === 6 ? `[${v4.address}]` : v4.address
  return {
    url: parsed.toString(),
    headers: { Host: originalHost },
    ...(opts.tls !== undefined ? { tls: opts.tls } : {}),
  }
}

function stripHostHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue
    out[k] = v
  }
  return out
}

function upgradeRejectCode(status: number, cfMitigated: boolean): string {
  const s =
    Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0
  return `${cfMitigated ? 'cf_mitigated' : 'upgrade_rejected'}_${s}`
}

export async function spawnMonitorWebSocket(
  input: MonitorWsSpawnInput,
): Promise<{ taskId: string }> {
  if (
    input.protocols?.some(
      protocol => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(protocol),
    ) ||
    new Set(input.protocols).size !== (input.protocols?.length ?? 0)
  ) {
    throw new Error('WebSocket protocols must be unique, non-empty HTTP tokens')
  }
  const registry = input.taskRegistry
  const taskId = input.reuseTaskId ?? generateTaskId('monitor_ws')
  const startedAt = Date.now()
  const taskRef: { id?: string } = { id: taskId }
  let socket: WebSocket | undefined
  let closeHandle: (() => void) | undefined
  const pump = createMonitorStreamPump({
    description: input.description,
    agentId: input.agentId,
    taskRef,
    isStopped: () => {
      const task = registry.get(taskId)
      return task === undefined || task.status === 'killed'
    },
    killTask: () => {
      if (
        closeHandle === undefined ||
        monitorSocketRegistry.get(taskId)?.close !== closeHandle
      ) {
        return false
      }
      oF(taskId, registry as unknown as Parameters<typeof oF>[1], {
        quiet: true,
      })
      return true
    },
  })

  const proxyUrl =
    typeof Bun !== 'undefined' ? getWebSocketProxyUrl(input.url) : undefined
  const agent =
    typeof Bun === 'undefined' ? getWebSocketProxyAgent(input.url) : undefined
  const tls = getWebSocketTLSOptions()
  const resolved = await resolveMonitorWsUrl(input.url, {
    proxy: proxyUrl ?? agent,
    tls,
  })
  const extraHeaders = stripHostHeaders(input.headers ?? {})
  const abortController = new AbortController()
  const timeoutId = input.persistent
    ? undefined
    : setTimeout(() => {
        if (pump.isClosed()) return
        if (!input.quietLifecycle) {
          pump.flush()
          if (pump.isClosed()) return
          notifyMonitorStreamEvent(
            input.description,
            monitorExpiredEvent(
              input.timeoutMs,
              pump.eventCount(),
              input.bounded === true,
            ),
            taskId,
            { isHousekeeping: true, agentId: input.agentId },
          )
        }
        oF(taskId, registry as unknown as Parameters<typeof oF>[1], {
          quiet: true,
        })
      }, input.timeoutMs)
  timeoutId?.unref?.()

  registry.register({
    ...createTaskStateBase(
      taskId,
      'monitor_ws',
      input.description,
      input.toolUseId,
    ),
    type: 'monitor_ws',
    status: 'running',
    url: input.url,
    ...(timeoutId !== undefined ? { timeoutId } : {}),
    agentId: input.agentId,
    abortController,
    ...(input.ambient === true ? { ambient: true } : {}),
    ...(input.autoReactArmed === true ? { autoReactArmed: true } : {}),
    ...(input.autoReactSlug !== undefined
      ? { autoReactSlug: input.autoReactSlug }
      : {}),
    ...(input.frameLive !== undefined
      ? { frameLive: { ...input.frameLive, armedAt: Date.now() } }
      : {}),
  })
  if (input.agentId) {
    addKeepaliveReason(input.agentId, monitorKeepaliveReason(taskId), registry)
  }
  const unregisterCleanup = registerCleanup(async () => {
    oF(taskId, registry as unknown as Parameters<typeof oF>[1], { quiet: true })
  })

  try {
    socket = new WebSocket(resolved.url, input.protocols, {
      ...(typeof Bun !== 'undefined'
        ? proxyUrl
          ? { proxy: proxyUrl }
          : {}
        : agent !== undefined
          ? { agent }
          : {}),
      ...resolved.tls,
      ...(resolved.tls ? { tls: resolved.tls } : {}),
      headers: { ...extraHeaders, ...(resolved.headers ?? {}) },
      maxPayload: MAX_PAYLOAD,
    })
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    unregisterCleanup()
    oF(taskId, registry as unknown as Parameters<typeof oF>[1], { quiet: true })
    throw error
  }
  const sock = socket
  const terminate = (): void => {
    unregisterCleanup()
    if (keepaliveTimer) clearInterval(keepaliveTimer)
    if (timeoutId) clearTimeout(timeoutId)
    pump.dropAndClose()
    try {
      sock.terminate()
    } catch {
      // already closed
    }
  }
  closeHandle = terminate
  // gold Hnr / `D=()=>E1n(i,l)` — register including CONNECTING so oF can close.
  monitorSocketRegistry.set(taskId, { close: terminate })
  abortController.signal.addEventListener('abort', terminate, { once: true })
  let lastActivity = Date.now()
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined
  let upgradeReject: string | undefined
  // gold `D=()=>E1n(i,l)` — socket still registered, including CONNECTING.
  // OPEN would skip unexpected-response / handshake error j6.
  let live = true
  const stillRunning = (): boolean =>
    live &&
    monitorSocketRegistry.get(taskId)?.close === terminate &&
    registry.get(taskId)?.status === 'running'

  sock.on('open', () => {
    if (!stillRunning()) return
    try {
      input.onLifecycle?.('open', undefined, Date.now() - startedAt)
    } catch {
      // ignore
    }
    const ka = input.keepalive
    if (ka) {
      for (const frame of ka.openFrames ?? []) {
        try {
          sock.send(frame)
        } catch {
          // ignore
        }
      }
      lastActivity = Date.now()
      const stamp = { lastAt: lastActivity }
      keepaliveTimer = setInterval(() => {
        const now = Date.now()
        if (ka.deadlineMs !== undefined && now - lastActivity > ka.deadlineMs) {
          try {
            sock.terminate()
          } catch {
            // ignore
          }
          return
        }
        let every = ka.sendEveryMs
        try {
          const dyn =
            typeof ka.sendEveryMs === 'function'
              ? (ka.sendEveryMs as () => number)()
              : ka.sendEveryMs
          every = dyn ?? ka.intervalMs
        } catch {
          every = ka.intervalMs
        }
        if (
          !(
            ka.deadlineMs !== undefined &&
            now - lastActivity > ka.deadlineMs - every * 2
          ) &&
          now - stamp.lastAt < every - ka.intervalMs / 2
        ) {
          return
        }
        stamp.lastAt = now
        const frames =
          typeof ka.frame === 'function'
            ? ka.frame()
            : typeof ka.frame === 'string'
              ? [ka.frame]
              : ka.frame
        for (const frame of frames) {
          try {
            sock.send(frame)
          } catch {
            // ignore
          }
        }
      }, ka.intervalMs)
      keepaliveTimer.unref?.()
    }
    if (input.onSender && stillRunning()) {
      try {
        input.onSender((frame: string) => {
          sock.send(frame)
        })
      } catch {
        // ignore
      }
    }
  })

  sock.on('ping', () => {
    lastActivity = Date.now()
  })

  sock.on('message', (data, isBinary) => {
    if (!stillRunning()) return
    lastActivity = Date.now()
    const n = frameBytes(data)
    if (n > MAX_PAYLOAD) {
      notifyMonitorStreamEvent(
        input.description,
        `[Dropped ${n}-byte frame (exceeds ${MAX_PAYLOAD}); closing]`,
        taskId,
        {
          isHousekeeping: true,
          agentId: input.agentId,
          turnAttribution: 'none',
        },
      )
      oF(taskId, registry as unknown as Parameters<typeof oF>[1], {
        quiet: true,
      })
      return
    }
    if (isBinary) {
      if (typeof input.transform === 'function') return
      pump.onData(`[binary frame, ${n} bytes]\n`)
      return
    }
    let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
    if (typeof input.transform === 'function') {
      let next: string | null
      try {
        next = input.transform(text)
      } catch {
        next = null
      }
      if (next === null) return
      text = next
    }
    pump.onData(`${text}\n`)
  })

  // densable vIt @194298050 — register unconditionally (on Bun Windows 101 may
  // fire here too; `if (g === 101) return` ignores a working upgrade).
  sock.on('unexpected-response', (_req, res: IncomingMessage | undefined) => {
    const g = res?.statusCode ?? 0
    if (g === 101) return
    const headers = res?.headers ?? {}
    const cf = headers['cf-mitigated'] !== undefined
    upgradeReject = upgradeRejectCode(g, cf)
    logForDebugging(
      `[callWs] upgrade rejected: status=${g} cf-mitigated=${String(headers['cf-mitigated'])} cf-ray=${String(headers['cf-ray'])}`,
    )
    res?.resume?.()
    if (!input.quietLifecycle && stillRunning()) {
      notifyMonitorStreamEvent(
        input.description,
        `[WebSocket upgrade rejected: HTTP ${g}]`,
        taskId,
        {
          isHousekeeping: true,
          agentId: input.agentId,
          turnAttribution: 'none',
        },
      )
    }
    try {
      sock.terminate()
    } catch {
      // ignore
    }
  })

  sock.on('error', (err: Error) => {
    if (keepaliveTimer) clearInterval(keepaliveTimer)
    try {
      input.onSenderClosed?.()
    } catch {
      // ignore
    }
    logForDebugging(`[callWs] socket error: ${err.message}`)
    if (
      !input.quietLifecycle &&
      upgradeReject === undefined &&
      stillRunning()
    ) {
      notifyMonitorStreamEvent(
        input.description,
        `[WebSocket error: ${err.message}]`,
        taskId,
        {
          isHousekeeping: true,
          agentId: input.agentId,
          turnAttribution: 'none',
        },
      )
    }
  })

  const finish = (code: number, reason: Buffer): void => {
    if (timeoutId) clearTimeout(timeoutId)
    if (keepaliveTimer) clearInterval(keepaliveTimer)
    const wasRunning = stillRunning()
    if (wasRunning) pump.flushAndClose()
    else pump.dropAndClose()
    try {
      input.onSenderClosed?.()
    } catch {
      // ignore
    }
    live = false
    unregisterCleanup()
    if (!wasRunning) {
      if (monitorSocketRegistry.get(taskId)?.close === terminate) {
        monitorSocketRegistry.delete(taskId)
      }
      const current = registry.get(taskId)
      if (
        input.agentId &&
        (!current ||
          ('abortController' in current &&
            current.abortController === abortController))
      ) {
        removeKeepaliveReason(
          input.agentId,
          monitorKeepaliveReason(taskId),
          registry,
        )
      }
      return
    }
    try {
      input.onLifecycle?.(
        'close',
        upgradeReject ?? String(code),
        Date.now() - startedAt,
      )
    } catch {
      // ignore
    }
    if (!input.quietLifecycle) {
      const extra = reason.length ? ` ${reason.toString('utf8')}` : ''
      notifyMonitorStreamEvent(
        input.description,
        `[WebSocket closed: ${code}${extra}]`,
        taskId,
        {
          isHousekeeping: true,
          agentId: input.agentId,
          turnAttribution: 'none',
        },
      )
    }
    oF(taskId, registry as unknown as Parameters<typeof oF>[1], {
      quiet: true,
      connectionLost: true,
    })
  }
  sock.on('close', finish)

  sock.once('close', () => {
    if (timeoutId) clearTimeout(timeoutId)
  })
  // gold: handshake 30s only when `e.ambient`
  if (input.ambient) {
    const handshakeMs = input.handshakeDeadlineMs ?? HANDSHAKE_MS
    const handshake = setTimeout(() => {
      if (
        sock.readyState === WebSocket.CONNECTING &&
        monitorSocketRegistry.get(taskId)?.close === terminate
      ) {
        try {
          input.onLifecycle?.(
            'close',
            'handshake_timeout',
            Date.now() - startedAt,
          )
        } catch {
          // ignore
        }
        oF(taskId, registry as unknown as Parameters<typeof oF>[1], {
          quiet: true,
          connectionLost: true,
        })
      }
    }, handshakeMs)
    handshake.unref?.()
    abortController.signal.addEventListener(
      'abort',
      () => clearTimeout(handshake),
      { once: true },
    )
    sock.once('open', () => {
      clearTimeout(handshake)
    })
    sock.once('close', () => {
      clearTimeout(handshake)
    })
  }

  return { taskId }
}
