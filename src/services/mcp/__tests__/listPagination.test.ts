/**
 * Official 2.1.144: MCP list endpoints must follow nextCursor pages.
 */
import { describe, expect, test } from 'bun:test'
import { listAllWithCursorPagination } from '../listPagination.js'

describe('listAllWithCursorPagination', () => {
  test('single page without nextCursor', async () => {
    const items = await listAllWithCursorPagination(async cursor => {
      expect(cursor).toBeUndefined()
      return { items: [{ name: 'a' }, { name: 'b' }] }
    })
    expect(items.map(i => i.name)).toEqual(['a', 'b'])
  })

  test('follows nextCursor across pages', async () => {
    const calls: Array<string | undefined> = []
    const items = await listAllWithCursorPagination(async cursor => {
      calls.push(cursor)
      if (cursor === undefined) {
        return { items: [{ id: 1 }], nextCursor: 'p2' }
      }
      if (cursor === 'p2') {
        return { items: [{ id: 2 }], nextCursor: 'p3' }
      }
      return { items: [{ id: 3 }] }
    })
    expect(calls).toEqual([undefined, 'p2', 'p3'])
    expect(items.map(i => i.id)).toEqual([1, 2, 3])
  })

  test('stops on empty nextCursor string', async () => {
    const items = await listAllWithCursorPagination(async cursor => {
      if (cursor === undefined) {
        return { items: ['x'], nextCursor: '' }
      }
      return { items: ['should-not-run'] }
    })
    expect(items).toEqual(['x'])
  })

  test('stops when cursor repeats (server bug guard)', async () => {
    let n = 0
    const items = await listAllWithCursorPagination(async () => {
      n++
      return { items: [n], nextCursor: 'same' }
    })
    // first page + one retry with same cursor then stop
    expect(items).toEqual([1, 2])
    expect(n).toBe(2)
  })

  test('respects maxPages', async () => {
    let n = 0
    const items = await listAllWithCursorPagination(
      async () => {
        n++
        return { items: [n], nextCursor: `c${n}` }
      },
      { maxPages: 3 },
    )
    expect(items).toEqual([1, 2, 3])
    expect(n).toBe(3)
  })

  test('invokes onCapped when nextCursor remains after maxPages', async () => {
    let cappedAt: number | undefined
    let n = 0
    const items = await listAllWithCursorPagination(
      async () => {
        n++
        return { items: [n], nextCursor: `c${n}` }
      },
      {
        maxPages: 2,
        onCapped: pages => {
          cappedAt = pages
        },
      },
    )
    expect(items).toEqual([1, 2])
    expect(cappedAt).toBe(2)
  })
})
