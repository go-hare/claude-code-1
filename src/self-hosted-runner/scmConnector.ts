/**
 * densable 2.1.224 kFh — SCM connector WebSocket tunnel (orchestrator-side).
 * Recovered 1:1 from SEA `fn-kFh-full.js` + constants around 267405519.
 *
 * Forwards HTTP requests from the control plane over WS to an on-prem SCM host
 * (GHES etc.). WebSocket/PTY tunnels are explicitly unsupported.
 */
import { readFile } from 'node:fs/promises'
import { withTimeoutMs } from './rootRunner.js'
import { truncateSessionErrorText } from './sessionText.js'

/** densable `aqv` */
export const SCM_TUNNEL_PATH_TEMPLATE =
  '/v1/code/scm-connectors/{provider}/{id}/tunnel'
/** densable `TFh` — standby close code (another orchestrator holds connector) */
export const SCM_STANDBY_CLOSE_CODE = 4003
/** densable `lqv` */
export const SCM_STANDBY_RETRY_MS = 30_000
/** densable `vFh` */
export const SCM_RECONNECT_BASE_MS = 1_000
/** densable `EFh` */
export const SCM_RECONNECT_MAX_MS = 30_000
/** densable `cqv` */
export const SCM_WS_OPEN_TIMEOUT_MS = 10_000
/** densable `uqv` */
export const SCM_WS_PING_INTERVAL_MS = 30_000
/** densable `wFh` */
export const SCM_HTTP_CHUNK_BYTES = 32_768
/** densable `dqv` */
export const SCM_WS_BUFFER_HIGH = 4_194_304
/** densable `pqv` */
export const SCM_WS_BUFFER_LOW = 1_048_576
/** densable `fqv` */
export const SCM_BUFFER_POLL_MS = 50
/** densable `mqv` */
export const SCM_HTTP_FORWARD_TIMEOUT_MS = 30_000
/** densable `hqv` */
export const SCM_CA_FILE_READ_TIMEOUT_MS = 10_000

export const SCM_ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
])

export const SCM_HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
])

export type ScmConnectorConfig = {
  provider: string
  connectorId: string | number
  host: string
  port: number
  caFile?: string
  hostRewrite?: {
    from: string
    toHost: string
    toPort: number
  }
}

export type ScmConnectorHealth = {
  connected: boolean
  last_connected_at: number | null
  last_error: string | null
  reconnects: number
  requests_forwarded: number
}

export type ScmConnectorRuntime = {
  apiUrl: string
  poolSecret: string
  onStatus: (msg: string) => void
  onDebug: (msg: string) => void
}

/** densable `Sqv` */
export function buildScmTunnelWsUrl(
  apiUrl: string,
  cfg: Pick<ScmConnectorConfig, 'provider' | 'connectorId'>,
): string {
  const path = SCM_TUNNEL_PATH_TEMPLATE.replace(
    '{provider}',
    encodeURIComponent(cfg.provider),
  ).replace('{id}', String(cfg.connectorId))
  return apiUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + path
}

/** densable `yqv` — validate absolute path; null if ok, else error message */
export function validateScmHttpPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) {
    return 'path must be a non-empty string'
  }
  if (path[0] !== '/') return 'path must start with /'
  if (path[1] === '/') return 'path must not start with // (scheme-relative)'
  if (path[1] === '@') return 'path must not start with /@'
  if (path.includes('\\')) return 'path must not contain backslash'
  return null
}

/**
 * densable `bqv` — build absolute URL for dial host/port + path without escape.
 */
export function buildScmDialUrl(host: string, port: number, path: string): URL {
  const base = new URL('https://placeholder.invalid/')
  base.host = `${host}:${port}`
  if (base.hostname === 'placeholder.invalid') {
    throw new Error('scm-connector dial host is not a valid URL host')
  }
  const origin = base.origin
  const q = path.indexOf('?')
  base.pathname = q >= 0 ? path.slice(0, q) : path
  base.search = q >= 0 ? path.slice(q) : ''
  if (base.origin !== origin || base.username !== '' || base.password !== '') {
    throw new Error('path escaped the configured origin')
  }
  return base
}

export type ScmConnectorHandle = {
  stop: () => void
}

type WsLike = {
  readyState: number
  bufferedAmount: number
  send: (data: string) => void
  close: () => void
  ping?: () => void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: { code: number; reason?: string }) => void) | null
}

type WsCtor = new (
  url: string,
  opts?: { headers?: Record<string, string> },
) => WsLike

/**
 * densable `kFh` — start SCM connector tunnel loop.
 * Uses globalThis.WebSocket (Bun). Injectable for tests via opts.WebSocket.
 */
export function startScmConnector(
  cfg: ScmConnectorConfig,
  health: ScmConnectorHealth,
  runtime: ScmConnectorRuntime,
  signal?: AbortSignal,
  inject?: {
    WebSocket?: WsCtor
    fetch?: typeof fetch
    now?: () => number
  },
): ScmConnectorHandle {
  const WS = inject?.WebSocket ?? (globalThis.WebSocket as unknown as WsCtor)
  const fetchFn = inject?.fetch ?? globalThis.fetch.bind(globalThis)
  const now = inject?.now ?? Date.now

  const tunnelUrl = buildScmTunnelWsUrl(runtime.apiUrl, cfg)
  const dialHost =
    cfg.hostRewrite && cfg.hostRewrite.from === cfg.host.toLowerCase()
      ? cfg.hostRewrite.toHost
      : cfg.host
  const dialPort =
    cfg.hostRewrite && cfg.hostRewrite.from === cfg.host.toLowerCase()
      ? cfg.hostRewrite.toPort
      : cfg.port

  let stopped = false
  let ws: WsLike | null = null
  let openTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let backoff = SCM_RECONNECT_BASE_MS
  let lastConnectAttemptAt = 0
  let caLoaded = cfg.caFile === undefined
  let caPem: string | undefined
  const inflight = new Map<string, AbortController>()

  const setErr = (msg: string): void => {
    health.last_error = truncateSessionErrorText(msg)
  }
  const status = (msg: string): void => {
    runtime.onStatus(`[runner:scm-connector] ${msg}`)
  }
  const debug = (msg: string): void => {
    runtime.onDebug(`[runner:scm-connector] ${msg}`)
  }

  const sendJson = (payload: unknown): void => {
    const sock = ws
    if (!sock || sock.readyState !== 1 /* OPEN */) return
    try {
      sock.send(JSON.stringify(payload))
    } catch (err) {
      setErr(err instanceof Error ? err.message : String(err))
      status(`send failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const sendHttpError = (requestId: string, errorMessage: string): void => {
    sendJson({ httpError: { requestId, errorMessage } })
  }

  const waitBuffer = (abort: AbortSignal): Promise<void> => {
    const sock = ws
    if (
      !sock ||
      sock.readyState !== 1 ||
      sock.bufferedAmount <= SCM_WS_BUFFER_HIGH
    ) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      const iv = setInterval(() => {
        if (
          stopped ||
          abort.aborted ||
          ws !== sock ||
          sock.readyState !== 1 ||
          sock.bufferedAmount <= SCM_WS_BUFFER_LOW
        ) {
          clearInterval(iv)
          resolve()
        }
      }, SCM_BUFFER_POLL_MS)
    })
  }

  const handleHttpRequest = async (req: {
    requestId?: string
    path?: string
    method?: string
    headers?: Array<{ name?: string; value?: string }>
    body?: string
    port?: number
  }): Promise<void> => {
    const requestId = req.requestId
    if (!requestId) return
    if (req.port !== undefined && req.port !== 0 && req.port !== cfg.port) {
      sendHttpError(
        requestId,
        `port ${req.port} does not match this connector's configured port ${cfg.port}`,
      )
      return
    }
    const pathErr = validateScmHttpPath(req.path)
    if (pathErr) {
      sendHttpError(requestId, pathErr)
      return
    }
    const path = req.path!
    const method = (req.method ?? 'GET').toUpperCase()
    if (!SCM_ALLOWED_METHODS.has(method)) {
      sendHttpError(requestId, 'method not allowed')
      return
    }
    let url: URL
    try {
      url = buildScmDialUrl(dialHost, dialPort, path)
    } catch (err) {
      sendHttpError(requestId, err instanceof Error ? err.message : String(err))
      return
    }
    const ac = new AbortController()
    inflight.set(requestId, ac)
    const timer = setTimeout(() => ac.abort(), SCM_HTTP_FORWARD_TIMEOUT_MS)
    let response: Response
    try {
      const headers = new Headers()
      for (const h of req.headers ?? []) {
        if (!h.name || SCM_HOP_BY_HOP_HEADERS.has(h.name.toLowerCase())) {
          continue
        }
        headers.append(h.name, h.value ?? '')
      }
      headers.set(
        'Host',
        cfg.port === 443 ? cfg.host : `${cfg.host}:${cfg.port}`,
      )
      const body =
        req.body !== undefined && req.body !== ''
          ? Buffer.from(req.body, 'base64')
          : undefined
      response = await fetchFn(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: ac.signal,
        // Bun supports tls; keep optional for node-compat
        ...(caPem !== undefined || dialHost !== cfg.host
          ? ({ tls: { ca: caPem, serverName: cfg.host } } as RequestInit)
          : {}),
      })
    } catch (err) {
      clearTimeout(timer)
      inflight.delete(requestId)
      const msg = err instanceof Error ? err.message : String(err)
      setErr(`forward to ${cfg.host}: ${msg}`)
      sendHttpError(requestId, msg)
      return
    }
    clearTimeout(timer)
    const outHeaders: Array<{ name: string; value: string }> = []
    response.headers.forEach((value, name) => {
      outHeaders.push({ name, value })
    })
    let seq = 0
    sendJson({
      httpHeaders: {
        requestId,
        statusCode: response.status,
        statusText: response.statusText || String(response.status),
        headers: outHeaders,
        sequenceNumber: seq,
      },
    })
    seq++
    try {
      if (response.body) {
        const reader = response.body.getReader()
        for (;;) {
          await waitBuffer(ac.signal)
          if (ac.signal.aborted) {
            await reader.cancel()
            break
          }
          const chunk = await reader.read()
          if (chunk.value && chunk.value.length > 0) {
            for (let i = 0; i < chunk.value.length; i += SCM_HTTP_CHUNK_BYTES) {
              const slice = chunk.value.subarray(i, i + SCM_HTTP_CHUNK_BYTES)
              sendJson({
                httpChunk: {
                  requestId,
                  data: Buffer.from(slice).toString('base64'),
                  isFinal: false,
                  sequenceNumber: seq,
                },
              })
              seq++
            }
          }
          if (chunk.done) break
          if (ac.signal.aborted) {
            await reader.cancel()
            break
          }
        }
      }
      sendJson({
        httpChunk: {
          requestId,
          data: '',
          isFinal: true,
          sequenceNumber: seq,
        },
      })
      health.requests_forwarded++
    } catch (err) {
      sendHttpError(
        requestId,
        `error reading GHES response body: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    } finally {
      inflight.delete(requestId)
    }
  }

  const onMessage = (raw: string): void => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      status(
        `failed to parse tunnel request: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return
    }
    if (msg.httpRequest) {
      handleHttpRequest(msg.httpRequest as never).catch(err => {
        setErr(err instanceof Error ? err.message : String(err))
        status(
          `handleHttpRequest failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      })
    } else if (msg.httpCancel) {
      const id = (msg.httpCancel as { requestId?: string }).requestId
      if (id) {
        inflight.get(id)?.abort()
        inflight.delete(id)
      }
    } else if (msg.wsOpen) {
      sendJson({
        wsError: {
          tunnelId: (msg.wsOpen as { tunnelId?: string }).tunnelId ?? '',
          errorMessage:
            'WebSocket tunnel is not supported by the SCM connector',
        },
      })
    } else if (msg.ptyOpen) {
      sendJson({
        ptyError: {
          tunnelId: (msg.ptyOpen as { tunnelId?: string }).tunnelId ?? '',
          errorMessage: 'PTY tunnel is not supported by the SCM connector',
        },
      })
    }
  }

  const scheduleReconnect = (closeCode?: number): void => {
    if (stopped) return
    health.reconnects++
    let delay: number
    if (closeCode === SCM_STANDBY_CLOSE_CODE) {
      delay = SCM_STANDBY_RETRY_MS
      status(
        `standby (close code ${closeCode}): another orchestrator holds connector ${cfg.connectorId}; retrying in ${delay / 1000}s`,
      )
    } else {
      if (
        lastConnectAttemptAt > 0 &&
        now() - lastConnectAttemptAt > SCM_RECONNECT_MAX_MS
      ) {
        backoff = SCM_RECONNECT_BASE_MS
      }
      delay = backoff + Math.floor(Math.random() * (backoff / 2))
      backoff = Math.min(backoff * 2, SCM_RECONNECT_MAX_MS)
      debug(`reconnecting in ${delay}ms`)
    }
    lastConnectAttemptAt = 0
    reconnectTimer = setTimeout(connect, delay)
  }

  const connect = (): void => {
    if (stopped) return
    reconnectTimer = null
    if (!caLoaded && cfg.caFile) {
      withTimeoutMs(
        readFile(cfg.caFile, 'utf8'),
        SCM_CA_FILE_READ_TIMEOUT_MS,
        `--scm-connector-ca-file read from ${cfg.caFile}`,
      )
        .then(pem => {
          caPem = pem
          caLoaded = true
        })
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err)
          setErr(`reading --scm-connector-ca-file: ${msg}`)
          status(`reading --scm-connector-ca-file: ${msg}`)
        })
    }
    let sock: WsLike
    try {
      sock = new WS(tunnelUrl, {
        headers: { Authorization: `Bearer ${runtime.poolSecret}` },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErr(msg)
      status(`WebSocket construct failed: ${msg}`)
      scheduleReconnect()
      return
    }
    ws = sock
    openTimer = setTimeout(() => {
      setErr('WebSocket open timeout')
      sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null
      try {
        sock.close()
      } catch {
        /* ignore */
      }
      if (ws === sock) ws = null
      scheduleReconnect()
    }, SCM_WS_OPEN_TIMEOUT_MS)

    sock.onopen = () => {
      if (openTimer) {
        clearTimeout(openTimer)
        openTimer = null
      }
      health.connected = true
      health.last_connected_at = now()
      health.last_error = null
      lastConnectAttemptAt = now()
      status(
        `connected provider=${cfg.provider} connector_id=${cfg.connectorId} forward=${cfg.host}:${cfg.port}${
          dialHost !== cfg.host ? ` (dial=${dialHost}:${dialPort})` : ''
        }`,
      )
      pingTimer = setInterval(() => {
        if (sock.readyState === 1) sock.ping?.()
      }, SCM_WS_PING_INTERVAL_MS)
    }
    sock.onmessage = ev => {
      const data =
        typeof ev.data === 'string'
          ? ev.data
          : Buffer.from(ev.data as ArrayBuffer).toString('utf8')
      onMessage(data)
    }
    sock.onerror = ev => {
      const msg =
        ev !== null &&
        typeof ev === 'object' &&
        'message' in ev &&
        typeof (ev as { message?: unknown }).message === 'string'
          ? (ev as { message: string }).message
          : 'WebSocket error'
      setErr(msg)
    }
    sock.onclose = ev => {
      health.connected = false
      if (openTimer) {
        clearTimeout(openTimer)
        openTimer = null
      }
      if (pingTimer) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      for (const ac of inflight.values()) ac.abort()
      inflight.clear()
      if (ws === sock) ws = null
      if (ev.code !== SCM_STANDBY_CLOSE_CODE) {
        status(`closed code=${ev.code} reason=${ev.reason || '(none)'}`)
      }
      scheduleReconnect(ev.code)
    }
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    for (const ac of inflight.values()) ac.abort()
    inflight.clear()
    health.connected = false
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    ws = null
    status('stopped')
  }

  signal?.addEventListener('abort', stop, { once: true })
  status(
    `starting provider=${cfg.provider} connector_id=${cfg.connectorId} url=${tunnelUrl}`,
  )
  connect()
  return { stop }
}
