import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import { QueryEngine } from '../../QueryEngine.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { createFileStateCacheWithSizeLimit } from '../fileStateCache.js'
import { createSubagentContext } from '../forkedAgent.js'
import { buildSideQuestionFallbackParams } from '../queryContext.js'
import {
  assertAndTakeConcurrencySlot,
  consumeWebSearchBudgetOrCapMessage,
} from '../sessionSpawnCaps.js'
import { createTaskRegistry } from '../taskRegistry.js'
import { ToolStateSlots } from '../toolState.js'

describe('session registry inheritance', () => {
  test('isolated descendants share the exact registry and cannot reset the 200-search budget', () => {
    let state = getDefaultAppState()
    const setAppState: ToolUseContext['setAppState'] = updater => {
      state = updater(state)
    }
    const registry = createTaskRegistry(() => state, setAppState)
    const parent = {
      abortController: new AbortController(),
      readFileState: createFileStateCacheWithSizeLimit(10),
      toolState: new ToolStateSlots(),
      getAppState: () => state,
      setAppState,
      taskRegistry: registry,
      options: {},
      messages: [],
    } as unknown as ToolUseContext
    const child = createSubagentContext(parent)
    const grandchild = createSubagentContext(child)
    expect(child.taskRegistry).toBe(registry)
    expect(grandchild.taskRegistry).toBe(registry)
    child.setAppState(() => {
      throw new Error('isolated setter must be a no-op')
    })
    for (let i = 0; i < 200; i++) {
      expect(
        consumeWebSearchBudgetOrCapMessage({
          taskRegistry: child.taskRegistry,
          env: {},
        }),
      ).toBeNull()
    }
    expect(
      consumeWebSearchBudgetOrCapMessage({
        taskRegistry: grandchild.taskRegistry,
        env: {},
      }),
    ).toMatchObject({ capped: true, used: 200, max: 200 })
    expect(registry.getWebSearchCalls()).toBe(200)

    const release = assertAndTakeConcurrencySlot({
      taskRegistry: child.taskRegistry,
      env: {},
    })
    expect(state.runningSubagents).toBe(1)
    release()
    release()
    expect(state.runningSubagents).toBe(0)

    // Legacy contexts without Xm still inherit the real task setter.
    const legacy = createSubagentContext({
      ...parent,
      taskRegistry: undefined,
    } as unknown as ToolUseContext)
    const releaseFallback = assertAndTakeConcurrencySlot({
      getAppState: legacy.getAppState,
      setAppState: legacy.setAppStateForTasks ?? legacy.setAppState,
      env: {},
    })
    expect(state.runningSubagents).toBe(1)
    releaseFallback()
    expect(state.runningSubagents).toBe(0)
  })

  test('repeated side-question fallback builds reuse the caller registry and exhausted budget', async () => {
    let state = getDefaultAppState()
    const setAppState: ToolUseContext['setAppState'] = updater => {
      state = updater(state)
    }
    const taskRegistry = createTaskRegistry(() => state, setAppState)
    for (let i = 0; i < 200; i++) taskRegistry.incrementWebSearchCalls()
    const inputs = {
      tools: [],
      commands: [],
      mcpClients: [],
      messages: [],
      agents: [],
      readFileState: createFileStateCacheWithSizeLimit(10),
      toolState: new ToolStateSlots(),
      taskRegistry,
      getAppState: () => state,
      setAppState,
      customSystemPrompt: 'test',
      appendSystemPrompt: undefined,
      thinkingConfig: undefined,
    }
    const config = {
      ...inputs,
      cwd: process.cwd(),
      canUseTool: async () => ({
        behavior: 'allow' as const,
        updatedInput: {},
      }),
      readFileCache: inputs.readFileState,
    }
    const firstEngine = new QueryEngine(config)
    const secondEngine = new QueryEngine(config)
    // Inspect the runtime property without changing production visibility.
    expect(Reflect.get(firstEngine, 'taskRegistry')).toBe(taskRegistry)
    expect(Reflect.get(secondEngine, 'taskRegistry')).toBe(taskRegistry)
    const release = (
      Reflect.get(firstEngine, 'taskRegistry') as typeof taskRegistry
    ).takeConcurrencySlot()
    expect(
      (
        Reflect.get(secondEngine, 'taskRegistry') as typeof taskRegistry
      ).getConcurrentSubagents(),
    ).toBe(1)
    release()
    const first = await buildSideQuestionFallbackParams(inputs)
    const second = await buildSideQuestionFallbackParams(inputs)
    expect(first.toolUseContext.taskRegistry).toBe(taskRegistry)
    expect(second.toolUseContext.taskRegistry).toBe(taskRegistry)
    expect(
      consumeWebSearchBudgetOrCapMessage({
        taskRegistry: second.toolUseContext.taskRegistry,
        env: {},
      }),
    ).toMatchObject({ capped: true, used: 200 })
  })
})
