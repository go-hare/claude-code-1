import { describe, expect, test } from 'bun:test'
import { withStoredImagePath } from '../imageStore.js'

describe('withStoredImagePath (densable V9d)', () => {
  test('returns same Map when path already set', () => {
    const m = new Map([[1, '/tmp/a.png']])
    expect(withStoredImagePath(m, 1, '/tmp/a.png')).toBe(m)
  })

  test('returns new Map when path changes', () => {
    const m = new Map([[1, '/tmp/a.png']])
    const next = withStoredImagePath(m, 1, '/tmp/b.png')
    expect(next).not.toBe(m)
    expect(next.get(1)).toBe('/tmp/b.png')
    expect(m.get(1)).toBe('/tmp/a.png')
  })

  test('adds new id and preserves existing', () => {
    const m = new Map([[1, '/tmp/a.png']])
    const next = withStoredImagePath(m, 2, '/tmp/b.png')
    expect(next.get(1)).toBe('/tmp/a.png')
    expect(next.get(2)).toBe('/tmp/b.png')
  })

  test('evicts oldest when at cap of 200', () => {
    const m = new Map<number, string>()
    for (let i = 0; i < 200; i++) m.set(i, `/tmp/${i}.png`)
    const next = withStoredImagePath(m, 999, '/tmp/new.png')
    expect(next.has(0)).toBe(false)
    expect(next.get(999)).toBe('/tmp/new.png')
    expect(next.size).toBe(200)
  })
})
