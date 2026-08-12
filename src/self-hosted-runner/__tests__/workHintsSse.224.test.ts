/**
 * densable 2.1.224 #1 — work-hints SSE (uBh/Yjv) + PollWakeQueue (ZJl).
 */
import { describe, expect, test } from 'bun:test'
import {
  PollWakeQueue,
  SSE_BASE_BACKOFF_MS,
  SSE_IDLE_ABORT_MS,
  SSE_MAX_BACKOFF_MS,
  SSE_WAKE_JITTER_MS,
  isSseHintsEnabled,
  parseWorkHintsSse,
  sleepAbortable,
} from '../workHintsSse.js'

describe('densable 2.1.224 #1 SSE constants', () => {
  test('Wjv/Gjv/Vjv/cBh', () => {
    expect(SSE_BASE_BACKOFF_MS).toBe(1000)
    expect(SSE_MAX_BACKOFF_MS).toBe(30_000)
    expect(SSE_IDLE_ABORT_MS).toBe(45_000)
    expect(SSE_WAKE_JITTER_MS).toBe(200)
  })

  test('isSseHintsEnabled (CCR_SHR_SSE_HINTS / hr)', () => {
    expect(isSseHintsEnabled({})).toBe(false)
    expect(isSseHintsEnabled({ CCR_SHR_SSE_HINTS: '1' })).toBe(true)
    expect(isSseHintsEnabled({ CCR_SHR_SSE_HINTS: 'true' })).toBe(true)
    expect(isSseHintsEnabled({ CCR_SHR_SSE_HINTS: '0' })).toBe(false)
  })
})

describe('densable 2.1.224 #1 PollWakeQueue (ZJl)', () => {
  test('consume defaults to POLL', () => {
    const q = new PollWakeQueue()
    expect(q.consume()).toBe('POLL')
  })

  test('SSE wake ignored at capacity', async () => {
    const q = new PollWakeQueue()
    q.atCapacity = true
    q.wake('SSE')
    expect(q.consume()).toBe('POLL')
    q.atCapacity = false
    q.wake('SSE')
    expect(q.consume()).toBe('SSE')
  })

  test('SSE preferred over LOCAL pending', () => {
    const q = new PollWakeQueue()
    q.wake('LOCAL')
    q.wake('SSE')
    expect(q.consume()).toBe('SSE')
  })

  test('wait resolves on wake before timeout', async () => {
    const q = new PollWakeQueue()
    const ac = new AbortController()
    const started = Date.now()
    const waiter = q.wait(5_000, ac.signal)
    setTimeout(() => q.wake('LOCAL'), 20)
    await waiter
    expect(Date.now() - started).toBeLessThan(1000)
    expect(q.consume()).toBe('LOCAL')
  })
})

describe('densable 2.1.224 #1 parseWorkHintsSse (Yjv)', () => {
  test('fires onWake for work_available event', async () => {
    let wakes = 0
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode('event: work_available\ndata: {}\n\n'))
        controller.close()
      },
    })
    const ctrl = new AbortController()
    const ok = await parseWorkHintsSse(
      stream,
      () => {
        wakes++
      },
      ctrl,
    )
    expect(ok).toBe(true)
    expect(wakes).toBe(1)
  })

  test('sleepAbortable resolves on abort', async () => {
    const ac = new AbortController()
    const p = sleepAbortable(10_000, ac.signal)
    ac.abort()
    await p
  })
})
