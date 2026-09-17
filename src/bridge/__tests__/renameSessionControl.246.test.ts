/**
 * Official leftover #49 Pi — rename_session control_request @209373645.
 */
import { describe, expect, mock, test } from 'bun:test'
import { handleServerControlRequest } from '../bridgeMessaging.js'
import type { SDKControlRequest } from '../../entrypoints/sdk/controlTypes.js'
import type { ReplBridgeTransport } from '../replBridgeTransport.js'

function makeRequest(
  request: Record<string, unknown>,
  request_id = 'req-rename-1',
): SDKControlRequest {
  return {
    type: 'control_request',
    request_id,
    request,
  } as SDKControlRequest
}

function makeTransport() {
  const writes: unknown[] = []
  const transport = {
    write: mock(async (event: unknown) => {
      writes.push(event)
    }),
  } as unknown as ReplBridgeTransport
  return { transport, writes }
}

describe('handleServerControlRequest rename_session leftover Pi', () => {
  test('non-string title replies with official string error', () => {
    const { transport, writes } = makeTransport()
    const onRenameSession = mock(() => ({ ok: true as const }))
    handleServerControlRequest(
      makeRequest({ subtype: 'rename_session', title: 12 }),
      { transport, sessionId: 'sess', onRenameSession },
    )
    expect(onRenameSession).not.toHaveBeenCalled()
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe('rename_session: title must be a string')
  })

  test('missing callback replies not registered', () => {
    const { transport, writes } = makeTransport()
    handleServerControlRequest(
      makeRequest({ subtype: 'rename_session', title: 'hello' }),
      { transport, sessionId: 'sess' },
    )
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe(
      'rename_session is not supported in this context (onRenameSession callback not registered)',
    )
  })

  test('callback {ok:false} replies with the error body', () => {
    const { transport, writes } = makeTransport()
    const onRenameSession = mock(() => ({
      ok: false as const,
      error: 'title must be non-empty',
    }))
    handleServerControlRequest(
      makeRequest({ subtype: 'rename_session', title: '   ' }),
      { transport, sessionId: 'sess', onRenameSession },
    )
    expect(onRenameSession).toHaveBeenCalledWith('   ')
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe('title must be non-empty')
  })

  test('callback {ok:true} is success', () => {
    const { transport, writes } = makeTransport()
    const onRenameSession = mock(() => ({ ok: true as const }))
    handleServerControlRequest(
      makeRequest({ subtype: 'rename_session', title: 'phone name' }),
      { transport, sessionId: 'sess', onRenameSession },
    )
    expect(onRenameSession).toHaveBeenCalledWith('phone name')
    const event = writes[0] as { response: { subtype: string } }
    expect(event.response.subtype).toBe('success')
  })
})
