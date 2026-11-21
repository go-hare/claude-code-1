import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  SSE_SLEEP_FRAME_WAIT_MS,
  SSE_SLEEP_LATE_THRESHOLD_MS,
  SSETransport,
} from '../SSETransport.js'

describe('Wave 2D SSETransport #1666 reopenAfterSleep', () => {
  const origFetch = globalThis.fetch
  let hadMacro = false

  beforeAll(() => {
    const g = globalThis as Record<string, unknown>
    hadMacro = 'MACRO' in g
    if (!hadMacro) {
      g.MACRO = { VERSION: '2.1.328' }
    }
  })

  afterAll(() => {
    if (!hadMacro) {
      delete (globalThis as Record<string, unknown>).MACRO
    }
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  test('#1666: reopenAfterSleep aborts stream, dials with keepalive:false on zero backoff, and emits diagnostic', async () => {
    const fetchCalls: Array<{
      url: string
      keepalive?: boolean
      signal?: AbortSignal
    }> = []
    const controllers: Array<ReadableStreamDefaultController<Uint8Array>> = []

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      fetchCalls.push({
        url: String(input),
        keepalive: init?.keepalive,
        signal: init?.signal ?? undefined,
      })
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          controllers.push(ctrl)
          init?.signal?.addEventListener('abort', () => {
            try {
              ctrl.close()
            } catch {
              // ignore
            }
          })
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    const diagnostics: Array<{ msg: string; level: string; kind?: string }> = []
    let sleepListener: ((stalledMs: number) => void) | undefined

    const transport = new SSETransport(
      new URL('https://example.com/v2/session/s1/events/stream'),
      {},
      's1',
      undefined,
      0,
      () => ({ Authorization: 'Bearer tok' }),
      {
        onProcessSlept: cb => {
          sleepListener = cb
          return () => {
            sleepListener = undefined
          }
        },
        onDiagnostic: (msg, level, kind) =>
          diagnostics.push({ msg, level, kind }),
      },
    )

    try {
      const firstConnect = transport.connect()
      await new Promise(r => setTimeout(r, 20))
      expect(transport.isConnectedStatus()).toBe(true)
      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0]?.keepalive).toBeUndefined()

      // Simulate host sleep detected by stall detector
      expect(transport.reopenAfterSleep(15_000, 'stall_detector')).toBe(true)
      expect(fetchCalls[0]?.signal?.aborted).toBe(true)
      expect(diagnostics.some(d => d.kind === 'sse_reopened_after_sleep')).toBe(
        true,
      )

      await new Promise(r => setTimeout(r, 30))
      expect(fetchCalls.length).toBe(2)
      // Sleep redial must force a fresh socket (keepalive: false)
      expect(fetchCalls[1]?.keepalive).toBe(false)
      expect(transport.isConnectedStatus()).toBe(true)

      // Subsequent renewal does NOT carry stale redialsOnNewSocket
      transport.reopenAtOnce('renewal')
      await new Promise(r => setTimeout(r, 30))
      expect(fetchCalls.length).toBe(3)
      expect(fetchCalls[2]?.keepalive).toBeUndefined()

      // Verify onSleepNotice keeps stream when silentForMs < stalledMs
      expect(sleepListener).toBeDefined()
      sleepListener?.(60_000)
      await new Promise(r => setTimeout(r, SSE_SLEEP_FRAME_WAIT_MS + 20))
      expect(fetchCalls.length).toBe(3)

      expect(SSE_SLEEP_LATE_THRESHOLD_MS).toBe(10_000)
      expect(SSE_SLEEP_FRAME_WAIT_MS).toBe(20)
      await firstConnect.catch(() => {})
    } finally {
      transport.close()
    }
  })

  test('#1666: late liveness timeout triggers reopenAfterSleep instead of exponential backoff', async () => {
    const fetchCalls: Array<{ keepalive?: boolean }> = []
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      fetchCalls.push({ keepalive: init?.keepalive })
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          init?.signal?.addEventListener('abort', () => {
            try {
              ctrl.close()
            } catch {
              // ignore
            }
          })
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    const diagnostics: string[] = []
    const transport = new SSETransport(
      new URL('https://example.com/v2/session/s2/events/stream'),
      {},
      's2',
      undefined,
      0,
      () => ({ Authorization: 'Bearer tok' }),
      {
        onDiagnostic: (_m, _l, kind) => {
          if (kind) diagnostics.push(kind)
        },
      },
    )

    try {
      const p = transport.connect()
      await new Promise(r => setTimeout(r, 20))
      expect(transport.isConnectedStatus()).toBe(true)

      // Backdate liveness evidence by 70s (> 45s timeout + 10s sleep threshold)
      const internal = transport as unknown as {
        lastLivenessEvidenceAtMs: number
        onLivenessTimeout: () => void
      }
      internal.lastLivenessEvidenceAtMs = Date.now() - 70_000
      internal.onLivenessTimeout()

      await new Promise(r => setTimeout(r, 30))
      expect(diagnostics).toContain('sse_reopened_after_sleep')
      expect(fetchCalls.length).toBe(2)
      expect(fetchCalls[1]?.keepalive).toBe(false)
      await p.catch(() => {})
    } finally {
      transport.close()
    }
  })
})
