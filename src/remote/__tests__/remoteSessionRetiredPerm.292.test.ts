import { describe, expect, test } from 'bun:test'
import { RemoteSessionManager } from '../RemoteSessionManager.js'

describe('2.1.292 #233 / #191 RemoteSessionManager retiredPermissionRequestIds', () => {
  test('does not re-arm a permission request after it was answered or cancelled', async () => {
    const asked: string[] = []
    const mgr = new RemoteSessionManager(
      {
        sessionId: 'sess-1',
        getAccessToken: () => 'tok-1',
        orgUuid: 'org-1',
      },
      {
        onMessage: () => {},
        onPermissionRequest: (_req, id) => {
          asked.push(id)
        },
      },
    )

    const permMsg = {
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tu-1',
      },
    }

    // First delivery arms the permission prompt
    ;(mgr as unknown as { handleMessage(m: unknown): void }).handleMessage(
      permMsg,
    )
    expect(asked).toEqual(['req-1'])

    // User approves it -> retires req-1
    mgr.respondToPermissionRequest('req-1', {
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    })

    // Large-transcript replay delivers req-1 again -> must NOT re-arm
    ;(mgr as unknown as { handleMessage(m: unknown): void }).handleMessage(
      permMsg,
    )
    expect(asked).toEqual(['req-1'])

    // Cancelled request also retires and does not re-arm
    const permMsg2 = {
      ...permMsg,
      request_id: 'req-2',
      request: { ...permMsg.request, tool_use_id: 'tu-2' },
    }
    ;(mgr as unknown as { handleMessage(m: unknown): void }).handleMessage(
      permMsg2,
    )
    expect(asked).toEqual(['req-1', 'req-2'])

    ;(mgr as unknown as { handleMessage(m: unknown): void }).handleMessage({
      type: 'control_cancel_request',
      request_id: 'req-2',
    })
    ;(mgr as unknown as { handleMessage(m: unknown): void }).handleMessage(
      permMsg2,
    )
    expect(asked).toEqual(['req-1', 'req-2'])
  })
})
