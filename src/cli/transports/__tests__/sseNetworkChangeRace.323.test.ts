import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SSETransport } from '../SSETransport.js'

describe('#2111 SSETransport onNetworkChange stale controller race', () => {
  const originalFetch = globalThis.fetch
  const prevMacro = (globalThis as Record<string, unknown>).MACRO

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).MACRO ??= { VERSION: '0.0.0-test' }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (prevMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = prevMacro
    }
  })

  test('connected -> onNetworkChange: old stream ending with done:true does NOT abort new ac2 connection', async () => {
    let fetchCount = 0
    const signals: AbortSignal[] = []
    let closeFirstStream!: () => void
    let pushSecondEvent!: (chunk: string) => void

    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCount++
      const sig = init?.signal as AbortSignal
      signals.push(sig)
      if (fetchCount === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            closeFirstStream = () => {
              try {
                controller.close()
              } catch {
                // already closed
              }
            }
          },
        })
        return new Response(body, { status: 200 })
      }
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          pushSecondEvent = (chunk: string) => {
            controller.enqueue(encoder.encode(chunk))
          }
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch

    const received: string[] = []
    const transport = new SSETransport(
      new URL('https://example.com/v1/sessions/s1/events'),
      {},
      's1',
    )
    transport.setOnData(data => received.push(data))

    const p1 = transport.connect()
    // Wait for first fetch to resolve and enter connected state
    await new Promise(r => setTimeout(r, 20))
    expect(fetchCount).toBe(1)
    expect(transport.isConnectedStatus()).toBe(true)

    // Trigger network change while connected -> aborts ac1, starts ac2
    transport.onNetworkChange()
    // Wait for second fetch to establish ac2
    await new Promise(r => setTimeout(r, 20))
    expect(fetchCount).toBe(2)
    expect(signals[0]!.aborted).toBe(true)
    expect(signals[1]!.aborted).toBe(false)

    // Now simulate the old stream finishing cleanly with { done: true }
    closeFirstStream()
    await p1
    await new Promise(r => setTimeout(r, 20))

    // New ac2 connection MUST still be alive and NOT aborted by stale readStream
    expect(signals[1]!.aborted).toBe(false)
    expect(transport.isConnectedStatus()).toBe(true)
    expect(fetchCount).toBe(2)

    // And events arriving on ac2 still flow through
    pushSecondEvent(
      'id: 1\nevent: client_event\ndata: {"sequence_num":1,"event_id":"e1","event_type":"msg","payload":{"type":"ping"}}\n\n',
    )
    await new Promise(r => setTimeout(r, 20))
    expect(received).toHaveLength(1)
    expect(received[0]).toContain('"type":"ping"')

    transport.close()
  })

  test('connected -> onNetworkChange: old stream throwing error does NOT abort new ac2 connection', async () => {
    let fetchCount = 0
    const signals: AbortSignal[] = []
    let failFirstStream!: (err: Error) => void

    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCount++
      const sig = init?.signal as AbortSignal
      signals.push(sig)
      if (fetchCount === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            failFirstStream = (err: Error) => {
              controller.error(err)
            }
          },
        })
        return new Response(body, { status: 200 })
      }
      const body = new ReadableStream<Uint8Array>({
        start() {
          // stay open
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch

    const transport = new SSETransport(
      new URL('https://example.com/v1/sessions/s2/events'),
      {},
      's2',
    )

    const p1 = transport.connect()
    await new Promise(r => setTimeout(r, 20))
    expect(fetchCount).toBe(1)

    transport.onNetworkChange()
    await new Promise(r => setTimeout(r, 20))
    expect(fetchCount).toBe(2)
    expect(signals[1]!.aborted).toBe(false)

    // Old stream rejects after ac2 is already active
    failFirstStream(new Error('network reset'))
    await p1
    await new Promise(r => setTimeout(r, 20))

    expect(signals[1]!.aborted).toBe(false)
    expect(transport.isConnectedStatus()).toBe(true)
    expect(fetchCount).toBe(2)

    transport.close()
  })

  test('connecting -> onNetworkChange: stale fetch rejection does NOT abort new ac2 connection', async () => {
    let fetchCount = 0
    const signals: AbortSignal[] = []
    let rejectFirstFetch!: (err: Error) => void

    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCount++
      const sig = init?.signal as AbortSignal
      signals.push(sig)
      if (fetchCount === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          rejectFirstFetch = reject
        })
      }
      const body = new ReadableStream<Uint8Array>({
        start() {},
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch

    const transport = new SSETransport(
      new URL('https://example.com/v1/sessions/s3/events'),
      {},
      's3',
    )

    const p1 = transport.connect()
    await new Promise(r => setTimeout(r, 10))
    expect(fetchCount).toBe(1)

    transport.onNetworkChange()
    await new Promise(r => setTimeout(r, 20))
    expect(fetchCount).toBe(2)
    expect(signals[0]!.aborted).toBe(true)
    expect(signals[1]!.aborted).toBe(false)

    // Stale fetch #1 rejects after fetch #2 connected
    rejectFirstFetch(new Error('socket hang up'))
    await p1
    await new Promise(r => setTimeout(r, 20))

    expect(signals[1]!.aborted).toBe(false)
    expect(transport.isConnectedStatus()).toBe(true)
    expect(fetchCount).toBe(2)

    transport.close()
  })
})
