import { describe, expect, test } from 'bun:test'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { TeammateMessage } from '../../utils/teammateMailbox.js'
import { classifyInboxProtocolMessages } from '../inboxPollerProtocol.js'

function msg(text: string, from = 'team-lead'): TeammateMessage {
  return {
    from,
    text,
    timestamp: new Date().toISOString(),
    read: false,
  }
}

describe('classifyInboxProtocolMessages (densable InboxPoller kre/Ejr)', () => {
  test('handled plan_approval_response rewrites to Ejr approve text', () => {
    const body = msg(
      jsonStringify({
        type: 'plan_approval_response',
        requestId: 'r1',
        approved: true,
        timestamp: new Date().toISOString(),
        permissionMode: 'default',
      }),
    )
    const handled = new Set<TeammateMessage>([body])
    const buckets = classifyInboxProtocolMessages([body], handled)
    expect(buckets.regularMessages).toHaveLength(1)
    expect(buckets.regularMessages[0]!.text).toBe(
      '[Plan Approved] You can now proceed with implementation',
    )
    expect(buckets.droppedProtocolFrames).toHaveLength(0)
  })

  test('handled plan_approval_response rewrites reject to Ejr', () => {
    const body = msg(
      jsonStringify({
        type: 'plan_approval_response',
        requestId: 'r2',
        approved: false,
        feedback: 'needs more detail',
        timestamp: new Date().toISOString(),
      }),
    )
    const handled = new Set<TeammateMessage>([body])
    const buckets = classifyInboxProtocolMessages([body], handled)
    expect(buckets.regularMessages[0]!.text).toBe(
      '[Plan Rejected] needs more detail',
    )
  })

  test('unhandled plan_approval_response is dropped (not raw JSON)', () => {
    const body = msg(
      jsonStringify({
        type: 'plan_approval_response',
        requestId: 'r3',
        approved: true,
        timestamp: new Date().toISOString(),
      }),
    )
    const buckets = classifyInboxProtocolMessages([body], new Set())
    expect(buckets.regularMessages).toHaveLength(0)
    expect(buckets.droppedProtocolFrames).toHaveLength(1)
    expect(buckets.droppedProtocolFrames[0]!.text).toContain(
      'plan_approval_response',
    )
  })

  test('team_permission_update is always dropped (AZi)', () => {
    const body = msg(
      jsonStringify({
        type: 'team_permission_update',
        permissionUpdate: {
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          behavior: 'allow',
          destination: 'session',
        },
        directoryPath: '/tmp',
        toolName: 'Bash',
      }),
    )
    const buckets = classifyInboxProtocolMessages([body])
    expect(buckets.regularMessages).toHaveLength(0)
    expect(buckets.droppedProtocolFrames).toHaveLength(1)
  })

  test('plain peer text stays in regularMessages', () => {
    const body = msg('hello from lead', 'researcher')
    const buckets = classifyInboxProtocolMessages([body])
    expect(buckets.regularMessages).toEqual([body])
    expect(buckets.droppedProtocolFrames).toHaveLength(0)
  })

  test('plan_approval_request is bucketed for leader auto-approve', () => {
    const body = msg(
      jsonStringify({
        type: 'plan_approval_request',
        requestId: 'req-9',
        from: 'worker',
        planFilePath: '/tmp/plan.md',
        planContent: 'do the thing',
        timestamp: new Date().toISOString(),
      }),
      'worker',
    )
    const buckets = classifyInboxProtocolMessages([body])
    expect(buckets.planApprovalRequests).toHaveLength(1)
    expect(buckets.regularMessages).toHaveLength(0)
  })
})
