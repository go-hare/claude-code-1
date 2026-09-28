import { afterEach, describe, expect, test } from 'bun:test'
import {
  enqueue,
  getCommandQueue,
  promoteMainThreadQueueToNow,
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
})
