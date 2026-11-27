import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from 'node:http'
import { type AddressInfo, createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionHost } from 'src/utils/sessionHost.js'
import { createRootSession } from 'src/utils/sessionRoot.js'
import { startGatewayOrExit } from '../handlers/gateway.js'
import {
  type GatewayServerHandle,
  parseGatewayConfig,
  startGatewayServer,
} from '../handlers/gatewayServer.js'
import {
  buildTurnHandoffCapability,
  dispatchPrintControlExtra,
  evaluateTurnHandoffAdmission,
  getTurnHandoffManager,
  isSafeRelativePath,
  resetTurnHandoffManager,
  shouldAdvertiseTurnHandoffRelayMarker,
  TURN_HANDOFF_DEFAULT_TOOLS,
  TURN_HANDOFF_MAX_ITEMS,
  TURN_HANDOFF_VERSION,
  TurnHandoffManager,
  TurnHandoffSnapshotSchema,
} from '../printControlExtras.js'

function createMockSession(id: string) {
  return createRootSession({
    host: createSessionHost(),
    id,
    project: {
      originalCwd: '/tmp/project',
      projectRoot: '/tmp/project',
      cwd: '/tmp/project',
    },
  })
}

async function readBodyText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function startMockHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(err => {
      if (!res.headersSent) {
        res.writeHead(500)
      }
      res.end(String(err))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections()
        }
      }),
  }
}

describe('Official 2.1.331 turn_handoff admission, relay marker, and capabilities', () => {
  test('evaluateTurnHandoffAdmission enforces disabled and managed-cloud-worker gates', () => {
    expect(
      evaluateTurnHandoffAdmission({
        remoteSessionId: 'sess-1',
        disabled: true,
      }),
    ).toEqual({ admitted: false, reason: 'disabled' })

    expect(evaluateTurnHandoffAdmission({})).toEqual({
      admitted: false,
      reason: 'not_managed_cloud_worker',
    })

    expect(
      evaluateTurnHandoffAdmission({
        remoteSessionId: 'sess-remote-1',
      }),
    ).toEqual({
      admitted: true,
      tools: TURN_HANDOFF_DEFAULT_TOOLS,
      hydratesCarriedLines: false,
    })

    expect(
      evaluateTurnHandoffAdmission({
        environmentKind: 'cloud',
        tools: ['Read', 'Bash'],
        hydratesCarriedLines: true,
        answersComparisonFork: true,
      }),
    ).toEqual({
      admitted: true,
      tools: ['Read', 'Bash'],
      hydratesCarriedLines: true,
      answersComparisonFork: true,
    })
  })

  test('shouldAdvertiseTurnHandoffRelayMarker matches official g5r predicate', () => {
    const admitted = evaluateTurnHandoffAdmission({
      remoteSessionId: 'sess-1',
    })
    const denied = evaluateTurnHandoffAdmission({})

    expect(
      shouldAdvertiseTurnHandoffRelayMarker({
        admission: admitted,
        relayConfigured: true,
        persistsTranscript: true,
        sharedBackend: false,
      }),
    ).toBe(true)

    expect(
      shouldAdvertiseTurnHandoffRelayMarker({
        admission: admitted,
        relayConfigured: true,
        persistsTranscript: true,
        sharedBackend: true,
      }),
    ).toBe(false)

    expect(
      shouldAdvertiseTurnHandoffRelayMarker({
        admission: admitted,
        relayConfigured: false,
        persistsTranscript: true,
        sharedBackend: false,
      }),
    ).toBe(false)

    expect(
      shouldAdvertiseTurnHandoffRelayMarker({
        admission: admitted,
        relayConfigured: true,
        persistsTranscript: false,
        sharedBackend: false,
      }),
    ).toBe(false)

    expect(
      shouldAdvertiseTurnHandoffRelayMarker({
        admission: denied,
        relayConfigured: true,
        persistsTranscript: true,
        sharedBackend: false,
      }),
    ).toBe(false)
  })

  test('buildTurnHandoffCapability produces exact official sr wire shape', () => {
    const unadmitted = evaluateTurnHandoffAdmission({})
    expect(
      buildTurnHandoffCapability(unadmitted, { workerEpoch: 0 }),
    ).toBeUndefined()

    const disabled = evaluateTurnHandoffAdmission({
      remoteSessionId: 'sess-1',
      disabled: true,
    })
    expect(buildTurnHandoffCapability(disabled, { workerEpoch: 0 })).toEqual({
      turn_handoff: null,
    })

    const admittedMinimal = evaluateTurnHandoffAdmission({
      remoteSessionId: 'sess-1',
    })
    expect(
      buildTurnHandoffCapability(admittedMinimal, {
        workerEpoch: 3,
        carriedWrites: true, // ignored unless homeFiles is also true
      }),
    ).toEqual({
      turn_handoff: {
        v: TURN_HANDOFF_VERSION,
        tools: TURN_HANDOFF_DEFAULT_TOOLS,
        worker_epoch: 3,
        staged_files: true,
        no_query_first: true,
        shared_message_id: true,
        requires_rewind_request_id: true,
      },
    })

    const admittedFull = evaluateTurnHandoffAdmission({
      remoteSessionId: 'sess-2',
      tools: ['Read', 'Write'],
      hydratesCarriedLines: true,
      answersComparisonFork: true,
    })
    expect(
      buildTurnHandoffCapability(admittedFull, {
        workerEpoch: 7,
        relayMarker: true,
        homeFiles: true,
        carriedWrites: true,
      }),
    ).toEqual({
      turn_handoff: {
        v: 1,
        tools: ['Read', 'Write'],
        worker_epoch: 7,
        staged_files: true,
        no_query_first: true,
        shared_message_id: true,
        requires_rewind_request_id: true,
        relay_marker: true,
        home_files: true,
        file_names: true,
        carried_writes: true,
        hydrates_carried_lines: true,
        comparison_fork: true,
      },
    })
  })
})

describe('Official 2.1.331 TurnHandoffManager multi-tenant state machine & security', () => {
  test('Worker 1 shutdown -> exportHandoffSnapshot -> Worker 2 hydrateFromHandoffSnapshot', () => {
    const worker1 = new TurnHandoffManager()
    worker1.stageFile('src/app.ts', 'export const x = 1\n')
    worker1.recordCarriedWrite('notes/plan.md', '# Plan\n', 'create')
    worker1.recordHomeFile('scratch.txt', 'hello home')
    worker1.markMultiTenantWorkerShutdown()
    expect(worker1.multiTenantShutdownAborted).toBe(true)

    const snapshot = worker1.exportHandoffSnapshot({
      sessionId: 'sess-mt-1',
      sharedMessageId: 'msg-shared-42',
      rewindRequestId: 'req-rewind-7',
      messages: [
        { type: 'user', uuid: 'u1', content: 'start' },
        { type: 'assistant', uuid: 'a1', content: 'working' },
      ],
    })

    expect(snapshot.v).toBe(1)
    expect(snapshot.worker_epoch).toBe(1)
    expect(snapshot.session_id).toBe('sess-mt-1')
    expect(snapshot.shared_message_id).toBe('msg-shared-42')
    expect(snapshot.rewind_request_id).toBe('req-rewind-7')
    expect(snapshot.multi_tenant_worker_shutdown).toBe(true)
    expect(snapshot.staged_files).toHaveLength(1)
    expect(snapshot.staged_files?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.carried_writes).toEqual([
      { path: 'notes/plan.md', content: '# Plan\n', mode: 'create' },
    ])
    expect(snapshot.home_files).toEqual([
      { name: 'scratch.txt', content: 'hello home' },
    ])

    const worker2 = new TurnHandoffManager()
    const hydrated = worker2.hydrateFromHandoffSnapshot(snapshot)
    expect(hydrated).toEqual({
      ok: true,
      appliedEpoch: 1,
      stagedCount: 1,
      carriedWriteCount: 1,
      homeFileCount: 1,
      droppedMessages: 0,
    })
    expect(worker2.workerEpoch).toBe(1)
    expect(worker2.multiTenantShutdownAborted).toBe(true)
    expect(worker2.lastSharedMessageId).toBe('msg-shared-42')
    expect(worker2.lastRewindRequestId).toBe('req-rewind-7')
    expect(worker2.stagedFiles.get('src/app.ts')?.content).toBe(
      'export const x = 1\n',
    )
    expect(worker2.carriedWrites.get('notes/plan.md')?.mode).toBe('create')
    expect(worker2.homeFiles.get('scratch.txt')?.content).toBe('hello home')
    expect(worker2.hydratedMessages).toHaveLength(2)

    // Exporting again from Worker 2 monotonically increments epoch to 2.
    const nextSnapshot = worker2.exportHandoffSnapshot({
      sessionId: 'sess-mt-1',
    })
    expect(nextSnapshot.worker_epoch).toBe(2)
  })

  test('rejects path traversal, absolute paths, drive paths, empty paths, and NUL bytes', () => {
    const manager = new TurnHandoffManager()
    const badPaths = [
      '',
      '   ',
      '../secret',
      'a/../../etc/passwd',
      '..\\windows\\system.ini',
      '/etc/passwd',
      '\\unc\\share',
      'C:\\Users\\admin\\secret.txt',
      'valid/file\0.txt',
    ]

    for (const bad of badPaths) {
      expect(() => manager.stageFile(bad, 'x')).toThrow()
      expect(() => manager.recordCarriedWrite(bad, 'x')).toThrow()
      expect(() => manager.recordHomeFile(bad, 'x')).toThrow()

      const res = manager.hydrateFromHandoffSnapshot({
        v: 1,
        worker_epoch: 1,
        session_id: 'sess-sec',
        staged_files: [{ path: bad, content: 'x' }],
      })
      expect(res.ok).toBe(false)
    }
  })

  test('rejects stale worker_epoch rollback attacks and caps/rejects >200 messages', () => {
    const manager = new TurnHandoffManager()
    const first = manager.hydrateFromHandoffSnapshot({
      v: 1,
      worker_epoch: 5,
      session_id: 'sess-epoch',
    })
    expect(first.ok).toBe(true)
    expect(manager.workerEpoch).toBe(5)

    // Equal epoch rejected
    const replay = manager.hydrateFromHandoffSnapshot({
      v: 1,
      worker_epoch: 5,
      session_id: 'sess-epoch',
    })
    expect(replay.ok).toBe(false)
    if (!replay.ok) {
      expect(replay.error).toContain('rollback')
    }

    // Older epoch rejected
    const rollback = manager.hydrateFromHandoffSnapshot({
      v: 1,
      worker_epoch: 2,
      session_id: 'sess-epoch',
    })
    expect(rollback.ok).toBe(false)

    // >200 messages rejected by strict TurnHandoffSnapshotSchema directly
    const manyMessages = Array.from({ length: 235 }, (_, i) => ({
      index: i,
      text: `m-${i}`,
    }))
    const schemaCheck = TurnHandoffSnapshotSchema.safeParse({
      v: 1,
      worker_epoch: 6,
      session_id: 'sess-epoch',
      messages: manyMessages,
    })
    expect(schemaCheck.success).toBe(false)

    // hydrateFromHandoffSnapshot caps >200 messages to 200 and reports droppedMessages
    const capped = manager.hydrateFromHandoffSnapshot({
      v: 1,
      worker_epoch: 6,
      session_id: 'sess-epoch',
      messages: manyMessages,
    })
    expect(capped).toEqual({
      ok: true,
      appliedEpoch: 6,
      stagedCount: 0,
      carriedWriteCount: 0,
      homeFileCount: 0,
      droppedMessages: 35,
    })
    expect(manager.hydratedMessages).toHaveLength(TURN_HANDOFF_MAX_ITEMS)
    expect((manager.hydratedMessages[0] as { index: number }).index).toBe(35)
    expect((manager.hydratedMessages[199] as { index: number }).index).toBe(234)
  })

  test('isolates concurrent multi-tenant sessions via RootSessionSlot and wires printControlExtras', () => {
    const sessionA = createMockSession('tenant-a')
    const sessionB = createMockSession('tenant-b')
    const forkOfA = sessionA.withProject({ cwd: '/tmp/project/subdir' })

    const mgrA = getTurnHandoffManager(sessionA)
    const mgrB = getTurnHandoffManager(sessionB)
    const mgrAFork = getTurnHandoffManager(forkOfA)

    expect(mgrA).not.toBe(mgrB)
    expect(mgrAFork).toBe(mgrA)

    mgrA.stageFile('tenant-a.txt', 'secret-a')
    mgrB.stageFile('tenant-b.txt', 'secret-b')

    expect(mgrA.stagedFiles.has('tenant-a.txt')).toBe(true)
    expect(mgrA.stagedFiles.has('tenant-b.txt')).toBe(false)
    expect(mgrB.stagedFiles.has('tenant-b.txt')).toBe(true)
    expect(mgrB.stagedFiles.has('tenant-a.txt')).toBe(false)

    // Verify control request dispatch through printControlExtras
    resetTurnHandoffManager()
    const successes: Array<Record<string, unknown> | undefined> = []
    const errors: string[] = []
    const handled = dispatchPrintControlExtra(
      'turn_handoff',
      {
        request_id: 'ctrl-1',
        payload: {
          v: 1,
          worker_epoch: 2,
          session_id: 'sess-ctrl',
          staged_files: [{ path: 'hello.ts', content: 'console.log(1)' }],
        },
      },
      {
        getMcpClients: () => [],
        getPermissionContext: () => ({}),
        setPromptSuggestionEnabled: () => {},
        sendSuccess: r => successes.push(r),
        sendError: e => errors.push(e),
        defer: fn => {
          void fn()
        },
        errorMessage: err => String(err),
        turnHandoffAdmission: { admitted: true },
      },
    )
    expect(handled).toBe(true)
    expect(errors).toEqual([])
    expect(successes).toEqual([
      {
        status: 'hydrated',
        applied_epoch: 2,
        staged_count: 1,
        carried_write_count: 0,
        home_file_count: 0,
        dropped_messages: 0,
      },
    ])

    // P1-7: action === 'export' routes through printControlExtras -> exported snapshot
    const exportSuccesses: Array<Record<string, unknown> | undefined> = []
    const exportErrors: string[] = []
    const exportHandled = dispatchPrintControlExtra(
      'turn_handoff',
      {
        request_id: 'ctrl-export-1',
        action: 'export',
        session_id: 'sess-ctrl',
      },
      {
        getMcpClients: () => [],
        getPermissionContext: () => ({}),
        setPromptSuggestionEnabled: () => {},
        sendSuccess: r => exportSuccesses.push(r),
        sendError: e => exportErrors.push(e),
        defer: fn => {
          void fn()
        },
        errorMessage: err => String(err),
        turnHandoffAdmission: { admitted: true },
      },
    )
    expect(exportHandled).toBe(true)
    expect(exportErrors).toEqual([])
    expect(exportSuccesses).toHaveLength(1)
    expect(exportSuccesses[0]).toMatchObject({
      status: 'exported',
      snapshot: {
        v: 1,
        worker_epoch: 3,
        session_id: 'sess-ctrl',
      },
    })
    resetTurnHandoffManager()
  })

  test('P1-7 & P2-5: tightens isSafeRelativePath, requires worker_epoch >= 1 in schema, and avoids double JSON.stringify on hydrate', () => {
    const tightenedBadPaths = [
      '.',
      './file.ts',
      'a/./b.ts',
      'a/.',
      'a//b.ts',
      'a/b/',
      ' leading/file.ts',
      'trailing/file.ts ',
      'dir/ leading.ts',
      'dir /file.ts',
      'line\nbreak.ts',
      'carriage\rreturn.ts',
      'tab\tchar.ts',
      'del\x7fchar.ts',
    ]
    for (const bad of tightenedBadPaths) {
      expect(isSafeRelativePath(bad)).toBe(false)
    }
    expect(isSafeRelativePath('src/app.ts')).toBe(true)
    expect(isSafeRelativePath('dir/my file.ts')).toBe(true)

    // Schema agrees with manager: worker_epoch must be >= 1
    expect(
      TurnHandoffSnapshotSchema.safeParse({
        v: 1,
        worker_epoch: 0,
        session_id: 'sess-zero',
      }).success,
    ).toBe(false)
    expect(
      TurnHandoffSnapshotSchema.safeParse({
        v: 1,
        worker_epoch: 1,
        session_id: 'sess-one',
      }).success,
    ).toBe(true)

    // P2-5: hydrateFromHandoffSnapshot calls JSON.stringify once (no double stringify in schema refine)
    const manager = new TurnHandoffManager()
    const stringifySpy = spyOn(JSON, 'stringify')
    try {
      const res = manager.hydrateFromHandoffSnapshot({
        v: 1,
        worker_epoch: 1,
        session_id: 'sess-single-stringify',
        staged_files: [{ path: 'a/b.ts', content: 'const x = 1' }],
      })
      expect(res.ok).toBe(true)
      expect(stringifySpy).toHaveBeenCalledTimes(1)
    } finally {
      stringifySpy.mockRestore()
    }
  })
})

describe('Official 2.1.331 cross-process `claude gateway` HTTP auth & OTLP server E2E', () => {
  const handlesToClose: Array<() => Promise<void>> = []
  const tempDirs: string[] = []

  afterEach(async () => {
    while (handlesToClose.length > 0) {
      const close = handlesToClose.pop()!
      await close()
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('parseGatewayConfig supports YAML, JSON, listen shorthand, and rejects invalid input', () => {
    const yamlCfg = parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
  trusted_proxies:
    - 10.0.0.1
auth:
  require_auth: true
  bearer_tokens:
    - tok-alpha
models:
  - id: claude-sonnet-4-5
    display_name: Claude Sonnet 4.5
`)
    expect(yamlCfg.listen.host).toBe('127.0.0.1')
    expect(yamlCfg.listen.port).toBe(0)
    expect(yamlCfg.listen.trusted_proxies).toEqual(['10.0.0.1'])
    expect(yamlCfg.auth?.bearer_tokens).toEqual(['tok-alpha'])
    expect(yamlCfg.models?.[0]?.id).toBe('claude-sonnet-4-5')

    const jsonCfg = parseGatewayConfig(
      JSON.stringify({ listen: '127.0.0.1:9090' }),
    )
    expect(jsonCfg.listen.host).toBe('127.0.0.1')
    expect(jsonCfg.listen.port).toBe(9090)

    expect(() => parseGatewayConfig('')).toThrow()
    expect(() => parseGatewayConfig('- just-a-list')).toThrow()
  })

  test('end-to-end auth, inference proxy with API key swap, models catalog, and OTLP collector relay', async () => {
    const capturedInference: Array<{
      method: string
      url: string
      headers: Record<string, string | string[] | undefined>
      body: string
    }> = []

    const mockAnthropic = await startMockHttpServer(async (req, res) => {
      const body = await readBodyText(req)
      capturedInference.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_mock_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'pong from upstream' }],
        }),
      )
    })
    handlesToClose.push(mockAnthropic.close)

    const capturedOtlp: Array<{
      url: string
      headers: Record<string, string | string[] | undefined>
      body: string
    }> = []

    const mockOtlp = await startMockHttpServer(async (req, res) => {
      const body = await readBodyText(req)
      capturedOtlp.push({
        url: req.url ?? '',
        headers: req.headers,
        body,
      })
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ accepted: true }))
    })
    handlesToClose.push(mockOtlp.close)

    const yamlConfigText = `
listen:
  host: 127.0.0.1
  port: 0
  trusted_proxies: []
auth:
  require_auth: true
  bearer_tokens:
    - gw-secret-token-1
upstreams:
  anthropic:
    url: ${mockAnthropic.url}
    api_key: sk-ant-upstream-real-key
    timeout_ms: 10000
telemetry:
  forward_to: ${mockOtlp.url}
  headers:
    x-collector-tenant: acme-corp
  timeout_ms: 5000
models:
  - id: claude-opus-4-7
    display_name: Claude Opus 4.7
`
    const parsedConfig = parseGatewayConfig(yamlConfigText)
    const gateway: GatewayServerHandle = await startGatewayServer(parsedConfig)
    handlesToClose.push(gateway.close)

    expect(gateway.port).toBeGreaterThan(0)
    expect(gateway.url).toBe(`http://127.0.0.1:${gateway.port}`)

    // 1. /healthz and /readyz always bypass auth
    const healthRes = await fetch(`${gateway.url}/healthz`)
    expect(healthRes.status).toBe(200)
    const healthBody = (await healthRes.json()) as {
      ok: boolean
      status: string
      uptime_ms: number
    }
    expect(healthBody.ok).toBe(true)
    expect(healthBody.status).toBe('ready')
    expect(typeof healthBody.uptime_ms).toBe('number')

    const readyRes = await fetch(`${gateway.url}/readyz`)
    expect(readyRes.status).toBe(200)

    // 2. /v1/messages returns 401 without bearer token or with invalid token
    const unauthRes = await fetch(`${gateway.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-7', messages: [] }),
    })
    expect(unauthRes.status).toBe(401)

    const badTokenRes = await fetch(`${gateway.url}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-opus-4-7', messages: [] }),
    })
    expect(badTokenRes.status).toBe(401)

    // 3. /v1/models returns configured catalog with valid auth
    const modelsRes = await fetch(`${gateway.url}/v1/models`, {
      headers: { authorization: 'Bearer gw-secret-token-1' },
    })
    expect(modelsRes.status).toBe(200)
    expect(await modelsRes.json()).toEqual({
      data: [{ id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' }],
    })

    // 4. /v1/messages with valid bearer token forwards body, swaps to upstream API key,
    //    never leaks gateway bearer token, and strips untrusted X-Forwarded-For
    const msgPayload = JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'ping' }],
    })
    const okMsgRes = await fetch(`${gateway.url}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer gw-secret-token-1',
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-forwarded-for': '203.0.113.99',
      },
      body: msgPayload,
    })
    expect(okMsgRes.status).toBe(200)
    const msgJson = (await okMsgRes.json()) as { id: string }
    expect(msgJson.id).toBe('msg_mock_123')

    expect(capturedInference).toHaveLength(1)
    expect(capturedInference[0]?.url).toBe('/v1/messages')
    expect(capturedInference[0]?.body).toBe(msgPayload)
    expect(capturedInference[0]?.headers['x-api-key']).toBe(
      'sk-ant-upstream-real-key',
    )
    expect(capturedInference[0]?.headers.authorization).toBeUndefined()
    expect(capturedInference[0]?.headers['x-forwarded-for']).toBeUndefined()
    expect(capturedInference[0]?.headers['anthropic-version']).toBe(
      '2023-06-01',
    )

    // 5. /v1/traces and /v1/logs OTLP relay reaches mock collector with telemetry headers
    const tracesRes = await fetch(`${gateway.url}/v1/traces`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer gw-secret-token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ resourceSpans: [{ span: 's1' }] }),
    })
    expect(tracesRes.status).toBe(202)

    const logsRes = await fetch(`${gateway.url}/v1/logs`, {
      method: 'POST',
      headers: {
        'x-api-key': 'gw-secret-token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ resourceLogs: [{ log: 'l1' }] }),
    })
    expect(logsRes.status).toBe(202)

    expect(capturedOtlp).toHaveLength(2)
    expect(capturedOtlp[0]?.url).toBe('/v1/traces')
    expect(capturedOtlp[0]?.headers['x-collector-tenant']).toBe('acme-corp')
    expect(capturedOtlp[0]?.headers.authorization).toBeUndefined()
    expect(capturedOtlp[1]?.url).toBe('/v1/logs')
    expect(capturedOtlp[1]?.headers['x-api-key']).toBeUndefined()

    const stats = gateway.stats()
    expect(stats.inferenceRequests).toBe(1)
    expect(stats.otlpRequests).toBe(2)
    expect(stats.requests).toBeGreaterThanOrEqual(8)

    await gateway.close()
  })

  test('drops OTLP with 204 when unconfigured, returns 503 without upstream, and drains via startGatewayOrExit', async () => {
    const minimalGateway = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
`),
    )
    handlesToClose.push(minimalGateway.close)

    const otlpDrop = await fetch(`${minimalGateway.url}/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceMetrics: [] }),
    })
    expect(otlpDrop.status).toBe(204)

    const noUpstream = await fetch(`${minimalGateway.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(noUpstream.status).toBe(503)

    // Verify startGatewayOrExit loads YAML file, starts server, serves /healthz, and drains cleanly on abort
    const dir = mkdtempSync(join(tmpdir(), 'claude-gw-e2e-'))
    tempDirs.push(dir)
    const cfgPath = join(dir, 'gateway.yaml')
    writeFileSync(cfgPath, 'listen:\n  host: 127.0.0.1\n  port: 0\n')

    const ac = new AbortController()
    let listenedUrl = ''
    const runPromise = startGatewayOrExit(cfgPath, {
      signal: ac.signal,
      onListening: handle => {
        listenedUrl = handle.url
        void fetch(`${handle.url}/healthz`)
          .then(r => {
            expect(r.status).toBe(200)
          })
          .finally(() => {
            ac.abort()
          })
      },
    })
    const drainedHandle = await runPromise
    expect(listenedUrl).toBe(drainedHandle.url)
    expect(drainedHandle.stats().requests).toBe(1)
  })

  test('P0-4: blocks encoded traversal/separators with 400 before proxying and deduplicates /v1 base URL + merges searchParams', async () => {
    const upstreamHits: string[] = []
    const mockAnthropic = await startMockHttpServer(async (req, res) => {
      upstreamHits.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, path: req.url }))
    })
    handlesToClose.push(mockAnthropic.close)

    const gateway = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
upstreams:
  anthropic:
    url: ${mockAnthropic.url}/proxy/v1?api-version=2025
`),
    )
    handlesToClose.push(gateway.close)

    const sendRawPath = (
      rawPath: string,
    ): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const socket = createConnection(
          { host: '127.0.0.1', port: gateway.port },
          () => {
            socket.write(
              `POST ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${gateway.port}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
            )
          },
        )
        const chunks: Buffer[] = []
        socket.on('data', (c: Buffer) => chunks.push(c))
        socket.on('error', reject)
        socket.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const statusMatch = /^HTTP\/1\.\d\s+(\d+)/.exec(raw)
          const bodyIdx = raw.indexOf('\r\n\r\n')
          resolve({
            status: statusMatch ? Number(statusMatch[1]) : 0,
            body: bodyIdx >= 0 ? raw.slice(bodyIdx + 4) : '',
          })
        })
      })

    for (const badPath of [
      '/v1/%2e%2e/admin',
      '/v1/%2E%2E/admin',
      '/v1/%2fadmin',
      '/v1/%5cadmin',
      '/v1/..\\admin',
      '/v1/../admin',
      '/v1/%ZZ',
    ]) {
      const res = await sendRawPath(badPath)
      expect(res.status).toBe(400)
    }
    expect(upstreamHits).toHaveLength(0)

    // Deduplicates trailing /v1 and merges base + incoming searchParams
    const okRes = await fetch(`${gateway.url}/v1/messages?beta=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude' }),
    })
    expect(okRes.status).toBe(200)
    expect(upstreamHits).toEqual([
      '/proxy/v1/messages?api-version=2025&beta=true',
    ])
  })

  test('P1-4: enforces CIDR trusted_proxies, strips all forwarded headers when untrusted, returns clean 413 with Connection: close, handles post-header upstream errors, aborts upstream on disconnect, and validates config', async () => {
    // 1. Config validation: http/https only, CRLF/NUL in telemetry headers, strict port parsing
    expect(() =>
      parseGatewayConfig(
        JSON.stringify({ listen: { public_url: 'file:///etc/passwd' } }),
      ),
    ).toThrow()
    expect(() =>
      parseGatewayConfig(
        JSON.stringify({
          upstreams: { anthropic: { url: 'ftp://evil.example.com' } },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseGatewayConfig(
        JSON.stringify({
          telemetry: { forward_to: 'javascript:alert(1)' },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseGatewayConfig(
        JSON.stringify({
          telemetry: {
            forward_to: 'http://127.0.0.1:4318',
            headers: { 'x-ok': 'bad\r\nInjected: 1' },
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseGatewayConfig(
        JSON.stringify({
          telemetry: {
            forward_to: 'http://127.0.0.1:4318',
            headers: { 'x-bad\nkey': 'value' },
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseGatewayConfig(JSON.stringify({ listen: '127.0.0.1:' })),
    ).toThrow()
    expect(() =>
      parseGatewayConfig(JSON.stringify({ listen: '[::1]:70000' })),
    ).toThrow()

    // 2. Untrusted peer strips ALL forwarded headers; trusted CIDR preserves/appends them
    const seenHeaders: Array<Record<string, string | string[] | undefined>> = []
    const mockUpstream = await startMockHttpServer(async (req, res) => {
      await readBodyText(req)
      seenHeaders.push(req.headers)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    handlesToClose.push(mockUpstream.close)

    const untrustedGw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
  trusted_proxies:
    - 10.0.0.0/8
upstreams:
  anthropic:
    url: ${mockUpstream.url}
`),
    )
    handlesToClose.push(untrustedGw.close)

    const spoofHeaders = {
      'content-type': 'application/json',
      forwarded: 'for=198.51.100.7;proto=https',
      'x-real-ip': '198.51.100.7',
      'x-forwarded-for': '198.51.100.7',
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-port': '443',
    }
    const untrustedRes = await fetch(`${untrustedGw.url}/v1/messages`, {
      method: 'POST',
      headers: spoofHeaders,
      body: '{}',
    })
    expect(untrustedRes.status).toBe(200)
    expect(seenHeaders[0]?.forwarded).toBeUndefined()
    expect(seenHeaders[0]?.['x-real-ip']).toBeUndefined()
    expect(seenHeaders[0]?.['x-forwarded-for']).toBeUndefined()
    expect(seenHeaders[0]?.['x-forwarded-host']).toBeUndefined()
    expect(seenHeaders[0]?.['x-forwarded-proto']).toBeUndefined()
    expect(seenHeaders[0]?.['x-forwarded-port']).toBeUndefined()

    // Trusted proxy via IPv4 CIDR (127.0.0.0/8) preserves forwarded headers & appends peer IP
    const trustedCidrGw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
  trusted_proxies:
    - 127.0.0.0/8
upstreams:
  anthropic:
    url: ${mockUpstream.url}
`),
    )
    handlesToClose.push(trustedCidrGw.close)

    const trustedRes = await fetch(`${trustedCidrGw.url}/v1/messages`, {
      method: 'POST',
      headers: spoofHeaders,
      body: '{}',
    })
    expect(trustedRes.status).toBe(200)
    expect(seenHeaders[1]?.['x-forwarded-for']).toBe('198.51.100.7, 127.0.0.1')
    expect(seenHeaders[1]?.['x-real-ip']).toBe('198.51.100.7')
    expect(seenHeaders[1]?.forwarded).toBe('for=198.51.100.7;proto=https')
    expect(seenHeaders[1]?.['x-forwarded-host']).toBe('evil.example.com')

    // Trusted proxy via IPv4-mapped IPv6 entry (::ffff:127.0.0.1) also matches IPv4 127.0.0.1
    const mappedGw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
  trusted_proxies:
    - "::ffff:127.0.0.1"
upstreams:
  anthropic:
    url: ${mockUpstream.url}
`),
    )
    handlesToClose.push(mappedGw.close)

    const mappedRes = await fetch(`${mappedGw.url}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '203.0.113.5',
      },
      body: '{}',
    })
    expect(mappedRes.status).toBe(200)
    expect(seenHeaders[2]?.['x-real-ip']).toBe('203.0.113.5')

    // 3. Oversize body returns clean 413 + Connection: close (both Content-Length fast-reject and chunked)
    const smallLimitGw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
upstreams:
  anthropic:
    url: ${mockUpstream.url}
`),
      { maxRequestBodyBytes: 64 },
    )
    handlesToClose.push(smallLimitGw.close)

    const fastReject413 = await fetch(`${smallLimitGw.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(256),
    })
    expect(fastReject413.status).toBe(413)
    expect(fastReject413.headers.get('connection')?.toLowerCase()).toBe('close')
    expect(await fastReject413.json()).toMatchObject({
      error: { type: 'request_too_large' },
    })

    // Chunked transfer without Content-Length also returns clean 413
    const chunked413 = await new Promise<{
      status: number
      connection: string | undefined
      body: string
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: smallLimitGw.port,
          method: 'POST',
          path: '/v1/messages',
          headers: {
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
        },
        res => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              connection: res.headers.connection,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          )
        },
      )
      req.on('error', reject)
      req.write('a'.repeat(40))
      req.write('b'.repeat(40))
      req.end()
    })
    expect(chunked413.status).toBe(413)
    expect(chunked413.connection?.toLowerCase()).toBe('close')
    expect(JSON.parse(chunked413.body)).toMatchObject({
      error: { type: 'request_too_large' },
    })

    // 4. Mid-stream upstream error after headers sent closes cleanly without throwing ERR_HTTP_HEADERS_SENT
    const streamFailGw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
upstreams:
  anthropic:
    url: http://127.0.0.1:9999
`),
      {
        fetchImpl: async () => {
          let pulls = 0
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1
              if (pulls === 1) {
                controller.enqueue(new TextEncoder().encode('partial'))
              } else {
                controller.error(new Error('upstream stream exploded'))
              }
            },
          })
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          })
        },
      },
    )
    handlesToClose.push(streamFailGw.close)

    const partialRes = await fetch(`${streamFailGw.url}/v1/messages`, {
      method: 'POST',
      body: '{}',
    })
    expect(partialRes.status).toBe(200)
    expect(await partialRes.text()).toBe('partial')

    // 5. Client disconnect aborts upstream fetchImpl signal
    let upstreamAborted = false
    let markUpstreamStarted!: () => void
    const upstreamStarted = new Promise<void>(r => {
      markUpstreamStarted = r
    })
    const abortCheckGw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
upstreams:
  anthropic:
    url: http://127.0.0.1:9999
`),
      {
        fetchImpl: ((_url: unknown, init?: RequestInit) => {
          markUpstreamStarted()
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                upstreamAborted = true
                reject(new Error('aborted'))
              },
              { once: true },
            )
          })
        }) as typeof fetch,
      },
    )
    handlesToClose.push(abortCheckGw.close)

    const clientSock = createConnection(
      { host: '127.0.0.1', port: abortCheckGw.port },
      () => {
        clientSock.write(
          `GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:${abortCheckGw.port}\r\n\r\n`,
        )
      },
    )
    clientSock.on('error', () => {})
    await upstreamStarted
    clientSock.destroy()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(upstreamAborted).toBe(true)
  })
})
