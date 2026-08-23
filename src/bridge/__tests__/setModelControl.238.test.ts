/**
 * densable 2.1.238 #24 — Zkd set_model control_request.
 * Non-string → invalid_model_type; callback `{ok:false}` → error; else success.
 */
import { describe, expect, mock, test } from 'bun:test'
import { handleServerControlRequest } from '../bridgeMessaging.js'
import type { SDKControlRequest } from '../../entrypoints/sdk/controlTypes.js'
import type { ReplBridgeTransport } from '../replBridgeTransport.js'

function makeRequest(
  request: Record<string, unknown>,
  request_id = 'req-set-model-1',
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

describe('handleServerControlRequest set_model densable 2.1.238', () => {
  test('non-string model replies with SEA invalid_model_type string', () => {
    const { transport, writes } = makeTransport()
    const onSetModel = mock(() => ({ ok: true as const }))
    handleServerControlRequest(
      makeRequest({ subtype: 'set_model', model: 12 }),
      { transport, sessionId: 'sess', onSetModel },
    )
    expect(onSetModel).not.toHaveBeenCalled()
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe('set_model: model must be a string')
  })

  test('callback {ok:false} replies with the error body', () => {
    const { transport, writes } = makeTransport()
    const onSetModel = mock(() => ({
      ok: false as const,
      error:
        'Model "opus" is restricted by your organization\'s settings. Using sonnet instead.',
    }))
    handleServerControlRequest(
      makeRequest({ subtype: 'set_model', model: 'opus' }),
      { transport, sessionId: 'sess', onSetModel },
    )
    expect(onSetModel).toHaveBeenCalledWith('opus')
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toContain('restricted by your organization')
  })

  test('void callback is success (Zkd only checks M && !M.ok)', () => {
    const { transport, writes } = makeTransport()
    const onSetModel = mock(() => {})
    handleServerControlRequest(
      makeRequest({ subtype: 'set_model', model: 'sonnet' }),
      { transport, sessionId: 'sess', onSetModel },
    )
    expect(onSetModel).toHaveBeenCalledWith('sonnet')
    const event = writes[0] as { response: { subtype: string } }
    expect(event.response.subtype).toBe('success')
  })

  test('null/undefined model is passed as undefined (default)', () => {
    const { transport, writes } = makeTransport()
    const onSetModel = mock(() => ({ ok: true as const }))
    handleServerControlRequest(makeRequest({ subtype: 'set_model' }), {
      transport,
      sessionId: 'sess',
      onSetModel,
    })
    expect(onSetModel).toHaveBeenCalledWith(undefined)
    const event = writes[0] as { response: { subtype: string } }
    expect(event.response.subtype).toBe('success')
  })
})
