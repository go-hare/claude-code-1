import { describe, expect, test } from 'bun:test'
import { RemoteSessionManager } from '../RemoteSessionManager.js'

describe('RemoteSessionManager subagentRequestsOutliveTheTurn (#626)', () => {
  test('keeps open subagent permission requests alive across turn result while dismissing main-thread and AskUserQuestion/ExitPlanMode requests', () => {
    const cancelled: string[] = []
    const armed: string[] = []

    const mgr = new RemoteSessionManager(
      {
        sessionId: 'sess_1',
        getAccessToken: () => 'tok',
        orgUuid: 'org_1',
        subagentRequestsOutliveTheTurn: true,
      },
      {
        onMessage: () => {},
        onPermissionRequest: (_req, id) => {
          armed.push(id)
        },
        onPermissionCancelled: id => {
          cancelled.push(id)
        },
      },
    )

    const handleMessage = (
      mgr as unknown as {
        handleMessage: (msg: unknown, extras?: Record<string, unknown>) => void
      }
    ).handleMessage.bind(mgr)

    // 1. Main-thread permission request
    handleMessage({
      type: 'control_request',
      request_id: 'req_main',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tu_1',
      },
    })

    // 2. Subagent Bash permission request (should outlive turn)
    handleMessage({
      type: 'control_request',
      request_id: 'req_sub',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'pwd' },
        tool_use_id: 'tu_2',
        agent_id: 'agent_1',
      },
    })

    // 3. Subagent AskUserQuestion (excluded by qX, should be dismissed)
    handleMessage({
      type: 'control_request',
      request_id: 'req_sub_ask',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        input: {},
        tool_use_id: 'tu_3',
        agent_id: 'agent_1',
      },
    })

    expect(armed).toEqual(['req_main', 'req_sub', 'req_sub_ask'])

    // Turn ends with result
    handleMessage({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 10,
      duration_api_ms: 5,
      num_turns: 1,
      result: 'done',
      session_id: 'sess_1',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    expect(cancelled).toEqual(['req_main', 'req_sub_ask'])

    // Redelivery of req_main with identical payload reinstates it
    handleMessage({
      type: 'control_request',
      request_id: 'req_main',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tu_1',
      },
    })
    expect(armed).toEqual(['req_main', 'req_sub', 'req_sub_ask', 'req_main'])
  })
})
