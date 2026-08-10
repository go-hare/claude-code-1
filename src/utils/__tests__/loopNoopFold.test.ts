import { describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'crypto'

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

import type { Message } from '../../types/message.js'
import { SCHEDULE_WAKEUP_TOOL_NAME } from '@claude-code/builtin-tools/tools/ScheduleWakeupTool/constants.js'
import {
  analyzeLoopNoopSpan,
  appendLoopWakeupMessages,
  createLoopHealthyMetaMessage,
  createLoopScheduledTaskFireMessage,
  filterFoldedLoopNoopMessages,
  isBlockingSystemMessage,
  isLoopScheduledTaskFire,
} from '../loopNoopFold.js'

function fireMsg(
  overrides: Partial<Message> & { content?: string } = {},
): Message {
  return {
    type: 'system',
    subtype: 'scheduled_task_fire',
    content: overrides.content ?? 'Claude resuming /loop wakeup',
    isMeta: false,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    uuid: (overrides.uuid as string) ?? randomUUID(),
    cronKind: 'loop',
    ...overrides,
  } as Message
}

function assistantWithScheduleWakeup(noop: boolean, toolId = 'tu_1'): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: SCHEDULE_WAKEUP_TOOL_NAME,
          input: { delaySeconds: 120, prompt: 'x', noop },
        },
      ],
    },
  } as Message
}

function toolResultUser(toolUseId: string): Message {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'ok',
        },
      ],
    },
  } as Message
}

function plainUser(text: string): Message {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: text,
    },
  } as Message
}

describe('isLoopScheduledTaskFire / isBlockingSystemMessage', () => {
  test('detects loop fire anchors', () => {
    expect(isLoopScheduledTaskFire(fireMsg())).toBe(true)
    expect(
      isLoopScheduledTaskFire(
        fireMsg({ cronKind: undefined } as Partial<Message>),
      ),
    ).toBe(false)
    expect(
      isLoopScheduledTaskFire({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: randomUUID(),
      } as Message),
    ).toBe(false)
  })

  test('blocking system messages include fire and compact', () => {
    expect(isBlockingSystemMessage(fireMsg())).toBe(true)
    expect(
      isBlockingSystemMessage({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: randomUUID(),
      } as Message),
    ).toBe(true)
    expect(
      isBlockingSystemMessage({
        type: 'system',
        subtype: 'bridge_status',
        uuid: randomUUID(),
      } as Message),
    ).toBe(false)
  })
})

describe('analyzeLoopNoopSpan', () => {
  test('none when no loop fire anchor', () => {
    expect(analyzeLoopNoopSpan([plainUser('hi')])).toEqual({ kind: 'none' })
  })

  test('fold when ScheduleWakeup noop:true only', () => {
    const fire = fireMsg({
      noOpStreak: 2,
      streakStartedAt: '2026-01-01T00:00:00.000Z',
    })
    const asst = assistantWithScheduleWakeup(true, 'tu_ok')
    const tr = toolResultUser('tu_ok')
    const decision = analyzeLoopNoopSpan([fire, asst, tr])
    expect(decision.kind).toBe('fold')
    if (decision.kind === 'fold') {
      expect(decision.priorStreak).toBe(2)
      expect(decision.since).toBe('2026-01-01T00:00:00.000Z')
      expect(decision.toolUseCount).toBe(1)
    }
  })

  test('veto model_reported_work when noop missing/false', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(false)
    const decision = analyzeLoopNoopSpan([fire, asst, toolResultUser('tu_1')])
    expect(decision).toMatchObject({
      kind: 'veto',
      reason: 'model_reported_work',
    })
  })

  test('veto foreign_user_input on real user text', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(true)
    const decision = analyzeLoopNoopSpan([
      fire,
      asst,
      toolResultUser('tu_1'),
      plainUser('please stop'),
    ])
    expect(decision).toMatchObject({
      kind: 'veto',
      reason: 'foreign_user_input',
    })
  })

  test('veto tool_abort on interrupted denial', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(true)
    const denied = {
      ...toolResultUser('tu_1'),
      toolDenialKind: 'interrupted',
    } as Message
    const decision = analyzeLoopNoopSpan([fire, asst, denied])
    expect(decision).toMatchObject({ kind: 'veto', reason: 'tool_abort' })
  })

  test('veto split_tool_pair when result id unknown', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(true, 'tu_a')
    const decision = analyzeLoopNoopSpan([
      fire,
      asst,
      toolResultUser('tu_foreign'),
    ])
    expect(decision).toMatchObject({ kind: 'veto', reason: 'split_tool_pair' })
  })

  test('veto queued_command attachment', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(true)
    const att = {
      type: 'attachment',
      uuid: randomUUID(),
      attachment: { type: 'queued_command' },
    } as Message
    const decision = analyzeLoopNoopSpan([
      fire,
      asst,
      toolResultUser('tu_1'),
      att,
    ])
    expect(decision).toMatchObject({ kind: 'veto', reason: 'queued_command' })
  })

  test('veto blocking_system_in_span', () => {
    const fire = fireMsg()
    const compact = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: randomUUID(),
    } as Message
    const decision = analyzeLoopNoopSpan([fire, compact])
    expect(decision).toMatchObject({
      kind: 'veto',
      reason: 'blocking_system_in_span',
    })
  })
})

describe('appendLoopWakeupMessages', () => {
  test('non-idle skips fold analysis but still stamps cronKind loop', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(true)
    const prev = [fire, asst, toolResultUser('tu_1')]
    const next = appendLoopWakeupMessages(prev, false)
    expect(next).toHaveLength(prev.length + 1)
    const last = next.at(-1)!
    expect(last.subtype).toBe('scheduled_task_fire')
    // Anchor for a later idle fold — do not leave mid-stream fires untagged.
    expect(last.cronKind).toBe('loop')
    expect(last.foldedUuids).toBeUndefined()
    expect(last.noOpStreak).toBeUndefined()
  })

  test('idle fold appends streak label + healthy meta', () => {
    const fire = fireMsg({
      noOpStreak: 0,
      timestamp: '2026-06-01T12:00:00.000Z',
    })
    const asst = assistantWithScheduleWakeup(true)
    const prev = [fire, asst, toolResultUser('tu_1')]
    const next = appendLoopWakeupMessages(prev, true)
    expect(next).toHaveLength(prev.length + 2)
    const fireLine = next[next.length - 2]!
    const meta = next[next.length - 1]!
    expect(fireLine.subtype).toBe('scheduled_task_fire')
    expect(fireLine.cronKind).toBe('loop')
    expect(fireLine.noOpStreak).toBe(1)
    expect(Array.isArray(fireLine.foldedUuids)).toBe(true)
    expect((fireLine.foldedUuids as string[]).length).toBe(3)
    expect(String(fireLine.content)).toContain('1 no-op tick')
    expect(meta.type).toBe('user')
    expect(meta.isMeta).toBe(true)
    expect(
      String((meta.message as { content?: string }).content ?? ''),
    ).toContain('1 prior /loop wakeup')
  })

  test('idle veto still appends cronKind loop fire without fold', () => {
    const fire = fireMsg()
    const asst = assistantWithScheduleWakeup(false)
    const prev = [fire, asst, toolResultUser('tu_1')]
    const next = appendLoopWakeupMessages(prev, true)
    expect(next).toHaveLength(prev.length + 1)
    const last = next.at(-1)!
    expect(last.cronKind).toBe('loop')
    expect(last.foldedUuids).toBeUndefined()
    expect(last.noOpStreak).toBeUndefined()
  })

  test('non-idle fire still anchors a subsequent idle fold', () => {
    // Mid-stream fire stamps cronKind even without folding, so the next
    // idle wakeup can fold the span that starts at that anchor.
    const midStream = appendLoopWakeupMessages([], false)
    expect(midStream).toHaveLength(1)
    expect(midStream[0]!.cronKind).toBe('loop')

    const asst = assistantWithScheduleWakeup(true, 'tu_mid')
    const span = [...midStream, asst, toolResultUser('tu_mid')]
    const next = appendLoopWakeupMessages(span, true)
    expect(next).toHaveLength(span.length + 2)
    const fireLine = next[next.length - 2]!
    expect(fireLine.noOpStreak).toBe(1)
    expect((fireLine.foldedUuids as string[]).length).toBe(3)
  })
})

describe('filterFoldedLoopNoopMessages', () => {
  test('drops uuids listed in foldedUuids', () => {
    const a = fireMsg({ uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
    const b = {
      type: 'assistant',
      uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    } as Message
    const c = createLoopScheduledTaskFireMessage('fold line', {
      cronKind: 'loop',
      noOpStreak: 1,
      streakStartedAt: a.timestamp as string,
      foldedUuids: [
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ],
    })
    const filtered = filterFoldedLoopNoopMessages([a, b, c])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.uuid).toBe(c.uuid)
  })

  test('identity when no foldedUuids present', () => {
    const msgs = [fireMsg(), plainUser('x')]
    expect(filterFoldedLoopNoopMessages(msgs)).toBe(msgs)
  })
})

describe('createLoopHealthyMetaMessage', () => {
  test('pluralizes wakeups', () => {
    const one = createLoopHealthyMetaMessage(1)
    const many = createLoopHealthyMetaMessage(3)
    expect(String((one.message as { content?: string }).content)).toContain(
      '1 prior /loop wakeup found nothing',
    )
    expect(String((many.message as { content?: string }).content)).toContain(
      '3 prior /loop wakeups found nothing',
    )
  })
})
