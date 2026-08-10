import { describe, expect, test } from 'bun:test'
import { handleMessageFromStream } from '../messages.js'

describe('handleMessageFromStream densable yEt control surface', () => {
  const noopLength = () => {}
  const noopMode = () => {}
  const noopTools = () => {}

  test('dispatches control events without onMessage', () => {
    const received: string[] = []
    const onMessage = () => {
      received.push('message')
    }
    const yEt = {
      onNotification: () => {
        received.push('notification')
      },
      onConversationReset: (id: string) => {
        received.push(`reset:${id}`)
      },
      onInProgressToolUseIDs: (op: { action?: string }) => {
        received.push(`tools:${op.action ?? ''}`)
      },
      onExpandedView: () => {
        received.push('expanded')
      },
      onCommandLifecycle: (uuid: string, state: string) => {
        received.push(`cmd:${uuid}:${state}`)
      },
    }

    handleMessageFromStream(
      { type: 'notification', notification: { text: 'hi' } } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    handleMessageFromStream(
      {
        type: 'conversation_reset',
        newConversationId: 'cid-1',
      } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    handleMessageFromStream(
      {
        type: 'set_in_progress_tool_use_ids',
        op: { action: 'remove', ids: ['t1'] },
      } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    handleMessageFromStream(
      { type: 'set_expanded_view', expandedView: 'tasks' } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    handleMessageFromStream(
      {
        type: 'command_lifecycle',
        uuid: 'u1',
        state: 'started',
      } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    // densable: query_model_change returns without fan-out
    handleMessageFromStream(
      { type: 'query_model_change', toModel: 'x' } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    // densable: server_fallback / refusal_no_fallback dropped if leaked
    handleMessageFromStream(
      { type: 'server_fallback', fromModel: 'a', toModel: 'b' } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )
    handleMessageFromStream(
      { type: 'refusal_no_fallback', reason: 'not_armed' } as never,
      onMessage,
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      yEt,
    )

    expect(received).toEqual([
      'notification',
      'reset:cid-1',
      'tools:remove',
      'expanded',
      'cmd:u1:started',
    ])
  })

  test('refusal_continuation still uses onRefusalContinuation', () => {
    const phases: string[] = []
    handleMessageFromStream(
      {
        type: 'refusal_continuation',
        phase: 'begin',
        salvageText: 'x',
        join: 'exact',
      } as never,
      () => {
        phases.push('message')
      },
      noopLength,
      noopMode,
      noopTools,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      e => {
        phases.push(e.phase)
      },
    )
    expect(phases).toEqual(['begin'])
  })
})
