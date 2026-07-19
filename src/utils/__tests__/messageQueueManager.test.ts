import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildInterruptStillQueued,
  clearCommandQueue,
  consumeCancelPending,
  dequeue,
  dequeueAllMatching,
  enqueue,
  enqueuePendingNotification,
  hasCommandsInQueue,
  filterMidTurnQueuedCommands,
  getCommandQueueLength,
  hasMainThreadEditableQueuedCommand,
  isEditableQueuedOrigin,
  isFoldInFlight,
  isMainThreadPromptQueuedCommand,
  isMainThreadQueuedCommand,
  isQueuedCommandEditable,
  isQueuedCommandVisible,
  isSlashCommand,
  markCancelPending,
  peek,
  registerFoldInFlight,
  resetCommandQueue,
  unregisterFoldInFlight,
} from '../messageQueueManager.js'
import type { AgentId } from '../../types/ids.js'

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

describe('messageQueueManager cancelPending / foldInFlight densable', () => {
  test('markCancelPending + consumeCancelPending is one-shot', () => {
    markCancelPending('u1')
    expect(consumeCancelPending('u1')).toBe(true)
    expect(consumeCancelPending('u1')).toBe(false)
  })

  test('markCancelPending refresh keeps uuid without double-count', () => {
    markCancelPending('u2')
    markCancelPending('u2')
    expect(consumeCancelPending('u2')).toBe(true)
    expect(consumeCancelPending('u2')).toBe(false)
  })

  test('isFoldInFlight tracks register/unregister', () => {
    registerFoldInFlight([{ uuid: 'f1' as any }, { uuid: 'f2' as any }])
    expect(isFoldInFlight('f1')).toBe(true)
    expect(isFoldInFlight('f2')).toBe(true)
    expect(isFoldInFlight('missing')).toBe(false)
    unregisterFoldInFlight([{ uuid: 'f1' as any }])
    expect(isFoldInFlight('f1')).toBe(false)
    expect(isFoldInFlight('f2')).toBe(true)
  })

  test('resetCommandQueue clears cancel pending and fold sets', () => {
    markCancelPending('gone')
    registerFoldInFlight([{ uuid: 'fold-gone' as any }])
    resetCommandQueue()
    expect(consumeCancelPending('gone')).toBe(false)
    expect(isFoldInFlight('fold-gone')).toBe(false)
  })
})

describe('messageQueueManager.buildInterruptStillQueued densable j+Xtt', () => {
  test('returns empty when no in-flight batch and empty queue', () => {
    expect(buildInterruptStillQueued([])).toEqual([])
  })

  test('includes in-flight batch uuids first (densable j)', () => {
    expect(buildInterruptStillQueued(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('appends main-thread queued uuids after in-flight (Xtt filter AL)', () => {
    enqueue({
      value: 'q1',
      mode: 'prompt',
      uuid: 'queued-1' as any,
    } as any)
    enqueue({
      value: 'q2',
      mode: 'prompt',
      uuid: 'queued-2' as any,
    } as any)
    expect(buildInterruptStillQueued(['inflight-1'])).toEqual([
      'inflight-1',
      'queued-1',
      'queued-2',
    ])
  })

  test('skips subagent-addressed queue entries (agentId set)', () => {
    enqueue({
      value: 'main',
      mode: 'prompt',
      uuid: 'main-uuid' as any,
    } as any)
    enqueue({
      value: 'sub',
      mode: 'prompt',
      uuid: 'sub-uuid' as any,
      agentId: 'agent-xyz' as AgentId,
    } as any)
    expect(buildInterruptStillQueued([])).toEqual(['main-uuid'])
  })

  test('skips queue entries without uuid', () => {
    enqueue({ value: 'no-uuid', mode: 'prompt' } as any)
    enqueue({
      value: 'has-uuid',
      mode: 'prompt',
      uuid: 'only-this' as any,
    } as any)
    expect(buildInterruptStillQueued([])).toEqual(['only-this'])
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

describe('isEditableQueuedOrigin densable Mj', () => {
  test('true for undefined/null/human/auto-continuation', () => {
    expect(isEditableQueuedOrigin(undefined)).toBe(true)
    expect(isEditableQueuedOrigin(null)).toBe(true)
    expect(isEditableQueuedOrigin({ kind: 'human' })).toBe(true)
    expect(isEditableQueuedOrigin({ kind: 'auto-continuation' })).toBe(true)
  })

  test('false for non-editable origins', () => {
    expect(isEditableQueuedOrigin({ kind: 'agent' })).toBe(false)
    expect(isEditableQueuedOrigin({ kind: 'channel' })).toBe(false)
    expect(isEditableQueuedOrigin({ kind: 'task-notification' })).toBe(false)
    expect(isEditableQueuedOrigin({ kind: 'observer' })).toBe(false)
    expect(isEditableQueuedOrigin({ kind: 'peer' })).toBe(false)
    expect(isEditableQueuedOrigin({})).toBe(false)
  })
})

describe('isQueuedCommandEditable densable aJ', () => {
  test('true for prompt mode human keyboard (no origin)', () => {
    expect(
      isQueuedCommandEditable({ value: 'hi', mode: 'prompt' } as any),
    ).toBe(true)
  })

  test('true for human / auto-continuation origin on editable mode', () => {
    expect(
      isQueuedCommandEditable({
        value: 'hi',
        mode: 'prompt',
        origin: { kind: 'human' },
      } as any),
    ).toBe(true)
    expect(
      isQueuedCommandEditable({
        value: 'hi',
        mode: 'bash',
        origin: { kind: 'auto-continuation' },
      } as any),
    ).toBe(true)
  })

  test('false for task-notification mode (densable Srg/Trg)', () => {
    expect(
      isQueuedCommandEditable({
        value: '<task/>',
        mode: 'task-notification',
      } as any),
    ).toBe(false)
  })

  test('false when isMeta', () => {
    expect(
      isQueuedCommandEditable({
        value: 'sys',
        mode: 'prompt',
        isMeta: true,
      } as any),
    ).toBe(false)
  })

  test('false for agent/channel/peer origins even on prompt mode', () => {
    expect(
      isQueuedCommandEditable({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'agent' },
      } as any),
    ).toBe(false)
    expect(
      isQueuedCommandEditable({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'channel' },
      } as any),
    ).toBe(false)
    expect(
      isQueuedCommandEditable({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'peer' },
      } as any),
    ).toBe(false)
  })

  test('source anchors wire densable aJ shape', () => {
    const src = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(src).toContain('isEditableQueuedOrigin')
    expect(src).toContain('isPromptInputModeEditable(cmd.mode)')
    expect(src).toContain('!cmd.isMeta')
    expect(src).toContain('isEditableQueuedOrigin(origin)')
    expect(src).toContain("origin.kind === 'auto-continuation'")
  })
})

describe('isQueuedCommandVisible densable U4i/Rkb', () => {
  test('origin supersets always visible (even non-editable)', () => {
    for (const kind of [
      'channel',
      'task-notification',
      'auto-continuation',
      'observer',
    ] as const) {
      expect(
        isQueuedCommandVisible({
          value: 'x',
          mode: 'prompt',
          origin: { kind },
          isMeta: true,
        } as any),
      ).toBe(true)
    }
  })

  test('peer visible when senderTaskId set; else only with includePeers flag', () => {
    expect(
      isQueuedCommandVisible({
        value: 'p',
        mode: 'prompt',
        origin: { kind: 'peer', senderTaskId: 't1' },
      } as any),
    ).toBe(true)
    expect(
      isQueuedCommandVisible({
        value: 'p',
        mode: 'prompt',
        origin: { kind: 'peer' },
      } as any),
    ).toBe(false)
    expect(
      isQueuedCommandVisible(
        {
          value: 'p',
          mode: 'prompt',
          origin: { kind: 'peer' },
        } as any,
        true,
      ),
    ).toBe(true)
  })

  test('falls back to aJ for human / agent / bare prompt', () => {
    expect(
      isQueuedCommandVisible({ value: 'hi', mode: 'prompt' } as any),
    ).toBe(true)
    expect(
      isQueuedCommandVisible({
        value: 'hi',
        mode: 'prompt',
        origin: { kind: 'human' },
      } as any),
    ).toBe(true)
    expect(
      isQueuedCommandVisible({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'agent' },
      } as any),
    ).toBe(false)
    expect(
      isQueuedCommandVisible({
        value: 'x',
        mode: 'prompt',
        isMeta: true,
      } as any),
    ).toBe(false)
  })

  test('task-notification mode without origin is not auto-visible via kind (needs origin or aJ)', () => {
    // densable U4i checks origin.kind, not mode — mode-only task-notification
    // fails Srg so aJ is false; without origin kind, not visible.
    expect(
      isQueuedCommandVisible({
        value: '<task/>',
        mode: 'task-notification',
      } as any),
    ).toBe(false)
    expect(
      isQueuedCommandVisible({
        value: '<task/>',
        mode: 'task-notification',
        origin: { kind: 'task-notification' },
      } as any),
    ).toBe(true)
  })

  test('source anchors wire densable U4i origin kinds', () => {
    const src = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(src).toContain("kind === 'channel'")
    expect(src).toContain("kind === 'task-notification'")
    expect(src).toContain("kind === 'observer'")
    expect(src).toContain("kind === 'peer'")
    expect(src).toContain('senderTaskId')
    expect(src).toContain('includePeersWithoutSender')
    expect(src).toContain('return isQueuedCommandEditable(cmd)')
    expect(src).not.toContain("feature('KAIROS')")
  })
})

describe('REPL spinner queue length densable j4i', () => {
  test('getCommandQueueLength is full queue (official spinner gate)', () => {
    expect(getCommandQueueLength()).toBe(0)
    enqueue({ value: 'main', mode: 'prompt' } as any)
    enqueue({
      value: 'sub notif',
      mode: 'task-notification',
      agentId: 'agent-xyz' as AgentId,
    } as any)
    expect(getCommandQueueLength()).toBe(2)
  })

  test('REPL spinner wires official getCommandQueueLength', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('getCommandQueueLength() > 0')
    expect(repl).not.toContain('getMainThreadQueueLength')
    const src = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(src).not.toContain('export function getMainThreadQueueLength')
  })
})

describe('hasMainThreadEditableQueuedCommand densable D7c', () => {
  test('isMainThreadQueuedCommand is agentId undefined only (official AL)', () => {
    expect(isMainThreadQueuedCommand({ value: 'a', mode: 'prompt' } as any)).toBe(
      true,
    )
    // mi()/session id is NOT main — that stamp was a local bug (spinner stuck)
    const { getSessionId } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    expect(
      isMainThreadQueuedCommand({
        value: 'a',
        mode: 'task-notification',
        agentId: getSessionId() as any,
      } as any),
    ).toBe(false)
    expect(
      isMainThreadQueuedCommand({
        value: 'a',
        mode: 'prompt',
        agentId: 'agent-1' as any,
      } as any),
    ).toBe(false)
  })

  test('false when queue empty', () => {
    expect(hasMainThreadEditableQueuedCommand()).toBe(false)
  })

  test('true for main-thread human prompt', () => {
    enqueue({ value: 'hello', mode: 'prompt' } as any)
    expect(hasMainThreadEditableQueuedCommand()).toBe(true)
  })

  test('false for only task-notification / isMeta / agent-origin', () => {
    enqueuePendingNotification({
      value: '<task/>',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'meta', mode: 'prompt', isMeta: true } as any)
    enqueue({
      value: 'agent',
      mode: 'prompt',
      origin: { kind: 'agent' },
    } as any)
    expect(hasMainThreadEditableQueuedCommand()).toBe(false)
  })

  test('false when only subagent-addressed editable command', () => {
    enqueue({
      value: 'sub human',
      mode: 'prompt',
      agentId: 'agent-xyz' as AgentId,
    } as any)
    expect(hasMainThreadEditableQueuedCommand()).toBe(false)
  })

  test('true when main editable coexists with non-editable noise', () => {
    enqueuePendingNotification({
      value: '<task/>',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'main', mode: 'prompt' } as any)
    enqueue({
      value: 'sub',
      mode: 'prompt',
      agentId: 'agent-xyz' as AgentId,
    } as any)
    expect(hasMainThreadEditableQueuedCommand()).toBe(true)
  })

  test('source anchors D7c = AL && aJ + REPL wire', () => {
    const src = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(src).toContain('isMainThreadQueuedCommand(cmd)')
    expect(src).toContain('isQueuedCommandEditable(cmd)')
    expect(src).toContain('hasMainThreadEditableQueuedCommand')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('hasMainThreadEditableQueuedCommand')
    expect(repl).toContain('!hasMainThreadEditableQueuedCommand()')
  })
})

describe('isMainThreadPromptQueuedCommand densable Vzn', () => {
  test('true only for main-thread prompt mode', () => {
    expect(
      isMainThreadPromptQueuedCommand({ value: 'hi', mode: 'prompt' } as any),
    ).toBe(true)
    expect(
      isMainThreadPromptQueuedCommand({ value: 'b', mode: 'bash' } as any),
    ).toBe(false)
    expect(
      isMainThreadPromptQueuedCommand({
        value: 't',
        mode: 'task-notification',
      } as any),
    ).toBe(false)
    expect(
      isMainThreadPromptQueuedCommand({
        value: 'sub',
        mode: 'prompt',
        agentId: 'agent-1' as AgentId,
      } as any),
    ).toBe(false)
  })

  test('source anchors densable Vzn = AL && mode prompt', () => {
    const src = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(src).toContain('isMainThreadPromptQueuedCommand')
    expect(src).toContain("cmd.mode === 'prompt'")
    expect(src).toContain('densable Vzn')
  })
})

describe('filterMidTurnQueuedCommands densable k7c', () => {
  const mainPrompt = { value: 'hi', mode: 'prompt' as const }
  const mainSlash = { value: '/help', mode: 'prompt' as const }
  const mainTask = {
    value: '<task/>',
    mode: 'task-notification' as const,
  }
  const subTask = {
    value: '<task/>',
    mode: 'task-notification' as const,
    agentId: 'agent-1' as AgentId,
  }
  const subPrompt = {
    value: 'sub',
    mode: 'prompt' as const,
    agentId: 'agent-1' as AgentId,
  }
  const otherSubTask = {
    value: '<task/>',
    mode: 'task-notification' as const,
    agentId: 'agent-2' as AgentId,
  }
  const skipSlash = {
    value: '/proactive',
    mode: 'prompt' as const,
    skipSlashCommands: true,
  }

  test('main thread: keeps AL non-slash, drops slash and subagent', () => {
    const out = filterMidTurnQueuedCommands(
      [mainPrompt, mainSlash, mainTask, subTask, subPrompt, skipSlash] as any,
      { isMainThread: true },
    )
    expect(out.map(c => c.value)).toEqual(['hi', '<task/>', '/proactive'])
  })

  test('subagent: only matching task-notification, never prompts', () => {
    const out = filterMidTurnQueuedCommands(
      [mainPrompt, mainTask, subTask, subPrompt, otherSubTask] as any,
      { isMainThread: false, currentAgentId: 'agent-1' as AgentId },
    )
    expect(out).toHaveLength(1)
    // agentId is branded AgentId; string compare via String() for dig-path tsc
    expect(String(out[0]!.agentId)).toBe('agent-1')
    expect(out[0]!.mode).toBe('task-notification')
  })

  test('bridgeOrigin slash still excluded as slash (not mid-turn folded as text)', () => {
    const out = filterMidTurnQueuedCommands(
      [
        {
          value: '/model',
          mode: 'prompt',
          skipSlashCommands: true,
          bridgeOrigin: true,
        },
      ] as any,
      { isMainThread: true },
    )
    // isSlashCommand true when bridgeOrigin — densable Erg only checks !skipSlash;
    // local bridge extension still treats as slash and drops from mid-turn.
    expect(out).toHaveLength(0)
  })

  test('source anchors k7c + query.ts wire', () => {
    const src = readFileSync(
      join(import.meta.dir, '../messageQueueManager.ts'),
      'utf8',
    )
    expect(src).toContain('filterMidTurnQueuedCommands')
    expect(src).toContain('isSlashCommand(cmd)')
    expect(src).toContain("cmd.mode === 'task-notification'")
    const query = readFileSync(
      join(import.meta.dir, '../../query.ts'),
      'utf8',
    )
    expect(query).toContain('filterMidTurnQueuedCommands')
    expect(query).toContain(
      'getCommandsByMaxPriority(sleepRan ? \'later\' : \'next\')',
    )
  })
})
