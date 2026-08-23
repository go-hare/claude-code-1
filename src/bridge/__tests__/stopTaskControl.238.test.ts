/**
 * densable 2.1.238 #19 — RC control_request stop_task (Zkd / UHr).
 * Pure handler tests — mock transport, no bridge bootstrap.
 */
import { describe, expect, mock, test } from 'bun:test'
import { handleServerControlRequest } from '../bridgeMessaging.js'
import type { SDKControlRequest } from '../../entrypoints/sdk/controlTypes.js'
import type { ReplBridgeTransport } from '../replBridgeTransport.js'

function makeRequest(
  request: Record<string, unknown>,
  request_id = 'req-stop-1',
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

describe('handleServerControlRequest stop_task densable 2.1.238', () => {
  test('invalid task_id replies with SEA string', () => {
    const { transport, writes } = makeTransport()
    handleServerControlRequest(
      makeRequest({ subtype: 'stop_task', task_id: 12 }),
      { transport, sessionId: 'sess' },
    )
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe('stop_task: task_id must be a string')
  })

  test('missing callback replies with SEA not-supported string', () => {
    const { transport, writes } = makeTransport()
    handleServerControlRequest(
      makeRequest({ subtype: 'stop_task', task_id: 'task-1' }),
      { transport, sessionId: 'sess' },
    )
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe(
      'stop_task is not supported in this context (callback not registered)',
    )
  })

  test('registered callback is invoked and success writes response object', async () => {
    const { transport, writes, written } = makeTransport()
    const onStopTask = mock(async (taskId: string) => ({
      taskId,
      taskType: 'local_agent',
    }))
    handleServerControlRequest(
      makeRequest({ subtype: 'stop_task', task_id: 'task-9' }),
      { transport, sessionId: 'sess', onStopTask },
    )
    expect(onStopTask).toHaveBeenCalledWith('task-9')
    await written
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      session_id: string
      response: {
        subtype: string
        request_id: string
        response?: Record<string, unknown>
      }
    }
    expect(event.session_id).toBe('sess')
    expect(event.response.subtype).toBe('success')
    expect(event.response.request_id).toBe('req-stop-1')
    expect(event.response.response).toEqual({
      taskId: 'task-9',
      taskType: 'local_agent',
    })
  })

  test('callback rejection writes error control_response', async () => {
    const { transport, writes, written } = makeTransport()
    const onStopTask = mock(async () => {
      throw new Error('task not found')
    })
    handleServerControlRequest(
      makeRequest({ subtype: 'stop_task', task_id: 'missing' }),
      { transport, sessionId: 'sess', onStopTask },
    )
    await written
    const event = writes[0] as {
      response: { subtype: string; error?: string }
    }
    expect(event.response.subtype).toBe('error')
    expect(event.response.error).toBe('task not found')
  })
})
