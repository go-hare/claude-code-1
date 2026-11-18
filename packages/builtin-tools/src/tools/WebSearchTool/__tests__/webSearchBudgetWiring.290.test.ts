import { describe, expect, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import { createTaskRegistry } from 'src/utils/taskRegistry.js'
import { WebSearchTool } from '../WebSearchTool.js'

describe('v2.1.290 #158: taskRegistry & WebSearchTool wired to sessionSpawnCaps', () => {
  test('createTaskRegistry exposes getWebSearchBudget and resetWebSearchBudget', () => {
    let state = { tasks: {}, transcripts: {} } as unknown as AppState
    const registry = createTaskRegistry(
      () => state,
      updater => {
        state = updater(state)
      },
      { refillWebSearchBudgetByDefault: true },
    )
    const budget = registry.getWebSearchBudget()
    expect(budget.refillsPerHour()).toBe(100)
    expect(budget.tryConsume()).toBe(true)
    registry.resetWebSearchBudget()
    expect(registry.getWebSearchBudget()).not.toBe(budget)
  })

  test('WebSearchTool returns soft cap message when taskRegistry budget is exhausted', async () => {
    const fakeRegistry = {
      getWebSearchBudget: () => ({
        tryConsume: () => false,
        msUntilNextCall: () => 36_000,
        refillsPerHour: () => 100,
      }),
    }
    const res = await WebSearchTool.call(
      { query: 'bun test' } as never,
      {
        taskRegistry: fakeRegistry,
        abortController: new AbortController(),
      } as never,
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(res.data.results[0]).toContain('web search budget is used up')
    expect(res.data.results[0]).toContain('refills at about 100 calls per hour')
  })
})
