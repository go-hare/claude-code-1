import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  enqueue,
  getCommandQueue,
  remove,
  resetCommandQueue,
  settleScreening,
} from '../../messageQueueManager.js'
import { processQueueIfReady } from '../../queueProcessor.js'
import {
  recordPromptSubmitWait,
  resetPromptSubmitWaits,
  takePromptSubmitWait,
} from '../promptSubmitWaits.js'

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('densable 2.1.289 Gat/vZ/hss screeningPending', () => {
  test('hss take is once; missing uuid is undefined', async () => {
    const pending = recordPromptSubmitWait('u1', { kind: 'plugin' })
    const handle = takePromptSubmitWait('u1')
    expect(handle?.origin).toEqual({ kind: 'plugin' })
    expect(takePromptSubmitWait('u1')).toBeUndefined()
    expect(takePromptSubmitWait(undefined)).toBeUndefined()
    handle?.settle({ text: 'ok' })
    await expect(pending).resolves.toEqual({ text: 'ok' })
  })

  test('remove before run settles the waiter drop', async () => {
    const pending = recordPromptSubmitWait('u2')
    enqueue({
      value: 'hi',
      mode: 'prompt',
      uuid: 'u2',
    } as any)
    const [cmd] = getCommandQueue()
    remove([cmd!])
    await expect(pending).resolves.toEqual({
      drop: 'the prompt was removed from the queue before it ran',
    })
    resetPromptSubmitWaits()
  })

  test('Xe stamps promptSubmitted and clears screeningPending', () => {
    enqueue({
      value: 'hi',
      mode: 'prompt',
      uuid: 'u3',
      screeningPending: true,
    } as any)
    expect(
      settleScreening('u3', {
        promptSubmitted: {
          text: 'hi',
          under: {
            permissionMode: 'default',
            hooks: '',
            plugins: '',
            hooksSkippedByTrust: false,
          },
        },
      }),
    ).toBe(true)
    const [cmd] = getCommandQueue()
    expect(cmd?.screeningPending).toBeUndefined()
    expect(cmd?.promptSubmitted?.text).toBe('hi')
  })

  test('Xe dropped removes the pending command', () => {
    enqueue({
      value: 'bye',
      mode: 'prompt',
      uuid: 'u4',
      screeningPending: true,
    } as any)
    expect(settleScreening('u4', { dropped: true })).toBe(true)
    expect(getCommandQueue()).toHaveLength(0)
  })

  test('btt skips a screeningPending head', () => {
    enqueue({
      value: 'hold',
      mode: 'prompt',
      uuid: 'u5',
      screeningPending: true,
    } as any)
    const executed: string[] = []
    const result = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(...cmds.map(c => String(c.value)))
      },
    })
    expect(result.processed).toBe(false)
    expect(executed).toEqual([])
    expect(getCommandQueue()).toHaveLength(1)
  })

  test('btt stops a same-mode batch at screeningPending', () => {
    enqueue({ value: 'first', mode: 'prompt', uuid: 'a' } as any)
    enqueue({
      value: 'pending',
      mode: 'prompt',
      uuid: 'b',
      screeningPending: true,
    } as any)
    enqueue({ value: 'after', mode: 'prompt', uuid: 'c' } as any)
    const executed: string[][] = []
    const result = processQueueIfReady({
      executeInput: async cmds => {
        executed.push(cmds.map(c => String(c.value)))
      },
    })
    expect(result.processed).toBe(true)
    expect(executed).toEqual([['first']])
    expect(getCommandQueue().map(c => String(c.uuid))).toEqual(['b', 'c'])
  })
})
