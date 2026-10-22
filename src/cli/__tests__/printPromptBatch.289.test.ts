import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  canBatchWith,
  isPrintQueueableCommand,
  joinPromptValues,
  mergeQueuedPromptCommands,
} from '../printPromptBatch.js'
import {
  enqueue,
  peek,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'

function prompt(opts: Partial<QueuedCommand> = {}): QueuedCommand {
  return {
    value: 'hi',
    mode: 'prompt',
    isMeta: false,
    ...opts,
  }
}

describe('densable 2.1.289 print Ph / $c / Uf', () => {
  beforeEach(() => {
    resetCommandQueue()
  })
  afterEach(() => {
    resetCommandQueue()
  })

  test('Uf: peek skips passive main-thread rows', () => {
    enqueue(prompt({ value: 'passive', passive: true }))
    enqueue(prompt({ value: 'active' }))
    expect(peek(isPrintQueueableCommand)?.value).toBe('active')
  })

  test('Ph: same mode/workload/isMeta still refuse mismatched shouldQuery / wakeup / origin', () => {
    const head = prompt({ workload: 'w', shouldQuery: true })
    expect(
      canBatchWith(head, prompt({ workload: 'w', shouldQuery: false })),
    ).toBe(false)
    expect(
      canBatchWith(
        head,
        prompt({ workload: 'w', wakeupSource: 'loop_wakeup' }),
      ),
    ).toBe(false)
    expect(
      canBatchWith(
        prompt({ origin: { kind: 'peer', from: 'a' } }),
        prompt({ origin: { kind: 'peer', from: 'b' } }),
      ),
    ).toBe(false)
  })

  test('Ph: slash-looking and artifact-comment values do not batch', () => {
    expect(canBatchWith(prompt({ value: '/help' }), prompt())).toBe(false)
    expect(
      canBatchWith(
        prompt({ value: '[Artifact comment sent to Claude]\nbody' }),
        prompt(),
      ),
    ).toBe(false)
  })

  test('$c merges value + uuid + attachments + traces + ccrTurnId', () => {
    const merged = mergeQueuedPromptCommands([
      prompt({
        value: 'a',
        uuid: '00000000-0000-4000-8000-000000000001' as QueuedCommand['uuid'],
        fileAttachments: ['x'],
        traceContext: {
          traceparent:
            '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        },
        ccrTurnId: 't1',
      }),
      prompt({
        value: 'b',
        uuid: '00000000-0000-4000-8000-000000000002' as QueuedCommand['uuid'],
        fileAttachments: ['y'],
        traceContext: {
          traceparent:
            '00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01',
        },
        ccrTurnId: 't1',
        stampThreadState: true,
      }),
    ])
    expect(merged.value).toBe('a\nb')
    expect(merged.uuid).toBe('00000000-0000-4000-8000-000000000002')
    expect(merged.fileAttachments).toEqual(['x', 'y'])
    expect(merged.ccrTurnId).toBe('t1')
    expect(merged.stampThreadState).toBe(true)
    expect(merged.traceContext?.traceparent).toContain('cccc')
    expect(merged.linkedTraceContexts?.[0]?.traceparent).toContain('aaaa')
    expect(merged.attachmentSourceUuid).toBeUndefined()
    expect(merged.deliveryId).toBeUndefined()
  })

  test('LP joins mixed string/blocks', () => {
    expect(joinPromptValues(['a', 'b'])).toBe('a\nb')
    expect(joinPromptValues(['a', [{ type: 'text', text: 'b' }]])).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])
  })
})
