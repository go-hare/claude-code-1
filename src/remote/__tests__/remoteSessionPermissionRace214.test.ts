/**
 * densable 2.1.214 #7 — remote permission + dialog race:
 * - control_response for still-pending permission → answered elsewhere dismiss
 * - control_response for still-pending dialog → answered elsewhere dismiss
 * - pending_user_dialog_requests redelivery (skip already answered)
 * - SDK result clears unresolved permission + dialog
 * - control_cancel_request for unknown id → ignore
 * - dialog cancel before permission cancel
 */
import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', () => ({
  logError: mock(() => {}),
  logForDebugging: mock(() => {}),
}))
mock.module('src/services/analytics/index.js', () => ({
  logEvent: mock(() => {}),
  logEventAsync: mock(async () => {}),
}))

import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlPermissionRequest,
  SDKControlRequest,
  SDKControlResponse,
} from '../../entrypoints/sdk/controlTypes.js'
import {
  RemoteSessionManager,
  type RemoteSessionCallbacks,
  type RemoteSessionConfig,
} from '../RemoteSessionManager.js'

type Handleable = unknown

function makeManager(opts?: { withDialog?: boolean }): {
  manager: RemoteSessionManager
  cancelled: Array<{ requestId: string; toolUseId: string | undefined }>
  dialogCancelled: string[]
  permissions: Array<{ requestId: string; tool: string }>
  dialogs: Array<{ requestId: string; kind: string }>
  messages: SDKMessage[]
  handle: (msg: unknown) => void
} {
  const cancelled: Array<{
    requestId: string
    toolUseId: string | undefined
  }> = []
  const dialogCancelled: string[] = []
  const permissions: Array<{ requestId: string; tool: string }> = []
  const dialogs: Array<{ requestId: string; kind: string }> = []
  const messages: SDKMessage[] = []

  const config: RemoteSessionConfig = {
    sessionId: 'sess-test',
    getAccessToken: () => 'tok',
    orgUuid: 'org',
  }
  const callbacks: RemoteSessionCallbacks = {
    onMessage: m => {
      messages.push(m)
    },
    onPermissionRequest: (req, requestId) => {
      permissions.push({ requestId, tool: req.tool_name })
    },
    onPermissionCancelled: (requestId, toolUseId) => {
      cancelled.push({ requestId, toolUseId })
    },
    ...(opts?.withDialog
      ? {
          onUserDialogRequest: (
            req: { dialog_kind: string },
            requestId: string,
          ) => {
            dialogs.push({ requestId, kind: req.dialog_kind })
          },
          onUserDialogCancelled: (requestId: string) => {
            dialogCancelled.push(requestId)
          },
        }
      : {}),
  }
  const manager = new RemoteSessionManager(config, callbacks)
  const handle = (msg: unknown) => {
    ;(
      manager as unknown as { handleMessage: (m: Handleable) => void }
    ).handleMessage(msg as Handleable)
  }
  return {
    manager,
    cancelled,
    dialogCancelled,
    permissions,
    dialogs,
    messages,
    handle,
  }
}

function canUseToolRequest(
  requestId: string,
  toolUseId = 'tu-1',
): SDKControlRequest {
  const request = {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    input: { command: 'echo hi' },
    tool_use_id: toolUseId,
  } as SDKControlPermissionRequest
  return {
    type: 'control_request',
    request_id: requestId,
    request,
  } as SDKControlRequest
}

function userDialogRequest(
  requestId: string,
  kind = 'refusal_fallback_prompt',
): SDKControlRequest {
  return {
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'request_user_dialog',
      dialog_kind: kind,
    },
  } as SDKControlRequest
}

describe('RemoteSessionManager densable #7 permission race', () => {
  test('control_response dismisses pending permission answered elsewhere', () => {
    const { handle, cancelled, permissions } = makeManager()
    handle(canUseToolRequest('req-1', 'tu-abc'))
    expect(permissions).toHaveLength(1)

    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow' },
      },
    }
    handle(response)

    expect(cancelled).toEqual([{ requestId: 'req-1', toolUseId: 'tu-abc' }])

    handle(response)
    expect(cancelled).toHaveLength(1)
  })

  test('result message dismisses unresolved permission prompts', () => {
    const { handle, cancelled, messages } = makeManager()
    handle(canUseToolRequest('req-2', 'tu-end'))
    expect(cancelled).toHaveLength(0)

    const result = {
      type: 'result',
      subtype: 'success',
      uuid: 'u1',
      session_id: 'sess-test',
      result: 'done',
    } as unknown as SDKMessage
    handle(result)

    expect(cancelled).toEqual([{ requestId: 'req-2', toolUseId: 'tu-end' }])
    expect(messages.some(m => m.type === 'result')).toBe(true)
  })

  test('control_cancel_request for unknown id does not fire cancelled', () => {
    const { handle, cancelled } = makeManager()
    const cancel: SDKControlCancelRequest = {
      type: 'control_cancel_request',
      request_id: 'never-seen',
    }
    handle(cancel)
    expect(cancelled).toHaveLength(0)
  })

  test('control_cancel_request for pending permission fires cancelled once', () => {
    const { handle, cancelled } = makeManager()
    handle(canUseToolRequest('req-3', 'tu-c'))
    handle({
      type: 'control_cancel_request',
      request_id: 'req-3',
    } satisfies SDKControlCancelRequest)
    expect(cancelled).toEqual([{ requestId: 'req-3', toolUseId: 'tu-c' }])
  })
})

describe('RemoteSessionManager densable #7 dialog redelivery', () => {
  test('request_user_dialog parks via onUserDialogRequest', () => {
    const { handle, dialogs } = makeManager({ withDialog: true })
    handle(userDialogRequest('dlg-1', 'refusal_fallback_prompt'))
    expect(dialogs).toEqual([
      { requestId: 'dlg-1', kind: 'refusal_fallback_prompt' },
    ])
  })

  test('duplicate dialog request_id is skipped', () => {
    const { handle, dialogs } = makeManager({ withDialog: true })
    handle(userDialogRequest('dlg-dup'))
    handle(userDialogRequest('dlg-dup'))
    expect(dialogs).toHaveLength(1)
  })

  test('control_response dismisses pending dialog answered elsewhere', () => {
    const { handle, dialogCancelled } = makeManager({ withDialog: true })
    handle(userDialogRequest('dlg-2'))
    handle({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'dlg-2',
        response: { behavior: 'completed' },
      },
    } satisfies SDKControlResponse)
    expect(dialogCancelled).toEqual(['dlg-2'])
  })

  test('control_cancel_request cancels dialog before permission path', () => {
    const { handle, dialogCancelled, cancelled } = makeManager({
      withDialog: true,
    })
    handle(userDialogRequest('dlg-3'))
    handle({
      type: 'control_cancel_request',
      request_id: 'dlg-3',
    } satisfies SDKControlCancelRequest)
    expect(dialogCancelled).toEqual(['dlg-3'])
    expect(cancelled).toHaveLength(0)
  })

  test('result clears unresolved dialogs', () => {
    const { handle, dialogCancelled } = makeManager({ withDialog: true })
    handle(userDialogRequest('dlg-end'))
    handle({
      type: 'result',
      subtype: 'success',
      uuid: 'u2',
      session_id: 'sess-test',
      result: 'done',
    } as unknown as SDKMessage)
    expect(dialogCancelled).toEqual(['dlg-end'])
  })

  test('pending_user_dialog_requests redelivers unseen dialog', () => {
    const { handle, dialogs } = makeManager({ withDialog: true })
    // control_response with redelivery payload (no local pending for the id)
    handle({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'other-rpc',
        response: {},
        pending_user_dialog_requests: [
          userDialogRequest('dlg-redeliver', 'ask_user'),
        ],
      },
    } as SDKControlResponse)
    expect(dialogs).toEqual([{ requestId: 'dlg-redeliver', kind: 'ask_user' }])
  })

  test('pending_user_dialog_requests skips already-answered request_id', () => {
    const { handle, dialogs, manager } = makeManager({ withDialog: true })
    handle(userDialogRequest('dlg-seen'))
    // local answer marks seen
    manager.respondToUserDialogRequest('dlg-seen', { behavior: 'completed' })
    expect(dialogs).toHaveLength(1)

    // redelivery of same id must skip
    handle({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'other-rpc-2',
        response: {},
        pending_user_dialog_requests: [userDialogRequest('dlg-seen')],
      },
    } as SDKControlResponse)
    expect(dialogs).toHaveLength(1)
  })
})
