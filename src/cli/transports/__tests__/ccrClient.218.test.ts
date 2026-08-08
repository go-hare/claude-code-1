/**
 * densable 2.1.218 #36 — stop heartbeat after worker replace (closed-gate).
 *
 * Official: Fixed remote sessions continuing to send heartbeats after their
 * worker was replaced (desktop/IDE retrying 409 forever).
 *
 * densable: if (this.closed) return before 409 / handleEpochMismatch;
 * startHeartbeat no-op when closed; sendHeartbeat stops when closed;
 * handleEpochMismatch sets closed + stopHeartbeat first.
 *
 * request() → getClaudeCodeUserAgent() reads MACRO.VERSION (build define).
 * Prefer globalThis.MACRO over mock.module(userAgent) to avoid process-global
 * mock pollution of other test files.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { SSETransport } from '../SSETransport.js'
import { CCRClient } from '../ccrClient.js'

beforeAll(() => {
  const g = globalThis as unknown as {
    MACRO?: { VERSION: string; [k: string]: unknown }
  }
  g.MACRO = { ...(g.MACRO ?? {}), VERSION: '2.1.218-test' }
})

type HttpResponse = {
  status: number
  data?: unknown
  headers?: Record<string, string>
}

type ClientHttp = {
  get: (url: string, config?: unknown) => Promise<HttpResponse>
  post: (url: string, body?: unknown, config?: unknown) => Promise<HttpResponse>
  put: (url: string, body?: unknown, config?: unknown) => Promise<HttpResponse>
}

type ClientPrivate = {
  http: ClientHttp
  closed: boolean
  heartbeatTimer: unknown
  request: (
    method: 'post' | 'put' | 'get',
    path: string,
    body: unknown,
    label: string,
    opts?: { softFailOn409?: boolean },
  ) => Promise<{ ok: boolean; status?: number }>
  startHeartbeat: () => void
  sendHeartbeat: () => Promise<void>
}

function makeTransport(): SSETransport {
  return {
    setOnEvent: () => {},
  } as unknown as SSETransport
}

function makeClient(opts?: {
  onEpochMismatch?: () => never
  heartbeatIntervalMs?: number
}): InstanceType<typeof CCRClient> {
  return new CCRClient(
    makeTransport(),
    new URL('https://example.test/v1/code/sessions/sess-218'),
    {
      getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      heartbeatIntervalMs: opts?.heartbeatIntervalMs ?? 60_000,
      heartbeatJitterFraction: 0,
      onEpochMismatch:
        opts?.onEpochMismatch ??
        (() => {
          throw new Error('epoch-mismatch-exit')
        }),
    },
  )
}

function priv(client: InstanceType<typeof CCRClient>): ClientPrivate {
  return client as unknown as ClientPrivate
}

function stubHttp(
  client: InstanceType<typeof CCRClient>,
  handlers: Partial<ClientHttp> & { post: ClientHttp['post'] },
): { posts: number } {
  const counter = { posts: 0 }
  const base: ClientHttp = {
    get: async () => ({ status: 200, data: {}, headers: {} }),
    put: async () => ({ status: 200, data: {}, headers: {} }),
    post: async (url, body, config) => {
      counter.posts++
      return handlers.post(url, body, config)
    },
  }
  if (handlers.get) base.get = handlers.get
  if (handlers.put) base.put = handlers.put
  priv(client).http = base
  return counter
}

describe('densable 2.1.218 #36 CCRClient closed-gate', () => {
  test('request: after close, 409 does not call handleEpochMismatch/onEpochMismatch', async () => {
    let mismatchCalls = 0
    const client = makeClient({
      onEpochMismatch: (() => {
        mismatchCalls++
        throw new Error('should-not-exit')
      }) as () => never,
    })
    client.close()
    stubHttp(client, {
      post: async () => ({
        status: 409,
        data: { error: 'epoch' },
        headers: {},
      }),
    })

    const result = await priv(client).request(
      'post',
      '/worker/heartbeat',
      { session_id: 'sess-218' },
      'Heartbeat',
    )

    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(mismatchCalls).toBe(0)
  })

  test('request: open client on 409 calls onEpochMismatch after closed+stopHeartbeat', async () => {
    let mismatchCalls = 0
    const client = makeClient({
      onEpochMismatch: (() => {
        mismatchCalls++
        throw new Error('epoch-exit')
      }) as () => never,
    })
    stubHttp(client, {
      post: async () => ({ status: 409, data: {}, headers: {} }),
    })

    const result = await priv(client).request(
      'post',
      '/worker/heartbeat',
      {},
      'Heartbeat',
    )

    // handleEpochMismatch throws via onEpochMismatch; request() catches → ok:false
    expect(result.ok).toBe(false)
    expect(mismatchCalls).toBe(1)
    expect(priv(client).closed).toBe(true)
  })

  test('startHeartbeat is no-op when already closed', () => {
    const client = makeClient({ heartbeatIntervalMs: 5_000 })
    client.close()
    priv(client).startHeartbeat()
    expect(priv(client).heartbeatTimer).toBeNull()
  })

  test('sendHeartbeat after close stops timer and does not HTTP', async () => {
    const client = makeClient({ heartbeatIntervalMs: 5_000 })
    const counter = stubHttp(client, {
      post: async () => ({ status: 200, data: {}, headers: {} }),
    })
    client.close()
    await priv(client).sendHeartbeat()
    expect(counter.posts).toBe(0)
    expect(priv(client).heartbeatTimer).toBeNull()
  })
})
