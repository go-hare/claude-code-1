import { describe, expect, test } from 'bun:test'
import {
  applyNonImmediateNotification,
  type Notification,
  type NotificationsBucket,
} from '../notifications.js'

function bucket(
  current: Notification | null,
  queue: Notification[] = [],
  pinned: Notification[] = [],
): NotificationsBucket {
  return { current, queue, pinned }
}

function textNotif(
  partial: Partial<Notification> & Pick<Notification, 'key' | 'priority'>,
): Notification {
  return {
    text: 'default',
    ...partial,
  } as Notification
}

describe('applyNonImmediateNotification', () => {
  test('same key on current: replace content and reset timeout', () => {
    const current = textNotif({
      key: 'effort-level',
      priority: 'high',
      text: '◐ medium · /effort',
    })
    const incoming = textNotif({
      key: 'effort-level',
      priority: 'high',
      text: '⦿ ultracode · xhigh effort + dynamic workflows for maximum thoroughness',
    })

    const applied = applyNonImmediateNotification(bucket(current), incoming)

    expect(applied.timeoutAction).toBe('reset')
    expect(applied.notifications.current).toEqual(incoming)
    expect(applied.notifications.queue).toEqual([])
  })

  test('same key in queue: replace queued entry without touching current', () => {
    const current = textNotif({
      key: 'other',
      priority: 'medium',
      text: 'other toast',
    })
    const queued = textNotif({
      key: 'effort-level',
      priority: 'high',
      text: '◐ medium · /effort',
    })
    const incoming = textNotif({
      key: 'effort-level',
      priority: 'high',
      text: '◉ high · /effort',
    })

    const applied = applyNonImmediateNotification(
      bucket(current, [queued]),
      incoming,
    )

    expect(applied.timeoutAction).toBe('none')
    expect(applied.notifications.current).toBe(current)
    expect(applied.notifications.queue).toEqual([incoming])
  })

  test('fold on current merges and resets timeout', () => {
    const current = textNotif({
      key: 'progress',
      priority: 'medium',
      text: 'step 1',
    })
    const fold = (acc: Notification, incoming: Notification): Notification => {
      const a = 'text' in acc ? acc.text : ''
      const b = 'text' in incoming ? incoming.text : ''
      return {
        ...incoming,
        text: `${a}+${b}`,
        fold,
      } as Notification
    }
    const incoming = textNotif({
      key: 'progress',
      priority: 'medium',
      text: 'step 2',
      fold,
    })

    const applied = applyNonImmediateNotification(bucket(current), incoming)

    expect(applied.timeoutAction).toBe('reset')
    expect(applied.notifications.current).toMatchObject({
      key: 'progress',
      text: 'step 1+step 2',
    })
  })

  test('invalidates current: clear timeout and drop current', () => {
    const current = textNotif({
      key: 'old-toast',
      priority: 'low',
      text: 'stale',
    })
    const incoming = textNotif({
      key: 'new-toast',
      priority: 'high',
      text: 'fresh',
      invalidates: ['old-toast'],
    })

    const applied = applyNonImmediateNotification(bucket(current), incoming)

    expect(applied.timeoutAction).toBe('clear')
    expect(applied.notifications.current).toBeNull()
    expect(applied.notifications.queue).toEqual([incoming])
  })

  test('non-immediate toast preserves pinned list (gold Nu pinned[])', () => {
    const pin = textNotif({
      key: 'pin-1',
      priority: 'low',
      text: 'pinned',
      pinned: true,
    })
    const incoming = textNotif({
      key: 'effort-level',
      priority: 'high',
      text: '◉ high · /effort',
    })
    const applied = applyNonImmediateNotification(
      bucket(null, [], [pin]),
      incoming,
    )
    expect(applied.notifications.pinned).toEqual([pin])
    expect(applied.notifications.queue).toEqual([incoming])
  })

  test('new key with empty current: enqueue only', () => {
    const incoming = textNotif({
      key: 'effort-level',
      priority: 'high',
      text: '◉ high · /effort',
    })

    const applied = applyNonImmediateNotification(bucket(null), incoming)

    expect(applied.timeoutAction).toBe('none')
    expect(applied.notifications.current).toBeNull()
    expect(applied.notifications.queue).toEqual([incoming])
  })

  test('contextual idle hint is a normal toast (not a sticky slot)', () => {
    const current: Notification = {
      key: 'idle-return-hint',
      kind: 'contextual',
      priority: 'medium',
      timeoutMs: 0x7fffffff,
      segments: [{ text: 'new task? ', dim: true }],
    }
    const incoming: Notification = {
      ...current,
      segments: [
        { text: 'new task? ', dim: true },
        { text: '/clear', color: 'suggestion' },
      ],
    }
    const applied = applyNonImmediateNotification(bucket(current), incoming)
    expect(applied.timeoutAction).toBe('reset')
    expect(applied.notifications.current).toEqual(incoming)
    expect(applied.notifications.pinned).toEqual([])
  })
})
