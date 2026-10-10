/**
 * Official 2.1.144 / 2.1.289 `$n`/`ai`: MCP list endpoints must follow nextCursor
 * and clamp at 20 pages. Gold `fo`/`On` emit `tengu_mcp_list_paginated` (KEEP 遥测).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  IssuerMismatchError,
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
} from '@modelcontextprotocol/client'
import {
  isMcpListRetryable,
  listAllWithCursorPagination,
  listMcpCursorPages,
  listMcpToolsAggregated,
  MCP_LIST_MAX_PAGES,
} from '../listPagination.js'

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

  test('default maxPages is gold wr=20', async () => {
    let n = 0
    const items = await listAllWithCursorPagination(async () => {
      n++
      return { items: [n], nextCursor: `c${n}` }
    })
    expect(n).toBe(MCP_LIST_MAX_PAGES)
    expect(items).toHaveLength(MCP_LIST_MAX_PAGES)
    expect(MCP_LIST_MAX_PAGES).toBe(20)
  })
})

describe('listMcpCursorPages densable $n', () => {
  test('follows nextCursor then stops', async () => {
    const cursors: Array<string | undefined> = []
    const client = {
      request: async (req: { method: string; params?: { cursor: string } }) => {
        cursors.push(req.params?.cursor)
        if (req.params?.cursor === undefined) {
          return { tools: [{ name: 'a' }], nextCursor: 'p2' }
        }
        return { tools: [{ name: 'b' }] }
      },
    }
    const items = await listMcpCursorPages(client, 'srv', 'tools/list', page =>
      Array.isArray(page.tools) ? page.tools : undefined,
    )
    expect(cursors).toEqual([undefined, 'p2'])
    expect(items).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  test('caps at 20 pages and returns partial list', async () => {
    let n = 0
    const client = {
      request: async () => {
        n++
        return { tools: [{ n }], nextCursor: `c${n}` }
      },
    }
    const items = await listMcpCursorPages(client, 'srv', 'tools/list', page =>
      Array.isArray(page.tools) ? page.tools : undefined,
    )
    expect(n).toBe(20)
    expect(items).toHaveLength(20)
  })

  test('does not retry SdkError ListPaginationExceeded', async () => {
    let n = 0
    const client = {
      request: async () => {
        n++
        throw new SdkError(
          SdkErrorCode.ListPaginationExceeded,
          'tools/list: exceeded listMaxPages',
        )
      },
    }
    await expect(
      listMcpCursorPages(client, 'srv', 'tools/list', page =>
        Array.isArray(page.tools) ? page.tools : undefined,
      ),
    ).rejects.toBeInstanceOf(SdkError)
    expect(n).toBe(1)
  })
})

describe('listMcpToolsAggregated densable ai', () => {
  test('returns tools from listTools refresh', async () => {
    const client = {
      request: async () => ({ tools: [] }),
      listTools: async () => ({ tools: [{ name: 't' }] }),
    }
    await expect(listMcpToolsAggregated(client, 'srv')).resolves.toEqual([
      { name: 't' },
    ])
  })

  test('does not retry ListPaginationExceeded', async () => {
    let n = 0
    const client = {
      request: async () => ({ tools: [] }),
      listTools: async () => {
        n++
        throw new SdkError(
          SdkErrorCode.ListPaginationExceeded,
          'exceeded listMaxPages (64)',
        )
      },
    }
    await expect(listMcpToolsAggregated(client, 'srv')).rejects.toBeInstanceOf(
      SdkError,
    )
    expect(n).toBe(1)
  })

  test('An does not retry pagination exceeded or request timeout', () => {
    expect(
      isMcpListRetryable(
        new SdkError(SdkErrorCode.ListPaginationExceeded, 'cap'),
      ),
    ).toBe(false)
    expect(
      isMcpListRetryable(new SdkError(SdkErrorCode.RequestTimeout, 'to')),
    ).toBe(false)
    expect(isMcpListRetryable(new Error('ECONNRESET'))).toBe(true)
  })

  test('An does not retry ProtocolError JSON-RPC denylist', () => {
    expect(
      isMcpListRetryable(
        new ProtocolError(ProtocolErrorCode.MethodNotFound, 'no method'),
      ),
    ).toBe(false)
    expect(
      isMcpListRetryable(
        new ProtocolError(ProtocolErrorCode.InvalidRequest, 'bad'),
      ),
    ).toBe(false)
    expect(
      isMcpListRetryable(
        new ProtocolError(ProtocolErrorCode.InvalidParams, 'params'),
      ),
    ).toBe(false)
    expect(
      isMcpListRetryable(
        new ProtocolError(ProtocolErrorCode.UnsupportedProtocolVersion, 'ver'),
      ),
    ).toBe(false)
    expect(
      isMcpListRetryable(
        new ProtocolError(
          ProtocolErrorCode.MissingRequiredClientCapability,
          'cap',
        ),
      ),
    ).toBe(false)
    expect(isMcpListRetryable(new ProtocolError(-32001, 'legacy'))).toBe(false)
    expect(
      isMcpListRetryable(
        new ProtocolError(ProtocolErrorCode.InternalError, 'boom'),
      ),
    ).toBe(true)
  })

  test('An does not retry CLAUDEAI_BEARER_REJECTED or IssuerMismatchError', () => {
    const bearer = new Error('rejected')
    ;(bearer as { code: string }).code = 'CLAUDEAI_BEARER_REJECTED'
    expect(isMcpListRetryable(bearer)).toBe(false)
    expect(
      isMcpListRetryable(new IssuerMismatchError('metadata', 'a', 'b')),
    ).toBe(false)
  })
})

describe('gold fo/On tengu_mcp_list_paginated', () => {
  test('emits KEEP 遥测 on $n/$ai hosts without minify fo|On', () => {
    const src = readFileSync(
      join(import.meta.dir, '../listPagination.ts'),
      'utf8',
    )
    expect(src).toContain("logEvent('tengu_mcp_list_paginated'")
    expect(src).toContain('function emitMcpListPaginated(')
    expect(src).toContain('function emitMcpListPaginatedOn(')
    expect(src).toContain("source: 'pages' | 'aggregate' = 'pages'")
    expect(src).toContain("'aggregate'")
    expect(src).not.toMatch(/^export function fo\b/m)
    expect(src).not.toMatch(/^export function On\b/m)
    expect(src).not.toMatch(/^export function HZe\b/m)
  })
})
