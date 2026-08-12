/**
 * densable 2.1.224 #1 residual — YFh/UFh/qFh/RFh/JFh pure helpers.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import { connect } from 'node:net'
import {
  ORCH_HEALTH_ADDRINUSE_RETRY_MS,
  ORCH_SESSION_QUEUE_WAIT_BUCKETS,
  ORCH_SPAWN_HOOK_DURATION_BUCKETS,
  emptyScmConnectorHealth,
  emptySessionQueueWaits,
  emptySpawnHookDurations,
  escapePromLabel,
  observeSessionQueueWait,
  observeSpawnHookDuration,
  renderOrchestratorMetrics,
  startOrchestratorHealthServer,
  type OrchestratorHealthState,
} from '../orchestrator.js'
import { emptyRunnerErrorCounts } from '../runnerApi.js'

/** Raw TCP HTTP — Bun's http.get is hijacked by HTTP_PROXY in this env (502). */
function rawHttpGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: '127.0.0.1', port }, () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
      )
    })
    let raw = ''
    sock.on('data', (d: Buffer) => {
      raw += d.toString('utf8')
    })
    sock.on('error', reject)
    sock.on('end', () => {
      const sep = raw.indexOf('\r\n\r\n')
      const head = sep >= 0 ? raw.slice(0, sep) : raw
      const body = sep >= 0 ? raw.slice(sep + 4) : ''
      const m = /^HTTP\/1\.\d (\d+)/.exec(head)
      resolve({ status: m ? Number(m[1]) : 0, body })
    })
  })
}

function baseState(
  overrides: Partial<OrchestratorHealthState> = {},
): OrchestratorHealthState {
  return {
    orchestratorUuid: 'ouuid',
    hostname: 'host1',
    version: '2.1.224',
    pool_id: 'pool1',
    connected: true,
    last_poll_at: 1_000,
    last_hint_at: 0,
    last_hook_ok_at: 0,
    last_warm_hook_ok_at: 0,
    last_error: null,
    clock_skew_ms: 500,
    queue_counts: { pending: 2, backing_off: 1, circuit_broken: 0 },
    pool_pending_session_count: 3,
    pool_active_session_count: 4,
    warm_hints_dispatched: 5,
    spawnHooks: { ok: 1, retryable: 2, nonRetryable: 3 },
    pollErrors: emptyRunnerErrorCounts(),
    spawnHookDurations: emptySpawnHookDurations(),
    sessionQueueWaits: emptySessionQueueWaits(),
    scm_connector: null,
    ...overrides,
  }
}

describe('densable 2.1.224 #1 orch metrics pure (UFh/qFh/wme/YFh)', () => {
  test('bucket constants + histogram observe', () => {
    expect(ORCH_SPAWN_HOOK_DURATION_BUCKETS).toEqual([
      0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60,
    ])
    expect(ORCH_SESSION_QUEUE_WAIT_BUCKETS[0]).toBe(0.5)
    expect(ORCH_HEALTH_ADDRINUSE_RETRY_MS).toBe(1_500)
    const h = emptySpawnHookDurations()
    observeSpawnHookDuration(h, 0.05)
    observeSpawnHookDuration(h, 1.5)
    expect(h.count).toBe(2)
    expect(h.sum).toBeCloseTo(1.55)
    expect(h.buckets[0]).toBe(1) // le=0.1
    const q = emptySessionQueueWaits()
    observeSessionQueueWait(q, -5)
    expect(q.sum).toBe(0)
    expect(q.count).toBe(1)
  })

  test('escapePromLabel (wme)', () => {
    expect(escapePromLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd')
  })

  test('renderOrchestratorMetrics (YFh) series shape', () => {
    const body = renderOrchestratorMetrics(
      baseState({
        scm_connector: {
          ...emptyScmConnectorHealth(),
          connected: true,
          requests_forwarded: 9,
        },
      }),
      2_000,
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_info{version="2.1.224"',
    )
    expect(body).toContain('claude_code_self_hosted_orchestrator_connected 1')
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_last_poll_age_seconds 1',
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_queue_pending_sessions 2',
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_spawn_hooks_total{result="ok"} 1',
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_poll_errors_total{error_kind="transport"} 0',
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_clock_skew_seconds 0.5',
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_scm_connector_connected 1',
    )
    expect(body).toContain(
      'claude_code_self_hosted_orchestrator_scm_connector_requests_forwarded_total 9',
    )
    // scm sample series absent when null (HELP/TYPE lines still present)
    const noScm = renderOrchestratorMetrics(baseState({ scm_connector: null }))
    expect(noScm).not.toMatch(
      /^claude_code_self_hosted_orchestrator_scm_connector_connected \d/m,
    )
    expect(noScm).not.toMatch(
      /^claude_code_self_hosted_orchestrator_scm_connector_requests_forwarded_total \d/m,
    )
  })
})

describe('densable 2.1.224 #1 orch health server (JFh)', () => {
  const servers: Server[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) {
      try {
        s.close()
      } catch {
        /* ignore */
      }
    }
  })

  test('/healthz JSON + /metrics text', async () => {
    const state = baseState({
      scm_connector: emptyScmConnectorHealth(),
    })
    // port 0 → ephemeral
    const server = startOrchestratorHealthServer(0, state, () => {})
    servers.push(server)
    await new Promise<void>(resolve => {
      if (server.listening) resolve()
      else server.once('listening', () => resolve())
    })
    const addr = server.address()
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0
    expect(port).toBeGreaterThan(0)

    const hz = await rawHttpGet(port, '/healthz')
    expect(hz.status).toBe(200)
    const json = JSON.parse(hz.body) as {
      status: string
      orchestrator_uuid: string
      scm_connector_connected: boolean | null
    }
    expect(json.status).toBe('ok')
    expect(json.orchestrator_uuid).toBe('ouuid')
    expect(json.scm_connector_connected).toBe(false)

    const met = await rawHttpGet(port, '/metrics')
    expect(met.status).toBe(200)
    expect(met.body).toContain('claude_code_self_hosted_orchestrator_info')

    const nf = await rawHttpGet(port, '/nope')
    expect(nf.status).toBe(404)
  })
})
