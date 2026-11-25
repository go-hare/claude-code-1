import { afterEach, describe, expect, test } from 'bun:test'
import { setDynamicTeamContext } from 'src/utils/teammate.js'
import { runWithTeammateContext } from 'src/utils/teammateContext.js'
import {
  recordPendingShutdownRequest,
  resetPendingShutdownRequestsForTesting,
} from 'src/utils/teammateMailbox.js'
import { SendMessageTool } from '../SendMessageTool.js'

afterEach(() => {
  setDynamicTeamContext(null)
  resetPendingShutdownRequestsForTesting()
})

describe('SendMessageTool shutdown_response in main session (#995)', () => {
  test('throws instead of exiting CLI when main session approves a shutdown request', async () => {
    const ctx = {
      getAppState: () => ({ tasks: {}, teamContext: undefined }),
      setAppState: () => {},
      abortController: new AbortController(),
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]

    const canUseTool = (async () => ({
      behavior: 'allow',
      updatedInput: {},
    })) as unknown as Parameters<typeof SendMessageTool.call>[2]
    const assistantMsg = {} as Parameters<typeof SendMessageTool.call>[3]

    await expect(
      SendMessageTool.call(
        {
          to: 'team-lead',
          message: {
            type: 'shutdown_response',
            request_id: 'req-123',
            approve: true,
          },
        },
        ctx,
        canUseTool,
        assistantMsg,
      ),
    ).rejects.toThrow(
      /Only a teammate can approve a shutdown request, and this session is not running as one/,
    )
  })

  test('in-process teammate approving shutdown aborts its own teammateContext controller', async () => {
    const controller = new AbortController()
    const ctx = {
      getAppState: () => ({ tasks: {}, teamContext: undefined }),
      setAppState: () => {},
      abortController: new AbortController(),
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]
    const canUseTool = (async () => ({
      behavior: 'allow',
      updatedInput: {},
    })) as unknown as Parameters<typeof SendMessageTool.call>[2]
    const assistantMsg = {} as Parameters<typeof SendMessageTool.call>[3]

    recordPendingShutdownRequest('req-456', 'worker', true)
    const result = await runWithTeammateContext(
      {
        agentId: 'worker@my-team',
        agentName: 'worker',
        teamName: 'my-team',
        parentSessionId: 'parent-session-1',
        isInProcess: true,
        abortController: controller,
        color: 'blue',
        planModeRequired: false,
      },
      () =>
        SendMessageTool.call(
          {
            to: 'team-lead',
            message: {
              type: 'shutdown_response',
              request_id: 'req-456',
              approve: true,
            },
          },
          ctx,
          canUseTool,
          assistantMsg,
        ),
    )

    expect(controller.signal.aborted).toBe(true)
    expect((result.data as { success: boolean }).success).toBe(true)
  })
})
