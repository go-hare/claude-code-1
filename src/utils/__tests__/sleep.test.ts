import { describe, expect, test } from 'bun:test'
import { sleep, withDeadline, withTimeout } from '../sleep'
import { sequential } from '../sequential'

// ─── sleep ─────────────────────────────────────────────────────────────

describe('sleep', () => {
  test('resolves after timeout', async () => {
    const start = Date.now()
    await sleep(50)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  test('resolves immediately when signal already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const start = Date.now()
    await sleep(10_000, ac.signal)
    expect(Date.now() - start).toBeLessThan(50)
  })

  test('resolves early on abort (default: no throw)', async () => {
    const ac = new AbortController()
    const start = Date.now()
    const p = sleep(10_000, ac.signal)
    setTimeout(() => ac.abort(), 30)
    await p
    expect(Date.now() - start).toBeLessThan(200)
  })

  test('rejects on abort with throwOnAbort', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      sleep(10_000, ac.signal, { throwOnAbort: true }),
    ).rejects.toThrow('aborted')
  })

  test('rejects with custom abortError', async () => {
    const ac = new AbortController()
    ac.abort()
    const customErr = () => new Error('custom abort')
    await expect(
      sleep(10_000, ac.signal, { abortError: customErr }),
    ).rejects.toThrow('custom abort')
  })

  test('throwOnAbort rejects on mid-sleep abort', async () => {
    const ac = new AbortController()
    const p = sleep(10_000, ac.signal, { throwOnAbort: true })
    setTimeout(() => ac.abort(), 20)
    await expect(p).rejects.toThrow('aborted')
  })

  test('works without signal', async () => {
    await sleep(10)
    // just verify it resolves
  })
})

// ─── withTimeout ───────────────────────────────────────────────────────

describe('withTimeout', () => {
  test('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'timed out')
    expect(result).toBe(42)
  })

  test('rejects when promise takes too long', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 5000))
    await expect(withTimeout(slow, 50, 'operation timed out')).rejects.toThrow(
      'operation timed out',
    )
  })

  test('rejects propagate through', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('inner')), 1000, 'timeout'),
    ).rejects.toThrow('inner')
  })
})

// ─── withDeadline (densable jg) ──────────────────────────────────────────

describe('withDeadline', () => {
  test('resolves the promise value when it settles first', async () => {
    const result = await withDeadline(Promise.resolve(42), 1000)
    expect(result).toBe(42)
  })

  test('resolves undefined when the deadline fires first', async () => {
    const slow = new Promise<number>(resolve =>
      setTimeout(() => resolve(1), 5000),
    )
    const result = await withDeadline(slow, 30)
    expect(result).toBeUndefined()
  })

  test('does not reject the inner promise on deadline', async () => {
    let settled = false
    const inner = new Promise<string>(resolve => {
      setTimeout(() => {
        settled = true
        resolve('late')
      }, 40)
    })
    const raced = await withDeadline(inner, 10)
    expect(raced).toBeUndefined()
    await inner
    expect(settled).toBe(true)
  })

  test('createTimer cancel runs in finally', async () => {
    let cancelled = false
    const createTimer = (cb: () => void, ms: number) => {
      const t = setTimeout(cb, ms)
      return () => {
        cancelled = true
        clearTimeout(t)
      }
    }
    await withDeadline(Promise.resolve('ok'), 1000, createTimer)
    expect(cancelled).toBe(true)
  })
})

// ─── sequential ────────────────────────────────────────────────────────

describe('sequential', () => {
  test('executes calls in order', async () => {
    const order: number[] = []
    const fn = sequential(async (n: number) => {
      await sleep(10)
      order.push(n)
      return n
    })

    const results = await Promise.all([fn(1), fn(2), fn(3)])
    expect(order).toEqual([1, 2, 3])
    expect(results).toEqual([1, 2, 3])
  })

  test('returns correct result for each call', async () => {
    const fn = sequential(async (x: number) => x * 2)
    const r1 = await fn(5)
    const r2 = await fn(10)
    expect(r1).toBe(10)
    expect(r2).toBe(20)
  })

  test('propagates errors without blocking queue', async () => {
    const fn = sequential(async (x: number) => {
      if (x === 2) throw new Error('fail')
      return x
    })

    const p1 = fn(1)
    const p2 = fn(2)
    const p3 = fn(3)

    expect(await p1).toBe(1)
    await expect(p2).rejects.toThrow('fail')
    expect(await p3).toBe(3)
  })

  test('handles single call', async () => {
    const fn = sequential(async (s: string) => s.toUpperCase())
    expect(await fn('hello')).toBe('HELLO')
  })
})
