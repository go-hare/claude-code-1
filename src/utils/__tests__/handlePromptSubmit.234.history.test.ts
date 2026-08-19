/**
 * densable 2.1.234 #20 — mid-turn queue stamps historyEntry; flush on drain.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

mock.module('../../services/analytics/index.js', () => ({
  logEvent: () => {},
}))

import {
  enqueue,
  getCommandQueue,
  resetCommandQueue,
} from '../messageQueueManager.js'

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('QueuedCommand historyEntry densable 2.1.234 #20', () => {
  test('enqueue preserves historyEntry for deferred JDr flush', () => {
    enqueue({
      value: 'ls',
      mode: 'bash',
      origin: { kind: 'human' },
      historyEntry: {
        display: '!ls',
        pastedContents: {},
      },
    } as any)
    const q = getCommandQueue()
    expect(q).toHaveLength(1)
    expect(q[0]!.historyEntry?.display).toBe('!ls')
  })
})
