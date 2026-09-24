/**
 * densable 2.1.251 #29 — sendMcpMessage arms 70000 only for non-requests.
 * A thrown SDK server is the only one marked failed (Rd).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JSONRPCMessage } from '../../services/mcp/types.js'
import { AbortError, ControlStreamClosedError } from '../../utils/errors.js'
import {
  isJsonRpcRequestMessage,
  SDK_MCP_NON_REQUEST_TIMEOUT_MS,
  StructuredIO,
} from '../structuredIO.js'

function asMessage(value: unknown): JSONRPCMessage {
  return value as JSONRPCMessage
}

function hold(gate: Promise<void>): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      await gate
      yield* []
    },
  }
}

describe('densable 2.1.251 #29 SDK MCP handshake timeout', () => {
  test('rot is method plus a non-null id', () => {
    expect(SDK_MCP_NON_REQUEST_TIMEOUT_MS).toBe(70_000)
    expect(
      isJsonRpcRequestMessage(
        asMessage({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      ),
    ).toBe(true)
    expect(
      isJsonRpcRequestMessage(
        asMessage({ jsonrpc: '2.0', method: 'initialize', id: 0 }),
      ),
    ).toBe(true)
    expect(
      isJsonRpcRequestMessage(
        asMessage({ jsonrpc: '2.0', method: 'initialize', id: null }),
      ),
    ).toBe(false)
    expect(
      isJsonRpcRequestMessage(
        asMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      ),
    ).toBe(false)
    expect(
      isJsonRpcRequestMessage(asMessage({ jsonrpc: '2.0', id: 1, result: {} })),
    ).toBe(false)
  })

  test('a JSON-RPC request is not aborted by the host wait', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const io = new StructuredIO(hold(gate))
    const reading = (async () => {
      for await (const _message of io.structuredInput) {
        void _message
      }
    })()
    let settled = false
    const pending = io
      .sendMcpMessage(
        'sdk',
        asMessage({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
        30,
      )
      .then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(settled).toBe(false)
    release()
    await reading
    await pending
  })

  test('a notification uses the caller timeout and rejects AbortError', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const io = new StructuredIO(hold(gate))
    const reading = (async () => {
      for await (const _message of io.structuredInput) {
        void _message
      }
    })()
    const outcome = await Promise.race([
      io
        .sendMcpMessage(
          'sdk',
          asMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          40,
        )
        .then(
          () => 'resolved' as const,
          (error: unknown) => error,
        ),
      new Promise<string>(resolve => {
        setTimeout(() => resolve('hung'), 500)
      }),
    ])
    expect(outcome).toBeInstanceOf(AbortError)
    release()
    await reading
  })

  test('closing the stream rejects an in-flight request with ControlStreamClosedError', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const io = new StructuredIO(hold(gate))
    const reading = (async () => {
      for await (const _message of io.structuredInput) {
        void _message
      }
    })()
    const pending = io.sendMcpMessage(
      'sdk',
      asMessage({ jsonrpc: '2.0', method: 'initialize', id: 0 }),
      20,
    )
    release()
    await reading
    await expect(pending).rejects.toBeInstanceOf(ControlStreamClosedError)
  })

  test('setupSdkMcpClients marks only the thrown server failed', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/mcp/client.ts'),
      'utf8',
    )
    const start = src.indexOf('export async function setupSdkMcpClients')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 4500)
    expect(body).toContain('Promise.allSettled')
    expect(body).toContain("type: 'failed' as const")
    expect(body).toContain("if (result.status === 'fulfilled')")
    expect(body).toContain('getServerVersion')
    expect(body).toContain('getInstructions')
    expect(body).toContain('fetchMcpSkillsForClient')
    expect(body).toContain('ListMcpResourcesTool')
    expect(body).toContain('ReadMcpResourceTool')
    expect(body).toContain('commands:')
    expect(body).not.toContain('mcp_sdk_connect')
    expect(body).not.toContain('70_000')
    expect(body).not.toContain('70000')
  })
})
