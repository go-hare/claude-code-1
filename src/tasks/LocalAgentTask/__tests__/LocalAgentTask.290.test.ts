import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearAgentPermissionWaits,
  clearAgentPermissionWaitsForAgent,
  createProgressTracker,
  forfeitAllChatPins,
  getAgentAskNoticeAttachment,
  getTokenCountFromTracker,
  registerAgentPermissionWait,
  updateProgressFromMessage,
  updateProgressFromStreamTokenEstimate,
} from '../LocalAgentTask.js'

afterEach(() => {
  clearAgentPermissionWaits()
})

describe('LocalAgentTask v2.1.290 (#15 thinking/progress)', () => {
  test('streamedTokenEstimate tracks response_start and tokens delta, then settles on usage', () => {
    const tracker = createProgressTracker()
    expect(getTokenCountFromTracker(tracker)).toBe(0)

    updateProgressFromStreamTokenEstimate(tracker, {
      type: 'tokens',
      estimatedTokensDelta: 120,
    })
    expect(getTokenCountFromTracker(tracker)).toBe(120)

    updateProgressFromStreamTokenEstimate(tracker, { type: 'response_start' })
    expect(tracker.streamedTokenEstimateAtResponseStart).toBe(120)

    updateProgressFromStreamTokenEstimate(tracker, {
      type: 'tokens',
      estimatedTokensDelta: 30,
    })
    expect(getTokenCountFromTracker(tracker)).toBe(150)

    updateProgressFromMessage(tracker, {
      type: 'assistant',
      uuid: 'u1' as never,
      message: {
        id: 'resp-1',
        role: 'assistant',
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    } as never)

    // streamedTokenEstimateAtResponseStart (120) subtracted when resp-1 usage stamped
    expect(tracker.streamedTokenEstimate).toBe(30)
    expect(tracker.streamedTokenEstimateAtResponseStart).toBe(0)
    expect(tracker.lastStampedResponseId).toBe('resp-1')
    expect(getTokenCountFromTracker(tracker)).toBe(100 + 50 + 30)
  })

  test('updateProgressFromMessage deduplicates recentActivities by toolUseId', () => {
    const tracker = createProgressTracker()
    const msg = {
      type: 'assistant',
      uuid: 'u2' as never,
      message: {
        id: 'resp-2',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'Read',
            input: { file_path: 'a.ts' },
          },
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'Read',
            input: { file_path: 'a.ts' },
          },
        ],
      },
    } as never

    updateProgressFromMessage(tracker, msg)
    expect(tracker.recentActivities).toHaveLength(1)
  })

  test('P2-#13a: forfeitAllChatPins sets chatPinForfeited AND clears waitingNoticeRecipient on LocalAgentTask entries', () => {
    let state = {
      tasks: {
        a1: {
          id: 'a1',
          agentId: 'a1',
          type: 'local_agent',
          status: 'running',
          chatPinForfeited: false,
          waitingNoticeRecipient: 'main',
        },
        a2: {
          id: 'a2',
          agentId: 'a2',
          type: 'local_agent',
          status: 'running',
          chatPinForfeited: true,
          waitingNoticeRecipient: 'parent-1',
        },
      },
    }
    forfeitAllChatPins(
      ((updater: (prev: typeof state) => typeof state) => {
        state = updater(state)
      }) as never,
      50_000,
    )
    expect(state.tasks.a1.chatPinForfeited).toBe(true)
    expect(state.tasks.a1.waitingNoticeRecipient).toBeUndefined()
    expect(state.tasks.a2.waitingNoticeRecipient).toBeUndefined()
  })

  test('P2-#13a: clearAgentPermissionWaitsForAgent removes only the target agent permission waits', () => {
    const now = 100_000
    registerAgentPermissionWait(
      'sess-1',
      'req-1',
      'agent-A',
      'Bash',
      now - 40_000,
    )
    registerAgentPermissionWait(
      'sess-1',
      'req-2',
      'agent-B',
      'Write',
      now - 40_000,
    )

    const registry = {
      get: (id: string) => ({
        id,
        type: 'local_agent' as const,
        status: 'running' as const,
      }),
    }

    const before = getAgentAskNoticeAttachment(
      'sess-1',
      registry as never,
      [],
      [],
      now,
    )
    expect(before[0]?.open).toEqual(['req-1', 'req-2'])

    clearAgentPermissionWaitsForAgent('agent-A')
    const after = getAgentAskNoticeAttachment(
      'sess-1',
      registry as never,
      [],
      [],
      now,
    )
    expect(after[0]?.open).toEqual(['req-2'])
  })
})
