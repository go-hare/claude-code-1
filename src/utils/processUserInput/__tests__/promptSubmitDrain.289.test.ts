import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  consume,
  enqueue,
  getCommandQueue,
  remove,
  resetCommandQueue,
  subscribeCommandsConsumed,
  subscribeCommandsDiscarded,
} from '../../messageQueueManager.js'
import {
  keepQueuedCommandsUntilFirstDroppedPrompt,
  queuedCommandDropsForChangedScreen,
  type PromptScreen,
} from '../promptSubmit.js'
import {
  beginSessionStartLatch,
  isAheadOfSessionStart,
  markAheadOfSessionStart,
} from '../promptSubmitEntries.js'
import {
  batchPromptSubmitWaitGuard,
  EARLIER_PROMPT_IN_BATCH_FAILED,
  recordPromptSubmitWait,
} from '../promptSubmitWaits.js'
import {
  COMMAND_LEFT_QUEUE_AS_TEXT,
  COMMAND_REMOVED_BEFORE_RUN,
  COMMAND_RUN_DID_NOT_RUN,
  recordCommandRunWait,
  takeCommandRunWait,
  wrapCommandRunWait,
} from '../commandRunWaits.js'
import {
  isTurnHookQueuedPrompt,
  markTurnHookQueuedPrompt,
  resetTurnHookQueuedPrompts,
} from '../turnHookQueuedPrompts.js'
import type { QueuedCommand } from '../../../types/textInputTypes.js'

const screen = (over: Partial<PromptScreen> = {}): PromptScreen => ({
  permissionMode: 'default',
  hooks: 'UserPromptSubmit',
  plugins: '',
  hooksSkippedByTrust: false,
  ...over,
})

const prompt = (
  over: Partial<QueuedCommand> & { value: string },
): QueuedCommand =>
  ({
    mode: 'prompt',
    ...over,
  }) as QueuedCommand

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
  resetTurnHookQueuedPrompts()
})

describe('densable 2.1.289 mp/zl', () => {
  test('mp drops drainOnly and screeningPending; keeps unstamped', () => {
    const read = () => screen()
    expect(
      queuedCommandDropsForChangedScreen(
        prompt({ value: 'a', drainOnly: true }),
        read,
      ),
    ).toBe(true)
    expect(
      queuedCommandDropsForChangedScreen(
        prompt({ value: 'b', screeningPending: true }),
        read,
      ),
    ).toBe(true)
    expect(
      queuedCommandDropsForChangedScreen(prompt({ value: 'c' }), read),
    ).toBe(false)
  })

  test('zl keeps until first dropped prompt then drops later prompts', () => {
    const same = screen()
    const keep = keepQueuedCommandsUntilFirstDroppedPrompt(() => same)
    const stamped = {
      text: 'hi',
      under: same,
    }
    expect(keep(prompt({ value: 'keep', promptSubmitted: stamped }))).toBe(true)
    expect(
      keep(
        prompt({
          value: 'drop',
          promptSubmitted: { text: 'x', under: screen({ hooks: '' }) },
        }),
      ),
    ).toBe(false)
    expect(keep(prompt({ value: 'later' }))).toBe(false)
  })
})

describe('densable 2.1.289 mss/Bat', () => {
  test('dispose drops waiters Art did not take', async () => {
    const pending = recordPromptSubmitWait('u-batch')
    {
      using _guard = batchPromptSubmitWaitGuard([{ uuid: 'u-batch' }])
    }
    await expect(pending).resolves.toEqual({
      drop: EARLIER_PROMPT_IN_BATCH_FAILED,
    })
  })
})

describe('densable 2.1.289 Loe/Noe', () => {
  test('Loe marks only with latch and session.start', () => {
    markAheadOfSessionStart('a')
    expect(isAheadOfSessionStart('a')).toBe(false)
    const latch = beginSessionStartLatch()
    markAheadOfSessionStart('b', 'turn.start')
    expect(isAheadOfSessionStart('b')).toBe(false)
    markAheadOfSessionStart('c', 'session.start')
    expect(isAheadOfSessionStart('c')).toBe(true)
    markAheadOfSessionStart('d')
    expect(isAheadOfSessionStart('d')).toBe(true)
    latch.complete()
  })

  test('Noe marks only turn.start/complete and prunes missing uuids', () => {
    markTurnHookQueuedPrompt('old', 'turn.start', [{ uuid: 'old' }])
    expect(isTurnHookQueuedPrompt('old')).toBe(true)
    markTurnHookQueuedPrompt('fresh', 'turn.start', [{ uuid: 'fresh' }])
    expect(isTurnHookQueuedPrompt('old')).toBe(false)
    expect(isTurnHookQueuedPrompt('fresh')).toBe(true)
    markTurnHookQueuedPrompt('skip', 'prompt.submit', [{ uuid: 'skip' }])
    expect(isTurnHookQueuedPrompt('skip')).toBe(false)
  })
})

describe('densable 2.1.289 ir/os command.run waits', () => {
  const consumeId = '00000000-0000-4000-8000-0000000000c1'
  const removeId = '00000000-0000-4000-8000-0000000000d1'

  test('consume emits consumed and fails left-as-text', async () => {
    const pending = recordCommandRunWait(consumeId)
    enqueue({
      value: '/ship',
      mode: 'prompt',
      uuid: consumeId,
    } as QueuedCommand)
    const consumed: QueuedCommand[][] = []
    const unsub = subscribeCommandsConsumed(cmds => {
      consumed.push(cmds)
    })
    const [cmd] = getCommandQueue()
    consume([cmd!])
    unsub()
    expect(getCommandQueue()).toEqual([])
    expect(consumed[0]?.[0]?.uuid).toBe(consumeId)
    await expect(pending).rejects.toThrow(COMMAND_LEFT_QUEUE_AS_TEXT)
  })

  test('remove emits discarded and fails removed-before-run', async () => {
    const pending = recordCommandRunWait(removeId)
    enqueue({
      value: '/ship',
      mode: 'prompt',
      uuid: removeId,
    } as QueuedCommand)
    const discarded: QueuedCommand[][] = []
    const unsub = subscribeCommandsDiscarded(cmds => {
      discarded.push(cmds)
    })
    const [cmd] = getCommandQueue()
    remove([cmd!])
    unsub()
    expect(discarded[0]?.[0]?.uuid).toBe(removeId)
    await expect(pending).rejects.toThrow(COMMAND_REMOVED_BEFORE_RUN)
  })

  test('Ess dispose fails Oat when never settled', async () => {
    const pending = recordCommandRunWait('u-ess')
    {
      using _run = wrapCommandRunWait(takeCommandRunWait('u-ess'))
    }
    await expect(pending).rejects.toThrow(COMMAND_RUN_DID_NOT_RUN)
  })
})
