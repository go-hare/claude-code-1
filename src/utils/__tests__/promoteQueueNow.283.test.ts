import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import {
  enqueue,
  getCommandQueue,
  promoteMainThreadQueueToNow,
  promoteToNow,
  removeByFilter,
} from '../messageQueueManager.js'

describe('densable 2.1.283 send-now queue flush', () => {
  afterEach(() => {
    removeByFilter(() => true)
  })

  test('promoteMainThreadQueueToNow raises next/later to now', () => {
    enqueue({ value: 'a', mode: 'prompt', priority: 'next' })
    enqueue({ value: 'b', mode: 'prompt', priority: 'later' })
    expect(promoteMainThreadQueueToNow()).toBe(2)
    expect(getCommandQueue().every(c => c.priority === 'now')).toBe(true)
  })

  test('yt promoteToNow raises one uuid', () => {
    const a = randomUUID()
    const b = randomUUID()
    enqueue({ value: 'a', mode: 'prompt', uuid: a, priority: 'next' })
    enqueue({ value: 'b', mode: 'prompt', uuid: b, priority: 'later' })
    expect(promoteToNow(a)).toBe(true)
    expect(getCommandQueue().find(c => c.uuid === a)?.priority).toBe('now')
    expect(getCommandQueue().find(c => c.uuid === b)?.priority).toBe('later')
  })
})
