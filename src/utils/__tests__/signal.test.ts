import { describe, expect, test } from 'bun:test'
import { createSignal } from '../signal.js'

describe('createSignal', () => {
  test('notifies all listeners', () => {
    const sig = createSignal<[string]>()
    const seen: string[] = []
    sig.subscribe(v => {
      seen.push(`a:${v}`)
    })
    sig.subscribe(v => {
      seen.push(`b:${v}`)
    })
    sig.emit('x')
    expect(seen).toEqual(['a:x', 'b:x'])
  })

  test('unsubscribe stops further notifications', () => {
    const sig = createSignal()
    let n = 0
    const unsub = sig.subscribe(() => {
      n++
    })
    sig.emit()
    unsub()
    sig.emit()
    expect(n).toBe(1)
  })

  test('single listener throw rethrows that error (densable qvt try/catch)', () => {
    const sig = createSignal()
    sig.subscribe(() => {
      throw new Error('boom')
    })
    expect(() => sig.emit()).toThrow('boom')
  })

  test('multi-listener: first throw does not skip later listeners (densable xs)', () => {
    const sig = createSignal()
    const seen: string[] = []
    sig.subscribe(() => {
      seen.push('a')
      throw new Error('a-fail')
    })
    sig.subscribe(() => {
      seen.push('b')
    })
    sig.subscribe(() => {
      seen.push('c')
      throw new Error('c-fail')
    })
    try {
      sig.emit()
      expect.unreachable('expected AggregateError')
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError)
      const agg = e as AggregateError
      expect(agg.errors.map(err => (err as Error).message)).toEqual([
        'a-fail',
        'c-fail',
      ])
    }
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  test('clear removes all listeners', () => {
    const sig = createSignal()
    let n = 0
    sig.subscribe(() => {
      n++
    })
    sig.clear()
    sig.emit()
    expect(n).toBe(0)
  })
})
