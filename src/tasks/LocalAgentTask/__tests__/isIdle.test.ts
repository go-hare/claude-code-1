import { describe, expect, test } from 'bun:test'
import {
  computeLocalAgentIsIdle,
  registerAsyncAgent,
  updateLocalAgentIsIdle,
} from '../LocalAgentTask.js'
import type { AppState } from 'src/state/AppState.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'

const agentDef = {
  agentType: 'general-purpose',
  whenToUse: 'test',
  tools: ['*'],
  source: 'built-in',
  getSystemPrompt: () => '',
} as unknown as AgentDefinition

function makeSetAppState(initial: AppState): {
  get: () => AppState
  set: (fn: (prev: AppState) => AppState) => void
} {
  let state = initial
  return {
    get: () => state,
    set: fn => {
      state = fn(state)
    },
  }
}

describe('computeLocalAgentIsIdle (densable Yqe D)', () => {
  test('false when no tools in flight', () => {
    expect(computeLocalAgentIsIdle(new Set(), new Set())).toBe(false)
  })

  test('false when non-Agent tools are in flight alone', () => {
    const N = new Set(['bash-1'])
    const $ = new Set<string>()
    expect(computeLocalAgentIsIdle(N, $)).toBe(false)
  })

  test('false when mix of Agent and Bash in flight', () => {
    const N = new Set(['agent-1', 'bash-1'])
    const $ = new Set(['agent-1'])
    expect(computeLocalAgentIsIdle(N, $)).toBe(false)
  })

  test('true when every in-flight tool is nested Agent', () => {
    const N = new Set(['agent-1', 'agent-2'])
    const $ = new Set(['agent-1', 'agent-2'])
    expect(computeLocalAgentIsIdle(N, $)).toBe(true)
  })

  test('true for single nested Agent tool', () => {
    expect(computeLocalAgentIsIdle(new Set(['a']), new Set(['a']))).toBe(true)
  })
})

describe('registerAsyncAgent isIdle:!1', () => {
  test('stamps isIdle false at register (densable Sot)', () => {
    const store = makeSetAppState({ tasks: {} } as AppState)
    const t = registerAsyncAgent({
      agentId: 'a1',
      description: 'd',
      prompt: 'p',
      selectedAgent: agentDef,
      setAppState: store.set,
      attachOwnerKeepalive: false,
    })
    expect(t.isIdle).toBe(false)
    expect((store.get().tasks['a1'] as { isIdle?: boolean }).isIdle).toBe(false)
  })

  test('updateLocalAgentIsIdle skips churn when unchanged', () => {
    const store = makeSetAppState({ tasks: {} } as AppState)
    registerAsyncAgent({
      agentId: 'a2',
      description: 'd',
      prompt: 'p',
      selectedAgent: agentDef,
      setAppState: store.set,
      attachOwnerKeepalive: false,
    })
    const before = store.get()
    updateLocalAgentIsIdle('a2', false, store.set)
    expect(store.get()).toBe(before)
    updateLocalAgentIsIdle('a2', true, store.set)
    expect((store.get().tasks['a2'] as { isIdle: boolean }).isIdle).toBe(true)
  })
})
