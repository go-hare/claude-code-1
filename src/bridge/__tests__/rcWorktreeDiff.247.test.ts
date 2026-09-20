/**
 * densable 2.1.247 #20 — `/remote-control` reports working-tree diff via
 * inbound `get_workspace_diff` (pull), not an upload.
 */
import { describe, expect, mock, test } from 'bun:test'
import { handleServerControlRequest } from '../bridgeMessaging.js'
import { createOnGetWorkspaceDiff } from '../createOnGetWorkspaceDiff.js'
import type { SDKControlRequest } from '../../entrypoints/sdk/controlTypes.js'
import type { ReplBridgeTransport } from '../replBridgeTransport.js'
import {
  GET_WORKSPACE_DIFF_NOT_SUPPORTED,
  GET_WORKSPACE_DIFF_TIMEOUT_ERROR,
  GET_WORKSPACE_DIFF_TIMEOUT_MS,
  HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET,
  REPL_WORKSPACE_DIFF_COMPUTE_BUDGET,
  WORKSPACE_DIFF_RESULT_CACHE_MS,
} from '../workspaceDiffBudget.js'

function makeRequest(
  request: Record<string, unknown>,
  request_id = 'req-ws-1',
): SDKControlRequest {
  return {
    type: 'control_request',
    request_id,
    request,
  } as SDKControlRequest
}

function makeTransport() {
  const writes: unknown[] = []
  let resolveWritten: ((event: unknown) => void) | undefined
  const written = new Promise<unknown>(resolve => {
    resolveWritten = resolve
  })
  const transport = {
    write: mock(async (event: unknown) => {
      writes.push(event)
      resolveWritten?.(event)
    }),
  } as unknown as ReplBridgeTransport
  return { transport, writes, written }
}

describe('handleServerControlRequest get_workspace_diff densable 2.1.247', () => {
  test('missing callback replies with official not-supported string', () => {
    const { transport, writes } = makeTransport()
    handleServerControlRequest(makeRequest({ subtype: 'get_workspace_diff' }), {
      transport,
      sessionId: 'sess',
    })
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe(GET_WORKSPACE_DIFF_NOT_SUPPORTED)
  })

  test('registered callback success writes the Yt payload', async () => {
    const { transport, writes, written } = makeTransport()
    const payload = { diff: null }
    // Typed param so mock.calls is [AbortSignal][] for the assertion below.
    const onGetWorkspaceDiff = mock(async (_signal: AbortSignal) => payload)
    handleServerControlRequest(makeRequest({ subtype: 'get_workspace_diff' }), {
      transport,
      sessionId: 'sess',
      onGetWorkspaceDiff,
    })
    expect(onGetWorkspaceDiff).toHaveBeenCalledTimes(1)
    expect(onGetWorkspaceDiff.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
    await written
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: { subtype: string; response?: { diff: null } }
    }
    expect(event.response.subtype).toBe('success')
    expect(event.response.response).toEqual(payload)
  })

  test('timeout constants match official ht/kt', () => {
    expect(GET_WORKSPACE_DIFF_TIMEOUT_MS).toBe(8000)
    expect(GET_WORKSPACE_DIFF_TIMEOUT_ERROR).toBe(
      'get_workspace_diff timed out: the workspace diff is still being computed; retry shortly',
    )
  })
})

describe('createOnGetWorkspaceDiff densable 2.1.247 cd wire', () => {
  test('falsy host omits the callback', () => {
    expect(createOnGetWorkspaceDiff(undefined, undefined, undefined)).toBe(
      undefined,
    )
  })

  test('truthy host returns a function', () => {
    expect(typeof createOnGetWorkspaceDiff({}, undefined, undefined)).toBe(
      'function',
    )
  })
})

describe('workspaceDiff budgets densable 2.1.247 ad/dd/ts', () => {
  test('REPL and headless budgets plus cache window', () => {
    expect(REPL_WORKSPACE_DIFF_COMPUTE_BUDGET).toEqual({
      perFileMs: 400,
      totalMs: 1500,
    })
    expect(HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET).toEqual({
      perFileMs: 2000,
      totalMs: 6000,
    })
    expect(WORKSPACE_DIFF_RESULT_CACHE_MS).toBe(60_000)
  })
})
