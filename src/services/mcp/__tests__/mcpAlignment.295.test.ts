import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import {
  getMaxMcpDescriptionLength,
  gracefulShutdownWindowsStdio,
  isTerminalConnectionError,
  MAX_LOADED_MCP_DESCRIPTION_LENGTH,
  MAX_MCP_DESCRIPTION_LENGTH,
} from '../clientHelpers.js'
import {
  HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS,
  HEADLESS_MCP_SLOW_RECONNECT_ATTEMPTS,
  slowReconnectBackoffMs,
} from '../headlessMcpReconnect.js'
import {
  listAllWithCursorPagination,
  listMcpCursorPages,
} from '../listPagination.js'

describe('v2.1.295/296 MCP alignment (#360, #361, #362, #454, #533, #546)', () => {
  const prevEnv = process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH
    } else {
      process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = prevEnv
    }
  })

  test('#454 & #546 description caps: 4096 up front, 16384 loaded', () => {
    delete process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH
    expect(MAX_MCP_DESCRIPTION_LENGTH).toBe(4096)
    expect(MAX_LOADED_MCP_DESCRIPTION_LENGTH).toBe(16384)
    expect(getMaxMcpDescriptionLength(false)).toBe(4096)
    expect(getMaxMcpDescriptionLength(true)).toBe(16384)

    process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = '8192'
    expect(getMaxMcpDescriptionLength(false)).toBe(8192)
    expect(getMaxMcpDescriptionLength(true)).toBe(8192)
  })

  test('#361 isTerminalConnectionError ignores server/HTTP/JSON-RPC error replies mentioning network errors', () => {
    expect(
      isTerminalConnectionError(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      ),
    ).toBe(true)
    expect(
      isTerminalConnectionError(
        Object.assign(new Error('socket'), { code: 'ECONNRESET' }),
      ),
    ).toBe(true)
    expect(
      isTerminalConnectionError(
        Object.assign(new Error('closed'), { code: 'ConnectionClosed' }),
      ),
    ).toBe(true)
    expect(
      isTerminalConnectionError(new Error('SSE stream disconnected')),
    ).toBe(true)
    expect(isTerminalConnectionError(new Error('read ECONNRESET'))).toBe(true)
    expect(isTerminalConnectionError(new Error('connection terminated'))).toBe(
      true,
    )

    // Server replies that mention ECONNRESET / terminated must NOT be treated as terminal
    expect(
      isTerminalConnectionError(
        Object.assign(new Error('Upstream failed with ECONNRESET'), {
          status: 502,
        }),
      ),
    ).toBe(false)
    expect(
      isTerminalConnectionError(
        Object.assign(new Error('Tool error: ETIMEDOUT'), { code: -32000 }),
      ),
    ).toBe(false)
    expect(
      isTerminalConnectionError(
        new Error('Error POSTing to endpoint (HTTP 500): ECONNREFUSED'),
      ),
    ).toBe(false)
  })

  test('#362 listAllWithCursorPagination & listMcpCursorPages stop on repeated cursor across history', async () => {
    let calls = 0
    const pages = [
      { items: [1], nextCursor: 'c1' },
      { items: [2], nextCursor: 'c2' },
      { items: [3], nextCursor: 'c1' }, // repeats earlier cursor c1!
    ]
    const all = await listAllWithCursorPagination(async () => pages[calls++]!)
    expect(all).toEqual([1, 2, 3])
    expect(calls).toBe(3)

    let rpcCalls = 0
    const rpcPages = [
      { tools: [{ name: 'a' }], nextCursor: 'p1' },
      { tools: [{ name: 'b' }], nextCursor: 'p2' },
      { tools: [{ name: 'c' }], nextCursor: 'p1' },
    ]
    const client = {
      async request() {
        return rpcPages[rpcCalls++]!
      },
    }
    const items = await listMcpCursorPages<{ name: string }>(
      client,
      'srv',
      'tools/list',
      p => p.tools as { name: string }[] | undefined,
    )
    expect(items.map(t => t.name)).toEqual(['a', 'b', 'c'])
    expect(rpcCalls).toBe(3)
  })

  test('#360 slow reconnect constants and backoff bounds', () => {
    expect(HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS).toBe(5)
    expect(HEADLESS_MCP_SLOW_RECONNECT_ATTEMPTS).toBe(8)
    expect(slowReconnectBackoffMs(0, () => 0)).toBe(15000)
    expect(slowReconnectBackoffMs(0, () => 1)).toBe(30000)
    expect(slowReconnectBackoffMs(10, () => 1)).toBe(300000)
  })

  test('#533 gracefulShutdownWindowsStdio closes stdin first and only kills tree if still running', async () => {
    // Case 1: exits after stdin.end() within grace period -> no killTree
    const proc1 = new EventEmitter() as EventEmitter & {
      pid: number
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      stdin: { end: () => void }
    }
    proc1.pid = 12345
    proc1.exitCode = null
    proc1.signalCode = null
    let stdinEnded1 = false
    let killed1 = false
    proc1.stdin = {
      end() {
        stdinEnded1 = true
        proc1.exitCode = 0
        proc1.emit('exit')
      },
    }
    await gracefulShutdownWindowsStdio(
      proc1 as unknown as Parameters<typeof gracefulShutdownWindowsStdio>[0],
      {
        graceMs: 50,
        killWaitMs: 50,
        killTree: () => {
          killed1 = true
        },
      },
    )
    expect(stdinEnded1).toBe(true)
    expect(killed1).toBe(false)

    // Case 2: stays alive past grace period -> killTree(pid) called
    const proc2 = new EventEmitter() as EventEmitter & {
      pid: number
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      stdin: { end: () => void }
    }
    proc2.pid = 67890
    proc2.exitCode = null
    proc2.signalCode = null
    let killedPid: number | undefined
    proc2.stdin = { end() {} }
    await gracefulShutdownWindowsStdio(
      proc2 as unknown as Parameters<typeof gracefulShutdownWindowsStdio>[0],
      {
        graceMs: 10,
        killWaitMs: 10,
        killTree: pid => {
          killedPid = pid
          proc2.exitCode = 1
          proc2.emit('exit')
        },
      },
    )
    expect(killedPid).toBe(67890)
  })
})
