/**
 * Official 2.1.331 chunk `#332` (`sve`/`Rf`/`aqt`/`G8i`/`Xut`/`y2`/`t_n`/`YK`)
 * and chunk `#2194` (`Ve`/`XQn`/`je`/`He`/`Oe`/`ne`/`Z`):
 * Desktop App host predicates, per-host remote-tools transport state, bridge
 * WebSocket URL validation/resolution, and the `RemoteToolsBridgeClient`.
 *
 * Uses only standard Web/Node APIs (`URL`, `globalThis.WebSocket`, `Buffer`,
 * `setTimeout`/`setInterval`) so Bun and Node runtimes behave identically.
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  getBootstrapSessionHost,
  HostSlot,
  type SessionHost,
} from '../../utils/sessionHost.js'

// ============================================================================
// Constants (Official 2.1.331 chunk #2194)
// ============================================================================

export const REMOTE_TOOLS_BRIDGE_PROD_URL = 'wss://bridge.claudeusercontent.com'

export const REMOTE_TOOLS_BRIDGE_STAGING_URL =
  'wss://bridge-staging.claudeusercontent.com'

/** 32 MiB maximum WebSocket frame payload size. */
export const REMOTE_TOOLS_BRIDGE_MAX_FRAME_BYTES = 33_554_432

/** Symbol tracking the active device-bridge token expiration deadline (ms). */
export const DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL = Symbol(
  'device-bridge-token-deadline',
)

// ============================================================================
// Per-Host State via HostSlot (Official 2.1.331 chunk #332)
// ============================================================================

type RemoteToolsTransportHostState = {
  desktopAppHostOverride: boolean | undefined
  desktopAppTakenAway: boolean
  takesMachinesMcpToolsAlone: boolean
  pinStoredLoginOverride: boolean | undefined
}

const remoteToolsTransportHostSlot =
  new HostSlot<RemoteToolsTransportHostState>(() => ({
    desktopAppHostOverride: undefined,
    desktopAppTakenAway: false,
    takesMachinesMcpToolsAlone: false,
    pinStoredLoginOverride: undefined,
  }))

function getTransportHostState(
  host?: SessionHost,
): RemoteToolsTransportHostState {
  return remoteToolsTransportHostSlot.of(host ?? getBootstrapSessionHost())
}

/**
 * Official 2.1.331 chunk `#332`: true when the current host is the Desktop App
 * hosting a tenant session (either via env or per-host override).
 */
export function isDesktopAppHostingTenant(host?: SessionHost): boolean {
  const resolvedHost = host ?? getBootstrapSessionHost()
  const slot = remoteToolsTransportHostSlot.of(resolvedHost)
  return (
    slot.desktopAppHostOverride ??
    (resolvedHost.launchOptions.desktopAppHostsTenant() ||
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_TOOLS_DESKTOP_APP_HOST))
  )
}

export function setDesktopAppHostOverride(
  override: boolean | undefined,
  host?: SessionHost,
): void {
  getTransportHostState(host).desktopAppHostOverride = override
}

/**
 * Official 2.1.331 chunk `#332`: whether the Desktop App has been taken away
 * from this host session.
 */
export function isDesktopAppTakenAway(host?: SessionHost): boolean {
  return getTransportHostState(host).desktopAppTakenAway
}

export function setDesktopAppTakenAway(
  taken: boolean,
  host?: SessionHost,
): void {
  getTransportHostState(host).desktopAppTakenAway = taken
}

/**
 * Official 2.1.331 chunk `#332`: true when this host adopts machines' MCP tools
 * directly without forwarding native tools over `_host`.
 */
export function takesMachinesMcpToolsAlone(host?: SessionHost): boolean {
  return getTransportHostState(host).takesMachinesMcpToolsAlone
}

export function setTakesMachinesMcpToolsAlone(
  alone: boolean,
  host?: SessionHost,
): void {
  getTransportHostState(host).takesMachinesMcpToolsAlone = alone
}

/**
 * Official 2.1.331 chunk `#332`: whether remote tools should pin the stored
 * login for bridge/device authentication.
 */
export function isRemoteToolsPinStoredLogin(host?: SessionHost): boolean {
  return (
    getTransportHostState(host).pinStoredLoginOverride ??
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_TOOLS_PIN_STORED_LOGIN)
  )
}

export function setRemoteToolsPinStoredLoginOverride(
  override: boolean | undefined,
  host?: SessionHost,
): void {
  getTransportHostState(host).pinStoredLoginOverride = override
}

/**
 * Official 2.1.331 chunk `#332` (`y2` / `YK`): true when forwarding to attached
 * machines is enabled and this host is neither a Desktop App hosting tenant nor
 * taking machines' MCP tools alone.
 */
export function canForwardToAttachedMachines(host?: SessionHost): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD) &&
    !isDesktopAppHostingTenant(host) &&
    !takesMachinesMcpToolsAlone(host)
  )
}

// ============================================================================
// Bridge WebSocket URL & Transport Selection (Official 2.1.331 chunk #2194)
// ============================================================================

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

/**
 * Official 2.1.331 chunk `#2194`: validates a bridge WebSocket URL.
 * - Rejects empty strings, control characters, and embedded userinfo (`username`/`password`).
 * - Allows `wss:` unconditionally.
 * - Allows `ws:` ONLY when `allowLoopbackWs` is true AND hostname is loopback
 *   (`127.0.0.1`, `localhost`, or `::1`).
 */
export function validateBridgeWebSocketUrl(
  raw: string,
  opts?: { allowLoopbackWs?: boolean },
): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '' || /[\s\r\n\t]/.test(trimmed)) {
    return undefined
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return undefined
  }
  if (parsed.protocol === 'wss:') {
    return trimmed
  }
  if (
    parsed.protocol === 'ws:' &&
    opts?.allowLoopbackWs === true &&
    isLoopbackHostname(parsed.hostname)
  ) {
    return trimmed
  }
  return undefined
}

/**
 * Official 2.1.331 chunk `#2194`: resolves the bridge WebSocket URL from
 * `CLAUDE_REMOTE_TOOLS_BRIDGE_URL` if set, otherwise falls back to the staging
 * or production default based on `oauthSuffix`.
 */
export function resolveRemoteToolsBridgeUrl(opts?: {
  env?: NodeJS.ProcessEnv
  oauthSuffix?: '' | '-staging-oauth'
  allowLoopbackWs?: boolean
}): string | undefined {
  const env = opts?.env ?? process.env
  const rawOverride = env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL
  if (typeof rawOverride === 'string' && rawOverride.trim() !== '') {
    return validateBridgeWebSocketUrl(rawOverride, {
      allowLoopbackWs: opts?.allowLoopbackWs,
    })
  }
  const defaultUrl =
    opts?.oauthSuffix === '-staging-oauth'
      ? REMOTE_TOOLS_BRIDGE_STAGING_URL
      : REMOTE_TOOLS_BRIDGE_PROD_URL
  return validateBridgeWebSocketUrl(defaultUrl, {
    allowLoopbackWs: opts?.allowLoopbackWs,
  })
}

/**
 * Official 2.1.331 chunk `#2194` (`XQn`): selects `'auto'` or `'bridge'`
 * transport mode.
 */
export function resolveRemoteToolsTransportMode(opts?: {
  requested?: 'auto' | 'bridge'
  bridgeFlagOn?: boolean
}): 'auto' | 'bridge' {
  return opts?.requested ?? (opts?.bridgeFlagOn ? 'bridge' : 'auto')
}

// ============================================================================
// RemoteToolsBridgeClient (Official 2.1.331 chunk #2194)
// ============================================================================

export type BridgeWebSocketLike = {
  readonly readyState: number
  send(data: string | Uint8Array | ArrayBuffer): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener?(type: string, listener: (event: unknown) => void): void
}

export type BridgeWebSocketCtor = new (
  url: string,
  protocols?: string | string[],
) => BridgeWebSocketLike

export type RemoteToolsBridgeClientState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'disposed'

export type RemoteToolsBridgeCloseInfo = {
  code?: number
  reason?: string
  willReconnect: boolean
}

export type RemoteToolsBridgeClientOptions = {
  url: string
  token?: string
  tokenDeadlineMs?: number
  allowLoopbackWs?: boolean
  maxFrameBytes?: number
  keepaliveIntervalMs?: number
  pongTimeoutMs?: number
  initialReconnectDelayMs?: number
  maxReconnectDelayMs?: number
  maxConsecutiveSlotContention?: number
  WebSocketCtor?: BridgeWebSocketCtor
  onFrame?: (frame: unknown) => void
  onOpen?: () => void
  onClose?: (info: RemoteToolsBridgeCloseInfo) => void
  onError?: (error: Error) => void
  onTokenExpired?: () => void
}

const WS_OPEN = 1
const WS_CLOSE_NORMAL = 1000
const WS_CLOSE_PONG_TIMEOUT = 4000
const WS_CLOSE_SLOT_CONTENTION = 4009

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000
const DEFAULT_PONG_TIMEOUT_MS = 10_000
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 1_000
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000
const DEFAULT_MAX_CONSECUTIVE_SLOT_CONTENTION = 5

function unrefTimer(
  timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>,
): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref()
  }
}

function measurePayloadBytes(
  payload: string | Uint8Array | ArrayBuffer,
): number {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload, 'utf8')
  }
  if (payload instanceof Uint8Array) {
    return payload.byteLength
  }
  return payload.byteLength
}

function decodeMessageData(
  data: unknown,
  maxFrameBytes: number,
): {
  bytes: number
  oversized?: boolean
  text?: string
} {
  if (typeof data === 'string') {
    const bytes = Buffer.byteLength(data, 'utf8')
    if (bytes > maxFrameBytes) {
      return { bytes, oversized: true }
    }
    return { bytes, text: data }
  }
  if (data instanceof Uint8Array) {
    const bytes = data.byteLength
    if (bytes > maxFrameBytes) {
      return { bytes, oversized: true }
    }
    return {
      bytes,
      text: new TextDecoder().decode(data),
    }
  }
  if (data instanceof ArrayBuffer) {
    const bytes = data.byteLength
    if (bytes > maxFrameBytes) {
      return { bytes, oversized: true }
    }
    return {
      bytes,
      text: new TextDecoder().decode(new Uint8Array(data)),
    }
  }
  return { bytes: 0 }
}

function extractEventField<T>(event: unknown, key: string): T | undefined {
  if (event !== null && typeof event === 'object' && key in event) {
    return (event as Record<string, unknown>)[key] as T
  }
  return undefined
}

function isSlotContentionClose(code?: number, reason?: string): boolean {
  if (code === WS_CLOSE_SLOT_CONTENTION) {
    return true
  }
  if (typeof reason === 'string') {
    const lower = reason.toLowerCase()
    return lower.includes('slot') || lower.includes('contested')
  }
  return false
}

export class RemoteToolsBridgeClient {
  readonly url: string
  readonly maxFrameBytes: number;
  [DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL]: number | undefined

  #token: string | undefined
  #state: RemoteToolsBridgeClientState = 'idle'
  #ws: BridgeWebSocketLike | undefined
  #keepaliveTimer: ReturnType<typeof setInterval> | undefined
  #pongTimer: ReturnType<typeof setTimeout> | undefined
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #reconnectAttempt = 0
  #consecutiveSlotContention = 0
  #disposed = false
  #options: RemoteToolsBridgeClientOptions
  #socketCleanup: (() => void) | undefined

  constructor(options: RemoteToolsBridgeClientOptions) {
    const validated = validateBridgeWebSocketUrl(options.url, {
      allowLoopbackWs: options.allowLoopbackWs,
    })
    if (validated === undefined) {
      throw new Error(
        `Invalid remote tools bridge WebSocket URL: "${options.url}"`,
      )
    }
    this.url = validated
    this.maxFrameBytes =
      options.maxFrameBytes ?? REMOTE_TOOLS_BRIDGE_MAX_FRAME_BYTES
    this.#token = options.token
    this[DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL] = options.tokenDeadlineMs
    this.#options = options
  }

  get state(): RemoteToolsBridgeClientState {
    return this.#state
  }

  get token(): string | undefined {
    return this.#token
  }

  get tokenDeadlineMs(): number | undefined {
    return this[DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL]
  }

  get consecutiveSlotContention(): number {
    return this.#consecutiveSlotContention
  }

  start(): void {
    if (
      this.#disposed ||
      this.#state === 'connecting' ||
      this.#state === 'open'
    ) {
      return
    }
    this.#connect()
  }

  updateToken(token: string, deadlineMs?: number): void {
    this.#token = token
    this[DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL] = deadlineMs
    if (this.#disposed) {
      return
    }
    if (this.#ws && this.#ws.readyState === WS_OPEN) {
      this.sendFrame({
        type: 'token_update',
        token,
        ...(deadlineMs !== undefined ? { deadlineMs } : {}),
      })
    }
  }

  sendFrame(payload: unknown): boolean {
    if (this.#disposed) {
      return false
    }
    const serialized =
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    if (serialized === undefined) {
      throw new Error('Cannot serialize remote tools bridge frame payload')
    }
    const bytes = measurePayloadBytes(serialized)
    if (bytes > this.maxFrameBytes) {
      throw new Error(
        `Remote tools bridge frame exceeds max size (${bytes} > ${this.maxFrameBytes} bytes)`,
      )
    }
    if (!this.#ws || this.#ws.readyState !== WS_OPEN) {
      return false
    }
    this.#ws.send(serialized)
    return true
  }

  dispose(): void {
    if (this.#disposed) {
      return
    }
    this.#disposed = true
    this.#state = 'disposed'
    this.#clearAllTimers()
    const ws = this.#ws
    this.#ws = undefined
    this.#detachSocketListeners()
    if (ws) {
      try {
        ws.close(WS_CLOSE_NORMAL, 'disposed')
      } catch {
        // Ignore close errors on already-closed sockets
      }
    }
  }

  #resolveWebSocketCtor(): BridgeWebSocketCtor {
    if (this.#options.WebSocketCtor !== undefined) {
      return this.#options.WebSocketCtor
    }
    const GlobalWs = globalThis.WebSocket as unknown as
      | BridgeWebSocketCtor
      | undefined
    if (typeof GlobalWs !== 'function') {
      throw new Error('Global WebSocket implementation is unavailable')
    }
    return GlobalWs
  }

  #checkTokenDeadline(): boolean {
    const deadline = this[DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL]
    if (deadline !== undefined && Date.now() >= deadline) {
      this.#options.onTokenExpired?.()
      return true
    }
    return false
  }

  #handleDecodedText(text: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      this.#options.onFrame?.(text)
      return
    }
    if (parsed !== null && typeof parsed === 'object' && 'type' in parsed) {
      const msgType = (parsed as { type?: unknown }).type
      if (msgType === 'pong') {
        this.#clearPongTimer()
        return
      }
      if (msgType === 'ping') {
        try {
          this.sendFrame({ type: 'pong', ts: Date.now() })
        } catch {
          // Ignore write errors during pong
        }
        return
      }
    }
    this.#options.onFrame?.(parsed)
  }

  #connect(): void {
    if (this.#disposed) {
      return
    }
    this.#clearReconnectTimer()
    if (this.#checkTokenDeadline()) {
      this.#state = 'idle'
      return
    }
    this.#state = 'connecting'

    const WsCtor = this.#resolveWebSocketCtor()
    const ws = new WsCtor(this.url)
    this.#ws = ws

    const onOpen = () => {
      if (this.#disposed || this.#ws !== ws) return
      this.#state = 'open'
      this.#reconnectAttempt = 0
      this.#consecutiveSlotContention = 0
      if (this.#token !== undefined && this.#token !== '') {
        try {
          this.sendFrame({
            type: 'auth',
            token: this.#token,
          })
        } catch (err) {
          this.#options.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          )
        }
      }
      this.#startKeepalive()
      this.#options.onOpen?.()
    }

    const onMessage = (event: unknown) => {
      if (this.#disposed || this.#ws !== ws) return
      const data = extractEventField<unknown>(event, 'data')
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        if (data.size > this.maxFrameBytes) {
          this.#options.onError?.(
            new Error(
              `Received oversized bridge frame (${data.size} > ${this.maxFrameBytes} bytes)`,
            ),
          )
          return
        }
        void data
          .text()
          .then(text => {
            if (this.#disposed || this.#ws !== ws) return
            this.#handleDecodedText(text)
          })
          .catch(err => {
            if (this.#disposed || this.#ws !== ws) return
            this.#options.onError?.(
              err instanceof Error ? err : new Error(String(err)),
            )
          })
        return
      }
      const decoded = decodeMessageData(data, this.maxFrameBytes)
      if (decoded.oversized || decoded.bytes > this.maxFrameBytes) {
        this.#options.onError?.(
          new Error(
            `Received oversized bridge frame (${decoded.bytes} > ${this.maxFrameBytes} bytes)`,
          ),
        )
        return
      }
      if (decoded.text === undefined) {
        return
      }
      this.#handleDecodedText(decoded.text)
    }

    const onError = (event: unknown) => {
      if (this.#disposed || this.#ws !== ws) return
      const rawErr = extractEventField<unknown>(event, 'error')
      const err =
        rawErr instanceof Error
          ? rawErr
          : new Error(
              extractEventField<string>(event, 'message') ??
                'Remote tools bridge WebSocket error',
            )
      this.#options.onError?.(err)
    }

    const onClose = (event: unknown) => {
      if (this.#ws !== ws) return
      this.#clearKeepaliveTimers()
      this.#detachSocketListeners()
      this.#ws = undefined

      const code = extractEventField<number>(event, 'code')
      const reason = extractEventField<string>(event, 'reason')

      if (this.#disposed) {
        this.#options.onClose?.({ code, reason, willReconnect: false })
        return
      }

      const maxContention =
        this.#options.maxConsecutiveSlotContention ??
        DEFAULT_MAX_CONSECUTIVE_SLOT_CONTENTION
      if (isSlotContentionClose(code, reason)) {
        this.#consecutiveSlotContention += 1
      } else {
        this.#consecutiveSlotContention = 0
      }

      const willReconnect = this.#consecutiveSlotContention < maxContention
      this.#state = willReconnect ? 'reconnecting' : 'idle'
      this.#options.onClose?.({ code, reason, willReconnect })

      if (willReconnect) {
        this.#scheduleReconnect()
      }
    }

    ws.addEventListener('open', onOpen)
    ws.addEventListener('message', onMessage)
    ws.addEventListener('error', onError)
    ws.addEventListener('close', onClose)

    this.#socketCleanup = () => {
      ws.removeEventListener?.('open', onOpen)
      ws.removeEventListener?.('message', onMessage)
      ws.removeEventListener?.('error', onError)
      ws.removeEventListener?.('close', onClose)
    }
  }

  #detachSocketListeners(): void {
    const cleanup = this.#socketCleanup
    this.#socketCleanup = undefined
    cleanup?.()
  }

  #startKeepalive(): void {
    this.#clearKeepaliveTimers()
    const intervalMs =
      this.#options.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS
    if (intervalMs <= 0) {
      return
    }
    const pongTimeoutMs = this.#options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS
    this.#keepaliveTimer = setInterval(() => {
      if (this.#disposed || !this.#ws || this.#ws.readyState !== WS_OPEN) {
        return
      }
      this.#checkTokenDeadline()
      try {
        this.sendFrame({ type: 'ping', ts: Date.now() })
      } catch {
        return
      }
      this.#clearPongTimer()
      if (pongTimeoutMs > 0) {
        this.#pongTimer = setTimeout(() => {
          if (this.#disposed || !this.#ws) return
          try {
            this.#ws.close(WS_CLOSE_PONG_TIMEOUT, 'pong timeout')
          } catch {
            // Ignore close failure
          }
        }, pongTimeoutMs)
        unrefTimer(this.#pongTimer)
      }
    }, intervalMs)
    unrefTimer(this.#keepaliveTimer)
  }

  #scheduleReconnect(): void {
    this.#clearReconnectTimer()
    const initialMs =
      this.#options.initialReconnectDelayMs ??
      DEFAULT_INITIAL_RECONNECT_DELAY_MS
    const maxMs =
      this.#options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS
    const exponent = Math.min(this.#reconnectAttempt, 16)
    const delayMs = Math.min(maxMs, initialMs * 2 ** exponent)
    this.#reconnectAttempt += 1
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      if (!this.#disposed) {
        this.#connect()
      }
    }, delayMs)
    unrefTimer(this.#reconnectTimer)
  }

  #clearPongTimer(): void {
    if (this.#pongTimer !== undefined) {
      clearTimeout(this.#pongTimer)
      this.#pongTimer = undefined
    }
  }

  #clearKeepaliveTimers(): void {
    if (this.#keepaliveTimer !== undefined) {
      clearInterval(this.#keepaliveTimer)
      this.#keepaliveTimer = undefined
    }
    this.#clearPongTimer()
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
  }

  #clearAllTimers(): void {
    this.#clearKeepaliveTimers()
    this.#clearReconnectTimer()
  }
}
