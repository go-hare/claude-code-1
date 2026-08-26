import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearInFlightDrainBatch,
  enqueue,
  resetCommandQueue,
  setInFlightDrainBatch,
  someInFlightDrainCommand,
} from '../messageQueueManager.js'
import { processQueueIfReady } from '../queueProcessor.js'

beforeEach(() => {
  resetCommandQueue()
})

afterEach(() => {
  resetCommandQueue()
})

describe('densable 2.1.239 #11 inFlightDrainBatch', () => {
  test('set/clear uses reference identity (official k(Ze))', () => {
    const a = [{ value: 'a', mode: 'prompt' as const }]
    const b = [{ value: 'b', mode: 'prompt' as const }]
    setInFlightDrainBatch(a)
    expect(someInFlightDrainCommand()).toBe(true)
    clearInFlightDrainBatch(b)
    expect(someInFlightDrainCommand()).toBe(true)
    clearInFlightDrainBatch(a)
    expect(someInFlightDrainCommand()).toBe(false)
  })

  test('Cuy holds drain while executeInput is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    enqueue({ value: 'queued-turn', mode: 'prompt' } as never)

    const result = processQueueIfReady({
      executeInput: async () => {
        await gate
      },
    })
    expect(result.processed).toBe(true)
    expect(someInFlightDrainCommand()).toBe(true)

    release()
    await gate
    await Promise.resolve()
    expect(someInFlightDrainCommand()).toBe(false)
  })

  test('skips passive wake rows (official Cuy passive!==true)', () => {
    enqueue({
      value: 'passive-wake',
      mode: 'prompt',
      passive: true,
    } as never)
    const result = processQueueIfReady({
      executeInput: async () => {
        throw new Error('must not drain passive')
      },
    })
    expect(result.processed).toBe(false)
  })
})
