import { afterEach, describe, expect, test } from 'bun:test'
import {
  BodyIdleTimeoutError,
  type BodyIdleFetch,
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
})

describe('wrapFetchWithBodyIdleWatchdog', () => {
  test('wraps body when enabled', async () => {
    const base = (async () =>
      new Response(new ReadableStream(), { status: 200 })) as BodyIdleFetch
    const wrapped = wrapFetchWithBodyIdleWatchdog(base, () => ({
      enabled: true,
      idleTimeoutMs: 30,
    }))
    const res = await wrapped('https://example.com')
    expect(res.body).toBeTruthy()
    const reader = res.body!.getReader()
    await expect(reader.read()).rejects.toBeInstanceOf(BodyIdleTimeoutError)
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
})
