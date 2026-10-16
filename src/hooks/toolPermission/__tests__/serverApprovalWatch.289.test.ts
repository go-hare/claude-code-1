import { describe, expect, test } from 'bun:test'
import { runServerApprovalWatch } from '../serverApprovalWatch.js'

const never = new AbortController().signal

describe('runServerApprovalWatch', () => {
  test('a later poll accepts after the 3s then 4.5s backoff', async () => {
    const delays: number[] = []
    let polls = 0
    let approved = 0
    await runServerApprovalWatch({
      poll: async () => {
        polls += 1
        return polls >= 3
      },
      signal: never,
      shouldStop: () => false,
      isPlanMode: () => false,
      onApproved: () => {
        approved += 1
      },
      sleep: async ms => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([3000, 4500])
    expect(approved).toBe(1)
    expect(polls).toBe(3)
  })

  test('the first poll never accepts on its own', async () => {
    let approved = 0
    await runServerApprovalWatch({
      poll: async () => true,
      signal: never,
      shouldStop: () => false,
      isPlanMode: () => false,
      onApproved: () => {
        approved += 1
      },
      sleep: async () => {
        throw new Error('should not wait')
      },
    })
    expect(approved).toBe(0)
  })

  test('plan mode parks the observed grant and keeps polling', async () => {
    let polls = 0
    let plan = true
    let approved = 0
    const delays: number[] = []
    await runServerApprovalWatch({
      poll: async () => {
        polls += 1
        return polls >= 2
      },
      signal: never,
      shouldStop: () => false,
      isPlanMode: () => {
        if (!plan) return false
        plan = false
        return true
      },
      onApproved: () => {
        approved += 1
      },
      sleep: async ms => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([3000, 4500])
    expect(approved).toBe(1)
  })

  test('a resolved dialog stops the wait without accepting', async () => {
    let stop = false
    let approved = 0
    let polls = 0
    await runServerApprovalWatch({
      poll: async () => {
        polls += 1
        return true
      },
      signal: never,
      shouldStop: () => stop,
      isPlanMode: () => false,
      onApproved: () => {
        approved += 1
      },
      sleep: async () => {
        stop = true
      },
    })
    expect(approved).toBe(0)
    expect(polls).toBe(1)
  })

  test('abort during the wait rejects and does not accept', async () => {
    const controller = new AbortController()
    let approved = 0
    await expect(
      runServerApprovalWatch({
        poll: async () => false,
        signal: controller.signal,
        shouldStop: () => false,
        isPlanMode: () => false,
        onApproved: () => {
          approved += 1
        },
        sleep: async (_ms, signal) => {
          controller.abort()
          if (signal.aborted) throw new Error('aborted')
        },
      }),
    ).rejects.toThrow('aborted')
    expect(approved).toBe(0)
  })
})
