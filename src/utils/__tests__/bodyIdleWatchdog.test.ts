import { afterEach, describe, expect, test } from 'bun:test'
import {
  BodyIdleTimeoutError,
  type BodyIdleFetch,
  createBodyChunkTimes,
  getResponseChunkTimes,
  rewrapResponseWithBody,
  shouldWrapResponseBodyWithIdleWatchdog,
  wrapFetchWithBodyIdleWatchdog,
  wrapReadableStreamWithBodyIdleTimeout,
} from '../bodyIdleWatchdog.js'

afterEach(() => {
  // nothing process-global
})

describe('wrapReadableStreamWithBodyIdleTimeout', () => {
  test('passes through chunks and closes normally', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'))
        controller.enqueue(new TextEncoder().encode(' world'))
        controller.close()
      },
    })
    const wrapped = wrapReadableStreamWithBodyIdleTimeout(source, 5_000)
    const reader = wrapped.getReader()
    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(new TextDecoder().decode(value))
    }
    expect(chunks.join('')).toBe('hello world')
  })

  test('errors when no bytes arrive within idleTimeoutMs', async () => {
    const source = new ReadableStream<Uint8Array>({
      start() {
        // never enqueue / close — hang
      },
      cancel() {},
    })
    const wrapped = wrapReadableStreamWithBodyIdleTimeout(source, 40)
    const reader = wrapped.getReader()
    let err: unknown
    try {
      await reader.read()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(BodyIdleTimeoutError)
    expect((err as BodyIdleTimeoutError).idleTimeoutMs).toBe(40)
  })

  test('idleTimeoutMs <= 0 returns source unchanged', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      },
    })
    expect(wrapReadableStreamWithBodyIdleTimeout(source, 0)).toBe(source)
  })

  test('pull-driven: consumer reads advance stream one chunk at a time', async () => {
    // Backpressure: wrap uses pull() not an eager start()+async drain loop.
    // Bun may prefill highWaterMark (often 1), so we assert consumer-driven
    // progress rather than zero upstream activity before the first read.
    let upstreamEnqueues = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (upstreamEnqueues >= 5) {
          controller.close()
          return
        }
        upstreamEnqueues++
        controller.enqueue(new TextEncoder().encode(`c${upstreamEnqueues}`))
      },
    })
    const wrapped = wrapReadableStreamWithBodyIdleTimeout(source, 5_000)
    const reader = wrapped.getReader()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toMatch(/^c\d+$/)
    const afterFirst = upstreamEnqueues
    // Must not have drained the whole source after a single consumer read.
    expect(afterFirst).toBeLessThan(5)

    const second = await reader.read()
    expect(second.done).toBe(false)
    expect(upstreamEnqueues).toBeGreaterThanOrEqual(afterFirst)
    // Still not fully drained after two reads (source has 5 chunks).
    expect(upstreamEnqueues).toBeLessThan(5)

    // Drain rest
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(upstreamEnqueues).toBe(5)
  })
})

describe('rewrapResponseWithBody', () => {
  test('preserves url redirected type for SDK logging', () => {
    const sourceBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.close()
      },
    })
    const source = new Response(sourceBody, {
      status: 201,
      statusText: 'Created',
      headers: { 'x-test': '1' },
    })
    // Platform-constructed Response has empty url; mimic a real fetch Response.
    Object.defineProperty(source, 'url', {
      value: 'https://api.example/v1/messages',
      configurable: true,
    })
    Object.defineProperty(source, 'redirected', {
      value: true,
      configurable: true,
    })
    Object.defineProperty(source, 'type', {
      value: 'basic',
      configurable: true,
    })

    const nextBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('ok'))
        c.close()
      },
    })
    const rewrapped = rewrapResponseWithBody(source, nextBody)
    expect(rewrapped.status).toBe(201)
    expect(rewrapped.statusText).toBe('Created')
    expect(rewrapped.headers.get('x-test')).toBe('1')
    expect(rewrapped.url).toBe('https://api.example/v1/messages')
    expect(rewrapped.redirected).toBe(true)
    expect(rewrapped.type).toBe('basic')
    // Bare new Response would leave url empty — guard the regression.
    expect(new Response(nextBody).url).toBe('')
  })
})

describe('shouldWrapResponseBodyWithIdleWatchdog (densable FMh)', () => {
  test('text/event-stream always', () => {
    expect(
      shouldWrapResponseBodyWithIdleWatchdog({
        contentType: 'text/event-stream; charset=utf-8',
      }),
    ).toBe(true)
  })

  test('bedrock eventstream only for bedrock provider', () => {
    expect(
      shouldWrapResponseBodyWithIdleWatchdog({
        contentType: 'application/vnd.amazon.eventstream',
        provider: 'bedrock',
      }),
    ).toBe(true)
    expect(
      shouldWrapResponseBodyWithIdleWatchdog({
        contentType: 'application/vnd.amazon.eventstream',
        provider: 'firstParty',
      }),
    ).toBe(false)
  })

  test('json / empty content-type not wrapped', () => {
    expect(
      shouldWrapResponseBodyWithIdleWatchdog({
        contentType: 'application/json',
        provider: 'firstParty',
      }),
    ).toBe(false)
    expect(shouldWrapResponseBodyWithIdleWatchdog({ contentType: null })).toBe(
      false,
    )
  })
})

describe('wrapFetchWithBodyIdleWatchdog', () => {
  test('wraps SSE body when enabled', async () => {
    const base = (async () =>
      new Response(new ReadableStream(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as BodyIdleFetch
    const wrapped = wrapFetchWithBodyIdleWatchdog(base, () => ({
      enabled: true,
      idleTimeoutMs: 30,
      provider: 'firstParty',
    }))
    const res = await wrapped('https://example.com')
    expect(res.body).toBeTruthy()
    const reader = res.body!.getReader()
    await expect(reader.read()).rejects.toBeInstanceOf(BodyIdleTimeoutError)
  })

  test('passes through non-SSE body even when enabled', async () => {
    const hang = new ReadableStream<Uint8Array>({ start() {} })
    const base = (async () =>
      new Response(hang, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as BodyIdleFetch
    const wrapped = wrapFetchWithBodyIdleWatchdog(base, () => ({
      enabled: true,
      idleTimeoutMs: 20,
      provider: 'firstParty',
    }))
    const res = await wrapped('https://example.com')
    // Must not install idle watchdog — hang body would otherwise time out.
    expect(res.headers.get('content-type')).toBe('application/json')
    // Same body instance path: cancel without BodyIdleTimeoutError
    await res.body?.cancel()
  })

  test('preserves upstream response.url after wrap', async () => {
    const base = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('chunk'))
          c.close()
        },
      })
      const response = new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
      Object.defineProperty(response, 'url', {
        value: 'https://api.example/v1/messages',
        configurable: true,
      })
      return response
    }) as BodyIdleFetch
    const wrapped = wrapFetchWithBodyIdleWatchdog(base, () => ({
      enabled: true,
      idleTimeoutMs: 5_000,
      provider: 'firstParty',
    }))
    const res = await wrapped('https://api.example/v1/messages')
    expect(res.url).toBe('https://api.example/v1/messages')
    const reader = res.body!.getReader()
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toBe('chunk')
  })

  test('passes through when disabled', async () => {
    let body: ReadableStream<Uint8Array> | null = null
    const base = (async () => {
      body = new ReadableStream({
        start(c) {
          c.close()
        },
      })
      return new Response(body, { status: 200 })
    }) as BodyIdleFetch
    const wrapped = wrapFetchWithBodyIdleWatchdog(base, () => ({
      enabled: false,
      idleTimeoutMs: 30,
    }))
    const res = await wrapped('https://example.com')
    expect(res.body).toBe(body)
  })

  test('densable #39: stamps _chunkTimes.lastAt on each body pull', async () => {
    const times = createBodyChunkTimes()
    expect(times.lastAt).toBe(0)
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('a'))
        c.enqueue(new TextEncoder().encode('b'))
        c.close()
      },
    })
    const wrapped = wrapReadableStreamWithBodyIdleTimeout(
      source,
      5_000,
      undefined,
      times,
    )
    const reader = wrapped.getReader()
    await reader.read()
    const afterFirst = times.lastAt
    expect(afterFirst).toBeGreaterThan(0)
    await reader.read()
    expect(times.lastAt).toBeGreaterThanOrEqual(afterFirst)
    await reader.read() // done
  })

  test('densable #39: rewrap attaches _chunkTimes on Response', async () => {
    const times = createBodyChunkTimes()
    times.lastAt = 42
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.close()
      },
    })
    const source = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const rewrapped = rewrapResponseWithBody(source, body, times)
    expect(getResponseChunkTimes(rewrapped)).toBe(times)
    expect(getResponseChunkTimes(rewrapped)?.lastAt).toBe(42)
  })

  test('wrapFetch attaches _chunkTimes for SSE', async () => {
    const base = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: hi\n\n'))
            c.close()
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      )) as BodyIdleFetch
    const wrapped = wrapFetchWithBodyIdleWatchdog(base, () => ({
      enabled: true,
      idleTimeoutMs: 5_000,
      provider: 'firstParty',
    }))
    const res = await wrapped('https://example.com')
    const times = getResponseChunkTimes(res)
    expect(times).toBeTruthy()
    expect(times!.lastAt).toBe(0)
    const reader = res.body!.getReader()
    await reader.read()
    expect(times!.lastAt).toBeGreaterThan(0)
  })
})
