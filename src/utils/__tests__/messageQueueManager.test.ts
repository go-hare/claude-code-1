import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearCommandQueue,
  dequeue,
  dequeueAllMatching,
  enqueue,
  enqueuePendingNotification,
  hasCommandsInQueue,
  isQueuedCommandEditable,
  isQueuedCommandVisible,
  isSlashCommand,
  peek,
  resetCommandQueue,
} from '../messageQueueManager.js'

// Reset module-level queue state between tests
beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('messageQueueManager.isSlashCommand', () => {
  test('treats normal slash commands as slash commands', () => {
    expect(isSlashCommand({ value: '/help', mode: 'prompt' } as any)).toBe(true)
  })

  test('keeps remote bridge slash commands slash-routed when bridgeOrigin is set', () => {
    expect(
      isSlashCommand({
        value: '/proactive',
        mode: 'prompt',
        skipSlashCommands: true,
        bridgeOrigin: true,
      } as any),
    ).toBe(true)
  })

  test('keeps skipSlashCommands text-only when bridgeOrigin is absent', () => {
    expect(
      isSlashCommand({
        value: '/proactive',
        mode: 'prompt',
        skipSlashCommands: true,
      } as any),
    ).toBe(false)
  })
})

describe('messageQueueManager.enqueue', () => {
  test('adds command to queue with default next priority', () => {
    enqueue({ value: 'hello', mode: 'prompt' } as any)
    expect(hasCommandsInQueue()).toBe(true)
    const cmd = dequeue()
    expect(cmd).toBeDefined()
    expect(cmd!.value).toBe('hello')
    expect(cmd!.priority).toBe('next')
  })

  test('preserves explicit priority', () => {
    enqueue({ value: 'urgent', mode: 'prompt', priority: 'now' } as any)
    const cmd = dequeue()
    expect(cmd!.priority).toBe('now')
  })

  test('stamps sticky main-thread agentId so AL still matches after session regenerate', () => {
    const {
      getMainThreadAgentId,
      isMainThreadQueuedCommand,
      regenerateSessionId,
    } =
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')

    const mainAgentIdBefore = getMainThreadAgentId()
    enqueue({ value: 'survive-clear', mode: 'prompt' } as any)
    const sessionAfter = regenerateSessionId()
    expect(sessionAfter).not.toBe(
      mainAgentIdBefore as unknown as typeof sessionAfter,
    )
    // sticky mainAgentId — no queue rewrite needed (densable 2.1.211)
    expect(getMainThreadAgentId()).toBe(mainAgentIdBefore)
    const cmd = dequeue(isMainThreadQueuedCommand)
    expect(cmd).toBeDefined()
    expect(cmd!.value).toBe('survive-clear')
    expect(cmd!.agentId).toBe(mainAgentIdBefore)
  })
})

describe('messageQueueManager.enqueuePendingNotification', () => {
  test('adds command with later priority', () => {
    enqueuePendingNotification({
      value: '<task-notification/>',
      mode: 'task-notification',
    } as any)
    const cmd = dequeue()
    expect(cmd).toBeDefined()
    expect(cmd!.priority).toBe('later')
    expect(cmd!.mode).toBe('task-notification')
  })
})

describe('messageQueueManager.dequeue', () => {
  test('returns undefined when queue empty', () => {
    expect(dequeue()).toBeUndefined()
  })

  test('returns highest priority command', () => {
    enqueuePendingNotification({
      value: 'later-cmd',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next-cmd', mode: 'prompt' } as any)
    enqueue({ value: 'now-cmd', mode: 'prompt', priority: 'now' } as any)

    const first = dequeue()
    expect(first!.value).toBe('now-cmd')

    const second = dequeue()
    expect(second!.value).toBe('next-cmd')

    const third = dequeue()
    expect(third!.value).toBe('later-cmd')
  })

  test('FIFO within same priority', () => {
    enqueue({ value: 'first', mode: 'prompt' } as any)
    enqueue({ value: 'second', mode: 'prompt' } as any)

    expect(dequeue()!.value).toBe('first')
    expect(dequeue()!.value).toBe('second')
  })

  test('respects filter parameter', () => {
    enqueue({ value: 'prompt-cmd', mode: 'prompt' } as any)
    enqueuePendingNotification({
      value: 'task-cmd',
      mode: 'task-notification',
    } as any)

    // Filter to only task-notification commands
    const cmd = dequeue(c => c.mode === 'task-notification')
    expect(cmd).toBeDefined()
    expect(cmd!.value).toBe('task-cmd')

    // Prompt command should still be in queue
    expect(hasCommandsInQueue()).toBe(true)
    expect(dequeue()!.value).toBe('prompt-cmd')
  })
})

describe('messageQueueManager.peek', () => {
  test('returns undefined when queue empty', () => {
    expect(peek()).toBeUndefined()
  })

  test('returns highest priority without removing', () => {
    enqueuePendingNotification({
      value: 'later',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next', mode: 'prompt' } as any)

    expect(peek()!.value).toBe('next')
    expect(hasCommandsInQueue()).toBe(true)
    expect(dequeue()!.value).toBe('next')
  })
})

describe('messageQueueManager.dequeueAllMatching', () => {
  test('removes all matching commands', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    enqueue({ value: 'b', mode: 'task-notification' } as any)
    enqueue({ value: 'c', mode: 'task-notification' } as any)

    const matched = dequeueAllMatching(c => c.mode === 'task-notification')
    expect(matched).toHaveLength(2)
    expect(matched.map(c => c.value)).toEqual(['b', 'c'])

    // Remaining command should still be in queue
    expect(dequeue()!.value).toBe('a')
  })

  test('returns empty array when no matches', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    const matched = dequeueAllMatching(c => c.mode === 'bash')
    expect(matched).toHaveLength(0)
    expect(hasCommandsInQueue()).toBe(true)
  })

  test('returns empty array when queue empty', () => {
    const matched = dequeueAllMatching(() => true)
    expect(matched).toHaveLength(0)
  })
})

describe('messageQueueManager.clearCommandQueue', () => {
  test('removes all commands', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    enqueue({ value: 'b', mode: 'prompt' } as any)
    expect(hasCommandsInQueue()).toBe(true)

    clearCommandQueue()
    expect(hasCommandsInQueue()).toBe(false)
  })

  test('no-op on empty queue', () => {
    clearCommandQueue()
    expect(hasCommandsInQueue()).toBe(false)
  })
})

describe('messageQueueManager priority ordering', () => {
  test('now dequeued before next and later', () => {
    enqueuePendingNotification({
      value: 'later',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next', mode: 'prompt' } as any)
    enqueue({ value: 'now', mode: 'prompt', priority: 'now' } as any)

    expect(dequeue()!.value).toBe('now')
    expect(dequeue()!.value).toBe('next')
    expect(dequeue()!.value).toBe('later')
  })

  test('next dequeued before later', () => {
    enqueuePendingNotification({
      value: 'later',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next', mode: 'prompt' } as any)

    expect(dequeue()!.value).toBe('next')
    expect(dequeue()!.value).toBe('later')
  })
})

describe('messageQueueManager isQueuedCommandEditable/Visible (densable aJ/U4i)', () => {
  test('human prompt is editable and visible', () => {
    const cmd = { value: 'hi', mode: 'prompt' as const }
    expect(isQueuedCommandEditable(cmd as any)).toBe(true)
    expect(isQueuedCommandVisible(cmd as any)).toBe(true)
  })

  test('meta prompt is not editable', () => {
    const cmd = { value: 'tick', mode: 'prompt' as const, isMeta: true }
    expect(isQueuedCommandEditable(cmd as any)).toBe(false)
  })

  test('peer without senderTaskId is not editable or visible without force', () => {
    const cmd = {
      value: 'from peer',
      mode: 'prompt' as const,
      origin: { kind: 'peer' as const },
    }
    expect(isQueuedCommandEditable(cmd as any)).toBe(false)
    expect(isQueuedCommandVisible(cmd as any)).toBe(false)
    expect(isQueuedCommandVisible(cmd as any, true)).toBe(true)
  })

  test('peer with senderTaskId is visible but not editable', () => {
    const cmd = {
      value: 'from peer',
      mode: 'prompt' as const,
      origin: { kind: 'peer' as const, senderTaskId: 't1' },
    }
    expect(isQueuedCommandEditable(cmd as any)).toBe(false)
    expect(isQueuedCommandVisible(cmd as any)).toBe(true)
  })

  test('channel / task-notification / observer are visible, not editable', () => {
    for (const kind of ['channel', 'task-notification', 'observer'] as const) {
      const cmd = {
        value: kind,
        mode: 'prompt' as const,
        origin: { kind },
        isMeta: true,
      }
      expect(isQueuedCommandEditable(cmd as any)).toBe(false)
      expect(isQueuedCommandVisible(cmd as any)).toBe(true)
    }
  })
})
