import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'
import { connect } from 'net'
import WebSocket, { WebSocketServer } from 'ws'
import { MonitorTool } from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import { leftoverPolicyLimitsHost } from '../../cli/leftoverTulip.js'
import { monitorSocketRegistry } from '../../services/artifactAutoReact/oF.js'
import {
  MonitorWsPreconditionError,
  resolveMonitorWsUrl,
  spawnMonitorWebSocket,
} from '../monitorWsSpawn.js'
import { createTaskRegistry } from '../taskRegistry.js'
import {
  killMonitorWs,
  killMonitorWsTasksForAgent,
} from '../../tasks/MonitorWsTask/MonitorWsTask.js'
import type { AppState } from '../../state/AppState.js'
import type { AgentId } from '../../types/ids.js'
import { getCommandQueue, removeByFilter } from '../messageQueueManager.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'

const src = readFileSync(join(import.meta.dir, '../monitorWsSpawn.ts'), 'utf8')
const exec = readFileSync(
  join(import.meta.dir, '../../services/tools/StreamingToolExecutor.ts'),
  'utf8',
)
const notify = readFileSync(
  join(import.meta.dir, '../detachedToolCallNotify.ts'),
  'utf8',
)

describe('densable 2.1.289 vIt ws extras', () => {
  test('ws client uses proxy, tls, 1MiB maxPayload, cf-mitigated, handshake 30s', () => {
    expect(src).toContain('getWebSocketProxyAgent')
    expect(src).toContain('getWebSocketTLSOptions')
    expect(src).toContain('maxPayload: MAX_PAYLOAD')
    expect(src).toContain('1_048_576')
    expect(src).toContain("headers['cf-mitigated']")
    expect(src).not.toContain('createMonitorWsTunnel')
    expect(src).toContain('upgrade_rejected')
    expect(src).toContain('cf_mitigated')
    expect(src).toContain('HANDSHAKE_MS = 30_000')
    expect(src).toContain('if (input.ambient)')
    expect(src).toContain('resolveMonitorWsUrl')
    expect(src).toContain('isBlockedAddress')
    expect(src).toContain('stripHostHeaders')
    expect(src).toContain('input.transform')
    expect(src).toContain('input.onSender')
    expect(src).toContain('onSenderClosed')
    expect(src).toContain('reuseTaskId')
    expect(src).toContain('onLifecycle')
    expect(src).toContain('autoReactArmed')
    expect(src).toContain('input.bounded === true')
    const monitor = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/MonitorTool/MonitorTool.tsx',
      ),
      'utf8',
    )
    expect(monitor).toContain('isMonitorTimeoutBounded')
    expect(monitor).toContain('clampMonitorSpawn')
    expect(monitor).toContain('bounded,')
    expect(exec).toContain('function eyo')
    expect(exec).toContain('truncatedAtBytes === undefined')
    expect(exec).toContain('All of it')
    expect(exec).toContain('processPreMappedToolResultBlock')
    expect(exec).toContain('mapToolResultToToolResultBlockParam')
    expect(src).toContain('unexpected-response')
    expect(src).toContain(
      '[Dropped ${n}-byte frame (exceeds ${MAX_PAYLOAD}); closing]',
    )
    expect(src).toContain('[WebSocket upgrade rejected: HTTP ${g}]')
    expect(src).toContain('[WebSocket closed: ${code}')
    expect(src).toContain("turnAttribution: 'none'")
    expect(src).toContain('let live = true')
    expect(src).not.toContain(
      'const stillRunning = (): boolean => sock.readyState === WebSocket.OPEN',
    )
    expect(src).toContain('monitorSocketRegistry.set')
    expect(src).toContain('abortController')
    expect(src).toContain('oF(taskId')
    expect(src).toContain('connectionLost: true')
    expect(monitor).toContain('Monitor will open a WebSocket to')
    expect(monitor).toContain("behavior: 'ask'")
    expect(monitor).toContain(
      "leftoverPolicyLimitsDp('allow_web_fetch', 'Arbitrary-URL egress', 'is')",
    )
    expect(monitor).toContain(
      'organization policy disables model-chosen URL egress',
    )
    expect(monitor).toContain('SSRF-blocked address range')
    expect(monitor).not.toContain(
      "if (input.ws !== undefined) {\n      return { behavior: 'allow' }",
    )
  })
})

describe('densable 2.1.289 FPt still-running detach', () => {
  test('FPt placeholder text matches gold', () => {
    expect(notify).toContain(
      'Still running. The user sent a message while this call loads',
    )
    expect(notify).toContain('stillRunningDetachText')
  })

  test('StreamingToolExecutor races drain vs detach and yields FPt first', () => {
    expect(exec).toContain('stillRunningDetachText')
    expect(exec).toContain('Promise.race')
    expect(exec).toContain("race === 'settled'")
    expect(exec).toContain('detachedToolCall: true')
    expect(exec).toContain('DETACH_CEILING_MS')
    expect(exec).toContain('tengu_tool_call_detached')
    expect(exec).toContain('persistToolResult')
    expect(exec).toContain('DETACH_OVERSIZE_CHARS')
    expect(exec).toContain('All of it')
    expect(exec).toContain('Its first ${saved.truncatedAtBytes} bytes')
    expect(exec).toContain('was saved to')
  })
})

describe('densable 2.1.289 w2v Monitor ws checkPermissions', () => {
  afterEach(() => {
    leftoverPolicyLimitsHost().sessionCache = null
    leftoverPolicyLimitsHost().hintedDeniedKeys = []
    leftoverPolicyLimitsHost().hintedTaints = []
    leftoverPolicyLimitsHost().complianceTaints = []
  })

  test('ask public / loopback; deny literal metadata IP; protocols in message', async () => {
    leftoverPolicyLimitsHost().sessionCache = null
    leftoverPolicyLimitsHost().hintedDeniedKeys = []
    leftoverPolicyLimitsHost().hintedTaints = []
    leftoverPolicyLimitsHost().complianceTaints = []
    const ctx = {} as never
    const wsInput = (
      url: string,
      protocols?: string[],
    ): {
      description: string
      timeout_ms: number
      persistent: boolean
      ws: { url: string; protocols?: string[] }
    } => ({
      description: 'watch',
      timeout_ms: 300_000,
      persistent: false,
      ws: protocols ? { url, protocols } : { url },
    })
    const publicAsk = await MonitorTool.checkPermissions!(
      wsInput('wss://127.0.0.1'),
      ctx,
    )
    expect(publicAsk).toMatchObject({
      behavior: 'ask',
      message: 'Monitor will open a WebSocket to wss://127.0.0.1',
    })

    const loopback = await MonitorTool.checkPermissions!(
      wsInput('ws://127.0.0.1'),
      ctx,
    )
    expect(loopback.behavior).toBe('ask')

    const ssrf = await MonitorTool.checkPermissions!(
      wsInput('ws://169.254.169.254'),
      ctx,
    )
    expect(ssrf).toMatchObject({
      behavior: 'deny',
      message:
        'Monitor cannot open a WebSocket to 169.254.169.254: the address is in a private, link-local, or cloud-metadata range.',
    })

    const withProto = await MonitorTool.checkPermissions!(
      wsInput('wss://127.0.0.1', ['mcp', 'json']),
      ctx,
    )
    expect(withProto.behavior).toBe('ask')
    expect(withProto).toMatchObject({
      message:
        'Monitor will open a WebSocket to wss://127.0.0.1 (subprotocols: mcp, json)',
    })
  })
})

describe('verified WebSocket destination (densable ue @194294560)', () => {
  test('unproxied ws: pins DNS to resolved IP while retaining Host header', async () => {
    let lookups = 0
    const lookup = (async () => {
      lookups++
      return [
        {
          address: lookups === 1 ? '93.184.216.34' : '169.254.169.254',
          family: 4,
        },
      ]
    }) as unknown as Parameters<typeof resolveMonitorWsUrl>[2]
    const resolved = await resolveMonitorWsUrl(
      'ws://watch.example:8080/events',
      { tls: { ca: 'trusted-ca' } },
      lookup,
    )
    expect(lookups).toBe(1)
    expect(resolved.url).toBe('ws://93.184.216.34:8080/events')
    expect(resolved.headers).toEqual({ Host: 'watch.example:8080' })
    expect(resolved.tls).toEqual({ ca: 'trusted-ca' })
  })

  test('unproxied wss: runs DNS SSRF check and returns original URL without IP rewrite', async () => {
    let lookups = 0
    const lookup = (async () => {
      lookups++
      return [{ address: '93.184.216.34', family: 4 }]
    }) as unknown as Parameters<typeof resolveMonitorWsUrl>[2]
    const resolved = await resolveMonitorWsUrl(
      'wss://watch.example:8443/events',
      { tls: { ca: 'trusted-ca' } },
      lookup,
    )
    expect(lookups).toBe(1)
    expect(resolved.url).toBe('wss://watch.example:8443/events')
    expect(resolved.headers).toBeUndefined()
    expect(resolved.tls).toEqual({ ca: 'trusted-ca' })
  })

  test('configured proxy skips local DNS lookup and dials hostname directly via CONNECT', async () => {
    const failingLookup = (async () => {
      throw new Error('local DNS unavailable in proxy-only sandbox')
    }) as unknown as Parameters<typeof resolveMonitorWsUrl>[2]
    const resolved = await resolveMonitorWsUrl(
      'wss://watch.example:8443/events',
      { proxy: 'http://127.0.0.1:3128', tls: { ca: 'corp-ca' } },
      failingLookup,
    )
    expect(resolved.url).toBe('wss://watch.example:8443/events')
    expect(resolved.headers).toBeUndefined()
    expect(resolved.tls).toEqual({ ca: 'corp-ca' })

    // Verify end-to-end proxy CONNECT sends hostname:port (never raw IP)
    const connectAuthorities: string[] = []
    const proxy = createServer((_req, res) => {
      res.writeHead(502).end()
    })
    proxy.on('connect', (req, downstream) => {
      connectAuthorities.push(req.url ?? '')
      downstream.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      downstream.destroy()
    })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const proxyPort = (proxy.address() as { port: number }).port
    const client = new WebSocket(resolved.url, undefined, {
      proxy: `http://127.0.0.1:${proxyPort}`,
    } as WebSocket.ClientOptions)
    client.on('error', () => {})
    try {
      await new Promise<void>(resolve => {
        client.once('open', () => resolve())
        client.once('close', () => resolve())
      })
      expect(connectAuthorities).toEqual(['watch.example:8443'])
    } finally {
      client.terminate()
      proxy.close()
    }
  })

  test('cji openFrameLiveSocket dials BASE_API_URL / CLAUDE_AI_ORIGIN directly without public SSRF block', () => {
    const cji = readFileSync(
      join(import.meta.dir, '../../services/artifactAutoReact/cji.ts'),
      'utf8',
    )
    expect(cji).not.toContain('resolveMonitorWsUrl')
    expect(cji).not.toContain('createMonitorWsTunnel')
    expect(cji).toContain('getWebSocketProxyUrl')
    expect(cji).toContain('getWebSocketProxyAgent')
  })

  test('rejects any blocked DNS answer and bracketed metadata IPv6 with MonitorWsPreconditionError', async () => {
    const lookup = (async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]) as unknown as Parameters<typeof resolveMonitorWsUrl>[2]
    await expect(
      resolveMonitorWsUrl('wss://watch.example', undefined, lookup),
    ).rejects.toThrow(MonitorWsPreconditionError)
    await expect(
      resolveMonitorWsUrl('wss://watch.example', undefined, lookup),
    ).rejects.toThrow('resolves to 169.254.169.254')
    await expect(
      resolveMonitorWsUrl('wss://[::ffff:a9fe:a9fe]', {
        proxy: 'http://127.0.0.1:3128',
      }),
    ).rejects.toThrow('private, link-local')
  })

  test('permission check denies a malformed URL without DNS', async () => {
    await expect(
      MonitorTool.checkPermissions!(
        {
          description: 'watch',
          timeout_ms: 1000,
          persistent: false,
          ws: { url: 'invalid-url' },
        },
        {} as never,
      ),
    ).rejects.toThrow()
  })
})

describe('WebSocket monitor lifecycle', () => {
  test('rejects unsafe protocols before resolution or registration', async () => {
    for (const protocols of [['json\r\ninjected'], [''], ['json', 'json']]) {
      await expect(
        spawnMonitorWebSocket({
          url: 'ws://unresolved.invalid',
          protocols,
          description: 'invalid',
          persistent: true,
          timeoutMs: 1000,
          setAppState: () => {
            throw new Error('must not register')
          },
          taskRegistry: {} as never,
        }),
      ).rejects.toThrow('HTTP tokens')
    }
  })

  for (const failure of ['unauthorized', 'refused'] as const) {
    test(`${failure} handshake fails without a completed notification`, async () => {
      const server = createServer((_req, res) => res.writeHead(401).end())
      server.on('upgrade', (_req, socket) =>
        socket.end(
          'HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        ),
      )
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as { port: number }).port
      if (failure === 'refused')
        await new Promise<void>(resolve => server.close(() => resolve()))
      let app = { tasks: {} } as unknown as AppState
      const setAppState = (update: (state: AppState) => AppState): void => {
        app = update(app)
      }
      const registry = createTaskRegistry(() => app, setAppState)
      const previous = process.env.NO_PROXY
      process.env.NO_PROXY = '*'
      const description = `failed-handshake-${failure}`
      try {
        const { taskId } = await spawnMonitorWebSocket({
          url: `ws://127.0.0.1:${port}`,
          description,
          persistent: true,
          timeoutMs: 1000,
          setAppState,
          taskRegistry: registry,
        })
        for (
          let i = 0;
          i < 100 && registry.get(taskId)?.status === 'running';
          i++
        )
          await Bun.sleep(5)
        await new Promise(resolve => setImmediate(resolve))
        expect(registry.get(taskId)?.status).toBe('killed')
        const completion = getCommandQueue().filter(
          item =>
            item.taskId === taskId &&
            typeof item.value === 'string' &&
            item.value.includes('<status>completed</status>'),
        )
        expect(completion).toHaveLength(0)
      } finally {
        server.close()
        removeByFilter(
          item =>
            typeof item.value === 'string' && item.value.includes(description),
        )
        if (previous === undefined) delete process.env.NO_PROXY
        else process.env.NO_PROXY = previous
      }
    })
  }

  for (const stop of [
    'natural',
    'user',
    'parent',
    'cleanup',
    'not-running',
    'not-live',
  ] as const) {
    test(`${stop} close releases ownership without a false completion`, async () => {
      // Draining shutdown handlers must not close other tests' resources.
      if (
        stop === 'cleanup' &&
        process.env.CLAUDE_TEST_MONITOR_CLEANUP_CHILD !== '1'
      ) {
        const child = Bun.spawn({
          cmd: [
            process.execPath,
            'test',
            import.meta.path,
            '--test-name-pattern',
            'cleanup close releases ownership',
          ],
          cwd: join(import.meta.dir, '../../..'),
          env: { ...process.env, CLAUDE_TEST_MONITOR_CLEANUP_CHILD: '1' },
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(exit, `${stdout}\n${stderr}`).toBe(0)
        return
      }
      const oldNoProxy = process.env.NO_PROXY
      process.env.NO_PROXY = '*'
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
      await new Promise<void>(resolve => server.once('listening', resolve))
      const address = server.address() as { port: number }
      const owner = 'ws-owner' as AgentId
      let app = {
        tasks: {
          [owner]: {
            id: owner,
            type: 'local_agent',
            status: 'running',
            keepaliveReasons: new Set<string>(),
          },
        },
      } as unknown as AppState
      const setAppState = (update: (prev: AppState) => AppState): void => {
        app = update(app)
      }
      const registry = createTaskRegistry(() => app, setAppState)
      const connected = new Promise<import('ws').default>(resolve =>
        server.once('connection', resolve),
      )
      let closedLifecycle = 0
      let resolveClientOpen!: () => void
      const clientOpen = new Promise<void>(resolve => {
        resolveClientOpen = resolve
      })
      let resolveClientClosed!: () => void
      const clientClosed = new Promise<void>(resolve => {
        resolveClientClosed = resolve
      })
      const { taskId } = await spawnMonitorWebSocket({
        url: `ws://127.0.0.1:${address.port}`,
        description: `lifecycle-${stop}`,
        timeoutMs: 8000,
        persistent: true,
        agentId: owner,
        setAppState,
        taskRegistry: registry,
        onLifecycle: event => {
          if (event === 'close') closedLifecycle++
        },
        onSender: resolveClientOpen,
        onSenderClosed: resolveClientClosed,
      })
      const peer = await connected
      await clientOpen
      const peerClosed = new Promise<void>(resolve =>
        peer.once('close', () => resolve()),
      )
      try {
        expect(
          (
            registry.get(owner) as { keepaliveReasons: Set<string> }
          ).keepaliveReasons.has(`monitor:${taskId}`),
        ).toBe(true)
        if (stop === 'user') {
          peer.send('buffered-before-user-stop')
          await Bun.sleep(20)
          const originalClose = monitorSocketRegistry.get(taskId)!.close
          // Observe the terminal state at abort/close, before the row is removed.
          const task = registry.get(taskId)!
          if ('abortController' in task)
            task.abortController?.signal.addEventListener('abort', () => {
              expect(registry.get(taskId)).toMatchObject({
                status: 'killed',
                notified: true,
              })
            })
          expect(originalClose).toBeDefined()
          killMonitorWs(taskId, registry)
        } else if (stop === 'parent') {
          killMonitorWsTasksForAgent(owner, registry)
        } else if (stop === 'cleanup') {
          await runCleanupFunctions()
        } else {
          if (stop === 'not-running')
            registry.update(taskId, task => ({
              ...task,
              status: 'killed',
              notified: true,
            }))
          if (stop === 'not-live') monitorSocketRegistry.delete(taskId)
          peer.close()
        }
        await peerClosed
        await clientClosed
        await new Promise(resolve => setImmediate(resolve))
        expect(closedLifecycle).toBe(stop === 'natural' ? 1 : 0)
        const closedEvents = getCommandQueue().filter(
          item =>
            typeof item.value === 'string' &&
            item.value.includes('[WebSocket closed:'),
        )
        expect(closedEvents.length).toBe(stop === 'natural' ? 1 : 0)
        const stoppedEvents = getCommandQueue().filter(
          item =>
            typeof item.value === 'string' &&
            item.value.includes('[Monitor stopped]'),
        )
        expect(stoppedEvents.length).toBe(
          stop === 'user' || stop === 'parent' ? 1 : 0,
        )
        if (stop === 'user') {
          expect(
            getCommandQueue().some(
              item =>
                typeof item.value === 'string' &&
                item.value.includes('buffered-before-user-stop'),
            ),
          ).toBe(false)
        }
        if (stop === 'natural')
          expect(registry.get(taskId)?.status).toBe('killed')
        if (stop !== 'not-live')
          expect(
            (
              registry.get(owner) as { keepaliveReasons: Set<string> }
            ).keepaliveReasons.has(`monitor:${taskId}`),
          ).toBe(false)
        expect(monitorSocketRegistry.get(taskId)).toBeUndefined()
      } finally {
        removeByFilter(item => item.agentId === owner)
        peer.terminate()
        server.close()
        if (oldNoProxy === undefined) delete process.env.NO_PROXY
        else process.env.NO_PROXY = oldNoProxy
      }
    })
  }
})

describe('densable 2.1.289 Hnr monitor socket registry', () => {
  afterEach(() => {
    monitorSocketRegistry.clear()
  })

  for (const ambient of [false, true]) {
    test(`handshake deadline applies only to ambient=${ambient}`, async () => {
      const server = createServer()
      const pending = new Set<import('net').Socket>()
      server.on('connection', socket => {
        pending.add(socket)
        socket.on('error', () => {})
        socket.once('close', () => pending.delete(socket))
      })
      // Deliberately never answer the upgrade request.
      server.on('upgrade', () => {})
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address() as { port: number }
      let app = { tasks: {} } as unknown as AppState
      const setAppState = (update: (state: AppState) => AppState): void => {
        app = update(app)
      }
      const registry = createTaskRegistry(() => app, setAppState)
      let senderClosed = false
      let taskId: string | undefined
      const oldNoProxy = process.env.NO_PROXY
      process.env.NO_PROXY = '*'
      try {
        taskId = (
          await spawnMonitorWebSocket({
            url: `ws://127.0.0.1:${address.port}`,
            description: 'pending handshake',
            persistent: true,
            timeoutMs: 1000,
            ambient,
            handshakeDeadlineMs: 20,
            setAppState,
            taskRegistry: registry,
            onSenderClosed: () => {
              senderClosed = true
            },
          })
        ).taskId
        await Bun.sleep(80)
        if (!ambient) expect(senderClosed).toBe(false)
        expect(registry.get(taskId)?.status).toBe(
          ambient ? 'killed' : 'running',
        )
        expect(monitorSocketRegistry.get(taskId) !== undefined).toBe(!ambient)
      } finally {
        if (taskId) killMonitorWs(taskId, registry, 'system')
        removeByFilter(
          item =>
            typeof item.value === 'string' &&
            item.value.includes('pending handshake'),
        )
        for (const socket of pending) socket.destroy()
        server.close()
        if (oldNoProxy === undefined) delete process.env.NO_PROXY
        else process.env.NO_PROXY = oldNoProxy
      }
    })
  }

  test('non-persistent spawn stores timeoutId on task state and system kill emits [Monitor stopped]', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => wss.once('listening', resolve))
    const port = (wss.address() as { port: number }).port
    let app = { tasks: {} } as unknown as AppState
    const setAppState = (update: (state: AppState) => AppState): void => {
      app = update(app)
    }
    const registry = createTaskRegistry(() => app, setAppState)
    const oldNoProxy = process.env.NO_PROXY
    process.env.NO_PROXY = '*'
    try {
      const { taskId } = await spawnMonitorWebSocket({
        url: `ws://127.0.0.1:${port}`,
        description: 'system-kill-timeout-check',
        timeoutMs: 30_000,
        persistent: false,
        setAppState,
        taskRegistry: registry,
      })
      const running = registry.get(taskId) as
        | { timeoutId?: unknown }
        | undefined
      expect(running?.timeoutId).toBeDefined()
      killMonitorWs(taskId, registry, 'system')
      const stopped = registry.get(taskId) as
        | { status?: string; timeoutId?: unknown }
        | undefined
      expect(stopped?.status).toBe('killed')
      expect(stopped?.timeoutId).toBeUndefined()
      const stoppedEvents = getCommandQueue().filter(
        item =>
          typeof item.value === 'string' &&
          item.value.includes('system-kill-timeout-check') &&
          item.value.includes('[Monitor stopped]'),
      )
      expect(stoppedEvents).toHaveLength(1)
    } finally {
      removeByFilter(
        item =>
          typeof item.value === 'string' &&
          item.value.includes('system-kill-timeout-check'),
      )
      await new Promise<void>(resolve => wss.close(() => resolve()))
      if (oldNoProxy === undefined) delete process.env.NO_PROXY
      else process.env.NO_PROXY = oldNoProxy
    }
  })

  test('CONNECTING registers the monitor socket', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => wss.once('listening', resolve))
    const addr = wss.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    let app: { tasks: Record<string, { status?: string }> } = { tasks: {} }
    const setAppState = (updater: (prev: typeof app) => typeof app): void => {
      app = updater(app)
    }
    try {
      const { taskId } = await spawnMonitorWebSocket({
        url: `ws://127.0.0.1:${port}`,
        description: 'watch',
        timeoutMs: 8_000,
        persistent: true,
        setAppState: setAppState as never,
        taskRegistry: createTaskRegistry(
          () => app as unknown as AppState,
          setAppState as never,
        ),
      })
      expect(monitorSocketRegistry.get(taskId)).toBeDefined()
      expect(app.tasks[taskId]?.status).toBe('running')
      monitorSocketRegistry.get(taskId)?.close()
    } finally {
      monitorSocketRegistry.clear()
      await new Promise<void>((resolve, reject) => {
        wss.close(err => (err ? reject(err) : resolve()))
      })
    }
  })
})
