import type { WSContext } from 'hono/ws'
import { findAcpConnectionByAgentId, sendToAgentWs } from './acp-ws-handler'
import { getAcpEventBus } from './event-bus'
import type { SessionEvent } from './event-bus'
import { log, error as logError } from '../logger'

// Per-relay connection state
interface RelayConnectionEntry {
  agentId: string
  unsub: (() => void) | null
  keepalive: ReturnType<typeof setInterval> | null
  ws: WSContext
  openTime: number
  /** Pending JSON-RPC session/set_mode request IDs awaiting session_mode_set over RCS relay */
  pendingModeRequestIds: Array<string | number>
}

const relayConnections = new Map<string, RelayConnectionEntry>() // key: relayWsId

const RELAY_KEEPALIVE_INTERVAL_MS = 20_000

/** Send a JSON message to relay WS */
function sendToRelayWs(ws: WSContext, msg: object): void {
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(msg))
  } catch (err) {
    logError('[ACP-Relay] send error:', err)
  }
}

/** Called from onOpen — finds target agent and bridges connection */
export function handleRelayOpen(
  ws: WSContext,
  relayWsId: string,
  agentId: string,
): void {
  log(
    `[ACP-Relay] Relay connection opened: relayWsId=${relayWsId} agentId=${agentId}`,
  )

  // Check if agent is online
  const agentConn = findAcpConnectionByAgentId(agentId)
  if (!agentConn) {
    log(`[ACP-Relay] Agent ${agentId} not found or offline`)
    sendToRelayWs(ws, {
      type: 'error',
      payload: { message: 'Agent not found or offline' },
    })
    ws.close(4004, 'agent not found')
    return
  }

  // Keepalive interval
  const keepalive = setInterval(() => {
    const entry = relayConnections.get(relayWsId)
    if (!entry || entry.ws.readyState !== 1) {
      clearInterval(keepalive)
      return
    }
    sendToRelayWs(entry.ws, { type: 'keep_alive' })
  }, RELAY_KEEPALIVE_INTERVAL_MS)

  // Subscribe to channel group EventBus — forward only target agent's responses to frontend
  const channelGroupId = agentConn.channelGroupId
  const bus = getAcpEventBus(channelGroupId)
  const unsub = bus.subscribe((event: SessionEvent) => {
    if (ws.readyState !== 1) return
    if (event.direction !== 'inbound') return
    const payloadAgentId =
      event.payload &&
      typeof event.payload === 'object' &&
      'agentId' in event.payload &&
      typeof (event.payload as Record<string, unknown>).agentId === 'string'
        ? ((event.payload as Record<string, unknown>).agentId as string)
        : undefined
    const eventAgentId = event.agentId ?? payloadAgentId
    if (eventAgentId !== agentId) return
    const entry = relayConnections.get(relayWsId)
    // Handle agent disconnect specially: send status to frontend
    if (event.type === 'agent_disconnect') {
      entry?.pendingModeRequestIds.splice(0)
      sendToRelayWs(ws, { type: 'status', payload: { connected: false } })
      return
    }
    const payloadObj =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : null
    if (
      payloadObj?.jsonrpc === '2.0' &&
      (typeof payloadObj.id === 'string' || typeof payloadObj.id === 'number')
    ) {
      if (entry) {
        const idx = entry.pendingModeRequestIds.indexOf(payloadObj.id)
        if (idx >= 0) entry.pendingModeRequestIds.splice(idx, 1)
      }
      sendToRelayWs(ws, event.payload as object)
      return
    }
    if (
      payloadObj?.type === 'session_mode_set' &&
      entry &&
      entry.pendingModeRequestIds.length > 0
    ) {
      const reqId = entry.pendingModeRequestIds.shift()!
      sendToRelayWs(ws, {
        jsonrpc: '2.0',
        id: reqId,
        result: payloadObj.payload ?? {},
      })
      return
    }
    if (payloadObj?.type === 'error' && entry) {
      entry.pendingModeRequestIds.splice(0)
    }
    // Forward agent responses to the frontend WebSocket
    sendToRelayWs(ws, event.payload as object)
  })

  relayConnections.set(relayWsId, {
    agentId,
    unsub,
    keepalive,
    ws,
    openTime: Date.now(),
    pendingModeRequestIds: [],
  })

  // Don't send a synthetic status message here!
  // The frontend sends a "connect" command, which acp-link processes
  // and responds with a real status message including capabilities.
  // Sending a fake status would make the frontend think it's connected
  // before the agent process is actually ready.

  log(
    `[ACP-Relay] Relay established: relayWsId=${relayWsId} → agentId=${agentId}`,
  )
}

/** Called from onMessage — forwards frontend messages to acp-link */
export function handleRelayMessage(
  ws: WSContext,
  relayWsId: string,
  data: string,
): void {
  const entry = relayConnections.get(relayWsId)
  if (!entry) return

  const lines = data.split('\n').filter(l => l.trim())
  for (const line of lines) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      logError('[ACP-Relay] parse error:', line)
      continue
    }

    // Ignore keepalive responses
    if (msg.type === 'keep_alive') continue

    // Forward to acp-link agent
    const sent = sendToAgentWs(entry.agentId, msg)
    if (!sent) {
      sendToRelayWs(ws, {
        type: 'error',
        payload: { message: 'Agent connection lost' },
      })
      return
    }

    // Track JSON-RPC session/set_mode request IDs so legacy session_mode_set
    // responses emitted over rcsUpstream correlate back as JSON-RPC 2.0 results.
    if (
      msg.jsonrpc === '2.0' &&
      msg.method === 'session/set_mode' &&
      (typeof msg.id === 'string' || typeof msg.id === 'number')
    ) {
      entry.pendingModeRequestIds.push(msg.id)
    }
  }
}

/** Called from onClose — cleans up relay connection */
export function handleRelayClose(
  ws: WSContext,
  relayWsId: string,
  code?: number,
  reason?: string,
): void {
  const entry = relayConnections.get(relayWsId)
  if (!entry) return

  const duration = Math.round((Date.now() - entry.openTime) / 1000)
  log(
    `[ACP-Relay] Connection closed: relayWsId=${relayWsId} agentId=${entry.agentId} code=${code ?? 'none'} reason=${reason || '(none)'} duration=${duration}s`,
  )

  if (entry.unsub) {
    entry.unsub()
  }
  if (entry.keepalive) {
    clearInterval(entry.keepalive)
  }

  relayConnections.delete(relayWsId)
}

/** Close all relay connections (for graceful shutdown) */
export function closeAllRelayConnections(): void {
  if (relayConnections.size === 0) return

  log(`[ACP-Relay] Closing ${relayConnections.size} relay connection(s)...`)
  for (const [relayWsId, entry] of relayConnections) {
    try {
      if (entry.unsub) entry.unsub()
      if (entry.keepalive) clearInterval(entry.keepalive)
      if (entry.ws.readyState === 1) {
        entry.ws.close(1001, 'server_shutdown')
      }
    } catch {
      // ignore errors during shutdown
    }
  }
  relayConnections.clear()
  log('[ACP-Relay] All relay connections closed')
}
