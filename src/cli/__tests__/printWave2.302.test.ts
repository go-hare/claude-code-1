import { afterEach, describe, expect, test } from 'bun:test'
import { getTotalCostUSD, resetStateForTests } from '../../bootstrap/state.js'
import { CostMetadataPusher, restoreCostStateFromWorker } from '../print.js'

afterEach(() => {
  resetStateForTests()
})

describe('#917 cloud session cost restore and CostMetadataPusher', () => {
  test('restoreCostStateFromWorker restores cost ledger from internal.cost_state', () => {
    const costState = JSON.stringify({
      totalCostUSD: 1.25,
      totalAPIDuration: 5000,
      totalAPIDurationWithoutRetries: 4500,
      totalToolDuration: 1200,
      totalLinesAdded: 10,
      totalLinesRemoved: 3,
      lastDuration: 6200,
    })

    const restored = restoreCostStateFromWorker({
      internal: { cost_state: costState },
    } as never)

    expect(restored).toBe(true)
    expect(getTotalCostUSD()).toBeCloseTo(1.25, 5)
  })

  test('restoreCostStateFromWorker ignores malformed or oversized cost_state', () => {
    expect(
      restoreCostStateFromWorker({
        internal: { cost_state: '{invalid' },
      } as never),
    ).toBe(false)
    expect(
      restoreCostStateFromWorker({
        internal: { cost_state: 'x'.repeat(20_000) },
      } as never),
    ).toBe(false)
  })

  test('CostMetadataPusher pushes cumulative cost and cost_state when changed', () => {
    const pushed: Array<Record<string, unknown>> = []
    const pusher = new CostMetadataPusher(patch => pushed.push(patch))

    pusher.pushIfChanged({ custom_flag: true })
    expect(pushed).toEqual([{ custom_flag: true }])

    restoreCostStateFromWorker({
      internal: {
        cost_state: JSON.stringify({
          totalCostUSD: 2.5,
          totalAPIDuration: 100,
          totalAPIDurationWithoutRetries: 100,
          totalToolDuration: 50,
          totalLinesAdded: 1,
          totalLinesRemoved: 0,
        }),
      },
    } as never)

    pusher.pushIfChanged()
    expect(pushed.length).toBe(2)
    expect(pushed[1]!.cumulative_cost_usd).toBeCloseTo(2.5, 5)
    expect(typeof pushed[1]!.cost_state).toBe('string')
  })
})
