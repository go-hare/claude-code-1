import { describe, expect, test } from 'bun:test'
import {
  compareNotificationPriority,
  getNext,
  isNotificationVisibleDuringDiffPanel,
  queueForDiffPanel,
  removeNotificationFromState,
  shouldRequeueOnPreempt,
  type Notification,
} from '../notifications.js'

function text(
  partial: Partial<Notification> & Pick<Notification, 'key' | 'priority'>,
): Notification {
  return {
    text: partial.key,
    ...partial,
  }
}

describe('densable DiffPanel hold (ylr/mks/MWy filter)', () => {
  test('isNotificationVisibleDuringDiffPanel densable ylr', () => {
    expect(isNotificationVisibleDuringDiffPanel(null, false)).toBe(false)
    expect(isNotificationVisibleDuringDiffPanel(null, true)).toBe(false)
    expect(
      isNotificationVisibleDuringDiffPanel(
        text({ key: 'a', priority: 'high' }),
        false,
      ),
    ).toBe(true)
    expect(
      isNotificationVisibleDuringDiffPanel(
        text({ key: 'a', priority: 'high' }),
        true,
      ),
    ).toBe(false)
    expect(
      isNotificationVisibleDuringDiffPanel(
        text({ key: 'tok', priority: 'medium', exemptFromDiffPanelHold: true }),
        true,
      ),
    ).toBe(true)
  })

  test('queueForDiffPanel filters to exempt when visible', () => {
    const queue = [
      text({ key: 'held', priority: 'immediate', heldDuringDiffPanel: true }),
      text({ key: 'tok', priority: 'medium', exemptFromDiffPanelHold: true }),
      text({ key: 'low', priority: 'low' }),
    ]
    expect(queueForDiffPanel(queue, false)).toEqual(queue)
    expect(queueForDiffPanel(queue, true).map(n => n.key)).toEqual(['tok'])
  })

  test('getNext prefers higher priority within filtered queue', () => {
    const queue = [
      text({ key: 'low', priority: 'low', exemptFromDiffPanelHold: true }),
      text({ key: 'high', priority: 'high', exemptFromDiffPanelHold: true }),
    ]
    expect(getNext(queueForDiffPanel(queue, true))?.key).toBe('high')
  })

  test('token-warning exempt still paints while DiffPanel holds', () => {
    const tok = text({
      key: 'token-warning',
      priority: 'medium',
      exemptFromDiffPanelHold: true,
    })
    expect(isNotificationVisibleDuringDiffPanel(tok, true)).toBe(true)
    expect(
      queueForDiffPanel(
        [tok, text({ key: 'other', priority: 'high' })],
        true,
      ).map(n => n.key),
    ).toEqual(['token-warning'])
  })

  test('removeNotificationFromState densable glr covers pinned', () => {
    const pinned = text({
      key: 'launch-prompt-warning',
      priority: 'immediate',
      pinned: true,
    })
    const state = {
      current: text({ key: 'cur', priority: 'low' }),
      queue: [text({ key: 'q', priority: 'medium' })],
      pinned: [pinned],
    }
    const next = removeNotificationFromState(state, 'launch-prompt-warning')
    expect(next.pinned).toEqual([])
    expect(next.current?.key).toBe('cur')
    expect(next.queue.map(n => n.key)).toEqual(['q'])
    expect(removeNotificationFromState(state, 'missing')).toBe(state)
  })

  test('compareNotificationPriority densable D0b', () => {
    const a = text({ key: 'a', priority: 'low' })
    const b = text({ key: 'b', priority: 'immediate' })
    expect(compareNotificationPriority(b, a)).toBeLessThan(0)
  })

  test('removeNotificationFromState densable glr covers queue+current', () => {
    const state = {
      current: text({ key: 'cur', priority: 'high' }),
      queue: [text({ key: 'q', priority: 'medium' })],
      pinned: [] as Notification[],
    }
    const next = removeNotificationFromState(state, 'cur')
    expect(next.current).toBeNull()
    expect(next.queue.map(n => n.key)).toEqual(['q'])
    const nextQ = removeNotificationFromState(state, 'q')
    expect(nextQ.current?.key).toBe('cur')
    expect(nextQ.queue).toEqual([])
  })

  test('shouldRequeueOnPreempt densable mks', () => {
    const incoming = text({ key: 'new', priority: 'immediate' })
    expect(
      shouldRequeueOnPreempt(
        text({ key: 'med', priority: 'medium' }),
        incoming,
      ),
    ).toBe(true)
    expect(
      shouldRequeueOnPreempt(
        text({ key: 'imm', priority: 'immediate' }),
        incoming,
      ),
    ).toBe(false)
    expect(
      shouldRequeueOnPreempt(
        text({ key: 'imm', priority: 'immediate', requeueOnPreempt: true }),
        incoming,
      ),
    ).toBe(true)
    expect(
      shouldRequeueOnPreempt(
        text({
          key: 'held',
          priority: 'immediate',
          heldDuringDiffPanel: true,
        }),
        incoming,
      ),
    ).toBe(true)
    expect(
      shouldRequeueOnPreempt(
        text({ key: 'kill', priority: 'medium' }),
        text({
          key: 'new',
          priority: 'immediate',
          invalidates: ['kill'],
        }),
      ),
    ).toBe(false)
  })
})
