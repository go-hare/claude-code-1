/**
 * Official 2.1.328 architecture alignment regression suite (Worker A5):
 *  - [P0-13] SessionsV2Client SSE + RemoteSessionManager v2 wiring & undeliveredResponses retry
 *  - [P1-12] Bridge API v2 (ToolHost advert, git URL redaction, 403 enroll_and_retry, 409,
 *            poll_interval_ms/mode, v2-first archiveSession, markEnvironmentOffline) & [bridge:watch]
 *  - [P1-14] GrowthBook env/config overrides, cachedFeatureFlags fallback, SESSION_PINNED,
 *            ownSavedFlags rotation carry, ATIS_REQUEST_HEADER & latchConversationAtis
 *  - [P0-15 + P1-15 + P2] DEFAULT_BUILD_FEATURES parity, CLAUDE.md count & cli.tsx version fallback
 */

import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { setupAxiosMock } from '../../../tests/mocks/axios.js'
import {
  BRIDGE_FOLDER_ALREADY_SERVED,
  BridgeFatalError,
  createBridgeApiClient,
  isSessionsV1RetiredResponse,
  stripGitUrlCredentials,
  UntrustedDeviceBridgeError,
} from '../../bridge/bridgeApi.js'
import {
  type BridgeRestartConfig,
  createBridgeSessionsWatch,
  parseBridgeWatchFrame,
  runBridgeLoop,
} from '../../bridge/bridgeMain.js'
import type {
  BridgeApiClient,
  BridgeLogger,
  SessionSpawner,
} from '../../bridge/types.js'
import {
  ATIS_REQUEST_HEADER,
  atisPin,
  clearGrowthBookConfigOverrides,
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValue_SESSION_PINNED,
  getFeatureValueWithSource,
  getGrowthBookConfigOverrides,
  getRequestAtis,
  hasGrowthBookEnvOverride,
  hasGrowthBookOverride,
  latchConversationAtis,
  peekFeatureValue_SESSION_PINNED,
  peekSessionPinnedFeatureValue,
  readSavedFeatureFlagsFromConfig,
  resetGrowthBook,
  setGrowthBookConfigOverride,
} from '../../services/analytics/growthbook.js'
import { getPinnedFeatureValues } from '../../bootstrap/state.js'
import {
  enableConfigs,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { getBootstrapSession } from '../../utils/sessionHost.js'
import { RemoteSessionManager } from '../RemoteSessionManager.js'
import {
  parseSseChunk,
  SessionsV2Client,
  type SessionsV2EventPostOutcome,
} from '../SessionsV2Client.js'

function sseResponse(
  chunks: string[],
  headers: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      date: new Date().toUTCString(),
      ...headers,
    },
  })
}

function openEndedSseResponse(): {
  response: Response
  push: (chunk: string) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
    },
  })
  return {
    response: new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        date: new Date().toUTCString(),
      },
    }),
    push(chunk: string) {
      ctrl?.enqueue(encoder.encode(chunk))
    },
    close() {
      try {
        ctrl?.close()
      } catch {
        // already closed
      }
    },
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}

// ============================================================================
// Group 1: [P0-13] SessionsV2Client SSE & RemoteSessionManager
// ============================================================================

describe('[P0-13] SessionsV2Client SSE & RemoteSessionManager', () => {
  test('parseSseChunk handles split UTF-8 chunks, CRLF, BOM, comments, multi-line data and maxFrameBytes', () => {
    const enc = new TextEncoder()
    const raw =
      '\ufeff: heartbeat\r\n\r\nevent: client_event\r\nid: 42\r\ndata: {"a":1}\r\ndata: {"b":2}\r\n\r\n'
    let state
    const collected = []
    for (let i = 0; i < raw.length; i += 7) {
      const res = parseSseChunk(state, enc.encode(raw.slice(i, i + 7)))
      state = res.state
      collected.push(...res.events)
    }
    expect(collected).toEqual([
      { kind: 'comment', text: ' heartbeat' },
      {
        kind: 'event',
        event: 'client_event',
        id: '42',
        data: '{"a":1}\n{"b":2}',
      },
    ])

    const oversized = parseSseChunk(
      undefined,
      enc.encode('event: added\ndata: ' + 'x'.repeat(64) + '\n\n'),
      32,
    )
    expect(oversized.events.some(e => e.kind === 'tooLarge')).toBe(true)
  })

  test('SSE connect sends from_sequence_num, Last-Event-ID, control_only=1 and resumes sequence on reconnect', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    let call = 0
    const received: unknown[] = []
    const client = new SessionsV2Client(
      'cse_abc123',
      'org-1',
      () => 'tok-1',
      {
        onMessage: msg => received.push(msg),
      },
      undefined,
      5,
      {
        baseApiUrl: 'https://api.example.test',
        controlOnly: true,
        getTrustedDeviceToken: () => 'td-initial',
        reconnectBaseMs: 20,
        reconnectCapMs: 20,
        fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString()
          const headers = (init?.headers ?? {}) as Record<string, string>
          requests.push({ url, headers })
          call++
          if (call === 1) {
            return sseResponse([
              `event: client_event\nid: 9\ndata: ${JSON.stringify({
                sequence_num: 9,
                source: 'worker',
                created_at: new Date().toISOString(),
                payload: { type: 'assistant', uuid: 'm1' },
              })}\n\n`,
            ])
          }
          // Hold second connection open
          return openEndedSseResponse().response
        }) as unknown as typeof globalThis.fetch,
      },
    )

    await client.connect()
    await waitFor(() => requests.length >= 2)
    client.close()

    expect(requests[0]!.url).toBe(
      'https://api.example.test/v1/code/sessions/cse_abc123/events/stream?from_sequence_num=5&control_only=1',
    )
    expect(requests[0]!.headers['Last-Event-ID']).toBe('5')
    expect(requests[0]!.headers['X-Trusted-Device-Token']).toBe('td-initial')
    expect(requests[1]!.url).toBe(
      'https://api.example.test/v1/code/sessions/cse_abc123/events/stream?from_sequence_num=9&control_only=1',
    )
    expect(requests[1]!.headers['Last-Event-ID']).toBe('9')
    expect(client.newestSequenceNum()).toBe(9)
    expect(received).toHaveLength(1)
  })

  test('SSE & POST /events recover automatically from 403 untrusted_device via recoverTrustedDeviceToken', async () => {
    const streamTokens: Array<string | undefined> = []
    const postTokens: Array<string | undefined> = []
    let recoveredCount = 0
    let connected = false
    const hold = openEndedSseResponse()

    const client = new SessionsV2Client(
      'cse_td',
      'org-1',
      () => 'tok-1',
      {
        onMessage: () => {},
        onConnected: () => {
          connected = true
        },
      },
      undefined,
      undefined,
      {
        baseApiUrl: 'https://api.example.test',
        reconnectBaseMs: 10,
        reconnectCapMs: 10,
        getTrustedDeviceToken: () => 'td-stale',
        recoverTrustedDeviceToken: async prev => {
          recoveredCount++
          return prev === 'td-stale' ? 'td-fresh-1' : 'td-fresh-2'
        },
        fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString()
          const headers = (init?.headers ?? {}) as Record<string, string>
          if (init?.method === 'GET') {
            streamTokens.push(headers['X-Trusted-Device-Token'])
            if (streamTokens.length === 1) {
              return new Response(
                JSON.stringify({
                  error: { reason: 'untrusted_device' },
                }),
                { status: 403 },
              )
            }
            return hold.response
          }
          postTokens.push(headers['X-Trusted-Device-Token'])
          if (postTokens.length === 1) {
            return new Response(
              JSON.stringify({
                error: {
                  reason: 'untrusted_device',
                  sub_reason: 'bound_unattested',
                },
              }),
              { status: 403 },
            )
          }
          return new Response(
            JSON.stringify({ results: [{ sequence_num: 17 }] }),
            { status: 200 },
          )
        }) as unknown as typeof globalThis.fetch,
      },
    )

    await client.connect()
    await waitFor(() => connected)
    const outcome = await client.postEvent({ type: 'user', text: 'hi' })
    hold.close()
    client.close()

    expect(streamTokens).toEqual(['td-stale', 'td-fresh-1'])
    expect(postTokens).toEqual(['td-fresh-1', 'td-fresh-2'])
    expect(recoveredCount).toBe(2)
    expect(outcome.outcome).toBe('accepted')
    if (outcome.outcome === 'accepted') {
      expect(outcome.sequence_num).toBe(17)
    }
  })

  test('keepRedialling continues past 5 reconnect attempts instead of closing', async () => {
    let attempts = 0
    let closed = false
    const hold = openEndedSseResponse()

    const client = new SessionsV2Client(
      'cse_keep',
      'org-1',
      () => 'tok-1',
      {
        onMessage: () => {},
        onClose: () => {
          closed = true
        },
      },
      undefined,
      undefined,
      {
        baseApiUrl: 'https://api.example.test',
        keepRedialling: () => true,
        reconnectBaseMs: 5,
        reconnectCapMs: 10,
        fetchFn: (async () => {
          attempts++
          if (attempts <= 7) {
            return new Response('unavailable', { status: 503 })
          }
          return hold.response
        }) as unknown as typeof globalThis.fetch,
      },
    )

    await client.connect()
    await waitFor(() => attempts >= 8 && client.isConnected())
    hold.close()
    client.close()

    expect(attempts).toBe(8)
    expect(closed).toBe(false)
  })

  test('RemoteSessionManager defaults to SessionsV2Client, queues undeliveredResponses across reconnect, and wires v2 callbacks + rebindEventSigner', async () => {
    const stream1 = openEndedSseResponse()
    const stream2 = openEndedSseResponse()
    let releaseStream2!: () => void
    const stream2Gate = new Promise<void>(resolve => {
      releaseStream2 = resolve
    })
    let streamDial = 0
    let postAttempt = 0
    const postedBodies: Array<Record<string, unknown>> = []
    let rebindCount = 0

    const deliveryUpdates: Array<{ eventId: string; status: string }> = []
    const linesTaken: string[] = []
    const linesSettled: string[] = []
    const workerStatuses: string[] = []
    const toolHostEnded: Array<{ workId?: string; reason?: string }> = []
    let securityTierRaised = 0

    const mgr = new RemoteSessionManager(
      {
        sessionId: 'cse_rsm',
        orgUuid: 'org-1',
        getAccessToken: () => 'tok-1',
        eventSigner: (_sid, ev) => ({ ...ev, sig: 'v1' }),
        rebindEventSigner: () => {
          rebindCount++
          return (_sid, ev) => ({ ...ev, sig: `v${rebindCount + 1}` })
        },
        v2ClientOptions: {
          baseApiUrl: 'https://api.example.test',
          reconnectBaseMs: 10,
          reconnectCapMs: 10,
          fetchFn: (async (
            _input: string | URL | Request,
            init?: RequestInit,
          ) => {
            if (init?.method === 'GET') {
              streamDial++
              if (streamDial === 1) return stream1.response
              await stream2Gate
              return stream2.response
            }
            postAttempt++
            const parsed = JSON.parse(String(init?.body ?? '{}')) as {
              events: Array<Record<string, unknown>>
            }
            postedBodies.push(parsed.events[0]!)
            if (postAttempt === 1) {
              return new Response('gateway error', { status: 502 })
            }
            return new Response(
              JSON.stringify({
                results: [{ sequence_num: 100 + postAttempt }],
              }),
              { status: 200 },
            )
          }) as unknown as typeof globalThis.fetch,
        },
      },
      {
        onMessage: () => {},
        onPermissionRequest: () => {},
        onDeliveryUpdate: u => deliveryUpdates.push(u),
        onLineTaken: id => linesTaken.push(id),
        onLineSettled: id => {
          linesSettled.push(id)
          return true
        },
        onWorkerConnectionStatus: s => workerStatuses.push(s),
        onToolHostEnded: info => toolHostEnded.push(info),
        onSecurityTierRaised: () => {
          securityTierRaised++
        },
      },
    )

    mgr.connect()
    await waitFor(() => mgr.isConnected())

    // Deliver v2 SSE events: delivery_update, session_update, tool_host_ended, security_update, permission request
    stream1.push(
      `event: delivery_update\ndata: ${JSON.stringify({ event_id: 'ev-1', status: 'PROCESSING' })}\n\n` +
        `event: delivery_update\ndata: ${JSON.stringify({ event_id: 'ev-2', status: 'PROCESSED' })}\n\n` +
        `event: session_update\ndata: ${JSON.stringify({ connection_status: 'connected' })}\n\n` +
        `event: ephemeral_event\ndata: ${JSON.stringify({ event_type: 'tool_host_ended', payload: { work_id: 'w-9', reason: 'host_stopped' } })}\n\n` +
        `event: security_update\ndata: ${JSON.stringify({ security_tier: 'elevated' })}\n\n` +
        `event: client_event\nid: 3\ndata: ${JSON.stringify({
          sequence_num: 3,
          source: 'worker',
          created_at: new Date().toISOString(),
          payload: {
            type: 'control_request',
            request_id: 'perm-1',
            request: {
              subtype: 'can_use_tool',
              tool_name: 'Bash',
              input: { command: 'ls' },
              tool_use_id: 'tu-1',
            },
          },
        })}\n\n`,
    )

    await waitFor(() => securityTierRaised === 1 && toolHostEnded.length === 1)

    // Drop stream 1 and hold stream 2 so the client is cleanly disconnected
    stream1.close()
    await waitFor(() => !mgr.isConnected())

    mgr.respondToPermissionRequest('perm-1', {
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    })

    // First POST fails (502) while disconnected -> stays queued in undeliveredResponses
    await waitFor(
      () => postAttempt === 1 && mgr.getUndeliveredResponseCount() === 1,
    )

    // Now allow reconnect to stream 2 -> rebinds eventSigner & retries undeliveredResponses automatically!
    releaseStream2()
    await waitFor(
      () => postAttempt >= 2 && mgr.getUndeliveredResponseCount() === 0,
    )

    stream2.close()
    mgr.disconnect()

    expect(deliveryUpdates).toEqual([
      { eventId: 'ev-1', status: 'PROCESSING' },
      { eventId: 'ev-2', status: 'PROCESSED' },
    ])
    expect(linesTaken).toEqual(['ev-1'])
    expect(linesSettled).toEqual(['ev-2'])
    expect(workerStatuses).toEqual(['connected'])
    expect(toolHostEnded).toEqual([{ workId: 'w-9', reason: 'host_stopped' }])
    expect(securityTierRaised).toBe(1)
    expect(rebindCount).toBeGreaterThanOrEqual(2)
    // First POST used rebound signer v2; retry after reconnect used fresh rebound signer v3
    expect(postedBodies[0]?.sig).toBe('v2')
    expect(postedBodies[1]?.sig).toBe('v3')
  })
})

// ============================================================================
// Group 2: [P1-12] Bridge API v2 & Headless Watch Stream
// ============================================================================

describe('[P1-12] Bridge API v2 & [bridge:watch] SSE stream', () => {
  const axiosHandle = setupAxiosMock()

  beforeAll(() => {
    axiosHandle.useStubs = true
  })

  afterAll(() => {
    axiosHandle.useStubs = false
  })

  afterEach(() => {
    axiosHandle.stubs.get = undefined
    axiosHandle.stubs.post = undefined
    axiosHandle.stubs.delete = undefined
  })

  test('stripGitUrlCredentials redacts embedded credentials cleanly', () => {
    expect(
      stripGitUrlCredentials(
        'https://ghp_secret:x-oauth@github.com/org/repo.git',
      ),
    ).toBe('https://***@github.com/org/repo.git')
    expect(stripGitUrlCredentials('https://github.com/org/repo.git')).toBe(
      'https://github.com/org/repo.git',
    )
    expect(stripGitUrlCredentials(null)).toBeNull()
  })

  test('registerBridgeEnvironment sends ToolHost capabilities, machine_id, device_uuid, dir_browse, strips git creds, handles 403 enroll_and_retry and 409 conflict', async () => {
    const calls: Array<{
      url: string
      body: Record<string, unknown>
      headers: Record<string, string>
    }> = []
    let mode: 'enroll_ok' | 'conflict_409' = 'enroll_ok'
    let attempt = 0

    axiosHandle.stubs.post = async (url, data, config) => {
      attempt++
      calls.push({
        url,
        body: data as Record<string, unknown>,
        headers: (config?.headers ?? {}) as Record<string, string>,
      })
      if (mode === 'conflict_409') {
        return {
          status: 409,
          data: {
            error: {
              reason: BRIDGE_FOLDER_ALREADY_SERVED,
              message: 'Folder already served by another Claude Code instance.',
            },
          },
          headers: {},
        }
      }
      if (attempt === 1) {
        return {
          status: 403,
          data: { error: { reason: 'untrusted_device' } },
          headers: {},
        }
      }
      return {
        status: 200,
        data: { environment_id: 'env_1', environment_secret: 'sec_1' },
        headers: {},
      }
    }

    const client = createBridgeApiClient({
      baseUrl: 'https://api.example.test',
      getAccessToken: () => 'oauth-tok',
      runnerVersion: '2.7.310',
      getTrustedDeviceToken: () => 'td-old',
      untrustedDevice: {
        recover: async prev => (prev === 'td-old' ? 'td-enrolled' : undefined),
      },
    })

    const baseConfig = {
      dir: '/repo',
      machineName: 'devbox',
      machineId: 'mach-123',
      branch: 'main',
      gitRepoUrl: 'https://alice:hunter2@github.com/acme/app.git',
      maxSessions: 4,
      spawnMode: 'same-dir' as const,
      verbose: false,
      sandbox: false,
      bridgeId: 'br-1',
      workerType: 'claude_code',
      environmentId: 'env-uuid',
      apiBaseUrl: 'https://api.example.test',
      sessionIngressUrl: 'https://api.example.test',
      getDeviceUuid: async () => 'dev-uuid-9',
      getToolHostAdvert: () => ({
        kind: 'advertise' as const,
        advert: { cliVersion: '2.7.310', platform: 'darwin' },
      }),
      getDirectoryBrowseAdvert: () => true,
    }

    const res = await client.registerBridgeEnvironment(baseConfig)
    expect(res).toEqual({
      environment_id: 'env_1',
      environment_secret: 'sec_1',
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.headers['X-Trusted-Device-Token']).toBe('td-old')
    expect(calls[1]!.headers['X-Trusted-Device-Token']).toBe('td-enrolled')
    expect(calls[0]!.body.machine_id).toBe('mach-123')
    expect(calls[0]!.body.git_repo_url).toBe(
      'https://***@github.com/acme/app.git',
    )
    expect(calls[0]!.body.metadata).toEqual({
      worker_type: 'claude_code',
      machine_id: 'mach-123',
      device_uuid: 'dev-uuid-9',
      tool_host: '2',
      tool_host_cc_version: '2.7.310',
      tool_host_platform: 'darwin',
      dir_browse: '1',
    })

    // 409 already-served conflict produces descriptive BridgeFatalError
    mode = 'conflict_409'
    await expect(
      client.registerBridgeEnvironment(baseConfig),
    ).rejects.toMatchObject({
      name: 'BridgeFatalError',
      status: 409,
      errorType: BRIDGE_FOLDER_ALREADY_SERVED,
    })

    // Unrecoverable 403 untrusted_device throws UntrustedDeviceBridgeError
    axiosHandle.stubs.post = async () => ({
      status: 403,
      data: {
        error: {
          reason: 'untrusted_device',
          sub_reason: 'served_call_unsigned',
        },
      },
      headers: {},
    })
    await expect(
      client.registerBridgeEnvironment(baseConfig),
    ).rejects.toBeInstanceOf(UntrustedDeviceBridgeError)
  })

  test('pollForWork sends poll_interval_ms and logs multi-mode dispatch; archiveSession tries v2 first and falls back to v1; markEnvironmentOffline hits /offline', async () => {
    const debugLogs: string[] = []
    const getCalls: Array<{ url: string; params: unknown }> = []
    const postCalls: Array<{ url: string; headers: Record<string, string> }> =
      []

    axiosHandle.stubs.get = async (url, config) => {
      getCalls.push({ url, params: config?.params })
      return {
        status: 200,
        data: {
          id: 'work_1',
          type: 'work',
          environment_id: 'env_1',
          state: 'pending',
          data: { type: 'session', id: 'cse_77', mode: 'tool_host' },
          secret: 'e30',
          created_at: '2026-11-24T00:00:00Z',
        },
        headers: {},
      }
    }

    axiosHandle.stubs.post = async (url, _data, config) => {
      postCalls.push({
        url,
        headers: (config?.headers ?? {}) as Record<string, string>,
      })
      if (url.includes('/v1/code/sessions/cse_77/archive')) {
        return {
          status: 404,
          data: { error: { message: 'not found' } },
          headers: {},
        }
      }
      return { status: 204, data: {}, headers: {} }
    }

    const client = createBridgeApiClient({
      baseUrl: 'https://api.example.test',
      getAccessToken: () => 'oauth-tok',
      runnerVersion: '2.7.310',
      onDebug: msg => debugLogs.push(msg),
    })

    const work = await client.pollForWork(
      'env_1',
      'env_secret',
      undefined,
      30_000,
      5_000,
    )
    expect(work?.id).toBe('work_1')
    expect(getCalls[0]!.params).toEqual({
      reclaim_older_than_ms: 30_000,
      poll_interval_ms: 5_000,
    })
    expect(debugLogs.some(l => l.includes('mode=tool_host'))).toBe(true)

    await client.archiveSession('session_77')
    expect(postCalls.map(c => c.url)).toEqual([
      'https://api.example.test/v1/code/sessions/cse_77/archive',
      'https://api.example.test/v1/sessions/session_77/archive',
    ])

    await client.markEnvironmentOffline('env_1', 'env_secret_xyz')
    expect(postCalls[2]!.url).toBe(
      'https://api.example.test/v1/environments/bridge/env_1/offline',
    )
    expect(postCalls[2]!.headers.Authorization).toBe('Bearer env_secret_xyz')

    expect(
      isSessionsV1RetiredResponse({
        status: 410,
        data: { error: { reason: 'sessions_v1_retired' } },
      }),
    ).toBe(true)
  })

  test('runBridgeLoop preserved shutdown calls markEnvironmentOffline normally and skips on upgrade/reload', async () => {
    const offlineCalls: Array<{ envId: string; secret: string }> = []
    const makeStubApi = (): BridgeApiClient & {
      markEnvironmentOffline: (envId: string, secret: string) => Promise<void>
    } => ({
      registerBridgeEnvironment: async () => ({
        environment_id: 'env_1',
        environment_secret: 'sec_1',
      }),
      pollForWork: async () => null,
      acknowledgeWork: async () => {},
      stopWork: async () => {},
      deregisterEnvironment: async () => {},
      sendPermissionResponseEvent: async () => {},
      archiveSession: async () => {},
      reconnectSession: async () => {},
      heartbeatWork: async () => ({ lease_extended: true, state: 'active' }),
      markEnvironmentOffline: async (envId, secret) => {
        offlineCalls.push({ envId, secret })
      },
    })
    const noopLogger = new Proxy(
      {},
      { get: () => () => {} },
    ) as unknown as BridgeLogger
    const noopSpawner = {
      spawn: () => {
        throw new Error('unused')
      },
    } as unknown as SessionSpawner

    const makeConfig = (cause?: string): BridgeRestartConfig => ({
      dir: '/tmp',
      machineName: 'box',
      branch: 'main',
      gitRepoUrl: null,
      maxSessions: 1,
      spawnMode: 'same-dir',
      verbose: false,
      sandbox: false,
      bridgeId: 'b1',
      workerType: 'claude_code',
      environmentId: 'env_1',
      preserveOnShutdown: true,
      apiBaseUrl: 'https://api.example.test',
      sessionIngressUrl: 'https://api.example.test',
      awaitShutdownCause: async () => cause,
    })

    const aborted = new AbortController()
    aborted.abort()

    // Normal preserved shutdown -> marks offline
    await runBridgeLoop(
      makeConfig(undefined),
      'env_1',
      'sec_normal',
      makeStubApi(),
      noopSpawner,
      noopLogger,
      aborted.signal,
    )
    expect(offlineCalls).toEqual([{ envId: 'env_1', secret: 'sec_normal' }])

    // Reload / upgrade shutdown -> skips markEnvironmentOffline
    await runBridgeLoop(
      makeConfig('reload'),
      'env_1',
      'sec_reload',
      makeStubApi(),
      noopSpawner,
      noopLogger,
      aborted.signal,
    )
    await runBridgeLoop(
      makeConfig('upgrade'),
      'env_1',
      'sec_upgrade',
      makeStubApi(),
      noopSpawner,
      noopLogger,
      aborted.signal,
    )
    expect(offlineCalls).toHaveLength(1)
  })

  test('[bridge:watch] createBridgeSessionsWatch mints resume token, handles sync + tool_host_status frames, and parks on 404', async () => {
    const parsed = parseBridgeWatchFrame(
      JSON.stringify({
        id: 'cse_watch_1',
        environment_id: 'env_9',
        status: 'running',
        worker_status: 'connected',
        last_event_at: '2026-11-24T12:00:00Z',
        external_metadata: {
          tool_host_status: {
            state: 'requested',
            environment_id: 'env_9',
            requested_at: '2026-11-24T12:00:01Z',
          },
        },
      }),
    )
    expect(parsed).toEqual({
      sessionId: 'cse_watch_1',
      environmentId: 'env_9',
      archived: false,
      fingerprint: 'running connected 2026-11-24T12:00:00Z',
      toolHostRequest: {
        environmentId: 'env_9',
        requestedAt: '2026-11-24T12:00:01Z',
      },
    })

    const stream = new PassThrough()
    const states: string[] = []
    const frames: Array<ReturnType<typeof parseBridgeWatchFrame>> = []
    const seenLastIds: string[] = []

    const watch = createBridgeSessionsWatch({
      api: {
        mintResumeToken: async () => ({
          status: 200,
          resumeToken: 'rt-initial-1',
        }),
        open: async (_token, lastEventId) => {
          seenLastIds.push(lastEventId)
          return {
            status: 200,
            body: stream as unknown as NodeJS.ReadableStream & {
              destroy: () => void
            },
          }
        },
      },
      getAccessToken: () => 'oauth-tok',
      onStateChange: s => states.push(s),
      onFrame: f => frames.push(f),
    })

    watch.start()
    await waitFor(() => seenLastIds.length === 1)
    stream.write('event: sync\nid: rt-sync-2\ndata: {}\n\n')
    stream.write(
      `event: changed\ndata: ${JSON.stringify({
        id: 'cse_live',
        environment_id: 'env_9',
        status: 'running',
        worker_status: 'idle',
        last_event_at: '2026-11-24T12:05:00Z',
        external_metadata: {
          tool_host_status: {
            state: 'requested',
            environment_id: 'env_9',
            requested_at: '2026-11-24T12:05:01Z',
          },
        },
      })}\n\n`,
    )

    await waitFor(() => frames.length === 1 && watch.state === 'connected')
    expect(seenLastIds).toEqual(['rt-initial-1'])
    expect(watch.getResumeToken()).toBe('rt-sync-2')
    expect(frames[0]?.toolHostRequest).toEqual({
      environmentId: 'env_9',
      requestedAt: '2026-11-24T12:05:01Z',
    })
    watch.stop()
    expect(watch.state).toBe('off')
    expect(states).toEqual(['connecting', 'connected', 'off'])
  })
})

// ============================================================================
// Group 3: [P1-14] GrowthBook Overrides, cachedFeatureFlags, SESSION_PINNED, ATIS
// ============================================================================

describe('[P1-14] GrowthBook overrides, cachedFeatureFlags, SESSION_PINNED & ATIS', () => {
  const prevEnvOverrides = process.env.CLAUDE_INTERNAL_FC_OVERRIDES

  beforeAll(() => {
    enableConfigs()
  })

  afterEach(() => {
    if (prevEnvOverrides === undefined) {
      delete process.env.CLAUDE_INTERNAL_FC_OVERRIDES
    } else {
      process.env.CLAUDE_INTERNAL_FC_OVERRIDES = prevEnvOverrides
    }
    clearGrowthBookConfigOverrides()
    getPinnedFeatureValues().clear()
    getBootstrapSession().conversationLatches.replaceAtisLatch(undefined)
    resetGrowthBook()
  })

  test('CLAUDE_INTERNAL_FC_OVERRIDES env overrides & config overrides are unstubbed and follow env > config priority', () => {
    setGrowthBookConfigOverride('test_flag_328', 'from-config')
    expect(getGrowthBookConfigOverrides().test_flag_328).toBe('from-config')
    expect(hasGrowthBookOverride('test_flag_328')).toBe(true)
    expect(
      getFeatureValue_CACHED_MAY_BE_STALE('test_flag_328', 'default'),
    ).toBe('from-config')
    expect(getFeatureValueWithSource('test_flag_328', 'default')).toEqual({
      value: 'from-config',
      source: 'override',
    })

    // Env override beats config override
    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
      test_flag_328: 'from-env',
      test_bool_328: true,
    })
    expect(hasGrowthBookEnvOverride('test_flag_328')).toBe(true)
    expect(
      getFeatureValue_CACHED_MAY_BE_STALE('test_flag_328', 'default'),
    ).toBe('from-env')
    expect(getFeatureValue_CACHED_MAY_BE_STALE('test_bool_328', false)).toBe(
      true,
    )

    // Clear config overrides
    delete process.env.CLAUDE_INTERNAL_FC_OVERRIDES
    clearGrowthBookConfigOverrides()
    expect(getGrowthBookConfigOverrides()).toEqual({})
    expect(
      getFeatureValue_CACHED_MAY_BE_STALE('test_flag_328', 'default'),
    ).toBe('default')
  })

  test('readSavedFeatureFlagsFromConfig falls back to cachedFeatureFlags when cachedGrowthBookFeatures is absent', () => {
    expect(
      readSavedFeatureFlagsFromConfig({
        ...getGlobalConfig(),
        cachedGrowthBookFeatures: undefined,
        cachedFeatureFlags: { my_new_flag: 'yes' },
      }),
    ).toEqual({ my_new_flag: 'yes' })

    expect(
      readSavedFeatureFlagsFromConfig({
        ...getGlobalConfig(),
        cachedGrowthBookFeatures: { my_new_flag: 'legacy' },
        cachedFeatureFlags: { my_new_flag: 'new' },
      }),
    ).toEqual({ my_new_flag: 'legacy' })
  })

  test('getFeatureValue_SESSION_PINNED pins first read and peek helpers inspect without pinning', () => {
    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
      tengu_pin_test: 'alpha',
    })
    expect(peekSessionPinnedFeatureValue('tengu_pin_test')).toBeUndefined()
    expect(peekFeatureValue_SESSION_PINNED('tengu_pin_test', 'fallback')).toBe(
      'alpha',
    )
    // peek did NOT pin
    expect(peekSessionPinnedFeatureValue('tengu_pin_test')).toBeUndefined()

    expect(getFeatureValue_SESSION_PINNED('tengu_pin_test', 'fallback')).toBe(
      'alpha',
    )
    // Mutating override later does NOT change pinned session value
    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
      tengu_pin_test: 'beta',
    })
    expect(getFeatureValue_SESSION_PINNED('tengu_pin_test', 'fallback')).toBe(
      'alpha',
    )
    expect(peekFeatureValue_SESSION_PINNED('tengu_pin_test', 'fallback')).toBe(
      'alpha',
    )
    expect(peekSessionPinnedFeatureValue<string>('tengu_pin_test')).toBe(
      'alpha',
    )
  })

  test('ATIS_REQUEST_HEADER, atisPin and latchConversationAtis match official 2.1.328', () => {
    expect(ATIS_REQUEST_HEADER).toBe('x-cc-atis')
    expect(atisPin('v1.pin42.sig.exp.mac')).toBe('pin42')
    expect(atisPin('raw-atis-value')).toBe('raw-atis-value')

    const prevClientData = getGlobalConfig().clientDataCache
    try {
      saveGlobalConfig(c => ({
        ...c,
        clientDataCache: { atis: 'v1.pinA.x.y.z' },
      }))
      latchConversationAtis()
      expect(getRequestAtis()).toBe('v1.pinA.x.y.z')

      // Changing clientDataCache later does not unlatch the conversation ATIS
      saveGlobalConfig(c => ({
        ...c,
        clientDataCache: { atis: 'v1.pinB.x.y.z' },
      }))
      expect(getRequestAtis()).toBe('v1.pinA.x.y.z')

      // Invalid ATIS with whitespace latches as empty -> getRequestAtis returns undefined
      getBootstrapSession().conversationLatches.replaceAtisLatch(undefined)
      saveGlobalConfig(c => ({
        ...c,
        clientDataCache: { atis: 'bad token with spaces' },
      }))
      latchConversationAtis()
      expect(getRequestAtis()).toBeUndefined()
    } finally {
      saveGlobalConfig(c => ({ ...c, clientDataCache: prevClientData }))
    }
  })

  test('growthbook.ts preserves LOCAL_GATE_DEFAULTS, adapter mode, and ownSavedFlags OAuth carry', () => {
    const gbSrc = readFileSync(
      join(import.meta.dir, '../../services/analytics/growthbook.ts'),
      'utf8',
    )
    expect(gbSrc).toContain('LOCAL_GATE_DEFAULTS')
    expect(gbSrc).toContain('CLAUDE_GB_ADAPTER_URL')
    expect(gbSrc).toContain('CLAUDE_GB_ADAPTER_KEY')
    expect(gbSrc).toContain('ownSavedFlags')
    expect(gbSrc).toContain('keepsOwnSavedFlags')
    expect(gbSrc).not.toContain('if (true) return')
  })
})

// ============================================================================
// Group 4: [P0-15 + P1-15 + P2] DEFAULT_BUILD_FEATURES, CLAUDE.md, cli.tsx
// ============================================================================

describe('[P0-15 + P1-15 + P2] DEFAULT_BUILD_FEATURES & cli.tsx version fallback', () => {
  test('DEFAULT_BUILD_FEATURES enables verified official 2.1.328 flags and excludes removed legacy/official-OFF flags', async () => {
    const { DEFAULT_BUILD_FEATURES } = await import(
      '../../../scripts/defines.js'
    )
    const definesSrc = readFileSync(
      join(import.meta.dir, '../../../scripts/defines.ts'),
      'utf8',
    )
    for (const flag of [
      'BASH_CLASSIFIER',
      'HISTORY_PICKER',
      'MCP_SKILLS',
      'WEB_BROWSER_TOOL',
      'AGENT_MEMORY_SNAPSHOT',
      'CCR_AUTO_CONNECT',
      'ENHANCED_TELEMETRY_BETA',
      'NEW_INIT',
      'POWERSHELL_AUTO_MODE',
      'COWORKER_TYPE_TELEMETRY',
    ] as const) {
      expect(DEFAULT_BUILD_FEATURES).toContain(flag)
    }

    for (const removed of [
      'CACHED_MICROCOMPACT',
      'SHOT_STATS',
      'VERIFICATION_AGENT',
      'TEMPLATES',
      'DIRECT_CONNECT',
      'COMMIT_ATTRIBUTION',
    ]) {
      expect(DEFAULT_BUILD_FEATURES as readonly string[]).not.toContain(removed)
      expect(definesSrc).not.toContain(`'${removed}'`)
    }

    const claudeMd = readFileSync(
      join(import.meta.dir, '../../../CLAUDE.md'),
      'utf8',
    )
    expect(claudeMd).toContain(`${DEFAULT_BUILD_FEATURES.length} 个`)
  })

  test('cli.tsx MACRO.VERSION fallback matches package.json version (no stale 2.1.888)', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../package.json'), 'utf8'),
    ) as { version: string }
    const cliSrc = readFileSync(
      join(import.meta.dir, '../../entrypoints/cli.tsx'),
      'utf8',
    )
    expect(cliSrc).toContain(
      `process.env.CLAUDE_CODE_VERSION || '${pkg.version}'`,
    )
    expect(cliSrc).not.toContain("'2.1.888'")
  })
})
