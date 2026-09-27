import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  capTaskNotificationValue,
  dequeue,
  enqueuePendingNotification,
  resetCommandQueue,
  TASK_NOTIFICATION_CHAR_CAP,
} from '../messageQueueManager.js'

/** densable jYt */
const CAP_HYSTERESIS = 1024

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('capTaskNotificationValue densable ap/Q8n (2.1.252)', () => {
  test('short task-notification value is unchanged', () => {
    expect(capTaskNotificationValue('hello')).toBe('hello')
  })

  test('value length === CAP + jYt stays (e.length<=t+jYt)', () => {
    const value = 'a'.repeat(TASK_NOTIFICATION_CHAR_CAP + CAP_HYSTERESIS)
    expect(capTaskNotificationValue(value)).toBe(value)
  })

  test('value length === CAP + jYt + 1 is capped with truncation marker', () => {
    const value = 'a'.repeat(TASK_NOTIFICATION_CHAR_CAP + CAP_HYSTERESIS + 1)
    const capped = capTaskNotificationValue(value)
    expect(capped).not.toBe(value)
    expect(capped.length).toBeLessThan(value.length)
    expect(capped).toContain('\n\n... [')
    expect(capped).toContain(' characters truncated] ...\n\n')
  })

  test('nested truncation markers in the omitted middle add to the count', () => {
    const head = Math.floor(TASK_NOTIFICATION_CHAR_CAP / 2)
    const tail = TASK_NOTIFICATION_CHAR_CAP - head
    const nested = '\n\n... [999 characters truncated] ...\n\n'
    const over = CAP_HYSTERESIS + 1
    const padding = 'x'.repeat(over - nested.length)
    const value = 'a'.repeat(head) + nested + padding + 'b'.repeat(tail)
    expect(value.length).toBe(TASK_NOTIFICATION_CHAR_CAP + CAP_HYSTERESIS + 1)

    const omitted = value.length - head - tail
    const nestedExtra = 999 - nested.length
    const capped = capTaskNotificationValue(value)
    expect(capped).toContain(
      `... [${omitted + nestedExtra} characters truncated] ...`,
    )
    expect(capped).not.toContain(`... [${omitted} characters truncated] ...`)
  })
})

describe('enqueuePendingNotification densable Sn cap (2.1.252)', () => {
  test('prompt-mode long string is not capped', () => {
    const value = 'p'.repeat(TASK_NOTIFICATION_CHAR_CAP + CAP_HYSTERESIS + 1)
    enqueuePendingNotification({ value, mode: 'prompt' } as any)
    expect(dequeue()!.value).toBe(value)
  })

  test('huge task-notification is capped on dequeue', () => {
    const value = 't'.repeat(TASK_NOTIFICATION_CHAR_CAP + CAP_HYSTERESIS + 1)
    enqueuePendingNotification({
      value,
      mode: 'task-notification',
    } as any)
    const dequeued = dequeue()!
    expect(typeof dequeued.value).toBe('string')
    expect(dequeued.value).not.toBe(value)
    expect((dequeued.value as string).length).toBeLessThan(value.length)
    expect(dequeued.value as string).toContain('\n\n... [')
    expect(dequeued.value as string).toContain(' characters truncated] ...\n\n')
  })
})
