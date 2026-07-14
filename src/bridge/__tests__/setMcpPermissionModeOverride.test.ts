/**
 * Official 2.1.x bridge control: set_mcp_permission_mode_override.
 * Pure handler tests — mock transport, no bridge bootstrap.
 */
import { describe, expect, mock, test } from 'bun:test'
import { handleServerControlRequest } from '../bridgeMessaging.js'
import type { SDKControlRequest } from '../../entrypoints/sdk/controlTypes.js'
import type { ReplBridgeTransport } from '../replBridgeTransport.js'

function makeRequest(
  request: Record<string, unknown>,
  request_id = 'req-1',
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

describe('handleServerControlRequest set_mcp_permission_mode_override', () => {
  test('errors when callback is not registered', async () => {
    const { transport, writes } = makeTransport()
    handleServerControlRequest(
      makeRequest({
        subtype: 'set_mcp_permission_mode_override',
        serverName: 'acme',
        mode: 'default',
      }),
      { transport, sessionId: 'sess' },
    )
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toContain(
      'onSetMcpPermissionModeOverride callback not registered',
    )
  })

  test('errors on empty serverName without calling callback', async () => {
    const { transport, writes } = makeTransport()
    const onSetMcpPermissionModeOverride = mock(() => ({ ok: true as const }))
    handleServerControlRequest(
      makeRequest({
        subtype: 'set_mcp_permission_mode_override',
        serverName: '',
        mode: 'default',
      }),
      { transport, sessionId: 'sess', onSetMcpPermissionModeOverride },
    )
    expect(onSetMcpPermissionModeOverride).not.toHaveBeenCalled()
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toContain('serverName')
  })

  test('forwards serverName/mode and returns success', async () => {
    const { transport, writes } = makeTransport()
    const onSetMcpPermissionModeOverride = mock(
      (_server: string, _mode: string | null) => ({
        ok: true as const,
        warning: 'not known',
      }),
    )
    handleServerControlRequest(
      makeRequest({
        subtype: 'set_mcp_permission_mode_override',
        serverName: 'claude-in-chrome',
        mode: 'auto',
      }),
      { transport, sessionId: 'sess', onSetMcpPermissionModeOverride },
    )
    expect(onSetMcpPermissionModeOverride).toHaveBeenCalledWith(
      'claude-in-chrome',
      'auto',
    )
    const event = writes[0] as {
      response: {
        subtype: string
        response?: { warning?: string }
      }
    }
    expect(event.response.subtype).toBe('success')
    expect(event.response.response?.warning).toBe('not known')
  })

  test('propagates callback error verdict', async () => {
    const { transport, writes } = makeTransport()
    handleServerControlRequest(
      makeRequest({
        subtype: 'set_mcp_permission_mode_override',
        serverName: 'acme',
        mode: 'bypassPermissions',
      }),
      {
        transport,
        sessionId: 'sess',
        onSetMcpPermissionModeOverride: () => ({
          ok: false,
          error: 'tighten-only',
        }),
      },
    )
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe('tighten-only')
  })

  test('outbound-only rejects before callback', async () => {
    const { transport, writes } = makeTransport()
    const onSetMcpPermissionModeOverride = mock(() => ({ ok: true as const }))
    handleServerControlRequest(
      makeRequest({
        subtype: 'set_mcp_permission_mode_override',
        serverName: 'acme',
        mode: 'default',
      }),
      {
        transport,
        sessionId: 'sess',
        outboundOnly: true,
        onSetMcpPermissionModeOverride,
      },
    )
    expect(onSetMcpPermissionModeOverride).not.toHaveBeenCalled()
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toContain('outbound-only')
  })

  test('null mode clears override via callback', async () => {
    const { transport, writes } = makeTransport()
    const onSetMcpPermissionModeOverride = mock(
      (_s: string, _m: string | null) => ({ ok: true as const }),
    )
    handleServerControlRequest(
      makeRequest({
        subtype: 'set_mcp_permission_mode_override',
        serverName: 'acme',
        mode: null,
      }),
      { transport, sessionId: 'sess', onSetMcpPermissionModeOverride },
    )
    expect(onSetMcpPermissionModeOverride).toHaveBeenCalledWith('acme', null)
    expect(
      (writes[0] as { response: { subtype: string } }).response.subtype,
    ).toBe('success')
  })
})
