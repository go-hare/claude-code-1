import { describe, expect, test } from 'bun:test'
import { asAgentId } from '../../types/ids.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  PRINT_TASK_NOTIFICATION_COALESCE_CHAR_BUDGET,
  canCoalesceTaskNotificationWithFollower,
  createPrintTaskNotificationCoalesceState,
  extractFirstXmlTag,
  isCoalescableTaskNotificationCommand,
  shouldHoldQueryForTaskNotificationFollower,
} from '../printTaskNotificationCoalesce.js'

function notification(opts: Partial<QueuedCommand> = {}): QueuedCommand {
  const body = `<task-notification>
<task-id>t1</task-id>
<status>completed</status>
<summary>done</summary>
</task-notification>`
  return {
    value: body,
    mode: 'task-notification',
    taskId: 't1',
    isMeta: true,
    priority: 'next',
    ...opts,
  }
}

describe('densable 2.1.289 print task-notification coalesce helpers', () => {
  test('isCoalescableTaskNotificationCommand accepts LocalAgentTask-shaped entries', () => {
    expect(isCoalescableTaskNotificationCommand(notification())).toBe(true)
  })

  test('isCoalescableTaskNotificationCommand rejects uuid / shouldQuery false / bad wrap', () => {
    expect(
      isCoalescableTaskNotificationCommand(
        notification({ uuid: 'u1' as QueuedCommand['uuid'] }),
      ),
    ).toBe(false)
    expect(
      isCoalescableTaskNotificationCommand(
        notification({ shouldQuery: false }),
      ),
    ).toBe(false)
    expect(
      isCoalescableTaskNotificationCommand(
        notification({
          value: '<task-notification>no status</task-notification>',
        }),
      ),
    ).toBe(false)
    expect(
      isCoalescableTaskNotificationCommand(
        notification({
          value: `${notification().value}\n<task-notification><status>x</status></task-notification>`,
        }),
      ),
    ).toBe(false)
    expect(
      isCoalescableTaskNotificationCommand(
        notification({ origin: { kind: 'agent' } }),
      ),
    ).toBe(false)
    expect(
      isCoalescableTaskNotificationCommand(
        notification({
          value:
            '<task-notification>\n<summary>see <status> in docs</summary>\n</task-notification>',
        }),
      ),
    ).toBe(false)
  })

  test('extractFirstXmlTag requires a balanced status tag, not a substring', () => {
    expect(extractFirstXmlTag('<status>completed</status>', 'status')).toBe(
      'completed',
    )
    expect(extractFirstXmlTag('see <status> in the summary', 'status')).toBe(
      null,
    )
    expect(extractFirstXmlTag('<status></status>', 'status')).toBe('')
  })

  test('canCoalesceTaskNotificationWithFollower requires matching stamps', () => {
    const head = notification({ workload: 'a' })
    expect(
      canCoalesceTaskNotificationWithFollower(
        head,
        notification({ workload: 'a' }),
      ),
    ).toBe(true)
    expect(
      canCoalesceTaskNotificationWithFollower(
        head,
        notification({ workload: 'b' }),
      ),
    ).toBe(false)
    expect(
      canCoalesceTaskNotificationWithFollower(
        head,
        notification({ isMeta: false, workload: 'a' }),
      ),
    ).toBe(false)
    expect(
      canCoalesceTaskNotificationWithFollower(
        notification({ workload: 'a', ccrTurnId: 't1' }),
        notification({ workload: 'a', ccrTurnId: 't2' }),
      ),
    ).toBe(false)
    const attr = '11111111-1111-1111-1111-111111111111'
    expect(
      canCoalesceTaskNotificationWithFollower(
        notification({
          workload: 'a',
          inheritedTurnAttributionKey: attr,
        }),
        notification({
          workload: 'a',
          inheritedTurnAttributionKey: attr,
        }),
      ),
    ).toBe(true)
    expect(
      canCoalesceTaskNotificationWithFollower(
        notification({
          workload: 'a',
          inheritedTurnAttributionKey: attr,
        }),
        notification({
          workload: 'a',
          inheritedTurnAttributionKey: '22222222-2222-2222-2222-222222222222',
        }),
      ),
    ).toBe(false)
  })

  test('shouldHoldQueryForTaskNotificationFollower gates deferred/doom/admits', () => {
    const head = notification()
    const next = notification({ taskId: 't2' })
    expect(
      shouldHoldQueryForTaskNotificationFollower(head, next, {
        deferredHuman: false,
        admits: () => true,
      }),
    ).toBe(true)
    expect(
      shouldHoldQueryForTaskNotificationFollower(head, next, {
        deferredHuman: true,
        admits: () => true,
      }),
    ).toBe(false)
    expect(
      shouldHoldQueryForTaskNotificationFollower(head, undefined, {
        deferredHuman: false,
        admits: () => true,
      }),
    ).toBe(false)
    expect(
      shouldHoldQueryForTaskNotificationFollower(head, next, {
        deferredHuman: false,
        admits: () => false,
      }),
    ).toBe(false)
    expect(
      shouldHoldQueryForTaskNotificationFollower(head, next, {
        deferredHuman: false,
        admits: () => true,
        isDoomBoundary: () => true,
      }),
    ).toBe(false)
  })
})

describe('densable 2.1.289 print task-notification coalesce state', () => {
  test('maybeStampHold sets shouldQuery false when follower hold admitted', () => {
    const state = createPrintTaskNotificationCoalesceState()
    const stamped = state.maybeStampHold(notification(), {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    expect(stamped.shouldQuery).toBe(false)
    expect(stamped.queryHeldForNextTurn).toBe(true)
    expect(stamped.stampThreadState).toBeUndefined()
  })

  test('maybeStampHold no-ops when disabled, ending, or over budget', () => {
    const state = createPrintTaskNotificationCoalesceState()
    expect(
      state.maybeStampHold(notification(), {
        endSessionRequested: true,
        coalesceEnabled: true,
        holdsFollower: true,
      }).queryHeldForNextTurn,
    ).toBeUndefined()
    expect(
      state.maybeStampHold(notification(), {
        endSessionRequested: false,
        coalesceEnabled: false,
        holdsFollower: true,
      }).queryHeldForNextTurn,
    ).toBeUndefined()

    const big = notification({
      value: `<task-notification>${'x'.repeat(PRINT_TASK_NOTIFICATION_COALESCE_CHAR_BUDGET)}<status>completed</status></task-notification>`,
    })
    // Force held chars near budget via noteTurnEnded first.
    const seed = state.maybeStampHold(notification(), {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    state.noteTurnEnded({
      aborted: false,
      command: seed,
      numTurns: 0,
      result: '',
    })
    expect(state.heldCompletionChars).toBeGreaterThan(0)
    // Over budget relative to already-held + new length.
    const over = state.maybeStampHold(big, {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    expect(over.queryHeldForNextTurn).toBeUndefined()
  })

  test('noteTurnEnded does not accumulate when aborted at result (gold A)', () => {
    const state = createPrintTaskNotificationCoalesceState()
    const held = state.maybeStampHold(notification({ workload: 'w1' }), {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    state.noteTurnEnded({
      aborted: true,
      command: held,
      numTurns: 0,
      result: '',
    })
    expect(state.heldCompletionChars).toBe(0)
    expect(state.heldCompletionWorkload).toBeUndefined()
  })

  test('noteTurnEnded accumulates held chars then clears on real turn', () => {
    const state = createPrintTaskNotificationCoalesceState()
    const held = state.maybeStampHold(notification({ workload: 'w1' }), {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    state.noteTurnEnded({
      aborted: false,
      command: held,
      numTurns: 0,
      result: '',
    })
    expect(state.heldCompletionChars).toBe(
      (typeof held.value === 'string' ? held.value : '').length,
    )
    expect(state.heldCompletionWorkload).toBe('w1')

    state.noteTurnEnded({
      aborted: false,
      command: held,
      numTurns: 1,
      result: 'ok',
    })
    expect(state.heldCompletionChars).toBe(0)
    expect(state.heldCompletionWorkload).toBeUndefined()
  })

  test('maybeOwedPrompt dispatches empty meta prompt and clears hold', () => {
    const state = createPrintTaskNotificationCoalesceState()
    const held = state.maybeStampHold(notification({ workload: 'owed' }), {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    state.noteTurnEnded({
      aborted: false,
      command: held,
      numTurns: 0,
      result: '',
    })
    const mainAgentId = asAgentId('main-agent')
    const owed = state.maybeOwedPrompt({
      endSessionRequested: false,
      aborted: false,
      peekMainDefined: false,
      mainAgentId,
    })
    expect(owed).toEqual({
      value: [],
      mode: 'prompt',
      agentId: mainAgentId,
      isMeta: true,
      skipSubmissionHooks: true,
      workload: 'owed',
    })
    expect(state.heldCompletionChars).toBe(0)
    expect(state.heldCompletionWorkload).toBeUndefined()
  })

  test('maybeOwedPrompt no-ops when peek has main or session ending; clears on abort', () => {
    const state = createPrintTaskNotificationCoalesceState()
    const held = state.maybeStampHold(notification(), {
      endSessionRequested: false,
      coalesceEnabled: true,
      holdsFollower: true,
    })
    state.noteTurnEnded({
      aborted: false,
      command: held,
      numTurns: 0,
      result: '',
    })
    expect(
      state.maybeOwedPrompt({
        endSessionRequested: false,
        aborted: false,
        peekMainDefined: true,
        mainAgentId: asAgentId('main'),
      }),
    ).toBeUndefined()
    expect(state.heldCompletionChars).toBeGreaterThan(0)

    expect(
      state.maybeOwedPrompt({
        endSessionRequested: true,
        aborted: false,
        peekMainDefined: false,
        mainAgentId: asAgentId('main'),
      }),
    ).toBeUndefined()
    expect(state.heldCompletionChars).toBeGreaterThan(0)

    expect(
      state.maybeOwedPrompt({
        endSessionRequested: false,
        aborted: true,
        peekMainDefined: false,
        mainAgentId: asAgentId('main'),
      }),
    ).toBeUndefined()
    expect(state.heldCompletionChars).toBe(0)
  })
})
