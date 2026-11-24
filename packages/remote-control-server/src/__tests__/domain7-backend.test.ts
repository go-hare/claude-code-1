import { describe, test, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import type { WSContext } from 'hono/ws'
import {
  storeReset,
  storeCreateSession,
  storeBindSession,
  storeIsSessionOwner,
  storeUpsertSessionWorker,
} from '../store'
import { getAllEventBuses, removeEventBus } from '../transport/event-bus'
import { normalizePayload, publishSessionEvent } from '../services/transport'
import { toClientPayload } from '../transport/client-payload'
import {
  handleAcpWsOpen,
  handleAcpWsMessage,
  handleAcpWsClose,
  closeAllAcpConnections,
} from '../transport/acp-ws-handler'
import {
  handleRelayOpen,
  handleRelayMessage,
  handleRelayClose,
  closeAllRelayConnections,
} from '../transport/acp-relay-handler'
import { config } from '../config'
import webAuth from '../routes/web/auth'
import webSessions from '../routes/web/sessions'
import webControl from '../routes/web/control'
import v1Environments from '../routes/v1/environments'

function createMockWs() {
  const sent: string[] = []
  let closed: { code?: number; reason?: string } | null = null
  let readyState = 1
  const ws = {
    get readyState() {
      return readyState
    },
    send(data: string) {
      sent.push(data)
    },
    close(code?: number, reason?: string) {
      readyState = 3
      closed = { code, reason }
    },
  } as unknown as WSContext
  return {
    ws,
    sent,
    getParsed: () =>
      sent
        .flatMap(chunk => chunk.split('\n').filter(l => l.trim()))
        .map(line => JSON.parse(line) as Record<string, unknown>),
    getClosed: () => closed,
  }
}

function createTestApp() {
  const app = new Hono()
  app.route('/web', webAuth)
  app.route('/web', webSessions)
  app.route('/web', webControl)
  app.route('/v1/environments', v1Environments)
  return app
}

function getValidApiKey(): string {
  if (config.apiKeys.length === 0) {
    config.apiKeys.push('test-domain7-key')
  }
  return config.apiKeys[0]!
}

describe('Domain 7 Backend Regressions', () => {
  let app: Hono

  beforeEach(() => {
    storeReset()
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key)
    }
    closeAllRelayConnections()
    closeAllAcpConnections()
    app = createTestApp()
  })

  describe('P0-D7-2 & P1-D7-14: POST /web/bind ownership & error shape', () => {
    test('rejects cross-owner session hijacking with 403 structured error', async () => {
      const session = storeCreateSession({ title: 'Victim Session' })
      storeBindSession(session.id, 'owner-uuid-1')

      const res = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'attacker-uuid-2',
        },
        body: JSON.stringify({ sessionId: session.id }),
      })

      expect(res.status).toBe(403)
      const body = (await res.json()) as {
        error?: { type?: string; message?: string }
      }
      expect(body.error?.type).toBe('forbidden')
      expect(body.error?.message).toContain('already owned')
    })

    test('allows binding unowned session via X-UUID header and idempotent re-bind by same owner', async () => {
      const session = storeCreateSession({ title: 'Orphan Session' })

      const first = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'owner-uuid-1',
        },
        body: JSON.stringify({ sessionId: session.id }),
      })
      expect(first.status).toBe(200)

      const second = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'owner-uuid-1',
        },
        body: JSON.stringify({ sessionId: session.id }),
      })
      expect(second.status).toBe(200)
    })

    test('allows cross-owner bind when authenticated with valid Bearer API key', async () => {
      const apiKey = getValidApiKey()
      const session = storeCreateSession({ title: 'Owned Session' })
      storeBindSession(session.id, 'owner-uuid-1')

      const res = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-UUID': 'second-device-uuid',
        },
        body: JSON.stringify({ sessionId: session.id }),
      })
      expect(res.status).toBe(200)
    })

    test('returns standardized { error: { type, message } } for 400 and 404', async () => {
      const bad = await app.request('/web/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(bad.status).toBe(400)
      const badBody = (await bad.json()) as {
        error?: { type?: string; message?: string }
      }
      expect(badBody.error?.type).toBe('invalid_request')
      expect(badBody.error?.message).toBeTruthy()

      const missing = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'owner-1',
        },
        body: JSON.stringify({ sessionId: 'session_missing' }),
      })
      expect(missing.status).toBe(404)
      const missingBody = (await missing.json()) as {
        error?: { type?: string; message?: string }
      }
      expect(missingBody.error?.type).toBe('not_found')
      expect(missingBody.error?.message).toBe('Session not found')
    })
  })

  describe('P0-D7-4: GET /web/sessions/:id/events from_sequence_num & Last-Event-ID', () => {
    test('replays only events after max(Last-Event-ID, from_sequence_num)', async () => {
      const session = storeCreateSession({ title: 'SSE Session' })
      storeBindSession(session.id, 'sse-user')

      publishSessionEvent(
        session.id,
        'assistant',
        { content: 'ev1' },
        'inbound',
      )
      publishSessionEvent(
        session.id,
        'assistant',
        { content: 'ev2' },
        'inbound',
      )
      publishSessionEvent(
        session.id,
        'assistant',
        { content: 'ev3' },
        'inbound',
      )

      const res = await app.request(
        `/web/sessions/${session.id}/events?uuid=sse-user&from_sequence_num=2`,
        {
          headers: { 'Last-Event-ID': '1' },
        },
      )
      expect(res.status).toBe(200)

      const reader = res.body!.getReader()
      const { value } = await reader.read()
      await reader.cancel()
      const text = new TextDecoder().decode(value!)
      expect(text).toContain('"seqNum":3')
      expect(text).toContain('ev3')
      expect(text).not.toContain('ev1')
      expect(text).not.toContain('ev2')
    })
  })

  describe('P0-D7-5: normalizePayload preserves permission & tool fields', () => {
    test('preserves updated_permissions, response, tool_call_id, tool_use_id, output, is_error, string message', () => {
      const perms = [
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      ]
      const permNormalized = normalizePayload('permission_response', {
        approved: true,
        request_id: 'req-plan-1',
        updated_permissions: perms,
        message: 'Looks good',
      })
      expect(permNormalized.updated_permissions).toEqual(perms)
      expect(permNormalized.message).toBe('Looks good')

      const controlRespNormalized = normalizePayload('control_response', {
        response: { subtype: 'success', request_id: 'req-2' },
      })
      expect(controlRespNormalized.response).toEqual({
        subtype: 'success',
        request_id: 'req-2',
      })

      const toolNormalized = normalizePayload('tool_result', {
        tool_use_id: 'tu_99',
        output: 'command succeeded',
        is_error: true,
      })
      expect(toolNormalized.tool_use_id).toBe('tu_99')
      expect(toolNormalized.tool_call_id).toBe('tu_99')
      expect(toolNormalized.output).toBe('command succeeded')
      expect(toolNormalized.is_error).toBe(true)
    })

    test('end-to-end ExitPlanMode updated_permissions reaches toClientPayload', () => {
      const session = storeCreateSession({ title: 'Plan Session' })
      const perms = [
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      ]
      const event = publishSessionEvent(
        session.id,
        'permission_response',
        {
          approved: true,
          request_id: 'req-plan-e2e',
          updated_permissions: perms,
        },
        'outbound',
      )
      const clientPayload = toClientPayload(event) as {
        type: string
        response: { response: { updatedPermissions?: unknown } }
      }
      expect(clientPayload.type).toBe('control_response')
      expect(clientPayload.response.response.updatedPermissions).toEqual(perms)
    })
  })

  describe('P0-D7-8: ACP relay per-agent isolation & wrapped error envelope', () => {
    test('isolates messages and disconnects between two agents in the same channelGroupId', () => {
      const agentWsA = createMockWs()
      const agentWsB = createMockWs()
      handleAcpWsOpen(agentWsA.ws, 'ws-a')
      handleAcpWsOpen(agentWsB.ws, 'ws-b')

      handleAcpWsMessage(
        agentWsA.ws,
        'ws-a',
        JSON.stringify({
          type: 'register',
          agent_name: 'Agent A',
          channel_group_id: 'shared-group',
        }),
      )
      handleAcpWsMessage(
        agentWsB.ws,
        'ws-b',
        JSON.stringify({
          type: 'register',
          agent_name: 'Agent B',
          channel_group_id: 'shared-group',
        }),
      )

      const agentIdA = agentWsA.getParsed()[0]!.agent_id as string
      const agentIdB = agentWsB.getParsed()[0]!.agent_id as string
      expect(agentIdA).toBeTruthy()
      expect(agentIdB).toBeTruthy()

      const relayWsA = createMockWs()
      const relayWsB = createMockWs()
      handleRelayOpen(relayWsA.ws, 'relay-a', agentIdA)
      handleRelayOpen(relayWsB.ws, 'relay-b', agentIdB)

      // Agent A sends a session_update — ONLY Relay A should receive it
      handleAcpWsMessage(
        agentWsA.ws,
        'ws-a',
        JSON.stringify({
          type: 'session_update',
          payload: {
            sessionId: 'sA',
            update: { sessionUpdate: 'agent_message_chunk' },
          },
        }),
      )

      expect(relayWsA.getParsed()).toHaveLength(1)
      expect(relayWsB.getParsed()).toHaveLength(0)

      // Agent A disconnects — ONLY Relay A receives connected:false, Relay B stays untouched
      handleAcpWsClose(agentWsA.ws, 'ws-a', 1000, 'bye')
      expect(relayWsA.getParsed()).toHaveLength(2)
      expect(relayWsA.getParsed()[1]).toEqual({
        type: 'status',
        payload: { connected: false },
      })
      expect(relayWsB.getParsed()).toHaveLength(0)

      handleRelayClose(relayWsA.ws, 'relay-a')
      handleRelayClose(relayWsB.ws, 'relay-b')
    })

    test('wraps relay error frames in { type: "error", payload: { message } }', () => {
      const relayWs = createMockWs()
      handleRelayOpen(relayWs.ws, 'relay-offline', 'env_nonexistent')

      const frames = relayWs.getParsed()
      expect(frames).toHaveLength(1)
      expect(frames[0]).toEqual({
        type: 'error',
        payload: { message: 'Agent not found or offline' },
      })

      // Test connection lost error envelope when forwarding message to disconnected agent
      const agentWs = createMockWs()
      handleAcpWsOpen(agentWs.ws, 'ws-drop')
      handleAcpWsMessage(
        agentWs.ws,
        'ws-drop',
        JSON.stringify({
          type: 'register',
          agent_name: 'Dropping Agent',
          channel_group_id: 'drop-group',
        }),
      )
      const agentId = agentWs.getParsed()[0]!.agent_id as string
      const liveRelay = createMockWs()
      handleRelayOpen(liveRelay.ws, 'relay-drop', agentId)

      handleAcpWsClose(agentWs.ws, 'ws-drop', 1006, 'lost')
      handleRelayMessage(
        liveRelay.ws,
        'relay-drop',
        JSON.stringify({ type: 'prompt', payload: { content: [] } }),
      )

      const liveFrames = liveRelay.getParsed()
      const errFrame = liveFrames.find(f => f.type === 'error')
      expect(errFrame).toEqual({
        type: 'error',
        payload: { message: 'Agent connection lost' },
      })
    })
  })

  describe('P1-D7-6 & P1-D7-11: ACP discoverability & web session rejection on ACP env', () => {
    test('ACP session registered with bridge_id is visible in /web/sessions/all with source/environment_id/created_at and openable by Web UI UUID', async () => {
      const apiKey = getValidApiKey()
      const regRes = await app.request('/v1/environments/bridge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          machine_name: 'ACP Mac',
          worker_type: 'acp',
          bridge_id: 'channel-group-42',
        }),
      })
      expect(regRes.status).toBe(200)
      const regBody = (await regRes.json()) as {
        environment_id: string
        session_id: string
      }
      expect(regBody.session_id).toBeTruthy()

      const allRes = await app.request('/web/sessions/all', {
        headers: { 'X-UUID': 'web-browser-uuid-1' },
      })
      expect(allRes.status).toBe(200)
      const summaries = (await allRes.json()) as Array<Record<string, unknown>>
      expect(summaries).toHaveLength(1)
      expect(summaries[0]!.id).toBe(regBody.session_id)
      expect(summaries[0]!.source).toBe('acp')
      expect(summaries[0]!.environment_id).toBe(regBody.environment_id)
      expect(typeof summaries[0]!.created_at).toBe('number')

      // Another browser UUID can also open the ACP session detail (no 403!)
      const detailRes = await app.request(
        `/web/sessions/${regBody.session_id}`,
        {
          headers: { 'X-UUID': 'web-browser-uuid-2' },
        },
      )
      expect(detailRes.status).toBe(200)

      // P1-D7-11: POST /web/sessions targeting ACP environment must return 400
      const createWebRes = await app.request('/web/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'web-browser-uuid-1',
        },
        body: JSON.stringify({
          title: 'Invalid Web Session',
          environment_id: regBody.environment_id,
        }),
      })
      expect(createWebRes.status).toBe(400)
    })
  })

  describe('P1-12: ACP relay correlates session/set_mode JSON-RPC request with session_mode_set response', () => {
    test('translates agent session_mode_set into matching JSON-RPC 2.0 response for relay client', () => {
      const agentWs = createMockWs()
      handleAcpWsOpen(agentWs.ws, 'ws-mode')
      handleAcpWsMessage(
        agentWs.ws,
        'ws-mode',
        JSON.stringify({
          type: 'register',
          agent_name: 'Mode Agent',
          channel_group_id: 'mode-group',
        }),
      )
      const agentId = agentWs.getParsed()[0]!.agent_id as string

      const relayWs = createMockWs()
      handleRelayOpen(relayWs.ws, 'relay-mode', agentId)

      handleRelayMessage(
        relayWs.ws,
        'relay-mode',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'mode_1',
          method: 'session/set_mode',
          params: { sessionId: 'sess_1', modeId: 'acceptEdits' },
        }),
      )

      // acp-link over RCS upstream emits legacy { type: 'session_mode_set', payload: {} }
      handleAcpWsMessage(
        agentWs.ws,
        'ws-mode',
        JSON.stringify({
          type: 'session_mode_set',
          payload: { modeId: 'acceptEdits' },
        }),
      )

      const relayFrames = relayWs.getParsed()
      expect(relayFrames).toHaveLength(1)
      expect(relayFrames[0]).toEqual({
        jsonrpc: '2.0',
        id: 'mode_1',
        result: { modeId: 'acceptEdits' },
      })

      handleRelayClose(relayWs.ws, 'relay-mode')
    })
  })

  describe('P1-14: ACP sessions enforce auth on mutating & sensitive endpoints', () => {
    test('rejects unauthenticated UUID mutations/history/SSE/bind on ACP session, while allowing API key & read-only discovery', async () => {
      const apiKey = getValidApiKey()
      const regRes = await app.request('/v1/environments/bridge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          machine_name: 'Protected ACP',
          worker_type: 'acp',
          bridge_id: 'group-sec',
        }),
      })
      const { session_id: acpSessionId } = (await regRes.json()) as {
        session_id: string
      }

      // Attach worker metadata to verify it is NOT leaked on unauthenticated discovery read
      storeUpsertSessionWorker(acpSessionId, {
        externalMetadata: {
          automation_state: {
            enabled: true,
            phase: 'standby',
            next_tick_at: 999,
            sleep_until: null,
          },
        },
      })

      const unauthHeaders = {
        'Content-Type': 'application/json',
        'X-UUID': 'random-attacker-uuid',
      }

      // Mutating endpoints MUST reject with 403
      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/interrupt`, {
            method: 'POST',
            headers: unauthHeaders,
          })
        ).status,
      ).toBe(403)

      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/events`, {
            method: 'POST',
            headers: unauthHeaders,
            body: JSON.stringify({ type: 'user', content: 'hijack' }),
          })
        ).status,
      ).toBe(403)

      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/control`, {
            method: 'POST',
            headers: unauthHeaders,
            body: JSON.stringify({
              type: 'permission_response',
              approved: true,
            }),
          })
        ).status,
      ).toBe(403)

      // Sensitive history / SSE / bind endpoints MUST reject with 403
      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/history`, {
            headers: unauthHeaders,
          })
        ).status,
      ).toBe(403)

      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/events`, {
            headers: unauthHeaders,
          })
        ).status,
      ).toBe(403)

      expect(
        (
          await app.request('/web/bind', {
            method: 'POST',
            headers: unauthHeaders,
            body: JSON.stringify({ sessionId: acpSessionId }),
          })
        ).status,
      ).toBe(403)

      // Read-only detail discovery still returns 200 without sensitive automation_state
      const detailRes = await app.request(`/web/sessions/${acpSessionId}`, {
        headers: unauthHeaders,
      })
      expect(detailRes.status).toBe(200)
      const detailBody = (await detailRes.json()) as Record<string, unknown>
      expect(detailBody.source).toBe('acp')
      expect(detailBody.automation_state).toBeUndefined()

      // Requests with valid API key are allowed
      const apiKeyHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-UUID': 'admin-uuid',
      }
      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/interrupt`, {
            method: 'POST',
            headers: apiKeyHeaders,
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await app.request(`/web/sessions/${acpSessionId}/history`, {
            headers: apiKeyHeaders,
          })
        ).status,
      ).toBe(200)
    })
  })

  describe('P1-15: Dashboard polling does not auto-claim orphaned CLI sessions', () => {
    test('GET /web/sessions/all and /web/sessions never steal unowned CLI session before POST /web/bind', async () => {
      const cliSession = storeCreateSession({
        title: 'CLI Remote Session',
        source: 'cli',
      })

      // Passive Dashboard browser polls both list endpoints
      const allRes = await app.request('/web/sessions/all', {
        headers: { 'X-UUID': 'dashboard-poller-uuid' },
      })
      expect(allRes.status).toBe(200)
      expect(await allRes.json()).toEqual([])

      const listRes = await app.request('/web/sessions', {
        headers: { 'X-UUID': 'dashboard-poller-uuid' },
      })
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([])

      // Orphaned CLI session MUST remain unowned
      expect(storeIsSessionOwner(cliSession.id, 'dashboard-poller-uuid')).toBe(
        false,
      )

      // Real CLI user opens /code/?sid=<id> and binds cleanly (no 403!)
      const bindRes = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'real-cli-user-uuid',
        },
        body: JSON.stringify({ sessionId: cliSession.id }),
      })
      expect(bindRes.status).toBe(200)
      expect(storeIsSessionOwner(cliSession.id, 'real-cli-user-uuid')).toBe(
        true,
      )

      // Poller still cannot steal it afterward
      const hijackRes = await app.request('/web/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UUID': 'dashboard-poller-uuid',
        },
        body: JSON.stringify({ sessionId: cliSession.id }),
      })
      expect(hijackRes.status).toBe(403)
    })
  })
})
