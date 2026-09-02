/**
 * densable Cji / kkm / ODw subset — frame-live WebSocket open (2.1.239).
 * Source: gold-Cji-239 / gold-kkm-239 / gold-rSw-239 / gold-ODw-239.
 *
 * Tip `openLiveSocket` dep: opens wss against CLAUDE_AI_ORIGIN edge,
 * subprotocols `frame-live.v1` + subscription token, keepalive ping @ 25s.
 */
import { getOauthConfig } from '../../constants/oauth.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import { getWebSocketProxyAgent } from '../../utils/proxy.js'
import type { LiveSocketHandle } from './arm.js'
import { un } from './store.js'

/** densable vDw */
export const FRAME_LIVE_PROTOCOL = 'frame-live.v1'

/** densable SDw — keepalive interval. */
export const FRAME_LIVE_KEEPALIVE_MS = 25_000

/** densable Hwl — max inbound frame bytes. */
export const FRAME_LIVE_MAX_PAYLOAD = 1_048_576

/** densable aEe — surfaced version shape. */
const SURFACED_VER_RE = /^[A-Za-z0-9._-]{1,64}$/

/** densable kkm / ffm — wss URL for slug. */
export function frameLiveWsUrl(slug: string): string {
  const origin = getOauthConfig().CLAUDE_AI_ORIGIN
  const u = new URL(
    `/edge-api/frame-live/${encodeURIComponent(slug)}/ws`,
    origin,
  )
  switch (u.protocol) {
    case 'https:':
    case 'wss:':
      u.protocol = 'wss:'
      break
    case 'http:':
    case 'ws:':
      u.protocol = 'ws:'
      break
    default:
      throw new Error(`unsupported socket base scheme ${u.protocol}`)
  }
  return u.toString()
}

export type FrameLiveMessage =
  | { kind: 'comment'; ver?: string; [k: string]: unknown }
  | { kind: 'summon'; [k: string]: unknown }
  | { kind: 'ver'; ver?: string; [k: string]: unknown }
  | { kind: string; ver?: string; [k: string]: unknown }

export function parseFrameLiveMessage(raw: string): FrameLiveMessage | null {
  if (!raw.startsWith('{')) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || !('kind' in v)) return null
    const kind = (v as { kind?: unknown }).kind
    if (typeof kind !== 'string') return null
    return v as FrameLiveMessage
  } catch {
    return null
  }
}

export type FrameLiveTransformOpts = {
  slug: string
  url?: string
  seedSurfacedVer?: string
  onComment?: (msg: FrameLiveMessage) => void
  onSurfaced?: (ver: string) => void
  /** When true and autoReact gate open, onComment still fires (wake is host-side). */
  autoReact?: boolean
}

/**
 * densable ODw — JSON frame filter / side-effects (portable).
 * Returns null to drop the frame from downstream logging.
 */
export function createFrameLiveTransform(
  opts: FrameLiveTransformOpts,
): (raw: string) => string | null {
  let lastSurfaced = opts.seedSurfacedVer
  return (raw: string) => {
    const msg = parseFrameLiveMessage(raw)
    if (!msg) return null
    if (msg.kind === 'comment') {
      const sup = un().live.supervisors.get(opts.slug)
      if (sup && !sup.stopped) sup.lastActivityAt = Date.now()
      opts.onComment?.(msg)
      return null
    }
    if (msg.kind === 'summon') return null
    const ver = msg.ver
    if (typeof ver !== 'string' || !SURFACED_VER_RE.test(ver)) return null
    if (ver === lastSurfaced) return null
    lastSurfaced = ver
    try {
      opts.onSurfaced?.(ver)
    } catch {
      /* ignore */
    }
    const sup = un().live.supervisors.get(opts.slug)
    if (sup && !sup.stopped) {
      sup.carriedVer = ver
      sup.lastActivityAt = Date.now()
    }
    return null
  }
}

export type OpenFrameLiveSocketInput = {
  slug: string
  url: string
  token: string
  signal: AbortSignal
  transform?: (raw: string) => string | null
  onOpen?: () => void
  onClose?: (code: number) => void
  handshakeDeadlineMs?: number
}

/**
 * densable Cji portable — open frame-live socket; returns close handle for oF.
 */
export async function openFrameLiveSocket(
  input: OpenFrameLiveSocketInput,
): Promise<LiveSocketHandle> {
  const wsUrl = frameLiveWsUrl(input.slug)
  const protocols = [FRAME_LIVE_PROTOCOL, input.token]
  const { default: WS } = await import('ws')
  const agent = getWebSocketProxyAgent(wsUrl)
  const tls = getWebSocketTLSOptions()
  const socket = new WS(wsUrl, protocols, {
    ...(agent !== undefined ? { agent } : {}),
    ...(tls !== undefined ? { ...tls } : {}),
    maxPayload: FRAME_LIVE_MAX_PAYLOAD,
  })

  let keepalive: ReturnType<typeof setInterval> | undefined
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const cleanup = (): void => {
    if (keepalive !== undefined) {
      clearInterval(keepalive)
      keepalive = undefined
    }
    if (handshakeTimer !== undefined) {
      clearTimeout(handshakeTimer)
      handshakeTimer = undefined
    }
  }

  const close = (): void => {
    if (closed) return
    closed = true
    cleanup()
    try {
      socket.close()
    } catch {
      /* ignore */
    }
  }

  const onAbort = (): void => close()
  if (input.signal.aborted) {
    close()
    throw new DOMException('Aborted', 'AbortError')
  }
  input.signal.addEventListener('abort', onAbort, { once: true })

  await new Promise<void>((resolve, reject) => {
    const fail = (err: Error): void => {
      cleanup()
      input.signal.removeEventListener('abort', onAbort)
      try {
        socket.terminate()
      } catch {
        /* ignore */
      }
      reject(err)
    }

    handshakeTimer = setTimeout(() => {
      fail(new Error('handshake_timeout'))
    }, input.handshakeDeadlineMs ?? 30_000)
    handshakeTimer.unref?.()

    socket.once('open', () => {
      if (handshakeTimer !== undefined) {
        clearTimeout(handshakeTimer)
        handshakeTimer = undefined
      }
      try {
        socket.send('ping')
        socket.send('hb')
      } catch {
        /* ignore */
      }
      keepalive = setInterval(() => {
        if (socket.readyState === WS.OPEN) {
          try {
            socket.send('ping')
          } catch {
            /* ignore */
          }
        }
      }, FRAME_LIVE_KEEPALIVE_MS)
      keepalive.unref?.()
      try {
        input.onOpen?.()
      } catch {
        /* ignore */
      }
      resolve()
    })

    socket.once('error', (err: Error) => {
      fail(err instanceof Error ? err : new Error(String(err)))
    })
  })

  socket.on('message', (data: unknown, isBinary: boolean) => {
    if (isBinary) return
    let raw: string
    if (typeof data === 'string') raw = data
    else if (Buffer.isBuffer(data)) raw = data.toString('utf8')
    else if (data instanceof ArrayBuffer)
      raw = Buffer.from(data).toString('utf8')
    else if (Array.isArray(data)) raw = Buffer.concat(data).toString('utf8')
    else return
    if (Buffer.byteLength(raw, 'utf8') > FRAME_LIVE_MAX_PAYLOAD) {
      close()
      return
    }
    if (input.transform) {
      try {
        input.transform(raw)
      } catch {
        /* ignore */
      }
    }
  })

  socket.on('close', (code: number) => {
    cleanup()
    input.signal.removeEventListener('abort', onAbort)
    try {
      input.onClose?.(code)
    } catch {
      /* ignore */
    }
  })

  return { close }
}
